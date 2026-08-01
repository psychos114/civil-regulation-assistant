from pathlib import Path

from fastapi.testclient import TestClient


def test_health_and_seed_counts(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["regulations"] == 33
    assert body["data"]["rag_documents"] == 7
    assert body["data"]["rag_chunks"] == 715


def test_regulation_list_search_and_detail(client: TestClient) -> None:
    response = client.get("/api/regulations/list?page=1&page_size=5&q=建筑")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["pagination"]["page_size"] == 5
    assert data["pagination"]["total"] > 0
    regulation_id = data["items"][0]["id"]
    detail = client.get(f"/api/regulations/{regulation_id}")
    assert detail.status_code == 200
    assert detail.json()["data"]["id"] == regulation_id


def test_complete_update_flow(client: TestClient) -> None:
    check = client.get("/api/regulations/check-update")
    assert check.status_code == 200
    assert check.json()["data"]["update_count"] == 3

    download = client.post("/api/regulations/download", json={})
    assert download.status_code == 200
    assert download.json()["data"]["downloaded_count"] == 3

    recheck = client.get("/api/regulations/check-update")
    assert recheck.json()["data"]["update_count"] == 0


def test_validation_cors_and_unconfigured_model(client: TestClient) -> None:
    missing = client.get("/api/regulations/999999")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "REGULATION_NOT_FOUND"

    chat = client.post("/api/chat", json={"question": "中国建筑有哪些业务？"})
    assert chat.status_code == 503
    assert chat.json()["error"]["code"] == "MODEL_NOT_CONFIGURED"

    preflight = client.options(
        "/api/regulations/list",
        headers={
            "Origin": "http://127.0.0.1:8000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "*"


def test_rag_status_and_separated_frontend(client: TestClient) -> None:
    status = client.get("/api/rag/status")
    assert status.status_code == 200
    assert status.json()["data"]["chunk_count"] == 715
    assert status.json()["data"]["vector_database"]["provider"] == "Pinecone"

    root = Path(__file__).resolve().parents[2]
    html = (root / "frontend" / "index.html").read_text(encoding="utf-8")
    config = (root / "frontend" / "config.js").read_text(encoding="utf-8")
    assert '<script src="./config.js"></script>' in html
    assert "window.BACKEND_URL" in config
    assert "`${configuredBackend || localBackend}/api`" in html
    assert "STEPFUN_API_KEY" not in html
    assert "PINECONE_API_KEY" not in html
