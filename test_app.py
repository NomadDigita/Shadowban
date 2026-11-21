import json
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from http.client import HTTPConnection
from pathlib import Path
from unittest.mock import patch

import app


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(patch.object(app, "DB", str(Path(directory.name) / "test.sqlite3")))
        app.initialize()
        server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.port = server.server_port
        self.cookie = None

    def request(self, path, body=None, *, fresh=False):
        headers = {"Content-Type": "application/json"}
        if self.cookie and not fresh:
            headers["Cookie"] = self.cookie
        client = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            client.request("GET" if body is None else "POST", path,
                           None if body is None else json.dumps(body), headers)
            response = client.getresponse()
            cookie = response.getheader("Set-Cookie")
            if cookie and not fresh:
                self.cookie = cookie.split(";")[0]
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def manual(self, value):
        results = dict.fromkeys(app.SIGNALS, "unknown")
        results["search"] = value
        results["suggestions"] = "visible"
        return self.request("/api/manual", {"handle": "@Studio", "results": results})

    def test_guided_history_alerts_and_workspace_isolation(self):
        self.assertEqual(self.request("/api/workspace")[0], 200)
        self.assertEqual(self.request("/api/watch", {"handle": "studio", "enabled": True})[0], 200)
        self.assertEqual(self.manual("visible")[0], 201)
        self.assertEqual(self.manual("unknown")[0], 201)
        self.assertEqual(self.manual("missing")[0], 201)
        status, workspace = self.request("/api/workspace")
        self.assertEqual(status, 200)
        self.assertEqual(len(workspace["history"]), 3)
        self.assertEqual(workspace["history"][0]["handle"], "studio")
        self.assertEqual(len(workspace["changes"]), 1)
        self.assertEqual(workspace["changes"][0]["after"], "missing")
        self.assertEqual(workspace["watch"][0]["handle"], "studio")
        _, stranger = self.request("/api/workspace", fresh=True)
        self.assertEqual((stranger["history"], stranger["changes"], stranger["watch"]), ([], [], []))
        self.assertEqual(self.request("/api/watch", {"handle": "studio", "enabled": False})[0], 200)
        self.assertEqual(self.request("/api/workspace")[1]["watch"], [])

    def test_invalid_and_unmeasured_scans(self):
        self.assertEqual(self.request("/api/watch", {"handle": "bad/handle", "enabled": True})[0], 400)
        self.assertEqual(self.request("/api/watch", {"handle": "studio", "enabled": True})[0], 403)
        self.request("/api/workspace")
        self.assertEqual(self.manual("invalid")[0], 400)
        self.assertEqual(self.request("/api/manual", {
            "handle": "studio", "results": dict.fromkeys(app.SIGNALS, "unknown")
        })[0], 400)

    def test_scheduled_scan_and_global_budget(self):
        self.request("/api/workspace")
        self.request("/api/watch", {"handle": "studio", "enabled": True})
        self.request("/api/watch", {"handle": "second", "enabled": True})
        now = self.request("/api/workspace")[1]["watch"][0]["next_scan"] + 1
        sample = dict.fromkeys(app.SIGNALS, app.signal("unknown", "Unavailable"))
        with patch.object(app, "DAILY_BUDGET", 1), patch.object(app, "live_check", return_value=sample) as mock:
            self.assertTrue(app.run_scheduled_scan(now))
            self.assertFalse(app.run_scheduled_scan(now))
            self.assertEqual(mock.call_count, 1)
        self.assertEqual(self.request("/api/workspace")[1]["history"][0]["source"], "api")


class ProviderTests(unittest.TestCase):
    def test_recent_search_uses_post_ids_and_preserves_unmeasured_checks(self):
        created = datetime.now(timezone.utc).isoformat()
        samples = [{"data": {"id": "123", "protected": False}},
                   {"data": [{"id": "42", "created_at": created}]}]
        cases = [
            ({"data": [{"id": "42"}], "meta": {}}, "visible"),
            ({"meta": {"result_count": 0}}, "missing"),
            ({"meta": {"next_token": "more"}}, "unknown"),
        ]
        for response, expected in cases:
            with self.subTest(expected=expected), patch.object(app, "x_get", side_effect=[*samples, response]):
                results = app.live_check("studio")
                self.assertEqual(results["search"]["status"], expected)
                self.assertEqual(results["thread"]["status"], "unknown")

    def test_credential_failure_remains_unmeasured(self):
        error = app.HTTPError("https://api.x.com", 403, "Forbidden", {}, None)
        with patch.object(app, "x_get", side_effect=error):
            results = app.live_check("studio")
        self.assertEqual(results["search"]["status"], "unknown")
        self.assertIn("403", results["search"]["detail"])


if __name__ == "__main__":
    unittest.main()
