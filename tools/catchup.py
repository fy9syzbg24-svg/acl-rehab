#!/usr/bin/env python3
"""ACL REHAB TRACKER: LIVE STATE BRIEFING (read-only; run by the /rehab skill).

Never writes. Prints service health, the sync-registration invariant (the trap that wipes
data), repo/deploy state, and the standing rules. Pattern from STC Hebrew's catchup.py.
"""
import os, json, subprocess, datetime

ROOT = "/Users/reuben/Workspace/acl-rehab"
RED, YEL, GRN, OFF = "\033[31m", "\033[33m", "\033[32m", "\033[0m"


def run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ""


print("=" * 72)
print("ACL REHAB TRACKER: LIVE STATE BRIEFING     today:", datetime.date.today())
print("=" * 72)
print("""
⛔ THE NEVER LINES
  1. RULE ZERO: data/rehab-data.json and the private state.json are HIS REHAB
     RECORD: never clear/reset/truncate; assume he is using the app right now;
     unexplained data is his. Test against a separate store, never live files.
  2. ⛔ THE SYNC WIPE TRAP: any NEW top-level key in the document MUST be
     registered in app/js/sync/records.js, or it is invisible to sync and a
     device that lacks it WIPES it. (Checked live below.)
  3. Personal/clinical content lives in SYNCED DATA, never in source. THIS repo
     is the PUBLIC shell (fy9syzbg24-svg/acl-rehab) -- nothing personal may ever
     be committed here, INCLUDING in this script. The PhysiApp access code is a
     credential. case.local.js is gitignored.
  4. DEVICE ROLES (his call, 2026-09-12): iPad and Mac get the full app; the
     iPhone is optimised for LOGGING (Today and Supplements lead). Still never
     a parallel phone codebase: the mobile shell renders the real view modules.
     His in-app arrangement is the default; never overwrite it with code defaults.
  5. The server is a launchd service, never start it by hand, never background
     it; kickstart after code changes. Photos/attachments are originals.
""")

print("── Service " + "─" * 61)
lc = run("launchctl list | grep com.reuben.acl-rehab")
print("  launchd: %s" % (lc if lc else RED + "NOT LOADED" + OFF))
code = run("curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:8757/")
print("  http 8757: %s%s%s" % (GRN if code == "200" else RED, code or "no reply", OFF),
      "" if code == "200" else " <- 000 = something squatting the port; see CLAUDE.md")

print("\n── The sync-registration invariant (the wipe trap, checked live) " + "─" * 7)
try:
    import re as _re
    data = json.load(open(os.path.join(ROOT, "data/rehab-data.json")))
    top = set(data.keys())
    rec = open(os.path.join(ROOT, "app/js/sync/records.js")).read()
    # Registration semantics (verified 2026-08-21): a key is carried if records.js
    # mentions it anywhere -- as an ID_LISTS/KEY_MAPS value ('measurements', 'caseFile'),
    # or structurally in code (doc.days -> the d|/e| grammar; melbourne/program -> b|/p|).
    # APP-OWNED keys are exempt: 'schema' is re-stamped by store.js on every load
    # (store.js:200) and '_sync' is the sidecar the engine itself maintains -- neither
    # travels as a record, and their absence on a fresh device is repaired locally.
    APP_OWNED = {"schema", "_sync"}
    missing = sorted(k for k in top - APP_OWNED
                     if not _re.search(r"\b%s\b" % _re.escape(k), rec))
    if missing:
        print("  %s⚠ UNREGISTERED TOP-LEVEL KEYS (a fresh device will wipe them on sync): %s%s"
              % (RED, ", ".join(missing), OFF))
        print("    -> register in app/js/sync/records.js BEFORE anything else (his rule)")
    else:
        print("  %s✓%s all %d top-level document keys carried (%d registered, %d app-owned)"
              % (GRN, OFF, len(top), len(top) - len(APP_OWNED & top), len(APP_OWNED & top)))
except Exception as e:
    print("  %s⚠ could not check: %s%s" % (YEL, e, OFF))

print("\n── Data & deploy " + "─" * 55)
d = os.path.join(ROOT, "data/rehab-data.json")
if os.path.exists(d):
    st = os.stat(d)
    print("  data/rehab-data.json: %.0f KB, modified %s" % (st.st_size / 1024,
          datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")))
dirty = run("cd %r && git status --porcelain | head -5" % ROOT)
print("  git: %s" % ("clean" if not dirty else YEL + "UNCOMMITTED:\n    " + dirty.replace("\n", "\n    ") + OFF))
gp = run("cd %r && git log origin/gh-pages -1 --format='%%ad %%s' --date=short 2>/dev/null || git log gh-pages -1 --format='%%ad %%s' --date=short 2>/dev/null" % ROOT)
print("  last PWA deploy (origin/gh-pages): %s" % (gp or "unknown"))
print("  deploy command: bash tools/deploy.sh   (NO Actions workflow -- token lacks scope)")
print("  phone install: https://fy9syzbg24-svg.github.io/acl-rehab/")

print("\n── Read-first documents " + "─" * 48)
for p in ("README.md", "app/js/sync/records.js"):
    full = os.path.join(ROOT, p)
    ok = os.path.exists(full)
    print("  %s %s" % (GRN + "✓" + OFF if ok else RED + "✗" + OFF, p))
print("  memory: reference-web-app-playbook (PWA traps) · project-acl-rehab (medical context)")
print("\n── Facts " + "─" * 63)
# ⛔ NO PERSONAL/CLINICAL DATA IN THIS FILE. This folder is the PUBLIC shell repo
# (fy9syzbg24-svg/acl-rehab) and this script is not gitignored -- surgery dates, names
# and clinical details live in MEMORY (project-acl-rehab) and in the SYNCED DATA only.
print("  Medical context, dates and the clinician program: memory `project-acl-rehab`")
print("  (never in this repo -- it is the PUBLIC shell). PhysiApp sync is MAC-ONLY (CORS).")
print("  Ring design (2026-09-14): tokens in styles.css, trend.js, sessions.js, milestones.js; program.seen is synced. See README, Ring design.")
print("  Revision 3 (2026-09-14 late, aa962b2): turquoise actions, green = done/synced, playback audio + mix switch, paintkeep.js. README, Revision 3; REVISION-3-2026-09-14.local.md.")
print("  Tests: tools/make_test_copy.py, then /dev-tests.html on the TEST server, port 8767 (all of dev-*.js incl. dev-rev3.js; no Node), and tools/test_pa_import.py (41).")
print("  Player handover: PLAYER-2026-09-14.local.md. Reps are his pace; completion is itemStatus in logging.js.")
print("=" * 72)
