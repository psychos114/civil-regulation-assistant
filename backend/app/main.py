from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .database import database_counts, initialize_database
from .responses import APIError, error_payload, success
from .routers import chat, rag, regulations


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="法规更新、企业资料 RAG、Pinecone 检索与大模型问答服务。",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins) or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(APIError)
async def handle_api_error(_: Request, error: APIError) -> JSONResponse:
    return JSONResponse(error_payload(error), status_code=error.status_code)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(
    _: Request, error: RequestValidationError
) -> JSONResponse:
    return JSONResponse(
        {
            "success": False,
            "message": "请求参数格式错误",
            "error": {"code": "VALIDATION_ERROR", "details": error.errors()},
        },
        status_code=422,
    )


@app.get("/")
def root() -> dict:
    return success(
        {
            "service": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
            "health": "/api/health",
        }
    )


@app.get("/api/health")
def health() -> dict:
    return success({"status": "ok", **database_counts()})


app.include_router(regulations.router)
app.include_router(rag.router)
app.include_router(chat.router)
