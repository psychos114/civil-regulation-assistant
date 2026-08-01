from __future__ import annotations

import re
from typing import Any

from ..database import connect


QUESTION_WORDS = {
    "什么", "哪些", "怎么", "怎样", "如何", "是否", "可以", "请问",
    "一下", "介绍", "相关", "情况", "问题", "回答",
}


def extract_search_terms(question: str) -> list[str]:
    normalized = re.sub(r"[，。！？、；：“”‘’（）《》【】\s]+", " ", question.lower())
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        term = term.strip().lower()
        if len(term) < 2 or term in QUESTION_WORDS or term in seen:
            return
        seen.add(term)
        terms.append(term)

    for token in re.findall(r"[a-z0-9][a-z0-9._/-]{1,}", normalized):
        add(token)
    for segment in re.findall(r"[\u3400-\u9fff]{2,}", normalized):
        if len(segment) <= 8:
            add(segment)
        for size in range(min(4, len(segment)), 1, -2):
            for index in range(0, len(segment) - size + 1):
                add(segment[index : index + size])
    return sorted(terms, key=len, reverse=True)[:12]


def _source_detail(row: dict[str, Any]) -> dict[str, Any]:
    page = row.get("page")
    return {
        "label": f"《{row['title']}》" + (f" · 第{page}页" if page else ""),
        "title": row["title"],
        "documentType": row.get("document_type", ""),
        "reportYear": row.get("report_year", ""),
        "page": page,
        "url": row["source_url"],
    }


def retrieve_keyword_context(question: str, limit: int = 6) -> dict[str, Any]:
    terms = extract_search_terms(question)
    if not terms:
        return {"rows": [], "text": "", "sourceDetails": []}

    where = " OR ".join("(title LIKE ? OR content LIKE ?)" for _ in terms)
    bindings = [value for term in terms for value in (f"%{term}%", f"%{term}%")]
    with connect() as connection:
        raw_rows = connection.execute(
            f"""
            SELECT chunk_id, doc_id, company, stock_code, title, document_type,
                   report_year, source_url, file_format, page, content
            FROM rag_chunks
            WHERE {where}
            LIMIT 30
            """,
            bindings,
        ).fetchall()

    scored: list[tuple[float, dict[str, Any]]] = []
    for raw in raw_rows:
        row = dict(raw)
        title = row["title"].lower()
        content = row["content"].lower()
        score = 0.0
        for term in terms:
            if term in title:
                score += 12 + len(term)
            if term in content:
                score += 2 + len(term) / 2
        scored.append((score, row))
    rows = [row for _, row in sorted(scored, key=lambda item: item[0], reverse=True)]
    rows = rows[: max(1, min(limit, 10))]
    details = [_source_detail(row) for row in rows]
    text = "\n\n".join(
        "\n".join(
            [
                f"[企业资料{index}｜{details[index - 1]['label']}]",
                f"文档类型：{row['document_type'] or '企业公开资料'}",
                f"位置：{'第' + str(row['page']) + '页' if row.get('page') else '官网网页'}",
                f"官方来源：{row['source_url']}",
                row["content"],
            ]
        )
        for index, row in enumerate(rows, 1)
    )
    return {"rows": rows, "text": text, "sourceDetails": details}


def document_catalog() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT doc_id, MAX(title) AS title,
                   MAX(document_type) AS document_type,
                   MAX(report_year) AS report_year,
                   MAX(source_url) AS source_url
            FROM rag_chunks
            GROUP BY doc_id
            ORDER BY report_year DESC, title ASC
            """
        ).fetchall()
    return [
        {
            "docId": row["doc_id"],
            "title": row["title"],
            "documentType": row["document_type"],
            "reportYear": row["report_year"],
            "url": row["source_url"],
        }
        for row in rows
    ]


def resolve_source_details(
    sources: list[str], catalog: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    def normalize(value: str) -> str:
        return re.sub(r"[《》\s·•]", "", value).lower()

    details: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in sources[:8]:
        normalized = normalize(source)
        document = next(
            (item for item in catalog if normalize(item["title"]) in normalized),
            None,
        )
        if not document:
            continue
        page_match = re.search(r"第\s*(\d+)\s*页", source)
        page = int(page_match.group(1)) if page_match else None
        key = f"{document['docId']}:{page or 'web'}"
        if key in seen:
            continue
        seen.add(key)
        details.append(
            {
                "label": f"《{document['title']}》" + (f" · 第{page}页" if page else ""),
                "title": document["title"],
                "documentType": document["documentType"],
                "reportYear": document["reportYear"],
                "page": page,
                "url": document["url"],
            }
        )
    return details


def local_rag_status() -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT COUNT(*) AS chunk_count,
                   COUNT(DISTINCT doc_id) AS document_count,
                   MAX(company) AS company
            FROM rag_chunks
            """
        ).fetchone()
    return {
        "chunk_count": int(row["chunk_count"] or 0),
        "document_count": int(row["document_count"] or 0),
        "company": row["company"],
    }
