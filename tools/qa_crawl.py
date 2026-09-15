#!/usr/bin/env python3
"""Bug crawl (2026-09-15, his ask: "audit the app for bugs then fix it all").

Drives the TEST server only (port 8767) in a throwaway headless Chrome. On each
screen it presses one control of every kind (the first of each signature: tag,
data attribute names, classes), each from a fresh load, and after every press
checks:

  errors    uncaught errors, rejected promises, console.error
  drift     what a fresh render would still change on screen (a patch that
            left the page stale), for views the probe can render
  stuck     motion classes still on after the motion should be over
  locked    the page left inert or a dialog left behind after Escape
  selects   a select changed to another option, then the page checked

Destructive controls (remove, delete, clear, discard, sign out, force update,
sync, backup, download) are skipped, and confirm() answers No, so nothing is
deleted even by accident. Taps still change the test copy; snapshot it first.

    python3 tools/qa_crawl.py                 # every screen, phone shell
    python3 tools/qa_crawl.py today player    # some screens
    python3 tools/qa_crawl.py --desktop       # the Mac page at 1280
"""
import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "fringe-planner" / "tools"))
import cdp  # noqa: E402

BASE = os.environ.get("REHAB_BASE", "http://localhost:8767")
if ":8757" in BASE:
    sys.exit("refusing: 8757 is his live app")

SCREENS = {
    "today": ("#today", None),
    "today-row": ("#today", "row"),
    "today-knee": ("#today", "knee"),
    "today-fold": ("#today", "fold"),
    "program": ("#program", None),
    "program-row": ("#program", "prow"),
    "supplements-edit": ("#supplements", "edit"),
    "supplements": ("#supplements", None),
    "plan": ("#plan", None),
    "overview": ("#progress", "overview"),
    "week": ("#progress", "week"),
    "history": ("#progress", "history"),
    "tests": ("#progress", "tests"),
    "melbourne": ("#progress", "melbourne"),
    "clinical": ("#progress", "clinical"),
    "settings": ("#settings", None),
    "player": ("#today", "player"),
    "player-running": ("#today", "running"),
    "player-zoom": ("#today", "zoom"),
}

GUARD = r"""
window.confirm = () => false; window.alert = () => {};
window.__errs = [];
addEventListener('error', (e) => __errs.push('error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
addEventListener('unhandledrejection', (e) => __errs.push('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
const __ce = console.error; console.error = (...a) => { __errs.push('console: ' + a.map(String).join(' ')); __ce.apply(console, a); };
"""

SETUP = r"""(async (sub) => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  if (sub === 'player' || sub === 'running' || sub === 'zoom') {
    document.querySelector('[data-act="start"], [data-act="resume"]')?.click(); await s(1300);
    if (sub === 'running') { document.querySelector('[data-p="pause"]')?.click(); await s(400); document.querySelector('[data-p="skip"]:not([disabled])')?.click(); await s(400); }
    if (sub === 'zoom') { document.querySelector('[data-p="zoom"]')?.click(); await s(500); }
  }
  else if (sub === 'row') { document.querySelectorAll('.today .crow-main[data-rowclick]')[3]?.click(); await s(700); }
  else if (sub === 'knee') { document.querySelector('[data-panel="knees"]')?.click(); await s(600); }
  else if (sub === 'fold') { const d = document.querySelector('details[data-rest="openRest"]'); if (d) d.open = true; await s(400); document.querySelectorAll('details[data-rest="openRest"] .crow-main[data-rowclick]')[0]?.click(); await s(700); }
  else if (sub === 'prow') { document.querySelectorAll('button.prog-main[data-popen]')[2]?.click(); await s(700); }
  else if (sub === 'edit') { document.querySelector('[data-supp-edit]')?.click(); await s(600); }
  else if (sub) { document.querySelector(`[data-gtab="${sub}"]`)?.click(); await s(800); }
  // open every closed disclosure so what is inside can be reached
  document.querySelectorAll('#view details:not([open])').forEach((d) => { d.open = true; });
  await s(200);
  return 1;
})"""

LIST = r"""(() => {
  const SKIP = /\b(remove|delete|clear|discard|sign out|force update|sync now|download|backup|export|reset|leave without|forget|disconnect|replace|re-add|import|restore)\b/i;
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const root = document.querySelector('.p-zoom') || document.getElementById('view');
  const els = [...root.querySelectorAll('button, [role=button], summary, input[type=checkbox], input[type=radio], select, label.supp-check, [data-rowclick], [data-catclick], [data-goto], a[href^="#"]')]
    .filter((el) => shown(el) && !el.disabled && (!el.closest('[inert]') || el.closest('.p-zoom')));
  const seen = new Map();
  for (const el of els) {
    const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    if (SKIP.test(name) || [...el.attributes].some((a) => /del|remove|clear|reset|reseed|import|refresh|pa-sync|drag/i.test(a.name))) continue;
    if (el.matches('input.supp-input')) continue;          // the label stands for it
    const sig = el.tagName + '|' + [...el.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')).sort().join(',') + '|' + [...el.classList].filter((c) => !['on', 'sel', 'done', 'open', 'pop', 'good'].includes(c)).sort().join('.');
    if (!seen.has(sig)) seen.set(sig, { sig, name, index: els.indexOf(el) });
  }
  return [...seen.values()];
})()"""

PRESS = r"""(async (index) => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const root = document.querySelector('.p-zoom') || document.getElementById('view');
  const els = [...root.querySelectorAll('button, [role=button], summary, input[type=checkbox], input[type=radio], select, label.supp-check, [data-rowclick], [data-catclick], [data-goto], a[href^="#"]')]
    .filter((el) => shown(el) && !el.disabled && (!el.closest('[inert]') || el.closest('.p-zoom')));
  const el = els[index];
  if (!el) return 'gone';
  el.scrollIntoView({ block: 'center' });
  await s(120);
  if (el.tagName === 'SELECT') {
    const i = el.selectedIndex;
    el.selectedIndex = el.options.length > 1 ? (i + 1) % el.options.length : i;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.click();
  }
  await s(1300);
  return 'pressed';
})"""

CHECK = r"""(async () => {
  const out = { errs: window.__errs.splice(0) };
  const modal = document.getElementById('modal-root');
  if (modal && modal.childElementCount) {
    out.dialog = (modal.querySelector('h2')?.textContent || modal.firstElementChild.className).slice(0, 40);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    if (modal.childElementCount) { modal.querySelector('[data-close]')?.click(); await new Promise(r => setTimeout(r, 300)); }
    if (modal.childElementCount) out.dialogStuck = true;
  }
  if (!modal?.childElementCount && document.querySelector('#view[inert], #mtabs[inert]')) out.locked = 'page inert with no dialog';
  if (document.querySelector('.modal-back.leaving')) { await new Promise(r => setTimeout(r, 300)); if (document.querySelector('.modal-back.leaving')) out.locked = 'fading dialog left behind'; }
  const stuck = [...document.querySelectorAll('#view .animating, #view .closing, #view .shut, #view .litein, #view .liteout, #view .dragging, #view .sess-leaving')];
  if (stuck.length) out.stuck = stuck.slice(0, 3).map((e) => e.className.slice(0, 60));
  const P = window.__rehabProbe;
  if (P && !document.querySelector('.player') && P.VIEWS[P.ctx.view]) {
    try {
      const M = await import('/js/morph.js');
      const tpl = M.parse(P.VIEWS[P.ctx.view][0](P.ctx)).firstElementChild;
      const a = P.viewEl.firstElementChild?.cloneNode(true);
      if (a && tpl) {
        const T = ['pop', 'flash', 'just-open', 'animating', 'fading', 'tr-enter', 'more-l', 'more-r', 'roll', 'settling'];
        a.querySelectorAll('*').forEach((el) => T.forEach((c) => el.classList.remove(c)));
        const norm = (r) => r.querySelectorAll('[class]').forEach((el) => { const v = el.getAttribute('class').split(/\s+/).filter(Boolean).join(' '); if (v) el.setAttribute('class', v); else el.removeAttribute('class'); });
        norm(a); norm(tpl);
        // live values of fields the page keeps (typed text) are not drift
        M.stats.changes = 0;
        const holder = document.createElement('div'); holder.appendChild(a);
        const ok = M.morph(a, tpl);
        if (!ok || M.stats.changes) out.drift = ok ? M.stats.changes : 'shape';
      }
    } catch (e) { out.errs.push('probe: ' + e.message); }
  }
  out.view = window.__rehabProbe?.ctx.view;
  return out;
})()"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    desktop = "--desktop" in sys.argv
    names = args or list(SCREENS)
    page = "index.html" if desktop else "m.html"
    problems = []
    total = 0
    with cdp.Chrome(tempfile.mkdtemp(prefix="rehab-crawl-"), headless=True) as c:
        c.assert_is_ours()
        if desktop:
            c.call("Emulation.setDeviceMetricsOverride", width=1280, height=900, deviceScaleFactor=1, mobile=False)
        else:
            c.call("Emulation.setDeviceMetricsOverride", width=393, height=852, deviceScaleFactor=2, mobile=True)
            c.call("Emulation.setTouchEmulationEnabled", enabled=True, maxTouchPoints=5)
        c.call("Page.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", source=GUARD)
        for name in names:
            hash_, sub = SCREENS[name]
            if desktop and sub == "player":
                continue
            url = lambda: f"{BASE}/{page}?crawl={time.time()}&probe=1{hash_}"
            c.navigate(url(), settle=2.4)
            c.eval(f"({SETUP})({json.dumps(sub)})")
            first = c.eval(CHECK)
            if first.get("errs") or first.get("drift"):
                problems.append((name, "on load", first))
            controls = c.eval(LIST)
            print(f"{name}: {len(controls)} kinds of control", flush=True)
            for ctl in controls:
                total += 1
                c.navigate(url(), settle=2.2)
                c.eval(f"({SETUP})({json.dumps(sub)})")
                c.eval("(window.__errs || []).splice(0), 1")
                try:
                    state = c.eval(f"({PRESS})({ctl['index']})")
                    r = c.eval(CHECK)
                except RuntimeError as exc:
                    if "navigated" in str(exc):
                        time.sleep(2.5)
                        continue
                    raise
                bad = {k: v for k, v in r.items() if k in ("errs", "drift", "stuck", "locked", "dialogStuck") and v}
                if state == "gone":
                    continue
                if bad:
                    problems.append((name, ctl["name"] or ctl["sig"], bad))
                    print(f"   !! {ctl['name'] or ctl['sig']}: {json.dumps(bad)[:300]}", flush=True)
    print(f"\n{total} controls pressed, {len(problems)} with problems")
    out = Path(tempfile.gettempdir()) / "rehab-crawl-last.json"
    out.write_text(json.dumps(problems, indent=1))
    print(f"results: {out}")


if __name__ == "__main__":
    main()
