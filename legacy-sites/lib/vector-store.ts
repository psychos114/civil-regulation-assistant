import {
  errorResponse,
  successResponse,
} from "@/lib/regulations";

export type FaissCompatibilityStatus = {
  provider: "FAISS";
  ready: false;
  status: "requires_fastapi_runtime";
  index_type: "IndexFlatIP";
  indexed_count: 0;
  reason: string;
};

const REASON =
  "FAISS 是 Python 原生向量库，不能在当前 Cloudflare Workers 运行时中加载；请连接或部署 FastAPI 后端。";

export async function vectorStoreStatusData(): Promise<FaissCompatibilityStatus> {
  return {
    provider: "FAISS",
    ready: false,
    status: "requires_fastapi_runtime",
    index_type: "IndexFlatIP",
    indexed_count: 0,
    reason: REASON,
  };
}

export async function initializeVectorStoreStep(): Promise<Response> {
  return errorResponse(REASON, 503, "FAISS_RUNTIME_UNAVAILABLE");
}

export async function vectorStoreStatusResponse(): Promise<Response> {
  return successResponse(await vectorStoreStatusData());
}
