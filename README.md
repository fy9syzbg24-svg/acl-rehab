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

## Adding anything to the document

Any new top-level key MUST be registered in `app/js/sync/records.js`. An unregistered
key is invisible to the merge engine, and a device that has never seen it will push a
document without it and delete it everywhere. `caseFile` was exactly this bug. There
is a test asserting no unregistered top-level keys — keep it passing.

## Tests

Open `/dev-tests.html` against a running server. 62 assertions across the merge
rules and the sync engine, including both devices editing offline, same-record
conflicts, deletions propagating, stale devices failing to resurrect deleted
records, backend outages and interrupted writes.
