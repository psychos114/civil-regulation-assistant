import { env } from "cloudflare:workers";
import {
  ensureDatabase,
  internalError,
  successResponse,
} from "@/lib/regulations";
import { vectorStoreStatusData } from "@/lib/vector-store";

type RagChunkRow = {
  chunk_id: string;
  doc_id: string;
  company: string;
  stock_code: string;
  title: string;
  document_type: string;
  report_year: string;
  source_url: string;
  file_format: string;
  page: number | null;
  content: string;
  sql_score: number;
};

export type RagSourceDetail = {
  label: string;
  title: string;
  documentType: string;
  reportYear: string;
  page: number | null;
  url: string;
};

export type RagDocumentCatalogItem = {
  docId: string;
  title: string;
  documentType: string;
  reportYear: string;
  url: string;
};

const MAX_SEARCH_TERMS = 12;
const MAX_CANDIDATES = 30;
const DEFAULT_RESULT_LIMIT = 6;
const QUESTION_WORDS = new Set([
  "什么",
  "哪些",
  "怎么",
  "怎样",
  "如何",
  "是否",
  "可以",
  "请问",
  "一下",
  "介绍",
  "相关",
  "情况",
  "问题",
  "回答",
]);

function database(): D1Database {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) {
    throw new Error("D1 数据库绑定 DB 不可用");
  }
  return binding;
}

function addTerm(terms: string[], seen: Set<string>, term: string): void {
  const normalized = term.trim().toLowerCase();
  if (
    normalized.length < 2 ||
    QUESTION_WORDS.has(normalized) ||
    seen.has(normalized)
  ) {
    return;
  }
  seen.add(normalized);
  terms.push(normalized);
}

export function extractSearchTerms(question: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const normalized = question
    .toLowerCase()
    .replace(/[，。！？、；：“”‘’（）《》【】\s]+/g, " ");

  for (const token of normalized.match(/[a-z0-9][a-z0-9._/-]{1,}/g) ?? []) {
    addTerm(terms, seen, token);
  }

  for (const segment of normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    if (segment.length <= 8) addTerm(terms, seen, segment);

    for (let size = Math.min(4, segment.length); size >= 2; size -= 2) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        addTerm(terms, seen, segment.slice(index, index + size));
      }
    }
  }

  return terms
    .sort((left, right) => right.length - left.length)
    .slice(0, MAX_SEARCH_TERMS);
}

function sourceLabel(row: RagChunkRow): string {
  const page = row.page ? ` · 第${row.page}页` : "";
  return `《${row.title}》${page}`;
}

function scoreRow(row: RagChunkRow, terms: string[]): number {
  const title = row.title.toLowerCase();
  const content = row.content.toLowerCase();
  let score = Number(row.sql_score ?? 0);

  for (const term of terms) {
    if (title.includes(term)) score += 12 + term.length;
    if (content.includes(term)) score += 2 + term.length / 2;
  }
  return score;
}

export async function retrieveRagContext(
  question: string,
  limit = DEFAULT_RESULT_LIMIT,
): Promise<{
  rows: RagChunkRow[];
  text: string;
  sourceDetails: RagSourceDetail[];
}> {
  const terms = extractSearchTerms(question);
  if (!terms.length) {
    return { rows: [], text: "", sourceDetails: [] };
  }

  const scoreSql = terms
    .map(
      () =>
        "(CASE WHEN title LIKE ? THEN 8 ELSE 0 END + " +
        "CASE WHEN content LIKE ? THEN 2 ELSE 0 END)",
    )
    .join(" + ");
  const whereSql = terms
    .map(() => "(title LIKE ? OR content LIKE ?)")
    .join(" OR ");
  const scoreBindings = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
  const whereBindings = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);

  const result = await database()
    .prepare(`
      SELECT
        chunk_id, doc_id, company, stock_code, title, document_type,
        report_year, source_url, file_format, page, content,
        ${scoreSql} AS sql_score
      FROM rag_chunks
      WHERE ${whereSql}
      ORDER BY sql_score DESC, title ASC, page ASC
      LIMIT ?
    `)
    .bind(...scoreBindings, ...whereBindings, MAX_CANDIDATES)
    .all<RagChunkRow>();

  const rows = result.results
    .map((row) => ({ row, score: scoreRow(row, terms) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(limit, 10)))
    .map(({ row }) => row);

  const sourceDetails = rows.map((row) => ({
    label: sourceLabel(row),
    title: row.title,
    documentType: row.document_type,
    reportYear: row.report_year,
    page: row.page,
    url: row.source_url,
  }));

  return {
    rows,
    sourceDetails,
    text: rows
      .map((row, index) => {
        const location = row.page ? `第${row.page}页` : "官网网页";
        return [
          `[企业资料${index + 1}｜${sourceLabel(row)}]`,
          `文档类型：${row.document_type || "企业公开资料"}`,
          `位置：${location}`,
          `官方来源：${row.source_url}`,
          row.content,
        ].join("\n");
      })
      .join("\n\n"),
  };
}

export async function ragDocumentCatalog(): Promise<RagDocumentCatalogItem[]> {
  const result = await database()
    .prepare(`
      SELECT
        doc_id, MAX(title) AS title, MAX(document_type) AS document_type,
        MAX(report_year) AS report_year, MAX(source_url) AS source_url
      FROM rag_chunks
      GROUP BY doc_id
      ORDER BY report_year DESC, title ASC
    `)
    .all<{
      doc_id: string;
      title: string;
      document_type: string;
      report_year: string;
      source_url: string;
    }>();
  return result.results.map((row) => ({
    docId: row.doc_id,
    title: row.title,
    documentType: row.document_type,
    reportYear: row.report_year,
    url: row.source_url,
  }));
}

function normalizeSource(value: string): string {
  return value.replace(/[《》\s·•]/g, "").toLowerCase();
}

export async function resolveRagSourceDetails(
  sources: string[],
  catalog: RagDocumentCatalogItem[],
): Promise<RagSourceDetail[]> {
  const details: RagSourceDetail[] = [];
  const seen = new Set<string>();

  for (const source of sources.slice(0, 8)) {
    const normalized = normalizeSource(source);
    const document = catalog.find((item) =>
      normalized.includes(normalizeSource(item.title)),
    );
    if (!document) continue;

    const pageMatch = source.match(/第\s*(\d+)\s*页/);
    const page = pageMatch ? Number(pageMatch[1]) : null;
    const key = `${document.docId}:${page ?? "web"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    details.push({
      label: `《${document.title}》${page ? ` · 第${page}页` : ""}`,
      title: document.title,
      documentType: document.documentType,
      reportYear: document.reportYear,
      page,
      url: document.url,
    });
  }
  return details;
}

export async function ragStatus(): Promise<Response> {
  try {
    await ensureDatabase();
    const [result, vectorDatabase] = await Promise.all([
      database()
        .prepare(`
          SELECT
            COUNT(*) AS chunk_count,
            COUNT(DISTINCT doc_id) AS document_count,
            MAX(company) AS company
          FROM rag_chunks
        `)
        .first<{
          chunk_count: number;
          document_count: number;
          company: string | null;
        }>(),
      vectorStoreStatusData(),
    ]);

    return successResponse({
      ready:
        Number(result?.chunk_count ?? 0) > 0 && vectorDatabase.ready,
      chunk_count: Number(result?.chunk_count ?? 0),
      document_count: Number(result?.document_count ?? 0),
      company: result?.company ?? null,
      retrieval_mode: vectorDatabase.ready ? "vector" : "keyword_fallback",
      vector_database: vectorDatabase,
    });
  } catch (error) {
    return internalError(error);
  }
}
