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

Then open <http://localhost:8757>. Pure Python standard library — no
dependencies, no build step.

## Layout

```
server.py           local HTTP server + JSON persistence
app/                the front end (plain ES modules, no framework)
  js/sync/          record-level merge engine used by both devices
  data/             exercise, plan and measurement definitions
tools/              tests
```

## Data

All personal data — logged sessions, measurements, clinical history — lives
outside this repository: on the local machine, and in a private repository used
purely as a sync relay. Nothing identifying is published here.

## Two devices, one log

The desktop app and the phone each keep a COMPLETE local copy and are fully
usable with no connection. A private repository holds one `state.json` and acts
purely as a relay between them — neither device needs the other to be switched
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
    app/js/sync/config.js    per-device token — never synced, never committed

## Mobile

`app/m.html`, `mobile.css` and `js/mobile.js` are a purpose-built phone
interface sharing all business logic with the desktop.

**The document scrolls — do not "fix" that.** An earlier version pinned the
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
far enough, so you know letting go will sync before you commit — pull back up
and it goes out again. On release it shows the normal syncing state, held for a
minimum of 750ms: a sync with nothing to send finishes within a couple of
frames, and a blue dot shown that briefly reads as nothing having happened.
Tapping the button gets away with it because you are looking straight at it; a
pull does not, because your eye is on the content springing back.

The gesture is taken over outright rather than ridden on top of iOS's, because
an installed web app has its OWN pull-to-refresh and it RELOADS — which would
throw away the tab you were on and where you had scrolled to.
`overscroll-behavior-y: contain` stops iOS acting on the overscroll; the pull
and the spring back are drawn in `mobile.js`. The document still scrolls
normally, so Safari still collapses its toolbars.

Only `#view` is transformed, never `body`: a transform on an ancestor makes
`position: fixed` descendants position against it, which would break the fixed
tab bar. The header and tab bar sit outside `#view`, so neither follows.

The non-passive `touchmove` listener — the one that stops the browser scrolling
on its fast path — is attached only for the length of a touch that began at the
very top, and only when sync is configured, so ordinary scrolling never pays
for it. The pull disarms on a first move that is upward or sideways, and stays
out of gestures that belong to something else (`[data-drag]` reordering, range
sliders, sideways-scrolling tables, and any open modal).

`touchcancel` honours a completed pull exactly as `touchend` does. iOS cancels
a touch when the system takes it over — a notification arriving, an edge
gesture — and treating that as "never happened" meant a pull you had finished
could silently do nothing. Syncing is idempotent, so acting on a committed pull
is the safer of the two.

Deploy with `tools/deploy.sh`, which stamps the service worker with the commit
sha and pushes `app/` to the `gh-pages` branch.

## iOS traps this app already hit

Each of these looked like trivia and was not. They are the reason the mobile shell is
shaped the way it is — changing any of them back reintroduces a real bug.

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
- **The service worker never registers on `localhost`** — it would claim every
  navigation on that origin and serve the mobile shell in place of the desktop app.
- **The worker reloads once on `controllerchange`**, or a deploy would sit unused
  until the second launch.
- **iOS caches Home Screen icon artwork.** Changing the icon needs remove + re-add.
- **An installed web app has its own pull-to-refresh, and it RELOADS.** Left alone it
  would discard the open tab and scroll position. `overscroll-behavior-y: contain`
  disables it so the pull-to-sync gesture can own that overscroll.

## Supplements and as-needed medication

`app/js/views/supplements.js`. The LIST and the daily TICKS
(`days[iso].supps`) are separate on purpose: a new day starts clean by itself
and every past day stays on record.

**History is never rewritten.** Membership is a list of date spans
(`{from, until}`), not a boolean. Removing closes the open span at that date;
re-adding opens a new one. So yesterday keeps whatever was true yesterday, and
the window while something was off the list stays off.

**Seeded ids must be deterministic.** The first version used `uid()`, so the
Mac seeded ten rows and the phone seeded ten more and sync — correctly — kept
all twenty. Ids now derive from the name (`suppId()`); `dedupeSupplements()`
repairs documents created before that, deterministically so both devices
converge on the same result.

As-needed drugs (`prnMeds` + `doses`) are a different shape: each dose is
timestamped, so the question "when may I take another?" can be answered.
The countdown runs from the most recent dose regardless of date, which is what
makes a wait crossing midnight read correctly the next morning. Logging a dose
early is allowed and recorded — the log is a record of what happened.

## The service worker's precache list is GENERATED

`tools/gen_shell.py` rebuilds it from the real import graph, and `deploy.sh`
runs it on every deploy. Never hand-edit `SHELL_ASSETS`. A view added and not
listed is missing offline and updates on a different schedule from everything
else — that is exactly what happened to `supplements.js`, and it is the same
class of mistake as forgetting to register a record for sync.

Navigations revalidate in the background too, so the shell HTML (and therefore
the tab bar) can change without waiting for the cache generation to roll.
Settings → **Force update the app** is the manual escape hatch: it unregisters
the worker, clears the caches and reloads with a cache-busting query, while
deliberately leaving IndexedDB and localStorage alone.

## Design language

Learned from his corrections, one screenshot at a time. Follow these before
adding any surface; each one exists because its violation was called out.

- **Hero blocks centre on a phone; data stays left.** A header that INTRODUCES
  a section — title with subtitle and badge stacked beneath — reads centred
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
- **Inputs are sized by class, never inline font-size** — an inline size beats
  the 16px floor and iOS zooms the page on focus (`.in-num`, `.sel-sm`).
- **Segment labels shorten on a phone, in his words:** Rehab, Gym, Goals,
  Other, Completed (`.lbl-full` / `.lbl-short`). Full wording everywhere else.
- **Sub-tab rows scroll on one line** (`.tabrow`; Tests pins its action beside
  them with `.panelbar`). Today's session segments deliberately WRAP instead —
  all five stay visible.
- **Numbers pin, labels wrap.** A count and its input sit in a fixed grid
  column (`.targetrow`), never in a flex row that rewraps per label length.
- **The header places chip, title and gear by explicit grid column,** not
  source order, so even a cache holding mixed deploy generations renders the
  name whole and centred.

## His arrangement IS the default

Anything Reuben curates in the running app — the supplement list, its grouping
and order, the as-needed medications, units, theme — is the source of truth. Code
defaults exist only to seed a device that has never had any, and they are
refreshed by copying FROM the live data, never by imposing on it.

Practically:

- `seedSupplements` / `seedPrnMeds` run once, gated on `settings.suppsSeeded` /
  `prnSeeded`, and additionally refuse to run at all if a list already exists —
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
  immediately whatever the reason — a change you made can never sit unsent
  because of a timer. Manual, post-edit and reconnect syncs are never throttled.
- **Update checks are at most half-hourly.**
- **The countdown ticker runs only while the page is visible and only while
  something is counting down**, at 60s, and stops itself when everything is
  clear. It touches no network at all.

## Repairs must be expressed as mutations

A migration that quietly edits the document leaves no tombstones, so the next
sync sees records the device has "never heard of" and pulls every one of them
back. The supplement dedupe did exactly this: it ran inside `migrate()`,
removed twenty duplicates locally, and sync restored them — twice, ending at
thirty.

Anything that DELETES during a repair must go through the stamping path
(`repair()` in store.js), which snapshots, mutates and calls `stampChanges` so
the removals become tombstones and travel. There is a test asserting a quiet
delete gets resurrected and a stamped one does not.

## Adding anything to the document

Any new top-level key MUST be registered in `app/js/sync/records.js`. An unregistered
key is invisible to the merge engine, and a device that has never seen it will push a
document without it and delete it everywhere. `caseFile` was exactly this bug. There
is a test asserting no unregistered top-level keys — keep it passing.

## Tests

Open `/dev-tests.html` against a running server. 71 assertions across the merge
rules and the sync engine, including both devices editing offline, same-record
conflicts, deletions propagating, stale devices failing to resurrect deleted
records, backend outages and interrupted writes.
