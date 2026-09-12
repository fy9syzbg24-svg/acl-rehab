// How long an exercise costs, in minutes.
//
// He wants to know what a session costs before he starts it, so every row on
// Today carries a time and the day carries a total. The clinician's program
// gives sets, reps and holds but never a duration, so this derives one:
//
//   a rep takes SEC_PER_REP seconds (slow, controlled rehab movement)
//   a hold of 10 s or more is its own rep, with a rest after each one
//   a short hold (the 1 s pause at the top of a bridge) adds to the rep
//   sets rest SET_REST_SEC apart unless the item says otherwise ("2 min")
//   "each side" doubles the work
//   cardio is the minutes he logged last time, or 20
//
// It is an estimate and it says so. A number he types on the row wins, and
// that override lives in program.mins (synced as p|mins|<pid>), never here.
//
// Pure functions: nothing in this file reads the store, so the tests can run
// it against fixtures.

import { num } from './util.js';

export const SEC_PER_REP = 3;
export const SET_REST_SEC = 30;
export const CARDIO_DEFAULT_MIN = 20;
export const LONG_HOLD_SEC = 10;

// Movements that are known to be slower than a plain rep. The star excursion
// touches eight targets per rep; the wall squat is a slow slide with a squeeze.
const SLOW_REPS = { pa12: 12, pa16: 8 };

/** "30s", "1s", "2 min", "1.5 min", "45 sec" -> seconds. Anything else -> 0. */
export function parseSeconds(s) {
  if (s == null) return 0;
  const m = /([\d.]+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)?\b/i.exec(String(s));
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || 's').toLowerCase();
  return unit.startsWith('m') ? n * 60 : n;
}

/**
 * Seconds for one program item. `lastMinutes` is the cardio minutes logged
 * last time, if any, so a 25 minute elliptical habit reads as 25.
 */
export function estimateSeconds(item, ex, lastMinutes = null) {
  if (ex?.cardio || item?.cardio) {
    const m = num(lastMinutes);
    return (m && m > 0 ? m : CARDIO_DEFAULT_MIN) * 60;
  }
  const sets = Math.max(1, num(item?.sets) || 1);
  const reps = Math.max(1, num(item?.reps) || 1);
  const sides = item?.sides === 'each' ? 2 : 1;
  const hold = parseSeconds(item?.hold);
  const rest = parseSeconds(item?.rest) || SET_REST_SEC;

  if (hold >= LONG_HOLD_SEC) {
    // Each hold stands alone and needs a breather after it.
    const holds = sets * reps * sides;
    return holds * hold + Math.max(0, holds - 1) * rest;
  }
  const perRep = (SLOW_REPS[item?.id] || SEC_PER_REP) + hold;
  const work = sets * reps * sides * perRep;
  const rests = Math.max(0, sets * sides - 1) * rest;
  return work + rests;
}

/** Whole minutes, never less than one. */
export function estimateMinutes(item, ex, lastMinutes = null) {
  return Math.max(1, Math.round(estimateSeconds(item, ex, lastMinutes) / 60));
}

/**
 * The minutes a row shows: his override if he typed one, else the estimate.
 * Returns { mins, src } where src is 'yours' or 'estimate'.
 */
export function minutesFor(item, ex, doc, lastMinutes = null) {
  const o = num(doc?.program?.mins?.[item?.id]);
  if (o != null && o >= 0) return { mins: o, src: 'yours' };
  return { mins: estimateMinutes(item, ex, lastMinutes), src: 'estimate' };
}

/** 4 -> "4 min", 85 -> "1h 25m", 120 -> "2h". */
export function fmtMins(m) {
  const n = Math.max(0, Math.round(num(m) || 0));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
