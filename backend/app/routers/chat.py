from __future__ import annotations

from fastapi import APIRouter, Request

from ..responses import success
from ..schemas import ChatRequest
from ..services.chat import answer_question


router = APIRouter(prefix="/api", tags=["大模型问答"])


@router.post("/chat")
async def chat(payload: ChatRequest, request: Request) -> dict:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    client_ip = forwarded or (request.client.host if request.client else "local")
    data = await answer_question(payload.question, payload.history, client_ip)
    return success(data, "大模型回答成功")
