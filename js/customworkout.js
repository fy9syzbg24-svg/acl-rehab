// The custom workout: a plain interval timer he sets himself (his ask,
// 2026-09-18), for whatever he is asked to do on the day, for example a hold
// of 30 seconds each leg, then 30 seconds of rest, six rounds.
//
// It sits on Today every day, under the first job. He types the times; they
// are one synced setting (`settings.customWorkout`, an `s|` record, so the Mac
// and the phone share it with no registration of its own).
//
// How it runs, in his words:
//   - Every work segment waits for a tap. "Every time I actually start a
//     workout, I'd tap it." When a segment ends and the next is work, the clock
//     shows the next segment's full time and waits, so the seconds it takes to
//     get into position never come off the hold.
//   - Rest starts by itself the moment the work before it ends.
//   - A tone as each segment ends (the same cues as the player, and the same
//     Sound, Buzz, Off choice).
//   - Finished, it is logged as one row on the day.
//
// Three ways to set it: Right and left (default Right, then Left, then Rest, with
// an option for a rest between the sides too), Work and rest (no sides), or Sets
// of reps (2026-09-30, his ask after PT: BFR is 75 reps as 30, 15, 15, 15, and the
// timer only had times). In Sets of reps a set is his pace: it shows the reps and
// waits for his "Set done" tap, never a clock (his rule: reps are never counted
// from time); the rest after it starts by itself. Both legs together, or each leg
// in turn. No rest after the last segment: the workout ends when the work does.
//
// The engine below is pure (every function takes `now`), so dev-custom.js runs
// it against fixtures. The overlay is its own layer on <body>, outside the
// view, so a repaint of Today (a sync, a tick) can never touch a running clock.

import { esc, uid } from './util.js';
import { state, update, ensureDay, flushSave } from './store.js';
import * as A from './player/audio.js';
import { haptic, buzz, hush, speakOn, sayLine, sayLineAt } from './feedback.js';
import { holdFocus, toast } from './components.js';
import { liteMotion } from './motion.js';
import { reducedMotion } from './fold.js';
import { RING_VIEW, RING_R, RING_STROKE, goldEcho, wakeLabel, orbitSeal } from './player/celebrate.js';
import { breathe, beat, pop } from './player/choreo.js';
import { BAND_BY_ID } from '../data/program.js';
import { bandMark } from './ptmark.js';
import * as Live from './player/live.js';

export const CUSTOM_EX = 'custom_workout';
export const SETTING = 'customWorkout';
export const DEFAULT_NAME = 'Custom workout';
export const DEFAULTS = Object.freeze({
  name: DEFAULT_NAME,   // his name for it (2026-09-18, "I'd like to be able to rename it")
  mode: 'sides',        // 'sides' (Right and left) or 'single' (Work and rest)
  right: 30, left: 30, work: 30, rest: 30,
  rounds: 6,
  restBetween: false,   // a rest between the two sides as well
  first: 'R',           // his default: Right, Left, Rest
  // Sets of reps (2026-09-30): his BFR default, 30, 15, 15, 15 (his words, clinic notes 17 Sep).
  reps: Object.freeze([30, 15, 15, 15]),
  legs: 'both',         // 'both' legs together, or 'each' leg in turn (first side from `first`)
  banded: false,        // done with a band (his ask, 2026-09-18)
  band: '',             // its colour, a Theraband id; '' until he picks one
});
const MAX_SECS = 3600;
const MAX_ROUNDS = 50;
const MAX_NAME = 60;
const MAX_SETS = 20;
const MAX_REPS = 500;

/** "30, 15, 15, 15" (or an array) to [30, 15, 15, 15]; null when nothing usable. */
export function parseReps(v) {
  const list = (Array.isArray(v) ? v : String(v ?? '').split(/[^0-9]+/))
    .map((x) => Math.round(Number(x))).filter((n) => Number.isFinite(n) && n >= 1 && n <= MAX_REPS).slice(0, MAX_SETS);
  return list.length ? list : null;
}
export const repsText = (list) => list.join(', ');
export const repsTotal = (list) => list.reduce((t, n) => t + n, 0);

/** A name as typed, tidied: spaces collapsed, cut to length; empty is the default. */
export function cleanName(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim();
  return t || DEFAULT_NAME;
}

/** What a logged run is called: his name for it, else the setup's, else the default. */
export const runName = (e) => cleanName(e?.name || e?.custom?.name);

const intIn = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt;
};

/** His settings, filled from the defaults and kept in range. */
export function readConfig(doc) {
  const s = doc?.settings?.[SETTING] || {};
  return {
    name: cleanName(s.name),
    mode: s.mode === 'single' || s.mode === 'reps' ? s.mode : 'sides',
    right: intIn(s.right, 1, MAX_SECS, DEFAULTS.right),
    left: intIn(s.left, 1, MAX_SECS, DEFAULTS.left),
    work: intIn(s.work, 1, MAX_SECS, DEFAULTS.work),
    // Zero rest is allowed: no rest segments at all.
    rest: intIn(s.rest, 0, MAX_SECS, DEFAULTS.rest),
    rounds: intIn(s.rounds, 1, MAX_ROUNDS, DEFAULTS.rounds),
    restBetween: !!s.restBetween,
    first: s.first === 'L' ? 'L' : 'R',
    reps: parseReps(s.reps) || [...DEFAULTS.reps],
    legs: s.legs === 'each' ? 'each' : 'both',
    banded: !!s.banded,
    band: s.banded && BAND_BY_ID[s.band] ? s.band : '',
  };
}

export const SIDE_NAME = { R: 'Right', L: 'Left' };

/**
 * The segments in order. Work segments carry their side (null for Work and
 * rest); every segment carries its round. No rest after the last work.
 */
export function buildSegments(cfg) {
  if (cfg.mode === 'reps') return repSegments(cfg);
  const segs = [];
  const rest = (round) => { if (cfg.rest > 0) segs.push({ kind: 'rest', side: null, secs: cfg.rest, round }); };
  for (let r = 1; r <= cfg.rounds; r++) {
    const last = r === cfg.rounds;
    if (cfg.mode === 'sides') {
      const [a, b] = cfg.first === 'L' ? ['L', 'R'] : ['R', 'L'];
      segs.push({ kind: 'work', side: a, secs: a === 'R' ? cfg.right : cfg.left, round: r });
      if (cfg.restBetween) rest(r);
      segs.push({ kind: 'work', side: b, secs: b === 'R' ? cfg.right : cfg.left, round: r });
    } else {
      segs.push({ kind: 'work', side: null, secs: cfg.work, round: r });
    }
    if (!last) rest(r);
  }
  return segs;
}

/**
 * Sets of reps: one work segment per set (no clock: `reps`, secs 0), a rest between sets and
 * between the legs. Each work segment is its own round, so the pips count sets; `set` is the
 * set's number on its leg.
 */
function repSegments(cfg) {
  const segs = [];
  const sides = cfg.legs === 'each' ? (cfg.first === 'L' ? ['L', 'R'] : ['R', 'L']) : [null];
  let round = 0;
  sides.forEach((side, si) => {
    cfg.reps.forEach((n, k) => {
      segs.push({ kind: 'work', side, reps: n, secs: 0, set: k + 1, round: ++round });
      const last = si === sides.length - 1 && k === cfg.reps.length - 1;
      if (!last && cfg.rest > 0) segs.push({ kind: 'rest', side: null, secs: cfg.rest, round });
    });
  });
  return segs;
}

/** The run's settings: in Sets of reps the rounds are the sets, on every leg. */
export function runConfig(cfg) {
  if (cfg.mode !== 'reps') return cfg;
  return { ...cfg, rounds: cfg.reps.length * (cfg.legs === 'each' ? 2 : 1) };
}

export const totalSeconds = (cfg) => buildSegments(cfg).reduce((t, s) => t + s.secs, 0);

/** 0:30, 1:05, 10:00. */
export function fmtClock(secs) {
  const s = Math.max(0, Math.ceil(secs - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 45 s, 6 min, 6 min 30 s. */
export function fmtDur(secs) {
  const s = Math.round(secs);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

/** One line for the card: "Right 30 s · Left 30 s · Rest 30 s · 6 rounds". */
export function summaryText(cfg) {
  const bits = [];
  if (cfg.mode === 'reps') {
    bits.push(`${repsText(cfg.reps)} reps`);
    if (cfg.rest > 0) bits.push(`Rest ${cfg.rest} s`);
    bits.push(cfg.legs === 'each' ? `${cfg.first === 'L' ? 'Left' : 'Right'} leg first` : 'Both legs');
    if (cfg.banded) bits.push(cfg.band ? `${BAND_BY_ID[cfg.band].name} band` : 'Band');
    return bits.join(' · ');
  }
  if (cfg.mode === 'sides') {
    const [a, b] = cfg.first === 'L' ? ['L', 'R'] : ['R', 'L'];
    const t = (x) => (x === 'R' ? cfg.right : cfg.left);
    bits.push(`${SIDE_NAME[a]} ${t(a)} s`, `${SIDE_NAME[b]} ${t(b)} s`);
    if (cfg.rest > 0) bits.push(cfg.restBetween ? `Rest ${cfg.rest} s after each side` : `Rest ${cfg.rest} s`);
  } else {
    bits.push(`Work ${cfg.work} s`);
    if (cfg.rest > 0) bits.push(`Rest ${cfg.rest} s`);
  }
  bits.push(`${cfg.rounds} round${cfg.rounds === 1 ? '' : 's'}`);
  if (cfg.banded) bits.push(cfg.band ? `${BAND_BY_ID[cfg.band].name} band` : 'Band');
  return bits.join(' · ');
}

// ------------------------------------------------------------- engine ----
// phase: 'ready' (the clock shows the full time and waits for a tap),
//        'running', 'paused', 'finished'.

export function newRun(cfg, now = Date.now()) {
  cfg = runConfig(cfg);
  const segs = buildSegments(cfg);
  return { runId: uid(), cfg, segs, i: 0, phase: 'ready', startAt: null, left: null,
           done: segs.map(() => false), openedAt: now };
}

export const current = (run) => run.segs[run.i] || null;

/** Seconds left on the current segment. */
export function remaining(run, now) {
  const s = current(run);
  if (!s) return 0;
  if (run.phase === 'running') return Math.max(0, s.secs - (now - run.startAt) / 1000);
  if (run.phase === 'paused') return run.left;
  return s.secs;
}

/** A tap: start a waiting segment, or resume a paused one. */
export function start(run, now) {
  const s = current(run);
  if (!s || s.reps) return false;
  if (run.phase === 'ready') { run.phase = 'running'; run.startAt = now; return true; }
  if (run.phase === 'paused') { run.phase = 'running'; run.startAt = now - (s.secs - run.left) * 1000; run.left = null; return true; }
  return false;
}

/** Sets of reps: his "Set done" on a set that is waiting. The rest after it starts now. */
export function setDone(run, now) {
  const s = current(run);
  if (!s || !s.reps || run.phase !== 'ready') return false;
  run.done[run.i] = true;
  enter(run, run.i + 1, now);
  return true;
}

/** Reps still to do from here (Sets of reps). */
export function repsLeft(run) {
  return run.segs.reduce((t, s, k) => t + (s.reps && k >= run.i && !run.done[k] ? s.reps : 0), 0);
}

export function pause(run, now) {
  if (run.phase !== 'running') return false;
  run.left = remaining(run, now);
  run.phase = 'paused';
  return true;
}

/** Move to segment j. A rest runs straight on from `at`; work waits. */
function enter(run, j, at) {
  run.i = j;
  run.left = null;
  if (j >= run.segs.length) { run.phase = 'finished'; run.startAt = null; return; }
  if (run.segs[j].kind === 'rest') { run.phase = 'running'; run.startAt = at; }
  else { run.phase = 'ready'; run.startAt = null; }
}

/**
 * Advance past every segment that has run out by `now`. A rest that ended
 * while the phone was locked has ended; it starts from the moment its work
 * ended, not from when the page woke. Returns what happened, in order.
 */
export function tick(run, now) {
  const events = [];
  while (run.phase === 'running' && remaining(run, now) <= 0) {
    const s = current(run);
    const endAt = run.startAt + s.secs * 1000;
    run.done[run.i] = true;
    events.push({ type: 'end', index: run.i, seg: s });
    enter(run, run.i + 1, endAt);
    if (run.phase === 'finished') events.push({ type: 'finished' });
  }
  return events;
}

/** Skip the current segment. A skipped work segment does not count as done. */
export function skip(run, now) {
  if (run.phase === 'finished') return false;
  run.done[run.i] = false;
  enter(run, run.i + 1, now);
  return true;
}

/**
 * Back: a work segment that has started goes back to its full time, waiting.
 * Otherwise (waiting, or resting) the work before it comes back, waiting, and
 * no longer counts as done.
 */
export function back(run) {
  const s = current(run);
  if (s && s.kind === 'work' && (run.phase === 'running' || run.phase === 'paused')) {
    run.phase = 'ready'; run.startAt = null; run.left = null;
    return true;
  }
  let j = run.i - 1;
  while (j >= 0 && run.segs[j].kind !== 'work') j--;
  if (j < 0) { if (s) { run.phase = 'ready'; run.startAt = null; run.left = null; } return !!s; }
  for (let k = j; k < run.segs.length; k++) run.done[k] = false;
  run.i = j; run.phase = 'ready'; run.startAt = null; run.left = null;
  return true;
}

/** What he has done: whole rounds, work segments, and the seconds spent. */
export function tally(run) {
  const rounds = run.cfg.rounds;
  let full = 0;
  for (let r = 1; r <= rounds; r++) {
    const works = run.segs.map((s, k) => [s, k]).filter(([s]) => s.kind === 'work' && s.round === r);
    if (works.length && works.every(([, k]) => run.done[k])) full++;
  }
  const workDone = run.segs.filter((s, k) => s.kind === 'work' && run.done[k]).length;
  const workOf = run.segs.filter((s) => s.kind === 'work').length;
  const workSec = run.segs.reduce((t, s, k) => t + (s.kind === 'work' && run.done[k] ? s.secs : 0), 0);
  const restSec = run.segs.reduce((t, s, k) => t + (s.kind === 'rest' && run.done[k] ? s.secs : 0), 0);
  return { rounds: full, of: rounds, workDone, workOf, workSec, restSec };
}

/** The row a finished (or ended and kept) workout logs. */
export function logRow(run, now = new Date()) {
  const t = tally(run);
  const c = run.cfg;
  return {
    id: uid(),
    ex: CUSTOM_EX,
    side: 'B',
    logged: true,
    doneAt: now.toISOString(),
    via: 'custom',
    runId: run.runId,
    name: c.name,
    ...(c.banded && c.band ? { band: c.band } : c.banded ? { bandText: 'Band' } : {}),
    sets: t.rounds,
    ...(c.mode === 'reps' ? { repsBySet: run.segs.filter((x, k) => x.reps && run.done[k]).map((x) => x.reps) } : {}),
    time: Math.round((t.workSec + t.restSec) / 0.6) / 100,   // minutes, to the second
    custom: {
      name: c.name, mode: c.mode, banded: c.banded, band: c.band, right: c.right, left: c.left, work: c.work, rest: c.rest,
      restBetween: c.restBetween, first: c.first,
      ...(c.mode === 'reps' ? { reps: [...c.reps], legs: c.legs } : {}),
      rounds: t.rounds, of: t.of, workDone: t.workDone, workOf: t.workOf,
      workSec: t.workSec, restSec: t.restSec,
    },
  };
}

/** The readout on a logged row: "6 rounds · Right 30 s · Left 30 s · Rest 30 s · 6.5 min". */
export function customChips(e) {
  const c = e?.custom || {};
  const bits = [];
  if (c.mode === 'reps') {
    const done = Array.isArray(e?.repsBySet) ? e.repsBySet : [];
    const of = c.workOf || 0;
    bits.push(of && done.length < of ? `${done.length} of ${of} sets` : `${done.length} set${done.length === 1 ? '' : 's'}`);
    const perLeg = c.legs === 'each' && Array.isArray(c.reps) && done.length === c.reps.length * 2;
    if (done.length) bits.push(`${repsText(perLeg ? done.slice(0, c.reps.length) : done)} reps${perLeg ? ' each leg' : ''}`);
    if (c.rest) bits.push(`Rest ${c.rest} s`);
    const m = Number(e?.time);
    if (Number.isFinite(m) && m > 0) bits.push(fmtDur(m * 60));
    return bits;
  }
  const n = Number(e?.sets ?? c.rounds);
  if (Number.isFinite(n)) {
    // Less than one whole round says what was done instead of "0 of 6 rounds".
    if (n === 0 && c.workDone) bits.push(`${c.workDone} of ${c.workOf} ${c.mode === 'sides' ? 'sides' : 'work intervals'}`);
    else bits.push(c.of && n < c.of ? `${n} of ${c.of} rounds` : `${n} round${n === 1 ? '' : 's'}`);
  }
  if (c.mode === 'sides') {
    const [a, b] = c.first === 'L' ? ['L', 'R'] : ['R', 'L'];
    const t = (x) => (x === 'R' ? c.right : c.left);
    if (t(a)) bits.push(`${SIDE_NAME[a]} ${t(a)} s`);
    if (t(b)) bits.push(`${SIDE_NAME[b]} ${t(b)} s`);
  } else if (c.work) bits.push(`Work ${c.work} s`);
  if (c.rest) bits.push(`Rest ${c.rest} s`);
  const mins = Number(e?.time);
  if (Number.isFinite(mins) && mins > 0) bits.push(fmtDur(mins * 60));
  return bits;
}

/** Save his settings (one record). Only the fields he can set. */
export function saveConfig(patch) {
  update((d) => {
    d.settings ||= {};
    const next = { ...readConfig(d), ...patch };
    d.settings[SETTING] = readConfig({ settings: { [SETTING]: next } });
  });
}


// ------------------------------------------------------------ overlay ----
// Drawn with the workout player's own parts (eyebrow, title, phase row, the
// textured dial with its bezel, the cue bar, the dock), so it reads as the same
// instrument. The dial itself is the tap target: the whole panel, not a button
// beside it, because he taps it from the floor mid position.
//
// Colours keep their one meaning: orange right, blue left, turquoise work with
// no side, the recovery grey for rest, gold only once a round or the workout is
// finished. Calm while it waits, alive while he works (the player's dial states).

const CUES_KEY = 'rehab.player.cues';   // the player's own switch: one choice for every timer
const cuesOn = () => { try { return localStorage.getItem(CUES_KEY) !== 'off'; } catch { return true; } };
const cueMode = () => (cuesOn() ? (A.silentMode() === 'buzz' ? 'buzz' : 'sound') : 'off');

const RING = { size: RING_VIEW, r: RING_R, stroke: RING_STROKE };
RING.c = 2 * Math.PI * RING.r;
const REFILL_MS = 420;

const IC = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6l-8 6 8 6z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l7 6-7 6M13 6l7 6-7 6"/></svg>',
  cues: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  buzz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M17 8.5v7M20 10v4"/></svg>',
};

let O = null;   // the open timer: { run, iso, el, release, raf, timer, wake, ending, logged, onDone }

const segName = (s) => (s ? (s.kind === 'rest' ? 'Rest' : s.side ? SIDE_NAME[s.side] : s.reps ? 'Reps' : 'Work') : '');
const segColour = (s) => (!s ? 'var(--gold)' : s.kind === 'rest' ? 'var(--recovery-ring)'
  : s.side === 'R' ? 'var(--right)' : s.side === 'L' ? 'var(--left)' : 'var(--accent)');

/** Seconds left in the whole workout from here, skipped segments not counted. */
function leftInAll(run, now) {
  if (run.phase === 'finished') return 0;
  return remaining(run, now) + run.segs.slice(run.i + 1).reduce((t, s) => t + s.secs, 0);
}

/**
 * Open the timer for a day. One at a time. `onDone(rowId)` runs after a log,
 * once the timer has closed, so Today can show the new row.
 */
export function openCustomWorkout(iso, { onDone = null } = {}) {
  if (O) return;
  A.prepareAudio();
  // The timer's own lines decode straight after the core ones (B4-2), so its
  // first "Tap to start" is never the device's voice.
  if (speakOn()) { A.preferVoice(['tapstart', 'left-tap', 'right-tap', 'lastround', 'workout-done']); A.loadVoice(); }
  const run = newRun(readConfig(state.data));
  const el = document.createElement('div');
  el.className = 'cw-back';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'cw-title');
  el.innerHTML = shell(run);
  document.body.appendChild(el);
  lockPage();
  O = { run, iso, el, raf: 0, timer: 0, buzzes: [], wake: null, ending: false, logged: null, onDone, working: false,
    roundsShown: 0, pipsHtml: '', beatAt: null, keepLine: false };
  O.release = holdFocus(el, () => askEnd());
  el.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVisible);
  paint();
  // The screen stays on from the moment it opens: he may set the phone down
  // and get into position before the first tap.
  holdWake();
  el.querySelector('[data-cw="dial"]')?.focus({ preventScroll: true });
}

function shell(run) {
  const { size, r, stroke, c } = RING;
  const mid = size / 2;
  return `
  <div class="player cw v3" data-cw-root>
    <div class="p-eyebrow">
      <button class="p-back" data-cw="end" aria-label="End the custom workout">${IC.close}<span>End</span></button>
      <span class="p-count" data-cw-round></span>
      <button class="p-tool cw-cues" data-cw="cues"></button>
    </div>
    <div class="cw-head">
      <span class="cw-pic" aria-hidden="true"><img src="img/custom-workout-4.png" alt="" decoding="async"></span>
      <h2 class="p-title" id="cw-title">${esc(run.cfg.name)}${run.cfg.banded ? bandMark({ band: run.cfg.band, bandText: 'Band' }) : ''}</h2>
    </div>
    <div class="p-pick-dots cw-pips" data-cw-pips aria-hidden="true"></div>
    <div class="p-phaserow" data-cw-phase><span class="p-label" data-cw-label></span><span class="p-side cw-left" data-cw-left></span></div>
    <button class="p-dial cw-dial" data-cw="dial">
      <span class="p-dial__lift" aria-hidden="true"></span>
      <span class="p-dial__grid" aria-hidden="true"></span>
      <span class="p-dial__gold" aria-hidden="true"></span>
      <span class="p-dial__breath" aria-hidden="true"></span>
      <span class="p-dial__glow" aria-hidden="true"></span>
      <span class="p-dial__energy" aria-hidden="true"></span>
      <span class="p-dial__bezel" aria-hidden="true"></span>
      <span class="p-dial__sweep" aria-hidden="true"></span>
      <span class="p-dial__pulse" aria-hidden="true"></span>
      <span class="cw-gutter" aria-hidden="true"></span>
      <span class="p-ring" aria-hidden="true">
        <svg class="p-ringsvg" viewBox="0 0 ${size} ${size}">
          <circle class="p-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>
          <circle class="p-arc" data-cw-arc cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
            stroke-dasharray="${c.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>
        </svg>
        <span class="p-center"><span class="p-num" data-cw-num></span><span class="p-cap" data-cw-cap></span></span>
      </span>
      <span class="cw-gutter" aria-hidden="true"></span>
    </button>
    <div class="p-nextrow"><div class="p-next" data-cw-next></div></div>
    <div class="p-actions static" data-cw-dock></div>
    <div class="sr-only" aria-live="polite" data-cw-live></div>
  </div>`;
}

/** Repaint everything but the clock, in place. Called on every change of state. */
function paint() {
  if (!O) return;
  const { run, el } = O;
  const s = current(run);
  const fin = run.phase === 'finished';
  const root = el.querySelector('[data-cw-root]');
  root.style.setProperty('--cat', segColour(fin ? null : s));
  root.style.setProperty('--cw-arc', fin ? 'var(--gold)' : segColour(s));

  const round = fin ? run.cfg.rounds : s.round;
  const t = tally(run);
  const repsMode = run.cfg.mode === 'reps';
  el.querySelector('[data-cw-round]').textContent = fin
    ? (O.logged ? 'Logged' : 'Finished')
    : repsMode ? `Set ${s.kind === 'rest' ? (run.segs[run.i + 1]?.set || s.round) : s.set} of ${run.cfg.reps.length}`
      : `Round ${round} of ${run.cfg.rounds}`;
  // Rewritten only when they change, so a pip's pop is never cut by the next paint.
  const pips = el.querySelector('[data-cw-pips]');
  const pipsHtml = Array.from({ length: run.cfg.rounds }, (_, k) => {
    const r = k + 1;
    return `<i class="${r <= t.rounds ? 'done' : ''} ${!fin && r === round ? 'on' : ''}"></i>`;
  }).join('');
  if (O.pipsHtml !== pipsHtml) { O.pipsHtml = pipsHtml; pips.innerHTML = pipsHtml; }
  // A round just filled: its pip lands (B4-2).
  for (let r = O.roundsShown + 1; r <= t.rounds; r++) pop(pips.children[r - 1], { scale: 1.35 });
  O.roundsShown = t.rounds;

  const label = el.querySelector('[data-cw-label]');
  const word = fin ? 'Done' : segName(s);
  if (label.textContent !== word && label.textContent !== 'STARTING') label.textContent = word;
  label.classList.toggle('neutral', !fin && s.kind === 'rest');
  el.querySelector('[data-cw-cap]').textContent = fin ? (repsMode ? `${t.workDone} of ${t.workOf} sets` : `${t.rounds} of ${t.of} rounds`)
    : s.reps ? 'reps, tap when done'
      : run.phase === 'ready' ? 'Tap to start'
        : run.phase === 'paused' ? 'Paused' : '';

  // Calm while waiting, alive while working, the player's rule. Kept in step
  // here rather than redrawn, so the change animates.
  const dial = el.querySelector('[data-cw="dial"]');
  const working = !fin && run.phase === 'running' && s.kind === 'work';
  const woke = working && !O.working;
  O.working = working;
  dial.classList.toggle('working', working);
  dial.classList.toggle('waiting', !fin && run.phase === 'ready' && !O.ending);
  dial.classList.toggle('finished', fin);
  const tappable = !fin && !O.ending && (run.phase === 'ready' || run.phase === 'paused');
  dial.setAttribute('aria-disabled', tappable ? 'false' : 'true');
  dial.setAttribute('aria-label', fin ? 'Finished'
    : s.reps ? `${s.reps} reps${s.side ? `, ${word.toLowerCase()}` : ''}. Tap when the set is done`
    : run.phase === 'ready' ? `Start ${word.toLowerCase()}, ${fmtDur(s.secs)}`
      : run.phase === 'paused' ? `Resume ${word.toLowerCase()}` : `${word}, running`);
  if (woke) wake();

  const next = run.segs[run.i + 1];
  el.querySelector('[data-cw-next]').textContent = fin ? ''
    : next?.reps ? `Next · ${next.side ? `${segName(next)}, ` : ''}${next.reps} reps`
    : next ? `Next · ${segName(next)} ${fmtDur(next.secs)}${next.kind === 'work' ? ', on your tap' : ''}`
      : 'Next · finish and log it';

  const mode = cueMode();
  const cues = el.querySelector('[data-cw="cues"]');
  cues.innerHTML = `${mode === 'buzz' ? IC.buzz : IC.cues}<span>${mode === 'sound' ? 'Cues' : mode === 'buzz' ? 'Buzz' : 'Cues off'}</span>`;
  cues.setAttribute('aria-label', mode === 'sound' ? `Countdown cues: sound. Tap for ${A.buzzCan() ? 'buzz' : 'off'}.`
    : mode === 'buzz' ? 'Countdown cues: buzz. Tap to turn off.' : 'Countdown cues: off. Tap for sound.');
  cues.setAttribute('aria-pressed', String(mode !== 'off'));
  cues.classList.toggle('on', mode !== 'off');

  const dock = el.querySelector('[data-cw-dock]');
  const html = dockHtml();
  if (dock.innerHTML !== html) dock.innerHTML = html;
  clock();
  liveSync();
}

// ------------------------------------------------------ Live Activity ----
// The custom workout gets the same Lock Screen and Dynamic Island as every other
// workout (audit P6; 4.8, M5): through player/live.js, so one activity at a time and
// the Settings switch (rt.live.off) are honoured. Only the workout's own words go on it
// (its name, the side, the round, rest), never anything medical.
function liveState() {
  const { run } = O;
  const s = current(run);
  const now = Date.now();
  const fin = run.phase === 'finished';
  const running = run.phase === 'running' && !!s;
  if (run.phase === 'paused') O.livePausedAt = O.livePausedAt || now; else O.livePausedAt = null;
  const next = run.segs[run.i + 1];
  return {
    exercise: run.cfg.name,
    leg: s?.side === 'L' || s?.side === 'R' ? s.side : 'B',
    set: s ? (s.set || s.round) : run.cfg.rounds,
    sets: run.cfg.mode === 'reps' ? run.cfg.reps.length : run.cfg.rounds,
    reps: s?.reps || null,
    phase: fin ? 'done' : run.phase === 'paused' ? 'paused' : run.phase === 'ready' ? 'ready' : s?.kind === 'rest' ? 'rest' : 'work',
    phaseStart: running ? Math.round(run.startAt) : now,
    phaseEnd: running ? Math.round(run.startAt + s.secs * 1000)
      : run.phase === 'paused' ? Math.round(O.livePausedAt + (run.left || 0) * 1000) : null,
    pausedAt: run.phase === 'paused' ? O.livePausedAt : null,
    done: fin ? 1 : 0,
    total: 1,
    next: next ? segName(next) : null,
    accent: Live.hexOf(segColour(fin ? null : s)),
    frameAsset: null,
  };
}

/** The timed segments ahead of a running clock, up to the next work that waits for his tap. */
function livePlan() {
  const { run } = O;
  const s = current(run);
  if (run.phase !== 'running' || !s) return [];
  const step = (x, secs) => ({ kind: x.kind === 'rest' ? 'rest' : 'work', secs: Math.round(secs * 10) / 10,
    exercise: run.cfg.name, leg: x.side === 'L' || x.side === 'R' ? x.side : 'B', set: x.round, sets: run.cfg.rounds, reps: null });
  const out = [step(s, remaining(run, Date.now()))];
  for (let j = run.i + 1; j < run.segs.length; j++) {
    const x = run.segs[j];
    if (x.kind === 'work') { out.push(step(x, 0)); break; }   // work waits for his tap: the plan stops there
    out.push(step(x, x.secs));
  }
  return out;
}

function liveSync() {
  if (!O) return;
  // One activity at a time: a workout left open in the player keeps its activity (and its
  // title), so the custom workout ends that one first and starts its own.
  if (!O.liveReady) O.liveReady = Live.end({ phase: 'paused', pausedAt: Date.now(), phaseEnd: null }, 0).catch(() => {});
  const mine = O;
  O.liveReady = O.liveReady.then(() => {
    if (O !== mine) return;
    const state = liveState();
    if (state.phase === 'done') return;   // finish() ends it
    return Live.sync({ title: O.run.cfg.name, accent: state.accent, state, plan: livePlan() });
  }).catch((err) => console.warn('[cw] live', err));
}

function liveEnd() {
  const run = O?.run;
  if (!run) return;
  const ready = O.liveReady || Promise.resolve();
  // Gold on the Lock Screen only for the whole workout logged (his rule: gold is finishing).
  const fin = run.phase === 'finished' && !!O.logged && tally(run).rounds === run.cfg.rounds;
  const base = { exercise: run.cfg.name, leg: 'B', set: null, sets: null, reps: null, next: null,
    done: fin ? 1 : 0, total: 1, phaseStart: Date.now(), phaseEnd: null, pausedAt: null };
  ready.then(() => (fin ? Live.end({ ...base, phase: 'done' }) : Live.end({ ...base, phase: 'paused', pausedAt: Date.now() }, 0))).catch(() => {});
}

// A Live Activity button (Pause or Next) while the custom workout is open is a press of
// its own control: the dock's main button (start, pause, resume) or Skip.
Live.onCommand((cmd) => {
  if (!O || O.ending || O.run.phase === 'finished' || (cmd !== 'next' && cmd !== 'toggle')) return;
  O.el.querySelector(cmd === 'next' ? '[data-cw="skip"]' : '[data-cw="main"]')?.click();
});

function dockHtml() {
  const { run } = O;
  const s = current(run);
  if (O.ending) {
    const t = tally(run);
    const unit = run.cfg.mode === 'reps' ? 'set' : 'round';
    const what = t.rounds ? `Log ${t.rounds} ${unit}${t.rounds === 1 ? '' : 's'}` : 'Log what you did';
    const said = t.rounds ? `${t.rounds} of ${t.of} ${unit}s done` : `Part of ${unit} 1 done`;
    return `<p class="cw-endq">${said}</p>
      <div class="p-row1 one"><button class="btn big primary" data-cw="log">${IC.check}<span>${esc(what)}</span></button></div>
      <div class="p-row2 two">
        <button class="btn p-link" data-cw="resume">${IC.play}<span>Keep going</span></button>
        <button class="btn p-link" data-cw="discard">${IC.close}<span>Don't log</span></button>
      </div>`;
  }
  if (run.phase === 'finished') {
    return `<div class="p-row1 one"><button class="btn big primary" data-cw="close"><span>Back to Today</span></button></div>`;
  }
  // One control for the tap, its label saying what the tap does (the player's
  // Start, Pause, Resume). The dial above does the same.
  const main = s?.reps
    ? `<button class="btn big primary" data-cw="main">${IC.check}<span>Set done</span></button>`
    : run.phase === 'running'
    ? `<button class="btn big p-pause" data-cw="main">${IC.pause}<span>Pause</span></button>`
    : `<button class="btn big primary ${run.phase === 'ready' ? 'breathing' : ''}" data-cw="main">${IC.play}<span>${
      run.phase === 'ready' ? `Start ${esc(segName(s).toLowerCase())}` : 'Resume'}</span></button>`;
  return `<div class="p-row1 one">${main}</div>
    <div class="p-row2 two">
      <button class="btn p-link" data-cw="back">${IC.prev}<span>Back</span></button>
      <button class="btn p-link" data-cw="skip">${IC.skip}<span>${s?.kind === 'rest' ? 'Skip rest' : 'Skip'}</span></button>
    </div>`;
}

/** The numbers and the arc: every frame while running, once otherwise. */
function clock() {
  if (!O) return;
  const { run, el } = O;
  const s = current(run);
  const now = Date.now();
  const fin = run.phase === 'finished';
  const left = fin ? 0 : remaining(run, now);
  const t = fin ? tally(run) : null;
  const txt = fin ? fmtClock(t.workSec + t.restSec) : s?.reps ? String(s.reps) : fmtClock(left);
  const num = el.querySelector('[data-cw-num]');
  if (num.textContent !== txt) num.textContent = txt;
  num.classList.toggle('long', txt.length > 4);
  const all = el.querySelector('[data-cw-left]');
  const allTxt = fin ? '' : run.cfg.mode === 'reps' ? `${repsLeft(run)} reps left` : `${fmtClock(leftInAll(run, now))} left`;
  if (all.textContent !== allTxt) all.textContent = allTxt;
  beatDown(left);
  if (O.refilling) return;
  const frac = fin || s?.reps ? 1 : s ? left / s.secs : 0;
  el.querySelector('[data-cw-arc]').setAttribute('stroke-dasharray',
    `${(Math.max(0, Math.min(1, frac)) * RING.c).toFixed(2)} ${RING.c.toFixed(2)}`);
}

/**
 * The last three seconds, seen (B4-2, the player's B2-6): as each of 3, 2 and
 * 1 begins the ring beats, with the pips. Only on a step down seen within the
 * same running segment, so coming back to the app mid count never beats late.
 */
function beatDown(left) {
  if (!O) return;
  const { run } = O;
  if (run.phase !== 'running' || document.visibilityState !== 'visible') { O.beatAt = null; return; }
  const key = `${run.i}:${run.startAt}`;
  const n = Math.ceil(left - 1e-6);
  const was = O.beatAt;
  O.beatAt = { key, n };
  if (!was || was.key !== key || n !== was.n - 1 || n < 1 || n > 3) return;
  beat(O.el.querySelector('.p-ring'));
}

function loop() {
  if (!O) return;
  cancelAnimationFrame(O.raf);
  const step = () => {
    if (!O || O.run.phase !== 'running') return;
    advance();
    clock();
    if (O && O.run.phase === 'running') O.raf = requestAnimationFrame(step);
  };
  O.raf = requestAnimationFrame(step);
}

/**
 * Settle the run against the wall clock and act on what happened. The tone for
 * each end was scheduled when the segment started; this starts the next rest's
 * cues, marks a finished round, and finishes.
 */
function advance() {
  if (!O || O.run.phase !== 'running') return;
  const events = tick(O.run, Date.now());
  if (!events.length) return;
  const { run } = O;
  const fin = events.some((e) => e.type === 'finished');
  if (!fin && aheadHolds(run)) {
    // Away, and these edges were laid on the audio clock when he left (layAhead): they
    // have sounded already, so the segments move on quietly here (re-laying them would
    // cut a line mid word). Coming back, or a Live Activity button, lays them again.
    clearTimeout(O.timer);
    if (run.phase === 'running') O.timer = setTimeout(() => { advance(); clock(); }, remaining(run, Date.now()) * 1000 + 30);
    else stopClock();
    paint();
    return;
  }
  const ends = events.filter((e) => e.type === 'end');
  // A round is complete when its last work ends done (never the final round:
  // the finish is its own, bigger moment).
  const roundDone = ends.some((e) => e.seg.kind === 'work' && e.seg.round < run.cfg.rounds && roundComplete(run, e.seg.round)
    && !run.segs.some((x, k) => k > e.index && x.kind === 'work' && x.round === e.seg.round));
  if (fin) { stopClock(); if (cueMode() === 'buzz') buzz('end'); finish(); return; }
  const s = current(run);
  // The line follows the end tone that is sounding now, and the bell when a
  // round closed (the player's rule, B1-4), instead of landing on them. Read
  // before the rest's own cues replace the end tone.
  const bell = roundDone && cueMode() === 'sound';
  const after = A.endToneLeft() + (bell ? A.bellRung() : 0) + 0.05;
  if (run.phase === 'running') {        // a rest that starts by itself
    effects({ carry: true });
    sayLineAt('rest', 'Rest', after);
  } else {                              // work, waiting for his tap
    stopClock();
    // Forced, so a second "Tap to start" in a row is still her voice and never
    // the device's (Work and rest with no rest says it every segment).
    if (s?.reps) sayLineAt('go', 'Go', after);
    else sayLineAt(tapLine(s), `${segName(s)}, tap to start`, after);
    refill();
  }
  if (cueMode() === 'buzz') buzz('end'); else haptic('phase');
  live(`${segName(s)}${s?.reps ? `, ${s.reps} reps` : run.phase === 'ready' ? ', tap to start' : ''}`);
  paint();
  if (roundDone) {
    goldEcho(O.el.querySelector('[data-cw="dial"]'), { label: 'Round complete' });
    // The bell that means a set closed, here a round (the sound map), where cues are heard.
    if (bell) A.goldBell();
  }
}

/** The recorded line for a work segment waiting for his tap. */
// Right and Left are heard from their own side with Stereo sides on (B6-3, audio.js panFor).
const tapLine = (s) => (s?.side === 'R' ? 'right-tap' : s?.side === 'L' ? 'left-tap' : 'tapstart');

/**
 * What the tap that starts work says (B4-2): "Go!" (the side was said as it
 * waited), or "Last round!" on the first work of the final round of several.
 */
function goLine(run, from) {
  const s = current(run);
  const last = from === 'ready' && run.cfg.rounds > 1 && s.round === run.cfg.rounds
    && !run.segs.some((x, k) => k < run.i && x.kind === 'work' && x.round === s.round);
  return last ? ['lastround', 'Last round'] : ['go', 'Go'];
}

/**
 * Seconds from now to the middle of a segment over a minute, or null once it
 * has passed. From the segment's real middle, so a resume or a return to the
 * app places it where it was (the player's halfwayIn).
 */
function halfwayIn(s, left) {
  if (!(s?.secs > 60)) return null;
  const d = left - s.secs / 2;
  return d > 0.05 ? d : null;
}

function roundComplete(run, r) {
  const works = run.segs.map((x, k) => [x, k]).filter(([x]) => x.kind === 'work' && x.round === r);
  return works.length > 0 && works.every(([, k]) => run.done[k]);
}

/**
 * Cues and the end timer for the running segment. `carry` is for a rest that
 * starts by itself: the tone that ended the work is sounding at that moment,
 * and cancelling everything would cut it off, so nothing is cancelled (every
 * cue of the segment before is already in the past).
 */
function effects({ carry = false, ringOut = false } = {}) {
  if (!O) return;
  if (!carry) A.cancelAll({ ringOut });
  clearBuzzes();
  clearTimeout(O.timer);
  O.ahead = null;
  if (O.run.phase !== 'running') { stopBreath(); return; }
  // Round 3, the player's rule (his ask 2026-09-30: cues keep going with the phone locked
  // or in another app): while a segment runs, the app holds the sound awake (silence
  // through the mixing session, and the page's own keep alive), so his music is untouched.
  keepHeld(true);
  const s = current(O.run);
  const left = remaining(O.run, Date.now());
  const mode = cueMode();
  // The coach's lines in a segment, as the player places them (B4-2): gated on
  // the voice switch only, in Sound, Buzz and Off alike. "Halfway there" in a
  // segment over a minute, with the soft tone only where the voice does not
  // say it; "Ten seconds!" in work of 30 s or more.
  const halfIn = halfwayIn(s, left);
  const saidHalf = halfIn != null && speakOn() && A.scheduleVoice('halfway', halfIn);
  if (speakOn() && s.kind === 'work' && s.secs >= 30 && left > 10.5) A.scheduleVoice('ten', left - 10);
  // The end of a work into a rest, and the end of a rest, have their own sounds in a set
  // that has them (the sound map's 'rest' and 'restend'), as in the player.
  if (mode === 'sound') A.scheduleCues(left, { halfwayAt: saidHalf ? null : halfIn, edge: edgeAfter(O.run, O.run.i) });
  else if (mode === 'buzz') {
    // The 3, 2, 1 as taps. The end is buzzed by advance() itself, at the end,
    // so a rest starting straight after can never cancel it.
    for (const k of [3, 2, 1]) {
      const at = left - k;
      if (at > 0.05) O.buzzes.push(setTimeout(() => buzz('tick'), at * 1000));
    }
  }
  // rAF stops in the background; this makes sure the end is acted on.
  O.timer = setTimeout(() => { advance(); clock(); }, left * 1000 + 30);
  if (awayNow()) layAhead(O.run, left);
  watchClock();
  syncBreath(s, left);
  holdWake();
  loop();
}

// ------------------------------------------------------- while he is away ----
// The player's round 3 plan (player.js layAhead), for this timer: when he leaves with a
// segment running, every cue still to come up to the next work (which waits for his tap)
// is laid on the audio clock at once, because the page's timers may sleep: the edge's
// pips and its sound, the bell of a round that closes, "Rest." as a rest begins by itself,
// "Halfway there" in a long rest, and the side's "tap to start" line. Exactly what he
// hears on screen, at the same moments. Nothing is laid past the work that waits for him.

/** Away from the screen in the app, with the app holding the sound. */
const awayNow = () => A.nativeAudio() && document.visibilityState === 'hidden';

/** Which "now" a segment's end is: into a rest, out of one, or plain (audio.js endOf). */
function edgeAfter(run, i) {
  const s = run.segs[i];
  if (!s) return null;
  if (s.kind === 'rest') return 'restend';
  return run.segs[i + 1]?.kind === 'rest' ? 'rest' : null;
}

/** Work segment k, run to its end, closes its round (never the final round: that is the finish). */
function closesRound(run, k) {
  const s = run.segs[k];
  if (!s || s.kind !== 'work' || s.round >= run.cfg.rounds) return false;
  if (run.segs.some((x, m) => m > k && x.kind === 'work' && x.round === s.round)) return false;
  return run.segs.every((x, m) => !(x.kind === 'work' && x.round === s.round) || m === k || run.done[m]);
}

function layAhead(run, left) {
  const heard = cueMode() === 'sound';
  const voice = speakOn();
  let t = left;
  let edgeTail = heard ? Math.max(0, A.endToneLeft() - left) : 0;
  let last = run.i;
  for (let j = run.i + 1; j < run.segs.length; j++) {
    const x = run.segs[j];
    const bell = heard && closesRound(run, j - 1);
    if (bell) A.scheduleBellAhead(t + 0.01);
    const tail = Math.max(edgeTail, bell ? A.bellRung() : 0) + 0.05;
    last = j;
    if (x.kind === 'work') {                 // waits for his tap: said, then nothing more
      if (voice) A.scheduleLineAhead(tapLine(x), t + tail);
      break;
    }
    if (voice) A.scheduleLineAhead('rest', t + tail);        // a rest begins by itself
    if (voice && x.secs > 60) A.scheduleLineAhead('halfway', t + x.secs / 2);
    const end = t + x.secs;
    edgeTail = heard ? Math.max(0, A.scheduleEdgeAhead(end, { edge: edgeAfter(run, j) }) - end) : 0;
    t = end;
  }
  O.ahead = { startAt: run.startAt, i: run.i, last };
}

/** The away plan still covers where the run is: time passing alone needs nothing new. */
function aheadHolds(run) {
  return !!O?.ahead && document.visibilityState === 'hidden' && run.i <= O.ahead.last
    && (run.phase === 'running' || run.phase === 'ready');
}

/**
 * Away in the app WebKit may stop the audio clock; once a second it is started again,
 * and the cues laid again from the real clock (audio.js keepClockAlive), as the player does.
 */
function watchClock() {
  clearInterval(O.clockWatch);
  O.clockWatch = 0;
  if (!awayNow() || O.run.phase !== 'running') return;
  const mine = O;
  O.clockWatch = setInterval(() => {
    if (O !== mine || O.run.phase !== 'running' || !awayNow()) { clearInterval(mine.clockWatch); mine.clockWatch = 0; return; }
    A.keepClockAlive().then((revived) => { if (revived && O === mine && O.run.phase === 'running' && awayNow()) effects({ ringOut: true }); });
  }, 1000);
}

/**
 * The app's hold on the sound: taken while a segment runs, let go a few seconds after
 * the clock stops (a pause, work waiting for his tap), so the lines laid for that moment
 * ("Paused.", "Left leg, tap to start") finish before the app may sleep.
 */
function keepHeld(on) {
  if (!O) return;
  clearTimeout(O.holdOff);
  if (on) { A.holdAwake(true); return; }
  O.holdOff = setTimeout(() => A.holdAwake(false), 3000);
}

/**
 * Rest breathes (B4-2, the player's B2-5): the halo round the bezel, 4 s in
 * and 6 s out, in a running rest with more than 8 s left, in phase with the
 * rest and gone 3.2 s before its end, so the countdown's beats own the last
 * three seconds. Neutral grey. A pause, a skip or the work after it stops it.
 */
let breath = null;
function stopBreath(opts) {
  const b = breath;
  breath = null;
  b?.stop(opts);
}
function syncBreath(s, left) {
  const el = O?.el.querySelector('.p-dial__breath');
  const on = !!el && O.run.phase === 'running' && s?.kind === 'rest' && left > 8;
  // A re-seed replaces it at once (one animation, in phase); anything else fades it.
  stopBreath({ now: on });
  if (on) breath = breathe(el, { elapsed: s.secs - left, remaining: left });
}

function stopClock() {
  if (!O) return;
  cancelAnimationFrame(O.raf);
  clearTimeout(O.timer);
  clearInterval(O.clockWatch);
  O.clockWatch = 0;
  clearBuzzes();
  stopBreath();
  keepHeld(false);
}

function clearBuzzes() {
  for (const t of O?.buzzes || []) clearTimeout(t);
  if (O) O.buzzes = [];
}

/** The next work's full time draws back round the ring (his reset, made visible). */
function refill() {
  const arc = O?.el.querySelector('[data-cw-arc]');
  if (!arc || liteMotion() || reducedMotion() || !arc.animate) return;
  O.refilling = true;
  arc.setAttribute('stroke-dasharray', `${RING.c.toFixed(2)} ${RING.c.toFixed(2)}`);
  try {
    arc.animate([{ strokeDasharray: `0 ${RING.c}` }, { strokeDasharray: `${RING.c} ${RING.c}` }],
      { duration: REFILL_MS, easing: 'cubic-bezier(.2, .8, .2, 1)' })
      .finished.catch(() => {}).then(() => { if (O) { O.refilling = false; clock(); } });
  } catch { O.refilling = false; }
}

/** Saturation Wake, the player's: the label reads STARTING, the sweep goes round. */
function wake() {
  if (!O || reducedMotion()) return;
  wakeLabel(O.el.querySelector('[data-cw-phase]'), segName(current(O.run)));
  const sweep = O.el.querySelector('.p-dial__sweep');
  if (!sweep) return;
  if (liteMotion()) {
    sweep.animate([{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], { duration: 480, easing: 'ease-out' });
  } else {
    sweep.animate([
      { transform: 'translate(-50%, -50%) rotate(-90deg)', opacity: 0 },
      { opacity: 1, offset: 0.15 },
      { opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -50%) rotate(270deg)', opacity: 0 },
    ], { duration: 720, easing: 'cubic-bezier(.45, 0, .2, 1)' });
  }
}

async function holdWake() {
  if (!O || O.wake || O.wakePending || !('wakeLock' in navigator)) return;
  // One request at a time: coming back to the app asked twice before the first
  // answer, both were granted, Close released one and the screen stayed awake
  // on Today (2026-09-22 audit).
  const mine = O;
  mine.wakePending = true;
  try {
    const w = await navigator.wakeLock.request('screen');
    if (O !== mine || mine.wake) { w.release(); return; }
    mine.wake = w;
    w.addEventListener('release', () => { if (mine.wake === w) mine.wake = null; });
  } catch { /* refused (Low Power Mode): the screen may dim, the clock still runs */ }
  finally { mine.wakePending = false; }
}

function dropWake() {
  try { O?.wake?.release(); } catch { /* already gone */ }
  if (O) O.wake = null;
}

function onVisible() {
  if (!O) return;
  if (document.visibilityState === 'hidden') {
    // In the app the cues of the segments to come are laid on the audio clock now,
    // because the page's timers may sleep (the player's round 3 rule).
    if (O.run.phase === 'running' && A.nativeAudio()) { A.resetClockWatch(); effects({ ringOut: true }); }
    return;
  }
  if (document.visibilityState !== 'visible') return;
  // A segment that ended while the phone was locked has ended; a rest that
  // followed it has run from the moment the work ended (tick does this).
  advance();
  if (!O) return;
  // iOS lets the wake lock go whenever the page is hidden; take it back.
  holdWake();
  if (O.run.phase === 'running') effects();
  clock();
}

function live(text) {
  const n = O?.el.querySelector('[data-cw-live]');
  if (n) n.textContent = text;
}

function onClick(ev) {
  const b = ev.target.closest('[data-cw]');
  if (!b || !O) return;
  const k = b.dataset.cw;
  const { run } = O;
  const now = Date.now();
  if (k === 'resume') {
    // Keep going puts him back exactly where he was: a side that was waiting
    // still waits for his tap; one that was running carries on.
    O.ending = false;
    if (run.phase === 'paused' && O.pausedByEnd) { A.unlockAudio(); start(run, now); effects(); }
    O.pausedByEnd = false;
    paint();
    return;
  }
  if (k === 'dial' || k === 'main') {
    if (k === 'dial' && b.getAttribute('aria-disabled') === 'true') return;
    A.unlockAudio();
    // Sets of reps: the tap says the set is done. The rest starts by itself.
    const cur = current(run);
    if (cur?.reps && run.phase === 'ready') {
      setDone(run, now);
      if (cueMode() !== 'buzz') haptic('phase'); else buzz('end');
      if (run.phase === 'finished') { finish(); return; }
      if (run.phase === 'running') { effects(); sayLine('rest', 'Rest', { force: true }); }
      else { sayLine('go', 'Go', { force: true }); refill(); }
      if (run.cfg.mode === 'reps' && cur.round < run.cfg.rounds) goldEcho(O.el.querySelector('[data-cw="dial"]'), { label: 'Set done' });
      paint();
      return;
    }
    if (k === 'main' && run.phase === 'running') {
      pause(run, now);
      stopClock();
      A.cancelAll();
      hush();
      pausedMoment();
      paint();
      return;
    }
    const from = run.phase;
    const seg = current(run);
    if (start(run, now)) {
      if (cueMode() !== 'buzz') haptic('phase');
      // Her voice on the tap that starts work (B4-2). Forced: "Go!" twice
      // running is still said. No count back in on a resume (his call).
      if (seg?.kind === 'work') { const [key, words] = goLine(run, from); sayLine(key, words, { force: true }); }
      effects();
    }
    paint();
    return;
  }
  if (k === 'skip') {
    A.unlockAudio();
    skip(run, now);
    stopClock();
    A.cancelAll();
    if (run.phase === 'finished') { finish(); return; }
    if (run.phase === 'running') effects(); else refill();
    paint();
    return;
  }
  if (k === 'back') {
    back(run);
    stopClock();
    A.cancelAll();
    refill();
    paint();
    return;
  }
  if (k === 'cues') {
    // Sound, Buzz, Off, the player's own switch and its own order (no Buzz where a
    // timer cannot buzz, A.buzzCan). 'through' is
    // a Settings choice and is left alone here.
    const next = { sound: A.buzzCan() ? 'buzz' : 'off', buzz: 'off', off: 'sound' }[cueMode()];
    try { localStorage.setItem(CUES_KEY, next === 'off' ? 'off' : 'on'); } catch { /* per device */ }
    if (next !== 'off' && A.silentMode() !== 'through') A.setSilentMode(next === 'buzz' ? 'buzz' : 'duck');
    if (next === 'buzz') haptic('phase');
    if (next === 'sound' && !A.soundCheck()) toast('<b>Sound is not available here</b><br><span>The clock and labels still show every segment.</span>', 'warn', { key: 'cues-unavailable' });
    if (run.phase === 'running') effects();
    paint();
    return;
  }
  if (k === 'end') { askEnd(); return; }
  if (k === 'log') { O.ending = false; finish(); return; }
  if (k === 'discard' || k === 'close') close();
}

/**
 * The pause is heard and felt as well as seen (B4-2, the player's B1-7): the
 * falling E then C where cues are heard, one tick in Buzz (his finger is on
 * the screen), then "Paused." after the tones.
 */
function pausedMoment() {
  const mode = cueMode();
  if (mode === 'sound') A.schedulePause();
  else if (mode === 'buzz') buzz('tick');
  sayLineAt('paused', 'Paused', 0.24);
}

/** End early: nothing done closes; something done asks whether to log it. */
function askEnd() {
  if (!O) return;
  const { run } = O;
  if (run.phase === 'finished' || O.ending) { if (O.ending) { O.ending = false; paint(); } else close(); return; }
  if (!tally(run).workDone) { close(); return; }
  O.pausedByEnd = run.phase === 'running' && pause(run, Date.now());
  stopClock();
  A.cancelAll();
  hush();
  O.ending = true;
  paint();
  O.el.querySelector('[data-cw="log"]')?.focus({ preventScroll: true });
}

/**
 * Log the run, all of it or what was done when he ended it, then leave. The
 * whole workout gets the player's finish (the seal, then back to Today, never a
 * confirm); a part of one is logged with a line saying so.
 */
async function finish() {
  if (!O || O.logged) return;
  const { run, iso } = O;
  const complete = run.phase === 'finished' && tally(run).rounds === run.cfg.rounds;
  run.phase = 'finished';
  run.startAt = null;
  stopClock();
  // The last segment's end tone is sounding: it rings out (B1-4).
  A.cancelAll({ ringOut: true });
  hush();
  // The whole workout, said the moment it ends and before the save (B4-2). A
  // completion line, so the close after the seal lets it play out. A part of
  // one, logged from End, says nothing.
  if (complete) {
    O.keepLine = true;
    sayLine('workout-done', 'That is the workout', { force: true });
  }
  const t = tally(run);
  if (!t.workDone) { close(); return; }
  const row = logRow(run);
  update(() => { ensureDay(iso).entries.push(row); });
  O.logged = row.id;
  paint();
  try { await flushSave(); } catch { /* the header chip says if it did not save */ }
  if (!O) return;
  // After the save is durable, as the player does: the tones mean "written down".
  if (cueMode() === 'sound') A.scheduleFinish();
  live(`${run.cfg.name} logged, ${customChips(row)[0] || ''}`);
  const onDone = O.onDone;
  if (complete) {
    await orbitSeal({ title: run.cfg.name, ringEl: O.el.querySelector('.p-ring') });
    close();
  } else {
    close();
    toast(`<b>${esc(run.cfg.name)} logged</b><br><span>${esc(customChips(row)[0] || '')}</span>`, 'good', { key: 'cw-logged' });
  }
  onDone?.(row.id);
}

function close() {
  if (!O) return;
  liveEnd();
  stopClock();
  clearTimeout(O.holdOff);
  A.holdAwake(false);
  A.cancelAll();
  hush({ keepCompletion: O.keepLine });
  // Over: the app hands the sound back after the last chime (audio.js waits for it), so
  // his music is untouched and nothing of ours runs in the background (the player's rule).
  A.releaseSession();
  dropWake();
  document.removeEventListener('visibilitychange', onVisible);
  O.release?.();
  unlockPage();
  const el = O.el;
  O = null;
  if (liteMotion() || reducedMotion()) { el.remove(); return; }
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 140);
}

/**
 * Hold the page behind still while the timer is open (2026-09-18, his report
 * from the iPhone: "trying to go back and scroll, it was a little tricky").
 * iOS does not stop the document scrolling for `overflow: hidden` on the body,
 * so a drag on the timer could move Today underneath it, and he came back to a
 * different place. The page is pinned where it was and put back exactly there.
 */
let lockedY = null;
function lockPage() {
  if (lockedY !== null) return;
  lockedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${lockedY}px`;
  b.left = '0';
  b.right = '0';
  document.documentElement.classList.add('cw-open');
}
function unlockPage() {
  if (lockedY === null) return;
  const y = lockedY;
  lockedY = null;
  const b = document.body.style;
  b.position = ''; b.top = ''; b.left = ''; b.right = '';
  document.documentElement.classList.remove('cw-open');
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
}

/** For tests and the shells: is the timer open. */
export const customOpen = () => !!O;
