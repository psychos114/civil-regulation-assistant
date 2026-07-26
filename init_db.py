from __future__ import annotations

import argparse
from pathlib import Path

from server import DEFAULT_DB_PATH, init_database


def main() -> None:
    parser = argparse.ArgumentParser(description="初始化法规 SQLite 数据库")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"数据库文件路径（默认：{DEFAULT_DB_PATH}）",
    )
    args = parser.parse_args()

    database_path = args.db.resolve()
    total = init_database(database_path)
    print(f"数据库初始化完成：{database_path}")
    print(f"当前法规数量：{total}")


if __name__ == "__main__":
    main()
