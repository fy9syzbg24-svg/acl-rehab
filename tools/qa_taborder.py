#!/usr/bin/env python3
"""Keyboard order check (2026-09-15, Fable D exit check).

On the TEST server, for each screen at 393 px: press Tab through the page and
compare what receives focus with every focusable control in document order.
Reports controls Tab never reaches, focus that jumps backwards, and any
positive tabindex.

    python3 tools/qa_taborder.py
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

SCREENS = [("today", "#today", None), ("program", "#program", None), ("supplements", "#supplements", None),
           ("plan", "#plan", None), ("overview", "#progress", "overview"), ("week", "#progress", "week"),
           ("history", "#progress", "history"), ("settings", "#settings", None), ("player", "#today", "player")]

LIST = r"""(() => {
  const shown = (el) => { const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const sel = 'button, a[href], select, input:not([type=hidden]), textarea, summary, [tabindex]';
  const all = [...document.querySelectorAll(sel)].filter((el) => !el.disabled && el.tabIndex >= 0 && shown(el) && !el.closest('[inert], details:not([open]) > :not(summary)'));
  all.forEach((el, i) => el.setAttribute('data-qa-i', i));
  return { n: all.length, positive: [...document.querySelectorAll('[tabindex]')].filter((el) => el.tabIndex > 0).length };
})()"""


def main():
    bad = 0
    with cdp.Chrome(tempfile.mkdtemp(prefix="rehab-tab-"), headless=True) as c:
        c.assert_is_ours()
        c.call("Emulation.setDeviceMetricsOverride", width=393, height=852, deviceScaleFactor=2, mobile=True)
        c.call("Page.enable")
        c.call("Page.addScriptToEvaluateOnNewDocument", source="window.confirm = () => true;")
        for name, hash_, sub in SCREENS:
            c.navigate(f"{BASE}/m.html?tab={time.time()}{hash_}", settle=2.2)
            c.eval(f"""(async () => {{ const s = (ms) => new Promise(r => setTimeout(r, ms)); const sub = {json.dumps(sub)};
              if (sub === 'player') {{ document.querySelector('[data-act="start"], [data-act="resume"]')?.click(); await s(1200); }}
              else if (sub) {{ document.querySelector(`[data-gtab="${{sub}}"]`)?.click(); await s(700); }}
              document.activeElement?.blur(); window.scrollTo(0, 0); return 1; }})()""")
            info = c.eval(LIST)
            seen = []
            for _ in range(info["n"] + 40):
                c.call("Input.dispatchKeyEvent", type="keyDown", key="Tab", code="Tab", windowsVirtualKeyCode=9)
                c.call("Input.dispatchKeyEvent", type="keyUp", key="Tab", code="Tab", windowsVirtualKeyCode=9)
                i = c.eval("document.activeElement?.getAttribute('data-qa-i')")
                if i is not None:
                    i = int(i)
                    if seen and i == seen[0] and len(seen) > 1:
                        break
                    seen.append(i)
            page = [i for i in seen]
            missing = sorted(set(range(info["n"])) - set(page))
            backwards = sum(1 for a, b in zip(page, page[1:]) if b < a)
            ok = not missing and backwards == 0 and info["positive"] == 0
            bad += 0 if ok else 1
            detail = ""
            if missing:
                detail = c.eval(f"JSON.stringify({json.dumps(missing[:6])}.map(i => {{ const el = document.querySelector(`[data-qa-i=\"${{i}}\"]`); return el.tagName + ' ' + (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30); }}))")
            print(f"{'ok  ' if ok else 'FAIL'} {name:12s} {info['n']} controls, reached {len(set(page))}, backwards {backwards}, positive tabindex {info['positive']} {detail}")
            if sub == "player":
                c.eval("document.querySelector('#nav-back')?.click(); 1")
    print(f"\n{len(SCREENS) - bad} of {len(SCREENS)} screens in order")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
