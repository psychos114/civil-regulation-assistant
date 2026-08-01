from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _database_path() -> Path:
    configured = Path(_env("DATABASE_PATH", "regulations.db"))
    return configured.resolve() if configured.is_absolute() else (BASE_DIR / configured).resolve()


@dataclass(frozen=True)
class Settings:
    app_name: str = "土木工程智能规范助手 API"
    app_version: str = "0.2.0"
    database_path: Path = _database_path()
    cors_origins: tuple[str, ...] = tuple(
        item.strip()
        for item in _env("CORS_ORIGINS", "*").split(",")
        if item.strip()
    )
    stepfun_api_key: str = _env("STEPFUN_API_KEY")
    stepfun_base_url: str = _env(
        "STEPFUN_BASE_URL", "https://api.stepfun.com/step_plan/v1"
    ).rstrip("/")
    stepfun_model: str = _env("STEPFUN_MODEL", "step-3.7-flash")
    pinecone_api_key: str = _env("PINECONE_API_KEY")
    pinecone_index_name: str = _env(
        "PINECONE_INDEX_NAME", "civil-regulation-assistant"
    )
    pinecone_namespace: str = _env("PINECONE_NAMESPACE", "cscec-public")
    pinecone_control_url: str = _env(
        "PINECONE_CONTROL_URL", "https://api.pinecone.io"
    ).rstrip("/")
    chat_requests_per_hour: int = int(_env("CHAT_REQUESTS_PER_HOUR", "20"))


settings = Settings()
