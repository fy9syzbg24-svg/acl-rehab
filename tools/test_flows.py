#!/usr/bin/env python3
"""Workout flows run to their end in REAL TIME (Codex audit, 2026-09-15).

A test that taps and takes a snapshot cannot see a timer that never ends (the
0:00 stall got past every such test). Each flow here opens the player the way
he does, lets holds, rests, switches and get ready run out on their own clocks,
taps Set done at a person's pace where a set is his, and then reads the saved
document to prove exactly what was recorded: no missing, overwritten or
duplicated rows, and never a review screen in the middle of a workout.

TEST server only (8767 by default, 8768 for the before build). Each flow runs in
its own throwaway headless Chrome at 393 x 852 with touch, full motion forced.
A flow logs real rows on the test copy: snapshot it first, restore it after.

    python3 tools/test_flows.py tendon                 # about 8 minutes
    python3 tools/test_flows.py cardio                 # about 21 minutes
    python3 tools/test_flows.py reps_each manual_both manual_each timed hold_left
    python3 tools/test_flows.py partial_arrows partial_swipe partial_close pause_resume lock two_tabs
    python3 tools/test_flows.py --base http://localhost:8768 partial_arrows two_tabs
    python3 tools/test_flows.py --out some/folder ...  # traces as JSON
"""
import argparse
import json
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fringe-planner" / "tools"))
import cdp  # noqa: E402

RESULTS = []
BASE = "http://localhost:8767"
OUT = None
# The back control he taps: the header's on a phone, the player's own elsewhere.
BACK = """(() => { const h = document.getElementById('nav-back'); if (h && !h.hidden && h.getBoundingClientRect().width) return h; return document.querySelector('.player [data-p="close"]'); })()"""
DRAFT = "try { return JSON.parse(localStorage.getItem('rehab.player.v1')); } catch { return null; }"


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + str(detail)) if detail != '' else ''}", flush=True)


def today():
    return time.strftime("%Y-%m-%d")


class Page:
    """One page target: a Chrome of its own, or a second tab in the same one."""

    def __init__(self, chrome=None, ws=None):
        self.chrome = chrome
        self.ws = ws or chrome.ws
        self._id = 0

    def call(self, method, **params):
        self._id += 1
        mid = self._id * 1000 + 7
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def js(self, code):
        res = self.call("Runtime.evaluate", expression="(async () => {" + code + "})()", awaitPromise=True, returnByValue=True)
        if res.get("exceptionDetails"):
            raise RuntimeError("JS error: " + json.dumps(res["exceptionDetails"])[:300])
        return res.get("result", {}).get("value")

    def setup(self, focus=True):
        self.call("Page.enable")
        self.call("Emulation.setDeviceMetricsOverride", width=393, height=852, deviceScaleFactor=3, mobile=True)
        self.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
        if focus:
            self.call("Emulation.setFocusEmulationEnabled", enabled=True)
        self.call("Page.addScriptToEvaluateOnNewDocument",
                  source="window.confirm = () => true; window.alert = () => {}; try { localStorage.setItem('rehab.motion', 'full'); } catch (e) {}")

    def goto(self, hash_, settle=2.5, date=None):
        self.call("Page.navigate", url=f"{BASE}/m.html?flow={time.time()}&probe=1{hash_}")
        time.sleep(settle)
        if date:
            self.js(f"const P = window.__rehabProbe; P.ctx.date = '{date}'; P.ctx.go('today'); await new Promise(r => setTimeout(r, 900)); return 1")

    def tap(self, sel):
        pt = self.js(f"const el = {sel}; if (!el) return null; el.scrollIntoView({{block: 'center'}}); await new Promise(r => setTimeout(r, 250)); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];")
        if not pt:
            return False
        self.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{"x": pt[0], "y": pt[1]}])
        self.call("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])
        return True

    def swipe_left(self, sel):
        box = self.js(f"const el = {sel}; if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height];")
        if not box:
            return False
        # Across the step pictures, as a finger would (perf_motion.py's swipe).
        x0, y = box[0] + box[2] * 0.8, box[1] + box[3] * 0.7
        x1 = box[0] + box[2] * 0.15
        self.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{"x": x0, "y": y}])
        for i in range(1, 7):
            self.call("Input.dispatchTouchEvent", type="touchMove", touchPoints=[{"x": x0 + (x1 - x0) * i / 6, "y": y}])
            time.sleep(0.016)
        self.call("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])
        return True

    def state(self):
        return self.js("""
          const pl = document.querySelector('.player');
          return {
            player: !!pl, review: !!document.querySelector('.player.review'),
            done: !!document.querySelector('.done-screen'), gap: !!document.querySelector('.done-screen.gap'),
            between: !!document.querySelector('.player.between'),
            title: document.querySelector('.player .p-title')?.textContent.trim() || null,
            // The label's own words, without the small "default" badge a rest may carry.
            phase: document.querySelector('.player .p-label')?.firstChild?.textContent.trim() || null,
            clock: document.querySelector('.player [data-p-clock]')?.textContent.trim() || null,
            status: document.querySelector('.player [data-slot="status"]')?.textContent.trim() || null,
            pause: document.querySelector('.player [data-p="pause"]')?.textContent.trim() || null,
            doneEnabled: !!document.querySelector('.player [data-p="done"]:not([disabled])'),
            finLine: document.querySelector('.done-screen .fin-line')?.textContent.trim() || null,
            wake: document.querySelector('[data-p-wake]')?.getAttribute('aria-label') || null,
            hash: location.hash,
          };
        """)


def data():
    with urllib.request.urlopen(f"{BASE}/api/data") as r:
        return json.load(r)


def rows(doc, iso, pid):
    return [e for e in doc.get("days", {}).get(iso, {}).get("entries", []) if e.get("pid") == pid]


def all_ids(doc):
    return [(iso, e.get("id")) for iso, d in doc.get("days", {}).items() for e in d.get("entries", [])]


def new_chrome():
    c = cdp.Chrome(tempfile.mkdtemp(prefix="rehab-flow-"), headless=True)
    c.assert_is_ours()
    p = Page(c)
    p.setup()
    return c, p


def save_trace(name, trace):
    if OUT:
        Path(OUT).mkdir(parents=True, exist_ok=True)
        (Path(OUT) / f"{name}.json").write_text(json.dumps(trace, indent=1))


def watch(p, until, limit_s, act=None, every=0.5):
    """Sample the player every half second until `until(state)` or the limit.
    `act(state)` may tap (a set done at his pace). Returns the trace."""
    trace = []
    t0 = time.time()
    last = None
    while time.time() - t0 < limit_s:
        st = p.state()
        key = (st["title"], st["phase"], st["review"], st["between"], st["done"])
        if key != last:
            trace.append({"t": round(time.time() - t0, 1), **st})
            last = key
        if until(st):
            trace.append({"t": round(time.time() - t0, 1), "end": True, **st})
            return trace
        if act:
            act(st)
        time.sleep(every)
    trace.append({"t": round(time.time() - t0, 1), "timeout": True})
    return trace


def open_row_and_begin(p, pid, start=True):
    p.tap(f"document.querySelector('[data-rowclick=\"{pid}\"]')")
    time.sleep(0.9)
    ok = p.tap(f"document.querySelector('[data-timer=\"{pid}\"]')")
    time.sleep(1.3)
    if start and ok:
        p.tap("document.querySelector('.player [data-p=\"pause\"]')")
        time.sleep(0.4)
    return ok


def leave_player(p):
    """Close without recording whatever is open now (confirm is answered yes)."""
    for _ in range(3):
        if not p.js("return !!document.querySelector('.player')"):
            return
        p.tap(BACK)
        time.sleep(0.8)
        if p.js("return !!document.querySelector('[data-s=\"discard\"]')"):
            p.tap("document.querySelector('[data-s=\"discard\"]')")
            time.sleep(0.8)


# --------------------------------------------------------------- flows ----
def flow_tendon():
    """The continuous tendon loading from Start on Today, run to its end untouched."""
    iso = today()
    c, p = new_chrome()
    with c:
        p.goto("#today")
        before = data()
        if any(e.get("logged") for e in rows(before, iso, "tl18")):
            check("tendon setup: not logged today", False)
            return
        p.tap("document.querySelector('[data-act=\"start\"]')")
        time.sleep(1.2)
        st = p.state()
        check("tendon: Start opens the tendon loading", st["title"] and "tendon" in st["title"].lower(), st["title"])
        p.tap("document.querySelector('.player [data-p=\"pause\"]')")   # the player's own Start
        time.sleep(0.3)
        t0 = time.time()
        trace = watch(p, lambda s: s["gap"] or not s["player"], 620)
        elapsed = time.time() - t0
        save_trace("tendon", trace)
        phases = [x["phase"] for x in trace if x.get("phase")]
        compact = [ph for i, ph in enumerate(phases) if i == 0 or ph != phases[i - 1]]
        check("tendon: ran hold, rest, hold, rest, hold, rest, hold by itself",
              compact == ["GET READY", "HOLD", "REST", "HOLD", "REST", "HOLD", "REST", "HOLD"], compact)
        check("tendon: no review screen at any point", not any(x.get("review") for x in trace))
        check("tendon: stopped on the recovery break", bool(trace[-1].get("gap")), trace[-1].get("finLine"))
        check("tendon: took the prescribed time in real time (485 s)", 480 <= elapsed <= 520, round(elapsed))
        time.sleep(2)
        after = data()
        mine = [e for e in rows(after, iso, "tl18") if e.get("logged")]
        check("tendon: exactly one logged row", len(mine) == 1, len(mine))
        if mine:
            e = mine[0]
            check("tendon: four full holds of 30 s", e.get("secsList") == [30, 30, 30, 30] and not e.get("partial"), e.get("secsList"))
            t = e.get("timing") or {}
            check("tendon: timing is the work and the rests (125 s active, 360 s rest)",
                  abs((t.get("activeSec") or 0) - 125) <= 3 and abs((t.get("restSec") or 0) - 360) <= 3, t)
            check("tendon: done at is recorded, from the player, unmarked", bool(e.get("doneAt")) and "doneAtFrom" not in e, e.get("doneAt"))
        lost = set(all_ids(before)) - set(all_ids(after))
        check("tendon: no other row lost", not lost, sorted(lost)[:5])
        p.tap(BACK)
        time.sleep(1.2)
        line = p.js("return document.querySelector('.recovery-line')?.textContent.trim() || null")
        check("tendon: Today shows when the rest may start", bool(line) and "after" in line.lower(), line)


def flow_cardio():
    """The elliptical from its row, the whole bout in real time, saved and carried on."""
    iso = today()
    c, p = new_chrome()
    with c:
        p.goto("#today")
        before = data()
        if not open_row_and_begin(p, "g_elliptical"):
            check("cardio setup: Begin on the elliptical", False)
            return
        st = p.state()
        check("cardio: the player runs the elliptical", st["title"] and "lliptical" in st["title"], st)
        mins = p.js("const d = JSON.parse(localStorage.getItem('rehab.player.v1')); const w = d.run.steps.find(s => s.kind === 'work'); return w ? w.secs : null")
        t0 = time.time()
        title0 = st["title"]
        trace = watch(p, lambda s: (s["title"] and s["title"] != title0) or not s["player"] or s["done"], (mins or 1200) + 120)
        elapsed = time.time() - t0
        save_trace("cardio", trace)
        check("cardio: no review screen", not any(x.get("review") for x in trace))
        check("cardio: carried on into the next exercise by itself", bool(trace[-1].get("title")) and trace[-1]["title"] != title0, trace[-1].get("title"))
        check("cardio: the bout ran its full length in real time", (mins or 0) + 4 <= elapsed <= (mins or 0) + 40, [mins, round(elapsed, 1)])
        receipt = p.js("return document.querySelector('.player .p-logged')?.textContent.trim() || null")
        ready = p.state()
        check("cardio: Logged receipt, and the next get ready runs by itself", bool(receipt) and ready["pause"] == "Pause", [receipt, ready["phase"], ready["pause"]])
        check("cardio: the receipt names the exercise, never its id", bool(receipt) and receipt.strip() != "Logged · elliptical", receipt)
        time.sleep(2)
        after = data()
        mine = [e for e in rows(after, iso, "g_elliptical") if e.get("logged") and e.get("timing") and e.get("id") not in {x.get("id") for x in rows(before, iso, "g_elliptical") if x.get("logged")}]
        check("cardio: one logged row", len(mine) == 1, len(mine))
        if mine:
            e = mine[0]
            want = round((mins or 1200) / 60, 1)
            check("cardio: minutes are the work (B02)", e.get("time") == want, [e.get("time"), want])
            check("cardio: not stored as a set, no seconds list", e.get("sets") in (None,) and not e.get("secsList"), [e.get("sets"), e.get("secsList")])
            t = e.get("timing") or {}
            check("cardio: timing active is the bout plus get ready", abs((t.get("activeSec") or 0) - ((mins or 1200) + 5)) <= 3, t)
        lost = set(all_ids(before)) - set(all_ids(after))
        check("cardio: no other row lost", not lost, sorted(lost)[:5])
        leave_player(p)


def reps_flow(name, pid, date, adjust=None, limit=900):
    """A set is his: tap Set done a moment after each set starts; rests and switches end by themselves."""
    c, p = new_chrome()
    with c:
        p.goto("#today", date=date)
        before = data()
        prior = {e.get("id") for e in rows(before, date, pid) if e.get("logged")}
        if not open_row_and_begin(p, pid):
            check(f"{name} setup: Begin", False)
            return None
        st0 = p.state()
        title0 = st0["title"]
        taps = {"n": 0, "at": None, "adj": 0}

        def act(st):
            if not st["doneEnabled"] or st["title"] != title0:
                taps["at"] = None
                return
            if st["phase"] not in ("WORK",):
                return
            if taps["at"] is None:
                taps["at"] = time.time()
                return
            if time.time() - taps["at"] >= 1.5:
                if adjust and taps["n"] == adjust["set"] and taps["adj"] < adjust["minus"]:
                    for _ in range(adjust["minus"]):
                        p.js("document.querySelector('.player [data-p=\"reps-\"]:not([disabled])')?.click(); return 1")
                    taps["adj"] = adjust["minus"]
                p.tap("document.querySelector('.player [data-p=\"done\"]:not([disabled])')")
                taps["n"] += 1
                taps["at"] = None

        trace = watch(p, lambda s: (s["title"] and s["title"] != title0) or not s["player"] or s["done"], limit, act=act)
        save_trace(name, trace)
        check(f"{name}: no review screen", not any(x.get("review") for x in trace))
        check(f"{name}: carried on into the next exercise", bool(trace[-1].get("title")) and trace[-1]["title"] != title0 or trace[-1].get("done"), trace[-1].get("title"))
        phases = [x["phase"] for x in trace if x.get("phase") and x.get("title") == title0]
        check(f"{name}: rests and switches ended by themselves", all(ph in ("GET READY", "WORK", "REST", "SWITCH SIDES", "HOLD") for ph in phases), sorted(set(phases)))
        time.sleep(2)
        after = data()
        mine = [e for e in rows(after, date, pid) if e.get("logged") and e.get("id") not in prior]
        lost = set(all_ids(before)) - set(all_ids(after))
        check(f"{name}: no other row lost", not lost, sorted(lost)[:5])
        leave_player(p)
        return {"rows": mine, "taps": taps["n"], "trace": trace}


def flow_reps_each():
    iso = "2026-08-10"
    r = reps_flow("reps_each", "pa03", iso, adjust={"set": 1, "minus": 2})
    if r is None:
        return
    sides = sorted(e.get("side") for e in r["rows"])
    check("reps_each: one row per leg, no duplicates", sides == ["L", "R"], sides)
    by = {e.get("side"): e for e in r["rows"]}
    # Sets alternate legs (L1, R1, L2, R2 ...), so the second tap is the right leg's first set.
    check("reps_each: left in full", by.get("L", {}).get("repsBySet") == [6, 6, 6], by.get("L", {}).get("repsBySet"))
    check("reps_each: right as done at his pace, set 1 two short", by.get("R", {}).get("repsBySet") == [4, 6, 6], by.get("R", {}).get("repsBySet"))
    check("reps_each: six taps of Set done, one per set", r["taps"] == 6, r["taps"])


def flow_manual_both():
    iso = "2026-08-10"
    r = reps_flow("manual_both", "pa04", iso)
    if r is None:
        return
    check("manual_both: one row for both legs", [e.get("side") for e in r["rows"]] == ["B"], [e.get("side") for e in r["rows"]])
    if r["rows"]:
        e = r["rows"][0]
        check("manual_both: logged done, nothing invented where the target is not known", not e.get("partial"), {k: e.get(k) for k in ("sets", "reps", "repsBySet", "partial")})


def flow_manual_each():
    iso = "2026-08-10"
    r = reps_flow("manual_each", "pa08", iso)
    if r is None:
        return
    check("manual_each: one row per leg, no duplicates", sorted(e.get("side") for e in r["rows"]) == ["L", "R"], [e.get("side") for e in r["rows"]])


def timed_flow(name, pid, date, want_side, want_secs, limit):
    c, p = new_chrome()
    with c:
        p.goto("#today", date=date)
        before = data()
        prior = {e.get("id") for e in rows(before, date, pid) if e.get("logged")}
        if not open_row_and_begin(p, pid):
            check(f"{name} setup: Begin", False)
            return
        title0 = p.state()["title"]
        t0 = time.time()
        trace = watch(p, lambda s: (s["title"] and s["title"] != title0) or not s["player"] or s["done"], limit)
        save_trace(name, trace)
        check(f"{name}: ran to its end untouched and carried on", bool(trace[-1].get("title")) and trace[-1]["title"] != title0, [trace[-1].get("title"), round(time.time() - t0)])
        check(f"{name}: no review screen", not any(x.get("review") for x in trace))
        time.sleep(2)
        after = data()
        mine = [e for e in rows(after, date, pid) if e.get("logged") and e.get("id") not in prior]
        check(f"{name}: one row, {want_side}", [e.get("side") for e in mine] == [want_side], [e.get("side") for e in mine])
        if mine:
            check(f"{name}: every bout in full", mine[0].get("secsList") == want_secs and not mine[0].get("partial"), mine[0].get("secsList"))
        lost = set(all_ids(before)) - set(all_ids(after))
        check(f"{name}: no other row lost", not lost, sorted(lost)[:5])
        leave_player(p)


def flow_timed():
    timed_flow("timed", "pa10", "2026-08-11", "B", [30, 30, 30, 30], 330)


def flow_hold_left():
    timed_flow("hold_left", "pa11", "2026-08-12", "L", [30, 30, 30, 30, 30], 400)


def partial_flow(name, how):
    """Part of the first hold, then leave by the arrows, a swipe or Close (B10)."""
    iso = "2026-08-13"
    pid = "pa11"
    c, p = new_chrome()
    with c:
        p.goto("#today", date=iso)
        before = data()
        prior = {e.get("id") for e in rows(before, iso, pid) if e.get("logged")}
        if not open_row_and_begin(p, pid):
            check(f"{name} setup: Begin", False)
            return
        # Wait for the get ready to end and 6 s of the first hold.
        watch(p, lambda s: s["phase"] == "HOLD", 20)
        time.sleep(6.2)
        held = p.js("const d = JSON.parse(localStorage.getItem('rehab.player.v1')); return d.run.steps[d.run.i].kind")
        if how == "arrows":
            p.tap("document.querySelector('.player [data-p=\"ex-next\"]:not([disabled])')")
        elif how == "swipe":
            p.swipe_left("document.querySelector('.player [data-p-swipe]')")
        else:
            p.tap(BACK)
            time.sleep(0.8)
            p.tap("document.querySelector('[data-s=\"save\"]')")
        time.sleep(3)
        st = p.state()
        after = data()
        mine = [e for e in rows(after, iso, pid) if e.get("logged") and e.get("id") not in prior]
        secs = mine[0].get("secsList") if mine else None
        check(f"{name}: the part of the hold is logged, marked partial (B10)",
              len(mine) == 1 and bool(mine[0].get("partial")) and secs and 5 <= secs[0] <= 8, [held, len(mine), secs, mine[0].get("partial") if mine else None])
        if how != "close":
            check(f"{name}: moved to another exercise", bool(st["title"]) and "balance" not in (st["title"] or "").lower(), st["title"])
        lost = set(all_ids(before)) - set(all_ids(after))
        check(f"{name}: no other row lost", not lost, sorted(lost)[:5])
        leave_player(p)


def flow_partial_arrows():
    partial_flow("partial_arrows", "arrows")


def flow_partial_swipe():
    partial_flow("partial_swipe", "swipe")


def flow_partial_close():
    partial_flow("partial_close", "close")


def flow_pause_resume():
    """Pause for 8 s mid hold: the pause is time away, never credited."""
    iso = "2026-08-14"
    pid = "pa11"
    c, p = new_chrome()
    with c:
        p.goto("#today", date=iso)
        prior = {e.get("id") for e in rows(data(), iso, pid) if e.get("logged")}
        open_row_and_begin(p, pid)
        watch(p, lambda s: s["phase"] == "HOLD", 20)
        time.sleep(4)
        p.tap("document.querySelector('.player [data-p=\"pause\"]')")
        c1 = p.state()["clock"]
        wake_paused = p.state()["wake"]
        time.sleep(8)
        c2 = p.state()["clock"]
        check("pause: the clock stands still while paused", c1 == c2, [c1, c2])
        check("pause: wake status says paused (W01)", bool(wake_paused) and "paused" in wake_paused.lower(), wake_paused)
        p.tap("document.querySelector('.player [data-p=\"pause\"]')")
        time.sleep(3)
        wake_running = p.state()["wake"]
        check("pause: while running it never says paused (W01)", bool(wake_running) and "paused" not in wake_running.lower(), wake_running)
        p.tap(BACK)
        time.sleep(0.8)
        p.tap("document.querySelector('[data-s=\"save\"]')")
        time.sleep(3)
        mine = [e for e in rows(data(), iso, pid) if e.get("logged") and e.get("id") not in prior]
        t = (mine[0].get("timing") if mine else None) or {}
        check("pause: the 8 s away is time away, not work", 7 <= (t.get("awaySec") or 0) <= 10 and (t.get("activeSec") or 99) <= 14, t)
        leave_player(p)


def flow_lock():
    """A locked phone mid bout: the page goes hidden (iOS), or its timers stop firing
    for seconds. Either way it comes back paused as interrupted, nothing credited."""
    iso = "2026-08-14"
    pid = "pa10"
    c, p = new_chrome()
    with c:
        p.goto("#today", date=iso)
        open_row_and_begin(p, pid)
        watch(p, lambda s: s["phase"] == "WORK", 20)
        time.sleep(3)
        d0 = p.js(DRAFT)
        p.js("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); return 1")
        time.sleep(7)
        p.js("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); return 1")
        time.sleep(1.5)
        st = p.state()
        d1 = p.js(DRAFT)
        check("lock (hidden): comes back paused as interrupted", d1["run"]["state"] == "interrupted" and "away" in (st["status"] or "").lower(), [d1["run"]["state"], st["status"]])
        active = (d1["run"]["activeMs"] - d0["run"]["activeMs"]) / 1000
        check("lock (hidden): the 7 s away are not credited as work", active < 4.5, round(active, 1))
        check("lock (hidden): Resume is offered in the same slot", st["pause"] == "Resume", st["pause"])
        p.tap("document.querySelector('.player [data-p=\"pause\"]')")
        time.sleep(2)
        d2 = p.js(DRAFT)
        # Timers that do not fire for 6 s (a frozen page): the gap is caught.
        p.js("const t = Date.now() + 6000; while (Date.now() < t) {} return 1")
        time.sleep(1.5)
        d3 = p.js(DRAFT)
        st3 = p.state()
        check("lock (timers stopped): paused as interrupted", d3["run"]["state"] == "interrupted", [d3["run"]["state"], st3["status"]])
        active3 = (d3["run"]["activeMs"] - d2["run"]["activeMs"]) / 1000
        check("lock (timers stopped): the 6 s are not credited", active3 < 3.5, round(active3, 1))
        leave_player(p)


def flow_two_tabs():
    """B11: two tabs of the app. The one in use moves the workout on; the other
    must follow, and must never write its stale draft back over it."""
    iso = "2026-08-13"
    c, a = new_chrome()
    with c:
        a.goto("#today", date=iso)
        tid = c.call("Target.createTarget", url="about:blank")["targetId"]
        time.sleep(1)
        info = next(t for t in c._targets() if t.get("id") == tid)
        b = Page(ws=cdp.WebSocket(info["webSocketDebuggerUrl"]))
        b.setup(focus=False)
        # Tab A starts a reps exercise; tab B opens afterwards, so it holds that draft.
        open_row_and_begin(a, "pa01")
        title0 = a.state()["title"]
        time.sleep(1.5)
        b.goto("#today", date=iso)
        b_line0 = b.js("return document.querySelector('.daystatus')?.textContent.trim() || null")
        check("two_tabs setup: the other tab offers to resume the open exercise", line_title(b_line0) == title0, [b_line0, title0])
        # A finishes pa01 (two sets), skipping the rests, and carries on.
        for _ in range(40):
            st = a.state()
            if st["title"] and st["title"] != title0:
                break
            a.js("const d = document.querySelector('.player [data-p=\"done\"]:not([disabled])'); const s = document.querySelector('.player [data-p=\"skip\"]:not([disabled])'); (d || s)?.click(); return 1")
            time.sleep(0.8)
        time.sleep(2.5)
        a_pid = (a.js(DRAFT) or {}).get("run", {}).get("pid")
        # Tab B goes to the background: hidden, then its pagehide.
        b.js("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); return 1")
        time.sleep(1)
        stored_pid = (a.js(DRAFT) or {}).get("run", {}).get("pid")
        check("two_tabs: the tab in use moved on", a_pid and a_pid != "pa01", a_pid)
        check("two_tabs: the background tab did not write its stale draft over it", stored_pid == a_pid, [stored_pid, a_pid])
        # A third, fresh tab: what does Today offer?
        b.js("Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); return 1")
        b_line = b.js("const P = window.__rehabProbe; P.ctx.go('today'); await new Promise(r => setTimeout(r, 900)); return document.querySelector('.daystatus')?.textContent.trim() || null")
        new_title = a.state()["title"] or ""
        check("two_tabs: the other tab's Today follows the workout, not the old exercise",
              line_title(b_line) not in (None, title0), [b_line0, b_line, new_title])
        # A fresh page (the desktop shell, a relaunch) reads what is stored.
        a.goto("#today", date=iso)
        fresh = a.js("return document.querySelector('.daystatus')?.textContent.trim() || null")
        check("two_tabs: a fresh page offers the workout as it is now", line_title(fresh) not in (None, title0), fresh)
        lost_rows = [e for e in rows(data(), iso, "pa01") if e.get("logged")]
        check("two_tabs: pa01 logged once", len(lost_rows) == 1, len(lost_rows))
        leave_player(a)


def flow_draft_full():
    """B12: the draft cannot be written (storage full). The player says so, keeps
    the workout in memory, Finish later is dimmed, and Retry clears the note."""
    iso = "2026-08-12"
    c, p = new_chrome()
    with c:
        p.goto("#today", date=iso)
        p.js("window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'rehab.player.v1') throw new DOMException('full', 'QuotaExceededError'); return window.__set.call(this, k, v); }; return 1")
        open_row_and_begin(p, "pa10")
        toast = p.js("return [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')")
        watch(p, lambda s: s["phase"] == "WORK", 20)
        time.sleep(2.5)
        st = p.state()
        check("draft_full: the player says the workout is not kept", "not kept" in (st["status"] or "").lower(), st["status"])
        check("draft_full: and a notice says why", "not being kept" in toast.lower(), toast[:90])
        check("draft_full: the workout keeps running in memory", st["pause"] == "Pause", st["pause"])
        p.tap(BACK)
        time.sleep(0.8)
        later = p.js("const b = document.querySelector('[data-s=\"later\"]'); return b ? { disabled: b.disabled, text: b.textContent.trim() } : null")
        check("draft_full: Finish later is dimmed, with the reason", bool(later) and later["disabled"] and "storage is full" in later["text"], later)
        p.tap("document.querySelector('[data-s=\"resume\"]')")
        time.sleep(0.8)
        p.js("Storage.prototype.setItem = window.__set; return 1")
        p.tap("document.querySelector('.player [data-p=\"draft-retry\"]')")
        time.sleep(1)
        st2 = p.state()
        stored = p.js(DRAFT)
        check("draft_full: Retry writes it, and the note goes", "not kept" not in (st2["status"] or "").lower() and bool(stored), [st2["status"], bool(stored)])
        leave_player(p)


def flow_zoom():
    """B09: the photo zoom follows the phase, and closes itself when the exercise ends."""
    iso = "2026-08-11"
    c, p = new_chrome()
    with c:
        p.goto("#today", date=iso)
        open_row_and_begin(p, "pa11")
        time.sleep(0.5)
        p.tap("document.querySelector('.player [data-p=\"zoom\"]')")
        time.sleep(0.8)
        zoom = lambda: p.js("const z = document.querySelector('.p-zoom'); return z ? { phase: z.querySelector('[data-z-phase]')?.textContent.trim() || z.querySelector('.p-zoom-phase')?.textContent.trim(), pause: z.querySelector('[data-z=\"pause\"]').textContent.trim() } : null")
        z0 = zoom()
        check("zoom: opens during get ready", bool(z0) and (z0["phase"] or "").startswith("GET READY"), z0)
        watch(p, lambda s: s["phase"] == "HOLD", 20)
        time.sleep(0.6)
        z1 = zoom()
        check("zoom: says HOLD once the hold starts", bool(z1) and (z1["phase"] or "").startswith("HOLD"), z1)
        watch(p, lambda s: s["phase"] == "REST", 40)
        time.sleep(0.6)
        z2 = zoom()
        check("zoom: says REST in the rest", bool(z2) and (z2["phase"] or "").startswith("REST"), z2)
        title0 = p.state()["title"]
        watch(p, lambda s: (s["title"] and s["title"] != title0) or s["done"] or not s["player"], 320)
        time.sleep(1)
        z3 = zoom()
        focus = p.js("return document.activeElement ? (document.activeElement.dataset.p || document.activeElement.tagName) : null")
        check("zoom: closed itself when the exercise finished and carried on", z3 is None, [z3, focus])
        leave_player(p)


CLOCK_SHIM = """
(() => {
  const R = Date;
  const off = () => { try { return Number(localStorage.getItem('flow.clockOffset')) || 0; } catch (e) { return 0; } };
  class D extends R {
    constructor(...a) { if (a.length) super(...a); else super(R.now() + off()); }
    static now() { return R.now() + off(); }
  }
  window.Date = D;
})();
"""


def clock_page(target_local, tz):
    """A page whose clock reads `target_local` ("2026-09-16T00:30") in time zone `tz`."""
    c, p = new_chrome()
    p.call("Emulation.setTimezoneOverride", timezoneId=tz)
    p.call("Page.addScriptToEvaluateOnNewDocument", source=CLOCK_SHIM)
    p.goto("#today", settle=1.5)
    p.js(f"const want = new Date('{target_local}').getTime(); localStorage.setItem('flow.clockOffset', String(want - Date.now())); return 1")
    return c, p


def flow_clock_edges():
    """Midnight and 5am on the supplement list, a time edit after midnight, and time zones.
    The clock is shifted in the page (Date only); the data written is real."""
    c, p = clock_page("2026-09-16T00:30:00", "America/New_York")
    with c:
        p.goto("#supplements", settle=2.5)
        head = p.js("return document.querySelector('.daynav-date .dn-long')?.textContent.trim() || null")
        check("clock: at 12:30 AM the supplement list is still the day before", head and "15" in head, head)
        p.goto("#today", settle=2.5)
        today_head = p.js("return document.querySelector('.daynav-date .dn-long')?.textContent.trim() || null")
        check("clock: Today is the calendar date", today_head and "16" in today_head, today_head)
        p.goto("#supplements", settle=2.5)
        sid = p.js("const cb = [...document.querySelectorAll('input[data-supp]')].find(x => !x.checked); if (!cb) return null; cb.click(); return cb.dataset.supp")
        time.sleep(2.5)
        tick = data().get("days", {}).get("2026-09-15", {}).get("supps", {}).get(sid)
        check("clock: a tick at 12:30 AM is filed on the 15th list with the real moment", isinstance(tick, str) and tick.startswith("2026-09-16T04:30"), tick)
        p.js(f"""const i = document.querySelector('[data-supptime="{sid}"]'); i.focus(); i.value = '01:00'; i.dispatchEvent(new Event('input', {{ bubbles: true }})); i.dispatchEvent(new Event('change', {{ bubbles: true }})); i.blur(); return 1""")
        time.sleep(2.5)
        tick2 = data().get("days", {}).get("2026-09-15", {}).get("supps", {}).get(sid)
        check("clock: editing it to 1:00 AM stores 1:00 AM on the 16th (B06)", isinstance(tick2, str) and tick2.startswith("2026-09-16T05:00"), tick2)
        p.js(f"""const cb = document.querySelector('input[data-supp="{sid}"]'); if (cb && cb.checked) cb.click(); return 1""")
        time.sleep(2)
        p.js("const want = new Date('2026-09-16T05:01:00').getTime(); localStorage.setItem('flow.clockOffset', String(want - (Date.now() - (Number(localStorage.getItem('flow.clockOffset')) || 0)))); return 1")
        p.goto("#supplements", settle=2.5)
        head2 = p.js("return document.querySelector('.daynav-date .dn-long')?.textContent.trim() || null")
        check("clock: at 5:01 AM the list moves to the 16th", head2 and "16" in head2, head2)
    # The same stored moment read in another time zone keeps the instant.
    c, p = clock_page("2026-09-16T12:00:00", "Europe/London")
    with c:
        p.goto("#supplements", settle=2.5)
        p.js("const P = window.__rehabProbe; P.ctx.suppDate = '2026-09-15'; P.ctx.go('supplements'); await new Promise(r => setTimeout(r, 900)); return 1")
        shown = p.js("return [...document.querySelectorAll('[data-supptime]')].map(i => i.value).filter(Boolean)")
        check("clock: in London the list still loads and shows times", isinstance(shown, list), shown[:3] if shown else shown)
    # Daylight saving: a time that does not exist on the spring-forward night.
    c, p = clock_page("2026-03-08T12:00:00", "America/New_York")
    with c:
        out = p.js("const m = await import('/js/views/supplements.js'); const d = m.suppDoseDate('2026-03-07', 2, 30); return [d.getDate(), d.getHours(), d.getMinutes(), isNaN(d.getTime())]")
        check("clock: 2:30 AM on the spring-forward night lands on a real time (3:30 AM on the 8th)", out == [8, 3, 30, False], out)
        out2 = p.js("const m = await import('/js/views/supplements.js'); const d = m.suppDoseDate('2026-10-31', 1, 30); return [d.getDate(), d.getHours(), d.getMinutes()]")
        check("clock: 1:30 AM on the fall-back night is that date and time", out2 == [1, 1, 30], out2)


def flow_overnight():
    """A workout left open at 11:58 PM and resumed after midnight stays on its own day."""
    c, p = clock_page("2026-09-16T23:58:00", "America/New_York")
    with c:
        iso = "2026-09-16"
        p.goto("#today", settle=2.5)
        prior = {e.get("id") for e in rows(data(), iso, "pa11") if e.get("logged")}
        open_row_and_begin(p, "pa11")
        watch(p, lambda s: s["phase"] == "HOLD", 20)
        time.sleep(4)
        p.tap("document.querySelector('.player [data-p=\"pause\"]')")
        time.sleep(0.5)
        # Past midnight, and the app reopened.
        p.js("const want = new Date('2026-09-17T00:10:00').getTime(); const real = Date.now() - (Number(localStorage.getItem('flow.clockOffset')) || 0); localStorage.setItem('flow.clockOffset', String(want - real)); return 1")
        p.goto("#today", settle=2.5)
        line = p.js("return document.querySelector('.daystatus')?.textContent.trim() || null")
        check("overnight: Today on the 17th offers the open workout and names its day", bool(line) and "Wed" in line, line)
        p.tap("document.querySelector('[data-act=\"resume\"]')")
        time.sleep(1.2)
        count = p.js("return document.querySelector('.player [data-slot=\"count\"]')?.textContent.trim() || null")
        check("overnight: the player names the day it belongs to", bool(count) and "Wed" in count, count)
        p.tap(BACK)
        time.sleep(0.8)
        p.tap("document.querySelector('[data-s=\"save\"]')")
        time.sleep(3)
        mine = [e for e in rows(data(), iso, "pa11") if e.get("logged") and e.get("id") not in prior]
        nxt = [e for e in rows(data(), "2026-09-17", "pa11") if e.get("logged")]
        check("overnight: saved on the day it was done, not the new day", len(mine) == 1 and not nxt, [len(mine), len(nxt)])


def flow_program_days():
    """A day chip on Program: the arrangement changes from today, earlier dated plans stay."""
    c, p = new_chrome()
    with c:
        p.goto("#program", settle=2.5)
        before = data()
        pid = "pa05"
        days0 = before.get("program", {}).get("days", {}).get(pid)
        sched0 = {k: v for k, v in before.get("program", {}).get("schedule", {}).items() if k != today()}
        chip = p.js(f"const b = [...document.querySelectorAll('[data-pday=\"{pid}\"]')].find(x => x.getBoundingClientRect().width); return b ? {{ day: b.dataset.day, label: b.getAttribute('aria-label') }} : null")
        check("program: a day chip is named with the exercise and the full day (A02)", bool(chip) and " on " in (chip or {}).get("label", ""), chip)
        p.tap(f"[...document.querySelectorAll('[data-pday=\"{pid}\"][data-day=\"{chip['day']}\"]')].find(x => x.getBoundingClientRect().width)")
        time.sleep(2)
        mid = data()
        days1 = mid["program"]["days"].get(pid)
        want_on = chip["day"] not in (days0 if isinstance(days0, list) else [])
        check("program: the tap changed that weekday only", isinstance(days1, list) and ((chip["day"] in days1) == want_on or days0 is None), [days0, days1])
        check("program: a plan version dated today, earlier versions untouched", today() in mid["program"].get("schedule", {}) and all(mid["program"]["schedule"].get(k) == v for k, v in sched0.items()), sorted(mid["program"].get("schedule", {}))[-2:])
        p.tap(f"[...document.querySelectorAll('[data-pday=\"{pid}\"][data-day=\"{chip['day']}\"]')].find(x => x.getBoundingClientRect().width)")
        time.sleep(2)
        days2 = data()["program"]["days"].get(pid)
        check("program: tapping again puts the weekdays back", sorted(days2 or []) == sorted(days0 if isinstance(days0, list) else [d for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]]), [days0, days2])


def flow_plan_ticks():
    """A judgement-call focus tick on Plan writes one plan-focus record and comes back off."""
    c, p = new_chrome()
    with c:
        p.goto("#plan", settle=2.5)
        key = p.js("const cb = document.querySelector('input[data-focus]'); return cb ? cb.dataset.focus : null")
        if not key:
            check("plan: a focus tick exists this month", False)
            return
        before = data().get("planFocus", {}).get(key)
        # The judgement calls sit in a fold: open it, then tap the line, as he would.
        p.tap(f"document.querySelector('input[data-focus=\"{key}\"]').closest('details').querySelector('summary')")
        time.sleep(0.8)
        p.tap(f"document.querySelector('input[data-focus=\"{key}\"]').closest('label')")
        time.sleep(2)
        mid = data().get("planFocus", {}).get(key)
        check("plan: the tick is written", bool(mid) != bool(before), [before, mid])
        p.tap(f"document.querySelector('input[data-focus=\"{key}\"]').closest('label')")
        time.sleep(2)
        after = data().get("planFocus", {}).get(key)
        check("plan: and unticked it is as it was", bool(after) == bool(before), [before, after])


def flow_settings_io():
    """B15, B16 through Settings: export the report, import a synthetic backup (Cancel, then Merge)."""
    import tempfile as tf
    dl = Path(tf.mkdtemp(prefix="rehab-dl-"))
    c, p = new_chrome()
    with c:
        c.call("Browser.setDownloadBehavior", behavior="allow", downloadPath=str(dl))
        p.goto("#settings", settle=2.5)
        p.js("document.querySelector('details[data-setg=\"data\"]').open = true; return 1")
        time.sleep(0.5)
        p.tap("document.querySelector('[data-export-csv]')")
        time.sleep(2.5)
        csvs = list(dl.glob("*.csv"))
        doc = data()
        logged = sum(1 for d in doc["days"].values() for e in d.get("entries", []) if e.get("logged"))
        if csvs:
            text = csvs[0].read_text(encoding="utf-8-sig")
            import csv as _csv, io as _io
            rows_ = list(_csv.reader(_io.StringIO(text)))
            check("settings: the report has a row per logged entry and nothing unlogged (B16)", len(rows_) - 1 == logged, [len(rows_) - 1, logged])
            check("settings: the report is named a report", "training-report" in csvs[0].name, csvs[0].name)
        else:
            check("settings: the report downloaded", False)
        # A synthetic backup: one new day with one row, and an older copy of a row that exists.
        existing = next(((iso, e) for iso, d in sorted(doc["days"].items()) for e in d.get("entries", []) if e.get("logged")), None)
        backup = {"schema": 7, "days": {"2019-01-02": {"entries": [{"id": "import-test-row", "pid": "pa01", "ex": "dl_bridge_band", "side": "B", "logged": True, "sets": 1, "reps": 1}]}}, "somethingElse": 1}
        if existing:
            old = dict(existing[1]); old["reps"] = 999
            backup["days"][existing[0]] = {"entries": [old]}
        f = dl / "backup.json"
        f.write_text(json.dumps(backup))
        root = p.call("DOM.getDocument")["root"]["nodeId"]
        node = p.call("DOM.querySelector", nodeId=root, selector="input[data-import]")["nodeId"]
        p.call("DOM.setFileInputFiles", nodeId=node, files=[str(f)])
        time.sleep(1.5)
        preview = p.js("return document.querySelector('.import-preview')?.textContent.replace(/\\s+/g, ' ').trim() || null")
        check("settings: import shows a preview before anything changes", bool(preview) and "0 deleted" in preview and "somethingElse" in preview, (preview or "")[:160])
        p.tap("document.querySelector('.modal [data-close]:not(.icon-btn)')")
        time.sleep(1.5)
        same = data()
        check("settings: Cancel changes nothing", "2019-01-02" not in same["days"], "")
        snaps = Path(__file__).resolve().parents[1] / "data" / "test-copy" / "snapshots"
        n_before = len(list(snaps.glob("rehab-data-before-import-*.json"))) if BASE.endswith(":8767") else None
        p.call("DOM.setFileInputFiles", nodeId=p.call("DOM.querySelector", nodeId=p.call("DOM.getDocument")["root"]["nodeId"], selector="input[data-import]")["nodeId"], files=[str(f)])
        time.sleep(1.5)
        p.tap("document.querySelector('[data-import-go]')")
        time.sleep(3)
        after = data()
        got = [e for e in after["days"].get("2019-01-02", {}).get("entries", []) if e.get("id") == "import-test-row"]
        check("settings: Merge adds the backup's new row", len(got) == 1, len(got))
        if existing:
            cur = next((e for e in after["days"][existing[0]]["entries"] if e.get("id") == existing[1]["id"]), None)
            check("settings: a row this device holds keeps its own numbers, not the backup's", cur and cur.get("reps") != 999, cur and cur.get("reps"))
        check("settings: the unknown key is not imported", "somethingElse" not in after, "")
        lost = set(all_ids(same)) - set(all_ids(after))
        check("settings: nothing removed by the import", not lost, sorted(lost)[:4])
        if n_before is not None:
            check("settings: a restore point was saved first", len(list(snaps.glob("rehab-data-before-import-*.json"))) == n_before + 1, "")


def line_title(line):
    """The exercise named in Today's status line: "Paused · <title> · ..."."""
    parts = [x.strip() for x in (line or "").split("·")]
    return parts[1] if len(parts) > 1 else None


FLOWS = {k[5:]: v for k, v in dict(globals()).items() if k.startswith("flow_")}


def main():
    global BASE, OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.environ.get("REHAB_BASE", BASE))
    ap.add_argument("--out", default=None)
    ap.add_argument("flows", nargs="*")
    args = ap.parse_args()
    BASE = args.base
    OUT = args.out
    if ":8757" in BASE:
        sys.exit("refusing: 8757 is his live app")
    names = args.flows or list(FLOWS)
    for n in names:
        if n not in FLOWS:
            sys.exit(f"unknown flow {n}; one of {', '.join(FLOWS)}")
    for n in names:
        print(f"\n== {n} ({BASE})", flush=True)
        try:
            FLOWS[n]()
        except Exception as exc:  # noqa: BLE001
            check(f"{n}: ran without an error", False, str(exc)[:240])
    fails = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(fails)} of {len(RESULTS)} passed")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
