from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

import httpx

from ..config import settings
from ..database import connect, transaction, utc_now
from ..responses import APIError


API_VERSION = "2025-10"
EMBEDDING_MODEL = "multilingual-e5-large"
EMBEDDING_FIELD = "chunk_text"
UPSERT_BATCH_SIZE = 50


def _headers(content_type: str | None = None) -> dict[str, str]:
    if not settings.pinecone_api_key:
        raise APIError(
            "Pinecone API 密钥尚未配置",
            503,
            "VECTOR_STORE_NOT_CONFIGURED",
        )
    headers = {
        "Accept": "application/json",
        "Api-Key": settings.pinecone_api_key,
        "X-Pinecone-Api-Version": API_VERSION,
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


async def _request(
    method: str,
    url: str,
    *,
    json_body: dict[str, Any] | None = None,
    content: str | None = None,
    content_type: str | None = None,
    allow_404: bool = False,
) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.request(
            method,
            url,
            headers=_headers(content_type),
            json=json_body,
            content=content,
        )
    if allow_404 and response.status_code == 404:
        return None
    if response.is_error:
        raise APIError(
            f"Pinecone 请求失败（{response.status_code}）：{response.text[:400]}",
            502,
            "PINECONE_REQUEST_FAILED",
        )
    return response.json() if response.content else {}


def _index_url(host: str) -> str:
    return host.rstrip("/") if host.startswith("http") else f"https://{host.rstrip('/')}"


def _store_row() -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM rag_vector_store WHERE id = 1"
        ).fetchone()
    return dict(row) if row else None


def _set_state(
    status: str, index_host: str | None = None, last_error: str | None = None
) -> None:
    current = _store_row()
    timestamp = utc_now()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO rag_vector_store (
                id, provider, vector_store_id, status,
                created_at, updated_at, last_error
            ) VALUES (1, 'pinecone', ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                provider = 'pinecone',
                vector_store_id = excluded.vector_store_id,
                status = excluded.status,
                updated_at = excluded.updated_at,
                last_error = excluded.last_error
            """,
            (
                index_host if index_host is not None else (current or {}).get("vector_store_id", ""),
                status,
                (current or {}).get("created_at", timestamp),
                timestamp,
                last_error,
            ),
        )


def _sync_document_rows() -> None:
    with transaction() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO rag_vector_documents (
                doc_id, title, source_url, status, updated_at
            )
            SELECT doc_id, MAX(title), MAX(source_url), 'pending', ?
            FROM rag_chunks
            GROUP BY doc_id
            """,
            (utc_now(),),
        )


def status_data() -> dict[str, Any]:
    store = _store_row()
    with connect() as connection:
        documents = connection.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status = 'attached' THEN 1 ELSE 0 END) AS attached
            FROM rag_vector_documents
            """
        ).fetchone()
        chunks = connection.execute("SELECT COUNT(*) AS total FROM rag_chunks").fetchone()
    return {
        "provider": "Pinecone",
        "ready": bool(store and store["status"] == "ready"),
        "status": store["status"] if store else "not_initialized",
        "index_name": settings.pinecone_index_name,
        "namespace": settings.pinecone_namespace,
        "document_count": int(documents["total"] or 0),
        "attached_count": int(documents["attached"] or 0),
        "chunk_count": int(chunks["total"] or 0),
        "last_error": store["last_error"] if store else None,
    }


async def _describe_index() -> dict[str, Any] | None:
    return await _request(
        "GET",
        f"{settings.pinecone_control_url}/indexes/{quote(settings.pinecone_index_name)}",
        allow_404=True,
    )


async def _ensure_index() -> dict[str, Any]:
    index = await _describe_index()
    if index is None:
        _set_state("creating", "")
        index = await _request(
            "POST",
            f"{settings.pinecone_control_url}/indexes/create-for-model",
            json_body={
                "name": settings.pinecone_index_name,
                "cloud": "aws",
                "region": "us-east-1",
                "embed": {
                    "model": EMBEDDING_MODEL,
                    "metric": "cosine",
                    "field_map": {"text": EMBEDDING_FIELD},
                    "write_parameters": {"input_type": "passage", "truncate": "END"},
                    "read_parameters": {"input_type": "query", "truncate": "END"},
                },
                "deletion_protection": "disabled",
                "tags": {"application": "civil-regulation-assistant"},
            },
        )
    assert index is not None
    host = str(index.get("host", ""))
    if not host:
        raise APIError("Pinecone 没有返回索引地址", 502, "PINECONE_INDEX_INVALID")
    embed = index.get("embed") or {}
    if embed.get("model") != EMBEDDING_MODEL or (embed.get("field_map") or {}).get("text") != EMBEDDING_FIELD:
        raise APIError(
            f"Pinecone 索引配置不匹配，应使用 {EMBEDDING_MODEL}",
            502,
            "PINECONE_INDEX_INVALID",
        )
    ready = bool((index.get("status") or {}).get("ready"))
    _set_state("uploading" if ready else "creating", host)
    return index


def _document_chunks(doc_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT chunk_id, doc_id, company, stock_code, title, document_type,
                   report_year, source_url, page, content
            FROM rag_chunks WHERE doc_id = ?
            ORDER BY COALESCE(page, 0), chunk_id
            """,
            (doc_id,),
        ).fetchall()
    return [dict(row) for row in rows]


async def _upload_document(host: str, document: dict[str, Any]) -> None:
    chunks = _document_chunks(document["doc_id"])
    if not chunks:
        raise APIError(
            f"文档 {document['doc_id']} 没有可导入文本块",
            500,
            "RAG_DOCUMENT_EMPTY",
        )
    for offset in range(0, len(chunks), UPSERT_BATCH_SIZE):
        records = []
        for row in chunks[offset : offset + UPSERT_BATCH_SIZE]:
            records.append(
                {
                    "_id": row["chunk_id"],
                    EMBEDDING_FIELD: row["content"],
                    **{key: row[key] for key in (
                        "doc_id", "chunk_id", "company", "stock_code", "title",
                        "document_type", "report_year", "source_url"
                    )},
                    **({"page": row["page"]} if row.get("page") else {}),
                }
            )
        ndjson = "\n".join(json.dumps(record, ensure_ascii=False) for record in records)
        await _request(
            "POST",
            f"{_index_url(host)}/records/namespaces/{quote(settings.pinecone_namespace)}/upsert",
            content=ndjson,
            content_type="application/x-ndjson",
        )
    with transaction() as connection:
        connection.execute(
            """
            UPDATE rag_vector_documents
            SET file_id = ?, status = 'attached', updated_at = ?, last_error = NULL
            WHERE doc_id = ?
            """,
            (str(len(chunks)), utc_now(), document["doc_id"]),
        )


async def initialize_step() -> tuple[dict[str, Any], str, int]:
    if not settings.pinecone_api_key:
        raise APIError(
            "Pinecone API 密钥尚未配置",
            503,
            "VECTOR_STORE_NOT_CONFIGURED",
        )
    try:
        _sync_document_rows()
        index = await _ensure_index()
        host = str(index["host"])
        if not (index.get("status") or {}).get("ready"):
            return status_data(), "Pinecone 索引正在创建", 202
        with connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM rag_vector_documents
                WHERE status != 'attached' ORDER BY doc_id LIMIT 1
                """
            ).fetchone()
        if row:
            await _upload_document(host, dict(row))

        current = status_data()
        if current["document_count"] and current["attached_count"] >= current["document_count"]:
            remote = await _request(
                "GET",
                f"{_index_url(host)}/namespaces/{quote(settings.pinecone_namespace)}",
                allow_404=True,
            )
            remote_count = int((remote or {}).get("record_count", 0))
            _set_state("ready" if remote_count >= current["chunk_count"] else "indexing", host)
        else:
            _set_state("uploading", host)
        current = status_data()
        return (
            current,
            "Pinecone 向量数据库已经就绪" if current["ready"] else "Pinecone 正在建立语义索引",
            200 if current["ready"] else 202,
        )
    except APIError as error:
        _set_state("failed", last_error=error.message)
        raise
    except (httpx.HTTPError, ValueError) as error:
        _set_state("failed", last_error=str(error))
        raise APIError(
            "Pinecone 服务连接失败，请稍后重试",
            502,
            "VECTOR_STORE_INITIALIZATION_FAILED",
        ) from error


async def search(question: str, top_k: int = 8) -> dict[str, Any] | None:
    store = _store_row()
    if not (
        store
        and store["status"] == "ready"
        and store["vector_store_id"]
        and settings.pinecone_api_key
    ):
        return None
    response = await _request(
        "POST",
        f"{_index_url(store['vector_store_id'])}/records/namespaces/{quote(settings.pinecone_namespace)}/search",
        json_body={
            "query": {
                "inputs": {"text": question},
                "top_k": max(1, min(top_k, 20)),
            },
            "fields": [
                "chunk_text", "chunk_id", "doc_id", "title", "document_type",
                "report_year", "source_url", "page",
            ],
        },
    )
    hits = ((response or {}).get("result") or {}).get("hits") or []
    rows: list[dict[str, Any]] = []
    for hit in hits:
        fields = hit.get("fields") or {}
        if not fields.get("chunk_text") or not fields.get("source_url"):
            continue
        page = fields.get("page")
        page = int(page) if str(page).isdigit() and int(page) > 0 else None
        rows.append(
            {
                "chunkId": str(fields.get("chunk_id") or hit.get("_id") or ""),
                "title": str(fields.get("title") or "未知资料"),
                "documentType": str(fields.get("document_type") or "企业公开资料"),
                "reportYear": str(fields.get("report_year") or ""),
                "sourceUrl": str(fields.get("source_url") or ""),
                "page": page,
                "content": str(fields.get("chunk_text") or ""),
                "score": float(hit.get("_score") or 0),
            }
        )
    details = [
        {
            "label": f"《{row['title']}》" + (f" · 第{row['page']}页" if row["page"] else ""),
            "title": row["title"],
            "documentType": row["documentType"],
            "reportYear": row["reportYear"],
            "page": row["page"],
            "url": row["sourceUrl"],
        }
        for row in rows
    ]
    text = "\n\n".join(
        "\n".join(
            [
                f"[Pinecone语义检索{index}｜{details[index - 1]['label']}]",
                f"相似度：{row['score']:.4f}",
                f"文档类型：{row['documentType']}",
                f"位置：{'第' + str(row['page']) + '页' if row['page'] else '官网网页'}",
                f"官方来源：{row['sourceUrl']}",
                row["content"],
            ]
        )
        for index, row in enumerate(rows, 1)
    )
    return {"rows": rows, "sourceDetails": details, "text": text}
