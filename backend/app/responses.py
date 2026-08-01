from __future__ import annotations

from typing import Any


def success(data: Any, message: str = "请求成功") -> dict[str, Any]:
    return {"success": True, "message": message, "data": data}


class APIError(Exception):
    def __init__(self, message: str, status_code: int, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def error_payload(error: APIError) -> dict[str, Any]:
    return {
        "success": False,
        "message": error.message,
        "error": {"code": error.code},
    }
