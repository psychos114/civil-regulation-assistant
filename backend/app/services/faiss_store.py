from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
import re
import threading
from pathlib import Path
from typing import Any

import faiss
import numpy as np

from ..config import settings
from ..database import connect, transaction, utc_now
from ..responses import APIError


VECTORIZER_NAME = "character-ngram-hash-v1"
_index_lock = threading.RLock()
_loaded_index: faiss.Index | None = None
_loaded_metadata: list[dict[str, Any]] = []
_loaded_signature: tuple[int, int] | None = None


def _store_row() -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM rag_vector_store WHERE id = 1"
        ).fetchone()
    return dict(row) if row else None


def _set_state(status: str, last_error: str | None = None) -> None:
    current = _store_row()
    timestamp = utc_now()
    with transaction() as connection:
        connection.execute(
            """
            INSERT INTO rag_vector_store (
                id, provider, vector_store_id, status,
                created_at, updated_at, last_error
            ) VALUES (1, 'faiss', ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                provider = 'faiss',
                vector_store_id = excluded.vector_store_id,
                status = excluded.status,
                updated_at = excluded.updated_at,
                last_error = excluded.last_error
            """,
            (
                str(settings.faiss_index_path),
                status,
                (current or {}).get("created_at", timestamp),
                timestamp,
                last_error,
            ),
        )


def _sync_document_rows(status: str) -> None:
    with transaction() as connection:
        connection.execute(
            """
            INSERT OR IGNORE INTO rag_vector_documents (
                doc_id, title, source_url, status, updated_at
            )
            SELECT doc_id, MAX(title), MAX(source_url), ?, ?
            FROM rag_chunks
            GROUP BY doc_id
            """,
            (status, utc_now()),
        )
        connection.execute(
            """
            UPDATE rag_vector_documents
            SET status = ?, updated_at = ?, last_error = NULL
            """,
            (status, utc_now()),
        )


def _source_rows() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT chunk_id, doc_id, company, stock_code, title,
                   document_type, report_year, source_url, page, content
            FROM rag_chunks
            ORDER BY doc_id, COALESCE(page, 0), chunk_id
            """
        ).fetchall()
    return [dict(row) for row in rows]


def _normalized_text(text: str) -> str:
    return re.sub(r"[^0-9a-z\u3400-\u9fff]+", "", text.lower())


def _text_vector(text: str) -> np.ndarray:
    """Create a deterministic dense vector for FAISS without a model download.

    Chinese character n-grams preserve useful terminology overlap for this
    small, domain-specific corpus. The vectorizer version is recorded in the
    metadata so an incompatible configuration forces an index rebuild.
    """

    normalized = _normalized_text(text)
    vector = np.zeros(settings.faiss_dimension, dtype="float32")
    if not normalized:
        return vector

    weights = {1: 0.25, 2: 0.8, 3: 1.0}
    for width, weight in weights.items():
        if len(normalized) < width:
            continue
        for offset in range(len(normalized) - width + 1):
            token = normalized[offset : offset + width].encode("utf-8")
            digest = hashlib.blake2b(token, digest_size=8).digest()
            raw = int.from_bytes(digest, "little", signed=False)
            index = raw % settings.faiss_dimension
            sign = 1.0 if (raw >> 63) == 0 else -1.0
            vector[index] += sign * weight

    norm = float(np.linalg.norm(vector))
    if norm > 0:
        vector /= norm
    return vector


def _metadata_signature() -> tuple[int, int] | None:
    try:
        return (
            settings.faiss_index_path.stat().st_mtime_ns,
            settings.faiss_metadata_path.stat().st_mtime_ns,
        )
    except FileNotFoundError:
        return None


def _load_index() -> tuple[faiss.Index, list[dict[str, Any]]] | None:
    global _loaded_index, _loaded_metadata, _loaded_signature

    signature = _metadata_signature()
    if signature is None:
        return None
    with _index_lock:
        if _loaded_index is not None and _loaded_signature == signature:
            return _loaded_index, _loaded_metadata

        try:
            metadata_document = json.loads(
                settings.faiss_metadata_path.read_text(encoding="utf-8")
            )
            if metadata_document.get("dimension") != settings.faiss_dimension:
                return None
            if metadata_document.get("vectorizer") != VECTORIZER_NAME:
                return None
            metadata = metadata_document.get("items")
            if not isinstance(metadata, list):
                return None
            index = faiss.read_index(str(settings.faiss_index_path))
            if index.d != settings.faiss_dimension or index.ntotal != len(metadata):
                return None
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return None

        _loaded_index = index
        _loaded_metadata = metadata
        _loaded_signature = signature
        return index, metadata


def _build_index_sync() -> dict[str, Any]:
    global _loaded_index, _loaded_metadata, _loaded_signature

    rows = _source_rows()
    if not rows:
        raise APIError(
            "知识库中没有可建立索引的文本块",
            500,
            "RAG_DOCUMENT_EMPTY",
        )

    _set_state("building")
    _sync_document_rows("indexing")
    matrix = np.vstack(
        [_text_vector(f"{row['title']}\n{row['content']}") for row in rows]
    ).astype("float32", copy=False)
    index = faiss.IndexFlatIP(settings.faiss_dimension)
    index.add(matrix)

    settings.faiss_index_path.parent.mkdir(parents=True, exist_ok=True)
    settings.faiss_metadata_path.parent.mkdir(parents=True, exist_ok=True)
    index_temp = settings.faiss_index_path.with_suffix(
        settings.faiss_index_path.suffix + ".tmp"
    )
    metadata_temp = settings.faiss_metadata_path.with_suffix(
        settings.faiss_metadata_path.suffix + ".tmp"
    )
    faiss.write_index(index, str(index_temp))
    metadata_temp.write_text(
        json.dumps(
            {
                "provider": "FAISS",
                "vectorizer": VECTORIZER_NAME,
                "dimension": settings.faiss_dimension,
                "created_at": utc_now(),
                "items": rows,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    os.replace(index_temp, settings.faiss_index_path)
    os.replace(metadata_temp, settings.faiss_metadata_path)

    with _index_lock:
        _loaded_index = index
        _loaded_metadata = rows
        _loaded_signature = _metadata_signature()
    _sync_document_rows("attached")
    _set_state("ready")
    return status_data()


async def initialize_step() -> tuple[dict[str, Any], str, int]:
    try:
        data = await asyncio.to_thread(_build_index_sync)
        return data, "FAISS 本地向量索引已建立", 200
    except APIError as error:
        _set_state("failed", error.message)
        raise
    except Exception as error:
        _set_state("failed", str(error))
        raise APIError(
            "FAISS 索引建立失败，请检查数据文件和运行环境",
            500,
            "VECTOR_STORE_INITIALIZATION_FAILED",
        ) from error


def status_data() -> dict[str, Any]:
    store = _store_row()
    loaded = _load_index()
    with connect() as connection:
        document_count = int(
            connection.execute(
                "SELECT COUNT(DISTINCT doc_id) FROM rag_chunks"
            ).fetchone()[0]
        )
        chunk_count = int(
            connection.execute("SELECT COUNT(*) FROM rag_chunks").fetchone()[0]
        )
    indexed_count = int(loaded[0].ntotal) if loaded else 0
    ready = bool(loaded and indexed_count == chunk_count and chunk_count > 0)
    return {
        "provider": "FAISS",
        "ready": ready,
        "status": "ready" if ready else (store or {}).get("status", "not_initialized"),
        "index_type": "IndexFlatIP",
        "vectorizer": VECTORIZER_NAME,
        "dimension": settings.faiss_dimension,
        "document_count": document_count,
        "attached_count": document_count if ready else 0,
        "chunk_count": chunk_count,
        "indexed_count": indexed_count,
        "index_file": settings.faiss_index_path.name,
        "last_error": (store or {}).get("last_error"),
    }


def _search_sync(question: str, top_k: int) -> dict[str, Any] | None:
    loaded = _load_index()
    if loaded is None:
        return None
    index, metadata = loaded
    query = _text_vector(question).reshape(1, -1)
    limit = max(1, min(top_k, 20, len(metadata)))
    scores, positions = index.search(query, limit)

    rows: list[dict[str, Any]] = []
    for score, position in zip(scores[0], positions[0], strict=True):
        if position < 0 or not math.isfinite(float(score)):
            continue
        if float(score) < settings.faiss_min_score:
            continue
        item = metadata[int(position)]
        page = item.get("page")
        page = int(page) if str(page).isdigit() and int(page) > 0 else None
        rows.append(
            {
                "chunkId": str(item.get("chunk_id", "")),
                "title": str(item.get("title") or "未知资料"),
                "documentType": str(item.get("document_type") or "企业公开资料"),
                "reportYear": str(item.get("report_year") or ""),
                "sourceUrl": str(item.get("source_url") or ""),
                "page": page,
                "content": str(item.get("content") or ""),
                "score": float(score),
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
                f"[FAISS 本地向量检索{index_number}｜{details[index_number - 1]['label']}]",
                f"相似度：{row['score']:.4f}",
                f"文档类型：{row['documentType']}",
                f"位置：{'第' + str(row['page']) + '页' if row['page'] else '官网网页'}",
                f"官方来源：{row['sourceUrl']}",
                row["content"],
            ]
        )
        for index_number, row in enumerate(rows, 1)
    )
    return {"rows": rows, "sourceDetails": details, "text": text}


async def search(question: str, top_k: int = 8) -> dict[str, Any] | None:
    return await asyncio.to_thread(_search_sync, question, top_k)
