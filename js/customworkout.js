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
// Two ways to set it: Right and left (default Right, then Left, then Rest, with
// an option for a rest between the sides too), or Work and rest (no sides). No
// rest after the last segment: the workout ends when the work does.
//
// The engine below is pure (every function takes `now`), so dev-custom.js runs
// it against fixtures. The overlay is its own layer on <body>, outside the
// view, so a repaint of Today (a sync, a tick) can never touch a running clock.

import { esc, uid } from './util.js';
import { state, update, ensureDay, flushSave } from './store.js';
import * as A from './player/audio.js';
import { haptic, buzz, say, hush } from './feedback.js';
import { holdFocus, toast } from './components.js';
import { liteMotion } from './motion.js';
import { reducedMotion } from './fold.js';
import { RING_VIEW, RING_R, RING_STROKE, goldEcho, wakeLabel, orbitSeal } from './player/celebrate.js';
import { BAND_BY_ID } from '../data/program.js';
import { bandMark } from './ptmark.js';

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
  banded: false,        // done with a band (his ask, 2026-09-18)
  band: '',             // its colour, a Theraband id; '' until he picks one
});
const MAX_SECS = 3600;
const MAX_ROUNDS = 50;
const MAX_NAME = 60;

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
    mode: s.mode === 'single' ? 'single' : 'sides',
    right: intIn(s.right, 1, MAX_SECS, DEFAULTS.right),
    left: intIn(s.left, 1, MAX_SECS, DEFAULTS.left),
    work: intIn(s.work, 1, MAX_SECS, DEFAULTS.work),
    // Zero rest is allowed: no rest segments at all.
    rest: intIn(s.rest, 0, MAX_SECS, DEFAULTS.rest),
    rounds: intIn(s.rounds, 1, MAX_ROUNDS, DEFAULTS.rounds),
    restBetween: !!s.restBetween,
    first: s.first === 'L' ? 'L' : 'R',
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
  if (!s) return false;
  if (run.phase === 'ready') { run.phase = 'running'; run.startAt = now; return true; }
  if (run.phase === 'paused') { run.phase = 'running'; run.startAt = now - (s.secs - run.left) * 1000; run.left = null; return true; }
  return false;
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
    time: Math.round((t.workSec + t.restSec) / 0.6) / 100,   // minutes, to the second
    custom: {
      name: c.name, mode: c.mode, banded: c.banded, band: c.band, right: c.right, left: c.left, work: c.work, rest: c.rest,
      restBetween: c.restBetween, first: c.first,
      rounds: t.rounds, of: t.of, workDone: t.workDone, workOf: t.workOf,
      workSec: t.workSec, restSec: t.restSec,
    },
  };
}

/** The readout on a logged row: "6 rounds · Right 30 s · Left 30 s · Rest 30 s · 6.5 min". */
export function customChips(e) {
  const c = e?.custom || {};
  const bits = [];
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

const segName = (s) => (s ? (s.kind === 'rest' ? 'Rest' : s.side ? SIDE_NAME[s.side] : 'Work') : '');
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
  const run = newRun(readConfig(state.data));
  const el = document.createElement('div');
  el.className = 'cw-back';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'cw-title');
  el.innerHTML = shell(run);
  document.body.appendChild(el);
  lockPage();
  O = { run, iso, el, raf: 0, timer: 0, buzzes: [], wake: null, ending: false, logged: null, onDone, working: false };
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
  <div class="player cw" data-cw-root>
    <div class="p-eyebrow">
      <button class="p-back" data-cw="end" aria-label="End the custom workout">${IC.close}<span>End</span></button>
      <span class="p-count" data-cw-round></span>
    </div>
    <h2 class="p-title" id="cw-title">${esc(run.cfg.name)}${run.cfg.banded ? bandMark({ band: run.cfg.band, bandText: 'Band' }) : ''}</h2>
    <div class="p-status">${esc(summaryText(run.cfg))}</div>
    <div class="p-pick-dots cw-pips" data-cw-pips aria-hidden="true"></div>
    <div class="p-phaserow" data-cw-phase><span class="p-label" data-cw-label></span><span class="p-side cw-left" data-cw-left></span></div>
    <button class="p-dial cw-dial" data-cw="dial">
      <span class="p-dial__lift" aria-hidden="true"></span>
      <span class="p-dial__grid" aria-hidden="true"></span>
      <span class="p-dial__gold" aria-hidden="true"></span>
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
    <div class="p-sound solo" role="group" aria-label="Sound"><button class="p-tool" data-cw="cues"></button></div>
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
  el.querySelector('[data-cw-round]').textContent = fin
    ? (O.logged ? 'Logged' : 'Finished') : `Round ${round} of ${run.cfg.rounds}`;
  el.querySelector('[data-cw-pips]').innerHTML = Array.from({ length: run.cfg.rounds }, (_, k) => {
    const r = k + 1;
    return `<i class="${r <= t.rounds ? 'done' : ''} ${!fin && r === round ? 'on' : ''}"></i>`;
  }).join('');

  const label = el.querySelector('[data-cw-label]');
  const word = fin ? 'Done' : segName(s);
  if (label.textContent !== word && label.textContent !== 'STARTING') label.textContent = word;
  label.classList.toggle('neutral', !fin && s.kind === 'rest');
  el.querySelector('[data-cw-cap]').textContent = fin ? `${t.rounds} of ${t.of} rounds`
    : run.phase === 'ready' ? 'tap to start'
      : run.phase === 'paused' ? 'paused'
        : s.kind === 'rest' ? 'rest' : '';

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
    : run.phase === 'ready' ? `Start ${word.toLowerCase()}, ${fmtDur(s.secs)}`
      : run.phase === 'paused' ? `Resume ${word.toLowerCase()}` : `${word}, running`);
  if (woke) wake();

  const next = run.segs[run.i + 1];
  el.querySelector('[data-cw-next]').textContent = fin ? summaryText(run.cfg)
    : next ? `Next · ${segName(next)} ${fmtDur(next.secs)}${next.kind === 'work' ? ', on your tap' : ''}`
      : 'Next · finish and log it';

  const mode = cueMode();
  const cues = el.querySelector('[data-cw="cues"]');
  cues.innerHTML = `${mode === 'buzz' ? IC.buzz : IC.cues}<span>${mode === 'sound' ? 'Cues' : mode === 'buzz' ? 'Buzz' : 'Cues off'}</span>`;
  cues.setAttribute('aria-label', mode === 'sound' ? 'Countdown cues: sound. Tap for buzz.'
    : mode === 'buzz' ? 'Countdown cues: buzz. Tap to turn off.' : 'Countdown cues: off. Tap for sound.');
  cues.setAttribute('aria-pressed', String(mode !== 'off'));
  cues.classList.toggle('on', mode !== 'off');

  const dock = el.querySelector('[data-cw-dock]');
  const html = dockHtml();
  if (dock.innerHTML !== html) dock.innerHTML = html;
  clock();
}

function dockHtml() {
  const { run } = O;
  const s = current(run);
  if (O.ending) {
    const t = tally(run);
    const what = t.rounds ? `Log ${t.rounds} round${t.rounds === 1 ? '' : 's'}` : 'Log what you did';
    const said = t.rounds ? `${t.rounds} of ${t.of} rounds done` : `Part of round 1 done`;
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
  const main = run.phase === 'running'
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
  const txt = fin ? fmtClock(t.workSec + t.restSec) : fmtClock(left);
  const num = el.querySelector('[data-cw-num]');
  if (num.textContent !== txt) num.textContent = txt;
  num.classList.toggle('long', txt.length > 4);
  const all = el.querySelector('[data-cw-left]');
  const allTxt = fin ? '' : `${fmtClock(leftInAll(run, now))} left`;
  if (all.textContent !== allTxt) all.textContent = allTxt;
  if (O.refilling) return;
  const frac = fin ? 1 : s ? left / s.secs : 0;
  el.querySelector('[data-cw-arc]').setAttribute('stroke-dasharray',
    `${(Math.max(0, Math.min(1, frac)) * RING.c).toFixed(2)} ${RING.c.toFixed(2)}`);
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
  const ends = events.filter((e) => e.type === 'end');
  // A round is complete when its last work ends done (never the final round:
  // the finish is its own, bigger moment).
  const roundDone = ends.some((e) => e.seg.kind === 'work' && e.seg.round < run.cfg.rounds && roundComplete(run, e.seg.round)
    && !run.segs.some((x, k) => k > e.index && x.kind === 'work' && x.round === e.seg.round));
  if (fin) { stopClock(); if (cueMode() === 'buzz') buzz('end'); finish(); return; }
  const s = current(run);
  if (run.phase === 'running') {        // a rest that starts by itself
    effects({ carry: true });
    say('Rest');
  } else {                              // work, waiting for his tap
    stopClock();
    say(`${segName(s)}, tap to start`);
    refill();
  }
  if (cueMode() === 'buzz') buzz('end'); else haptic('phase');
  live(`${segName(s)}${run.phase === 'ready' ? ', tap to start' : ''}`);
  paint();
  if (roundDone) goldEcho(O.el.querySelector('[data-cw="dial"]'), { label: 'Round complete' });
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
function effects({ carry = false } = {}) {
  if (!O) return;
  if (!carry) A.cancelAll();
  clearBuzzes();
  clearTimeout(O.timer);
  if (O.run.phase !== 'running') return;
  const left = remaining(O.run, Date.now());
  const mode = cueMode();
  if (mode === 'sound') A.scheduleCues(left);
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
  holdWake();
  loop();
}

function stopClock() {
  if (!O) return;
  cancelAnimationFrame(O.raf);
  clearTimeout(O.timer);
  clearBuzzes();
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
  if (!O || O.wake || !('wakeLock' in navigator)) return;
  try {
    const w = await navigator.wakeLock.request('screen');
    if (!O) { w.release(); return; }
    O.wake = w;
    w.addEventListener('release', () => { if (O && O.wake === w) O.wake = null; });
  } catch { /* refused (Low Power Mode): the screen may dim, the clock still runs */ }
}

function dropWake() {
  try { O?.wake?.release(); } catch { /* already gone */ }
  if (O) O.wake = null;
}

function onVisible() {
  if (!O || document.visibilityState !== 'visible') return;
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
    if (k === 'main' && run.phase === 'running') {
      pause(run, now);
      stopClock();
      A.cancelAll();
      hush();
      paint();
      return;
    }
    if (start(run, now)) { if (cueMode() !== 'buzz') haptic('phase'); effects(); }
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
    // Sound, Buzz, Off, the player's own switch and its own order. 'through' is
    // a Settings choice and is left alone here.
    const next = { sound: 'buzz', buzz: 'off', off: 'sound' }[cueMode()];
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
  A.cancelAll();
  hush();
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
  stopClock();
  A.cancelAll();
  hush();
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
