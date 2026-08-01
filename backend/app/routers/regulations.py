from __future__ import annotations

from fastapi import APIRouter, Query

from ..responses import success
from ..schemas import DownloadRequest
from ..services import regulations as service


router = APIRouter(prefix="/api/regulations", tags=["法规"])


@router.get("/check-update")
def check_update() -> dict:
    data, message = service.check_update()
    return success(data, message)


@router.get("/list")
def list_regulations(
    page: int = Query(1),
    page_size: int | None = Query(None),
    per_page: int | None = Query(None),
    q: str = Query(""),
    search: str = Query(""),
    is_new: bool | None = Query(None),
) -> dict:
    size = page_size if page_size is not None else per_page or 10
    keyword = q or search
    return success(service.list_regulations(page, size, keyword, is_new))


@router.post("/download")
def download_regulations(payload: DownloadRequest | None = None) -> dict:
    request = payload or DownloadRequest()
    requested = request.update_ids if request.update_ids is not None else request.ids
    data, message = service.download_regulations(requested)
    return success(data, message)


@router.get("/{regulation_id}")
def get_regulation(regulation_id: int) -> dict:
    return success(service.get_regulation(regulation_id))
