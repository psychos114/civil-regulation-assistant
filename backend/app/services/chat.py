from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from typing import Any

import httpx

from ..config import settings
from ..database import connect, transaction, utc_now
from ..responses import APIError
from ..schemas import ChatMessage
from . import pinecone, rag


def enforce_rate_limit(client_ip: str) -> None:
    hour = datetime.now(UTC).strftime("%Y-%m-%dT%H")
    client_hash = hashlib.sha256(client_ip.encode("utf-8")).hexdigest()
    bucket = f"{hour}:{client_hash}"
    with transaction() as connection:
        row = connection.execute(
            """
            INSERT INTO chat_rate_limits (bucket, count, updated_at)
            VALUES (?, 1, ?)
            ON CONFLICT(bucket) DO UPDATE SET
                count = count + 1,
                updated_at = excluded.updated_at
            RETURNING count
            """,
            (bucket, utc_now()),
        ).fetchone()
    if int(row["count"]) > settings.chat_requests_per_hour:
        raise APIError(
            "本小时提问次数已用完，请稍后再试",
            429,
            "CHAT_RATE_LIMITED",
        )


def _regulation_context() -> tuple[list[dict[str, Any]], str]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT title, code, content, version
            FROM regulations
            ORDER BY is_new DESC, release_date DESC, id DESC
            LIMIT 20
            """
        ).fetchall()
    items = [dict(row) for row in rows]
    text = "\n\n".join(
        f"[{item['code']}《{item['title']}》· {item['version']}]\n{item['content']}"
        for item in items
    )
    return items, text


def _validated_answer(value: Any, known_sources: set[str]) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    if not isinstance(value.get("plainAnswer"), str):
        return None
    if not isinstance(value.get("sourceAnswer"), str):
        return None
    if not isinstance(value.get("sources"), list):
        return None
    sources = []
    for source in value["sources"]:
        if not isinstance(source, str) or not source.strip():
            continue
        source = source.strip()
        if any(known in source or source in known for known in known_sources):
            sources.append(source)
    return {
        "plainAnswer": value["plainAnswer"].strip(),
        "sourceAnswer": value["sourceAnswer"].strip(),
        "sources": sources[:8],
    }


def parse_model_answer(content: str, known_sources: set[str]) -> dict[str, Any]:
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", content.strip(), flags=re.I)
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    candidates = [cleaned]
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        candidates.append(cleaned[first_brace : last_brace + 1])
    for candidate in dict.fromkeys(candidates):
        try:
            parsed = _validated_answer(json.loads(candidate), known_sources)
            if parsed:
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return {
        "plainAnswer": cleaned or "模型本次没有返回可显示的正文，请重新提问。",
        "sourceAnswer": "本次回答已使用检索到的知识库资料；请结合下方官方来源核验具体数据、页码和适用范围。",
        "sources": [],
    }


def _system_prompt(
    enterprise_context: str,
    regulation_context: str,
    vector_enabled: bool,
) -> str:
    source_name = (
        "下方 Pinecone 语义检索返回的企业资料"
        if vector_enabled
        else "下方“问题相关企业资料”"
    )
    return f"""你是“土木工程智能规范助手”，面向施工、监理、设计和项目管理人员提供中文法规与企业公开资料查询帮助。

必须遵守以下规则：
1. 优先依据{source_name}和“法规知识库摘要”回答，不能利用未提供的记忆补充事实。
2. 企业年报、ESG 报告和官网页面属于企业公开资料，不得称为法规或规范。
3. 不得虚构条款号、页码、强制性条文、处罚金额、财务数据或技术参数。
4. 资料不足时，明确写“现有知识库中没有找到足够依据”，并说明还需要核对什么资料。
5. sources 只能填写参考资料中真实存在的法规编号、名称或《文档名称》· 第N页标签。
6. 涉及具体数字时，sourceAnswer 必须说明文档名称和页码；涉及网页资料时说明官网来源。
7. 对涉及人身安全、结构安全、消防、法律责任的事项，提醒用户由具备资质的专业人员复核，并以正式文本为准。
8. plainAnswer 使用易懂、可执行的语言；sourceAnswer 说明依据和核验边界。
9. 优先输出以下 JSON 对象；如果模型无法输出 JSON，也可以直接返回中文正文：
{{"plainAnswer":"面向用户的中文回答","sourceAnswer":"依据和核验边界","sources":["实际使用的资料名称或页码标签"]}}

问题相关企业资料：
{enterprise_context}

法规知识库摘要：
{regulation_context}"""


async def answer_question(
    question: str,
    history: list[ChatMessage],
    client_ip: str,
) -> dict[str, Any]:
    enforce_rate_limit(client_ip)
    if not settings.stepfun_api_key:
        raise APIError(
            "大模型服务尚未配置，请在 backend/.env 中填写 STEPFUN_API_KEY",
            503,
            "MODEL_NOT_CONFIGURED",
        )

    regulation_rows, regulation_text = _regulation_context()
    keyword_context = rag.retrieve_keyword_context(question)
    catalog = rag.document_catalog()
    vector_context: dict[str, Any] | None = None
    try:
        vector_context = await pinecone.search(question)
    except APIError:
        vector_context = None

    vector_matches = len((vector_context or {}).get("rows", []))
    retrieval_mode = "vector" if vector_matches else "keyword_fallback"
    selected_context = vector_context if vector_matches else keyword_context
    selected_context = selected_context or {"rows": [], "text": "", "sourceDetails": []}

    known_sources = {
        source
        for item in regulation_rows
        for source in (item["code"], item["title"], f"{item['code']} {item['title']}")
    }
    for detail in selected_context["sourceDetails"]:
        known_sources.update([detail["label"], detail["title"]])
    known_sources.update(item["title"] for item in catalog)

    prompt = _system_prompt(
        selected_context["text"] or "本次问题未检索到相关企业资料。",
        regulation_text,
        retrieval_mode == "vector",
    )
    messages = [
        {"role": "system", "content": prompt},
        *[message.model_dump() for message in history[-8:]],
        {"role": "user", "content": question},
    ]
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{settings.stepfun_base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.stepfun_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.stepfun_model,
                    "messages": messages,
                    "temperature": 0.2,
                    "max_tokens": 1600,
                    "stream": False,
                },
            )
    except httpx.TimeoutException as error:
        raise APIError(
            "大模型服务连接超时，请稍后重试", 504, "MODEL_TIMEOUT"
        ) from error
    except httpx.HTTPError as error:
        raise APIError(
            "无法连接大模型服务，请稍后重试", 502, "MODEL_UPSTREAM_ERROR"
        ) from error

    if response.status_code in (401, 403):
        raise APIError(
            "大模型 API 密钥无效或已失效",
            502,
            "MODEL_AUTH_ERROR",
        )
    if response.status_code == 429:
        raise APIError(
            "大模型服务当前额度不足或请求过多，请稍后重试",
            503,
            "MODEL_QUOTA_ERROR",
        )
    if response.is_error:
        raise APIError(
            "大模型暂时无法回答，请稍后重试",
            502,
            "MODEL_UPSTREAM_ERROR",
        )
    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise APIError(
            "大模型返回了无法识别的数据",
            502,
            "MODEL_RESPONSE_ERROR",
        ) from error
    if not content:
        raise APIError(
            "大模型没有返回回答，请重新提问",
            502,
            "MODEL_EMPTY_RESPONSE",
        )

    answer = parse_model_answer(str(content), known_sources)
    vector_details = (
        rag.resolve_source_details(answer["sources"], catalog)
        if retrieval_mode == "vector"
        else []
    )
    cited_details = [
        detail
        for detail in selected_context["sourceDetails"]
        if any(
            detail["title"].replace(" ", "") in source.replace(" ", "")
            for source in answer["sources"]
        )
    ]
    answer["sourceDetails"] = (
        vector_details
        or cited_details
        or selected_context["sourceDetails"][:3]
    )
    answer["retrieval"] = {
        "mode": retrieval_mode,
        "vector_database": "Pinecone",
        "rag_matches": len(selected_context["rows"]),
        "regulation_matches": len(regulation_rows),
    }
    answer["model"] = settings.stepfun_model
    return answer
