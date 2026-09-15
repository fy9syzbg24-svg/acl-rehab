"""Merge PhysiApp results into the rehab document.

Pure: no network, no file I/O, no clock. server.py fetches, this decides,
server.py saves. Kept apart so every rule below is tested against fixtures
(tools/test_pa_import.py) without ever touching their site or the live file.

The rules, each one a bug that happened or was found in review:

- Every record this changes gets a sync stamp. The server writes the data
  file directly, outside the app's update() funnel, so without a stamp a fill
  or update to an existing row never reached the phone, and an older phone
  copy with the same stamp could win the tie and undo it.
- An import that changes nothing is "unchanged", not "updated", and is not
  stamped, so an idle re-check never pushes anything.
- Scaffolding is never filled. Opening a row creates unlogged rows; copying one
  unsplit PhysiApp figure onto a left and a right row invented two independent
  measurements. The import is its own side B row, and the app's completion
  rules read an unsplit result as done without implying left or right.
- A row he changed is his. The snapshot covers logged, load and notes as well
  as sets, reps and hold, so an untick or a typed note is never undone. Rows
  imported before the snapshot grew are judged on what they have.
- No positional guessing. A name that does not match exactly is reported for
  review instead of being filed under whatever sat at that position.
"""

from __future__ import annotations

import random

PA_FIELDS = ("reps", "sets", "hold")
# Everything an import writes, so any later difference is provably his.
SNAP_FIELDS = ("reps", "sets", "hold", "logged", "load", "loadUnit", "notes")


def _uid() -> str:
    return "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=10))


def _enc(s) -> str:
    return str(s).replace("|", "%7C")


def entry_key(iso: str, entry_id: str) -> str:
    return "e|%s|%s" % (_enc(iso), _enc(entry_id))


def day_key(iso: str) -> str:
    return "d|%s" % _enc(iso)


def stamp(doc: dict, key: str, now_ms: int) -> None:
    """Mark one record changed, the way stampChanges() does in the app."""
    s = doc.setdefault("_sync", {})
    s.setdefault("v", 1)
    rec = s.setdefault("rec", {})
    dels = s.setdefault("del", {})
    # Never reuse a stamp for a key (2026-09-15, audit A02): strictly after
    # its previous stamp or tombstone, whatever the clock says.
    rec[key] = max(now_ms, int(rec.get(key) or 0) + 1, int(dels.get(key) or 0) + 1)
    dels.pop(key, None)



def proposed(rec: dict) -> dict:
    """What PhysiApp says, as entry fields."""
    out = {"logged": True}
    for k in PA_FIELDS:
        if rec.get(k) is not None:
            out[k] = rec[k]
    if rec.get("weight"):
        out["load"] = rec["weight"]
        out["loadUnit"] = rec.get("weightUnit") or "lb"
    if rec.get("feedback"):
        out["notes"] = rec["feedback"]
    return out


def is_yours(entry: dict) -> bool:
    """True if he changed this imported row since it last came across."""
    snap = entry.get("paSnap")
    if not isinstance(snap, dict):
        return False
    for k in SNAP_FIELDS:
        if k in snap and entry.get(k) != snap[k]:
            return True
    # An older snapshot never recorded `logged`, but an import only ever
    # writes True, so False can only be his untick.
    if "logged" not in snap and entry.get("logged") is False:
        return True
    return False


def _empty(v) -> bool:
    return v is None or v == ""


def apply(entry: dict, prop: dict) -> tuple[bool, bool]:
    """Write a proposal onto an imported row.

    Returns (values_changed, touched). `touched` also covers a snapshot that
    only grew its newer fields, which must still be stamped so both devices
    hold the same record, but is not reported as an update.
    """
    snap = entry.get("paSnap") if isinstance(entry.get("paSnap"), dict) else {}
    changed = False
    for k, v in prop.items():
        # Fields an old snapshot never covered: he may have typed them, so an
        # import only fills them when they are empty.
        if k in ("load", "loadUnit", "notes") and snap and k not in snap and not _empty(entry.get(k)):
            continue
        if entry.get(k) != v:
            entry[k] = v
            changed = True
    touched = changed
    if entry.get("via") != "physiapp":
        entry["via"] = "physiapp"
        touched = True
    new_snap = {k: entry.get(k) for k in SNAP_FIELDS}
    if entry.get("paSnap") != new_snap:
        entry["paSnap"] = new_snap
        touched = True
    return changed, touched


def merge(data: dict, harvest: dict, items: dict, now_ms: int, uid=_uid) -> dict:
    """Fold one harvest ({iso: [records]}) into `data`, in place.

    `items` maps program id to its program item (needs "ex"). Returns counts
    and the lists the caller reports.
    """
    days = data.setdefault("days", {})
    added = updated = unchanged = kept = 0
    review: list = []
    per_day: dict = {}
    touched_any = False

    for iso in sorted(harvest):
        found = harvest[iso]
        day = days.get(iso)
        if day is not None:
            day.setdefault("entries", [])
        names = []
        for rec in found:
            pid = rec.get("pid")
            item = items.get(pid) if pid else None
            if not item:
                review.append({"date": iso, "name": rec.get("name"), "index": rec.get("index")})
                continue
            names.append(pid)
            mine = [e for e in day["entries"] if e.get("pid") == pid] if day else []
            theirs = [e for e in mine if e.get("via") == "physiapp"]
            manual = [e for e in mine if e.get("via") != "physiapp"]

            if any(e.get("logged") for e in manual):
                # Ticked off here by hand. His stands.
                kept += 1
                continue

            prop = proposed(rec)
            if theirs:
                for e in theirs:
                    if is_yours(e):
                        kept += 1
                        continue
                    changed, touched = apply(e, prop)
                    if changed:
                        updated += 1
                    else:
                        unchanged += 1
                    if touched:
                        stamp(data, entry_key(iso, e["id"]), now_ms)
                        touched_any = True
            else:
                if day is None:
                    # Only now: a harvest that is all "needs review" must not
                    # leave an empty day behind.
                    day = days.setdefault(iso, {"checkin": {}, "checklist": {}, "notes": "", "entries": []})
                    stamp(data, day_key(iso), now_ms)
                entry = {"id": uid(), "pid": pid, "ex": item["ex"], "side": "B"}
                apply(entry, prop)
                day["entries"].append(entry)
                stamp(data, entry_key(iso, entry["id"]), now_ms)
                added += 1
                touched_any = True
        if names:
            per_day[iso] = len(names)

    return {"added": added, "updated": updated, "unchanged": unchanged,
            "keptYours": kept, "review": review, "perDay": per_day,
            "touched": touched_any}
