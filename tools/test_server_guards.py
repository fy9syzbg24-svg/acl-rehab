#!/usr/bin/env python3
"""Server write guards (2026-09-15, audit A13, A14, A29), against a scratch copy.

Starts server.py on a spare port with a temporary data file (never the live
one, never PhysiApp), then checks: a stale write is refused with the newer
document, an empty document never replaces records, a save holding fewer
records leaves a snapshot that is never pruned, backup names never collide, and
the server listens on this Mac only.

    python3 tools/test_server_guards.py
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8794
results = []


def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  got={got!r} want={want!r}"))


def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=data, method=method,
                               headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(r, timeout=5) as res:
            return res.status, dict(res.headers), json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), json.loads(e.read() or b"null")


def doc(n_days):
    return {"schema": 7, "settings": {}, "days": {f"2026-09-{d + 1:02d}": {"notes": "", "entries": [{"id": f"e{d}", "logged": True}]} for d in range(n_days)}}


tmp = Path(tempfile.mkdtemp(prefix="rehab-guards-"))
data_file = tmp / "rehab-data.json"
data_file.write_text(json.dumps(doc(3)))
proc = subprocess.Popen([sys.executable, str(ROOT / "server.py"), "--port", str(PORT), "--no-browser",
                         "--no-physiapp", "--data", str(data_file)],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            socket.create_connection(("127.0.0.1", PORT), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)

    code, headers, body = req("GET", "/api/data")
    rev = headers.get("X-Data-Rev")
    check("GET gives a revision", bool(rev), True)
    check("startup snapshot taken", len(list((tmp / "snapshots").glob("rehab-data-startup-*.json"))), 1)

    code, _, body = req("PUT", "/api/data", doc(3), {"If-Match": "not-the-current-one"})
    check("a stale write is refused", code, 409)
    check("and handed the newer document", len(body.get("doc", {}).get("days", {})), 3)

    code, _, body = req("PUT", "/api/data", {"schema": 7, "settings": {}}, {"If-Match": rev})
    check("an empty document never replaces records", code, 422)
    check("the file still holds them", len(json.loads(data_file.read_text())["days"]), 3)

    code, headers, body = req("PUT", "/api/data", doc(2), {"If-Match": rev})
    check("a real save with the right revision lands", code, 200)
    check("before a reduction, a snapshot", len(list((tmp / "snapshots").glob("rehab-data-before-reduce-*.json"))), 1)
    check("first save of the day, a snapshot", len(list((tmp / "snapshots").glob("rehab-data-day-*.json"))), 1)
    new_rev = headers.get("X-Data-Rev")
    for _ in range(3):
        code, headers, _ = req("PUT", "/api/data", doc(2), {"If-Match": new_rev})
        new_rev = headers.get("X-Data-Rev") or new_rev
    backups = list((tmp / "backups").glob("rehab-data-*.json"))
    check("four quick saves, four distinct backups", len(backups), 4)

    code, _, _ = req("PUT", "/api/data", doc(2))
    check("an older page without a revision can still save", code, 200)

    lan = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        lan = s.getsockname()[0]
        s.close()
    except OSError:
        pass
    if lan and not lan.startswith("127."):
        try:
            socket.create_connection((lan, PORT), timeout=1).close()
            reachable = True
        except OSError:
            reachable = False
        check("not reachable from the network address", reachable, False)
finally:
    proc.terminate()
    proc.wait(timeout=5)
    shutil.rmtree(tmp, ignore_errors=True)

print(f"\n{sum(results)} of {len(results)} pass")
sys.exit(0 if all(results) else 1)
