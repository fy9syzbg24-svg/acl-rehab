#!/usr/bin/env python3
"""Find physio appointments in the Google Calendar and report them as clinic days.

    python3 tools/clinic_days.py              # report only, changes nothing
    python3 tools/clinic_days.py --write      # write them into data/rehab-data.json

A clinic day is a day with a physio appointment on it. The app narrows that day
to the tendon loading and balance work, because the session itself is the big
workout and doubling it is how you end up too sore to train the next day.

WHY IT READS THE FRINGE PLANNER'S CONFIG
----------------------------------------
The secret iCal address for the primary calendar is already configured at
fringe-planner/config/calendars.json, added interactively by that project's
tools/add_calendar.py so the URL never passed through a transcript. It is a
credential: anyone holding it can read the whole calendar. So this script reads
that one file rather than keeping a second copy of the same secret, and it never
prints the URL. To point it somewhere else, create acl-rehab/config/calendars.json
in the same shape; that wins if it exists.

THE PHONE CANNOT DO THIS. Google sends no CORS header on the iCal feed, so no
browser can fetch it, and the URL must never reach a device anyway. The Mac reads
the calendar and writes clinic days into the document; sync carries them to the
phone like any other record. Same split as the fringe planner, for the same reason.

Read-only against the calendar. Never writes to Google.
"""

import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data", "rehab-data.json")

CONFIGS = [
    os.path.join(ROOT, "config", "calendars.json"),
    os.path.join(os.path.dirname(ROOT), "fringe-planner", "config", "calendars.json"),
]

# What counts as a physio appointment. Matched case-insensitively against the
# event title. Deliberately narrow: a therapy appointment with a psychologist and
# a nutrition visit are NOT clinic days, and both are on his calendar.
PHYSIO = re.compile(
    r"\bphysio|\bphysical therapy\b|\bPT\b|\bPT Treatment\b|sports clinic|performance medicine",
    re.I,
)
# Beats PHYSIO when it also matches: these are appointments, not workouts.
NOT_A_WORKOUT = re.compile(
    r"telehealth|online booking|nutrition|psych|^\s*call\b|\bcall to schedule\b", re.I
)


def primary_ical_url():
    """The secret iCal address of the primary calendar. Never printed."""
    for path in CONFIGS:
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        cals = cfg.get("calendars", cfg) if isinstance(cfg, dict) else cfg
        rows = cals.values() if isinstance(cals, dict) else cals
        for c in rows:
            if isinstance(c, dict) and c.get("name") == "primary" and c.get("url"):
                return c["url"], path
    raise SystemExit(
        "No primary calendar configured. Expected one of:\n  "
        + "\n  ".join(CONFIGS)
        + "\nAdd one with fringe-planner/tools/add_calendar.py (it prompts, so the\n"
        "secret URL stays out of the shell history and out of any transcript)."
    )


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "acl-rehab"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def unfold(text):
    """iCal folds long lines with a leading space. Put them back together."""
    out = []
    for line in text.splitlines():
        if line[:1] in (" ", "\t") and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def events(ics):
    """Yield (date, summary) for every dated event. Date is the local day."""
    cur = None
    for line in unfold(ics):
        if line.startswith("BEGIN:VEVENT"):
            cur = {}
        elif line.startswith("END:VEVENT"):
            if cur and cur.get("date") and cur.get("summary"):
                yield cur["date"], cur["summary"]
            cur = None
        elif cur is None:
            continue
        elif line.startswith("SUMMARY"):
            # iCal escapes commas, semicolons and newlines in text values.
            raw = line.split(":", 1)[-1].strip()
            cur["summary"] = (raw.replace("\\n", " ").replace("\\,", ",")
                              .replace("\\;", ";").replace("\\\\", "\\"))
        elif line.startswith("DTSTART"):
            raw = line.split(":", 1)[-1].strip()
            m = re.match(r"(\d{4})(\d{2})(\d{2})", raw)
            if m:
                cur["date"] = "-".join(m.groups())


def clinic_days(ics, since, until):
    found = {}
    for date, summary in events(ics):
        if not (since <= date <= until):
            continue
        if NOT_A_WORKOUT.search(summary) or not PHYSIO.search(summary):
            continue
        found.setdefault(date, []).append(summary)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write into data/rehab-data.json")
    ap.add_argument("--include-past", action="store_true",
                    help="also write clinic days that have already happened")
    ap.add_argument("--months-back", type=int, default=2)
    ap.add_argument("--months-ahead", type=int, default=4)
    args = ap.parse_args()

    today = dt.date.today()
    since = (today - dt.timedelta(days=31 * args.months_back)).isoformat()
    until = (today + dt.timedelta(days=31 * args.months_ahead)).isoformat()

    url, src = primary_ical_url()
    print(f"calendar: primary (from {os.path.relpath(src, os.path.dirname(ROOT))})")
    found = clinic_days(fetch(url), since, until)

    if not found:
        print(f"no physio appointments between {since} and {until}")
        return

    print(f"\n{len(found)} clinic days between {since} and {until}:")
    for date in sorted(found):
        day = dt.date.fromisoformat(date).strftime("%a")
        mark = "  " if date >= today.isoformat() else "· "
        print(f"  {mark}{date} {day}  {'; '.join(found[date])[:64]}")

    if not args.write:
        print("\nreport only. Re-run with --write to put these in the app.")
        return

    with open(DATA, encoding="utf-8") as f:
        doc = json.load(f)

    # Snapshot before touching his record. Rule zero.
    backups = os.path.join(ROOT, "data", "backups")
    os.makedirs(backups, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(DATA, os.path.join(backups, f"rehab-data-PRE-clinicdays-{stamp}.json"))

    prog = doc.setdefault("program", {})
    cur = prog.setdefault("clinicDays", {})
    # Past days are skipped unless asked for: marking one retroactively narrows
    # what that day was meant to be, and his logged history should not move.
    write = {d for d in found if args.include_past or d >= today.isoformat()}
    added = [d for d in write if not cur.get(d)]
    for d in write:
        cur[d] = True

    # STAMP EACH RECORD, or the write is invisible to sync and a device that
    # lacks the key can wipe it. Same record key the app uses: collectRecords()
    # emits a program sub-map as `p|<sub>|<key>`, and a re-created record must
    # clear any tombstone. This mirrors stampChanges() in app/js/sync/merge.js.
    sync = doc.setdefault("_sync", {"v": 1, "rec": {}, "del": {}})
    rec, dele = sync.setdefault("rec", {}), sync.setdefault("del", {})
    now = int(dt.datetime.now().timestamp() * 1000)
    for d in added:
        key = f"p|clinicDays|{d}"
        rec[key] = now
        dele.pop(key, None)

    # Never remove one he marked himself: this only ever adds.
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    print(f"\nwrote {len(added)} new clinic days ({len(cur)} total). Nothing was removed.")
    if added:
        print("  " + ", ".join(sorted(added)))
    print("Reload the app on the Mac, then sync, so the phone gets them.")


if __name__ == "__main__":
    main()
