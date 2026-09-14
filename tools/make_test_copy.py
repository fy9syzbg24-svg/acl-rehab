#!/usr/bin/env python3
"""Make (or refresh) the test copy the `acl-rehab-test` launch configuration serves.

    python3 tools/make_test_copy.py

Writes data/test-copy/rehab-data.json from the live data file, READ-ONLY on the
live file, with the PhysiApp sign-in removed and auto import off. The songs are
linked, not copied: data/test-copy/media points at data/media. data/ is
gitignored, so none of it can reach the public repo.

The test server runs on port 8767 with --no-physiapp. A different port is a
different browser origin, so it has no sync token either: nothing done against
the copy reaches the live log, the private repo or PhysiApp.

Refuses to overwrite a copy that already exists unless --fresh is given, so a
test in progress is not reset from under itself.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIVE = ROOT / "data" / "rehab-data.json"
COPY_DIR = ROOT / "data" / "test-copy"
COPY = COPY_DIR / "rehab-data.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="replace an existing test copy")
    args = ap.parse_args()
    if COPY.exists() and not args.fresh:
        print(f"test copy already exists: {COPY} (use --fresh to replace it)")
        return 0
    doc = json.loads(LIVE.read_text(encoding="utf-8"))
    settings = doc.setdefault("settings", {})
    settings.pop("physiapp", None)
    settings["physiappAuto"] = False
    COPY_DIR.mkdir(parents=True, exist_ok=True)
    COPY.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
    media = COPY_DIR / "media"
    if not media.exists() and (ROOT / "data" / "media").is_dir():
        media.symlink_to(ROOT / "data" / "media")
    print(f"wrote {COPY} (PhysiApp removed, auto import off); media linked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
