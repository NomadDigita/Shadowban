import csv
import io
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
        status, _, payload = self.raw_request(path, body, fresh=fresh)
        return status, json.loads(payload)

    def raw_request(self, path, body=None, *, fresh=False):
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
            return response.status, response.headers, response.read()
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


    def test_saved_report_formats_and_workspace_scope(self):
        self.request("/api/workspace")
        first_cookie = self.cookie
        _, first = self.manual("missing")
        json_url = f"/reports/{first['id']}/json"
        print_url = f"/reports/{first['id']}/print"
        csv_url = "/reports/history.csv"
        status, headers, payload = self.raw_request(json_url)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="reachframe-report-1.json"')
        self.assertEqual(headers["Cache-Control"], "no-store")
        report = json.loads(payload)
        self.assertEqual(report["evidence_source"]["id"], "guided")
        self.assertTrue(report["captured_at_utc"].endswith("Z"))
        self.assertEqual(report["coverage"], {
            "total_surfaces": 4, "measured_surfaces": 2, "visible_surfaces": 1,
            "unmeasured_surfaces": 2, "visibility_percent": 50,
        })
        self.assertEqual([item["outcome"] for item in report["observations"]],
                         ["visible", "missing", "unknown", "unknown"])
        self.assertNotIn(first_cookie.encode(), payload)
        self.assertIn("official X moderation decision", report["limitations"][0])
        for path in (json_url, print_url, csv_url):
            status, headers, _ = self.raw_request(path, fresh=True)
            self.assertEqual(status, 404)
            self.assertIsNone(headers["Set-Cookie"])

        self.cookie = None
        self.request("/api/workspace")
        status, headers, payload = self.raw_request(csv_url)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/csv; charset=utf-8")
        self.assertEqual(headers["Content-Disposition"], 'attachment; filename="reachframe-history.csv"')
        self.assertEqual(list(csv.DictReader(io.StringIO(payload.decode()))), [])
        for path in (json_url, print_url):
            self.assertEqual(self.raw_request(path)[0], 404)
        _, second = self.request("/api/manual", {
            "handle": "different",
            "results": dict.fromkeys(app.SIGNALS, "visible"),
        })
        self.cookie = first_cookie
        self.assertEqual(self.raw_request(f"/reports/{second['id']}/json")[0], 404)
        rows = list(csv.DictReader(io.StringIO(self.raw_request(csv_url)[2].decode())))
        self.assertEqual([row["handle"] for row in rows], ["studio"])
        self.assertEqual(rows[0]["search_outcome"], "Missing from view")
        self.assertEqual(rows[0]["measured_surfaces"], "2")
        self.assertEqual(self.raw_request("/reports/9999999999999999999/print")[0], 404)

        owner = first_cookie.split("=", 1)[1]
        results = json.dumps({key: app.signal("visible", "Observed.") for key in app.SIGNALS})
        with app.database() as conn:
            conn.executemany("INSERT INTO scans(owner,handle,source,checked,results) VALUES (?,?,?,?,?)",
                             [(owner, "studio", "guided", 0, results)] * 100)
        self.assertEqual(len(self.request("/api/workspace")[1]["history"]), 100)
        rows = list(csv.DictReader(io.StringIO(self.raw_request(csv_url)[2].decode())))
        self.assertEqual(len(rows), 101)
        self.assertEqual(rows[-1]["report_id"], str(first["id"]))

    def test_print_escaping_and_unmeasured_api_reports(self):
        self.request("/api/workspace")
        owner = self.cookie.split("=", 1)[1]
        injected = '=1+1, "<img src=x onerror=alert(1)>" & note'
        results = {key: app.signal("unknown", injected) for key in app.SIGNALS}
        with app.database() as conn:
            scan = app.save(conn, owner, "studio", "api", results)
        status, headers, data = self.raw_request(f"/reports/{scan['id']}/print")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        html = data.decode()
        self.assertIn("&lt;img", html)
        self.assertNotIn("<img", html)
        self.assertIn("0 of 4 surfaces", html)
        self.assertIn("Unmeasured", html)
        self.assertIn("X API monitoring samples post search only", html)
        status, _, data = self.raw_request(f"/reports/{scan['id']}/json")
        report = json.loads(data)
        self.assertIsNone(report["coverage"]["visibility_percent"])
        self.assertEqual(report["observations"][0]["evidence"], injected)
        row = next(csv.DictReader(io.StringIO(self.raw_request("/reports/history.csv")[2].decode())))
        self.assertEqual(row["suggestions_evidence"], "'" + injected)
        self.assertEqual(row["visibility_percent"], "")

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
