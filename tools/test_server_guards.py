#!/usr/bin/env python3
"""Server write guards (2026-09-15, audit A13, A14, A29; Codex audit B13, B14, B15), against a scratch copy.

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

    # Codex audit B13: a write without a revision is refused, with the newer document.
    before = data_file.read_bytes()
    code, _, body = req("PUT", "/api/data", doc(1))
    check("a page without a revision is refused", code, 428)
    check("and handed the saved document to merge", len((body or {}).get("doc", {}).get("days", {})), 2)
    check("the file is byte for byte unchanged", data_file.read_bytes() == before, True)

    # Two writers quoting the same revision: the first lands, the second is stale.
    code_a, headers_a, _ = req("PUT", "/api/data", doc(2) | {"settings": {"a": 1}}, {"If-Match": new_rev})
    code_b, _, body_b = req("PUT", "/api/data", doc(2) | {"settings": {"b": 1}}, {"If-Match": new_rev})
    check("simultaneous writers: the first lands, the second is refused", [code_a, code_b], [200, 409])
    check("and the second is handed what the first wrote", (body_b or {}).get("doc", {}).get("settings"), {"a": 1})
    new_rev = headers_a.get("X-Data-Rev")

    # Truly at once, on two threads: exactly one lands.
    import threading
    got = []
    def put(tag):
        got.append(req("PUT", "/api/data", doc(2) | {"settings": {tag: 1}}, {"If-Match": new_rev})[0])
    threads = [threading.Thread(target=put, args=(k,)) for k in ("x", "y")]
    [th.start() for th in threads]
    [th.join() for th in threads]
    check("two threads with one revision: one 200, one 409", sorted(got), [200, 409])
    new_rev = req("GET", "/api/data")[1].get("X-Data-Rev")

    # A whole collection missing is refused; the same collection emptied is an edit.
    with_tests = doc(2) | {"measurements": [{"id": "m1", "value": 1}, {"id": "m2", "value": 2}]}
    code, headers, _ = req("PUT", "/api/data", with_tests, {"If-Match": new_rev})
    new_rev = headers.get("X-Data-Rev") or new_rev
    before = data_file.read_bytes()
    code, _, body = req("PUT", "/api/data", doc(2), {"If-Match": new_rev})
    check("a document missing the measurements key is refused", [code, "measurements" in (body or {}).get("error", "")], [422, True])
    check("the two tests are still in the file, exact", json.loads(data_file.read_text())["measurements"], with_tests["measurements"])
    snaps_before = len(list((tmp / "snapshots").glob("rehab-data-before-reduce-*.json")))
    code, headers, _ = req("PUT", "/api/data", doc(2) | {"measurements": [{"id": "m1", "value": 1}]}, {"If-Match": new_rev})
    new_rev = headers.get("X-Data-Rev") or new_rev
    check("removing one test is an edit and lands", code, 200)
    reduce_snaps = sorted((tmp / "snapshots").glob("rehab-data-before-reduce-*.json"))
    check("with a restore point first", len(reduce_snaps), snaps_before + 1)
    check("that holds both tests, exact", json.loads(reduce_snaps[-1].read_text())["measurements"], with_tests["measurements"])

    # Codex audit B14: no backup is ever deleted. Old, many, still there.
    for i in range(305):
        old = tmp / "backups" / f"rehab-data-20200101-000000-{i:06d}.json"
        old.write_text("{}")
        os.utime(old, (time.time() - 30 * 86400, time.time() - 30 * 86400))
    n_before = len(list((tmp / "backups").glob("rehab-data-*.json")))
    code, headers, _ = req("PUT", "/api/data", doc(2) | {"measurements": [{"id": "m1", "value": 1}]}, {"If-Match": new_rev})
    new_rev = headers.get("X-Data-Rev") or new_rev
    check("a save with 300+ month-old backups deletes none of them", len(list((tmp / "backups").glob("rehab-data-*.json"))), n_before + 1)

    # The verified restore point an import takes first.
    r = urllib.request.Request(f"http://127.0.0.1:{PORT}/api/snapshot", data=b"{}", method="POST", headers={"Content-Type": "text/plain"})
    try:
        urllib.request.urlopen(r, timeout=5)
        plain = 200
    except urllib.error.HTTPError as e:
        plain = e.code
    check("a snapshot request that is not JSON is refused", plain, 415)
    code, _, body = req("POST", "/api/snapshot", {"reason": "before-import"})
    snap = tmp / "snapshots" / (body or {}).get("name", "missing")
    check("a snapshot is taken and verified", [code, body.get("ok"), snap.exists()], [200, True, True])
    check("byte for byte the data file", snap.exists() and snap.read_bytes() == data_file.read_bytes(), True)

    # The same kept-alive connection must still take the save that follows (a
    # body left unread became the next request line: 501, found by the flows).
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    conn.request("GET", "/api/data"); r = conn.getresponse(); r.read(); rev_now = r.getheader("X-Data-Rev")
    conn.request("POST", "/api/snapshot", body=json.dumps({"reason": "before-import"}), headers={"Content-Type": "application/json"})
    r = conn.getresponse(); r.read()
    body = json.dumps(doc(2) | {"measurements": [{"id": "m1", "value": 1}]})
    conn.request("PUT", "/api/data", body=body, headers={"Content-Type": "application/json", "If-Match": rev_now})
    r = conn.getresponse(); r.read()
    check("a save right after a snapshot on one connection lands", r.status, 200)
    conn.close()

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
