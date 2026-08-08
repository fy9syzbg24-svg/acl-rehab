#!/usr/bin/env python3
"""ACL Rehab Tracker — tiny stdlib-only web server.

Serves the single-page app in ./app and persists all user data to
./data/rehab-data.json (atomic writes + rolling backups).

    python3 server.py            -> http://localhost:8757
    python3 server.py --port 9000
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import random
import re
import shutil
import socket
import socketserver
import sys
import threading
import time
import urllib.parse
import webbrowser
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import physiapp  # noqa: E402  (local module, must follow the path insert)

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "rehab-data.json"
BACKUP_DIR = DATA_DIR / "backups"


def use_data_file(path: Path) -> None:
    """Point the server at a different data file (used for scratch testing)."""
    global DATA_DIR, DATA_FILE, BACKUP_DIR
    DATA_FILE = path.resolve()
    DATA_DIR = DATA_FILE.parent
    BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS = 300
MAX_BODY = 16 * 1024 * 1024  # 16 MB ceiling on a save

_lock = threading.Lock()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}


def _uid() -> str:
    return "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=10))


def load_program_items() -> list:
    """Read the clinician program out of app/data/program.js — that file stays the
    single source of truth, so the bridge never drifts from the app."""
    src = (APP_DIR / "data" / "program.js").read_text(encoding="utf-8")
    m = re.search(r"REHAB_PROGRAM = \[(.*?)\n\];", src, re.S)
    items = []
    for chunk in m.group(1).split("\n  },"):
        gid = re.search(r"id: '([^']+)'", chunk)
        gex = re.search(r"ex: '([^']+)'", chunk)
        if not gid or not gex:
            continue
        item = {"id": gid.group(1), "ex": gex.group(1), "notYet": "notYet: true" in chunk}
        gs = re.search(r"sides: '([^']+)'", chunk)
        item["sides"] = gs.group(1) if gs else "both"
        for k in ("sets", "reps"):
            gk = re.search(r"\b" + k + r": (\d+)", chunk)
            if gk:
                item[k] = int(gk.group(1))
    
        gb = re.search(r"band: '([^']+)'", chunk)
        if gb:
            item["band"] = gb.group(1)
        items.append(item)
    return items


def _pretty(date: str) -> str:
    return datetime.strptime(date, "%Y-%m-%d").strftime("%a %-d %b")


# PhysiApp's session cookie is good for 14 days, so signing in on every sync
# would be pure waste. Cached in memory only — the cookie never touches disk.
_pa_session = None
_pa_session_for = None
AUTO_COOLDOWN_SECS = 600


def _pa_get_session(creds: dict):
    """Reuse the signed-in session; sign in again only if it went stale or the
    credentials changed."""
    global _pa_session, _pa_session_for
    key = (creds.get("code"), str(creds.get("birthYear") or ""))
    if _pa_session is not None and _pa_session_for == key:
        return _pa_session
    session = physiapp.Session(*key)
    session.login()
    _pa_session, _pa_session_for = session, key
    return session


def _pa_drop_session() -> None:
    global _pa_session, _pa_session_for
    _pa_session = _pa_session_for = None


# Fields PhysiApp is the authority on. Anything else on an entry — load, band,
# secs, notes you typed — is yours and never written by a sync.
PA_FIELDS = ("reps", "sets", "hold")


def _pa_apply(entry: dict, rec: dict) -> None:
    """Write one PhysiApp result onto an entry, and remember what they said."""
    entry["logged"] = True
    entry["via"] = "physiapp"
    for k in PA_FIELDS:
        if rec.get(k) is not None:
            entry[k] = rec[k]
    if rec.get("weight"):
        entry["load"] = rec["weight"]
        entry["loadUnit"] = rec.get("weightUnit") or "lb"
    if rec.get("feedback"):
        entry["notes"] = rec["feedback"]
    entry["paSnap"] = {k: entry.get(k) for k in PA_FIELDS}


def _pa_edited(entry: dict) -> bool:
    """True if you changed a synced row by hand since it last came across.

    Without this, every re-sync would quietly undo your correction. The
    snapshot is what PhysiApp last reported; if the row no longer matches it,
    the difference is yours and wins.
    """
    snap = entry.get("paSnap")
    if not isinstance(snap, dict):
        return False
    return any(entry.get(k) != snap.get(k) for k in PA_FIELDS)


def physiapp_sync(payload) -> dict:
    """Pull what PhysiApp actually recorded and write it into the log.

    Only exercises you genuinely ticked off come across. PhysiApp renders a
    fully populated form for untouched exercises too — prefilled with the
    prescribed sets and reps — and physiapp.parse_exercise refuses those, so nothing is
    ever invented here.

    Entries land with side "B". PhysiApp records one figure per exercise with
    no left/right split, so splitting it across two rows would be a guess.
    """
    payload = payload or {}
    try:
        days = max(1, min(31, int(payload.get("days") or 1)))
    except (TypeError, ValueError):
        days = 1
    auto = bool(payload.get("auto"))

    # Read under the lock, then let go of it. A 30-day sync is hundreds of
    # requests and several minutes; holding the write lock across that would
    # block every save the app tries to make while it runs.
    with _lock:
        data = read_data()
    settings = data.setdefault("settings", {})
    creds = settings.get("physiapp") or {}

    if auto:
        if settings.get("physiappAuto") is False:
            return {"ok": True, "skipped": "off", "message": ""}
        if not (creds.get("code") and creds.get("birthYear")):
            return {"ok": True, "skipped": "nocreds", "message": ""}
        last = settings.get("physiappLastSync")
        if last:
            try:
                age = (datetime.now() - datetime.fromisoformat(last)).total_seconds()
                if 0 <= age < AUTO_COOLDOWN_SECS:
                    return {"ok": True, "skipped": "recent", "message": "",
                            "syncedAt": last}
            except ValueError:
                pass

    try:
        session = _pa_get_session(creds)
    except physiapp.PhysiAppError:
        _pa_drop_session()
        raise

    items = {i["id"]: i for i in load_program_items()}
    dates = physiapp.date_range(days, payload.get("date"))
    added = updated = kept = filled = 0
    unmapped: list = []
    per_day: dict = {}

    # ---- phase 1: the network walk, unlocked --------------------------
    harvest: dict = {}
    saw_program = False
    for date in dates:
        try:
            got = physiapp.fetch_day(session, date)
        except physiapp.PhysiAppError:
            # A cached session can expire mid-sync. Sign in once more and
            # carry on; if that fails too, the error is real.
            _pa_drop_session()
            session = _pa_get_session(creds)
            got = physiapp.fetch_day(session, date)
        saw_program = saw_program or got["hasProgram"]
        if got["records"]:
            harvest[date] = got["records"]

    if not saw_program:
        # Every date came back with no tiles at all. One empty date is normal
        # (before the program started); all of them means we are no longer
        # reading their page correctly, and silence would be worse than noise.
        raise physiapp.PhysiAppError(
            "PhysiApp showed no program at all between %s and %s — their page layout may have changed."
            % (_pretty(dates[0]), _pretty(dates[-1])), "markup")

    # ---- phase 2: merge and save, locked and quick --------------------
    with _lock:
        data = read_data()  # re-read: the app may have saved while we fetched
        settings = data.setdefault("settings", {})
        for date, found in harvest.items():
            day = data.setdefault("days", {}).setdefault(
                date, {"checkin": {}, "checklist": {}, "notes": "", "entries": []})
            day.setdefault("entries", [])
            names = []
            for rec in found:
                pid = rec.get("pid")
                item = items.get(pid)
                if not item:
                    unmapped.append(rec.get("name") or "index %s" % rec.get("index"))
                    continue
                names.append(item["id"])
                mine = [e for e in day["entries"] if e.get("pid") == pid]
                theirs = [e for e in mine if e.get("via") == "physiapp"]
                manual = [e for e in mine if e.get("via") != "physiapp"]

                if any(e.get("logged") for e in manual):
                    # You ticked this off here yourself. Yours stands.
                    kept += 1
                    continue
                if manual:
                    # Unlogged rows: scaffolding the app creates when you open
                    # an exercise, not a claim about what you did. Letting them
                    # block a real PhysiApp result left the exercise showing as
                    # not done when you had in fact done it. Fill them instead.
                    # Both sides get the same figure — PhysiApp does not split
                    # left from right.
                    for e in manual:
                        _pa_apply(e, rec)
                    filled += len(manual)
                    continue
                if theirs:
                    # There can be more than one — a filled left/right pair.
                    # Each is judged on its own: an edited row is yours and
                    # stands, the rest track PhysiApp.
                    for e in theirs:
                        if _pa_edited(e):
                            # You corrected this after it synced. Leave it —
                            # an auto-sync on every open must never undo that.
                            kept += 1
                        else:
                            _pa_apply(e, rec)
                            updated += 1
                else:
                    entry = {"id": _uid(), "pid": pid, "ex": item["ex"], "side": "B"}
                    _pa_apply(entry, rec)
                    day["entries"].append(entry)
                    added += 1
            if names:
                per_day[date] = len(names)

        settings["physiappLastSync"] = datetime.now().isoformat(timespec="seconds")
        write_data(data)

    touched = added + updated + filled
    span = _pretty(dates[0]) if days == 1 else "%s–%s" % (_pretty(dates[0]), _pretty(dates[-1]))
    if touched:
        msg = "Brought in %d exercise%s from PhysiApp (%s)" % (
            touched, "" if touched == 1 else "s", span)
    elif kept:
        msg = "Nothing new — %s already logged here by hand (%s)" % (
            "it was" if kept == 1 else "they were", span)
    else:
        msg = "PhysiApp has nothing ticked off for %s" % span
    return {"ok": True, "message": msg, "dates": dates, "added": added,
            "updated": updated, "filled": filled, "keptYours": kept, "perDay": per_day,
            "unmapped": unmapped, "syncedAt": settings["physiappLastSync"]}


class DataUnreadable(Exception):
    """The file exists but cannot be parsed — never treat that as 'no data'."""


def read_data() -> dict:
    if not DATA_FILE.exists():
        return {}
    try:
        with DATA_FILE.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        # Returning {} here would look like a brand-new install to the app,
        # which would then seed a blank document and save it over the top.
        print(f"  !! could not read {DATA_FILE}: {exc}", file=sys.stderr)
        raise DataUnreadable(str(exc)) from exc


def write_data(payload: dict) -> None:
    """Atomic replace, keeping a rolling set of timestamped backups."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if DATA_FILE.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        try:
            shutil.copy2(DATA_FILE, BACKUP_DIR / f"rehab-data-{stamp}.json")
        except OSError as exc:
            print(f"  !! backup failed: {exc}", file=sys.stderr)
        # Keep every backup from the last 7 days regardless of count, so a
        # burst of saves in one session cannot roll older days out of reach.
        backups = sorted(BACKUP_DIR.glob("rehab-data-*.json"))
        cutoff = time.time() - 7 * 86400
        for stale in backups[:-MAX_BACKUPS]:
            try:
                if stale.stat().st_mtime < cutoff:
                    stale.unlink()
            except OSError:
                pass

    tmp = DATA_FILE.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.flush()
        os.fsync(fh.fileno())
    tmp.replace(DATA_FILE)


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ACLRehab/1.0"
    protocol_version = "HTTP/1.1"

    # ---- helpers -------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # Code and data must never be stale, but the exercise photos never
        # change — letting them cache stops every re-render re-downloading
        # them, which showed up as thumbnails flashing grey.
        if ctype.startswith("image/"):
            self.send_header("Cache-Control", "public, max-age=604800")
        else:
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def _resolve(self, path: str) -> Path | None:
        """Map a URL path to a file inside APP_DIR, or None if it escapes."""
        rel = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        if rel in ("", "/"):
            rel = "index.html"
        target = (APP_DIR / rel).resolve()
        try:
            target.relative_to(APP_DIR)
        except ValueError:
            return None
        return target

    # ---- verbs ---------------------------------------------------------
    def do_GET(self):  # noqa: N802
        if self.path.split("?")[0] == "/api/info":
            ip = lan_ip()
            port = self.server.server_address[1]
            self._json(200, {"lan": ("http://%s:%s" % (ip, port)) if ip else None, "port": port})
            return
        if self.path.split("?")[0] == "/api/data":
            with _lock:
                try:
                    self._json(200, read_data())
                except DataUnreadable as exc:
                    self._json(500, {"error": f"data file unreadable: {exc}"})
            return

        target = self._resolve(self.path)
        if target is None:
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            # Unknown path -> hand back the SPA shell.
            target = APP_DIR / "index.html"
            if not target.is_file():
                self._send(404, b"not found", "text/plain; charset=utf-8")
                return
        ctype = MIME.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, target.read_bytes(), ctype)

    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/api/physiapp/sync":
            self._json(404, {"error": "unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        payload = None
        if 0 < length <= MAX_BODY:
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = None
        # No lock here on purpose: a 30-day sync is minutes of network, and
        # physiapp_sync takes the lock only for the read and the merge.
        try:
            self._json(200, physiapp_sync(payload))
        except physiapp.PhysiAppError as exc:
            self._json(200, {"ok": False, "message": str(exc),
                             "kind": getattr(exc, "kind", "network")})
        except DataUnreadable as exc:
            self._json(500, {"error": "data file unreadable: %s" % exc})

    def do_PUT(self):  # noqa: N802
        if self.path.split("?")[0] != "/api/data":
            self._json(404, {"error": "unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._json(400, {"error": "bad Content-Length"})
            return
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"error": "empty or oversized body"})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": f"invalid JSON: {exc}"})
            return
        if not isinstance(payload, dict):
            self._json(400, {"error": "payload must be an object"})
            return
        with _lock:
            write_data(payload)
        self._json(200, {"ok": True, "savedAt": datetime.now().isoformat(timespec="seconds")})

    def log_message(self, fmt, *args):  # quieter console
        if self.command == "PUT":
            print(f"  saved  {time.strftime('%H:%M:%S')}")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def lan_ip() -> str | None:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="ACL Rehab Tracker server")
    ap.add_argument("--port", type=int, default=8757)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--data", type=Path, help="use a different data file (for testing)")
    args = ap.parse_args()

    if args.data:
        use_data_file(args.data)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not APP_DIR.is_dir():
        print(f"error: {APP_DIR} is missing", file=sys.stderr)
        return 1

    try:
        httpd = Server(("0.0.0.0", args.port), Handler)
    except OSError as exc:
        print(f"error: could not bind port {args.port}: {exc}", file=sys.stderr)
        print("       another copy may already be running.", file=sys.stderr)
        return 1

    url = f"http://localhost:{args.port}"
    ip = lan_ip()
    print()
    print("  ACL Rehab Tracker")
    print(f"  on this Mac : {url}")
    if ip:
        print(f"  on your phone: http://{ip}:{args.port}   (same Wi-Fi)")
    print(f"  data file    : {DATA_FILE}")
    print("\n  Press Ctrl-C to stop.\n")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.\n")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
