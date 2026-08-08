"""Read your real adherence out of PhysiApp (au.physiapp.com).

Physitrack gives patients no export and no API, so this signs in the way the
website does and reads the pages it serves. Everything here is READ-ONLY: it
never posts feedback, never marks an exercise done, never changes anything on
their side.

The one rule that matters
-------------------------
An exercise you have *not* logged still renders a fully populated form —
prefilled with the clinician's prescription. Reading those numbers would invent a
session you never did. A real log is identifiable two ways, and this module
requires both:

    <form class="simple_form feedback-form recorded" id="edit_exercise_action_559940440">
                                        ^^^^^^^^                ^^^^^^^^^^^^^^^^^^^^^^^^
                                        class present           id present

Anything without them is treated as not done, no matter what the selects say.

Shape of the site (verified 7 Aug 2026)
---------------------------------------
  /login                                     access code + birth year, CSRF token
  /program/YYYY-MM-DD                        that day's tiles; completed ones carry class "done"
  /protocols/{p}/protocol_days/{d}/exercises/{i}
                                             full name in <title>, real numbers in
                                             #exercise-feedback-modal
"""

from __future__ import annotations

import gzip
import http.cookiejar
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timedelta
from html import unescape

BASE = "https://au.physiapp.com"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
TIMEOUT = 20
POLITE_DELAY = 0.12  # seconds between exercise-detail fetches

# PhysiApp's own wording -> our program ids. Exact match on the lowercased
# name; pa01's name is a prefix of pa02's, so prefix matching is not safe.
NAME_TO_PID = {
    "bridge with resisted hip abduction": "pa01",
    "bridge with resisted hip abduction to single leg extension": "pa02",
    "bridge single leg with resisted hip abduction": "pa03",
    "butterfly gluteal - bridge": "pa04",
    "sit to stand with resisted hip external rotation on foam": "pa05",
    "resisted knee extension seated": "pa06",
    "knee extension + pulses with thera band": "pa07",
    "knee extension into band": "pa08",
    "single leg calf rises, with band on inside of ankle": "pa09",
    "calf pulses 120 bpm": "pa10",
    "single leg balance + ball throw/catch/juggling/dynamic skill": "pa11",
    "sl star excursion (8 points)": "pa12",
    "step up": "pa13",
    "sideways step up": "pa14",
    "progression: jump prep off step": "pa15",
    "wall squats with hip adduction (vmo)": "pa16",
}

# Fallback only, if the clinician renames an exercise. Their tile order is not our
# numbering — index 12 is the jump-prep progression, which we call pa15.
INDEX_TO_PID = {
    0: "pa01", 1: "pa02", 2: "pa03", 3: "pa04", 4: "pa05", 5: "pa06",
    6: "pa07", 7: "pa08", 8: "pa09", 9: "pa10", 10: "pa11", 11: "pa12",
    12: "pa15", 13: "pa13", 14: "pa14", 15: "pa16",
}


class PhysiAppError(Exception):
    """Anything that stops a sync.

    `kind` separates the transient from the permanent. An auto-sync that fires
    on every app open must not nag about a dropped Wi-Fi connection, but it
    must speak up if the credentials stopped working — otherwise syncing dies
    quietly and the log silently goes stale.

      network  — offline, timeout, their server erroring. Transient; stay quiet.
      auth     — code or birth year rejected, or signed out. Needs attention.
      config   — nothing entered yet.
      markup   — their HTML changed and the parser needs updating.
    """

    def __init__(self, message: str, kind: str = "network") -> None:
        super().__init__(message)
        self.kind = kind


def _text(raw: bytes, headers) -> str:
    enc = (headers.get("Content-Encoding") or "").lower()
    if enc == "gzip":
        raw = gzip.decompress(raw)
    elif enc == "deflate":
        raw = zlib.decompress(raw, -zlib.MAX_WBITS)
    return raw.decode("utf-8", "replace")


class Session:
    """One signed-in browsing session. Their cookie lasts 14 days."""

    def __init__(self, access_code: str, birth_year) -> None:
        self.access_code = (access_code or "").strip()
        self.birth_year = str(birth_year or "").strip()
        if not self.access_code or not self.birth_year:
            raise PhysiAppError("Add your PhysiApp program code and year of birth in Settings first.", "config")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar),
            urllib.request.HTTPRedirectHandler(),
        )
        self.opener.addheaders = [
            ("User-Agent", UA),
            ("Accept", "text/html,application/xhtml+xml"),
            ("Accept-Language", "en-AU,en;q=0.9"),
            ("Accept-Encoding", "gzip, deflate"),
        ]
        self._signed_in = False

    # -- plumbing ------------------------------------------------------
    def _open(self, url: str, data: bytes | None = None) -> tuple[str, str]:
        try:
            with self.opener.open(url, data, timeout=TIMEOUT) as r:
                return _text(r.read(), r.headers), r.geturl()
        except urllib.error.HTTPError as exc:
            raise PhysiAppError("PhysiApp returned %s for %s" % (exc.code, url), "network") from exc
        except urllib.error.URLError as exc:
            raise PhysiAppError("Could not reach PhysiApp (%s). Are you online?" % exc.reason, "network") from exc

    def get(self, path: str) -> str:
        if not self._signed_in:
            self.login()
        body, url = self._open(BASE + path)
        if "/login" in url or "/sign_in" in url:
            raise PhysiAppError("PhysiApp signed us out mid-sync.", "auth")
        return body

    # -- auth ----------------------------------------------------------
    def login(self) -> None:
        page, _ = self._open(BASE + "/login")
        m = re.search(r'name="authenticity_token"\s+value="([^"]+)"', page)
        if not m:
            raise PhysiAppError("PhysiApp's sign-in page has changed — no CSRF token found.", "markup")
        form = urllib.parse.urlencode({
            "utf8": "✓",
            "authenticity_token": m.group(1),
            "patient[access_code]": self.access_code,
            "patient[birth_year]": self.birth_year,
        }).encode("utf-8")
        body, url = self._open(BASE + "/sign_in", form)
        if "/program" not in url:
            raise PhysiAppError("PhysiApp rejected that program code and year of birth.", "auth")
        self._signed_in = True


# ---------------------------------------------------------------------
# parsing
# ---------------------------------------------------------------------

TILE_RE = re.compile(
    r'<a\s+class="[^"]*program-exercise-video(?P<done>[^"]*)"'
    r'[^>]*href="/protocols/(?P<protocol>\d+)/protocol_days/(?P<day>\d+)/exercises/(?P<idx>\d+)"',
    re.S,
)


def parse_day(page: str) -> dict:
    """Tiles for one day. `done` is their own completion marker."""
    tiles = []
    protocol = day_id = None
    for m in TILE_RE.finditer(page):
        protocol, day_id = m.group("protocol"), m.group("day")
        tiles.append({
            "index": int(m.group("idx")),
            "done": "done" in m.group("done"),
        })
    return {"protocol": protocol, "dayId": day_id, "tiles": tiles}


def _selected(page: str, field: str):
    """The chosen <option> of exercise_action[field], or None."""
    block = re.search(
        r'name="exercise_action\[%s\]".*?</select>' % re.escape(field), page, re.S)
    if not block:
        return None
    opt = re.search(r'<option selected="selected" value="([^"]*)"', block.group(0))
    return opt.group(1) if opt else None


def parse_exercise(page: str) -> dict:
    """Real numbers for one exercise on one day.

    Returns recorded=False unless BOTH the `recorded` class and the
    edit_exercise_action_* id are present — see the module docstring.
    """
    name = None
    t = re.search(r"<title>(.*?)</title>", page, re.S)
    if t:
        name = unescape(t.group(1)).split("|")[-1].strip()

    form = re.search(r'<form[^>]*class="[^"]*feedback-form[^"]*"[^>]*>', page)
    attrs = form.group(0) if form else ""
    recorded = ("recorded" in attrs) and bool(re.search(r'id="edit_exercise_action_\d+"', attrs))

    out = {"name": name, "recorded": recorded}
    if not recorded:
        return out

    for field in ("reps", "sets", "hold"):
        raw = _selected(page, field)
        if raw not in (None, ""):
            try:
                out[field] = int(raw)
            except ValueError:
                out[field] = raw
    w = re.search(r'name="exercise_action\[weight\]"[^>]*value="([^"]*)"', page)
    if w and w.group(1).strip():
        out["weight"] = w.group(1).strip()
        u = re.search(r'name="exercise_action\[weight_unit\]"[^>]*value="([^"]*)"', page)
        out["weightUnit"] = u.group(1) if u else None
    fb = re.search(
        r'name="exercise_action\[feedback\]"[^>]*>(.*?)</textarea>', page, re.S)
    if fb and fb.group(1).strip():
        out["feedback"] = unescape(fb.group(1)).strip()
    return out


def pid_for(name: str | None, index: int) -> str | None:
    if name:
        hit = NAME_TO_PID.get(name.strip().lower())
        if hit:
            return hit
    return INDEX_TO_PID.get(index)


# ---------------------------------------------------------------------
# fetching
# ---------------------------------------------------------------------

def fetch_day(session: Session, date: str) -> dict:
    """Everything actually logged on one date. One request for the day, plus
    one per completed tile — an untouched day costs a single request.

    Returns {"records": [...], "hasProgram": bool}. A date with no tiles is
    normal, not an error: it is any day before the program started, or one
    their calendar has no program day for. Treating it as a failure aborted
    whole multi-day syncs. The caller decides, after seeing the entire range,
    whether *nothing anywhere* means their markup changed.
    """
    day = parse_day(session.get("/program/" + date))
    if not day["tiles"]:
        return {"records": [], "hasProgram": False}
    done = [t for t in day["tiles"] if t["done"]]
    results = []
    for n, tile in enumerate(done):
        # A 30-day sync is several hundred requests. Pacing them keeps this
        # closer to a person browsing their own program than to a scraper.
        if n:
            time.sleep(POLITE_DELAY)
        page = session.get("/protocols/%s/protocol_days/%s/exercises/%d"
                           % (day["protocol"], day["dayId"], tile["index"]))
        info = parse_exercise(page)
        if not info["recorded"]:
            # Marked done on the tile but no exercise_action behind it. Trust
            # the form, not the tile — this is the invented-data guard.
            continue
        info["index"] = tile["index"]
        info["pid"] = pid_for(info.get("name"), tile["index"])
        results.append(info)
    return {"records": results, "hasProgram": True}


def date_range(days: int, end: str | None = None) -> list:
    last = datetime.strptime(end, "%Y-%m-%d") if end else datetime.now()
    return [(last - timedelta(days=n)).strftime("%Y-%m-%d") for n in range(days - 1, -1, -1)]
