#!/usr/bin/env python3
"""PhysiApp import rules, against fixtures. No network, no data file.

    python3 tools/test_pa_import.py
"""
import copy
import itertools
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pa_import  # noqa: E402
import physiapp  # noqa: E402

fails = []
count = 0


def check(label, got, want):
    global count
    count += 1
    ok = got == want
    print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else f"  got={got!r} want={want!r}"))
    if not ok:
        fails.append(label)


ITEMS = {
    "pa01": {"id": "pa01", "ex": "dl_bridge_band", "sides": "both"},
    "pa03": {"id": "pa03", "ex": "sl_bridge_band_abd", "sides": "each"},
    "pa10": {"id": "pa10", "ex": "calf_pulses", "sides": "both"},
}
T0, T1 = 1_000, 2_000


def ids():
    c = itertools.count(1)
    return lambda: "id%d" % next(c)


def doc():
    return {"days": {}, "settings": {}, "_sync": {"v": 1, "rec": {}, "del": {}}}


def rec(pid="pa01", **kw):
    r = {"pid": pid, "name": "x", "index": 0, "recorded": True, "sets": 2, "reps": 12}
    r.update(kw)
    return r


print("a first import adds one side B row and stamps it")
d = doc()
out = pa_import.merge(d, {"2026-08-07": [rec()]}, ITEMS, T0, ids())
e = d["days"]["2026-08-07"]["entries"][0]
check("added", out["added"], 1)
check("side B", e["side"], "B")
check("logged", e["logged"], True)
check("entry stamped", d["_sync"]["rec"].get("e|2026-08-07|id1"), T0)
check("new day stamped", d["_sync"]["rec"].get("d|2026-08-07"), T0)
check("snapshot covers logged", e["paSnap"]["logged"], True)

print("the same result again is unchanged and not re-stamped")
out = pa_import.merge(d, {"2026-08-07": [rec()]}, ITEMS, T1, ids())
check("unchanged", out["unchanged"], 1)
check("not an update", out["updated"], 0)
check("stamp untouched", d["_sync"]["rec"]["e|2026-08-07|id1"], T0)
check("nothing touched", out["touched"], False)

print("a changed result is an update and is stamped")
out = pa_import.merge(d, {"2026-08-07": [rec(reps=10)]}, ITEMS, T1, ids())
check("updated", out["updated"], 1)
check("reps", d["days"]["2026-08-07"]["entries"][0]["reps"], 10)
check("re-stamped", d["_sync"]["rec"]["e|2026-08-07|id1"], T1)

print("his untick stands")
d2 = copy.deepcopy(d)
d2["days"]["2026-08-07"]["entries"][0]["logged"] = False
out = pa_import.merge(d2, {"2026-08-07": [rec(reps=10)]}, ITEMS, T1 + 1, ids())
check("kept", out["keptYours"], 1)
check("still unticked", d2["days"]["2026-08-07"]["entries"][0]["logged"], False)

print("his note stands, and so does the load he typed")
d3 = copy.deepcopy(d)
d3["days"]["2026-08-07"]["entries"][0]["notes"] = "felt tight"
out = pa_import.merge(d3, {"2026-08-07": [rec(reps=10, feedback="their note", weight="5")]}, ITEMS, T1 + 1, ids())
check("kept", out["keptYours"], 1)
check("note kept", d3["days"]["2026-08-07"]["entries"][0]["notes"], "felt tight")
check("load not written", d3["days"]["2026-08-07"]["entries"][0].get("load"), None)

print("rows imported before the snapshot grew")
old = {"id": "old1", "pid": "pa01", "ex": "dl_bridge_band", "side": "B", "logged": True,
       "via": "physiapp", "sets": 2, "reps": 12, "hold": None,
       "paSnap": {"sets": 2, "reps": 12, "hold": None}}
d4 = doc()
d4["days"]["2026-08-05"] = {"entries": [dict(old, logged=False)]}
out = pa_import.merge(d4, {"2026-08-05": [rec()]}, ITEMS, T1, ids())
check("old snapshot: untick is his", out["keptYours"], 1)
check("old snapshot: still unticked", d4["days"]["2026-08-05"]["entries"][0]["logged"], False)

d5 = doc()
d5["days"]["2026-08-05"] = {"entries": [dict(old, notes="mine")]}
out = pa_import.merge(d5, {"2026-08-05": [rec(feedback="theirs", reps=11)]}, ITEMS, T1, ids())
row = d5["days"]["2026-08-05"]["entries"][0]
check("old snapshot: reps still update", row["reps"], 11)
check("old snapshot: typed note not overwritten", row["notes"], "mine")
check("old snapshot: counted as update", out["updated"], 1)

d6 = doc()
d6["days"]["2026-08-05"] = {"entries": [dict(old)]}
out = pa_import.merge(d6, {"2026-08-05": [rec()]}, ITEMS, T1, ids())
check("old snapshot upgraded is not an update", out["updated"], 0)
check("old snapshot upgraded is unchanged", out["unchanged"], 1)
check("old snapshot upgrade is stamped so devices agree", d6["_sync"]["rec"].get("e|2026-08-05|old1"), T1)

print("a row ticked by hand wins")
d7 = doc()
d7["days"]["2026-08-07"] = {"entries": [{"id": "m1", "pid": "pa01", "ex": "dl_bridge_band", "side": "B", "logged": True}]}
out = pa_import.merge(d7, {"2026-08-07": [rec()]}, ITEMS, T1, ids())
check("kept", out["keptYours"], 1)
check("no second row", len(d7["days"]["2026-08-07"]["entries"]), 1)

print("scaffolding is never filled")
d8 = doc()
d8["days"]["2026-08-07"] = {"entries": [
    {"id": "sL", "pid": "pa03", "ex": "sl_bridge_band_abd", "side": "L", "logged": False, "sets": 3, "reps": 6},
    {"id": "sR", "pid": "pa03", "ex": "sl_bridge_band_abd", "side": "R", "logged": False, "sets": 3, "reps": 6},
]}
out = pa_import.merge(d8, {"2026-08-07": [rec("pa03", sets=3, reps=6, hold=1)]}, ITEMS, T1, ids())
rows = d8["days"]["2026-08-07"]["entries"]
check("added a B row", out["added"], 1)
check("three rows", len(rows), 3)
check("left scaffold untouched", (rows[0]["logged"], rows[0].get("via")), (False, None))
check("right scaffold untouched", (rows[1]["logged"], rows[1].get("via")), (False, None))
check("scaffolds not stamped", "e|2026-08-07|sL" in d8["_sync"]["rec"], False)
check("import is side B", rows[2]["side"], "B")

print("hold arrives as hold")
d9 = doc()
pa_import.merge(d9, {"2026-08-07": [rec("pa10", sets=4, reps=1, hold=30)]}, ITEMS, T0, ids())
check("hold 30", d9["days"]["2026-08-07"]["entries"][0]["hold"], 30)

print("no guessing: unknown names go to review")
d10 = doc()
out = pa_import.merge(d10, {"2026-08-07": [rec(pid=None, name="Renamed exercise", index=3)]}, ITEMS, T0, ids())
check("review", out["review"], [{"date": "2026-08-07", "name": "Renamed exercise", "index": 3}])
check("no day created", "2026-08-07" in d10["days"], False)
check("no stamps", d10["_sync"]["rec"], {})
check("exact names still match", physiapp.pid_for("Calf Pulses 120 BPM", 9), "pa10")
check("a renamed exercise is not matched by position", physiapp.pid_for("Something new", 0), None)

print("a tombstone for a re-created record is cleared")
d11 = doc()
d11["_sync"]["del"]["d|2026-08-09"] = 500
pa_import.merge(d11, {"2026-08-09": [rec()]}, ITEMS, T0, ids())
check("tombstone gone", "d|2026-08-09" in d11["_sync"]["del"], False)

print()
print(f"{count - len(fails)} of {count} pass" if not fails else f"FAILURES: {', '.join(fails)}")
sys.exit(1 if fails else 0)
