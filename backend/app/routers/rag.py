from __future__ import annotations

from fastapi import APIRouter, Response

from ..responses import success
from ..services import pinecone
from ..services.rag import local_rag_status


router = APIRouter(prefix="/api/rag", tags=["RAG"])


@router.get("/status")
def rag_status() -> dict:
    local = local_rag_status()
    vector = pinecone.status_data()
    return success(
        {
            "ready": local["chunk_count"] > 0 and vector["ready"],
            **local,
            "retrieval_mode": "vector" if vector["ready"] else "keyword_fallback",
            "vector_database": vector,
        }
    )


@router.get("/vector-store")
def vector_store_status() -> dict:
    return success(pinecone.status_data())


@router.post("/vector-store")
async def initialize_vector_store(response: Response) -> dict:
    data, message, status_code = await pinecone.initialize_step()
    response.status_code = status_code
    return success(data, message)
