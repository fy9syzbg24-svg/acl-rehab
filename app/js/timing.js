// How an exercise runs, step by step, and what it costs in minutes.
//
// ONE model for two jobs. The workout player walks the steps; the minutes on
// every row are the same steps added up. They cannot disagree, because there
// is only one place that decides what a set, a hold, a rest or a side switch
// is.
//
// Every program item carries an explicit `timer` mode rather than one being
// guessed from the size of its hold:
//
//   reps    he does the set at his own pace and taps Set done; nothing
//           counts reps for him. A short hold (the 1 s at the top of a
//           bridge) is part of each rep, never counted twice.
//   hold    each hold is timed: the tendon loading, the balance holds.
//   timed   a timed bout of work, optionally paced: the calf pulses.
//   cardio  a duration.
//   manual  the prescription contradicts itself or is missing. The player
//           counts sets he confirms and times nothing it would have to
//           invent.
//
// The shape of a run:
//   get ready 5 s, then for each set, each side: the work.
//   Between sides of the same set: switch sides, 5 s.
//   Between sets, or between holds: rest. Prescribed rest where the program
//   gives one, otherwise REST_DEFAULT_SEC, labeled as a default.
//   No rest after the last unit.
//
// Estimates are estimates and say so. Once he has timed enough comparable
// runs the player's own measurements take over (learnedSeconds); a number he
// types wins over both and lives in program.mins.
//
// Pure functions: nothing here reads the store, so the tests run it against
// fixtures.

import { num } from './util.js';

export const SEC_PER_REP = 3;
export const REST_DEFAULT_SEC = 30;
export const READY_SEC = 5;
export const SWITCH_SEC = 5;
export const CARDIO_DEFAULT_MIN = 20;
export const LONG_HOLD_SEC = 10;
// Kept for older callers: the default rest between sets.
export const SET_REST_SEC = REST_DEFAULT_SEC;

// Runs needed before the learned figure replaces the estimate, and how many
// recent runs it looks at.
export const LEARN_MIN_RUNS = 3;
export const LEARN_WINDOW = 7;

// Movements that are known to be slower than a plain rep. The star excursion
// touches eight targets per rep; the wall squat is a slow slide with a squeeze.
const SLOW_REPS = { pa12: 12, pa16: 8 };

/** "30s", "1s", "2 min", "1.5 min", "45 sec", 30 -> seconds. Anything else -> 0. */
export function parseSeconds(s) {
  if (s == null || s === '') return 0;
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const m = /([\d.]+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)?\b/i.exec(String(s));
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || 's').toLowerCase();
  return unit.startsWith('m') ? n * 60 : n;
}

function sidesOf(item) {
  if (item?.sides === 'each') return ['L', 'R'];
  if (item?.sides === 'left') return ['L'];
  if (item?.sides === 'right') return ['R'];
  return ['B'];
}

/** The item's mode. Explicit on the item; a sensible reading for items that predate it. */
export function timerMode(item, ex) {
  if (item?.timer) return item.timer;
  if (ex?.cardio || item?.cardio) return 'cardio';
  if (!num(item?.sets) && !num(item?.reps)) return 'manual';
  if (parseSeconds(item?.hold) >= LONG_HOLD_SEC) return 'hold';
  return 'reps';
}

/** His timing preferences for one item (program.timer[pid]), or {}. */
export function timerPrefs(doc, pid) {
  const p = doc?.program?.timer?.[pid];
  return p && typeof p === 'object' ? p : {};
}

/**
 * Seconds per rep, INCLUDING any short hold: move, hold, return, the way
 * PhysiApp defines rep duration. His number wins; otherwise a plain rep plus
 * the short hold, or the known slow movements.
 */
export function repSeconds(item, prefs = {}) {
  const own = num(prefs.repSec);
  if (own != null && own > 0) return own;
  const hold = parseSeconds(item?.hold);
  const shortHold = hold > 0 && hold < LONG_HOLD_SEC ? hold : 0;
  return (SLOW_REPS[item?.id] || SEC_PER_REP) + shortHold;
}

/** Rest between units, and whether the program actually said so. */
export function restFor(item, prefs = {}) {
  const prescribed = parseSeconds(item?.rest);
  if (prescribed > 0) return { secs: prescribed, src: 'prescribed' };
  const own = num(prefs.restSec);
  if (own != null && own >= 0) return { secs: own, src: 'yours' };
  return { secs: REST_DEFAULT_SEC, src: 'default' };
}

/**
 * The run, as an ordered list of steps.
 *
 * Step: { kind, side, set, sets, unit, units, secs, estSecs, reps, hold }
 *   kind   ready | reps | hold | work | manual | rest | switch
 *   secs   a timed step's duration; null for a step he completes himself
 *   estSecs what the estimate assumes for a step he completes himself
 *
 * `opts.cardioMin` is the duration target for cardio (last time's minutes, or
 * the default); `opts.prefs` his per-item preferences.
 */
export function buildSteps(item, ex, opts = {}) {
  const prefs = opts.prefs || {};
  const mode = timerMode(item, ex);
  const steps = [];
  const rest = restFor(item, prefs);
  const pace = num(item?.pace) || null;
  // Longer when the player carries straight on from one exercise into the
  // next, so there is time to set up; the estimate always uses READY_SEC.
  const readySec = num(opts.readySec) || READY_SEC;

  if (mode === 'cardio') {
    const m = num(opts.cardioMin);
    const mins = m && m > 0 ? m : CARDIO_DEFAULT_MIN;
    steps.push({ kind: 'ready', secs: readySec });
    steps.push({ kind: 'work', side: 'B', set: 1, sets: 1, secs: Math.round(mins * 60),
                 target: m && m > 0 ? 'last' : 'default' });
    return { mode, steps, rest, pace, targetKnown: true };
  }

  const sets = num(item?.sets);
  const reps = num(item?.reps);
  const sides = sidesOf(item);

  if (mode === 'manual' && !sets && !reps) {
    // No target at all. One open step; the estimate cannot price it.
    steps.push({ kind: 'manual', side: sides.length === 1 ? sides[0] : 'B', set: 1, sets: null,
                 secs: null, estSecs: null, reps: null });
    return { mode, steps, rest, pace, targetKnown: false };
  }

  const S = Math.max(1, sets || 1);
  const R = Math.max(1, reps || 1);
  const hold = parseSeconds(item?.hold);
  const perRep = repSeconds(item, prefs);

  // The units a set is made of, per side.
  const unitsPerSide = mode === 'hold' ? R : 1;
  const plan = [];
  for (let s = 1; s <= S; s++) {
    for (const side of sides) {
      for (let u = 1; u <= unitsPerSide; u++) plan.push({ set: s, side, unit: u });
    }
  }

  steps.push({ kind: 'ready', secs: readySec });
  plan.forEach((p, i) => {
    const base = { side: p.side, set: p.set, sets: S, unit: p.unit, units: unitsPerSide };
    if (mode === 'hold') steps.push({ ...base, kind: 'hold', secs: hold || null, estSecs: hold || null, hold });
    else if (mode === 'timed') steps.push({ ...base, kind: 'work', secs: hold || null, estSecs: hold || null, pace });
    else steps.push({ ...base, kind: mode === 'manual' ? 'manual' : 'reps', secs: null,
                      estSecs: reps ? R * perRep : null, reps: reps || null, hold: hold || null });

    const next = plan[i + 1];
    if (!next) return;
    if (next.set === p.set && next.side !== p.side) {
      steps.push({ kind: 'switch', side: next.side, set: next.set, sets: S, secs: SWITCH_SEC });
    } else {
      steps.push({ kind: 'rest', side: next.side, set: next.set, sets: S, secs: rest.secs, restSrc: rest.src });
    }
  });
  return { mode, steps, rest, pace, targetKnown: !!(sets || reps) };
}

/**
 * Seconds the run is expected to take, or null when it cannot be priced (no
 * target). Includes get ready, switches and rest; never a six hour wait.
 */
export function estimateSeconds(item, ex, lastMinutes = null, prefs = {}) {
  const { steps } = buildSteps(item, ex, { cardioMin: lastMinutes, prefs });
  let total = 0;
  for (const st of steps) {
    const s = st.secs ?? st.estSecs;
    if (s == null) {
      if (st.kind === 'manual' || st.kind === 'reps') return null;
      continue;
    }
    total += s;
  }
  return total;
}

/** Whole minutes, never less than one; null when it cannot be priced. */
export function estimateMinutes(item, ex, lastMinutes = null, prefs = {}) {
  const s = estimateSeconds(item, ex, lastMinutes, prefs);
  return s == null ? null : Math.max(1, Math.round(s / 60));
}

/**
 * What a run's timing record must match to be compared with the current
 * prescription: same mode, sets, reps, sides and hold.
 */
export function rxSignature(item, ex) {
  return [timerMode(item, ex), num(item?.sets) || 0, num(item?.reps) || 0,
    item?.sides || 'both', parseSeconds(item?.hold)].join('|');
}

/**
 * The learned duration, from his own timed runs, or null.
 *
 * `runs` are timing records ({ activeSec, restSec, complete, inaccurate, rx,
 * runId, at }) already collected from entries. Only complete, accurate runs of
 * the same prescription count; quick ticks never carry a timing record, so
 * they never train it. With at least LEARN_MIN_RUNS, the newest LEARN_WINDOW
 * are averaged with the highest and lowest dropped once there are five or
 * more, so one distracted run cannot drag the figure.
 */
export function learnedSeconds(item, ex, runs, prefs = {}) {
  // Cardio's length is his choice each time, not a pace to learn.
  if (timerMode(item, ex) === 'cardio') return null;
  const sig = rxSignature(item, ex);
  const seen = new Set();
  const ok = [];
  for (const r of (runs || []).slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))) {
    if (!r || r.inaccurate || !r.complete || r.rx !== sig) continue;
    if (r.runId && seen.has(r.runId)) continue;
    if (r.runId) seen.add(r.runId);
    // Only his ACTIVE time is learned (Codex audit, 2026-09-14): the rest he
    // took depended on the rest setting at the time, so the current planned
    // rest is added back instead. Changing the rest moves the figure at once.
    const s = num(r.activeSec) || 0;
    if (s > 0) ok.push(s);
  }
  if (ok.length < LEARN_MIN_RUNS) return null;
  let sample = ok.slice(0, LEARN_WINDOW).sort((a, b) => a - b);
  if (sample.length >= 5) sample = sample.slice(1, -1);
  const active = sample.reduce((a, b) => a + b, 0) / sample.length;
  const rest = buildSteps(item, ex, { prefs }).steps
    .filter((st) => st.kind === 'rest').reduce((a, st) => a + (st.secs || 0), 0);
  return { secs: active + rest, active, rest, runs: ok.length, used: sample.length };
}

/**
 * The minutes a row shows, and why.
 *   yours     he typed it (program.mins)
 *   learned   his own timed runs
 *   estimate  the prescription added up
 *   untimed   no target, so no honest figure: mins is null
 */
export function minutesFor(item, ex, doc, lastMinutes = null, runs = null) {
  const o = num(doc?.program?.mins?.[item?.id]);
  if (o != null && o >= 0) return { mins: o, src: 'yours' };
  const learned = runs ? learnedSeconds(item, ex, runs, timerPrefs(doc, item?.id)) : null;
  if (learned) return { mins: Math.max(1, Math.round(learned.secs / 60)), src: 'learned', learned };
  const est = estimateMinutes(item, ex, lastMinutes, timerPrefs(doc, item?.id));
  if (est == null) return { mins: null, src: 'untimed' };
  return { mins: est, src: 'estimate' };
}

/** 4 -> "4 min", 85 -> "1h 25m", 120 -> "2h". */
export function fmtMins(m) {
  const n = Math.max(0, Math.round(num(m) || 0));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** 0:05, 2:00, 12:30. Tabular in the player. */
export function fmtClock(secs) {
  const s = Math.max(0, Math.ceil(num(secs) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** "about 45 min + 1 untimed", for a day's header (short: it shares a line with Start). */
export function fmtDayTotal(list) {
  let mins = 0;
  let untimed = 0;
  for (const m of list) {
    if (m.mins == null) untimed++;
    else mins += m.mins;
  }
  const base = `about ${fmtMins(mins)}`;
  return untimed ? `${base} + ${untimed} untimed` : base;
}
