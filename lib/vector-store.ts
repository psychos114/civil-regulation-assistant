import { env } from "cloudflare:workers";
import {
  ensureDatabase,
  errorResponse,
  internalError,
  successResponse,
} from "@/lib/regulations";

type VectorEnvironment = {
  DB?: D1Database;
  STEPFUN_API_KEY?: string;
  STEPFUN_VECTOR_BASE_URL?: string;
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
  company: string;
  stock_code: string;
  title: string;
  document_type: string;
  report_year: string;
  source_url: string;
  page: number | null;
  content: string;
};

type StepFunFile = {
  id?: string;
  status?: string;
};

type StepFunVectorStore = {
  id?: string;
  name?: string;
  file_counts?: {
    in_progress?: number;
    completed?: number;
    failed?: number;
    cancelled?: number;
    total?: number;
  };
};

const VECTOR_STORE_ROW_ID = 1;
const DEFAULT_VECTOR_BASE_URL = "https://api.stepfun.com/v1";

function runtime(): Required<Pick<VectorEnvironment, "DB">> &
  Omit<VectorEnvironment, "DB"> {
  return env as unknown as Required<Pick<VectorEnvironment, "DB">> &
    Omit<VectorEnvironment, "DB">;
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function vectorBaseUrl(): string {
  return (
    runtime().STEPFUN_VECTOR_BASE_URL || DEFAULT_VECTOR_BASE_URL
  ).replace(/\/+$/, "");
}

function apiKey(): string {
  const value = runtime().STEPFUN_API_KEY?.trim();
  if (!value) {
    throw new Error("STEPFUN_API_KEY 尚未配置");
  }
  return value;
}

async function stepFunRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${vectorBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `StepFun Vector Store 请求失败（${response.status}）：${text.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
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
  options: { vectorStoreId?: string; lastError?: string | null } = {},
): Promise<void> {
  const current = await getStoreRow();
  await runtime()
    .DB.prepare(`
      INSERT INTO rag_vector_store (
        id, provider, vector_store_id, status, created_at, updated_at, last_error
      ) VALUES (?, 'stepfun', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vector_store_id = excluded.vector_store_id,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_error = excluded.last_error
    `)
    .bind(
      VECTOR_STORE_ROW_ID,
      options.vectorStoreId ?? current?.vector_store_id ?? "",
      status,
      current?.created_at ?? now(),
      now(),
      options.lastError ?? null,
    )
    .run();
}

async function syncDocumentRows(): Promise<void> {
  const timestamp = now();
  await runtime()
    .DB.prepare(`
      INSERT OR IGNORE INTO rag_vector_documents (
        doc_id, title, source_url, status, updated_at
      )
      SELECT doc_id, MAX(title), MAX(source_url), 'pending', ?
      FROM rag_chunks
      GROUP BY doc_id
    `)
    .bind(timestamp)
    .run();
}

async function createVectorStore(): Promise<VectorStoreRow> {
  await setStoreState("creating");
  try {
    const created = await stepFunRequest<StepFunVectorStore>("/vector_stores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `civil_regulations_${Date.now()}`,
        type: "text",
      }),
    });
    if (!created.id) {
      throw new Error("StepFun 未返回 Vector Store ID");
    }
    await setStoreState("uploading", {
      vectorStoreId: created.id,
      lastError: null,
    });
    const stored = await getStoreRow();
    if (!stored) throw new Error("向量数据库状态保存失败");
    return stored;
  } catch (error) {
    await setStoreState("failed", {
      lastError: error instanceof Error ? error.message : "创建向量数据库失败",
    });
    throw error;
  }
}

async function documentMarkdown(docId: string): Promise<{
  filename: string;
  markdown: string;
}> {
  const result = await runtime()
    .DB.prepare(`
      SELECT
        chunk_id, company, stock_code, title, document_type,
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

  const first = result.results[0];
  const sections = result.results.map((row) => {
    const location = row.page ? `第${row.page}页` : "官网网页";
    return [
      `## ${location}`,
      `资料标签：《${row.title}》${row.page ? ` · 第${row.page}页` : ""}`,
      `文档编号：${docId}`,
      `文本块编号：${row.chunk_id}`,
      `官方来源：${row.source_url}`,
      "",
      row.content,
    ].join("\n");
  });

  return {
    filename: `${docId.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`,
    markdown: [
      `# ${first.title}`,
      `公司：${first.company}`,
      `股票代码：${first.stock_code || "未注明"}`,
      `文档类型：${first.document_type || "企业公开资料"}`,
      `报告年份：${first.report_year || "未注明"}`,
      `官方来源：${first.source_url}`,
      "",
      ...sections,
    ].join("\n\n"),
  };
}

async function uploadDocument(document: VectorDocumentRow): Promise<void> {
  const { filename, markdown } = await documentMarkdown(document.doc_id);
  const form = new FormData();
  form.set("purpose", "retrieval-text");
  form.set(
    "file",
    new File([markdown], filename, { type: "text/markdown;charset=utf-8" }),
  );

  const uploaded = await stepFunRequest<StepFunFile>("/files", {
    method: "POST",
    body: form,
  });
  if (!uploaded.id) {
    throw new Error(`文档 ${document.title} 上传后没有返回 File ID`);
  }
  await runtime()
    .DB.prepare(`
      UPDATE rag_vector_documents
      SET file_id = ?, status = 'uploaded', updated_at = ?, last_error = NULL
      WHERE doc_id = ?
    `)
    .bind(uploaded.id, now(), document.doc_id)
    .run();
}

async function attachDocument(
  storeId: string,
  document: VectorDocumentRow,
): Promise<boolean> {
  if (!document.file_id) return false;
  const file = await stepFunRequest<StepFunFile>(
    `/files/${encodeURIComponent(document.file_id)}`,
  );
  const status = String(file.status ?? "").toLowerCase();
  if (!["success", "processed"].includes(status)) {
    return false;
  }

  await stepFunRequest(
    `/vector_stores/${encodeURIComponent(storeId)}/files`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        files: [{ file_id: document.file_id }],
      }),
    },
  );
  await runtime()
    .DB.prepare(`
      UPDATE rag_vector_documents
      SET status = 'attached', updated_at = ?, last_error = NULL
      WHERE doc_id = ?
    `)
    .bind(now(), document.doc_id)
    .run();
  return true;
}

async function refreshStoreReadiness(
  store: VectorStoreRow,
): Promise<VectorStoreRow> {
  const localCounts = await runtime()
    .DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'attached' THEN 1 ELSE 0 END) AS attached
      FROM rag_vector_documents
    `)
    .first<{ total: number; attached: number }>();
  const total = Number(localCounts?.total ?? 0);
  const attached = Number(localCounts?.attached ?? 0);
  if (!total || attached < total) {
    await setStoreState("uploading", { vectorStoreId: store.vector_store_id });
    return (await getStoreRow()) ?? store;
  }

  const remote = await stepFunRequest<StepFunVectorStore>(
    `/vector_stores/${encodeURIComponent(store.vector_store_id)}`,
  );
  const counts = remote.file_counts;
  const completed = Number(counts?.completed ?? 0);
  const inProgress = Number(counts?.in_progress ?? 0);
  const failed = Number(counts?.failed ?? 0);
  if (failed > 0) {
    await setStoreState("failed", {
      vectorStoreId: store.vector_store_id,
      lastError: `有 ${failed} 份文档建立向量索引失败`,
    });
  } else if (completed >= total && inProgress === 0) {
    await setStoreState("ready", {
      vectorStoreId: store.vector_store_id,
      lastError: null,
    });
  } else {
    await setStoreState("indexing", {
      vectorStoreId: store.vector_store_id,
      lastError: null,
    });
  }
  return (await getStoreRow()) ?? store;
}

export async function vectorStoreStatusData(): Promise<{
  provider: string;
  ready: boolean;
  status: string;
  document_count: number;
  attached_count: number;
  last_error: string | null;
}> {
  await ensureDatabase();
  const [store, counts] = await Promise.all([
    getStoreRow(),
    runtime()
      .DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'attached' THEN 1 ELSE 0 END) AS attached
        FROM rag_vector_documents
      `)
      .first<{ total: number; attached: number }>(),
  ]);
  return {
    provider: "StepFun Vector Store",
    ready: store?.status === "ready",
    status: store?.status ?? "not_initialized",
    document_count: Number(counts?.total ?? 0),
    attached_count: Number(counts?.attached ?? 0),
    last_error: store?.last_error ?? null,
  };
}

export async function getReadyVectorStore(): Promise<{
  id: string;
  baseUrl: string;
} | null> {
  await ensureDatabase();
  const store = await getStoreRow();
  if (store?.status !== "ready" || !store.vector_store_id) return null;
  return { id: store.vector_store_id, baseUrl: vectorBaseUrl() };
}

export async function initializeVectorStoreStep(): Promise<Response> {
  try {
    await ensureDatabase();
    if (!runtime().STEPFUN_API_KEY?.trim()) {
      return errorResponse(
        "StepFun API 密钥尚未配置",
        503,
        "VECTOR_STORE_NOT_CONFIGURED",
      );
    }

    await syncDocumentRows();
    let store = await getStoreRow();
    if (
      !store ||
      (store.status === "failed" && !store.vector_store_id)
    ) {
      store = await createVectorStore();
    }
    if (!store.vector_store_id) {
      return successResponse(
        await vectorStoreStatusData(),
        "向量数据库正在创建",
        202,
      );
    }

    const pending = await runtime()
      .DB.prepare(`
        SELECT doc_id, title, source_url, file_id, status, updated_at, last_error
        FROM rag_vector_documents
        WHERE status IN ('pending', 'uploaded')
        ORDER BY doc_id
        LIMIT 1
      `)
      .first<VectorDocumentRow>();

    if (pending?.status === "pending") {
      try {
        await uploadDocument(pending);
      } catch (error) {
        await runtime()
          .DB.prepare(`
            UPDATE rag_vector_documents
            SET last_error = ?, updated_at = ?
            WHERE doc_id = ?
          `)
          .bind(
            error instanceof Error ? error.message : "文档上传失败",
            now(),
            pending.doc_id,
          )
          .run();
        throw error;
      }
    } else if (pending?.status === "uploaded") {
      await attachDocument(store.vector_store_id, pending);
    }

    store = await refreshStoreReadiness(store);
    const status = await vectorStoreStatusData();
    return successResponse(
      status,
      status.ready ? "向量数据库已经就绪" : "向量数据库正在建立索引",
      status.ready ? 200 : 202,
    );
  } catch (error) {
    console.error("Vector Store initialization failed", error);
    return errorResponse(
      error instanceof Error
        ? error.message
        : "向量数据库初始化失败，请稍后重试",
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
