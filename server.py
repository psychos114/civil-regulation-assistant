from __future__ import annotations

import math
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB_PATH = BASE_DIR / "regulations.db"
DEFAULT_FRONTEND_PATH = BASE_DIR / "index.html"


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS regulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    release_date TEXT NOT NULL,
    content TEXT NOT NULL,
    version TEXT NOT NULL,
    is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_regulations_release_date
ON regulations (release_date DESC);

CREATE INDEX IF NOT EXISTS idx_regulations_is_new
ON regulations (is_new);
"""


# 初始本地法规库。它有意保留两个旧版本，以便首次检查时能发现更新。
SEED_REGULATIONS = (
    {
        "title": "建筑工程施工质量验收统一标准",
        "code": "GB 50300-2013",
        "release_date": "2013-11-01",
        "content": "规定建筑工程施工质量验收的基本要求、验收划分与组织程序。",
        "version": "2013",
        "is_new": 0,
    },
    {
        "title": "建筑施工安全检查标准",
        "code": "JGJ 59-2011",
        "release_date": "2011-12-07",
        "content": "规定建筑施工现场安全生产检查评定的项目、内容与评分方法。",
        "version": "2011",
        "is_new": 0,
    },
    {
        "title": "中华人民共和国安全生产法",
        "code": "主席令第88号",
        "release_date": "2021-06-10",
        "content": "规定生产经营单位安全生产保障、从业人员权利义务及监督管理要求。",
        "version": "2021修正",
        "is_new": 0,
    },
    {
        "title": "混凝土结构设计规范",
        "code": "GB 50010-2010",
        "release_date": "2010-08-18",
        "content": "规定混凝土结构设计的基本原则、材料、承载能力和构造要求。",
        "version": "2015局部修订",
        "is_new": 0,
    },
    {
        "title": "建设工程项目管理规范",
        "code": "GB/T 50326-2017",
        "release_date": "2017-05-04",
        "content": "规定建设工程项目管理的组织、策划、实施、控制和收尾要求。",
        "version": "2017",
        "is_new": 0,
    },
)


# 常用土木工程规范扩展库。content 为检索摘要，不代替官方标准全文。
ADDITIONAL_REGULATIONS = (
    {
        "title": "工程结构通用规范",
        "code": "GB 55001-2021",
        "release_date": "2021-04-09",
        "content": "[结构通用] 涵盖工程结构可靠性、设计工作年限、作用、材料和结构分析等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "建筑与市政工程抗震通用规范",
        "code": "GB 55002-2021",
        "release_date": "2021-04-09",
        "content": "[抗震] 涵盖建筑与市政工程抗震设防、场地、结构体系及抗震措施等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "建筑与市政地基基础通用规范",
        "code": "GB 55003-2021",
        "release_date": "2021-09-08",
        "content": "[地基基础] 涵盖勘察成果使用、地基设计、基础设计、边坡和基坑工程等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "组合结构通用规范",
        "code": "GB 55004-2021",
        "release_date": "2021-09-08",
        "content": "[结构设计] 涵盖钢与混凝土组合构件、连接、耐久性和施工质量控制等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "钢结构通用规范",
        "code": "GB 55006-2021",
        "release_date": "2021-04-09",
        "content": "[钢结构] 涵盖钢材、构件、连接、稳定、疲劳、防护和施工验收等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "砌体结构通用规范",
        "code": "GB 55007-2021",
        "release_date": "2021-09-08",
        "content": "[砌体结构] 涵盖材料、结构布置、承载能力、构造及施工质量控制等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "混凝土结构通用规范",
        "code": "GB 55008-2021",
        "release_date": "2021-09-08",
        "content": "[混凝土结构] 涵盖材料性能、结构设计、构造、耐久性、施工与验收等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "工程勘察通用规范",
        "code": "GB 55017-2021",
        "release_date": "2021-09-08",
        "content": "[岩土勘察] 涵盖勘察纲要、钻探取样、原位测试、水文地质和成果报告等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "工程测量通用规范",
        "code": "GB 55018-2021",
        "release_date": "2021-09-08",
        "content": "[工程测量] 涵盖控制测量、施工测量、变形监测和测量成果质量等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "既有建筑鉴定与加固通用规范",
        "code": "GB 55021-2021",
        "release_date": "2021-09-08",
        "content": "[鉴定加固] 涵盖既有建筑安全性鉴定、抗震鉴定、加固设计和施工验收等通用要求。",
        "version": "2021",
        "is_new": 0,
    },
    {
        "title": "施工脚手架通用规范",
        "code": "GB 55023-2022",
        "release_date": "2022-03-10",
        "content": "[施工安全] 涵盖脚手架材料、设计、搭设、使用、检查、拆除及安全管理等通用要求。",
        "version": "2022",
        "is_new": 0,
    },
    {
        "title": "建筑与市政工程防水通用规范",
        "code": "GB 55030-2022",
        "release_date": "2022-09-27",
        "content": "[建筑防水] 涵盖地下、屋面、外墙和室内防水设计工作年限、材料及施工验收要求。",
        "version": "2022",
        "is_new": 0,
    },
    {
        "title": "民用建筑通用规范",
        "code": "GB 55031-2022",
        "release_date": "2022-07-15",
        "content": "[民用建筑] 涵盖建筑空间、室内环境、交通、设施、安全与维护等通用要求。",
        "version": "2022",
        "is_new": 0,
    },
    {
        "title": "建筑与市政施工现场安全卫生与职业健康通用规范",
        "code": "GB 55034-2022",
        "release_date": "2022-10-31",
        "content": "[施工安全] 涵盖施工现场安全管理、临时设施、作业环境、卫生与职业健康等要求。",
        "version": "2022",
        "is_new": 0,
    },
    {
        "title": "建筑地基基础设计规范",
        "code": "GB 50007-2011",
        "release_date": "2011-07-26",
        "content": "[地基基础设计] 涵盖地基计算、山区地基、软弱地基、基础及基坑工程设计要求。",
        "version": "2011",
        "is_new": 0,
    },
    {
        "title": "建筑结构荷载规范",
        "code": "GB 50009-2012",
        "release_date": "2012-05-28",
        "content": "[结构荷载] 涵盖永久荷载、楼面活荷载、风荷载、雪荷载及荷载组合等要求。",
        "version": "2012",
        "is_new": 0,
    },
    {
        "title": "建筑抗震设计规范",
        "code": "GB 50011-2010",
        "release_date": "2010-05-31",
        "content": "[抗震设计] 涵盖抗震设防分类、场地地基、结构计算及各类结构抗震措施。",
        "version": "2016局部修订",
        "is_new": 0,
    },
    {
        "title": "建筑地基基础工程施工质量验收标准",
        "code": "GB 50202-2018",
        "release_date": "2018-03-16",
        "content": "[质量验收] 涵盖土方、基坑支护、地基处理、桩基础及地下水控制等验收要求。",
        "version": "2018",
        "is_new": 0,
    },
    {
        "title": "混凝土结构工程施工质量验收规范",
        "code": "GB 50204-2015",
        "release_date": "2014-12-31",
        "content": "[质量验收] 涵盖模板、钢筋、预应力、混凝土、现浇结构和装配式结构验收要求。",
        "version": "2015",
        "is_new": 0,
    },
    {
        "title": "钢结构工程施工质量验收标准",
        "code": "GB 50205-2020",
        "release_date": "2020-01-16",
        "content": "[质量验收] 涵盖钢构件进场、焊接、紧固件连接、安装、涂装和验收要求。",
        "version": "2020",
        "is_new": 0,
    },
    {
        "title": "建筑装饰装修工程质量验收标准",
        "code": "GB 50210-2018",
        "release_date": "2018-02-08",
        "content": "[装饰装修] 涵盖抹灰、门窗、吊顶、饰面、幕墙、涂饰和细部工程验收要求。",
        "version": "2018",
        "is_new": 0,
    },
    {
        "title": "建筑节能工程施工质量验收标准",
        "code": "GB 50411-2019",
        "release_date": "2019-05-24",
        "content": "[建筑节能] 涵盖墙体、幕墙、门窗、屋面、地面、供暖通风和电气节能验收要求。",
        "version": "2019",
        "is_new": 0,
    },
    {
        "title": "建设工程施工现场消防安全技术规范",
        "code": "GB 50720-2011",
        "release_date": "2011-06-06",
        "content": "[消防安全] 涵盖施工现场总平面布置、临时设施、防火管理和临时消防设施要求。",
        "version": "2011",
        "is_new": 0,
    },
    {
        "title": "施工现场临时用电安全技术规范",
        "code": "JGJ 46-2005",
        "release_date": "2005-04-15",
        "content": "[临时用电] 涵盖临时用电组织设计、配电系统、接地防雷、设备和照明安全要求。",
        "version": "2005",
        "is_new": 0,
    },
    {
        "title": "建筑施工高处作业安全技术规范",
        "code": "JGJ 80-2016",
        "release_date": "2016-07-09",
        "content": "[高处作业] 涵盖临边洞口、攀登悬空、操作平台、交叉作业和安全防护要求。",
        "version": "2016",
        "is_new": 0,
    },
    {
        "title": "建筑施工扣件式钢管脚手架安全技术规范",
        "code": "JGJ 130-2011",
        "release_date": "2011-01-28",
        "content": "[脚手架] 涵盖扣件式钢管脚手架的设计、构造、搭拆、检查验收及安全管理要求。",
        "version": "2011",
        "is_new": 0,
    },
    {
        "title": "建筑施工模板安全技术规范",
        "code": "JGJ 162-2008",
        "release_date": "2008-08-06",
        "content": "[模板工程] 涵盖模板与支架设计、构造、制作安装、检查验收和拆除安全要求。",
        "version": "2008",
        "is_new": 0,
    },
    {
        "title": "建筑工程冬期施工规程",
        "code": "JGJ/T 104-2011",
        "release_date": "2011-04-22",
        "content": "[季节施工] 涵盖冬期土方、地基、砌体、钢筋、混凝土、防水及装饰施工要求。",
        "version": "2011",
        "is_new": 0,
    },
)


# 演示用“远端法规源”。实际部署时可以将其替换为权威法规平台的同步结果。
REMOTE_REGULATIONS = (
    {
        "id": "gb-55032-2022",
        "title": "建筑与市政工程施工质量控制通用规范",
        "code": "GB 55032-2022",
        "release_date": "2022-07-15",
        "content": (
            "规定建筑与市政工程施工质量控制的通用要求，涵盖施工过程控制、"
            "材料与设备质量、检验和验收等内容。本项目保存的是演示摘要，"
            "正式使用时应接入合法、权威的法规全文数据源。"
        ),
        "version": "2022",
    },
    {
        "id": "jgj-59-2011-r2024",
        "title": "建筑施工安全检查标准（2024修订数据）",
        "code": "JGJ 59-2011",
        "release_date": "2024-03-15",
        "content": (
            "更新建筑施工安全检查相关数据，覆盖安全管理、文明施工、脚手架、"
            "临时用电和施工机具等检查项目。本项目内容仅用于接口联调演示。"
        ),
        "version": "2024修订数据",
    },
    {
        "id": "safe-production-law-r2024",
        "title": "中华人民共和国安全生产法（2024更新数据）",
        "code": "主席令第88号",
        "release_date": "2024-06-01",
        "content": (
            "更新安全生产主体责任、风险防控、事故应急与监督管理相关数据。"
            "本项目内容仅用于接口联调演示，正式使用时应以官方公布文本为准。"
        ),
        "version": "2024更新数据",
    },
)


def utc_now() -> str:
    """Return an ISO-8601 UTC timestamp with second precision."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def connect_database(database_path: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(database_path), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def database_session(database_path: str | Path) -> Iterator[sqlite3.Connection]:
    """Commit or roll back a transaction and always release the SQLite handle."""
    connection = connect_database(database_path)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_database(database_path: str | Path = DEFAULT_DB_PATH) -> int:
    """Create the database/table and insert initial records if they are absent."""
    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with database_session(path) as connection:
        connection.executescript(SCHEMA_SQL)
        timestamp = utc_now()

        # 迁移早期演示数据中不准确的编号；如果用户已有正式编号则不触碰旧记录。
        old_demo = connection.execute(
            "SELECT id FROM regulations WHERE code = ?",
            ("GB 55030-2024",),
        ).fetchone()
        official_record = connection.execute(
            "SELECT id FROM regulations WHERE code = ?",
            ("GB 55032-2022",),
        ).fetchone()
        if old_demo is not None and official_record is None:
            official = REMOTE_REGULATIONS[0]
            connection.execute(
                """
                UPDATE regulations
                SET title = ?, code = ?, release_date = ?, content = ?,
                    version = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    official["title"],
                    official["code"],
                    official["release_date"],
                    official["content"],
                    official["version"],
                    timestamp,
                    old_demo["id"],
                ),
            )

        for regulation in (*SEED_REGULATIONS, *ADDITIONAL_REGULATIONS):
            connection.execute(
                """
                INSERT OR IGNORE INTO regulations (
                    title, code, release_date, content, version, is_new,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    regulation["title"],
                    regulation["code"],
                    regulation["release_date"],
                    regulation["content"],
                    regulation["version"],
                    regulation["is_new"],
                    timestamp,
                    timestamp,
                ),
            )
        total = connection.execute("SELECT COUNT(*) FROM regulations").fetchone()[0]
    return int(total)


def regulation_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    item["is_new"] = bool(item["is_new"])
    return item


def find_updates(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    local_rows = connection.execute("SELECT * FROM regulations").fetchall()
    local_by_code = {row["code"]: row for row in local_rows}
    updates: list[dict[str, Any]] = []

    for remote in REMOTE_REGULATIONS:
        local = local_by_code.get(remote["code"])
        if local is None:
            action = "new"
        elif local["version"] != remote["version"]:
            action = "update"
        else:
            continue

        updates.append(
            {
                **remote,
                "action": action,
                "local_id": local["id"] if local is not None else None,
                "current_version": local["version"] if local is not None else None,
            }
        )
    return updates


def parse_positive_int(name: str, default: int, *, maximum: int | None = None) -> int:
    raw_value = request.args.get(name)
    if raw_value is None:
        return default
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"参数 {name} 必须是整数") from exc
    if value < 1:
        raise ValueError(f"参数 {name} 必须大于等于 1")
    if maximum is not None and value > maximum:
        raise ValueError(f"参数 {name} 不能大于 {maximum}")
    return value


def success_response(
    data: Any,
    *,
    message: str = "请求成功",
    status_code: int = 200,
):
    return jsonify({"success": True, "message": message, "data": data}), status_code


def error_response(message: str, status_code: int, *, code: str):
    return (
        jsonify(
            {
                "success": False,
                "message": message,
                "error": {"code": code},
            }
        ),
        status_code,
    )


def normalize_requested_update_ids(payload: dict[str, Any]) -> list[str] | None:
    requested = payload.get("update_ids", payload.get("ids"))
    if requested is None:
        return None
    if not isinstance(requested, list) or any(
        not isinstance(item, (str, int)) for item in requested
    ):
        raise ValueError("update_ids 必须是字符串数组")
    return list(dict.fromkeys(str(item) for item in requested))


def select_remote_regulations(requested_ids: Iterable[str] | None) -> list[dict[str, Any]]:
    if requested_ids is None:
        return list(REMOTE_REGULATIONS)

    lookup: dict[str, dict[str, Any]] = {}
    for regulation in REMOTE_REGULATIONS:
        lookup[regulation["id"]] = regulation
        lookup[regulation["code"]] = regulation

    selected: list[dict[str, Any]] = []
    unknown: list[str] = []
    seen_remote_ids: set[str] = set()
    for requested_id in requested_ids:
        regulation = lookup.get(requested_id)
        if regulation is None:
            unknown.append(requested_id)
            continue
        if regulation["id"] not in seen_remote_ids:
            selected.append(regulation)
            seen_remote_ids.add(regulation["id"])

    if unknown:
        raise ValueError(f"未找到可下载的更新：{', '.join(unknown)}")
    return selected


def create_app(
    database_path: str | Path | None = None,
    frontend_path: str | Path | None = None,
) -> Flask:
    app = Flask(__name__)
    app.config["DATABASE"] = str(
        Path(database_path or os.environ.get("REGULATIONS_DB", DEFAULT_DB_PATH)).resolve()
    )
    app.config["FRONTEND_FILE"] = str(
        Path(
            frontend_path
            or os.environ.get("FRONTEND_FILE", DEFAULT_FRONTEND_PATH)
        ).resolve()
    )
    app.json.ensure_ascii = False

    CORS(
        app,
        resources={r"/api/*": {"origins": "*"}},
        methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    init_database(app.config["DATABASE"])

    @app.get("/")
    def frontend_home():
        path = Path(app.config["FRONTEND_FILE"])
        if not path.is_file():
            return error_response(
                f"未找到前端文件：{path}",
                404,
                code="FRONTEND_NOT_FOUND",
            )
        return send_file(path)

    @app.get("/favicon.ico")
    def favicon():
        return "", 204

    @app.get("/api/regulations/check-update")
    def check_update():
        with database_session(app.config["DATABASE"]) as connection:
            updates = find_updates(connection)
            local_count = connection.execute(
                "SELECT COUNT(*) FROM regulations"
            ).fetchone()[0]

        return success_response(
            {
                "has_update": bool(updates),
                "update_count": len(updates),
                "local_count": int(local_count),
                "updates": updates,
                "checked_at": utc_now(),
            },
            message="发现法规更新" if updates else "当前已是最新版本",
        )

    @app.get("/api/regulations/list")
    def list_regulations():
        try:
            page = parse_positive_int("page", 1)
            if "page_size" in request.args:
                page_size = parse_positive_int("page_size", 10, maximum=100)
            else:
                page_size = parse_positive_int("per_page", 10, maximum=100)
        except ValueError as exc:
            return error_response(str(exc), 400, code="INVALID_PAGINATION")

        keyword = request.args.get("q", request.args.get("search", "")).strip()
        is_new_raw = request.args.get("is_new")

        conditions: list[str] = []
        params: list[Any] = []
        if keyword:
            conditions.append("(title LIKE ? OR code LIKE ? OR content LIKE ?)")
            like_keyword = f"%{keyword}%"
            params.extend([like_keyword, like_keyword, like_keyword])

        if is_new_raw is not None:
            normalized = is_new_raw.strip().lower()
            if normalized not in {"0", "1", "false", "true"}:
                return error_response(
                    "参数 is_new 必须是 0、1、false 或 true",
                    400,
                    code="INVALID_FILTER",
                )
            conditions.append("is_new = ?")
            params.append(1 if normalized in {"1", "true"} else 0)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        offset = (page - 1) * page_size

        with database_session(app.config["DATABASE"]) as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM regulations {where_clause}",
                params,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT * FROM regulations
                {where_clause}
                ORDER BY is_new DESC, release_date DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, page_size, offset],
            ).fetchall()

        total_pages = math.ceil(total / page_size) if total else 0
        return success_response(
            {
                "items": [regulation_to_dict(row) for row in rows],
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total": int(total),
                    "total_pages": total_pages,
                    "has_previous": page > 1,
                    "has_next": page < total_pages,
                },
            }
        )

    @app.post("/api/regulations/download")
    def download_regulations():
        payload = request.get_json(silent=True)
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            return error_response(
                "请求体必须是 JSON 对象",
                400,
                code="INVALID_JSON_BODY",
            )

        try:
            requested_ids = normalize_requested_update_ids(payload)
            selected = select_remote_regulations(requested_ids)
        except ValueError as exc:
            return error_response(str(exc), 400, code="INVALID_UPDATE_IDS")

        downloaded: list[dict[str, Any]] = []
        unchanged: list[dict[str, Any]] = []
        created_count = 0
        updated_count = 0

        with database_session(app.config["DATABASE"]) as connection:
            timestamp = utc_now()
            for remote in selected:
                local = connection.execute(
                    "SELECT * FROM regulations WHERE code = ?",
                    (remote["code"],),
                ).fetchone()

                if local is not None and local["version"] == remote["version"]:
                    unchanged.append(
                        {
                            "id": local["id"],
                            "title": local["title"],
                            "code": local["code"],
                            "version": local["version"],
                        }
                    )
                    continue

                if local is None:
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
                else:
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

            remaining_updates = find_updates(connection)

        return success_response(
            {
                "downloaded_count": len(downloaded),
                "created_count": created_count,
                "updated_count": updated_count,
                "unchanged_count": len(unchanged),
                "downloaded": downloaded,
                "unchanged": unchanged,
                "remaining_update_count": len(remaining_updates),
                "completed_at": utc_now(),
            },
            message=(
                f"法规数据下载完成，共处理 {len(downloaded)} 份更新"
                if downloaded
                else "所选法规已是最新版本"
            ),
        )

    @app.get("/api/regulations/<int:regulation_id>")
    def get_regulation(regulation_id: int):
        with database_session(app.config["DATABASE"]) as connection:
            row = connection.execute(
                "SELECT * FROM regulations WHERE id = ?",
                (regulation_id,),
            ).fetchone()

        if row is None:
            return error_response(
                f"未找到 id 为 {regulation_id} 的法规",
                404,
                code="REGULATION_NOT_FOUND",
            )
        return success_response(regulation_to_dict(row))

    @app.errorhandler(404)
    def api_not_found(_error):
        if request.path.startswith("/api/"):
            return error_response("接口不存在", 404, code="API_NOT_FOUND")
        return error_response("资源不存在", 404, code="NOT_FOUND")

    @app.errorhandler(405)
    def method_not_allowed(_error):
        return error_response("请求方法不被允许", 405, code="METHOD_NOT_ALLOWED")

    @app.errorhandler(sqlite3.Error)
    def database_error(error: sqlite3.Error):
        app.logger.exception("SQLite database error")
        return error_response(
            f"数据库操作失败：{error}",
            500,
            code="DATABASE_ERROR",
        )

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
