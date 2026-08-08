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
interface sharing all business logic with the desktop. `sw.js` precaches the
app shell so an installed PWA launches with no network; photos are cached
lazily on first view rather than bloating the install.

Deploy with `tools/deploy.sh`, which stamps the service worker with the commit
sha and pushes `app/` to the `gh-pages` branch.

## Tests

Open `/dev-tests.html` against a running server. 62 assertions across the merge
rules and the sync engine, including both devices editing offline, same-record
conflicts, deletions propagating, stale devices failing to resurrect deleted
records, backend outages and interrupted writes.
