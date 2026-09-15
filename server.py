#!/usr/bin/env python3
"""ACL Rehab Tracker: tiny stdlib-only web server.

Serves the single-page app in ./app and persists all user data to
./data/rehab-data.json (atomic writes, a backup per save, none deleted).

    python3 server.py            -> http://localhost:8757
    python3 server.py --port 9000
"""

from __future__ import annotations

import argparse
import hashlib
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
import pa_import  # noqa: E402

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
# Frozen copy of the interface as it was before the redesign, served at
# /baseline/ for side-by-side comparison. Absent is fine; the route 404s.
BASELINE_DIR = ROOT / "app-baseline"
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "rehab-data.json"
BACKUP_DIR = DATA_DIR / "backups"


# Restore points that are never pruned (2026-09-15, audit A13 and A14): one
# when the server starts, one on the first save of each day, and one before
# any save that holds fewer records than the file it replaces.
SNAP_DIR = DATA_DIR / "snapshots"


def use_data_file(path: Path) -> None:
    """Point the server at a different data file (used for scratch testing)."""
    global DATA_DIR, DATA_FILE, BACKUP_DIR, SNAP_DIR
    DATA_FILE = path.resolve()
    DATA_DIR = DATA_FILE.parent
    BACKUP_DIR = DATA_DIR / "backups"
    SNAP_DIR = DATA_DIR / "snapshots"
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
    """Read the clinician program out of app/data/program.js, that file stays the
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
# would be pure waste. Cached in memory only, the cookie never touches disk.
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


# The merge rules live in pa_import.py, pure and tested. This file only
# fetches, locks and saves.

# What the last attempt did, for an honest status line. Memory only: a check
# is Mac state, and writing it into the synced document would push a change to
# every device after every look at PhysiApp.
_pa_status = {"lastAttempt": None, "lastError": None, "lastErrorKind": None}

PHYSIAPP_OFF = False


def physiapp_sync(payload) -> dict:
    """Pull what PhysiApp actually recorded and write it into the log.

    Only exercises you genuinely ticked off come across. PhysiApp renders a
    fully populated form for untouched exercises too, prefilled with the
    prescribed sets and reps, and physiapp.parse_exercise refuses those, so nothing is
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

    _pa_status["lastAttempt"] = datetime.now().isoformat(timespec="seconds")
    try:
        session = _pa_get_session(creds)
    except physiapp.PhysiAppError as exc:
        _pa_drop_session()
        _pa_status["lastError"] = str(exc)
        _pa_status["lastErrorKind"] = getattr(exc, "kind", "network")
        raise

    items = {i["id"]: i for i in load_program_items()}
    dates = physiapp.date_range(days, payload.get("date"))

    # ---- phase 1: the network walk, unlocked --------------------------
    harvest: dict = {}
    saw_program = False
    try:
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
                "PhysiApp showed no program at all between %s and %s, their page layout may have changed."
                % (_pretty(dates[0]), _pretty(dates[-1])), "markup")
    except physiapp.PhysiAppError as exc:
        _pa_status["lastError"] = str(exc)
        _pa_status["lastErrorKind"] = getattr(exc, "kind", "network")
        raise

    # ---- phase 2: merge and save, locked and quick --------------------
    with _lock:
        data = read_data()  # re-read: the app may have saved while we fetched
        settings = data.setdefault("settings", {})
        out = pa_import.merge(data, harvest, items, int(time.time() * 1000))
        now = datetime.now().isoformat(timespec="seconds")
        now_ms = int(time.time() * 1000)
        settings["physiappLastSync"] = now
        pa_import.stamp(data, "s|physiappLastSync", now_ms)
        if out["added"] or out["updated"]:
            settings["physiappLastImport"] = now
            pa_import.stamp(data, "s|physiappLastImport", now_ms)
        write_data(data)
    _pa_status["lastError"] = _pa_status["lastErrorKind"] = None

    new = out["added"] + out["updated"]
    span = _pretty(dates[0]) if days == 1 else "%s to %s" % (_pretty(dates[0]), _pretty(dates[-1]))
    if new:
        msg = "Brought in %d exercise%s from PhysiApp (%s)" % (new, "" if new == 1 else "s", span)
    elif out["review"]:
        msg = "%d PhysiApp exercise%s need%s a look: the name did not match your program (%s)" % (
            len(out["review"]), "" if len(out["review"]) == 1 else "s",
            "s" if len(out["review"]) == 1 else "", span)
    elif out["keptYours"] or out["unchanged"]:
        msg = "Checked PhysiApp: nothing new (%s)" % span
    else:
        msg = "PhysiApp has nothing ticked off for %s" % span
    return {"ok": True, "message": msg, "dates": dates, "added": out["added"],
            "updated": out["updated"], "unchanged": out["unchanged"],
            "keptYours": out["keptYours"], "perDay": out["perDay"],
            "review": out["review"], "syncedAt": settings["physiappLastSync"]}


def media_index() -> dict:
    """The songs on this Mac (data/media/index.json), or none."""
    f = DATA_DIR / "media" / "index.json"
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"songs": []}


class DataUnreadable(Exception):
    """The file exists but cannot be parsed, never treat that as 'no data'."""


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


class BackupFailed(Exception):
    """A required backup could not be written, so the save is refused."""


class RefusedWrite(Exception):
    """A save that would empty a store holding records."""


def count_records(doc: dict) -> int:
    """His records, roughly as the app counts them: enough to spot a save that
    would empty the store or drop records, never used to decide a merge."""
    if not isinstance(doc, dict):
        return 0
    n = 0
    for name in ("measurements", "mrss", "customExercises", "supplements", "prnMeds", "doses"):
        v = doc.get(name)
        if isinstance(v, list):
            n += len(v)
    for name in ("planGoals", "planFocus"):
        v = doc.get(name)
        if isinstance(v, dict):
            n += len(v)
    days = doc.get("days")
    if isinstance(days, dict):
        for day in days.values():
            n += 1
            if isinstance(day, dict) and isinstance(day.get("entries"), list):
                n += len(day["entries"])
    return n


BUCKETS = ("measurements", "mrss", "customExercises", "supplements", "prnMeds", "doses",
           "planGoals", "planFocus", "days", "caseFile", "settings", "program", "melbourne")


def _holds(v) -> bool:
    return isinstance(v, (list, dict)) and len(v) > 0


def missing_buckets(current, payload) -> list:
    """Collections the saved file holds records in that the payload lacks as a
    key altogether (Codex audit, partial-bucket reductions). An emptied list or
    map is an edit and is allowed, with the snapshot before a reduction."""
    if not isinstance(current, dict) or not isinstance(payload, dict):
        return []
    return [k for k in BUCKETS if _holds(current.get(k)) and k not in payload]


def data_rev() -> str:
    """A revision id for the file on disk: changes whenever its bytes do."""
    try:
        return hashlib.sha256(DATA_FILE.read_bytes()).hexdigest()[:20]
    except OSError:
        return "none"


def _unique(stem: str, folder: Path) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = folder / f"{stem}-{stamp}.json"
    k = 1
    while path.exists():   # never overwrite an earlier copy
        path = folder / f"{stem}-{stamp}-{k}.json"
        k += 1
    return path


def snapshot(reason: str) -> Path | None:
    """An immutable restore point in data/snapshots/, never pruned."""
    if not DATA_FILE.exists():
        return None
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    dest = _unique(f"rehab-data-{reason}", SNAP_DIR)
    try:
        shutil.copy2(DATA_FILE, dest)
    except OSError as exc:
        raise BackupFailed(f"snapshot ({reason}) failed: {exc}") from exc
    return dest


def write_data(payload: dict) -> None:
    """Atomic replace, keeping a timestamped backup of every save (never pruned).

    2026-09-15 (audit A13, A14): a save that would empty a store holding
    records is refused; a save holding fewer records than the file first takes
    a snapshot that is never pruned, as does the first save of each day; every
    backup has a unique name, and if a backup cannot be written the save is
    refused rather than made without one."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    if DATA_FILE.exists():
        try:
            current = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            current = None
        have = count_records(current) if current is not None else 0
        want = count_records(payload)
        if have > 0 and want == 0:
            raise RefusedWrite(f"refusing to replace {have} records with an empty document")
        gone = missing_buckets(current, payload)
        if gone:
            # A whole collection absent from the document is the sync wipe trap
            # (a copy made by code that does not know the key), never an edit:
            # deleting his records leaves the key there, empty.
            raise RefusedWrite("refusing a document without %s, which the saved file holds" % ", ".join(gone))
        if current is not None and want < have:
            snapshot("before-reduce")
        today = datetime.now().strftime("%Y%m%d")
        if not SNAP_DIR.exists() or not any(SNAP_DIR.glob(f"rehab-data-day-{today}-*.json")):
            snapshot("day")

        try:
            shutil.copy2(DATA_FILE, _unique("rehab-data", BACKUP_DIR))
        except OSError as exc:
            raise BackupFailed(f"backup failed: {exc}") from exc
        # 2026-09-15 (Codex audit B14): backups are never deleted by the app.
        # This loop used to remove any beyond the newest 300 that were older
        # than 7 days, against the standing rule that nothing removes a backup.
        # The folder now only grows; its size is reported by tools/catchup.py.

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
        # change: letting them cache stops every re-render re-downloading
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

    def _send_media(self, name: str) -> None:
        """His own audio, from data/media/ beside the data file. Never from app/,
        so nothing here can ever be published with the shell. Range requests,
        because Safari will not play audio from a server without them."""
        media = (DATA_DIR / "media").resolve()
        target = (media / name).resolve()
        try:
            target.relative_to(media)
        except ValueError:
            self._send(403, b"forbidden", "text/plain; charset=utf-8")
            return
        if not target.is_file() or target.name == "index.json":
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        size = target.stat().st_size
        ctype = {".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".aac": "audio/aac"}.get(target.suffix.lower(), "application/octet-stream")
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        code = 200
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            try:
                if a:
                    start = int(a)
                    end = int(b) if b else size - 1
                else:
                    start = max(0, size - int(b))
                end = min(end, size - 1)
                code = 206
            except ValueError:
                start, end, code = 0, size - 1, 200
        if start > end:
            self._send(416, b"", "text/plain; charset=utf-8", {"Content-Range": "bytes */%d" % size})
            return
        with target.open("rb") as fh:
            fh.seek(start)
            body = fh.read(end - start + 1)
        extra = {"Accept-Ranges": "bytes"}
        if code == 206:
            extra["Content-Range"] = "bytes %d-%d/%d" % (start, end, size)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=86400")
        for k, v in extra.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj, extra: dict | None = None) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8", extra)

    def _resolve(self, path: str) -> Path | None:
        """Map a URL path to a file inside APP_DIR, or None if it escapes.

        /baseline/... serves the FROZEN pre-redesign copy instead, so the old
        and new interfaces can be opened side by side against the same live
        data. It is a plain snapshot of app/ and talks to the same API, so what
        you tick in one shows up in the other.
        """
        rel = path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
        root = APP_DIR
        if rel == "baseline" or rel.startswith("baseline/"):
            if not BASELINE_DIR.is_dir():
                return None
            root = BASELINE_DIR
            rel = rel[len("baseline"):].lstrip("/")
        if rel in ("", "/"):
            rel = "index.html"
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
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
        if self.path.split("?")[0] == "/api/media":
            self._json(200, media_index())
            return
        if self.path.startswith("/media/"):
            self._send_media(urllib.parse.unquote(self.path.split("?")[0][len("/media/"):]))
            return
        if self.path.split("?")[0] == "/api/physiapp/status":
            self._json(200, dict(_pa_status, off=PHYSIAPP_OFF))
            return
        if self.path.split("?")[0] == "/api/data":
            with _lock:
                try:
                    self._json(200, read_data(), {"X-Data-Rev": data_rev()})
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
        # Every body is read first, whatever the endpoint. Left unread on a
        # kept-alive connection it becomes the start of the next request, which
        # then fails with a 501: an import's save after its snapshot did exactly
        # that (found by tools/test_flows.py settings_io), and so did anything
        # after a PhysiApp request on a test copy.
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if 0 < length <= MAX_BODY else b""
        if self.path.split("?")[0] == "/api/snapshot":
            # A verified restore point before an import (Codex audit B15). JSON
            # only, so a page on another site cannot trigger it without a
            # preflight this server never answers.
            if not (self.headers.get("Content-Type") or "").startswith("application/json"):
                self._json(415, {"error": "json only"})
                return
            with _lock:
                try:
                    dest = snapshot("before-import")
                except BackupFailed as exc:
                    self._json(503, {"error": str(exc)})
                    return
                if dest is None:
                    self._json(200, {"ok": True, "empty": True})
                    return
                same = hashlib.sha256(dest.read_bytes()).hexdigest() == hashlib.sha256(DATA_FILE.read_bytes()).hexdigest()
                self._json(200 if same else 503, {"ok": same, "name": dest.name, "rev": data_rev()})
            return
        if self.path.split("?")[0] != "/api/physiapp/sync":
            self._json(404, {"error": "unknown endpoint"})
            return
        if PHYSIAPP_OFF:
            # A test copy: never sign in to their site, whatever the data says.
            self._json(200, {"ok": True, "skipped": "off", "message": ""})
            return
        payload = None
        if raw:
            try:
                payload = json.loads(raw.decode("utf-8"))
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
        except (BackupFailed, RefusedWrite) as exc:
            self._json(200, {"ok": False, "message": "Not saved: %s" % exc, "kind": "save"})

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
            # A page that read an older file must merge before it writes
            # (audit A13): two tabs, or a PhysiApp import, would otherwise be
            # silently replaced by whichever saved last.
            # 2026-09-15 (Codex audit B13): a write to a file that exists must
            # quote its revision. A page that sends none (a tab left open from
            # before revisions existed) could otherwise replace newer work with
            # no check at all. It gets 428 and the newer document, which this
            # build merges exactly like a 409; an old page is told to reload.
            expected = self.headers.get("If-Match")
            exists = DATA_FILE.exists()
            if (exists and not expected) or (expected and expected != data_rev()):
                try:
                    current = read_data()
                except DataUnreadable as exc:
                    self._json(500, {"error": f"data file unreadable: {exc}"})
                    return
                if not expected:
                    self._json(428, {"error": "this page is out of date: reload it before saving",
                                     "rev": data_rev(), "doc": current})
                    return
                self._json(409, {"error": "stale", "rev": data_rev(), "doc": current})
                return
            try:
                write_data(payload)
            except RefusedWrite as exc:
                self._json(422, {"error": str(exc)})
                return
            except BackupFailed as exc:
                self._json(503, {"error": str(exc)})
                return
            rev = data_rev()
        self._json(200, {"ok": True, "savedAt": datetime.now().isoformat(timespec="seconds"), "rev": rev},
                   {"X-Data-Rev": rev})

    def log_message(self, fmt, *args):  # quieter console
        if self.command == "PUT":
            print(f"  saved  {time.strftime('%H:%M:%S')}")


def app_readable() -> bool:
    """True if this process can still read the app files it serves."""
    try:
        with open(APP_DIR / "index.html", "rb") as fh:
            fh.read(1)
        return True
    except OSError:
        return False


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def handle_error(self, request, client_address):
        # macOS can revoke this process's access to the Desktop folder once the
        # app that launched it is gone. Every request then fails with
        # "Operation not permitted" while the port stays bound, the app looks
        # broken and a healthy relaunch cannot take the port. Quit instead of
        # squatting on it; start.command relaunches cleanly.
        if isinstance(sys.exc_info()[1], PermissionError) and not app_readable():
            print(
                f"\n  lost read access to {APP_DIR} (macOS file permissions)."
                "\n  shutting down so a fresh launch can take port.\n",
                file=sys.stderr,
                flush=True,
            )
            os._exit(13)
        super().handle_error(request, client_address)


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
    ap.add_argument("--lan", action="store_true",
                    help="also listen on the local network (off by default: the data API has no sign-in)")
    ap.add_argument("--no-physiapp", action="store_true",
                    help="refuse PhysiApp imports (test copies must never reach their site)")
    args = ap.parse_args()

    if args.data:
        use_data_file(args.data)
    if args.no_physiapp:
        global PHYSIAPP_OFF
        PHYSIAPP_OFF = True

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        snapshot("startup")
    except BackupFailed as exc:
        print(f"  !! {exc}", file=sys.stderr)
    if not APP_DIR.is_dir():
        print(f"error: {APP_DIR} is missing", file=sys.stderr)
        return 1

    if not app_readable():
        print(f"error: cannot read {APP_DIR / 'index.html'}", file=sys.stderr)
        print("       macOS is blocking this process from the Desktop folder.", file=sys.stderr)
        print("       Launch the app by double-clicking start.command.", file=sys.stderr)
        return 1

    try:
        # This Mac only (audit A29). The phone uses the installed app and the
        # sync relay, never this server, and /api/data has no sign-in, so
        # listening on the network would let any device on the Wi-Fi read or
        # replace the record. --lan opts back in.
        httpd = Server(("0.0.0.0" if args.lan else "127.0.0.1", args.port), Handler)
    except OSError as exc:
        print(f"error: could not bind port {args.port}: {exc}", file=sys.stderr)
        print("       another copy may already be running.", file=sys.stderr)
        return 1

    url = f"http://localhost:{args.port}"
    ip = lan_ip()
    print()
    print("  ACL Rehab Tracker")
    print(f"  on this Mac : {url}")
    if ip and args.lan:
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
