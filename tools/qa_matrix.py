#!/usr/bin/env python3
"""Layout, touch and naming matrix (2026-09-15, Fable's audit Groups C and D).

Drives the TEST server only (port 8767) in a throwaway headless Chrome. For
each viewport, theme and text size it opens every screen and reports:

  overflow   the page scrolls sideways (scrollWidth past the viewport)
  small      interactive targets under 44 px on a touch screen (a checkbox
             drawn behind its label or with a widened hit area is exempt)
  unnamed    buttons and links with no accessible name
  errors     console errors

200 percent text is a root font-size simulation in Chrome, not iOS text size.
Screenshots show his logs: they stay in the scratch folder given with --shots.

    python3 tools/qa_matrix.py                      # the full matrix
    python3 tools/qa_matrix.py --quick              # 393 light only
    python3 tools/qa_matrix.py --shots /path/to/dir
"""
import argparse
import base64
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

VIEWPORTS = [
    ("320", 320, 700, True),
    ("393", 393, 852, True),
    ("852x393", 852, 393, True),
    ("834", 834, 1194, True),
    ("1194", 1194, 834, True),
    ("1280", 1280, 800, False),
]
SCREENS = [
    ("today", "#today", None),
    ("today-knee", "#today", "knee"),
    ("program", "#program", None),
    ("supplements", "#supplements", None),
    ("plan", "#plan", None),
    ("overview", "#progress", "overview"),
    ("week", "#progress", "week"),
    ("history", "#progress", "history"),
    ("tests", "#progress", "tests"),
    ("melbourne", "#progress", "melbourne"),
    ("clinical", "#progress", "clinical"),
    ("settings", "#settings", None),
    ("player", "#today", "player"),
]

PROBE = r"""
(() => {
  const vw = document.documentElement.clientWidth;
  const overflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const shown = (el) => {
    if (!el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
    || (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim())
    || (el.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
  const label = (el) => {
    const t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.getAttribute('data-p') || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${t.slice(0, 40)}"`;
  };
  const small = [];
  const seen = new Set();
  const sel = 'button, a[href], select, input:not([type=hidden]), textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])';
  for (const el of document.querySelectorAll(sel)) {
    if (!shown(el) || el.closest('[inert], [aria-hidden="true"]')) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    // A control inside a larger clickable label, or a checkbox with a widened
    // hit area (::before inset), counts at the size of what the finger hits.
    let w = r.width, h = r.height;
    const lab = el.closest('label');
    if (lab && el.tagName === 'INPUT') { const lr = lab.getBoundingClientRect(); w = Math.max(w, lr.width); h = Math.max(h, lr.height); }
    if (el.matches('input[type=checkbox].tick')) { w += 16; h += 16; }
    // An invisible hit strip (::after, absolutely placed) counts as what the pointer hits (Codex audit L01).
    const after = getComputedStyle(el, '::after');
    if (after.content !== 'none' && after.position === 'absolute' && getComputedStyle(el).position !== 'static') {
      const px = (v) => (v.endsWith('px') ? parseFloat(v) : 0);
      h = Math.max(h, r.height - Math.min(0, px(after.top)) - Math.min(0, px(after.bottom)));
    }
    if (el.matches('.sess-row, tr[tabindex]')) continue;     // a whole row
    if (w + 0.5 < 44 || h + 0.5 < 44) {
      const k = label(el);
      if (!seen.has(k)) { seen.add(k); small.push(`${k} ${Math.round(w)}x${Math.round(h)}`); }
    }
  }
  const unnamed = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button]')) {
    if (!shown(el)) continue;
    if (!name(el)) unnamed.push(label(el) + ' ' + el.outerHTML.slice(0, 80));
  }
  // Form controls too (Codex audit A01): a slider or select with no name, or two in
  // one group that say the same thing ("swelling" twice, with no left or right).
  const fieldName = (el) => (el.getAttribute('aria-label') || [...(el.labels || [])].map((l) => l.textContent).join(' ') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  const seenNames = new Map();
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!shown(el) || el.closest('[inert], [aria-hidden="true"]')) continue;
    const n = fieldName(el);
    if (!n && !el.getAttribute('aria-labelledby') && !el.getAttribute('placeholder')) { unnamed.push(label(el) + ' ' + el.outerHTML.slice(0, 80)); continue; }
    if (el.type === 'checkbox' || el.type === 'radio') continue;
    const group = el.closest('section, details, .card, form, [role=group]') || document.body;
    const k = n.toLowerCase();
    const prev = seenNames.get(k);
    if (prev && prev.group === group && n) unnamed.push(`${label(el)} same name as another field here: "${n.slice(0, 40)}"`);
    else seenNames.set(k, { group });
  }
  const h1 = [...document.querySelectorAll('h1')].filter(shown).length;
  return { overflow: Math.max(0, Math.round(overflow)), small, unnamed, h1 };
})()
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--shots", default=None)
    ap.add_argument("--only", default=None, help="comma list of screen names")
    args = ap.parse_args()
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    configs = []
    for vp in VIEWPORTS:
        for theme in ("light", "dark"):
            for text in (100, 200):
                configs.append((vp, theme, text))
    if args.quick:
        configs = [(VIEWPORTS[1], "light", 100)]
    screens = [s for s in SCREENS if not args.only or s[0] in args.only.split(",")]
    totals = {"overflow": 0, "small": 0, "unnamed": 0, "errors": 0, "h1": 0}
    report = []
    with cdp.Chrome(tempfile.mkdtemp(prefix="rehab-qa-"), headless=True) as c:
        c.assert_is_ours()
        c.call("Page.enable")
        c.call("Runtime.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", source="window.confirm = () => true; window.alert = () => {}; window.__qaErrors = []; addEventListener('error', (e) => __qaErrors.push(String(e.message))); addEventListener('unhandledrejection', (e) => __qaErrors.push(String(e.reason))); const ce = console.error; console.error = (...a) => { __qaErrors.push(a.join(' ')); ce.apply(console, a); };")
        for (vname, w, h, touch), theme, text in configs:
            c.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=2, mobile=touch)
            c.call("Emulation.setTouchEmulationEnabled", enabled=touch, maxTouchPoints=5 if touch else 1)
            c.call("Emulation.setEmulatedMedia", features=[
                {"name": "prefers-color-scheme", "value": theme},
                {"name": "pointer", "value": "coarse" if touch else "fine"},
            ])
            # The text size and theme are in place before the app draws, as on a device.
            if "script_id" in locals() and script_id:
                c.call("Page.removeScriptToEvaluateOnNewDocument", identifier=script_id)
            script_id = c.call("Page.addScriptToEvaluateOnNewDocument", source=(
                f"new MutationObserver((m, o) => {{ if (document.documentElement) {{ document.documentElement.style.fontSize = '{text}%'; o.disconnect(); }} }}).observe(document, {{ childList: true }});"
                f"try {{ localStorage.setItem('rehab.theme', '{theme}'); }} catch {{}}"))["identifier"]
            page = "m.html" if touch else "index.html"
            for sname, hash_, sub in screens:
                if not touch and sname == "player":
                    continue
                c.navigate(f"{BASE}/{page}?qa={time.time()}{hash_}", settle=2.2)
                c.eval(f"""(async () => {{
                  try {{ localStorage.setItem('rehab.theme', '{theme}'); }} catch {{}}
                  document.documentElement.setAttribute('data-theme', '{theme}');
                  const s = (ms) => new Promise(r => setTimeout(r, ms));
                  const sub = {json.dumps(sub)};
                  if (sub === 'knee') {{ document.querySelector('[data-panel="knees"]')?.click(); await s(700); }}
                  else if (sub === 'player') {{ document.querySelector('[data-act="start"], [data-act="resume"]')?.click(); await s(1200); }}
                  else if (sub) {{ document.querySelector(`[data-gtab="${{sub}}"]`)?.click(); await s(700); }}
                  window.dispatchEvent(new Event('resize'));
                  await s(400);
                  return 1;
                }})()""")
                errs = c.eval("(window.__qaErrors || []).length") or 0
                r = c.eval(PROBE)
                r["errors"] = errs
                key = f"{vname} {theme} {text}% {sname}"
                report.append((key, r))
                totals["overflow"] += 1 if r["overflow"] else 0
                # The Mac page counts too (Codex audit L01): its hit strips are measured, not assumed.
                totals["small"] += len(r["small"])
                totals["unnamed"] += len(r["unnamed"])
                totals["h1"] += 1 if r["h1"] > 1 else 0
                totals["errors"] += errs
                if r["overflow"] or r["small"] or r["unnamed"] or r["h1"] > 1:
                    print(f"{key}: overflow {r['overflow']} small {len(r['small'])} unnamed {len(r['unnamed'])} h1 {r['h1']}")
                    for x in r["small"][:12]:
                        print("   small  ", x)
                    for x in r["unnamed"][:6]:
                        print("   unnamed", x)
                if shots:
                    data = c.call("Page.captureScreenshot", format="png")["data"]
                    (shots / f"{vname}-{theme}-{text}-{sname}.png").write_bytes(base64.b64decode(data))
                if sname == "player":
                    c.eval("""(async () => { document.querySelector('#nav-back, [data-p="close"]')?.click(); await new Promise(r => setTimeout(r, 400)); return 1; })()""")
    print(f"\n{len(report)} pages: {totals['overflow']} scrolling sideways, {totals['small']} targets under 44 px, "
          f"{totals['unnamed']} unnamed controls, {totals['h1']} pages with more than one h1, {totals['errors']} console errors")
    out = Path(tempfile.gettempdir()) / "rehab-qa-last.json"
    out.write_text(json.dumps(report, indent=1))
    print(f"results: {out}")


if __name__ == "__main__":
    main()
