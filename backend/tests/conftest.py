from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DATABASE = Path(tempfile.gettempdir()) / "civil_regulation_fastapi_test.db"
os.environ["DATABASE_PATH"] = str(TEST_DATABASE)
os.environ["STEPFUN_API_KEY"] = ""
os.environ["PINECONE_API_KEY"] = ""

from app.database import initialize_database  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    for suffix in ("", "-wal", "-shm"):
        path = Path(f"{TEST_DATABASE}{suffix}")
        if path.exists():
            path.unlink()
    initialize_database()
    with TestClient(app) as test_client:
        yield test_client
