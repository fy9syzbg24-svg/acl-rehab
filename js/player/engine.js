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

// Open holds (balance held as long as it lasts, 2026-09-18). The step's time is
// a goal, not an end: it runs on until Set done and records the seconds held,
// to a tenth. A pause means he stepped off, so the bout so far is one attempt
// and the clock starts again from zero on resume; the hold's result is the
// best single attempt, never attempts added together (his rule the same day).
// Every attempt of 10 s or more is logged as its own hold; a shorter bout
// before a pause was an accidental pause, not worth logging (his rule, same
// evening). The last bout always counts when it is the only one.
const tenth = (ms) => Math.round(ms / 100) / 10;
export const OPEN_MIN_SECS = 10;
function openBest(run, ms) {
  const tries = [...(run.openTries?.[run.i] || [])];
  // Paused: the bout before the pause is already in tries (or was too short to
  // be one), and the clock still holds it until he resumes, so it is not
  // counted a second time (2026-09-22 audit: Save what I did logged 25, 40, 40).
  const last = run.openRestart === run.i ? 0 : tenth(ms);
  if (last >= OPEN_MIN_SECS || (!tries.length && last >= 1)) tries.push(last);
  // A sole short bout before a pause still counts when nothing else was held,
  // as a lone bout always does: 8 s, Pause, Set done used to log 0.
  if (!tries.length && run.openShort?.[run.i] >= 1) tries.push(run.openShort[run.i]);
  return { tries, best: tries.length ? Math.max(...tries) : 0 };
}

export function createRun({ item, ex, iso, prefs = {}, cardioMin = null, runId, readySec = null }) {
  const built = buildSteps(item, ex, { prefs, cardioMin, readySec });
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
  const st = step(run);
  if (st?.open && st.kind === 'hold' && run.stepMs >= 1000) {
    if (run.stepMs >= OPEN_MIN_SECS * 1000) (run.openTries ||= {})[run.i] = [...(run.openTries[run.i] || []), tenth(run.stepMs)];
    else (run.openShort ||= {})[run.i] = Math.max(run.openShort?.[run.i] || 0, tenth(run.stepMs));
    run.openRestart = run.i;
  }
  run.since = null;
  // A skipped rest holds the run paused through its count in, and is never an
  // interruption (F25); Skip now says so, so resume can tell (2026-09-22).
  run.state = reason === 'pause' || reason === 'skip' ? 'paused' : 'interrupted';
  run.pauseReason = reason;
  run.pausedAtWall = wall;
  return [{ type: 'paused', reason }];
}

export function resume(run, now, wall) {
  if (run.state !== 'paused' && run.state !== 'interrupted') return [];
  // A skipped rest is not an interruption: he asked for the five second count
  // in there, and counting it left sessions reading "Paused 3 times" for taps
  // he made to get on with it (audit F25, 2026-09-19).
  const skipped = run.pauseReason === 'skip';
  if (run.pausedAtWall != null && !skipped) run.awayMs += Math.max(0, wall - run.pausedAtWall);
  if (!skipped) run.interruptions += 1;
  run.pausedAtWall = null;
  run.pauseReason = null;
  run.state = 'running';
  run.since = now;
  // An open hold starts over after a pause: the bout before it was its own attempt.
  if (run.openRestart === run.i) { run.stepMs = 0; run.openRestart = null; }
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
    if (!st || !TIMED.has(st.kind) || st.secs == null || st.open) break;
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
    // How long THIS set took (his ask, 2026-09-15: "whenever I log exercises,
    // remember all of the pace data for all of my exercises"). It was only ever
    // accumulated into the run's total active time, so a set of 12 could never
    // be separated from the rest of the exercise afterwards. Kept as `took` and
    // not `secs`, because `secs` means "a timed bout of this length" everywhere
    // else and a rep set is not that: reading it as one would turn his reps into
    // holds in the log.
    //
    // Recorded for its own sake. Nothing uses it yet; a pace goal will.
    // Only a set he actually did. A zero-rep result is recorded so the log is
    // honest about the attempt, but it is not work, and its seconds would
    // poison any future pace figure with time spent not exercising.
    const took = Math.round(run.stepMs / 1000);
    if (took > 0 && r.full) r.took = took;
    run.results[run.i] = r;
  } else if (st.open) {
    const { tries, best } = openBest(run, run.stepMs);
    run.results[run.i] = { secs: best, full: st.secs == null || best * 1000 >= st.secs * 1000 - FULL_SLACK_MS, tries };
  } else {
    const ms = run.stepMs;
    const full = st.secs != null && ms >= st.secs * 1000 - FULL_SLACK_MS;
    // Under a second is not a bout done (his screenshot: four "0 s" bouts
    // counted as four sets). Recorded, but never counted as work.
    run.results[run.i] = { secs: full ? st.secs : Math.floor(ms / 1000), full };
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
  if (st.open) {
    const { tries, best } = openBest(run, run.stepMs);
    if (best < 1) return false;
    run.results[run.i] = { secs: best, full: st.secs == null || best >= st.secs, tries };
    return true;
  }
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

/**
 * Give the current wait more time (his ask, item 11, 2026-09-15). Only a rest,
 * a side switch or get ready can be lengthened: adding time to a hold would
 * change what the set was, and the set is the record.
 *
 * The step's own length moves, so remaining() and every cue already scheduled
 * off it follow, and a step that had already run past its end comes back to
 * life rather than ending the moment the button is let go.
 */
export function addRest(run, secs, now) {
  const st = step(run);
  if (!st || !['rest', 'switch', 'ready'].includes(st.kind) || st.secs == null) return false;
  accrue(run, now);
  const ran = Math.ceil(run.stepMs / 1000);
  st.secs = Math.max(st.secs, ran) + secs;
  return true;
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
  // An open hold's attempts go with its result, or a redo adds to the old ones
  // and the leg records both bouts (audit F26, 2026-09-19).
  if (run.openTries) delete run.openTries[j];
  if (run.openRestart === j) run.openRestart = null;
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
    if (!p.result || p.result.reps === 0 || (p.result.reps == null && p.result.secs === 0)) { b.full = false; continue; }
    done++;
    if (p.result.short) short = true;
    if (p.result.full) full++; else b.full = false;
    b.sets.add(p.set);
    b.units.push({ set: p.set, unit: p.unit, ...p.result });
  }
  const sides = Object.values(bySide).map((b) => {
    const repsBySet = [];
    const secsList = [];
    // How long each SET took, in set order (2026-09-15). Separate from secsList,
    // which is the length of a timed bout and means something different: this is
    // the clock on a set of reps he did at his own pace.
    const tookBySet = [];
    for (const u of b.units) {
      if (u.reps != null) repsBySet[u.set - 1] = u.reps;
      if (u.took != null) tookBySet[u.set - 1] = u.took;
      if (u.tries?.length) {
        // An open hold: each attempt is its own hold in the log.
        secsList.push(...u.tries);
        if (run.mode === 'hold') repsBySet[u.set - 1] = (repsBySet[u.set - 1] || 0) + u.tries.length;
      } else if (u.secs != null) {
        secsList.push(u.secs);
        if (run.mode === 'hold') repsBySet[u.set - 1] = (repsBySet[u.set - 1] || 0) + 1;
      }
    }
    return {
      side: b.side,
      planned: b.planned,
      sets: b.sets.size,
      repsBySet: Array.from(repsBySet, (x) => x ?? null),
      tookBySet: tookBySet.length ? Array.from(tookBySet, (x) => x ?? null) : null,
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
