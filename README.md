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

## Tests

Open `/dev-tests.html` against a running server to execute the merge-engine
suite.
