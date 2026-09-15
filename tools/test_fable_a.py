#!/usr/bin/env python3
"""Group A reproductions from Fable's audit of 9ffec4c (2026-09-15).

Runs in a throwaway headless Chrome (393x852, DPR 3, touch) against a TEST
server only. Never point it at port 8757.

    python3 tools/test_fable_a.py                       # the test server, 8767
    python3 tools/test_fable_a.py --base http://localhost:8768 a1 a2

a1  Next through the tendon loading with nothing done: no gap screen, the row
    stays unticked, the recovery line is unchanged, Today says nothing was logged.
a2  Supplement drag to reorder with touch: the order is written, no .dragging
    is left behind, the order survives a repaint and a reload. Dragged back
    afterwards, so the sequence ends as it started.
a3  Bulk actions as round trips (day menu) on an empty past day: every other
    day byte for byte unchanged, entry count unchanged.
a08 A save that fails (server down) or whose reply is lost, then a reload:
    the run is applied once.
a20 Swipe while the outgoing exercise saves against a slow server; and with
    the save failing.
a21 Skip song with a Pause during loading (A21); broken tracks (A22).

The .local handover records the before and after runs.
"""
import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fringe-planner" / "tools"))
import cdp  # noqa: E402

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  ' + detail) if detail else ''}", flush=True)


class T:
    def __init__(self, c, base):
        self.c = c
        self.base = base

    def js(self, code):
        return self.c.eval("(async () => {" + code + "})()")

    def goto(self, hash_, settle=2.2):
        self.c.navigate(f"{self.base}/m.html?t={time.time()}{hash_}", settle=settle)

    def data(self):
        with urllib.request.urlopen(f"{self.base}/api/data") as r:
            return json.load(r)

    def point(self, sel):
        return self.js(f"const el = {sel}; if (!el) return null; el.scrollIntoView({{block: 'center'}}); await new Promise(r => setTimeout(r, 250)); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];")

    def touch(self, kind, x=None, y=None):
        pts = [] if kind == "touchEnd" else [{"x": x, "y": y}]
        self.c.call("Input.dispatchTouchEvent", type=kind, touchPoints=pts)


def today_iso():
    return time.strftime("%Y-%m-%d")


def entries_on(d, iso):
    return d.get("days", {}).get(iso, {}).get("entries", [])


# ---------------------------------------------------------------- A1 ----
def a1(t):
    iso = today_iso()
    t.goto("#today")
    before = t.js("""
      const tick = document.querySelector('input.tick[data-ptoggle="tl18"]');
      return { tick: tick ? tick.checked : null,
               rec: document.querySelector('.recovery-line')?.textContent.trim() || null,
               start: !!document.querySelector('[data-act="start"]:not([disabled])') };
    """)
    if before["tick"] is not False or not before["start"]:
        check("a1 setup: tendon loading unticked today and Start available", False, json.dumps(before))
        return
    logged0 = [e for e in entries_on(t.data(), iso) if e.get("pid") == "tl18" and e.get("logged")]
    out = t.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-act="start"]').click(); await s(1200);
      const title0 = document.querySelector('.p-title')?.textContent.trim();
      let n = 0;
      for (; n < 120; n++) {
        if (!document.querySelector('.player')) break;
        if (document.querySelector('.done-screen')) break;
        const t = document.querySelector('.p-title')?.textContent.trim();
        if (t && t !== title0) break;
        const b = document.querySelector('[data-p="next"]:not([disabled])');
        if (!b) { await s(200); continue; }
        b.click(); await s(120);
      }
      await s(1500);
      return { title0, presses: n, hash: location.hash,
               gap: !!document.querySelector('.done-screen.gap'),
               player: !!document.querySelector('.player'),
               title: document.querySelector('.p-title')?.textContent.trim() || null };
    """)
    check("a1 player opened on the tendon loading", out["title0"] and "tendon" in out["title0"].lower(), out["title0"] or "")
    check("a1 no gap screen", not out["gap"], json.dumps(out))
    check("a1 back on Today", out["hash"] == "#today" and not out["player"], out["hash"])
    after = t.js("""
      await new Promise(r => setTimeout(r, 400));
      const tick = document.querySelector('input.tick[data-ptoggle="tl18"]');
      return { tick: tick ? tick.checked : null,
               rec: document.querySelector('.recovery-line')?.textContent.trim() || null,
               status: document.querySelector('.daystatus')?.textContent.trim() || null };
    """)
    check("a1 row stays unticked", after["tick"] is False, str(after["tick"]))
    check("a1 recovery line unchanged", after["rec"] == before["rec"], f"{before['rec']!r} -> {after['rec']!r}")
    check("a1 Today says nothing was logged", bool(after["status"]) and after["status"].startswith("Nothing logged for"), after["status"] or "")
    time.sleep(1.5)
    logged1 = [e for e in entries_on(t.data(), iso) if e.get("pid") == "tl18" and e.get("logged")]
    check("a1 nothing logged in the document", len(logged1) == len(logged0), f"{len(logged0)} -> {len(logged1)}")
    # Leave no open workout behind (a gap screen on the old build keeps a draft).
    t.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      if (document.querySelector('.player')) { document.querySelector('[data-p="close"]')?.click(); await s(500); }
      const rs = document.querySelector('[data-act="resume"]');
      return !!rs;
    """)


# ---------------------------------------------------------------- A2 ----
def dom_order(t, zone_js="document.querySelector('[data-dropzone]')"):
    return t.js(f"const z = {zone_js}; return z ? [...z.querySelectorAll('[data-row]')].map(r => r.dataset.row) : null")


def data_order(t, ids):
    sups = {s["id"]: s for s in t.data().get("supplements", [])}
    return sorted(ids, key=lambda i: (sups[i].get("order", 0)))


def drag(t, from_id, below_id):
    h = t.point(f"document.querySelector('[data-row=\"{from_id}\"] [data-drag]')")
    tgt = t.point(f"document.querySelector('[data-row=\"{below_id}\"]')")
    if not h or not tgt:
        return False
    # Re-read the handle after scrolling the target into view.
    h = t.js(f"const r = document.querySelector('[data-row=\"{from_id}\"] [data-drag]').getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]")
    tb = t.js(f"const r = document.querySelector('[data-row=\"{below_id}\"]').getBoundingClientRect(); return [r.top, r.height]")
    y1 = tb[0] + tb[1] * 0.8
    t.touch("touchStart", h[0], h[1])
    steps = 12
    for i in range(1, steps + 1):
        t.touch("touchMove", h[0], h[1] + (y1 - h[1]) * i / steps)
        time.sleep(0.03)
    t.touch("touchEnd")
    return True


def a2(t):
    t.goto("#supplements")
    t.js("document.querySelector('[data-supp-edit]')?.click(); await new Promise(r => setTimeout(r, 600)); return 1")
    order0 = dom_order(t)
    if not order0 or len(order0) < 3:
        check("a2 setup: a group with three rows in edit mode", False, str(order0))
        return
    ids = list(order0)
    moved, target = order0[0], order0[2]
    ok = drag(t, moved, target)
    time.sleep(0.8)
    dom1 = dom_order(t)
    residue = t.js("return document.querySelectorAll('.dragging').length")
    check("a2 drag ran", ok)
    check("a2 row moved on screen", dom1 and dom1.index(moved) > dom1.index(target), f"{order0[:4]} -> {(dom1 or [])[:4]}")
    check("a2 no .dragging residue", residue == 0, str(residue))
    time.sleep(1.8)
    stored = data_order(t, ids)
    check("a2 order written to the document", stored.index(moved) > stored.index(target), str(stored[:4]))
    # A repaint: leave and re-enter edit mode.
    t.js("const s = (ms) => new Promise(r => setTimeout(r, ms)); document.querySelector('[data-supp-edit]')?.click(); await s(500); document.querySelector('[data-supp-edit]')?.click(); await s(500); return 1")
    dom2 = dom_order(t)
    check("a2 order survives a repaint", dom2 and dom2.index(moved) > dom2.index(target), str((dom2 or [])[:4]))
    t.goto("#supplements")
    t.js("document.querySelector('[data-supp-edit]')?.click(); await new Promise(r => setTimeout(r, 600)); return 1")
    dom3 = dom_order(t)
    check("a2 order survives a reload", dom3 and dom3.index(moved) > dom3.index(target), str((dom3 or [])[:4]))
    # Round trip: drag it back above its old neighbour.
    cur = dom_order(t)
    first = cur[0]
    h = t.js(f"const r = document.querySelector('[data-row=\"{moved}\"] [data-drag]').getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]")
    tb = t.js(f"const r = document.querySelector('[data-row=\"{first}\"]').getBoundingClientRect(); return [r.top, r.height]")
    y1 = tb[0] + tb[1] * 0.15
    t.touch("touchStart", h[0], h[1])
    for i in range(1, 13):
        t.touch("touchMove", h[0], h[1] + (y1 - h[1]) * i / 12)
        time.sleep(0.03)
    t.touch("touchEnd")
    time.sleep(2.2)
    back = data_order(t, ids)
    check("a2 dragged back: sequence as it started", back == order0, f"{order0} -> {back}")
    t.js("document.querySelector('[data-supp-edit]')?.click(); return 1")


# ---------------------------------------------------------------- A3 ----
def run_menu(t, key):
    return t.js(f"""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      document.querySelector('[data-act="menu"]').click(); await s(500);
      const b = document.querySelector('#modal-root [data-m="{key}"]:not([disabled])');
      if (!b) {{ document.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Escape' }})); await s(300); return false; }}
      b.click(); await s(900);
      return true;
    """)


def a3(t):
    """Every bulk action on an empty past day, undone by Clear (and the clinic
    toggle by itself). Every other day must be byte for byte unchanged."""
    d0 = t.data()
    iso = None
    for back in range(1, 30):
        cand = time.strftime("%Y-%m-%d", time.localtime(time.time() - back * 86400))
        if not d0["days"].get(cand, {}).get("entries"):
            iso, steps_back = cand, back
            break
    if not iso:
        check("a3 setup: an empty past day", False)
        return
    others0 = json.dumps({k: v for k, v in d0["days"].items() if k != iso}, sort_keys=True)
    clinic0 = json.dumps(d0.get("program", {}).get("clinicDays", {}), sort_keys=True)
    total0 = sum(len(v.get("entries", [])) for v in d0["days"].values())

    def open_day():
        t.goto("#today")
        t.js(f"const s = (ms) => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < {steps_back}; i++) {{ document.querySelector('[data-nav=\"-1\"]').click(); await s(250); }} return 1")

    def day():
        return t.data()["days"].get(iso, {}).get("entries", [])

    print(f"a3 on {iso} ({steps_back} days back), {total0} entries in the document")
    for key, label in [("repeat", "Repeat last session"), ("tickall", "Tick everything planned"),
                       ("same", "Same as last time"), ("hep", "Clinic program")]:
        open_day()
        e0 = day()
        ran = run_menu(t, key)
        time.sleep(1.6)
        e1 = day()
        new_ids = {e["id"] for e in e1} - {e["id"] for e in e0}
        dup = len(e1) != len({e["id"] for e in e1})
        pairs = [(e.get("ex"), e.get("side") or "B") for e in e1]
        dup_side = len(pairs) != len(set(pairs)) and key != "tickall"
        logged = sum(1 for e in e1 if e.get("logged"))
        if not ran:
            check(f"a3 {label}: available", False, "not in the menu")
            continue
        check(f"a3 {label}: adds rows, no duplicate ids", len(e1) >= len(e0) and not dup, f"{len(e0)} -> {len(e1)} rows, {len(new_ids)} new, {logged} logged")
        if key in ("repeat", "hep"):
            check(f"a3 {label}: added rows are unticked", logged == 0, str(logged))
            check(f"a3 {label}: no exercise and side twice", not dup_side)
        if key in ("tickall", "same"):
            check(f"a3 {label}: rows ticked", logged > 0, str(logged))
        open_day()
        ran = run_menu(t, "clear")
        time.sleep(1.6)
        e2 = day()
        check(f"a3 {label} then Clear: back to empty", len(e2) == 0, f"{len(e1)} -> {len(e2)}")
    open_day()
    run_menu(t, "clinic"); time.sleep(1.2)
    c1 = t.data().get("program", {}).get("clinicDays", {})
    check("a3 Mark as a clinic day: set", c1.get(iso) is True)
    open_day()
    run_menu(t, "clinic"); time.sleep(1.2)
    d1 = t.data()
    check("a3 Not a clinic day after all: back as it was", json.dumps(d1.get("program", {}).get("clinicDays", {}), sort_keys=True) == clinic0)
    left = d1["days"].get(iso, {}).get("entries", [])
    check("a3 every other day byte for byte unchanged", json.dumps({k: v for k, v in d1["days"].items() if k != iso}, sort_keys=True) == others0)
    total1 = sum(len(v.get("entries", [])) for v in d1["days"].values())
    check("a3 document entry count unchanged", total1 == total0 and not left, f"{total0} -> {total1}, {len(left)} left on {iso}")
    if left:
        print("  left on the test day (rows without a program id):", [(e.get("ex"), e.get("side")) for e in left])


# ---------------------------------------------------------------- A4 ----
# A08 and A20 need a save that fails or is slow. On the Mac the save is a PUT
# to this server; the page's fetch is wrapped so that PUT fails the way it does
# when the server is stopped ("down"), succeeds on the server but the reply is
# lost ("lost"), or arrives three seconds late ("slow").
NET = r"""
  window.__realFetch ||= window.fetch;
  window.__net = %s;
  window.fetch = async (u, o) => {
    const put = String(u).includes('/api/data') && o && o.method === 'PUT';
    if (put && window.__net === 'down') throw new TypeError('Failed to fetch');
    if (put && window.__net === 'lost') { await window.__realFetch(u, o); throw new TypeError('Failed to fetch'); }
    if (put && window.__net === 'slow') await new Promise(r => setTimeout(r, 3000));
    return window.__realFetch(u, o);
  };
  return 1;
"""

OPEN_REPS = r"""
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  const key = [...document.querySelectorAll('.today .crow-main[data-rowclick]')]
    .map(b => b.dataset.rowclick).find(k => /^pa(0[1-35-79]|1[0-5])$/.test(k) && !document.querySelector(`input.tick[data-ptoggle="${k}"]`)?.checked);
  if (!key) return null;
  document.querySelector(`[data-rowclick="${key}"]`).click(); await s(600);
  document.querySelector(`#row-${key} [data-timer]`)?.click(); await s(1200);
  document.querySelector('[data-p="pause"]')?.click(); await s(300);
  for (let i = 0; i < 4; i++) { const b = document.querySelector('[data-p="skip"]:not([disabled])'); if (!b) break; b.click(); await s(300); }
  return key;
"""

TO_LAST_SET = r"""
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 60; i++) {
    const nextTxt = document.querySelector('[data-slot="next"]')?.textContent || '';
    const done = document.querySelector('[data-p="done"]:not([disabled])');
    const skip = document.querySelector('[data-p="skip"]:not([disabled])');
    if (/log it/.test(nextTxt) && done) return true;
    if (skip) { skip.click(); await s(200); continue; }
    if (done) { done.click(); await s(250); continue; }
    await s(300);
  }
  return false;
"""

DRAFT = "try { return JSON.parse(localStorage.getItem('rehab.player.v1')); } catch { return null; }"


def rows_for_run(t, run_id):
    return [e for d in t.data()["days"].values() for e in d.get("entries", []) if e.get("runId") == run_id]


def leave_player_and_untick(t, key):
    t.js(NET % "null")
    t.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      if (document.querySelector('.player')) {
        document.querySelector('[data-p="close"], #nav-back')?.click(); await s(600);
        document.querySelector('[data-s="discard"]')?.click(); await s(600);
      }
      return 1;
    """)
    t.goto("#today")
    t.js(f"""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      const tk = document.querySelector('input.tick[data-ptoggle="{key}"]');
      if (tk && tk.checked) {{ tk.click(); await s(1200); }}
      return 1;
    """)


def a08(t):
    for mode in ("down", "lost"):
        t.goto("#today")
        key = t.js(OPEN_REPS)
        if not key or not t.js(TO_LAST_SET):
            check(f"a08 {mode} setup: at the last set of a reps exercise", False, str(key))
            continue
        t.js(NET % json.dumps(mode))
        t.js("document.querySelector('[data-p=\"done\"]:not([disabled])').click(); await new Promise(r => setTimeout(r, 2500)); return 1")
        seen = t.js("return { toast: [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' | '), player: !!document.querySelector('.player') }")
        run_id = (t.js(DRAFT) or {}).get("run", {}).get("runId")
        check(f"a08 {mode}: the failed save says so and keeps the workout", "Not saved yet" in seen["toast"] and seen["player"] and bool(run_id), seen["toast"][:80])
        on_server = rows_for_run(t, run_id)
        check(f"a08 {mode}: server holds the run {'0' if mode == 'down' else 'once'} before the reload",
              (len(on_server) == 0) if mode == "down" else (len(on_server) >= 1), str(len(on_server)))
        n_before = len(on_server)
        # Reload (the wrapper is gone with the page), resume, save.
        t.goto("#today")
        res = t.js("""
          const s = (ms) => new Promise(r => setTimeout(r, ms));
          const r = document.querySelector('[data-act="resume"]');
          if (!r) return 'no resume';
          r.click(); await s(1200);
          const b = document.querySelector('[data-p="save"]:not([disabled])');
          if (!b) return 'no save: ' + (document.querySelector('.player')?.className || 'no player');
          b.click(); await s(2500);
          return 'saved';
        """)
        rows = rows_for_run(t, run_id)
        sides = [r.get("side") or "B" for r in rows]
        check(f"a08 {mode}: after reload and Save the run is applied once", res == "saved" and len(rows) >= 1 and len(sides) == len(set(sides)) and all(r.get("logged") for r in rows) and (mode == "down" or len(rows) == n_before),
              f"{res}; rows {len(rows)} sides {sides}")
        leave_player_and_untick(t, key)


def a20(t):
    t.goto("#today")
    key = t.js(OPEN_REPS)
    if not key:
        check("a20 setup: a reps exercise open", False)
        return
    t.js("document.querySelector('[data-p=\"done\"]:not([disabled])')?.click(); await new Promise(r => setTimeout(r, 500)); return 1")
    d0 = t.js(DRAFT) or {}
    run_id = d0.get("run", {}).get("runId")
    title0 = t.js("return document.querySelector('.p-title')?.textContent.trim()")
    t.js(NET % '"slow"')
    zone = t.js("const z = document.querySelector('[data-p-swipe] .p-title') || document.querySelector('[data-p-swipe]'); const r = z.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]")
    x, y = zone
    t.touch("touchStart", x + 120, y)
    for i in range(1, 7):
        t.touch("touchMove", x + 120 - 240 * i / 6, y)
        time.sleep(0.016)
    t.touch("touchEnd")
    during = t.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      await s(150);
      const busy = document.querySelector('[data-player]')?.getAttribute('aria-busy');
      const before = JSON.parse(localStorage.getItem('rehab.player.v1'));
      for (const k of ['done', 'done', 'pause', 'skip', 'next', 'reps+']) { document.querySelector(`[data-p="${k}"]`)?.click(); await s(60); }
      const after = JSON.parse(localStorage.getItem('rehab.player.v1'));
      return { busy, same: JSON.stringify(before.run.results) === JSON.stringify(after.run.results) && before.run.i === after.run.i && before.run.runId === after.run.runId };
    """)
    check("a20: the player says it is busy while the swipe saves", during["busy"] == "true", str(during["busy"]))
    check("a20: taps during the save change nothing", during["same"])
    time.sleep(4.5)
    title1 = t.js("return document.querySelector('.p-title')?.textContent.trim()")
    rows = rows_for_run(t, run_id)
    check("a20: after the slow save it moves to the next exercise", title1 and title1 != title0, f"{title0!r} -> {title1!r}")
    check("a20: the outgoing run is saved once, as it was when swiped", len(rows) >= 1 and all(r.get("sets") == rows[0].get("sets") for r in rows), f"rows {len(rows)} sets {[r.get('sets') for r in rows]}")
    # Failure: the swipe stays put, paused, with the confirmed set.
    t.js("document.querySelector('[data-p=\"pause\"]')?.click(); await new Promise(r => setTimeout(r, 300)); for (let i = 0; i < 4; i++) { document.querySelector('[data-p=\"skip\"]:not([disabled])')?.click(); await new Promise(r => setTimeout(r, 300)); } document.querySelector('[data-p=\"done\"]:not([disabled])')?.click(); await new Promise(r => setTimeout(r, 500)); return 1")
    d1 = t.js(DRAFT) or {}
    title2 = t.js("return document.querySelector('.p-title')?.textContent.trim()")
    t.js(NET % '"down"')
    zone = t.js("const z = document.querySelector('[data-p-swipe] .p-title') || document.querySelector('[data-p-swipe]'); const r = z.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]")
    x, y = zone
    t.touch("touchStart", x + 120, y)
    for i in range(1, 7):
        t.touch("touchMove", x + 120 - 240 * i / 6, y)
        time.sleep(0.016)
    t.touch("touchEnd")
    time.sleep(2.5)
    st = t.js("const d = JSON.parse(localStorage.getItem('rehab.player.v1')); return { title: document.querySelector('.p-title')?.textContent.trim(), state: d.run.state, runId: d.run.runId, results: Object.keys(d.run.results || {}).length, toast: [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' | ') }")
    check("a20 failure: stays on the same exercise", st["title"] == title2 and st["runId"] == d1.get("run", {}).get("runId"), f"{title2!r} -> {st['title']!r}")
    check("a20 failure: paused, with the confirmed set kept", st["state"] in ("paused", "interrupted") and st["results"] >= 1, f"{st['state']} results {st['results']}")
    check("a20 failure: says Not saved yet", "Not saved yet" in st["toast"])
    # Clean up both exercises on the test copy.
    second = t.js("const d = JSON.parse(localStorage.getItem('rehab.player.v1')); return d.run.pid")
    leave_player_and_untick(t, key)
    if second and second != key:
        t.js(f"""
          const s = (ms) => new Promise(r => setTimeout(r, ms));
          const tk = document.querySelector('input.tick[data-ptoggle="{second}"]');
          if (tk && tk.checked) {{ tk.click(); await s(1200); }}
          return 1;
        """)


def a21(t):
    """A21 and A22 with tracks that 404 (the songs module on its own, no player)."""
    t.goto("#today")
    out = t.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      const S = await import('/js/player/songs.js');
      const statuses = [];
      S.onSongStatus?.((st) => statuses.push(typeof st === 'string' ? st : st?.status || JSON.stringify(st)));
      const bad = (n) => ({ sha: 'missing' + n, file: `missing-${n}.m4a`, title: 'Missing ' + n });
      // A22: every track broken. Each is tried once, then an honest error.
      S.setQueue([bad(1), bad(2), bad(3)]);
      await S.prepareSong(bad(1), 0);
      S.playSong(true);
      await s(3000);
      const allBad = { status: S.songStatus(), tries: statuses.filter(x => x === 'loading').length, wanted: S.songWanted() };
      S.stopSong();
      // A21: skip, then Pause before the next track has loaded. The Pause wins.
      // His real test-copy songs when there are two, so the skip would play.
      statuses.length = 0;
      await S.loadSongs?.();
      const real = S.songsNow().slice(0, 2);
      const pool = real.length === 2 ? real : [bad(4), bad(5)];
      S.setQueue(pool);
      await S.prepareSong(pool[0], 0);
      S.playSong(true);
      await s(600);
      statuses.length = 0;
      const skipping = S.skipSong();
      S.pauseSong();
      const got = await skipping;
      await s(800);
      const skipPause = { real: real.length === 2, wanted: S.songWanted(), status: S.songStatus(), got: got ? got.sha : null, after: statuses.slice() };
      S.stopSong();
      return { allBad, skipPause };
    """)
    print("  a21/a22:", json.dumps(out))
    ab = out["allBad"]
    check("a22: a queue of broken tracks ends in an error, not a loop", ab["status"] == "error" and ab["tries"] <= 3, json.dumps(ab))
    sp = out["skipPause"]
    check("a21: a Pause during Skip song wins (nothing plays)", sp["wanted"] is False and sp["status"] not in ("playing", "blocked") and "playing" not in sp["after"], json.dumps(sp))



def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8767")
    ap.add_argument("tests", nargs="*", default=["a1", "a2"])
    args = ap.parse_args()
    if ":8757" in args.base:
        sys.exit("refusing: 8757 is his live app")
    with cdp.Chrome(tempfile.mkdtemp(prefix="rehab-a-"), headless=True) as c:
        c.assert_is_ours()
        c.call("Emulation.setDeviceMetricsOverride", width=393, height=852, deviceScaleFactor=3, mobile=True)
        c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
        c.call("Page.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", source="window.confirm = () => true; window.alert = () => {};")
        t = T(c, args.base)
        for name in args.tests:
            globals()[name](t)
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} of {len(RESULTS)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
