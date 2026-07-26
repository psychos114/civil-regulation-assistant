from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from server import create_app


class RegulationsApiTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_directory.name) / "test_regulations.db"
        frontend_path = Path(self.temp_directory.name) / "index.html"
        frontend_path.write_text(
            "<!doctype html><title>规范助手测试页面</title>",
            encoding="utf-8",
        )
        self.app = create_app(database_path, frontend_path)
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def test_complete_update_flow(self) -> None:
        check_response = self.client.get(
            "/api/regulations/check-update",
            headers={"Origin": "http://localhost:8000"},
        )
        self.assertEqual(check_response.status_code, 200)
        self.assertEqual(
            check_response.headers["Access-Control-Allow-Origin"],
            "http://localhost:8000",
        )
        check_data = check_response.get_json()["data"]
        self.assertTrue(check_data["has_update"])
        self.assertEqual(check_data["update_count"], 3)

        download_response = self.client.post(
            "/api/regulations/download",
            json={},
        )
        self.assertEqual(download_response.status_code, 200)
        download_data = download_response.get_json()["data"]
        self.assertEqual(download_data["downloaded_count"], 3)
        self.assertEqual(download_data["created_count"], 1)
        self.assertEqual(download_data["updated_count"], 2)
        self.assertEqual(download_data["remaining_update_count"], 0)

        second_check = self.client.get("/api/regulations/check-update")
        second_check_data = second_check.get_json()["data"]
        self.assertFalse(second_check_data["has_update"])
        self.assertEqual(second_check_data["update_count"], 0)

        list_response = self.client.get(
            "/api/regulations/list?page=1&page_size=3&is_new=true"
        )
        self.assertEqual(list_response.status_code, 200)
        list_data = list_response.get_json()["data"]
        self.assertEqual(len(list_data["items"]), 3)
        self.assertEqual(list_data["pagination"]["total"], 3)

        regulation_id = list_data["items"][0]["id"]
        detail_response = self.client.get(f"/api/regulations/{regulation_id}")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.get_json()["data"]["id"], regulation_id)

    def test_frontend_is_served_by_flask(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("规范助手测试页面".encode(), response.data)
        response.close()

    def test_pagination_and_search(self) -> None:
        response = self.client.get(
            "/api/regulations/list?page=1&per_page=2&q=建筑"
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()["data"]
        self.assertEqual(data["pagination"]["page_size"], 2)
        self.assertGreaterEqual(data["pagination"]["total"], 2)

    def test_common_industry_regulations_are_seeded(self) -> None:
        response = self.client.get(
            "/api/regulations/list?page=1&page_size=10&q=临时用电"
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()["data"]
        self.assertEqual(data["pagination"]["total"], 1)
        self.assertEqual(data["items"][0]["code"], "JGJ 46-2005")

        all_items = self.client.get("/api/regulations/list?page=1&page_size=1")
        self.assertEqual(
            all_items.get_json()["data"]["pagination"]["total"],
            33,
        )

    def test_validation_and_not_found_errors(self) -> None:
        invalid_page = self.client.get("/api/regulations/list?page=0")
        self.assertEqual(invalid_page.status_code, 400)
        self.assertFalse(invalid_page.get_json()["success"])

        unknown_update = self.client.post(
            "/api/regulations/download",
            json={"update_ids": ["not-exists"]},
        )
        self.assertEqual(unknown_update.status_code, 400)

        missing_detail = self.client.get("/api/regulations/99999")
        self.assertEqual(missing_detail.status_code, 404)
        self.assertEqual(
            missing_detail.get_json()["error"]["code"],
            "REGULATION_NOT_FOUND",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
