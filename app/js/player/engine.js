// The workout player's state machine. No DOM, no store, no clock of its own:
// every function takes the time it should use, so the tests drive it with
// fake clocks and prove what gets credited.
//
// States:
//   ready        before Start
//   running      the clock is moving
//   paused       he pressed Pause
//   interrupted  the app was hidden or he navigated away; never resumes itself
//   review       every step walked; confirm what actually happened
//
// Time is kept in three buckets, and only two of them ever train an estimate:
//   activeMs  get ready, the work, side switches
//   restMs    rest between sets and holds
//   awayMs    wall time between a pause and its resume (interruptions)
// The running clock is monotonic (performance.now in the app) and only moves
// while running, so a pause, a lock screen or an hour away is never credited.
//
// Reps are his: a reps step ends only when he taps Set done. Timed steps
// (get ready, holds, timed work, rest, switch) end on their own. Ending a hold
// early records the seconds actually held, marked partial.

import { buildSteps, rxSignature, repSeconds } from '../timing.js';

export const WORK = new Set(['reps', 'hold', 'work', 'manual']);
export const TIMED = new Set(['ready', 'hold', 'work', 'rest', 'switch']);
const FULL_SLACK_MS = 400;   // a hold ended this close to its end counts as full

export function createRun({ item, ex, iso, prefs = {}, cardioMin = null, runId }) {
  const built = buildSteps(item, ex, { prefs, cardioMin });
  return {
    v: 1,
    runId,
    pid: item.id,
    iso,
    mode: built.mode,
    pace: built.pace,
    targetKnown: built.targetKnown,
    steps: built.steps,
    rx: rxSignature(item, ex),
    rxSnap: {
      mode: built.mode, sets: item.sets ?? null, reps: item.reps ?? null, hold: item.hold ?? null,
      rest: item.rest ?? null, sides: item.sides || 'both',
      repSec: repSeconds(item, prefs), restSec: built.rest.secs, restSrc: built.rest.src,
    },
    i: 0,
    state: 'ready',
    stepMs: 0,
    since: null,
    activeMs: 0,
    restMs: 0,
    awayMs: 0,
    interruptions: 0,
    pausedAtWall: null,
    pauseReason: null,
    results: {},
    startedAt: null,
    reviewAt: null,
  };
}

export const step = (run) => run.steps[run.i] || null;

/** Move the running clock into the current step and the right bucket. */
function accrue(run, now) {
  if (run.state !== 'running' || run.since == null) return;
  const d = Math.max(0, now - run.since);
  run.stepMs += d;
  if (step(run)?.kind === 'rest') run.restMs += d; else run.activeMs += d;
  run.since = now;
}

export function elapsedMs(run, now) {
  let ms = run.stepMs;
  if (run.state === 'running' && run.since != null) ms += Math.max(0, now - run.since);
  return ms;
}

/** Seconds left on a timed step, or null for a step he completes himself. */
export function remainingSec(run, now) {
  const st = step(run);
  if (!st || st.secs == null) return null;
  return Math.max(0, st.secs * 1000 - elapsedMs(run, now)) / 1000;
}

export function start(run, now, wall) {
  if (run.state !== 'ready') return [];
  run.state = 'running';
  run.since = now;
  run.startedAt = new Date(wall).toISOString();
  return [{ type: 'started' }];
}

export function pause(run, now, wall, reason = 'pause') {
  if (run.state !== 'running') return [];
  accrue(run, now);
  run.since = null;
  run.state = reason === 'pause' ? 'paused' : 'interrupted';
  run.pauseReason = reason;
  run.pausedAtWall = wall;
  return [{ type: 'paused', reason }];
}

export function resume(run, now, wall) {
  if (run.state !== 'paused' && run.state !== 'interrupted') return [];
  if (run.pausedAtWall != null) run.awayMs += Math.max(0, wall - run.pausedAtWall);
  run.interruptions += 1;
  run.pausedAtWall = null;
  run.pauseReason = null;
  run.state = 'running';
  run.since = now;
  return [{ type: 'resumed' }];
}

function advance(run, now, wall, carryMs = 0) {
  const from = run.i;
  run.i += 1;
  run.stepMs = 0;
  if (run.i >= run.steps.length) {
    run.i = run.steps.length;
    run.state = 'review';
    run.since = null;
    run.reviewAt = new Date(wall).toISOString();
    return [{ type: 'review', from }];
  }
  run.stepMs = Math.max(0, carryMs);
  if (run.state === 'running') run.since = now;
  return [{ type: 'step', from, to: run.i, kind: step(run).kind }];
}

/**
 * Let timed steps end on their own. Returns the events, in order. A tick that
 * finds several steps overdue walks them all, carrying the overshoot, so a
 * late timer cannot stretch the run; the controller treats a long gap as an
 * interruption instead of calling this.
 */
export function tick(run, now, wall) {
  const events = [];
  let guard = 0;
  while (run.state === 'running' && guard++ < 50) {
    const st = step(run);
    if (!st || !TIMED.has(st.kind) || st.secs == null) break;
    accrue(run, now);
    const over = run.stepMs - st.secs * 1000;
    if (over < 0) break;
    if (st.kind === 'hold' || st.kind === 'work') run.results[run.i] = { secs: st.secs, full: true };
    // The overshoot was accrued to the finished step; move it to the next.
    if (st.kind === 'rest') run.restMs -= over; else run.activeMs -= over;
    const nextKind = run.steps[run.i + 1]?.kind;
    if (nextKind === 'rest') run.restMs += over; else if (nextKind) run.activeMs += over;
    events.push(...advance(run, now, wall, nextKind ? over : 0));
  }
  return events;
}

/**
 * Set done: ends the current SET, never the exercise.
 *   reps / manual  records the reps he confirms (the target by default)
 *   hold / work    records the seconds actually done; short of the target
 *                  it is partial, never the prescribed duration
 */
export function setDone(run, now, wall, reps = undefined) {
  const st = step(run);
  if (!st || !WORK.has(st.kind)) return [];
  if (run.state === 'ready') start(run, now, wall);
  if (run.state === 'paused' || run.state === 'interrupted') resume(run, now, wall);
  accrue(run, now);
  if (st.kind === 'reps' || st.kind === 'manual') {
    const n = reps === undefined ? st.reps : reps;
    // Zero reps is not a set done. Fewer than the target is a set done, but
    // short: it counts as done and never trains a full-prescription estimate.
    const r = { reps: n ?? null, full: n == null || n > 0 };
    if (n != null && n > 0 && st.reps != null && n < st.reps) r.short = true;
    run.results[run.i] = r;
  } else {
    const ms = run.stepMs;
    const full = st.secs != null && ms >= st.secs * 1000 - FULL_SLACK_MS;
    run.results[run.i] = { secs: full ? st.secs : Math.round(ms / 1000), full };
  }
  return advance(run, now, wall);
}

/**
 * Before saving an unfinished run: a hold or timed bout in progress becomes a
 * partial result for the seconds actually done, so stopping mid-hold keeps
 * that work instead of dropping it. Does not advance.
 */
export function capturePartial(run, now) {
  const st = step(run);
  if (!st || (st.kind !== 'hold' && st.kind !== 'work') || run.results[run.i]) return false;
  accrue(run, now);
  const secs = Math.floor(run.stepMs / 1000);
  if (secs < 1) return false;
  run.results[run.i] = { secs, full: false };
  return true;
}

/** Any work at all: a result, or a timed step already under way. */
export function started(run, now) {
  if (Object.keys(run.results).length) return true;
  const st = step(run);
  return !!st && (st.kind === 'hold' || st.kind === 'work') && elapsedMs(run, now) >= 1000;
}

/** Skip rest, a side switch or get ready. */
export function skipRest(run, now, wall) {
  const st = step(run);
  if (!st || !['rest', 'switch', 'ready'].includes(st.kind)) return [];
  if (run.state === 'ready') start(run, now, wall);
  accrue(run, now);
  return advance(run, now, wall);
}

/** Next step. Skipping a work step records nothing for it. */
export function next(run, now, wall) {
  if (!step(run)) return [];
  if (run.state === 'ready') start(run, now, wall);
  accrue(run, now);
  return advance(run, now, wall);
}

/** Back to the previous work step, clearing its result so it can be redone. */
export function prev(run, now) {
  accrue(run, now);
  let j = Math.min(run.i, run.steps.length) - 1;
  while (j >= 0 && !WORK.has(run.steps[j].kind)) j--;
  if (j < 0) return [];
  const from = run.i;
  delete run.results[j];
  run.i = j;
  run.stepMs = 0;
  if (run.state === 'review') {
    run.state = 'paused';
    run.reviewAt = null;
    run.pausedAtWall = null;
  }
  if (run.state === 'running') run.since = now;
  return [{ type: 'step', from, to: j, kind: run.steps[j].kind }];
}

/** Units of work: which are done, and what the pips show. */
export function progress(run) {
  const work = run.steps.map((s, i) => ({ s, i })).filter((x) => WORK.has(x.s.kind));
  return work.map(({ s, i }) => ({ i, side: s.side, set: s.set, unit: s.unit, result: run.results[i] || null, current: i === run.i }));
}

/**
 * What the run did, per side, for the review sheet and the log.
 *
 * complete is true only when every work step has a full result. A run with
 * something done but not everything is partial.
 */
export function summary(run) {
  const bySide = {};
  let total = 0;
  let done = 0;
  let full = 0;
  let short = false;
  for (const p of progress(run)) {
    total++;
    const side = p.side || 'B';
    const b = (bySide[side] ||= { side, planned: 0, units: [], sets: new Set(), full: true });
    b.planned++;
    // A zero-rep result is recorded but is not work done.
    if (!p.result || p.result.reps === 0) { b.full = false; continue; }
    done++;
    if (p.result.short) short = true;
    if (p.result.full) full++; else b.full = false;
    b.sets.add(p.set);
    b.units.push({ set: p.set, unit: p.unit, ...p.result });
  }
  const sides = Object.values(bySide).map((b) => {
    const repsBySet = [];
    const secsList = [];
    for (const u of b.units) {
      if (u.reps != null) repsBySet[u.set - 1] = u.reps;
      if (u.secs != null) {
        secsList.push(u.secs);
        if (run.mode === 'hold') repsBySet[u.set - 1] = (repsBySet[u.set - 1] || 0) + 1;
      }
    }
    return {
      side: b.side,
      planned: b.planned,
      sets: b.sets.size,
      repsBySet: Array.from(repsBySet, (x) => x ?? null),
      secsList,
      anyDone: b.units.length > 0,
      full: b.full && b.units.length === b.planned,
    };
  });
  return {
    sides,
    total,
    done,
    complete: total > 0 && full === total,
    // Complete AND every set at or above its target: only this trains estimates.
    asPrescribed: total > 0 && full === total && !short,
    anyDone: done > 0,
    activeSec: Math.round(run.activeMs / 1000),
    restSec: Math.round(run.restMs / 1000),
    awaySec: Math.round(run.awayMs / 1000),
    interruptions: run.interruptions,
  };
}
