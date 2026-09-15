#!/usr/bin/env python3
"""Motion measurement harness (2026-09-15, Fable's audit of 9ffec4c).

Drives the TEST server only (port 8767, started with --no-physiapp) in a
throwaway headless Chrome: 393x852 at DPR 3 with touch emulation, CPU slowed
1x, 4x and 6x. For each interaction it reports:

  repaints   whole-view repaints (childList mutations on #view itself)
  tap        synchronous cost of the tap: capture listener on document to a
             bubble listener on window, for click or change
  longest    longest requestAnimationFrame interval in the 900 ms after
  over34     frames over 34 ms
  step       largest per-frame move of a box that should stay still
  net        net move of that box from before the tap to the end
  moverStep  largest per-frame move of a box that is meant to move
  decodes    image decode events in a devtools.timeline trace
  longtasks  PerformanceObserver longtask durations

Every interaction is a round trip where it changes data, so the test copy's
entry count is the same before and after (checked at the end).

    python3 tools/perf_motion.py            # all, at 1x 4x 6x
    python3 tools/perf_motion.py row_open 6 # one interaction, one rate
"""
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fringe-planner" / "tools"))
import cdp  # noqa: E402

import os
BASE = os.environ.get("REHAB_BASE", "http://localhost:8767")
if ":8757" in BASE:
    sys.exit("refusing: 8757 is his live app")

INSTRUMENT = r"""
(() => {
  if (window.__perf) return;
  const P = window.__perf = {};
  P.begin = (stillSel, moverSel) => {
    const st = P.st = { frames: [], still: [], mover: [], repaints: 0, longtasks: [], tap: null };
    const view = document.getElementById('view');
    st.mo = new MutationObserver((list) => { for (const m of list) if (m.target === view && m.removedNodes.length) { st.repaints++; break; } });
    st.mo.observe(view, { childList: true });
    try { st.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longtasks.push(Math.round(e.duration)); }); st.po.observe({ type: 'longtask' }); } catch {}
    const box = (sel) => { const el = typeof sel === 'function' ? sel() : sel && document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top]; };
    st.stillSel = stillSel; st.moverSel = moverSel;
    st.still0 = box(stillSel); st.mover0 = box(moverSel);
    let last = performance.now();
    st.run = true;
    const tick = (t) => { st.frames.push(t - last); last = t; st.still.push(box(stillSel)); st.mover.push(box(moverSel)); if (st.run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const t0 = { v: 0 };
    st.cap = (e) => { t0.v = performance.now(); };
    st.bub = (e) => { if (t0.v) { st.tap = (st.tap || 0) + (performance.now() - t0.v); t0.v = 0; } };
    for (const type of ['click', 'change']) { document.addEventListener(type, st.cap, true); window.addEventListener(type, st.bub, false); }
  };
  P.end = () => {
    const st = P.st; st.run = false; st.mo.disconnect(); try { st.po.disconnect(); } catch {}
    for (const type of ['click', 'change']) { document.removeEventListener(type, st.cap, true); window.removeEventListener(type, st.bub, false); }
    const steps = (arr, base) => { let max = 0, prev = base; for (const b of arr) { if (b && prev) max = Math.max(max, Math.abs(b[1] - prev[1]), Math.abs(b[0] - prev[0])); if (b) prev = b; } return max; };
    const lastOf = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i]) return arr[i]; return null; };
    const f = st.frames.slice(1);
    const s0 = st.still0, s1 = lastOf(st.still);
    return {
      repaints: st.repaints, tap: st.tap == null ? null : Math.round(st.tap * 10) / 10,
      longest: Math.round(Math.max(0, ...f)), over34: f.filter((x) => x > 34).length,
      step: Math.round(steps(st.still, s0) * 10) / 10,
      net: s0 && s1 ? Math.round(Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) * 10) / 10 : null,
      moverStep: Math.round(steps(st.mover, st.mover0) * 10) / 10,
      longtasks: st.longtasks,
    };
  };
})();
"""


class Harness:
    def __init__(self, c):
        self.c = c

    def js(self, code):
        return self.c.eval("(async () => {" + code + "})()")

    def raw(self, method, **params):
        """Send a command and collect events until its reply (cdp.call drops events)."""
        self.c._id += 1
        mid = self.c._id
        self.c.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        events = []
        while True:
            msg = json.loads(self.c.ws.recv())
            if msg.get("id") == mid:
                return msg.get("result", {}), events
            events.append(msg)

    def trace_start(self):
        self.c.call("Tracing.start", categories="devtools.timeline,disabled-by-default-devtools.timeline",
                    transferMode="ReportEvents")

    def trace_end(self):
        _, events = self.raw("Tracing.end")
        decodes = 0
        deadline = time.time() + 10
        done = False
        while not done and time.time() < deadline:
            for e in events:
                if e.get("method") == "Tracing.dataCollected":
                    for ev in e["params"].get("value", []):
                        if ev.get("name") in ("Decode Image", "ImageDecodeTask", "Decode LazyPixelRef"):
                            decodes += 1
                if e.get("method") == "Tracing.tracingComplete":
                    done = True
            events = []
            if not done:
                try:
                    events = [json.loads(self.c.ws.recv())]
                except Exception:  # noqa: BLE001
                    break
        return decodes

    def tap_point(self, sel_js):
        pt = self.js(f"const el = {sel_js}; if (!el) return null; el.scrollIntoView({{block: 'center'}}); await new Promise(r => setTimeout(r, 250)); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];")
        return pt

    def touch_tap(self, x, y):
        self.c.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{"x": x, "y": y}])
        self.c.call("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])

    def touch_swipe(self, x0, y0, x1, y1, steps=6):
        self.c.call("Input.dispatchTouchEvent", type="touchStart", touchPoints=[{"x": x0, "y": y0}])
        for i in range(1, steps + 1):
            self.c.call("Input.dispatchTouchEvent", type="touchMove",
                        touchPoints=[{"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps}])
            time.sleep(0.016)
        self.c.call("Input.dispatchTouchEvent", type="touchEnd", touchPoints=[])

    def measure(self, act, still=None, mover=None, wait=0.9):
        self.js(INSTRUMENT + "return 1")
        lit = lambda v: "null" if v is None else (v if v.startswith("() =>") else json.dumps(v))
        s = lit(still)
        m = lit(mover)
        self.js(f"window.__perf.begin({s}, {m}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return 1")
        self.trace_start()
        act()
        time.sleep(wait)
        decodes = self.trace_end()
        out = self.js("return window.__perf.end()")
        out["decodes"] = decodes
        out["drift"] = self.drift()
        return out

    def drift(self):
        """Changes a fresh render would still make to what is on screen: 0 means
        an in-place patch left exactly what a full repaint would draw (animation
        classes aside, which are gone by now)."""
        return self.js("""
          const P = window.__rehabProbe; if (!P || document.querySelector('.player') || document.querySelector('#modal-root').childElementCount) return null;
          const M = await import('/js/morph.js');
          const view = P.viewEl; const render = P.VIEWS[P.ctx.view]?.[0]; if (!render) return null;
          const tpl = M.parse(render(P.ctx)).firstElementChild;
          const a = view.firstElementChild.cloneNode(true);
          // One-render animation flags are expected to differ.
          a.querySelectorAll('.pop, .just-open, .animating, .fading, .tr-enter, .more-l, .more-r').forEach((el) => el.classList.remove('pop', 'just-open', 'animating', 'fading', 'tr-enter', 'more-l', 'more-r'));
          const norm = (root) => root.querySelectorAll('[class]').forEach((el) => { const v = el.getAttribute('class').split(/\s+/).filter(Boolean).join(' '); if (v) el.setAttribute('class', v); else el.removeAttribute('class'); });
          norm(a); norm(tpl);
          const holder = document.createElement('div'); holder.appendChild(a);
          M.stats.changes = 0;
          const ok = M.morph(a, tpl);
          return ok ? M.stats.changes : 'shape';
        """)


def goto(h, hash_, settle=2.2):
    h.c.navigate(f"{BASE}/m.html?perf={time.time()}&probe=1{hash_}", settle=settle)
    h.js("window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 200)); return 1")


def entry_count():
    with urllib.request.urlopen(f"{BASE}/api/data") as r:
        d = json.load(r)
    return sum(len(x.get("entries", [])) for x in d.get("days", {}).values()), \
        sum(len(x.get("supps") or {}) for x in d.get("days", {}).values())


# ---- the interactions ------------------------------------------------------
# The third row. Its body height is reported with the steps (Fable's step
# target is for a 480 px body; a taller body moves more per frame).
ROW = "[...document.querySelectorAll('.today .crow-main[data-rowclick]')][2]"


def i_row_open(h):
    goto(h, "#today")
    key = h.js(f"return {ROW}.dataset.rowclick")
    pt = h.tap_point(f"document.querySelector('[data-rowclick=\"{key}\"]')")
    still = f"() => document.querySelector('[data-rowclick=\"{key}\"]')"
    mover = f"() => document.querySelector('[data-rowclick=\"{key}\"]').closest('.crow').nextElementSibling"
    r = h.measure(lambda: h.touch_tap(*pt), still, mover)
    r["bodyH"] = h.js(f"return Math.round(document.querySelector('[data-rowclick=\"{key}\"]').closest('.crow').querySelector('.crow-body')?.getBoundingClientRect().height || 0)")
    return r


def i_row_close(h):
    goto(h, "#today")
    key = h.js(f"return {ROW}.dataset.rowclick")
    pt = h.tap_point(f"document.querySelector('[data-rowclick=\"{key}\"]')")
    h.touch_tap(*pt)
    time.sleep(0.8)
    pt = h.tap_point(f"document.querySelector('[data-rowclick=\"{key}\"]')")
    still = f"() => document.querySelector('[data-rowclick=\"{key}\"]')"
    mover = f"() => document.querySelector('[data-rowclick=\"{key}\"]').closest('.crow').nextElementSibling"
    return h.measure(lambda: h.touch_tap(*pt), still, mover)


def i_tick(h):
    goto(h, "#today")
    pid = h.js("const t = [...document.querySelectorAll('.today input.tick[data-ptoggle]')].filter(x => !x.checked)[1]; return t ? t.dataset.ptoggle : null")
    sel = f"document.querySelector('input.tick[data-ptoggle=\"{pid}\"]')"
    pt = h.tap_point(sel)
    still = "() => [...document.querySelectorAll('.today .crow-main')][0]"
    mover = f"() => document.querySelector('input.tick[data-ptoggle=\"{pid}\"]').closest('.crow').nextElementSibling"
    r = h.measure(lambda: h.touch_tap(*pt), still, mover)
    time.sleep(0.4)
    pt = h.tap_point(sel)
    h.touch_tap(*pt)          # untick: round trip
    time.sleep(0.6)
    return r


def _supp_tick(h, hash_):
    goto(h, hash_)
    sid = h.js("const t = [...document.querySelectorAll('input.supp-input[data-supp]')].filter(x => !x.checked)[0]; return t ? t.dataset.supp : null")
    if not sid:
        return {"skipped": "no untaken supplement"}
    sel = f"document.querySelector('input.supp-input[data-supp=\"{sid}\"]').closest('label')"
    pt = h.tap_point(sel)
    still = f"() => document.querySelector('input.supp-input[data-supp=\"{sid}\"]').closest('.supprow')"
    mover = "() => document.querySelector('.suppgrouphead')"
    r = h.measure(lambda: h.touch_tap(*pt), still, mover)
    time.sleep(0.4)
    pt = h.tap_point(sel)
    h.touch_tap(*pt)
    time.sleep(0.6)
    return r


def i_supp_tick_today(h):
    return _supp_tick(h, "#today")


def i_supp_tick_supps(h):
    return _supp_tick(h, "#supplements")


def i_date_next(h):
    goto(h, "#today")
    pt = h.tap_point("document.querySelector('[data-nav=\"1\"]')")
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.today .crow-main')", "() => document.querySelector('.daynav')")
    pt = h.tap_point("document.querySelector('[data-nav=\"-1\"]')")
    h.touch_tap(*pt)
    time.sleep(0.5)
    return r


def i_menu_open(h):
    goto(h, "#today")
    pt = h.tap_point("document.querySelector('[data-act=\"menu\"]')")
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.daynav')", "() => document.querySelector('#modal-root .modal, #modal-root .sheet')")
    h.js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); await new Promise(r => setTimeout(r, 300)); return 1")
    return r


def i_knee_open(h):
    goto(h, "#today")
    sel = "document.querySelector('[data-panel=\"knees\"]')"
    pt = h.tap_point(sel)
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('[data-panel=\"knees\"]')", "() => document.querySelector('[data-panel=\"knees\"]').closest('section').nextElementSibling")
    pt = h.tap_point(sel)
    h.touch_tap(*pt)
    time.sleep(0.5)
    return r


def i_group_fold(h):
    goto(h, "#supplements")
    sel = "document.querySelector('.suppgrouphead')"
    pt = h.tap_point(sel)
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.suppgrouphead')", "() => document.querySelectorAll('.suppgrouphead')[1]")
    pt = h.tap_point(sel)
    h.touch_tap(*pt)
    time.sleep(0.5)
    return r


def i_rest_fold(h):
    goto(h, "#today")
    sel = "document.querySelector('details[data-rest=\"openRest\"] > summary')"
    pt = h.tap_point(sel)
    if not pt:
        return {"skipped": "no fold"}
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('details[data-rest=\"openRest\"] > summary')", "() => document.querySelector('details[data-rest=\"openRest\"]').nextElementSibling || document.querySelector('.supps')")
    pt = h.tap_point(sel)
    h.touch_tap(*pt)
    time.sleep(0.5)
    return r


def i_knee_close(h):
    goto(h, "#today")
    sel = "document.querySelector('[data-panel=\"knees\"]')"
    pt = h.tap_point(sel)
    h.touch_tap(*pt)
    time.sleep(0.6)
    pt = h.tap_point(sel)
    return h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('[data-panel=\"knees\"]')", "() => document.querySelector('[data-panel=\"knees\"]').closest('section').nextElementSibling")


def i_program_row_open(h):
    goto(h, "#program")
    key = h.js("return [...document.querySelectorAll('button.prog-main[data-popen]')][2].dataset.popen")
    sel = f"document.querySelector('button.prog-main[data-popen=\"{key}\"]')"
    pt = h.tap_point(sel)
    still = f"() => document.querySelector('button.prog-main[data-popen=\"{key}\"]')"
    mover = f"() => document.querySelector('button.prog-main[data-popen=\"{key}\"]').closest('.prog-row').nextElementSibling"
    r = h.measure(lambda: h.touch_tap(*pt), still, mover)
    pt = h.tap_point(sel)
    h.touch_tap(*pt)
    time.sleep(0.5)
    return r


def i_tab_change(h):
    goto(h, "#today")
    pt = h.js("const r = document.querySelector('#mtabs button[data-view=\"progress\"]').getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]")
    return h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('#mtabs')", None)


def i_history_open(h):
    goto(h, "#progress")
    pt = h.tap_point("document.querySelector('[data-gtab=\"history\"]')")
    return h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.subnav')", None)


def i_history_select(h):
    goto(h, "#progress")
    h.js("document.querySelector('[data-gtab=\"history\"]').click(); await new Promise(r => setTimeout(r, 500)); return 1")
    pt = h.tap_point("document.querySelectorAll('.sess:not(.compact) .sess-row')[3]")
    return h.measure(lambda: h.touch_tap(*pt), "() => document.querySelectorAll('.sess:not(.compact) .sess-row')[1]", "() => document.querySelectorAll('.sess:not(.compact) .sess-row')[5]")


def i_chart_select(h):
    goto(h, "#progress")
    pt = h.tap_point("[...document.querySelectorAll('.trend .tr-hit')][0]")
    if not pt:
        return {"skipped": "no chart"}
    return h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.trend .tr-head')", "() => document.querySelector('.tr-guide')")


def i_chart_range(h):
    goto(h, "#progress")
    pt = h.tap_point("document.querySelector('[data-tr-range=\"6m\"]')")
    if not pt:
        return {"skipped": "no chart"}
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.trend .tr-head')", None)
    h.js("document.querySelector('[data-tr-range=\"all\"]')?.click(); return 1")
    return r


def _open_player(h):
    goto(h, "#today")
    h.js("document.querySelector('[data-act=\"start\"], [data-act=\"resume\"]')?.click(); await new Promise(r => setTimeout(r, 1200)); return !!document.querySelector('.player')")


def _close_player(h):
    h.js("const b = document.querySelector('#nav-back'); b && b.click(); await new Promise(r => setTimeout(r, 500)); const d = document.querySelector('[data-s=\"discard\"]'); d && d.click(); await new Promise(r => setTimeout(r, 400)); return 1")


def i_swipe(h):
    _open_player(h)
    pt = h.js("const z = document.querySelector('[data-p-swipe] .p-title'); const r = z.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]")
    r = h.measure(lambda: h.touch_swipe(pt[0] + 120, pt[1], pt[0] - 120, pt[1]), "() => document.querySelector('.p-dial')", "() => document.querySelector('.p-img')")
    _close_player(h)
    return r


def i_arrows(h):
    _open_player(h)
    pt = h.tap_point("document.querySelector('[data-p=\"ex-next\"]')")
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.p-dial')", "() => document.querySelector('.p-img')")
    _close_player(h)
    return r


def i_set_done(h):
    goto(h, "#today")
    phase = h.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      const key = [...document.querySelectorAll('.today .crow-main[data-rowclick]')]
        .map(b => b.dataset.rowclick).find(k => /^pa(0[1-35-79]|1[0-5])$/.test(k) && !document.querySelector(`input.tick[data-ptoggle="${k}"]`)?.checked);
      if (!key) return 'no reps row';
      document.querySelector(`[data-rowclick="${key}"]`).click(); await s(600);
      const begin = document.querySelector(`#row-${key} [data-timer]`);
      if (!begin) return 'no begin';
      begin.click(); await s(1200);
      if (!document.querySelector('.player')) return 'no player';
      document.querySelector('[data-p="pause"]')?.click(); await s(300);
      for (let i = 0; i < 6; i++) { const b = document.querySelector('[data-p="skip"]:not([disabled])'); if (!b) break; b.click(); await s(300); }
      return document.querySelector('.p-phaserow')?.textContent.trim().slice(0, 40) || 'unknown';
    """)
    pt = h.tap_point("document.querySelector('[data-p=\"done\"]:not([disabled])')")
    if not pt:
        return {"skipped": f"Set done not available ({phase})"}
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.p-img')", "() => document.querySelector('.p-ring')")
    r["phase"] = phase
    _close_player(h)
    return r


def i_carry_on(h):
    """The last set of an exercise: logged receipt while the next get ready runs.
    Logs a real entry on the test copy, so it is undone afterwards."""
    goto(h, "#today")
    info = h.js("""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      const key = [...document.querySelectorAll('.today .crow-main[data-rowclick]')]
        .map(b => b.dataset.rowclick).find(k => /^pa(0[1-35-79]|1[0-5])$/.test(k) && !document.querySelector(`input.tick[data-ptoggle="${k}"]`)?.checked);
      if (!key) return null;
      document.querySelector(`[data-rowclick="${key}"]`).click(); await s(600);
      document.querySelector(`#row-${key} [data-timer]`)?.click(); await s(1200);
      document.querySelector('[data-p="pause"]')?.click(); await s(300);
      // Everything but the last set: Set done or Skip until the Next line says
      // the exercise logs next.
      for (let i = 0; i < 60; i++) {
        const nextTxt = document.querySelector('[data-slot="next"]')?.textContent || '';
        const done = document.querySelector('[data-p="done"]:not([disabled])');
        const skip = document.querySelector('[data-p="skip"]:not([disabled])');
        if (/log it/.test(nextTxt) && done) break;
        if (skip) { skip.click(); await s(200); continue; }
        if (done) { done.click(); await s(250); continue; }
        await s(300);
      }
      return key;
    """)
    if not info:
        return {"skipped": "no reps row"}
    pt = h.tap_point("document.querySelector('[data-p=\"done\"]:not([disabled])')")
    if not pt:
        return {"skipped": "no Set done"}
    r = h.measure(lambda: h.touch_tap(*pt), "() => document.querySelector('.p-dial')", "() => document.querySelector('.p-img')", wait=1.6)
    # Undo the logged run on the test copy: untick it on Today.
    _close_player(h)
    h.js(f"""
      const s = (ms) => new Promise(r => setTimeout(r, ms));
      location.hash = 'today'; await s(600);
      const t = document.querySelector('input.tick[data-ptoggle="{info}"]');
      if (t && t.checked) {{ t.click(); await s(700); }}
      return 1;
    """)
    return r


INTERACTIONS = {
    "row_open": i_row_open, "row_close": i_row_close, "tick": i_tick,
    "supp_tick_today": i_supp_tick_today, "supp_tick_supps": i_supp_tick_supps,
    "date_next": i_date_next, "menu_open": i_menu_open, "knee_open": i_knee_open,
    "group_fold": i_group_fold, "rest_fold": i_rest_fold, "knee_close": i_knee_close,
    "program_row_open": i_program_row_open, "tab_change": i_tab_change,
    "history_open": i_history_open, "history_select": i_history_select,
    "chart_select": i_chart_select, "chart_range": i_chart_range,
    "swipe": i_swipe, "arrows": i_arrows, "set_done": i_set_done, "carry_on": i_carry_on,
}


def reduced_motion_check(c, h):
    """Fable B11 exit check: with Reduce Motion emulated, no animation or
    transition runs after a tick, a fold, a toast and a player phase change."""
    c.call("Emulation.setEmulatedMedia", features=[{"name": "prefers-reduced-motion", "value": "reduce"}])
    live = "return document.getAnimations().map(a => (a.animationName || a.transitionProperty || a.constructor.name) + ' on ' + (a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? '')).slice(0, 8)"
    out = {}
    goto(h, "#today")
    pid = h.js("const t = [...document.querySelectorAll('.today input.tick[data-ptoggle]')].filter(x => !x.checked)[1]; return t ? t.dataset.ptoggle : null")
    sel = f"document.querySelector('input.tick[data-ptoggle=\"{pid}\"]')"
    h.touch_tap(*h.tap_point(sel)); time.sleep(0.05)
    out["tick"] = h.js(live)
    time.sleep(0.5); h.touch_tap(*h.tap_point(sel)); time.sleep(0.5)
    h.touch_tap(*h.tap_point("document.querySelector('[data-panel=\"knees\"]')")); time.sleep(0.05)
    out["fold"] = h.js(live)
    time.sleep(0.4); h.touch_tap(*h.tap_point("document.querySelector('[data-panel=\"knees\"]')")); time.sleep(0.4)
    out["toast"] = h.js("const C = await import('/js/components.js'); C.toast('<b>Test</b>'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); " + live)
    _open_player(h)
    h.js("document.querySelector('[data-p=\"pause\"]')?.click(); await new Promise(r => setTimeout(r, 300)); document.querySelector('[data-p=\"skip\"]:not([disabled])')?.click(); return 1")
    time.sleep(0.05)
    out["phase"] = h.js(live)
    _close_player(h)
    c.call("Emulation.setEmulatedMedia", features=[])
    return out


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "reduced":
        with cdp.Chrome(tempfile.mkdtemp(prefix="rehab-perf-"), headless=True) as c:
            c.assert_is_ours()
            c.call("Emulation.setDeviceMetricsOverride", width=393, height=852, deviceScaleFactor=3, mobile=True)
            c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
            c.call("Page.enable")
            c.call("Page.addScriptToEvaluateOnNewDocument", source="window.confirm = () => true; window.alert = () => {};")
            r = reduced_motion_check(c, Harness(c))
        print(json.dumps(r))
        print("reduced motion:", "PASS" if all(not v for v in r.values()) else "FAIL")
        return
    names = [sys.argv[1]] if len(sys.argv) > 1 and sys.argv[1] in INTERACTIONS else list(INTERACTIONS)
    rates = [float(sys.argv[2])] if len(sys.argv) > 2 else [1, 4, 6]
    before = entry_count()
    results = {}
    with cdp.Chrome(tempfile.mkdtemp(prefix="rehab-perf-"), headless=True) as c:
        c.assert_is_ours()
        c.call("Emulation.setDeviceMetricsOverride", width=393, height=852, deviceScaleFactor=3, mobile=True)
        c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
        # A native confirm (leaving the player without recording) would block
        # every evaluation in headless Chrome; answer it for the harness.
        c.call("Page.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", source="window.confirm = () => true; window.alert = () => {};")
        h = Harness(c)
        for rate in rates:
            for name in names:
                c.call("Emulation.setCPUThrottlingRate", rate=1)
                try:
                    # Load at full speed, measure at the chosen rate.
                    fn = INTERACTIONS[name]
                    c.call("Emulation.setCPUThrottlingRate", rate=rate)
                    r = fn(h)
                except Exception as exc:  # noqa: BLE001
                    r = {"error": str(exc)[:160]}
                results[f"{name}@{int(rate)}x"] = r
                print(f"{name:18s} {int(rate)}x  {json.dumps(r)}", flush=True)
        c.call("Emulation.setCPUThrottlingRate", rate=1)
    after = entry_count()
    print(f"\ntest copy entries and supplement ticks before {before} after {after}")
    out = Path(tempfile.gettempdir()) / "rehab-perf-last.json"
    out.write_text(json.dumps(results, indent=1))
    print(f"results: {out}")


if __name__ == "__main__":
    main()
