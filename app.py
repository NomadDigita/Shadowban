import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from string import Template
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from reports import SURFACES, history_csv, print_html, report_data

ROOT = Path(__file__).resolve().parent
DB = os.getenv("REACHFRAME_DB", str(ROOT / "reachframe.sqlite3"))
TOKEN = os.getenv("X_BEARER_TOKEN")
DAILY_BUDGET = max(0, int(os.getenv("DAILY_SCAN_BUDGET", "0")))
AUTOMATIC = bool(TOKEN and DAILY_BUDGET)
INTERVAL = max(86400, int(os.getenv("SCAN_INTERVAL_SECONDS", "86400")))
SIGNALS = tuple(SURFACES)
STATUSES = ("visible", "missing", "unknown")


@contextmanager
def database():
    conn = sqlite3.connect(DB, timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def initialize():
    with database() as conn:
        conn.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS watch (
            owner TEXT, handle TEXT, next_scan INTEGER, PRIMARY KEY(owner,handle)
        );
        CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY, owner TEXT, handle TEXT, source TEXT,
            checked INTEGER, results TEXT
        );
        CREATE INDEX IF NOT EXISTS scan_history ON scans(owner, handle, source, id DESC);
        CREATE TABLE IF NOT EXISTS usage (day INTEGER PRIMARY KEY, scans INTEGER);
        CREATE TABLE IF NOT EXISTS changes (
            id INTEGER PRIMARY KEY, owner TEXT, handle TEXT, signal TEXT,
            before TEXT, after TEXT, checked INTEGER, source TEXT
        );
        """)


def signal(status, detail):
    return {"status": status, "detail": detail}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def x_get(path, **params):
    request = Request("https://api.x.com/2/" + path + "?" + urlencode(params),
                      headers={"Authorization": "Bearer " + TOKEN})
    with build_opener(NoRedirect).open(request, timeout=8) as response:
        return json.load(response)


def live_check(handle):
    result = {key: signal("unknown", "Use the guided check to observe this surface in X.")
              for key in SIGNALS}
    try:
        profile = x_get("users/by/username/" + handle, **{"user.fields": "protected"}).get("data")
        if not profile or profile.get("protected"):
            result["search"] = signal("unknown", "A public profile could not be verified.")
            return result
        recent = x_get("users/" + str(int(profile["id"])) + "/tweets",
                       max_results=10, exclude="retweets,replies",
                       **{"tweet.fields": "created_at"}).get("data", [])
        cutoff = time.time() - 6 * 86400
        candidates = {post["id"] for post in recent
                      if datetime.fromisoformat(post["created_at"].replace("Z", "+00:00")).timestamp() >= cutoff}
        if not candidates:
            result["search"] = signal("unknown", "No original posts from the past six days were available in the sample.")
            return result
        search = x_get("tweets/search/recent", query=f"from:{handle} -is:retweet -is:reply",
                       max_results=100,
                       start_time=datetime.fromtimestamp(int(cutoff), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        found = candidates.intersection(post["id"] for post in search.get("data", []))
        if found:
            result["search"] = signal("visible", f"Recent Search returned {len(found)} of {len(candidates)} sampled posts.")
        elif search.get("meta", {}).get("next_token") or search.get("errors") or "meta" not in search:
            result["search"] = signal("unknown", "The search response was incomplete.")
        else:
            result["search"] = signal("missing", f"Recent Search returned none of {len(candidates)} sampled posts.")
    except HTTPError as error:
        result["search"] = signal("unknown", f"X API returned HTTP {error.code}. Check plan access, credits, or rate limits.")
    except (OSError, ValueError, KeyError, TypeError):
        result["search"] = signal("unknown", "The X API response could not be read.")
    return result


def save(conn, owner, handle, source, results, *, locked=False):
    now = int(time.time())
    if not locked:
        conn.execute("BEGIN IMMEDIATE")
    previous = conn.execute("""
        SELECT results FROM scans WHERE owner=? AND handle=? AND source=? ORDER BY id DESC LIMIT 50
    """, (owner, handle, source)).fetchall()
    prior = [json.loads(row["results"]) for row in previous]
    for key, value in results.items():
        current = value["status"]
        if current == "unknown":
            continue
        last = next((entry[key]["status"] for entry in prior if entry[key]["status"] != "unknown"), None)
        if last and last != current:
            conn.execute("""
                INSERT INTO changes(owner,handle,signal,before,after,checked,source)
                VALUES (?,?,?,?,?,?,?)
            """, (owner, handle, key, last, current, now, source))
    cursor = conn.execute("INSERT INTO scans(owner,handle,source,checked,results) VALUES (?,?,?,?,?)",
                          (owner, handle, source, now, json.dumps(results)))
    return {"id": cursor.lastrowid, "handle": handle, "source": source, "checked": now, "results": results}


def claim_scan(now):
    day = now // 86400
    with database() as conn:
        conn.execute("BEGIN IMMEDIATE")
        usage = conn.execute("SELECT scans FROM usage WHERE day=?", (day,)).fetchone()
        if usage and usage["scans"] >= DAILY_BUDGET:
            return None
        item = conn.execute("SELECT * FROM watch WHERE next_scan<=? ORDER BY next_scan LIMIT 1",
                            (now,)).fetchone()
        if item:
            conn.execute("UPDATE watch SET next_scan=? WHERE owner=? AND handle=?",
                         (now + INTERVAL, item["owner"], item["handle"]))
            conn.execute("""
                INSERT INTO usage VALUES (?,1) ON CONFLICT(day) DO UPDATE SET scans=scans+1
            """, (day,))
        return item


def run_scheduled_scan(now):
    item = claim_scan(now)
    if not item:
        return False
    results = live_check(item["handle"])
    with database() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT next_scan FROM watch WHERE owner=? AND handle=?",
                               (item["owner"], item["handle"])).fetchone()
        if current and current["next_scan"] == now + INTERVAL:
            save(conn, item["owner"], item["handle"], "api", results, locked=True)
    return True


def scheduled_scan():
    while True:
        try:
            if run_scheduled_scan(int(time.time())):
                continue
        except sqlite3.Error as error:
            print(f"Scheduled scan database error: {error}", flush=True)
        time.sleep(20)


class Handler(BaseHTTPRequestHandler):
    def send(self, data, status=200, content_type="application/json", *, filename=None):
        if isinstance(data, dict):
            data = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if getattr(self, "new_owner", None):
            secure = "; Secure" if os.getenv("SECURE_COOKIE") == "1" else ""
            self.send_header("Set-Cookie", f"reachframe={self.new_owner}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000{secure}")
        self.end_headers()
        self.wfile.write(data)

    def owner(self, conn, create=False):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        session = cookie.get("reachframe")
        if session and conn.execute("SELECT 1 FROM workspaces WHERE id=?", (session.value,)).fetchone():
            return session.value
        if create:
            self.new_owner = secrets.token_urlsafe(32)
            conn.execute("INSERT INTO workspaces VALUES (?)", (self.new_owner,))
            return self.new_owner
        return None

    def do_GET(self):
        path = urlsplit(self.path).path
        assets = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                  "/style.css": ("style.css", "text/css")}
        if path in assets:
            name, kind = assets[path]
            return self.send((ROOT / "static" / name).read_bytes(), content_type=kind + "; charset=utf-8")
        report_route = re.fullmatch(r"/reports/([1-9][0-9]{0,18})/(json|print)", path)
        if report_route:
            report_id = int(report_route[1])
            if report_id <= 2**63 - 1:
                return self.saved_report(report_id, report_route[2])
        if path == "/reports/history.csv":
            return self.saved_history()
        if path != "/api/workspace":
            return self.send({"error": "Page unavailable."}, 404)
        with database() as conn:
            owner = self.owner(conn, create=True)
            history = [dict(row) for row in conn.execute(
                "SELECT id,handle,source,checked,results FROM scans WHERE owner=? ORDER BY id DESC LIMIT 100", (owner,))]
            for row in history:
                row["results"] = json.loads(row["results"])
            watch = [dict(row) for row in conn.execute(
                "SELECT handle,next_scan FROM watch WHERE owner=? ORDER BY handle", (owner,))]
            changes = [dict(row) for row in conn.execute(
                "SELECT handle,signal,before,after,checked,source FROM changes WHERE owner=? ORDER BY id DESC LIMIT 40", (owner,))]
        return self.send({"live": AUTOMATIC, "history": history, "watch": watch, "changes": changes})

    def saved_report(self, report_id, mode):
        with database() as conn:
            row = conn.execute("""
                SELECT id,handle,source,checked,results FROM scans WHERE owner=? AND id=?
            """, (self.owner(conn), report_id)).fetchone()
        if row is None:
            return self.send({"error": "Saved report unavailable."}, 404)
        report = report_data(row)
        if mode == "json":
            data = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            return self.send(data, content_type="application/json; charset=utf-8",
                             filename=f"reachframe-report-{report_id}.json")
        template = Template((ROOT / "static" / "print.html").read_text(encoding="utf-8"))
        return self.send(print_html(report, template), content_type="text/html; charset=utf-8")

    def saved_history(self):
        with database() as conn:
            owner = self.owner(conn)
            if owner is None:
                return self.send({"error": "Saved history unavailable."}, 404)
            rows = conn.execute("""
                SELECT id,handle,source,checked,results FROM scans WHERE owner=? ORDER BY id DESC
            """, (owner,))
            data = history_csv(rows)
        return self.send(data, content_type="text/csv; charset=utf-8",
                         filename="reachframe-history.csv")

    def do_POST(self):
        path = self.path
        if path not in ("/api/manual", "/api/watch"):
            return self.send({"error": "Page unavailable."}, 404)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get_content_type() != "application/json":
                raise ValueError
            body = json.loads(self.rfile.read(length))
            handle = body["handle"].strip().removeprefix("@").lower()
            if not re.fullmatch(r"[a-z0-9_]{1,15}", handle):
                raise ValueError
        except (ValueError, TypeError, KeyError, AttributeError):
            return self.send({"error": "Enter a valid X handle (1–15 letters, numbers or underscores)."}, 400)
        with database() as conn:
            owner = self.owner(conn)
            if not owner:
                return self.send({"error": "Refresh the page to start a workspace."}, 403)
            if path == "/api/watch":
                if body.get("enabled") is False:
                    conn.execute("DELETE FROM watch WHERE owner=? AND handle=?", (owner, handle))
                elif body.get("enabled") is True:
                    conn.execute("BEGIN IMMEDIATE")
                    count = conn.execute("SELECT count(*) FROM watch WHERE owner=?", (owner,)).fetchone()[0]
                    existing = conn.execute("SELECT 1 FROM watch WHERE owner=? AND handle=?", (owner, handle)).fetchone()
                    if count >= 20 and not existing:
                        return self.send({"error": "This workspace can watch up to 20 handles."}, 409)
                    conn.execute("INSERT OR IGNORE INTO watch VALUES (?,?,?)",
                                 (owner, handle, int(time.time()) + INTERVAL))
                else:
                    return self.send({"error": "Provide a watch state."}, 400)
                scan = {"ok": True}
            else:
                fields = body.get("results")
                if (not isinstance(fields, dict) or set(fields) != set(SIGNALS)
                    or any(status not in STATUSES for status in fields.values())
                    or all(status == "unknown" for status in fields.values())):
                    return self.send({"error": "Record at least one observation before saving."}, 400)
                results = {key: signal(status, "Recorded by you using the guided check.")
                           for key, status in fields.items()}
                scan = save(conn, owner, handle, "guided", results)
        return self.send(scan, 200 if path == "/api/watch" else 201)


if __name__ == "__main__":
    initialize()
    if AUTOMATIC:
        threading.Thread(target=scheduled_scan, daemon=True).start()
    ThreadingHTTPServer((os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "8000"))), Handler).serve_forever()
