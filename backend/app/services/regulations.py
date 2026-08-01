from __future__ import annotations

import json
import math
from typing import Any

from ..config import BASE_DIR
from ..database import connect, transaction, utc_now
from ..responses import APIError


SEED_PATH = BASE_DIR / "data" / "seed-regulations.json"


def _seed_data() -> dict[str, Any]:
    return json.loads(SEED_PATH.read_text(encoding="utf-8"))


def _row_to_item(row: Any) -> dict[str, Any]:
    item = dict(row)
    item["is_new"] = bool(item["is_new"])
    return item


def _find_updates(connection: Any) -> list[dict[str, Any]]:
    local_rows = connection.execute(
        "SELECT id, code, version FROM regulations"
    ).fetchall()
    local_by_code = {row["code"]: row for row in local_rows}
    updates: list[dict[str, Any]] = []
    for remote in _seed_data()["updates"]:
        local = local_by_code.get(remote["code"])
        if local and local["version"] == remote["version"]:
            continue
        updates.append(
            {
                **remote,
                "action": "update" if local else "new",
                "local_id": local["id"] if local else None,
                "current_version": local["version"] if local else None,
            }
        )
    return updates


def check_update() -> tuple[dict[str, Any], str]:
    with connect() as connection:
        updates = _find_updates(connection)
        local_count = connection.execute(
            "SELECT COUNT(*) FROM regulations"
        ).fetchone()[0]
    return (
        {
            "has_update": bool(updates),
            "update_count": len(updates),
            "local_count": int(local_count),
            "updates": updates,
            "checked_at": utc_now(),
        },
        "发现法规更新" if updates else "当前已是最新版本",
    )


def list_regulations(
    page: int,
    page_size: int,
    keyword: str = "",
    is_new: bool | None = None,
) -> dict[str, Any]:
    if page < 1:
        raise APIError("参数 page 必须大于等于 1", 400, "INVALID_PAGINATION")
    if page_size < 1 or page_size > 100:
        raise APIError(
            "参数 page_size 必须在 1 到 100 之间",
            400,
            "INVALID_PAGINATION",
        )

    conditions: list[str] = []
    bindings: list[Any] = []
    keyword = keyword.strip()
    if keyword:
        conditions.append("(title LIKE ? OR code LIKE ? OR content LIKE ?)")
        pattern = f"%{keyword}%"
        bindings.extend([pattern, pattern, pattern])
    if is_new is not None:
        conditions.append("is_new = ?")
        bindings.append(1 if is_new else 0)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    offset = (page - 1) * page_size
    with connect() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) FROM regulations {where}", bindings
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT * FROM regulations
            {where}
            ORDER BY is_new DESC, release_date DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*bindings, page_size, offset],
        ).fetchall()
    total_pages = math.ceil(total / page_size) if total else 0
    return {
        "items": [_row_to_item(row) for row in rows],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": int(total),
            "total_pages": total_pages,
            "has_previous": page > 1,
            "has_next": page < total_pages,
        },
    }


def get_regulation(regulation_id: int) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM regulations WHERE id = ?", (regulation_id,)
        ).fetchone()
    if not row:
        raise APIError(
            f"未找到 id 为 {regulation_id} 的法规",
            404,
            "REGULATION_NOT_FOUND",
        )
    return _row_to_item(row)


def _select_updates(update_ids: list[str | int] | None) -> list[dict[str, Any]]:
    remote_updates = _seed_data()["updates"]
    if update_ids is None:
        return remote_updates
    lookup: dict[str, dict[str, Any]] = {}
    for item in remote_updates:
        lookup[str(item["id"])] = item
        lookup[item["code"]] = item
    selected: dict[str, dict[str, Any]] = {}
    unknown: list[str] = []
    for raw_id in dict.fromkeys(map(str, update_ids)):
        item = lookup.get(raw_id)
        if item:
            selected[item["id"]] = item
        else:
            unknown.append(raw_id)
    if unknown:
        raise APIError(
            f"未找到可下载的更新：{', '.join(unknown)}",
            400,
            "INVALID_UPDATE_IDS",
        )
    return list(selected.values())


def download_regulations(
    update_ids: list[str | int] | None,
) -> tuple[dict[str, Any], str]:
    selected = _select_updates(update_ids)
    downloaded: list[dict[str, Any]] = []
    unchanged: list[dict[str, Any]] = []
    created_count = 0
    updated_count = 0

    with transaction() as connection:
        for remote in selected:
            local = connection.execute(
                "SELECT * FROM regulations WHERE code = ?", (remote["code"],)
            ).fetchone()
            if local and local["version"] == remote["version"]:
                unchanged.append(
                    {
                        "id": local["id"],
                        "title": local["title"],
                        "code": local["code"],
                        "version": local["version"],
                    }
                )
                continue

            timestamp = utc_now()
            if local:
                connection.execute(
                    """
                    UPDATE regulations
                    SET title = ?, release_date = ?, content = ?, version = ?,
                        is_new = 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        remote["title"],
                        remote["release_date"],
                        remote["content"],
                        remote["version"],
                        timestamp,
                        local["id"],
                    ),
                )
                local_id = local["id"]
                action = "updated"
                updated_count += 1
            else:
                cursor = connection.execute(
                    """
                    INSERT INTO regulations (
                        title, code, release_date, content, version, is_new,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                    """,
                    (
                        remote["title"],
                        remote["code"],
                        remote["release_date"],
                        remote["content"],
                        remote["version"],
                        timestamp,
                        timestamp,
                    ),
                )
                local_id = cursor.lastrowid
                action = "created"
                created_count += 1
            downloaded.append(
                {
                    "id": local_id,
                    "update_id": remote["id"],
                    "title": remote["title"],
                    "code": remote["code"],
                    "version": remote["version"],
                    "action": action,
                }
            )
        remaining_count = len(_find_updates(connection))

    data = {
        "downloaded_count": len(downloaded),
        "created_count": created_count,
        "updated_count": updated_count,
        "unchanged_count": len(unchanged),
        "downloaded": downloaded,
        "unchanged": unchanged,
        "remaining_update_count": remaining_count,
        "completed_at": utc_now(),
    }
    message = (
        f"法规数据下载完成，共处理 {len(downloaded)} 份更新"
        if downloaded
        else "所选法规已是最新版本"
    )
    return data, message
