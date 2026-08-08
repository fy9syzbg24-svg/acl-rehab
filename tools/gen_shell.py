#!/usr/bin/env python3
"""Regenerate the service worker's precache list from the real import graph.

Hand-maintaining that list does not work: adding a view and forgetting to list
it gives a file that is fetched ad-hoc — so it is missing offline, and it
updates on a different schedule from everything else. That is exactly what
happened to supplements.js.

Run from tools/deploy.sh before staging, so the list cannot drift from the code.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
APP = ROOT / "app"
ENTRIES = ["js/mobile.js", "js/app.js"]

# Not reachable by import, but needed to boot or to install.
STATIC = [
    "./", "./m.html", "./index.html", "./manifest.webmanifest",
    "./styles.css", "./mobile.css",
    "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
]


def graph():
    seen, queue = set(), list(ENTRIES)
    while queue:
        cur = queue.pop()
        if cur in seen:
            continue
        seen.add(cur)
        f = APP / cur
        if not f.exists():
            print(f"  !! imported but missing: {cur}", file=sys.stderr)
            continue
        for m in re.finditer(r"""from\s+['"]([^'"]+)['"]""", f.read_text(encoding="utf-8")):
            spec = m.group(1)
            if not spec.startswith("."):
                continue
            queue.append(str((f.parent / spec).resolve().relative_to(APP.resolve())))
    return sorted(seen)


def main():
    mods = graph()
    listed = STATIC + [f"./{m}" for m in mods]
    block = "const SHELL_ASSETS = [\n" + "".join(f"  '{u}',\n" for u in listed) + "];"

    sw = APP / "sw.js"
    src = sw.read_text(encoding="utf-8")
    new = re.sub(r"const SHELL_ASSETS = \[.*?\n\];", block, src, count=1, flags=re.S)
    if new == src and "const SHELL_ASSETS" in src:
        print(f"shell list already current ({len(listed)} assets)")
        return 0
    sw.write_text(new, encoding="utf-8")
    print(f"shell list regenerated: {len(listed)} assets ({len(mods)} modules)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
