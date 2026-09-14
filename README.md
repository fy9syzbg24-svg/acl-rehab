# Rehab tracker

A small local-first web app for tracking a goal-based rehabilitation
programme: daily exercise logging, clinician-prescribed programmes, tests and
measurements, and progress against a multi-month plan.

Runs as a local web app on a Mac, and as an installable PWA on a phone. The two
share data through a private repository when either has a connection, and both
stay fully usable offline.

## Running it locally

```bash
python3 server.py
```

Then open <http://localhost:8757>. Pure Python standard library, no
dependencies, no build step.

But normally you don't start it at all: **the server runs as a login service**
(`com.reuben.acl-rehab`; see the top of the workspace `CLAUDE.md`). It starts
at login and restarts itself if it dies. After changing `server.py`, restart it:

```bash
launchctl kickstart -k gui/501/com.reuben.acl-rehab
```

`start.command` is still there for a manual run; it reclaims the port first
and checks the app really answers before handing you the window.

## "The server unexpectedly dropped the connection"

The symptom: the dock app shows *ACL Tracker Can't Open the Page … the server
unexpectedly dropped the connection*, `curl` gets an empty reply, yet
`lsof -nP -iTCP:8757 -sTCP:LISTEN` shows a Python process still holding the
port. Relaunching seems to do nothing.

The cause is **not** the code. It hit all four workspace apps twice, most
recently 2026-08-12. The project used to live under `~/Desktop`, which macOS
protects (TCC). A process inherits its Desktop grant from the app that
launched it; if a server is left running in the background and that parent
goes away, the grant lapses. The process keeps the port bound but every
request dies with `PermissionError: [Errno 1] Operation not permitted` on
`app/index.html`, and a new server can't bind the port the zombie owns.

**The workspace has since moved to `/Users/reuben/Workspace`, outside the
protected folders, so this should not recur.** Do not move it back under
`~/Desktop`, `~/Documents` or `~/Downloads`.

Two guards also make it self-correcting, so don't re-diagnose it:

- `server.py` probes `app/index.html` at startup and refuses to start if it
  can't read it, and `Server.handle_error` treats a `PermissionError` that it
  can confirm (by re-probing) as fatal; it exits so the port is released
  rather than squatted.
- `start.command` reclaims the port from a previous copy of *this* server
  before starting (it refuses to touch a process that isn't one), then polls
  until the app returns HTTP 200 and prints the permission hint if it doesn't.

**Never hand-background one of these servers** with `&` or `nohup` "so it keeps
running". That is what created the orphan both times. Let launchd own it, or
run it in the foreground via `start.command` and let the window own it.

## Layout

```
server.py           local HTTP server + JSON persistence
app/                the front end (plain ES modules, no framework)
  js/sync/          record-level merge engine used by both devices
  data/             exercise, plan and measurement definitions
tools/              tests
```

## Data

All personal data (logged sessions, measurements, clinical history) lives
outside this repository: on the local machine, and in a private repository used
purely as a sync relay. Nothing identifying is published here.

### Photos and videos are originals

If media is ever attached here (progress photos, scan images, clinic paperwork,
exercise clips), the file is stored **byte for byte as supplied**. Never compress,
re-encode, resize, rotate, crop, convert or strip EXIF from an original, and never
delete one. Thumbnails and web-sized previews are additional files written
alongside, never replacements. See Rule zero in the workspace `CLAUDE.md`.

Note this collides with the sync design: `state.json` is a JSON document relayed
through a repository, so binary media must NOT be inlined as base64 into it.
Media needs its own content-addressed store (file per blob, hash as the name) with
only the hash and metadata in the document. Decide that before adding the first
attachment, not after.

## How often, per exercise

Each program item carries `freq`, days per week. That number drives two things
that used to disagree: which days the item appears on, and the weekly target on
its row. Before this, the target was inherited from the exercise's CATEGORY, so
a banded calf raise and a loaded step up both read "3 a week" because both are
tagged strength. That made the everyday work look optional.

| freq | what |
|---|---|
| 7 | balance, calf-pulse endurance, wall-sit isometric, tendon loading, elliptical |
| 6 | low-load banded knee extension |
| 5 | bridges, sit-to-stand, banded mini squat, single-leg loaded calf |
| 3 | loaded step work (Mon/Wed/Fri) |
| 0 | not started, or needs a gym he does not have |

⚠️ **The advice depends on which phase you read for.** "Calf raises and quad work
every day" comes from EARLY phase protocols, 0 to 8 weeks. He is 18 and 29 weeks
post-op, and a phase 3 program (4 to 6 months) instead puts calf and quad work
inside three strength sessions a week. He sits between the two: chronologically
phase 3, but his own plan has him consolidating phase 2. So low-load work stays
frequent and anything carrying real load is pulled back. It is a judgement call
between two defensible protocols and his physio should settle it, not this file.

**The weekly target is the days actually planned that week, not the raw `freq`.**
A clinic day drops everything but the tendon loading and balance, so a flat 7
would be unreachable in a week with two clinic days, and an unreachable target
reads as failure. The row says so: "3 a week normally; your clinic sessions
cover the rest".

The elliptical is `freq: 7`, and a clinic day takes it back out, so it lands on
every day he is NOT at physical therapy. His reason: even a light 20 minutes
helps his knees, and he wants it on the schedule rather than left to memory.
The plan's 30 minute aerobic target is for the harder sessions, not for this.

The gym machine exercises are `freq: 0` because **he has no gym membership**. The
heavy loading happens with his physio. They stay listed so the prescription is on
record and a load can be entered after a clinic session.

## The week, and what a day IS

The Today tab opens with one line saying what the day is for, above the list.
A list on its own never answers "what am I meant to do today".

Strength lands on **Monday, Wednesday and Friday**. That spacing is the point:
the evidence for strength work after an ACL reconstruction is two to three
sessions a week with 48 hours between them. Mon to Wed is 48h, Wed to Fri is
48h, Fri to Mon is 72h, so no heavy day ever follows another. Balance work is
low load and sits on the days between. Aerobic work is most days.

**A clinic day overrides the weekday.** A session with the physio is itself a
big strength workout, so on a clinic day the app asks only for the tendon
loading and the balance work at home. Doubling up is how you end up too sore to
train the next day. Clinic days live in `program.clinicDays` (ISO date -> true);
the day's menu on Today (the three dots) marks or unmarks one by hand.

`tools/clinic_days.py` fills them in from the calendar:

```bash
python3 tools/clinic_days.py            # report only
python3 tools/clinic_days.py --write    # write them in
```

It reads the primary calendar's secret iCal address from the fringe planner's
`config/calendars.json` rather than keeping a second copy of that credential,
never prints the URL, only ever adds days (it will not remove one marked by
hand), skips days already past, snapshots the data file first, and **stamps each
record it writes** so the write is visible to sync. A Mac job, necessarily:
Google sends no CORS header on the iCal feed, and the URL must never reach a
phone. The Mac writes the days and sync carries them, exactly as the fringe
planner does it.

⚠️ `clinicDays` is a sub-map of `program`, so it had to be named in `SUB_MAPS`
in `app/js/sync/records.js`. The "no unregistered top-level keys" test does NOT
cover sub-maps; there is now a separate regression test for this one.

## Two devices, one log

The desktop app and the phone each keep a COMPLETE local copy and are fully
usable with no connection. A private repository holds one `state.json` and acts
purely as a relay between them; neither device needs the other to be switched
on, and neither needs the relay to function.

Sync is record level, not file level. The app stores everything in one
document, so copying the file would mean whichever device synced second wiped
the other's day. Instead the document decomposes into addressable records
(`app/js/sync/records.js`) which merge by last-write-wins with tombstones
(`merge.js`). Ties break on device id so both devices reach the same answer
without talking to each other.

Writes use the GitHub Contents API quoting the file's blob SHA, so a stale
write is rejected with a 409 and the engine re-reads, re-merges and retries.
Nothing is marked uploaded until the write is confirmed, which makes an
interrupted sync safe to repeat.

    app/js/sync/records.js   document <-> records
    app/js/sync/merge.js     merge rules, tombstones, pending counts
    app/js/sync/local-store.js  the only seam: local server vs IndexedDB
    app/js/sync/github.js    transport (the only backend-aware file)
    app/js/sync/engine.js    pull / merge / push, with conflict retry
    app/js/sync/config.js    per-device token: never synced, never committed

## Mobile

`app/m.html`, `mobile.css` and `js/mobile.js` are a purpose-built phone
interface sharing all business logic with the desktop.

**Device roles, set 2026-09-12.** The iPad and the Mac get the full app. The
**iPhone is optimised for logging**: Today and Supplements are the day to day
surface, and analysis belongs on the bigger screens. His reason is screen real
estate, not a change of mind, so the old rule still binds in one respect: there
is NO parallel phone implementation. The phone renders the same view modules;
what changes is what it leads with.

**The phone opens on Today.** It used to open on Supplements, because that was
the list checked several times a day; the day's supplements are on Today now,
so every device opens on the same screen.

**The document scrolls: do not "fix" that.** An earlier version pinned the
body and scrolled an inner container. It looked equivalent and was not: iOS
only collapses Safari's toolbars when the document itself scrolls, and asking
iOS to lay out a full-screen fixed box left a dead band at the bottom of the
installed app that no amount of padding could reach. Sticky header, fixed tab
bar, normal flow underneath.

The deployed `index.html` is a COPY of `m.html`, not a redirect: iOS reads
`apple-mobile-web-app-capable` and `-status-bar-style` from the exact page you
Add to Home Screen, and a redirect stub carries neither. `sw.js` precaches the
app shell so an installed PWA launches with no network; photos are cached
lazily on first view rather than bloating the install.

**Pull down at the top to sync.** The same action as the header's sync button,
without aiming at it. No new indicator is drawn: the gesture drives the sync
chip that is already there.

Feedback comes in two stages, because one flash was not enough to read. The
chip lights up **while your finger is still down**, the moment you have pulled
far enough, so you know letting go will sync before you commit; pull back up
and it goes out again. On release it shows the normal syncing state, held for a
minimum of 750ms: a sync with nothing to send finishes within a couple of
frames, and a blue dot shown that briefly reads as nothing having happened.
Tapping the button gets away with it because you are looking straight at it; a
pull does not, because your eye is on the content springing back.

The gesture is taken over outright rather than ridden on top of iOS's, because
an installed web app has its OWN pull-to-refresh and it RELOADS, which would
throw away the tab you were on and where you had scrolled to.
`overscroll-behavior-y: contain` stops iOS acting on the overscroll; the pull
and the spring back are drawn in `mobile.js`. The document still scrolls
normally, so Safari still collapses its toolbars.

Only `#view` is transformed, never `body`: a transform on an ancestor makes
`position: fixed` descendants position against it, which would break the fixed
tab bar. The header and tab bar sit outside `#view`, so neither follows.

The non-passive `touchmove` listener (the one that stops the browser scrolling
on its fast path) is attached only for the length of a touch that began at the
very top, and only when sync is configured, so ordinary scrolling never pays
for it. The pull disarms on a first move that is upward or sideways, and stays
out of gestures that belong to something else (`[data-drag]` reordering, range
sliders, sideways-scrolling tables, and any open modal).

`touchcancel` honours a completed pull exactly as `touchend` does. iOS cancels
a touch when the system takes it over (a notification arriving, an edge
gesture), and treating that as "never happened" meant a pull you had finished
could silently do nothing. Syncing is idempotent, so acting on a committed pull
is the safer of the two.

Deploy with `tools/deploy.sh`, which stamps the service worker with the commit
sha and pushes `app/` to the `gh-pages` branch.

## iOS traps this app already hit

Each of these looked like trivia and was not. They are the reason the mobile shell is
shaped the way it is; changing any of them back reintroduces a real bug.

- **`index.html` on Pages is a COPY of `m.html`, not a redirect.** iOS reads
  `apple-mobile-web-app-capable` and `-status-bar-style` from the exact page you Add
  to Home Screen. A redirect stub carries neither, so iOS letterboxes the installed
  app inside black bands it draws itself, which no CSS can reach.
- **The document scrolls.** A pinned body with an inner scroller stops Safari
  collapsing its toolbars and was the second cause of that same band.
- **`env(safe-area-inset-bottom)` is reserved only in standalone**, and only partly
  (~8pt). In Safari its own toolbar already covers the home indicator, so reserving it
  too double-counts. Only swipes from the edge are captured, not taps.
- **Inputs are 16px minimum** or iOS zooms the page on focus.
- **The service worker never registers on `localhost`**: it would claim every
  navigation on that origin and serve the mobile shell in place of the desktop app.
- **The worker reloads once on `controllerchange`**, or a deploy would sit unused
  until the second launch.
- **iOS caches Home Screen icon artwork.** Changing the icon needs remove + re-add.
- **An installed web app has its own pull-to-refresh, and it RELOADS.** Left alone it
  would discard the open tab and scroll position. `overscroll-behavior-y: contain`
  disables it so the pull-to-sync gesture can own that overscroll.

## The supplement checklist's day runs to 5am

Opening the app at 2am to finish ticking the day's supplements off, the list
wanted is the one for the day being finished, not a fresh empty one that has
to be corrected by tapping back a date. So the CHECKLIST's "today" holds until
**5am** and then moves on: `currentDayIso()` in `util.js`, one constant
(`DAY_ROLLOVER_HOUR`) to change it.

**Deliberately narrow: this is a convenience, not a model of time.** It
applies to the supplement checklist and nothing else:

- The checklist keeps its own date (`ctx.suppDate`), separate from the shared
  `ctx.date` every other view uses. Nothing outside this file reads the
  supplement list, so the two never need to agree.
- Its date pill's "today" button returns to that shifted day, hence the
  `today` option on `renderDatePill` / `bindDatePill`, which defaults to the
  real calendar date for every other caller.
- Today, the plan, tests, measurements, the week panel and the activity
  calendar all stay on `todayIso()`. Between midnight and 5am Supplements and
  Today therefore show different dates, which is intended.

**The as-needed medication below it does NOT roll over.** A dose is a timed
event: its day is the clock's day, and the countdown to the next one measures
from the real moment. `prnDateFor()` returns the real date while the checklist
is on its current day, and follows you to an older date when you navigate
deliberately, so a dose logged at 2am is stamped 2am on the real date, appears
immediately, and its countdown is honest. Filing it under the checklist's day
instead would put the instant 24 hours in the past and report a 12-hour wait as
already clear.

## Supplements and as-needed medication

`app/js/views/supplements.js`. The LIST and the daily TICKS
(`days[iso].supps`) are separate on purpose: a new day starts clean by itself
and every past day stays on record.

**History is never rewritten.** Membership is a list of date spans
(`{from, until}`), not a boolean. Removing closes the open span at that date;
re-adding opens a new one. So yesterday keeps whatever was true yesterday, and
the window while something was off the list stays off.

**Seeded ids must be deterministic.** The first version used `uid()`, so the
Mac seeded ten rows and the phone seeded ten more and sync, correctly, kept
all twenty. Ids now derive from the name (`suppId()`); `dedupeSupplements()`
repairs documents created before that, deterministically so both devices
converge on the same result.

As-needed drugs (`prnMeds` + `doses`) are a different shape: each dose is
timestamped, so the question "when may I take another?" can be answered.
The countdown runs from the most recent dose regardless of date, which is what
makes a wait crossing midnight read correctly the next morning. Logging a dose
early is allowed and recorded; the log is a record of what happened.

## Day sets: "what do I do today?"

`program.days[pid]` (synced as `p|days|<pid>`) holds the weekdays each program
item is planned for. Today lists the day's set, counts done against THAT
(`3 of 15 done`, not `3 of 25`), and folds everything else into "Not planned
today", still tickable. A day with nothing planned says so and shows the whole
list. Edit the days on the Program tab (seven chips per exercise, always all
seven rendered); the strip of eight chips at the top of that page (All plus the
seven days) filters the list to a day, and today's chip carries a dot.

The seed in `DEFAULT_DAYS` is **my default, not the clinician's**: the PhysiApp
export gives no frequency. It follows the plan's Month 2 weekly targets (3
strength · 3 balance · 4 aerobic): home strength Mon/Fri, gym + step work Wed,
calves every strength day, balance Tue/Thu/Sat, bike Mon/Thu and elliptical
Tue/Sat, Sunday rest. `seedProgramDays` runs once (`settings.daysSeeded`) and
refuses if any days exist; same contract as the supplement seed, so his
arrangement is never overwritten. An item with no entry means every day; an
empty list means never (the jump-prep exercise, until it is cleared).

**"Same as last time"** (in the day's menu on Today) ticks whatever was LOGGED
on the most recent earlier day, with its numbers; rows already on today keep
today's numbers. Rows with numbers typed but never ticked are not a
session (the same rule as the week bar), so they do not count as "last time".

Month markers with no measurement yet show "Not tested yet" and no pace badge:
untested is not behind.

## The service worker's precache list is GENERATED

`tools/gen_shell.py` rebuilds it from the real import graph, and `deploy.sh`
runs it on every deploy. Never hand-edit `SHELL_ASSETS`. A view added and not
listed is missing offline and updates on a different schedule from everything
else: that is exactly what happened to `supplements.js`, and it is the same
class of mistake as forgetting to register a record for sync.

Navigations revalidate in the background too, so the shell HTML (and therefore
the tab bar) can change without waiting for the cache generation to roll.
Settings → **Force update the app** is the manual escape hatch: it unregisters
the worker, clears the caches and reloads with a cache-busting query, while
deliberately leaving IndexedDB and localStorage alone.

## Today is a checklist

He opens the app to answer one question: what do I do today. So Today is the
date, one line saying what the day is for and what it costs ("Everyday rehab ·
15 to do · about 1h 30m"), then the day's exercises as a grouped list with a
circle to tick each one, then the day's supplements, the knee check-in as one
collapsed line, a note, and one line of feedback on the week at the very
bottom. On his phone the first exercise is on the first screen (197 px down;
it was 962 px).

Everything that used to sit above the list is on **Progress > Overview**: the
six month road, this week's cadence, the insight cards and the month board.
Nothing was deleted; it moved. Tapping a category on that cadence bar opens
the matching goal group on Today, which is the one place to log towards a plan
target that no program row covers.

**The tendon loading leads every day.** It is the morning's first job, with
six hours before anything else (his clinician's instruction), so it sits at
the top whatever its program number and a "6 hours later" line separates it
from the rest. The item carries `first: true` and `gap: '6 hours'` in
`program.js`; anything else marked `first` would join it.

Under the list: "Not planned today" (the rest of the program, still tickable)
and "This week's targets" (the plan's weekly targets as groups you can log
into). Both fold, and their open state lives on `ctx` so a tick does not close
them. The bulk actions (same as last time, tick everything, repeat last
session, the clinic program, record a test, mark a clinic day, clear the day)
are behind the three dots so the header stays calm.

Tapping a row's name opens it for numbers, exactly as before: ticking never
opens, opening never ticks. A gym row that is open also shows its resistance
boards. "Add something else" is the exercise picker; rows he adds himself sit
in the same list and are removed from inside the open row.

**The supplements block is the same rows as the Supplements tab**
(`renderSuppGroups` / `bindSuppGroups` in `supplements.js`), so the two cannot
drift. Between midnight and 5am it shows yesterday's list, exactly as the tab
does, and says so. Editing the list (add, remove, reorder, as-needed
medication) stays on the tab.

## Minutes per exercise

He wants to know what a session costs before he starts. Since 2026-09-14 the
figure is the workout player's own steps added up (`buildSteps` in
`app/js/timing.js`), so the estimate and the player cannot disagree: get
ready 5 s, the work, a 5 s side switch between legs of the same set, rest
between sets or holds (prescribed where the program says, otherwise a 30 s
default labeled as one), no final rest. A rep is 3 s including any short
hold, counted once; the star excursion and the wall squat have their own.
Cardio is last time's minutes or 20. An item with no target at all (the hip
lift) has no figure: the day reads "about 1h 13m + 1 untimed".

Once he has three complete, accurate player runs of the same prescription,
the trimmed mean of the newest seven replaces the estimate
(`learnedSeconds`). Only active time and rest count; time away, review time,
quick ticks, partial runs and runs marked "Timing was inaccurate" never do.
It is computed from the entries every time, never stored as a summary.

A number he types wins. It lives in `program.mins[pid]` (synced as
`p|mins|<pid>`, a sub-map, registered in `SUB_MAPS` with its own regression
test) and can be set from the open row on Today or on the Program page.
Clearing the box goes back to the estimate. The day's header sums the planned
rows ("about 1h 22m left" once some are done); the Program page sums each
list and each filtered day.

## The Plan tab is the month board

He likes the month board on Overview ("things are big and clear"), so the
6 Month Plan tab draws any month the same way: a strip of six tiles, then
the marker cards, the focus tiles (for the whole month) and the weekly
targets as tiles. The pieces are exported from `monthboard.js`
(`markerCards`, `focusTiles`, `targetTiles`, `bindMarkers`) and goal
progress lives in `app/js/goals.js`, which the board, the Plan tab and the
journey road all read. The judgement-call ticks (focus bullets that cannot
tick themselves) bind on both screens.

The transcription in `app/data/plan.js` follows the PDF as laid out, read
from the rendered pages on 2026-09-12: Month 3 has one marker, the brisk
walking one; its two "progress" lines are focus bullets. If the app and the
PDF ever disagree again, the PDF wins and the change is reported, not made
quietly.

## My Program

One page, two sections (Rehab, Gym), one filter. The strip at the top is eight
chips, All and the seven days, always all eight: tapping a day shows what is
planned that day across both sections and how long it adds up to; tapping it
again, or All, shows everything. Each exercise is a compact row (number,
picture, name, prescription and minutes, the seven day chips that change its
arrangement) and opens on tap for the written steps, notes, band, progression
and the minutes override. The gym's resistance boards live in the open row.

## Design language

Learned from his corrections, one screenshot at a time. Follow these before
adding any surface; each one exists because its violation was called out.

- **Hero blocks centre on a phone; data stays left.** A header that INTRODUCES
  a section (title with subtitle and badge stacked beneath) reads centred
  (`header.hero`, ≤640px). Rows, tables and logging surfaces stay left. His
  words: "left aligned sometimes works, but not in these two examples."
- **Controls are constant.** Nothing appears, disappears, or changes identity
  with state. The pattern is the "today"/"this week" pill: always rendered,
  dimmed and inert when inactive. A pill that becomes a borderless button on
  the next tap is two objects and reads as plain text.
- **Monospace is for numbers.** A phrase in mono ("not tested yet") reads as
  code. Test with /\d/ where content varies.
- **Chrome icons are drawn SVG, never emoji characters.** iOS renders ⚙ as a
  3-D sticker.
- **Inputs are sized by class, never inline font-size**: an inline size beats
  the 16px floor and iOS zooms the page on focus (`.in-num`, `.sel-sm`).
- **Sub-tab rows scroll on one line** (`.tabrow`; Tests pins its action beside
  them with `.panelbar`).
- **A list of things to do is a grouped list, not a stack of cards.** One card,
  hairline rows, the tick circle on the left carrying the category colour and
  turning green when done, the name, one quiet line under it, the minutes on
  the right. Nothing else on the row until it is opened (`.crow`, Today;
  `.prog-row`, Program).
- **Notices are one line.** A badge or a sentence, with the detail behind a
  tap. His words: the old paragraphs "end up having lots of sentences and take
  up a lot of visual real estate."
- **Bulk actions live behind one menu** (the three dots on Today), so the
  header stays calm and controls never come and go.
- **No em dash or en dash anywhere**: UI copy, data labels, comments, commit
  messages. Ranges read "2 to 3", empty cells a middle dot. Grep for both
  characters before handing anything over.
- **Numbers pin, labels wrap.** A count and its input sit in a fixed grid
  column (`.targetrow`), never in a flex row that rewraps per label length.
- **The header places chip, title and gear by explicit grid column,** not
  source order, so even a cache holding mixed deploy generations renders the
  name whole and centred.

## His arrangement IS the default

Anything Reuben curates in the running app (the supplement list, its grouping
and order, the as-needed medications, units, theme) is the source of truth. Code
defaults exist only to seed a device that has never had any, and they are
refreshed by copying FROM the live data, never by imposing on it.

Practically:

- `seedSupplements` / `seedPrnMeds` run once, gated on `settings.suppsSeeded` /
  `prnSeeded`, and additionally refuse to run at all if a list already exists,
  so a lost flag cannot overwrite a curated list.
- Adding a new item to `DEFAULTS` will NOT appear on his devices. That is the
  intended trade: his arrangement outranks a later idea of mine.
- Before changing those constants, read the live list out of the sync repo and
  copy it. Do not reorder from memory.

`order` is per record, so two devices renumbering independently can collide.
Sorting breaks ties on id (`byOrder`) so every device shows the same sequence.

## Network frugality

The app is used on mobile data, so redundant traffic is a bug:

- **The shell cache is immutable within a deploy** (its name carries the commit
  id), so cached assets are served with NO background refetch. An earlier
  stale-while-revalidate re-downloaded all 32 modules on every launch just to
  confirm nothing had changed. Updates arrive via the worker's version check.
- **Idle syncs are throttled to one per 5 minutes**, but anything PENDING syncs
  immediately whatever the reason: a change you made can never sit unsent
  because of a timer. Manual, post-edit and reconnect syncs are never throttled.
- **Update checks are at most half-hourly.**
- **The countdown ticker runs only while the page is visible and only while
  something is counting down**, at 60s, and stops itself when everything is
  clear. It touches no network at all.

## Repairs must be expressed as mutations

A migration that quietly edits the document leaves no tombstones, so the next
sync sees records the device has "never heard of" and pulls every one of them
back. The supplement dedupe did exactly this: it ran inside `migrate()`,
removed twenty duplicates locally, and sync restored them, twice, ending at
thirty.

Anything that DELETES during a repair must go through the stamping path
(`repair()` in store.js), which snapshots, mutates and calls `stampChanges` so
the removals become tombstones and travel. There is a test asserting a quiet
delete gets resurrected and a stamped one does not.

## Adding anything to the document

Any new top-level key MUST be registered in `app/js/sync/records.js`. An unregistered
key is invisible to the merge engine, and a device that has never seen it will push a
document without it and delete it everywhere. `caseFile` was exactly this bug. There
is a test asserting no unregistered top-level keys; keep it passing.

## Tests

Open `/dev-tests.html` against a running server. 259 assertions: the merge
rules and the sync engine (`dev-merge.js`, `dev-engine.js`), the timing model
(`dev-timing.js`), completion and run saving (`dev-logging.js`), the player's
state machine with fake clocks (`dev-player.js`) and the plan streak
(`dev-streak.js`), the edit guard in a real DOM (`dev-editguard.js`), including both devices editing offline, same-record
conflicts, deletions propagating, stale devices failing to resurrect deleted
records, backend outages and interrupted writes.

`python3 tools/test_pa_import.py`: 41 assertions on the PhysiApp import rules.

Test against a COPY, never the live file: `python3 tools/make_test_copy.py`
writes `data/test-copy/` (PhysiApp sign-in removed, songs linked), and the
`acl-rehab-test` launch configuration serves it with
`--port 8767 --no-physiapp --data data/test-copy/rehab-data.json`. A different port is a different origin, so it has no sync
token; `--no-physiapp` refuses their site outright.

## The workout player (2026-09-14)

One player for every exercise on every device: Start on Today runs the day's
list in order (skipping what is done), Resume returns to an open one, and
Start timer sits in any open row on Today and My Program. Built from
ChatGPT's brief as reviewed and settled with him; the full record is
`BUILD-PLAN-2026-09-14.local.md` and the handover
`PLAYER-2026-09-14.local.md`.

    app/js/timing.js         modes, steps, estimates, learned minutes (pure)
    app/js/player/engine.js  the state machine and the time buckets (pure)
    app/js/player/audio.js   cues and the metronome on the Web Audio clock
    app/js/player/songs.js   his own songs for paced work (private)
    app/js/player/player.js  the screen, drafts, Wake Lock, saving
    app/js/logging.js        completion rules and saveRun, shared with Today

**Every program item has an explicit `timer` mode** in `program.js`: reps,
hold, timed, cardio or manual. Reps happen at HIS pace: the player shows the
target, he taps Set done (adjusting the reps), rest starts. Nothing counts
reps for him. Holds, timed work and cardio are timed. Manual where the
prescription contradicts itself (pa04, pa08, pa16) or is missing (tp17);
nothing is invented.

**Controls never change identity.** Pause and Set done are always in the same
places, with Previous, Skip rest and Next beneath; what does not apply is
dimmed. Set done ends the SET; ending a hold early records the seconds held,
marked partial. Colours: the exercise's category colour for work and holds,
neutral for rest and get ready, the side colour for a switch, green only for
confirmed done.

**It renders in the document flow**, under the header, with the tab bar kept:
never a fixed full-screen box (the iOS trap above). Leaving the tab pauses it.
The step picture is contained, never cropped (placed absolutely inside its
box, because a grid item at height 100% overflowed on a wide screen).

**Time is kept in buckets** (active, rest, away) on a monotonic clock that only
moves while running. A pause, a locked phone or a timer that did not fire for
4 s is an interruption and is never credited. Hidden means paused, with
Resume; it never advances through unseen sets.

**The draft is this device's**, in localStorage (`rehab.player.v1`): written at
every transition, on hide and every 5 s while running, restored as
interrupted after a reload. Only a confirmed result enters the synced
document. The service worker waits for the player to close before reloading
onto a new deploy.

**Saving goes through `saveRun`**, the same completion model a tick uses. It
is idempotent on the run id, reuses unlogged scaffolding, records the
prescription and timing it ran against (`rxSnap`, `timing`), keeps exercise
discomfort and effort on the result (never the daily knee check-in), and
writes nothing for a side with nothing done. If the exercise was logged on
another device meanwhile, both are kept and the review says so.

**Completion** (`itemStatus`): none, started (scaffolding only), partial,
done. An unlogged scaffold beside a logged row is ignored; an unsplit side B
result covers a per-leg item and is flagged, never read as left and right.

**The six hour notice** reads the tendon loading's confirmed time (`doneAt`,
recorded on every tick from 2026-09-14): "Rest of your workout after 3:30 PM",
tappable to correct. Old rows without a time get no precise time. Nothing is
blocked.

## Plan streak (2026-09-14)

`app/js/planstreak.js`. Days whose PLANNED work was done, judged against dated
schedule versions in `program.schedule` (a registered sub-map): each is the
resolved plan (weekday lists and the clinic list), written when the
arrangement changes, effective from that day, exactly like the supplement
list's rule. A clinic mark is a fact about one date. Days before the first
version are unknown and stop the walk; a known day with nothing planned
keeps the streak; check-ins never count. Milestones on Overview
(`milestones.js`) are derived the same way and never stored.

## PhysiApp import rules (2026-09-14)

The merge lives in `pa_import.py`, pure and tested. The server writes the
file directly, so every record an import changes is STAMPED in `_sync.rec`,
or a change to an existing row would never reach the phone. Unchanged results
are unchanged, not updated. Scaffolding is never filled: an import is its own
side B row. A row he unticks or edits (load and notes included) is his. No
positional guessing: an unmatched name is reported for review. The last
attempt and its error live in server memory (`/api/physiapp/status`), not the
synced document.

## His songs (2026-09-14)

For paced work (the calf pulses), music is the DEFAULT and the metronome is off;
choosing one turns the other off (his call). The countdown beeps play either
way. One of his own 120 bpm tracks plays, shuffled; with Keep playing (on unless
he turns it off) it carries on through rest, switches, the review and the screen
between exercises, moving to another track when one ends. A song asks iOS to
pause other audio ('transient-solo') and hands it back when it stops; beeps and
the metronome play on top ('transient'). A web page cannot touch Spotify on the
Mac.

Supplement ticks record their time (an ISO string; older ticks are `true` and
are never given an invented time), with a time chip on the row to correct it.
The tendon loading's open row has Done at on the time wheel.

**The morning pair (his rule):** the tendon loading is always exactly 30 minutes
after the collagen. A time he SETS for either one sets the other (and marks it
done or taken); a plain tick records now and changes nothing else. The collagen
is found by name in his supplement list (`MORNING_GAP_MIN` in `today.js`).
Private by construction: the public repo and site hold no audio and no song
names. `tools/add_song.py` copies a track byte for byte into `data/media/`
(gitignored, served with Range requests) and uploads the same bytes to
`media/` in the PRIVATE sync repo, where the phone downloads it once into
IndexedDB. The originals in his Music library are never touched.

## Never redraw mid-edit (2026-09-14)

Every repaint in both shells goes through `guardPaint` (`app/js/editguard.js`).
A redraw asked for while a text or number field is in use, or on a touch screen
while a select, date or time picker is open, waits until he leaves the control;
a change of tab is never held back. Data is still saved the moment it changes.
It exists because iOS closed his time wheel before he could tap the check mark,
and Codex's audit found the same shape in load typing, date and band pickers and
sync pulls. Reloads (service worker, the Mac's PhysiApp import) also wait for
idle and flush the pending save first (`flushSave`, `saveOutstanding` in
`store.js`). Anything that must not claim "saved" early awaits `flushSave()`.

## Status line, session comparison, one save chip (2026-09-14)

From Codex's design ideas, all three built on his say-so:
- **Today's status line**, always under the header: what Start or Resume will
  do (the open workout and where it stopped, "Up next", or done). Text only;
  Start/Resume stays the one control (`statusLine` in `today.js`,
  `draftInfo` in `player.js`).
- **This session and Last session** in every open row, per set and in today's
  weight unit; "Recent sessions" stays open through repaints (`exhistory.js`).
- **One chip for "is my work safe"** (`status.js`), same place on every device:
  Not saved, Saving, Syncing, Retry, N to sync, Synced, or Saved when sync is
  not set up on that device.

## Log and carry on, no review screen (2026-09-14)

His call: "If I complete the sets, it should just log it as completed... I don't
need a quality check when I'm logging." The last set logs the exercise durably
and the next exercise opens with a 10 s get ready that starts by itself
(`finishRun`, `startNextNow` in `player.js`). One exercise opened from its row
rolls on into the rest of today's list. After the tendon loading the workout
stops on the six hour line. Corrections happen in the row on Today; the review
screen only appears as the retry when a save fails. Stop early and Save what I
did logs at once. A timed bout under a second is not work.
