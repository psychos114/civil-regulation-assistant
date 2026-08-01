import { env } from "cloudflare:workers";
import {
  ensureDatabase,
  errorResponse,
  internalError,
  successResponse,
} from "@/lib/regulations";

type VectorEnvironment = {
  DB?: D1Database;
  PINECONE_API_KEY?: string;
  PINECONE_INDEX_NAME?: string;
  PINECONE_NAMESPACE?: string;
  PINECONE_CONTROL_URL?: string;
};

type VectorStoreRow = {
  provider: string;
  vector_store_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_error: string | null;
};

type VectorDocumentRow = {
  doc_id: string;
  title: string;
  source_url: string;
  file_id: string | null;
  status: string;
  updated_at: string;
  last_error: string | null;
};

type RagChunkRow = {
  chunk_id: string;
  doc_id: string;
  company: string;
  stock_code: string;
  title: string;
  document_type: string;
  report_year: string;
  source_url: string;
  page: number | null;
  content: string;
};

type PineconeIndex = {
  name?: string;
  host?: string;
  status?: {
    ready?: boolean;
    state?: string;
  };
  embed?: {
    model?: string;
    field_map?: Record<string, string>;
  };
};

type PineconeNamespace = {
  name?: string;
  record_count?: number;
};

type PineconeSearchResponse = {
  result?: {
    hits?: Array<{
      _id?: string;
      _score?: number;
      fields?: Record<string, unknown>;
    }>;
  };
};

export type PineconeSearchContext = {
  rows: Array<{
    chunkId: string;
    title: string;
    documentType: string;
    reportYear: string;
    sourceUrl: string;
    page: number | null;
    content: string;
    score: number;
  }>;
  text: string;
  sourceDetails: Array<{
    label: string;
    title: string;
    documentType: string;
    reportYear: string;
    page: number | null;
    url: string;
  }>;
};

const VECTOR_STORE_ROW_ID = 1;
const DEFAULT_CONTROL_URL = "https://api.pinecone.io";
const DEFAULT_INDEX_NAME = "civil-regulation-assistant";
const DEFAULT_NAMESPACE = "cscec-public";
const PINECONE_API_VERSION = "2025-10";
const EMBEDDING_MODEL = "multilingual-e5-large";
const EMBEDDING_FIELD = "chunk_text";
const UPSERT_BATCH_SIZE = 50;

function runtime(): Required<Pick<VectorEnvironment, "DB">> &
  Omit<VectorEnvironment, "DB"> {
  return env as unknown as Required<Pick<VectorEnvironment, "DB">> &
    Omit<VectorEnvironment, "DB">;
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function apiKey(): string {
  const value = runtime().PINECONE_API_KEY?.trim();
  if (!value) throw new Error("PINECONE_API_KEY 尚未配置");
  return value;
}

function controlUrl(): string {
  return (runtime().PINECONE_CONTROL_URL || DEFAULT_CONTROL_URL).replace(
    /\/+$/,
    "",
  );
}

function indexName(): string {
  return runtime().PINECONE_INDEX_NAME?.trim() || DEFAULT_INDEX_NAME;
}

function namespace(): string {
  return runtime().PINECONE_NAMESPACE?.trim() || DEFAULT_NAMESPACE;
}

function indexUrl(host: string): string {
  const normalized = host.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;
}

async function pineconeRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Api-Key": apiKey(),
      "X-Pinecone-Api-Version": PINECONE_API_VERSION,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Pinecone 请求失败（${response.status}）：${body.slice(0, 400)}`,
    );
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function describeIndex(): Promise<PineconeIndex | null> {
  const response = await fetch(
    `${controlUrl()}/indexes/${encodeURIComponent(indexName())}`,
    {
      headers: {
        Accept: "application/json",
        "Api-Key": apiKey(),
        "X-Pinecone-Api-Version": PINECONE_API_VERSION,
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Pinecone 索引查询失败（${response.status}）：${body.slice(0, 400)}`,
    );
  }
  return (await response.json()) as PineconeIndex;
}

async function getStoreRow(): Promise<VectorStoreRow | null> {
  return (
    (await runtime()
      .DB.prepare(`
        SELECT provider, vector_store_id, status, created_at, updated_at, last_error
        FROM rag_vector_store
        WHERE id = ?
      `)
      .bind(VECTOR_STORE_ROW_ID)
      .first<VectorStoreRow>()) ?? null
  );
}

async function setStoreState(
  status: string,
  options: { indexHost?: string; lastError?: string | null } = {},
): Promise<void> {
  const current = await getStoreRow();
  await runtime()
    .DB.prepare(`
      INSERT INTO rag_vector_store (
        id, provider, vector_store_id, status, created_at, updated_at, last_error
      ) VALUES (?, 'pinecone', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = 'pinecone',
        vector_store_id = excluded.vector_store_id,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_error = excluded.last_error
    `)
    .bind(
      VECTOR_STORE_ROW_ID,
      options.indexHost ?? current?.vector_store_id ?? "",
      status,
      current?.created_at ?? now(),
      now(),
      options.lastError ?? null,
    )
    .run();
}

async function resetLegacyProvider(): Promise<void> {
  const current = await getStoreRow();
  if (!current || current.provider === "pinecone") return;
  const timestamp = now();
  await runtime().DB.batch([
    runtime()
      .DB.prepare(`
        UPDATE rag_vector_store
        SET provider = 'pinecone', vector_store_id = '', status = 'creating',
            updated_at = ?, last_error = NULL
        WHERE id = ?
      `)
      .bind(timestamp, VECTOR_STORE_ROW_ID),
    runtime()
      .DB.prepare(`
        UPDATE rag_vector_documents
        SET file_id = NULL, status = 'pending', updated_at = ?, last_error = NULL
      `)
      .bind(timestamp),
  ]);
}

async function syncDocumentRows(): Promise<void> {
  await runtime()
    .DB.prepare(`
      INSERT OR IGNORE INTO rag_vector_documents (
        doc_id, title, source_url, status, updated_at
      )
      SELECT doc_id, MAX(title), MAX(source_url), 'pending', ?
      FROM rag_chunks
      GROUP BY doc_id
    `)
    .bind(now())
    .run();
}

function validateIntegratedIndex(index: PineconeIndex): void {
  if (!index.host) throw new Error("Pinecone 没有返回索引访问地址");
  if (
    index.embed?.model !== EMBEDDING_MODEL ||
    index.embed?.field_map?.text !== EMBEDDING_FIELD
  ) {
    throw new Error(
      `Pinecone 索引 ${indexName()} 的模型或字段映射不正确，请使用 ${EMBEDDING_MODEL} 并把 text 映射到 ${EMBEDDING_FIELD}`,
    );
  }
}

async function ensureIndex(): Promise<PineconeIndex> {
  let index = await describeIndex();
  if (!index) {
    await setStoreState("creating", { indexHost: "", lastError: null });
    index = await pineconeRequest<PineconeIndex>(
      `${controlUrl()}/indexes/create-for-model`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: indexName(),
          cloud: "aws",
          region: "us-east-1",
          embed: {
            model: EMBEDDING_MODEL,
            metric: "cosine",
            field_map: { text: EMBEDDING_FIELD },
            write_parameters: { input_type: "passage", truncate: "END" },
            read_parameters: { input_type: "query", truncate: "END" },
          },
          deletion_protection: "disabled",
          tags: { application: "civil-regulation-assistant" },
        }),
      },
    );
  }
  validateIntegratedIndex(index);
  await setStoreState(index.status?.ready ? "uploading" : "creating", {
    indexHost: index.host,
    lastError: null,
  });
  return index;
}

async function documentChunks(docId: string): Promise<RagChunkRow[]> {
  const result = await runtime()
    .DB.prepare(`
      SELECT
        chunk_id, doc_id, company, stock_code, title, document_type,
        report_year, source_url, page, content
      FROM rag_chunks
      WHERE doc_id = ?
      ORDER BY COALESCE(page, 0), chunk_id
    `)
    .bind(docId)
    .all<RagChunkRow>();
  if (!result.results.length) {
    throw new Error(`文档 ${docId} 没有可导入的文本块`);
  }
  return result.results;
}

function pineconeRecord(row: RagChunkRow): Record<string, unknown> {
  return {
    _id: row.chunk_id,
    [EMBEDDING_FIELD]: row.content,
    doc_id: row.doc_id,
    chunk_id: row.chunk_id,
    company: row.company,
    stock_code: row.stock_code,
    title: row.title,
    document_type: row.document_type,
    report_year: row.report_year,
    source_url: row.source_url,
    ...(row.page ? { page: row.page } : {}),
  };
}

async function uploadDocument(
  host: string,
  document: VectorDocumentRow,
): Promise<void> {
  const chunks = await documentChunks(document.doc_id);
  for (let offset = 0; offset < chunks.length; offset += UPSERT_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + UPSERT_BATCH_SIZE);
    const ndjson = batch
      .map((row) => JSON.stringify(pineconeRecord(row)))
      .join("\n");
    await pineconeRequest(
      `${indexUrl(host)}/records/namespaces/${encodeURIComponent(namespace())}/upsert`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body: ndjson,
      },
    );
  }

  await runtime()
    .DB.prepare(`
      UPDATE rag_vector_documents
      SET file_id = ?, status = 'attached', updated_at = ?, last_error = NULL
      WHERE doc_id = ?
    `)
    .bind(String(chunks.length), now(), document.doc_id)
    .run();
}

async function localCounts(): Promise<{
  documents: number;
  attached: number;
  chunks: number;
}> {
  const [documents, chunks] = await Promise.all([
    runtime()
      .DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'attached' THEN 1 ELSE 0 END) AS attached
        FROM rag_vector_documents
      `)
      .first<{ total: number; attached: number }>(),
    runtime()
      .DB.prepare("SELECT COUNT(*) AS total FROM rag_chunks")
      .first<{ total: number }>(),
  ]);
  return {
    documents: Number(documents?.total ?? 0),
    attached: Number(documents?.attached ?? 0),
    chunks: Number(chunks?.total ?? 0),
  };
}

async function remoteRecordCount(host: string): Promise<number> {
  const response = await fetch(
    `${indexUrl(host)}/namespaces/${encodeURIComponent(namespace())}`,
    {
      headers: {
        Accept: "application/json",
        "Api-Key": apiKey(),
        "X-Pinecone-Api-Version": PINECONE_API_VERSION,
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status === 404) return 0;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Pinecone 命名空间查询失败（${response.status}）：${body.slice(0, 400)}`,
    );
  }
  const data = (await response.json()) as PineconeNamespace;
  return Number(data.record_count ?? 0);
}

async function refreshStoreReadiness(host: string): Promise<void> {
  const counts = await localCounts();
  if (!counts.documents || counts.attached < counts.documents) {
    await setStoreState("uploading", { indexHost: host, lastError: null });
    return;
  }
  const recordCount = await remoteRecordCount(host);
  await setStoreState(recordCount >= counts.chunks ? "ready" : "indexing", {
    indexHost: host,
    lastError: null,
  });
}

export async function vectorStoreStatusData(): Promise<{
  provider: string;
  ready: boolean;
  status: string;
  index_name: string;
  namespace: string;
  document_count: number;
  attached_count: number;
  chunk_count: number;
  last_error: string | null;
}> {
  await ensureDatabase();
  const [store, counts] = await Promise.all([getStoreRow(), localCounts()]);
  const pineconeStore = store?.provider === "pinecone" ? store : null;
  return {
    provider: "Pinecone",
    ready: pineconeStore?.status === "ready",
    status: pineconeStore?.status ?? "not_initialized",
    index_name: indexName(),
    namespace: namespace(),
    document_count: counts.documents,
    attached_count: counts.attached,
    chunk_count: counts.chunks,
    last_error: pineconeStore?.last_error ?? null,
  };
}

export async function searchVectorStore(
  question: string,
  topK = 8,
): Promise<PineconeSearchContext | null> {
  await ensureDatabase();
  const store = await getStoreRow();
  if (
    store?.provider !== "pinecone" ||
    store.status !== "ready" ||
    !store.vector_store_id ||
    !runtime().PINECONE_API_KEY?.trim()
  ) {
    return null;
  }

  const response = await pineconeRequest<PineconeSearchResponse>(
    `${indexUrl(store.vector_store_id)}/records/namespaces/${encodeURIComponent(namespace())}/search`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          inputs: { text: question },
          top_k: Math.max(1, Math.min(topK, 20)),
        },
        fields: [
          "chunk_text",
          "chunk_id",
          "doc_id",
          "title",
          "document_type",
          "report_year",
          "source_url",
          "page",
        ],
      }),
    },
  );

  const rows = (response.result?.hits ?? [])
    .map((hit) => {
      const fields = hit.fields ?? {};
      const pageValue = Number(fields.page);
      return {
        chunkId: String(fields.chunk_id ?? hit._id ?? ""),
        title: String(fields.title ?? "未知资料"),
        documentType: String(fields.document_type ?? "企业公开资料"),
        reportYear: String(fields.report_year ?? ""),
        sourceUrl: String(fields.source_url ?? ""),
        page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : null,
        content: String(fields.chunk_text ?? ""),
        score: Number(hit._score ?? 0),
      };
    })
    .filter((row) => row.content && row.sourceUrl);

  const sourceDetails = rows.map((row) => ({
    label: `《${row.title}》${row.page ? ` · 第${row.page}页` : ""}`,
    title: row.title,
    documentType: row.documentType,
    reportYear: row.reportYear,
    page: row.page,
    url: row.sourceUrl,
  }));

  return {
    rows,
    sourceDetails,
    text: rows
      .map((row, index) =>
        [
          `[Pinecone语义检索${index + 1}｜${sourceDetails[index].label}]`,
          `相似度：${row.score.toFixed(4)}`,
          `文档类型：${row.documentType}`,
          `位置：${row.page ? `第${row.page}页` : "官网网页"}`,
          `官方来源：${row.sourceUrl}`,
          row.content,
        ].join("\n"),
      )
      .join("\n\n"),
  };
}

export async function initializeVectorStoreStep(): Promise<Response> {
  try {
    await ensureDatabase();
    if (!runtime().PINECONE_API_KEY?.trim()) {
      return errorResponse(
        "Pinecone API 密钥尚未配置",
        503,
        "VECTOR_STORE_NOT_CONFIGURED",
      );
    }

    await syncDocumentRows();
    await resetLegacyProvider();
    const index = await ensureIndex();
    if (!index.host || !index.status?.ready) {
      return successResponse(
        await vectorStoreStatusData(),
        "Pinecone 索引正在创建",
        202,
      );
    }

    const pending = await runtime()
      .DB.prepare(`
        SELECT doc_id, title, source_url, file_id, status, updated_at, last_error
        FROM rag_vector_documents
        WHERE status != 'attached'
        ORDER BY doc_id
        LIMIT 1
      `)
      .first<VectorDocumentRow>();

    if (pending) {
      try {
        await uploadDocument(index.host, pending);
      } catch (error) {
        await runtime()
          .DB.prepare(`
            UPDATE rag_vector_documents
            SET last_error = ?, updated_at = ?
            WHERE doc_id = ?
          `)
          .bind(
            error instanceof Error ? error.message : "文档向量化失败",
            now(),
            pending.doc_id,
          )
          .run();
        throw error;
      }
    }

    await refreshStoreReadiness(index.host);
    const status = await vectorStoreStatusData();
    console.info("Pinecone initialization progress", {
      status: status.status,
      ready: status.ready,
      documents: status.document_count,
      attached: status.attached_count,
      chunks: status.chunk_count,
    });
    return successResponse(
      status,
      status.ready ? "Pinecone 向量数据库已经就绪" : "Pinecone 正在建立语义索引",
      status.ready ? 200 : 202,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Pinecone 初始化失败，请稍后重试";
    console.error(`Pinecone initialization failed: ${message}`);
    try {
      await setStoreState("failed", { lastError: message });
    } catch (stateError) {
      console.error("Failed to persist Pinecone error state", stateError);
    }
    return errorResponse(
      message,
      502,
      "VECTOR_STORE_INITIALIZATION_FAILED",
    );
  }
}

export async function vectorStoreStatusResponse(): Promise<Response> {
  try {
    return successResponse(await vectorStoreStatusData());
  } catch (error) {
    return internalError(error);
  }
}
