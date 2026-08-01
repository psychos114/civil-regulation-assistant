from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterator

from .config import BASE_DIR, settings


SEED_REGULATIONS_PATH = BASE_DIR / "data" / "seed-regulations.json"
RAG_CHUNKS_PATH = BASE_DIR / "data" / "rag_chunks.jsonl"


class ClosingConnection(sqlite3.Connection):
    """让 `with connect()` 在 Windows 上也会真正释放数据库文件。"""

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
        try:
            return super().__exit__(exc_type, exc, traceback)
        finally:
            self.close()


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def connect() -> sqlite3.Connection:
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(
        settings.database_path,
        timeout=30,
        factory=ClosingConnection,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _seed_regulations(connection: sqlite3.Connection) -> None:
    total = connection.execute("SELECT COUNT(*) FROM regulations").fetchone()[0]
    if total:
        return
    data = json.loads(SEED_REGULATIONS_PATH.read_text(encoding="utf-8"))
    timestamp = utc_now()
    connection.executemany(
        """
        INSERT OR IGNORE INTO regulations (
            title, code, release_date, content, version, is_new,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                item["title"],
                item["code"],
                item["release_date"],
                item["content"],
                item["version"],
                int(item.get("is_new", 0)),
                timestamp,
                timestamp,
            )
            for item in data["regulations"]
        ],
    )


def _seed_rag_chunks(connection: sqlite3.Connection) -> None:
    total = connection.execute("SELECT COUNT(*) FROM rag_chunks").fetchone()[0]
    if total or not RAG_CHUNKS_PATH.exists():
        return
    rows: list[tuple[object, ...]] = []
    with RAG_CHUNKS_PATH.open("r", encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            item = json.loads(line)
            rows.append(
                (
                    item["chunk_id"],
                    item["doc_id"],
                    item.get("company", ""),
                    item.get("stock_code", ""),
                    item["title"],
                    item.get("document_type", ""),
                    str(item.get("report_year", "")),
                    item["source_url"],
                    item.get("file_format", ""),
                    item.get("page"),
                    item["content"],
                )
            )
    connection.executemany(
        """
        INSERT OR IGNORE INTO rag_chunks (
            chunk_id, doc_id, company, stock_code, title, document_type,
            report_year, source_url, file_format, page, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )


def initialize_database() -> None:
    with transaction() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS regulations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                code TEXT NOT NULL UNIQUE,
                release_date TEXT NOT NULL,
                content TEXT NOT NULL,
                version TEXT NOT NULL,
                is_new INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_regulations_code
                ON regulations(code);

            CREATE TABLE IF NOT EXISTS chat_rate_limits (
                bucket TEXT PRIMARY KEY,
                count INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rag_chunks (
                chunk_id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL,
                company TEXT NOT NULL,
                stock_code TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                document_type TEXT NOT NULL DEFAULT '',
                report_year TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL,
                file_format TEXT NOT NULL,
                page INTEGER,
                content TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rag_chunks_doc_id
                ON rag_chunks(doc_id);
            CREATE INDEX IF NOT EXISTS idx_rag_chunks_title
                ON rag_chunks(title);

            CREATE TABLE IF NOT EXISTS rag_vector_store (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                provider TEXT NOT NULL DEFAULT 'pinecone',
                vector_store_id TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'creating',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_error TEXT
            );

            CREATE TABLE IF NOT EXISTS rag_vector_documents (
                doc_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source_url TEXT NOT NULL,
                file_id TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                updated_at TEXT NOT NULL,
                last_error TEXT
            );
            """
        )
        _seed_regulations(connection)
        _seed_rag_chunks(connection)


def database_counts() -> dict[str, int]:
    with connect() as connection:
        regulation_count = connection.execute(
            "SELECT COUNT(*) FROM regulations"
        ).fetchone()[0]
        rag_chunk_count = connection.execute(
            "SELECT COUNT(*) FROM rag_chunks"
        ).fetchone()[0]
        rag_document_count = connection.execute(
            "SELECT COUNT(DISTINCT doc_id) FROM rag_chunks"
        ).fetchone()[0]
    return {
        "regulations": int(regulation_count),
        "rag_chunks": int(rag_chunk_count),
        "rag_documents": int(rag_document_count),
    }
