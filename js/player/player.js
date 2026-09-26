// The workout player: one screen for every exercise, on every device.
//
// Opened from Today (one exercise, or "Start" for the day's list in order)
// and from My Program. It renders in the normal document flow under the
// app's own header with the tab bar still there, never as a fixed full-screen
// box (the iOS trap the README records). Navigating away pauses it and keeps
// the draft.
//
// What lives where:
//   engine.js   the state machine and the time buckets (pure, tested)
//   audio.js    cues and the metronome on the audio clock
//   this file   the screen, the controls, the draft, Wake Lock, and saving
//               through logging.js, the same path a tick uses
//
// The draft (localStorage, this device only) is written at every transition,
// on hide, and every few seconds while running. It never goes into the synced
// document; only a confirmed result does.
//
// Controls never change identity (README, design language): Pause and Set
// done sit in the same places for every exercise and phase, with Previous,
// Skip rest and Next beneath; whatever does not apply is dimmed, not removed.

import { loadVideos, mountVideo, videoFor, VIDEO_TAG } from '../videos.js';
import { esc, uid, todayIso, num, fmtDate, toKg, fromKg, round, addDays } from '../util.js';
import { haptic, hapticsOn, buzz, say, sayLine, sayLineAt, cancelPendingLine, speakOn, hush, scheduleBuzzes, cancelBuzzes, hapTaps, hapInput, forwarded, isOff, tapFelt } from '../feedback.js';
import { goldEcho, wakeLabel, orbitSeal, constellation, RING_VIEW, RING_R, RING_STROKE } from './celebrate.js';
import { state, update, ensureDay, getDay, lastEntry, lastCardioMinutes, flushSave, weakenDayPath, saveOutstanding } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, THERABAND, BAND_BY_ID, plannedOn } from '../../data/program.js';
import { CATEGORIES } from '../../data/measurements.js';
import { cueWord } from './cues.js';
import { exerciseById, thumb, openModal, closeModal, toast, actionToast, announce, holdFocus } from '../components.js';
import { dayRing, dayRingItems } from '../dayring.js';
import { fmtClock, fmtMins, timerPrefs, minutesFor, workMinutes } from '../timing.js';
import { itemStatus, saveRun, rowsFingerprint, runsFor, inferCollagen, levelOf, firstAtLevel, neverAtLevel } from '../logging.js';
import { stepsFor, stepLabel, stepHtml, stageOf, currentStep } from '../progressions.js';
import { planStreak, dayComplete } from '../planstreak.js';
import { unseenMilestones, markSeen, markFinishSeen, finishSeen, milestoneSentence, needsSeed } from '../milestones.js';
import * as E from './engine.js';
import * as A from './audio.js';
import { liteMotion } from '../motion.js';
import { pop, roll, beat, stamp, land, flip, breathe, ripple, fly, arrive, lift, swapWord, appear, intro, drawSeg, launch } from './choreo.js';
import * as S from './songs.js';
import { recordBestTests, withGoals } from '../stopwatch.js';
import { anchorFirst, oneTendon } from '../firstup.js';

const ALL_ITEMS = REHAB_PROGRAM.concat(GYM_PROGRAM);
// The name he reads: the program title, else the exercise's own name. Never the
// internal id (the elliptical's receipt said "Logged · elliptical").
const nameOf = (item) => item.title || exerciseById(item.ex)?.name || item.ex;
const ITEM = Object.fromEntries(ALL_ITEMS.map((p) => [p.id, p]));
const DRAFT_KEY = 'rehab.player.v1';
const CUES_KEY = 'rehab.player.cues';
const DRAFT_EVERY_MS = 5000;
export const GAP_HOURS = 6;

// ------------------------------------------------------------- the draft --
// P is the open workout: { run, session: { queue, pos } | null, phase, from,
//   base, reviewStartedWall, savedRunIds, reconcile }
let P = null;
// The session position the workout line last showed (B3-3), so its number rolls
// only when the same list moves on; forgotten when the workout closes.
let countShownAt = null;   // { list, pos }

// Several tabs or windows of the app share one draft (Codex audit B11). Each
// remembers the exact draft text it last read or wrote. When the stored text
// has changed under it, another tab has moved the workout on: this tab adopts
// that draft instead of writing its own stale copy over it, unless this tab is
// the one being used (visible and focused) or is in the middle of saving.
let lastSeenRaw = null;

function rawDraft() {
  try { return localStorage.getItem(DRAFT_KEY); } catch { return undefined; }
}

function parseDraft(raw) {
  try {
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return null;
    d.finishing = false;   // a reload mid-save retries from the review screen
    d.pulseSet = false;    // the set dot pulses for the tap, never for a reload
    d.resumeAt = null;     // nor does a five second count in: its timer is gone
    d.sayOnOpen = null;    // nor the first line of a run that started itself (B1-3)
    d.previewAtRem = null; // a preview line belongs to the clock that scheduled it (B1-5)
    d.holdLine = false;    // a skipped rest's work line waits for the count in (B1-6)
    d.half = null;         // the halfway mark's time is this page's clock, gone on a reload
    d.fullPaintPending = false;   // a reload draws the screen in full anyway (B2-1)
    d.introRun = null;     // the Next up intro plays once, after the push, never on a reload (B3-2)
    d.threadPending = null; // the day thread's segment held back while the seal plays (B3-3)
    d.threadDraw = null;    // and drawn in once, by the render after it lands
    // A draft left running (a crash, a reload, an update, another tab) comes
    // back interrupted. The time since it was last saved is not credited.
    if (d.run?.state === 'running') {
      // Same as a pause for an open hold: keep what he actually held, and
      // start the next bout from zero (audit F03).
      const st = d.run.steps?.[d.run.i];
      if (st?.open && st.kind === 'hold' && d.run.stepMs >= 1000) {
        if (d.run.stepMs >= E.OPEN_MIN_SECS * 1000) {
          (d.run.openTries ||= {})[d.run.i] = [...(d.run.openTries[d.run.i] || []), Math.round(d.run.stepMs / 100) / 10];
        } else {
          // A short bout is kept as E.pause keeps it (2026-09-23 audit): an 8 s
          // hold cut by a reload logged nothing where a Pause logged 8.
          (d.run.openShort ||= {})[d.run.i] = Math.max(d.run.openShort?.[d.run.i] || 0, Math.round(d.run.stepMs / 100) / 10);
        }
        d.run.openRestart = d.run.i;
      }
      d.run.state = 'interrupted';
      d.run.since = null;
      d.run.pausedAtWall = d.savedAtWall || Date.now();
      d.run.pauseReason = 'reload';
    }
    return d;
  } catch {
    return null;
  }
}

function readDraft() {
  const raw = rawDraft();
  lastSeenRaw = raw ?? null;
  return parseDraft(raw);
}

const inUse = () => document.visibilityState === 'visible' && document.hasFocus();

/** Take another tab's newer draft. Returns true if this tab's workout changed. */
function reconcileDraft() {
  if (P?.finishing || saving) return false;
  const raw = rawDraft();
  if (raw === undefined || raw === lastSeenRaw) return false;
  if (P?.run?.state === 'running' && inUse()) return false;   // this tab wins on its next write
  if (P) stopEffects();
  lastSeenRaw = raw;
  P = parseDraft(raw);
  return true;
}

window.addEventListener('storage', (e) => {
  if (e.key !== DRAFT_KEY && e.key !== null) return;
  if (reconcileDraft()) currentRerender?.();
});

// A draft that could not be written (storage full or blocked, Codex audit B12)
// is said on screen, never silently dropped: the workout stays in memory, the
// write is retried at every transition, and Save what I did still logs it.
let draftFailed = false;
function draftFailedNow(failed) {
  if (failed === draftFailed) return;
  draftFailed = failed;
  if (failed) {
    toast('<b>This workout is not being kept on this device</b><br><span>Storage is full or blocked. Keep the app open, or use Save what I did to log it.</span>', 'warn', { key: 'draft-fail', ms: 8000 });
    announce('This workout is not being kept on this device. Storage is full.');
  } else {
    toast('<b>Workout kept on this device again</b>', 'good', { key: 'draft-fail' });
  }
  const slot = document.querySelector('.player [data-slot="status"]');
  if (slot && P?.run) slot.innerHTML = statusLine(P.run);
}

let lastDraftWrite = 0;
function writeDraft() {
  try {
    const stored = rawDraft();
    if (stored !== undefined && stored !== lastSeenRaw && !P?.finishing && !saving && !inUse()) {
      // Another tab moved on meanwhile: never overwrite its draft with ours.
      if (reconcileDraft()) currentRerender?.();
      return;
    }
    if (!P) { localStorage.removeItem(DRAFT_KEY); lastSeenRaw = null; draftFailedNow(false); return; }
    // Fold the running clock in before saving, so a reload loses at most the
    // few seconds since the last write.
    const run = P.run;
    let snapshot = P;
    if (run && run.state === 'running' && run.since != null) {
      const copy = JSON.parse(JSON.stringify(P));
      const now = performance.now();
      const d = Math.max(0, now - run.since);
      copy.run.stepMs += d;
      if (E.step(copy.run)?.kind === 'rest') copy.run.restMs += d; else copy.run.activeMs += d;
      snapshot = copy;
    }
    const raw = JSON.stringify({ ...snapshot, v: 1, savedAtWall: Date.now() });
    localStorage.setItem(DRAFT_KEY, raw);
    lastSeenRaw = raw;
    lastDraftWrite = Date.now();
    draftFailedNow(false);
  } catch {
    // Storage full or blocked: the workout still runs, and he is told.
    lastDraftWrite = Date.now();
    draftFailedNow(true);
  }
}

function clearDraft() {
  S.stopSong();
  P = null;
  dropWake();
  countShownAt = null;
  try {
    // Only this tab's own draft: one another tab wrote since is left alone.
    const stored = rawDraft();
    if (stored === lastSeenRaw || stored === null) { localStorage.removeItem(DRAFT_KEY); lastSeenRaw = null; }
  } catch { /* nothing to do */ }
  draftFailedNow(false);
}

P = readDraft();

// Which songs this device can play; the player repaints once it knows.
S.loadSongs().then(() => { if (P?.phase === 'run') refresh(); });

export function hasDraft() { reconcileDraft(); return !!P; }
export function draftInfo() {
  reconcileDraft();
  if (!P) return null;
  const item = ITEM[P.run?.pid];
  const run = P.run;
  // Where the open workout is, for Today's status line.
  let where = '';
  if (P.phase === 'between' && P.session) {
    const nx = ITEM[P.session.queue[P.session.pos]];
    return { iso: P.session.iso, pid: nx?.id, title: nx?.title || nx?.ex, session: true, phase: 'between',
             where: `${P.session.pos + 1} of ${P.session.queue.length}`, pausedAt: null };
  }
  if (P.phase === 'done') return { iso: run?.iso, pid: run?.pid, title: item?.title, session: !!P.session, phase: 'done', where: 'finished', pausedAt: null };
  if (run) {
    if (run.state === 'review') where = 'ready to save';
    else {
      const st = E.step(run);
      const work = st && (E.WORK.has(st.kind) ? st : run.steps.slice(run.i).find((x) => E.WORK.has(x.kind)));
      if (work) {
        where = run.mode === 'hold' && work.units > 1 ? `hold ${work.unit} of ${work.units}`
          : run.mode === 'cardio' || !run.targetKnown ? '' : `set ${work.set} of ${work.sets}`;
        if (work.side === 'L' || work.side === 'R') where += `${where ? ', ' : ''}${work.side === 'L' ? 'left' : 'right'}`;
      }
    }
  }
  return {
    iso: run?.iso, pid: run?.pid, title: item?.title || item?.ex, session: !!P.session,
    phase: P.phase, state: run?.state, where, pausedAt: run?.pausedAtWall || null,
  };
}
/** True while a workout is open and not finished: the service worker must not reload. */
export function playerBusy() {
  return !!P && P.phase !== 'done';
}

function cuesOn() {
  try { return localStorage.getItem(CUES_KEY) !== 'off'; } catch { return true; }
}

// ---------------------------------------------------------- the queue ----
/** The day's planned items in Today's order: anything marked first leads. */
export function plannedItems(doc, iso) {
  const all = ALL_ITEMS.filter((p) => plannedOn(doc, p.id, iso));
  return all.filter((p) => p.first).concat(all.filter((p) => !p.first));
}

/** What Start runs: planned, not done, not "not yet". */
/**
 * Where the player logs a day's workout (his call, 2026-09-18): a future day's
 * plan can be started as a shortcut, and what it logs goes on TODAY, so it never
 * reads as something done next Wednesday. Today and past days log to themselves
 * (catching up). Ticks on a future page still log to that page's date.
 */
export const logDateFor = (iso) => (iso > todayIso() ? todayIso() : iso);

/** The plan of `iso`, less what is already done on `logIso` (the day it logs to). */
export function workoutQueue(doc, iso, logIso = iso) {
  const entries = doc.days?.[logIso]?.entries || [];
  return plannedItems(doc, iso)
    .filter((p) => !p.notYet && itemStatus(p, entries).state !== 'done')
    .map((p) => p.id);
}

/**
 * When the rest of the day's work may start: six hours after the tendon
 * loading was CONFIRMED. Null when it is not done, or was logged without a
 * time (old rows): no precise time is ever invented.
 */
export function readyAfter(doc, iso) {
  // Either tendon loading: the one he finished first that day (firstup.js).
  const first = anchorFirst(doc, iso);
  if (!first) return null;
  const rows = (doc.days?.[iso]?.entries || []).filter((e) => e.pid === first.id && e.logged && e.doneAt);
  if (!rows.length) return null;
  const t = Math.max(...rows.map((e) => Date.parse(e.doneAt)).filter((x) => !Number.isNaN(x)));
  if (!Number.isFinite(t)) return null;
  const hours = parseFloat(first.gap) || GAP_HOURS;
  return new Date(t + hours * 3600 * 1000);
}

export function fmtTime12(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ------------------------------------------------------------ opening ----
function newRun(pid, iso, opts = {}) {
  const item = withGoals(state.data, ITEM[pid], iso);
  const ex = exerciseById(item.ex);
  const last = ex?.cardio ? lastCardioMinutes(item.ex) : null;
  return E.createRun({ item, ex, iso, prefs: timerPrefs(state.data, pid), cardioMin: last, runId: `run-${uid()}`, readySec: opts.readySec });
}

// Carrying straight on to the next exercise gives this long to set up.
const NEXT_READY_SEC = 10;

function open(ctx, next) {
  P = next;
  writeDraft();
  ctx.playerFrom = ctx.view === 'player' ? (ctx.playerFrom || 'today') : ctx.view;
  ctx.go('player');
}

/**
 * One tap to go (B1-3, 2026-09-23). Start on Today used to open a paused ready
 * screen that needed a second Start. A NEW run now starts itself: a 10 s get
 * ready, so he can put the phone down, already counting when the player opens,
 * and its first line is said once the player is on screen. Never for a run
 * that is reopened or resumed, and never when the first exercise plays one of
 * his songs: iOS lets a song start only inside a tap, so that one keeps its
 * ready screen and its Start. Nothing is credited during a get ready.
 */
function autoStartable(pid) {
  return document.visibilityState === 'visible' && !wouldPlaySong(pid);
}
function newAutoRun(pid, iso) {
  const run = newRun(pid, iso, { readySec: NEXT_READY_SEC });
  E.start(run, performance.now(), Date.now());
  return run;
}

/** One exercise, from a row. An open workout for something else is kept, not lost. */
export function startExercise(ctx, pid, planIso = ctx.date || todayIso()) {
  const iso = logDateFor(planIso);
  if (P && P.run?.pid === pid && P.run?.iso === iso && P.phase !== 'done') { ctx.go('player'); return; }
  if (P && playerBusy() && E.summary(P.run).anyDone) {
    toast('<b>Finish or close the open workout first</b><br><span>It is waiting under Resume.</span>', 'warn');
    ctx.go('player');
    return;
  }
  // One exercise opened from a row still carries on into the rest of the day
  // afterwards (his ask, 2026-09-14: "entice me to continue working out").
  // The first job (the tendon loading) is never rolled into from another
  // exercise: it opens the day, and the rest waits six hours after it.
  const queue = [pid, ...workoutQueue(state.data, planIso, iso).filter((x) => x !== pid && !ITEM[x]?.first)];
  const auto = autoStartable(pid);
  const run = auto ? newAutoRun(pid, iso) : newRun(pid, iso);
  // A run that starts itself gets the Next up intro (B3-2), as a carried on one does.
  open(ctx, { run, session: { queue, pos: 0, iso, planIso }, phase: 'run', base: rowsFingerprint(getDay(iso), pid), savedRunIds: [],
              sayOnOpen: auto ? run.runId : null, introRun: auto ? run.runId : null });
}

/** The day's list in order, skipping what is done. */
export function startWorkout(ctx, planIso = ctx.date || todayIso()) {
  if (P && playerBusy()) { ctx.go('player'); return; }
  const iso = logDateFor(planIso);
  const queue = workoutQueue(state.data, planIso, iso);
  if (!queue.length) { toast('<b>Nothing left to do today</b>'); return; }
  const auto = autoStartable(queue[0]);
  const run = auto ? newAutoRun(queue[0], iso) : newRun(queue[0], iso);
  open(ctx, { run, session: { queue, pos: 0, iso, planIso }, phase: 'run',
              base: rowsFingerprint(getDay(iso), queue[0]), savedRunIds: [],
              sayOnOpen: auto ? run.runId : null, introRun: auto ? run.runId : null });
}

export function resumePlayer(ctx) {
  reconcileDraft();
  if (!P) return;
  ctx.playerFrom = ctx.view === 'player' ? (ctx.playerFrom || 'today') : ctx.view;
  ctx.go('player');
}

// ------------------------------------------------------------- launch ----
/**
 * Launch (B3-6, the lead's headline for the night): when he taps Start workout,
 * Resume or a row's Begin on Today, Today's day ring grows into the workout
 * dial as the player opens. Today's pointerdown notes the ring's rect and when
 * (setLaunchFrom, the one thing its tap measures); the player's first paint
 * within 1500 ms of it, with the ring then on screen, plays the launch once.
 * Never on a reload or a draft reopened by itself: only a tap sets it. Visual
 * only: the voice, the pips and the get ready run as they always do.
 */
let launchFrom = null;   // { rect: { left, top, width, height }, at }
export function setLaunchFrom({ rect, at } = {}) {
  launchFrom = rect && rect.width > 0 ? { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, at } : null;
}
/** The stored launch if it is fresh and the ring was fully on screen (below the header, above the tab bar); taken once. */
function takeLaunch() {
  const L = launchFrom;
  launchFrom = null;
  if (!L || performance.now() - L.at > 1500) return null;
  const head = document.querySelector('.mtop, .topbar')?.getBoundingClientRect();
  const tabs = document.getElementById('mtabs')?.getBoundingClientRect();
  const bottom = tabs && tabs.height && tabs.top > window.innerHeight / 2 ? tabs.top : window.innerHeight;
  const r = L.rect;
  const on = r.top >= Math.max(0, head?.bottom || 0) - 2 && r.top + r.height <= bottom + 2 && r.left >= 0 && r.left + r.width <= window.innerWidth;
  return on ? L : null;
}
/**
 * FLIP the persistent dial from where Today's ring was (read in the next frame,
 * never in the tap): its ring's centre onto the ring's, its diameter onto the
 * ring's. The page's own fade up is cancelled for it (only the player moves,
 * and Today is already gone), and the rest of the screen rises in groups, in
 * the order he reads it. Lite keeps the page's fade and scales the dial in.
 */
function playLaunch(player, L) {
  requestAnimationFrame(() => {
    const dial = player?.querySelector('.p-dial');
    const ring = dial?.querySelector('.p-ring');
    if (!dial?.isConnected || !ring) return;
    if (liteMotion()) { launch(dial, null); return; }
    const view = player.parentElement;
    for (const a of view?.getAnimations?.() || []) if (a.effect?.target === view) a.cancel();
    const d = dial.getBoundingClientRect();
    const r = ring.getBoundingClientRect();
    if (!r.width) return;
    const s = L.rect.width / r.width;
    const D = [d.left + d.width / 2, d.top + d.height / 2];
    const Rp = [r.left + r.width / 2, r.top + r.height / 2];
    const T = [L.rect.left + L.rect.width / 2, L.rect.top + L.rect.height / 2];
    const q = (sel) => [...player.querySelectorAll(sel)];
    launch(dial, { s, dx: T[0] - D[0] - s * (Rp[0] - D[0]), dy: T[1] - D[1] - s * (Rp[1] - D[1]) }, [
      q('.p-eyebrow, .p-stage > .p-content > .p-swipe > .p-title, .p-pick'),
      q('.p-status, .p-levelrow, .p-img, .p-photonote'),
      q('.p-phaserow'),
      q('.p-nextrow, .p-now, .p-sound'),
      q('.p-actions'),
    ]);
  });
}

/** The shells call this when he leaves the player's tab: pause, keep the draft. */
export function playerLeaving() {
  if (!P?.run) return;
  // A pending count in would otherwise resume the run in the background after
  // he had left (review, 2026-09-16). He comes back to a paused run instead.
  clearResumeCountdown();
  if (P.run.state === 'running') E.pause(P.run, performance.now(), Date.now(), 'left');
  stopEffects();
  // Off the player means the screen may sleep, even from a finish or between
  // screen where the workout still counts as under way (2026-09-23 audit).
  dropWake();
  writeDraft();
}

// ------------------------------------------------------------ effects ----
let wake = null;
let wakeState = 'off';   // on | off | unavailable | denied | lost
let tickTimer = null;
let lastTick = 0;
let currentRerender = null;

let wakePending = false;
let wakeGen = 0;   // bumped by dropWake, so a lock that lands after a drop is let go

async function holdWake() {
  if (wake || wakePending) return;
  if (!('wakeLock' in navigator)) { wakeState = 'unavailable'; paintWake(); return; }
  // One request at a time (2026-09-23 audit, the custom workout's 22 Sep fix):
  // Start's tap and the player opening both asked, both were granted, only one
  // was kept, and the other held the screen on after the workout ended.
  wakePending = true;
  const gen = wakeGen;
  try {
    const w = await navigator.wakeLock.request('screen');
    if (wake || gen !== wakeGen) { try { w.release(); } catch { /* gone */ } return; }
    wake = w;
    wakeState = 'on';
    w.addEventListener('release', () => {
      if (wake !== w) return;
      wake = null;
      wakeState = P?.run?.state === 'running' ? 'lost' : 'off';
      paintWake();
    });
  } catch {
    // Refused (Low Power Mode, a browser setting): said as refused, and asked
    // again at the next tap on a control while the workout runs (syncEffects).
    wakeState = 'denied';
  } finally { wakePending = false; }
  paintWake();
}

function dropWake() {
  wakeGen++;
  if (wake) { try { wake.release(); } catch { /* already gone */ } }
  wake = null;
  wakeState = 'off';
}

function paintWake() {
  const el = document.querySelector('[data-p-wake]');
  if (!el) return;
  // The words follow the real state (Codex audit W01): while the workout runs
  // it never says "while paused".
  const text = wakeText();
  el.dataset.state = wakeState;
  if (el.title !== text) el.title = text;
  if (el.getAttribute('aria-label') !== text) el.setAttribute('aria-label', text);
  const note = el.querySelector('.p-wake-note');
  const words = wakeNote();
  if (note && note.textContent !== words) note.textContent = words;
}

/** Stop the clock's own effects: the tick, scheduled cues, the arc, the wake lock. */
function stopClock() {
  stopArc();
  stopBreath();
  clearTimeout(tickTimer);
  tickTimer = null;
  // A tone already sounding rings out (B1-4): the save that follows the last
  // hold's end used to clip its end tone.
  A.cancelAll({ ringOut: true });
  // The buzzes are ordinary timers and only syncEffects used to clear them, so
  // leaving mid hold still buzzed on Today (review, 2026-09-16).
  cancelBuzzes();
}

/**
 * The screen stays awake for as long as a workout is under way (his report,
 * 23 Sep: the phone auto-locked mid tendon loading). iOS grants the wake lock
 * only inside a tap, so once held it is kept through get ready, the count back
 * in, the save and the move to the next exercise, where no tap comes, and let
 * go only on a real pause, on leaving, or at the end.
 */
function workoutUnderWay() {
  const run = P?.run;
  if (!run) return false;
  return run.state === 'running' || run.state === 'review' || P.phase === 'between' || !!P.resumeAt || !!P.finishing;
}

/** From a tap that starts or resumes a workout (Today's Start, Resume, Begin): ask while iOS allows it. */
export function keepAwakeFromTap() {
  if (!wake) holdWake();
}

function stopEffects() {
  stopClock();
  if (!workoutUnderWay()) dropWake();
  if (P) P.songPos = S.songPosition() || P.songPos || 0;
  S.pauseSong();
}

/** Start or stop everything that belongs to a running clock. */
function syncEffects() {
  A.cancelAll({ ringOut: true });
  cancelBuzzes();
  if (P) P.previewAtRem = null;   // any preview was one of the cues just cancelled
  // So was the halfway mark: said already if its moment has passed, otherwise
  // placed again below from the step's real middle.
  if (P?.half?.at != null) P.half = performance.now() >= P.half.at ? { key: P.half.key, done: true } : null;
  const run = P?.run;
  if (!run || run.state !== 'running' || P.phase !== 'run') {
    // Keep playing carries the music over the save and the screen between
    // exercises, so momentum is not lost while the next one opens.
    // So does the five second count in after Skip rest: the run is paused for
    // it, but the rest he skipped was still inside the music.
    if (run && songFor(run.pid) && songThroughOn(run.pid) && (run.state === 'review' || P.phase === 'between' || (run.state === 'paused' && P.resumeAt))) {
      stopClock();
      return;
    }
    stopEffects();
    return;
  }
  holdWake();
  const now = performance.now();
  const st = E.step(run);
  const rem = E.remainingSec(run, now);
  syncBreath(run, st, rem);
  // "Halfway there" in a step over a minute, in Sound, Buzz and Off like "Ten
  // seconds" (B1-4): the voice is gated on the Coach voice switch only. The
  // soft tone marks the middle only where the voice does not.
  const halfIn = halfwayIn(run, st, rem);
  const saidHalf = halfIn != null && speakOn() && A.scheduleVoice('halfway', halfIn);
  if (cuesOn() && rem != null) {
    // Three pips before EVERY transition, then the tone (his ask, 2026-09-16:
    // "I hear a single beep at each transition, I want the three beeps leading
    // up to each transition, not just beginning and end"). This used to give a
    // continuous exercise one tone per switch and the countdown only before its
    // very end, which is exactly what he heard in the tendon loading.
    //
    // Buzz mode is felt and never heard: it vibrates INSTEAD of beeping.
    // An open hold has no end to count down to: one tone as he reaches the goal,
    // and it carries on.
    if (st?.open) {
      // Reaching the goal of an open hold: the voice says so, or one tone.
      const said = speakOn() && rem > 0.05 && A.scheduleVoice('goal', rem);
      if (rem > 0.05 && !said && A.silentMode() !== 'buzz') A.scheduleSwitch(rem);
      if (rem > 0.05) scheduleBuzzes(rem);
    } else {
    if (A.silentMode() !== 'buzz') A.scheduleCues(rem, { halfwayAt: saidHalf ? null : halfIn });
    // A buzz at every one of those moments, always (2026-09-16, item 5). No web
    // API can tell the app the phone is on Silent, so the only way to make sure
    // he gets the cue on Silent is to vibrate every time. With the ring on he
    // hears it and feels it.
    scheduleBuzzes(rem);
    }
    // Get ready used to add its own count in (B2) on top of these, so since
    // three pips came before EVERY transition (2026-09-16) each get ready pip
    // was two tones at once (2026-09-22 audit). The pips above are the count in.
  }
  // "Ten seconds" in a timed step of 30 s or more (the recorded voice, 2026-09-23).
  if (speakOn() && rem != null && !st?.open && E.WORK.has(st?.kind) && (st.secs || 0) >= 30 && rem > 10.5) A.scheduleVoice('ten', rem - 10);
  schedulePreview(run, st, rem);
  if (st?.kind === 'work' && run.pace && metronomeOn(run.pid) && rem != null) A.startMetronome(run.pace, rem);
  // His song plays through the work bouts and waits, where it stopped,
  // through rest and pause. With Keep playing on it carries on through rest,
  // side switches and get ready too. The queue always moves on when a track
  // ends (2026-09-14, revision 3), and Skip is always there.
  const song = songFor(run.pid);
  const through = !!song && songThroughOn(run.pid);
  if (song) S.setQueue(songsAtPace(run.pid), (t) => { if (P) { P.songSha = t.sha; P.songPos = 0; writeDraft(); paintNow(); } });
  if (song && (st?.kind === 'work' || through)) {
    const token = S.playTokenNow();
    const pid = run.pid;
    S.prepareSong(song, P.songPos).then((ok) => {
      // Re-check after the load: paused, closed, another exercise, or music off.
      if (!ok || token !== S.playTokenNow() || !P?.run || P.run.pid !== pid || !songFor(pid)) return;
      if (P.run.state === 'running' && (through || E.step(P.run)?.kind === 'work')) S.playSong();
    });
  } else {
    if (P) P.songPos = S.songPosition() || P.songPos || 0;
    S.pauseSong();
  }
  lastTick = now;
  clearTimeout(tickTimer);
  tickTimer = setTimeout(loop, 200);
  startArc();
}

/**
 * Seconds from now to the middle of a timed step over a minute, or null. From
 * the step's real middle and once per step (review, 2026-09-23): placed at half
 * the time LEFT, every syncEffects moved it, so a +30 s or unlocking the phone
 * in a rest said "Halfway there" a second time, most of the way through.
 */
function halfwayIn(run, st, rem) {
  if (!P || rem == null || st?.open || !(st?.secs > 60)) return null;
  const key = `${run.runId}:${run.i}`;
  if (P.half?.key === key && P.half.done) return null;
  const delay = rem - st.secs / 2;
  if (!(delay > 0.05)) { P.half = { key, done: true }; return null; }
  P.half = { key, at: performance.now() + delay * 1000 };
  return delay;
}

/**
 * Rest breathes (B2-5): a slow halo round the bezel, four seconds in and six
 * out, only in a running rest with more than 8 s left, and gone 3.2 s before
 * its end so the countdown's beats own the last three seconds. Seeded from the
 * rest's own elapsed time on every syncEffects (a step change, +30 s, a
 * resume, coming back from the lock screen, a full repaint), so it is always
 * in phase with the rest and never with the page. A pause stops it (stopClock),
 * so a pause never looks like a rest. Neutral grey: no category, gold or green.
 */
let breath = null;
function stopBreath(opts) {
  const b = breath;
  breath = null;
  b?.stop(opts);
}
function syncBreath(run, st, rem) {
  const el = document.querySelector('.player[data-player] .p-dial__breath');
  const on = !!el && P?.phase === 'run' && run.state === 'running' && st?.kind === 'rest' && rem != null && rem > 8;
  // A re-seed replaces the breath at once (one animation, in phase); anything
  // else fades it out.
  stopBreath({ now: on });
  if (on) breath = breathe(el, { elapsed: E.elapsedMs(run, performance.now()) / 1000, remaining: rem });
}

function loop() {
  tickTimer = null;
  const run = P?.run;
  if (!run || run.state !== 'running') return;
  const now = performance.now();
  // 2026-09-15, his call: "Sometimes I'm just holding the phone in my hand and I
  // will just lock it while I'm holding it." A frozen timer used to be treated as
  // an interruption and the run was paused, which was wrong for every way he
  // really trains: a hold with the screen off, a 20 minute elliptical with the
  // phone in a pocket, or a rest while he scrolls something else. Nothing the
  // page can see separates those from putting the phone down, so the clock now
  // runs through it and the steps the engine owns end on their own schedule.
  // If a step finished while he was away, the row says so and he corrects it
  // there, which is where corrections already belong.
  lastTick = now;
  const events = E.tick(run, now, Date.now());
  // An open hold that begins while the app is away (the get ready ran out, the
  // count back in finished, the next exercise started itself) is paused at
  // once, as the hide handler pauses one already running: otherwise the whole
  // time away is logged as a hold and becomes his goal (2026-09-23 audit).
  if (document.visibilityState === 'hidden' && run.state === 'running'
      && E.step(run)?.open && E.step(run)?.kind === 'hold') {
    if (events.length) announceEvents(events, true);
    E.pause(run, now, Date.now(), 'hidden');
    writeDraft();
    syncEffects();
    return;
  }
  if (events.length) {
    announceEvents(events, true);
    writeDraft();
    if (run.state === 'review' && P.phase === 'run' && currentCtx) { finishRun(currentCtx); return; }
    // A step that ended on its own restarts the clock, the cues and the music
    // for the next one, exactly as a tap does (act). Patching the screen alone
    // left the loop stopped: a hold sat at 0:00 until Next was pressed (his
    // report 2026-09-15; broken since the in-place patch of aa962b2).
    syncEffects();
    refresh();
    return;
  }
  if (arcFrame || !paintArcOnce()) paintClock(now);
  if (Date.now() - lastDraftWrite > DRAFT_EVERY_MS) writeDraft();
  tickTimer = setTimeout(loop, 200);
}

/** True when step i is the last bout of its set on its side and every bout of that set is full. */
function setClosed(run, i) {
  const s = run?.steps?.[i];
  if (!s || !E.WORK.has(s.kind) || run.results?.[i]?.full !== true) return false;
  if (s.units != null && s.unit !== s.units) return false;
  return run.steps.every((t, j) => !(E.WORK.has(t.kind) && t.set === s.set && t.side === s.side) || run.results?.[j]?.full === true);
}

/**
 * `natural` is true only from loop(): a timed step that ended by itself. Its
 * end tone is sounding then, so the next step's line waits for it to finish
 * (B1-4) instead of landing on it.
 */
function announceEvents(events, natural = false) {
  const last = events[events.length - 1];
  // "Logged" and "Exercise done!" are said only after the save is durable (F10,
  // B1-4), in savedMoment.
  if (last.type === 'review') { announce('Sets complete. Saving.'); }
  else if (last.type === 'step') {
    // A work step that just ended is a set finished, whether he tapped Set done
    // or a timed hold ran out by itself. Without this the gold wave only ever
    // fired on a tap, so the tendon loading (all timed holds) never got one.
    // Only a set that really RECORDED a result: E.tick and E.setDone write it
    // before they advance, while Next writes nothing and Previous's `from` is
    // the unfinished current step. Without this the gold wave celebrated a set
    // he had skipped or undone (review, 2026-09-16). Tied to the run, so it can
    // never carry over into the next exercise.
    //
    // And only a set that is COMPLETE (review, 2026-09-16): every bout of it
    // recorded as full, so zero reps, a hold stopped early or a tapped out hold
    // get no gold, and a hold exercise with several holds a set celebrates once,
    // when its last hold closes the set, not after every hold.
    if (events.some((ev) => ev.type === 'step' && setClosed(P.run, ev.from))) P.pulseSet = P.run.runId;
    const closed = P.pulseSet === P.run.runId;
    // Felt in Buzz only under a finger (dialMoments): a timer carries no haptic.
    pulseByTap = closed && !natural;
    // A step that ended by itself lands on the ring (B2-6), unless the set it
    // closed plays Gold Echo, which owns the ring's scale then.
    if (natural && !closed) land(document.querySelector('.player[data-player] .p-ring'));
    const kind = E.step(P.run)?.kind;
    announce(phaseLabel(kind));
    // Spoken and felt only when he turned them on (items 5 and 7). The spoken
    // form is a sentence, not the screen's shouting capitals.
    haptic('phase');
    // Skip rest: the work line is said at zero, when the work really starts
    // (B1-6), not at the tap five seconds early.
    if (P.holdLine) { P.holdLine = false; return; }
    const line = stepLine(P.run);
    if (line) {
      // The line follows a tone instead of landing on it (B1-4): the end tone
      // after a natural end, and the bell of a closed set wherever it rings
      // (B2-7), which dialMoments strikes in the same moment (review,
      // 2026-09-23: "rest" began 15 ms into the bell).
      const bell = closed && cuesHeard() ? A.BELL_RUNG : 0;
      const tail = Math.max(natural ? A.endToneLeft() : 0, bell);
      // A tap's line keeps its usual rule (the same line twice running is said once).
      if (tail > 0) sayLineAt(line[0], line[1], tail + 0.05, { force: natural });
      else sayLine(line[0], line[1]);
    }
  }
}

/**
 * The pause is heard and felt as well as seen (B1-7), once the run is paused:
 * a falling E then C where cues are heard, one tick in Buzz, then "Paused."
 * after the tones.
 */
function pausedMoment() {
  if (cuesHeard()) A.schedulePause();
  // In Buzz, one tick; not when the switch under his finger already gave the tap (B6-1).
  else if (cuesOn() && A.silentMode() === 'buzz' && !tapFelt()) buzz('tick');
  sayLineAt('paused', 'Paused', 0.24);
}

/** An exercise starting is not a step change, so its first line is said here. */
function sayStart() {
  const line = P?.run ? stepLine(P.run) : null;
  if (line) sayLine(line[0], line[1], { force: true });
}

/** The work step before step i, or null. */
function prevWork(run, i) {
  for (let j = i - 1; j >= 0; j--) if (E.WORK.has(run.steps[j]?.kind)) return run.steps[j];
  return null;
}

/** What a work step begins, said first: the last set, a new side, or both legs at the start. */
function workPrefix(run, i) {
  const st = run.steps[i];
  const prev = prevWork(run, i);
  if (st.sets > 1 && st.set === st.sets && prev && prev.set !== st.set) return ['lastset', 'Last set'];
  if ((st.side === 'L' || st.side === 'R') && (!prev || prev.side !== st.side)) return st.side === 'L' ? ['left', 'Left leg'] : ['right', 'Right leg'];
  if (!prev && st.side !== 'L' && st.side !== 'R') return ['both', 'Both legs'];
  return null;
}

/**
 * The recorded line for the step just begun, as [keys, words for the fallback].
 * "Next up" and the exercise when a workout moves on; the first exercise just
 * gets ready. A work step says the word on the screen (B1-5, 2026-09-23): the
 * exercise's own cue word ("Balance!", the same word either side of the leg),
 * after the last set, a new side or both legs when one begins ("Left leg.
 * Balance!"). An exercise with no cue word keeps "Go!" or "Hold it!".
 */
function stepLine(run) {
  const st = E.step(run);
  if (!st) return null;
  const k = st.kind;
  if (k === 'ready') return P?.session?.pos > 0 ? [`next-${run.pid}`, 'Get ready'] : ['ready', 'Get ready'];
  if (E.WORK.has(k)) {
    const pre = workPrefix(run, run.i);
    const w = cueWord(exerciseById(ITEM[run.pid]?.ex));
    const cue = w && A.hasVoice(`cue-${w.toLowerCase()}`) ? `cue-${w.toLowerCase()}` : null;
    const keys = [pre?.[0], cue].filter(Boolean);
    if (!keys.length) return k === 'hold' ? ['hold', 'Hold'] : ['go', 'Work'];
    return [keys, [pre?.[1], cue ? w : ''].filter(Boolean)];
  }
  return SPOKEN[k] ? [k === 'switch' ? 'switch' : k, SPOKEN[k]] : null;
}

/**
 * A line ahead of the change it names (B1-5), only where it tells him
 * something: in a rest before a new side or the last set, 6.5 s before the rest
 * ends ("Right leg next", "Last set next", the last set wins), and in a get
 * ready before a one leg exercise ("Left leg first"), after whatever is being
 * said and never on the pips. A cue: a step change or a pause cancels it.
 */
let previewToken = 0;
function schedulePreview(run, st, rem) {
  const token = ++previewToken;
  P.previewAtRem = null;
  if (!speakOn() || rem == null || !(rem > 8)) return;
  const at = run.steps.findIndex((x, j) => j > run.i && E.WORK.has(x.kind));
  if (at < 0) return;
  const nx = run.steps[at];
  let key = null;
  if (st.kind === 'rest') {
    const pre = workPrefix(run, at)?.[0];
    key = pre === 'lastset' ? 'lastset-next' : pre === 'right' ? 'right-next' : pre === 'left' ? 'left-next' : null;
  } else if (st.kind === 'ready' && (nx.side === 'L' || nx.side === 'R')) {
    key = nx.side === 'R' ? 'right-first' : 'left-first';
  }
  if (!key) return;
  const place = (left) => {
    const delay = st.kind === 'rest' ? left - 6.5 : Math.max(left - 5.5, A.speakingLeft() + 0.15);
    if (st.kind === 'ready' && delay > left - 3.6) return;
    if (delay > 0.05 && A.scheduleVoice(key, delay)) P.previewAtRem = Math.round((left - delay) * 10) / 10;
  };
  if (A.hasVoice(key)) { place(rem); return; }
  // Straight after the tap that started the workout the voice may still be
  // decoding: wait for this clip, then place it from the time left, only if
  // nothing has changed the step or the clock since (a newer syncEffects).
  if (!A.audioPending()) return;
  const runId = run.runId;
  const i = run.i;
  A.whenVoiceReady(key, Math.max(0, (rem - 6.5) * 1000)).then((ok) => {
    if (!ok || token !== previewToken || !P?.run || P.run.runId !== runId || P.run.i !== i || P.run.state !== 'running') return;
    const left = E.remainingSec(P.run, performance.now());
    if (left != null) place(left);
  });
}

/**
 * What a step change says out loud. Deliberately not phaseLabel(): that is set
 * in capitals for the screen, and "SWITCH SIDES" read aloud is the same words
 * shouted. "Last set" is added by sayLastSet where the engine knows the count.
 */
const SPOKEN = {
  ready: 'Get ready', reps: 'Work', manual: 'Work', work: 'Work',
  hold: 'Hold', rest: 'Rest', switch: 'Switch sides',
};

document.addEventListener('visibilitychange', () => {
  if (!P?.run) return;
  if (document.visibilityState === 'hidden') {
    // The run keeps going (see loop()). Only the SONG stops, which is his rule
    // from 2026-09-15: a song plays only while the app is on screen, so one can
    // never start playing out loud when he is somewhere else. Cues are left
    // scheduled on the audio clock, which was measured to keep sounding with the
    // screen locked when the app owns the session.
    S.pauseSong();
    // An open hold stops when the app goes away: it counts until Set done, so
    // a locked phone would otherwise record the whole time away as a hold, and
    // that number becomes the goal and a test result (audit F03, 2026-09-19).
    // The engine logs the bout as its own attempt and restarts it from zero.
    if (P.run.state === 'running' && E.step(P.run)?.open && E.step(P.run)?.kind === 'hold') {
      E.pause(P.run, performance.now(), Date.now(), 'hidden');
      syncEffects();
    }
    writeDraft();
  } else {
    // iOS drops the wake lock when the app goes away; refreshing it is not the
    // same as holding a new one (audit F29, 2026-09-19).
    if (P.run.state === 'running') holdWake();
    // Back on screen, the effects follow the run again: the song paused on the
    // way out used to stay off for the rest of the bout, and cues scheduled
    // before the audio clock was suspended could be lost (2026-09-22 audit).
    if (P.run.state === 'running') syncEffects();
    refresh();
  }
});
window.addEventListener('pagehide', () => { if (P) writeDraft(); });

// -------------------------------------------------------------- prefs ----
// Music or metronome, never both (his call, 2026-09-14). Where a pace is
// prescribed, music is the default and the metronome is off; choosing one
// turns the other off. The countdown beeps at the start and end of a set are
// the cues toggle, and play in either mode.
function songPref(pid) {
  const p = timerPrefs(state.data, pid).song;
  if (p === undefined || p === null) return 'shuffle';   // default: music on
  return p;                                               // false = off, or a mode
}
function metronomeOn(pid) {
  if (songOn(pid)) return false;
  return timerPrefs(state.data, pid).metronome === true;
}
function songOn(pid) {
  return !!ITEM[pid]?.pace && songPref(pid) !== false && songsAtPace(pid).length > 0;
}

const LAST_SONG_KEY = 'rehab.player.lastSong';

/** Keep playing through rest, per exercise (program.timer[pid].songThrough). */
function songThroughOn(pid) {
  // On unless he turned it off: his words, "I don't wanna lose momentum".
  return timerPrefs(state.data, pid).songThrough !== false;
}

/** Songs at this exercise's pace. */
function songsAtPace(pid) {
  const pace = ITEM[pid]?.pace;
  return pace ? S.songsNow().filter((x) => !x.bpm || x.bpm === pace) : [];
}

/** Whether this exercise would play one of his songs, with none of songFor's picking. */
function wouldPlaySong(pid) {
  if (!songOn(pid)) return false;
  const pref = songPref(pid);
  return pref === 'shuffle' ? songsAtPace(pid).length > 0 : !!S.songBySha(pref);
}

/**
 * The song this run plays, if he turned songs on and this device has one.
 * "shuffle" picks one at random for each exercise, never the one played last
 * time when there is a choice; the pick stays for the whole run.
 */
function songFor(pid) {
  if (!songOn(pid)) return null;
  const pref = songPref(pid);
  const pool = songsAtPace(pid);
  if (!pool.length) return null;
  if (pref !== 'shuffle') return S.songBySha(pref) || null;
  if (P && P.songSha && pool.some((x) => x.sha === P.songSha)) return S.songBySha(P.songSha);
  let last = null;
  try { last = localStorage.getItem(LAST_SONG_KEY); } catch { /* per device */ }
  const choices = pool.length > 1 ? pool.filter((x) => x.sha !== last) : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  if (P) { P.songSha = pick.sha; P.songPos = 0; }
  try { localStorage.setItem(LAST_SONG_KEY, pick.sha); } catch { /* per device */ }
  return pick;
}

// ------------------------------------------------------------ labels ----
function phaseLabel(kind) {
  return { ready: 'GET READY', reps: 'WORK', manual: 'WORK', work: 'WORK', hold: 'HOLD', rest: 'REST', switch: 'SWITCH SIDES' }[kind] || '';
}
const sideName = (s) => (s === 'L' ? 'Left' : s === 'R' ? 'Right' : '');
const sideTag = (s) => (s === 'L' || s === 'R' ? `<b class="sidetag ${s}">${sideName(s)}</b>` : '');

function fmtSecs(s) {
  if (s == null) return '';
  return s >= 60 && s % 60 === 0 ? `${s / 60} min` : s >= 60 ? fmtClock(s) : `${s} sec`;
}

function nextLine(run) {
  const nx = run.steps[run.i + 1];
  const legOf = (x) => (x.side === 'L' ? ', left leg' : x.side === 'R' ? ', right leg' : '');
  if (!nx) {
    if (run.i >= run.steps.length) return '';
    const s = P.session;
    const item = ITEM[run.pid];
    if (item?.first) return 'Next · log it, then the recovery break';
    const upcoming = s ? s.queue.slice(s.pos + 1).map((id) => ITEM[id]).find(Boolean) : null;
    return upcoming ? 'Next · log it and carry on' : 'Next · log it and finish';
  }
  if (nx.kind === 'rest') return `Next · ${fmtSecs(nx.secs)} rest`;
  if (nx.kind === 'switch') return `Next · ${sideName(nx.side)} leg`;
  if (nx.kind === 'hold') return `Next · hold ${nx.units > 1 ? `${nx.unit} of ${nx.units}` : `${nx.set} of ${nx.sets}`}${legOf(nx)}`;
  if (nx.kind === 'work') return run.mode === 'cardio' ? 'Next · the work' : `Next · set ${nx.set} of ${nx.sets} · ${fmtSecs(nx.secs)}`;
  if (nx.kind === 'reps' && nx.reps != null) return `Next · ${nx.reps} reps · your pace${legOf(nx)}`;
  return `Next · set ${nx.set} of ${nx.sets} · your pace${legOf(nx)}`;
}

/**
 * The Next slot as a tile (B3-1, 2026-09-23). Tiles, never a paragraph, centred
 * under the ring on solid ground:
 *   - a rest or a switch: the coming leg's pill (blue left, orange right, grey
 *     both; the rest's own arc stays neutral) over the set and its size in
 *     large type, "Set 2 of 3" and "12 reps"
 *   - a get ready: the exercise as chips, "3 sets", "12 reps", "Right leg first"
 *   - the last work step, with another exercise to carry on to: Next, its
 *     picture and its full title
 *   - any other work step: the Next line as it always read
 * nextLine() stays the slot's spoken label. Nothing here says "Up next": he does
 * not work in order, and the carry on is a fact of the session, not a ranking.
 */
const legWords = (s) => (s === 'L' ? 'Left leg' : s === 'R' ? 'Right leg' : 'Both legs');
const sideKey = (s) => (s === 'L' || s === 'R' ? s : 'B');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function secsShort(s) {
  if (s == null) return '';
  return s >= 60 && s % 60 === 0 ? `${s / 60} min` : s >= 60 ? fmtClock(s) : `${s} s`;
}
/** The first work step at or after step i. */
const workFrom = (run, i) => run.steps.slice(i).find((x) => E.WORK.has(x.kind)) || null;
/** Which set this is and how big, as two short facts: ["Set 2 of 3", "12 reps"]. */
function setFacts(run, w) {
  if (run.mode === 'cardio') return ['One bout', secsShort(w.secs)];
  if (w.kind === 'hold') {
    const which = w.units > 1 ? `Hold ${w.unit} of ${w.units}` : `Hold ${w.set} of ${w.sets}`;
    return [which, w.open ? `Goal ${w.secs} s` : `${secsShort(w.secs)} hold`];
  }
  const which = `Set ${w.set} of ${w.sets}`;
  if (w.kind === 'work') return [which, secsShort(w.secs)];
  return [which, w.reps != null ? plural(w.reps, 'rep', 'reps') : 'your pace'];
}
/** The next exercise the session carries on to, passing over anything already done. */
function carryOnItem(run) {
  const s = P?.session;
  if (!s || ITEM[run.pid]?.first) return null;
  const entries = getDay(s.iso)?.entries || [];
  const id = s.queue.slice(s.pos + 1).find((x) => ITEM[x] && itemStatus(ITEM[x], entries).state !== 'done');
  return id ? ITEM[id] : null;
}
function nextTile(run) {
  const st = E.step(run);
  const line = `<span class="p-nline">${esc(nextLine(run))}</span>`;
  if (!st) return line;
  if (st.kind === 'rest' || st.kind === 'switch') {
    const w = workFrom(run, run.i);
    if (!w) return line;
    const [which, size] = setFacts(run, w);
    const k = sideKey(w.side);
    return `<div class="p-ntile" aria-hidden="true"><span class="p-side ${k} p-nside">${legWords(k)}</span>
      <span class="p-nbig"><b>${esc(which)}</b><i>·</i><b>${esc(size)}</b></span></div>`;
  }
  if (st.kind === 'ready') {
    const w = workFrom(run, run.i);
    if (!w) return line;
    const chips = [];
    if (run.mode === 'cardio') chips.push('One bout', secsShort(w.secs));
    else if (w.kind === 'hold' && w.units > 1) chips.push(plural(w.units * w.sets, 'hold', 'holds'), w.open ? `Goal ${w.secs} s` : `${secsShort(w.secs)} each`);
    else {
      chips.push(plural(w.sets, 'set', 'sets'));
      if (w.kind === 'hold') chips.push(w.open ? `Goal ${w.secs} s` : `${secsShort(w.secs)} ${w.sets === 1 ? 'hold' : 'holds'}`);
      else if (w.kind === 'work') chips.push(`${secsShort(w.secs)} each`);
      else chips.push(w.reps != null ? plural(w.reps, 'rep', 'reps') : 'Your pace');
    }
    const k = sideKey(w.side);
    const leg = k === 'B' ? 'Both legs' : `${legWords(k)} first`;
    return `<ul class="p-chips" aria-hidden="true">${chips.map((c) => `<li>${esc(c)}</li>`).join('')}<li class="${k}">${leg}</li></ul>`;
  }
  if (E.WORK.has(st.kind) && !workFrom(run, run.i + 1)) {
    const nx = carryOnItem(run);
    if (nx) {
      const pic = thumb(nx.ex, 44).replace(/ data-bigpic="[^"]*"/, '').replace(/ title="[^"]*"/, '');
      return `<div class="p-ntile ex" aria-hidden="true"><span class="p-nlabel">Next</span><div class="p-nthumb">${pic}</div><b class="p-ntitle">${esc(nameOf(nx))}</b></div>`;
    }
  }
  return line;
}

/** The Next slot, written only when it changed: its picture is never decoded twice. */
function putNext(slot, run) {
  if (!slot) return;
  const html = nextTile(run);
  if (slot.__html !== html) { slot.__html = html; slot.innerHTML = html; }
  const label = nextLine(run);
  if (slot.getAttribute('aria-label') !== label) slot.setAttribute('aria-label', label);
}

// --------------------------------------------------------------- icons ----
const I = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6l-8 6 8 6z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 6l8 6-8 6z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l7 6-7 6M13 6l7 6-7 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  cues: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  // The same speaker with its waves replaced by motion lines: the cue is still
  // there, it is just felt instead of heard.
  buzzIcon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M17 8.5v7M20 10v4"/></svg>',
  metro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6l3.5 17h-13z"/><path d="M12 16l5-9"/></svg>',
  wake: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="3" width="11" height="18" rx="2.5"/><path d="M10.5 18h3"/></svg>',
  loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
  song: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.5 1.5 2.5-2.5M3.5 12l1.5 1.5 2.5-2.5M3.5 17.5l1.5 1.5 2.5-2.5"/></svg>',
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
  skipSong: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5z"/><path d="M18 5v14"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.6"/></svg>',
};

// -------------------------------------------------------------- render ----
// 2026-09-14 revision 3 (turquoise kit), on the ring design's structure.
// Order: the workout line (count, day, wake), the full title, one status
// line (the set, or Logged after a save), the whole photo grid, the phase and
// leg, the dial (a textured instrument panel with a bezel, the live ring and
// the rep wells), the next step, what is playing with Skip, the four sound
// switches, then the transport dock.
//
// One skeleton per run. A step change patches the slots in place (refresh),
// so buttons under his finger are never replaced and nothing re-renders on a
// tick. A different exercise, the finish or the retry screen renders fresh.

// The ring's geometry lives in celebrate.js, so the completion moments always
// draw exactly over it (review, 2026-09-16).
const RING = { size: RING_VIEW, stroke: RING_STROKE, inner: 3.5 };
RING.r = RING_R;
RING.c = 2 * Math.PI * RING.r;
RING.ri = RING.r - 12;
RING.ci = 2 * Math.PI * RING.ri;

let lastContentKey = null;   // which run the screen last showed
let pendingSlide = null;     // the exercise being left, until the new one is on screen

/**
 * Changing exercise pushes (2026-09-15). His notes: the old fade was so subtle
 * he never noticed it, then the crossfade that replaced it showed two workouts
 * at once and "looks bad". So the two never overlap and never fade: the redraw
 * only detaches the exercise being left, it goes back into the same grid cell
 * (`.p-stage`) one width over, and both move together like pages, the old one
 * out as the new one comes in. Finishing and carrying on, the arrows and a
 * swipe forward push from the right; going back from the left. Nothing is
 * copied or measured and the pictures stay decoded. At 30 frames (Low Power
 * Mode) the old one goes at once and the new one slides a short way in, so
 * still only one is ever on screen; nothing moves under Reduce Motion.
 */
function captureLeaving(dir) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const old = document.querySelector('.player[data-player] .p-stage > .p-content');
  return old ? { dir, old } : null;   // opened from Today: the page fade covers it
}

const PUSH_MS = 420;
const PUSH_EASE = 'cubic-bezier(.32, .72, 0, 1)';
const PUSH_GAP = 28;   // px between the two pages while they move

function playSlide(player) {
  const s = pendingSlide;
  pendingSlide = null;
  const stage = player?.querySelector('.p-stage');
  const content = stage?.querySelector(':scope > .p-content');
  // Resolves once the new exercise has landed (B3-2: its intro waits for it),
  // at once when nothing slides.
  let landed = () => {};
  const done = new Promise((res) => { landed = res; });
  if (!s || !content) { landed(); return done; }
  const view = player.parentElement;
  // Counted, so a second change during a push keeps the sides clipped.
  const clip = () => { if (view) { view.dataset.pushes = String((Number(view.dataset.pushes) || 0) + 1); view.classList.add('p-sliding'); } };
  const unclip = () => {
    if (!view) return;
    const left = Math.max(0, (Number(view.dataset.pushes) || 1) - 1);
    view.dataset.pushes = String(left);
    if (!left) view.classList.remove('p-sliding');
  };
  const once = (fn) => { let done = false; return () => { if (!done) { done = true; fn(); } }; };
  clip();
  if (liteMotion()) {
    const end = once(() => { unclip(); landed(); });
    content.animate([{ transform: `translateX(${s.dir * 32}px)` }, { transform: 'none' }],
      { duration: 200, easing: 'cubic-bezier(.16, 1, .3, 1)' }).finished.then(end, end);
    setTimeout(end, 500);
    return done;
  }
  const old = s.old;
  old.classList.add('p-leaving');
  old.setAttribute('aria-hidden', 'true');
  old.inert = true;
  old.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  stage.appendChild(old);   // after the new one, so a query never finds it first
  const over = `(100% + ${PUSH_GAP}px)`;
  const timing = { duration: PUSH_MS, easing: PUSH_EASE };
  const out = old.animate([{ transform: 'none' }, { transform: `translateX(calc(${-s.dir} * ${over}))` }], { ...timing, fill: 'forwards' });
  const inn = content.animate([{ transform: `translateX(calc(${s.dir} * ${over}))` }, { transform: 'none' }], timing);
  const clean = once(() => { old.remove(); unclip(); landed(); });
  Promise.all([out.finished, inn.finished]).then(clean, clean);
  setTimeout(clean, PUSH_MS + 300);
  return done;
}

/**
 * Next up introduces itself (B3-2), once, after the push has landed: the title
 * and the get ready's chips rise into place, and the step picture pushes in
 * slowly (1.03, centred) over what is left of the get ready, settling back as
 * the work begins (dialMoments, woke). The clinician's video is never started.
 * Lite: the words fade, no push. Reduce Motion: nothing.
 */
let introCtl = null;   // { runId, ctl }
function playIntro(root, run, { words = true } = {}) {
  introCtl?.ctl?.cancel();
  introCtl = null;
  if (!root?.isConnected || P?.run !== run || P.phase !== 'run') return;
  const st = E.step(run);
  const rem = st?.kind === 'ready' && run.state === 'running' ? E.remainingSec(run, performance.now()) : null;
  const ctl = intro(root, rem != null ? rem * 1000 : 0, { words, push: rem != null });
  if (ctl) introCtl = { runId: run.runId, ctl };
}

const stepKey = (run) => `${run.runId}:${run.i}:${run.state}`;

export function renderPlayer(ctx) {
  reconcileDraft();
  if (!P) {
    return `<div class="player empty-player">
      <div class="p-eyebrow">${backBtn(ctx)}</div>
      <div class="empty">No workout is open. Start one from Today.</div>
    </div>`;
  }
  // A full render is the repaint a sync pull held back while the run was
  // running (B2-1): whatever draws now draws the synced data, so it is owed no more.
  P.fullPaintPending = false;
  if (P.phase === 'between') return renderBetween(ctx);
  if (P.phase === 'done') return renderDone(ctx);
  const run = P.run;
  const item = ITEM[run.pid];
  const ex = exerciseById(item.ex);
  if (run.state === 'review') return renderReview(ctx, run, item, ex);

  const title = item.title || ex?.name || item.ex;
  const enter = lastContentKey !== null && lastContentKey !== run.runId;
  lastContentKey = run.runId;
  // Measured from what this render draws, every time: a resume through a sheet
  // or the zoom rerenders without a refresh, and a stale edge would wake the
  // dial in the middle of a set.
  lastDial = { runId: run.runId, working: dialWorking(run), kind: E.step(run)?.kind || null };
  const swipeDir = P.swipeDir || 0;
  P.swipeDir = 0;
  if (enter) pendingSlide = captureLeaving(swipeDir < 0 ? -1 : 1);
  const cat = CATEGORIES[ex?.cat]?.color || 'var(--ink-2)';
  const catEnd = ex?.cat === 'strength' ? 'var(--cat-strength-end)' : cat;
  const hap = hapTaps();

  return `
  <div class="player" data-player data-run="${esc(run.runId)}" ${washAttrs(run)} style="--cat:${cat};--cat-end:${catEnd}">
    <div class="p-eyebrow">
      ${backBtn(ctx)}
      <span class="p-count" data-slot="count">${countLine(run)}</span>
      <span class="p-wake" data-p-wake data-state="${wakeState}" role="img" aria-label="${esc(wakeText())}">${I.wake}<span class="p-wake-note">${wakeNote()}</span></span>
    </div>
    <div class="p-stage"><div class="p-content">
      <div class="p-swipe" data-p-swipe>
      <h1 class="p-title">${esc(title)}</h1>
      ${swipeButtons(run)}
      <div class="p-status" data-slot="status">${statusLine(run)}</div>
      ${levelLine(item)}
      ${item.img
        ? `<button class="p-img" data-p="zoom" aria-label="Show the step pictures larger">
            <span class="p-imgclip"><img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async"></span>
            <span class="p-expand">${I.zoom}</span>${videoFor(item.id) ? VIDEO_TAG : ''}</button>
           ${item.photoNote ? `<div class="p-photonote">${esc(item.photoNote)}</div>` : ''}`
        : `<div class="p-img plain">${thumb(item.ex, 90)}</div>`}
      </div>
      <div class="p-phaserow" data-slot="phase">${phaseRow(run)}</div>
      <div class="p-dial ${dialClasses(run)}">
        <span class="p-dial__lift" aria-hidden="true"></span>
        <span class="p-dial__grid" aria-hidden="true"></span>
        <span class="p-dial__gold" aria-hidden="true"></span>
        <span class="p-dial__breath" aria-hidden="true"></span>
        <span class="p-dial__glow" aria-hidden="true"></span>
        <span class="p-dial__energy" aria-hidden="true"></span>
        <span class="p-dial__bezel" aria-hidden="true"></span>
        <span class="p-dial__veil" aria-hidden="true"></span>
        <span class="p-dial__sweep" aria-hidden="true"></span>
        <span class="p-dial__pulse" aria-hidden="true"></span>
        ${tapCtl(hap, `class="p-adj" data-p="reps-" data-step="${stepKey(run)}" aria-label="One fewer rep this set"`, I.minus, !repsEditable(run))}
        <div class="p-ring" ${ringAttrs(run)} data-slot="ring">${ringInner(run)}</div>
        ${tapCtl(hap, `class="p-adj" data-p="reps+" data-step="${stepKey(run)}" aria-label="One more rep this set"`, I.plus, !repsEditable(run))}
      </div>
      <div class="p-nextrow"><div class="p-next" data-slot="next" role="group" aria-label="${esc(nextLine(run))}">${nextTile(run)}</div></div>
      <div class="p-now" data-slot="now">${nowPlaying(run)}</div>
      <div class="p-sound ${soloTools(run) ? 'solo' : ''}" role="group" aria-label="Sound" data-slot="tools">${soundTools(run)}</div>
    </div></div>
    <div class="p-actions" data-p-dock>
      <div class="p-row1">
        ${tapCtl(hap, `class="btn big p-pause ${pausedLook(run) ? 'breathing' : ''}" data-p="pause" data-step="${stepKey(run)}"`, pauseLabel(run))}
        ${tapCtl(hap, `class="btn big primary" data-p="done" data-step="${stepKey(run)}"`, `${I.check}<span>Set done</span>`, !E.WORK.has(E.step(run)?.kind))}
      </div>
      <div class="p-row2">
        <button class="btn p-link" data-p="prev" data-step="${stepKey(run)}" ${hasPrevWork(run) ? '' : 'disabled'}>${I.prev}<span>Previous</span></button>
        <button class="btn p-link" data-p="more" data-step="${stepKey(run)}" ${['rest', 'switch', 'ready'].includes(E.step(run)?.kind) ? '' : 'disabled'}>${I.more}<span>+30 s</span></button>
        <button class="btn p-link" data-p="skip" data-step="${stepKey(run)}" ${['rest', 'switch', 'ready'].includes(E.step(run)?.kind) ? '' : 'disabled'}>${I.skip}<span>Skip rest</span></button>
        <button class="btn p-link" data-p="next" data-step="${stepKey(run)}">${I.next}<span>Next</span></button>
      </div>
    </div>
  </div>`;
}

/**
 * Patch the open run's slots in place: status, phase, ring, next, playing,
 * sound switches and the transport's states. Falls back to a full render when
 * the screen is not this run's skeleton.
 */
function refresh() {
  const run = P?.run;
  const root = document.querySelector('.player[data-player]');
  if (!run || P.phase !== 'run' || run.state === 'review' || !root || root.dataset.run !== run.runId || root.classList.contains('review')) {
    currentRerender?.();
    return;
  }
  // The repaint a sync pull held back (B2-1) runs at the first refresh once the
  // run is no longer running: a pause, the ready screen, or the finish. A count
  // back in is on its way to running, so it waits through that too.
  if (P.fullPaintPending && run.state !== 'running' && !P.resumeAt) {
    P.fullPaintPending = false;
    // The fresh dial is drawn as it was on screen and then moved to the state
    // now (dialClasses, settleDial), so a Pause after a held back sync still
    // fades its veil and calms the dial like every other Pause (review,
    // 2026-09-23: drawn already paused, the 280 ms veil snapped on).
    const d = root.querySelector('.p-dial');
    if (d) dialShown = { runId: run.runId, working: d.classList.contains('working'), paused: d.classList.contains('paused'), at: Date.now() };
    currentRerender?.();
    return;
  }
  const put = (slot, html) => {
    const el = root.querySelector(`[data-slot="${slot}"]`);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };
  putCount(root.querySelector('[data-slot="count"]'), run);
  put('status', statusLine(run));
  put('phase', phaseRow(run));
  putRing(root.querySelector('[data-slot="ring"]'), ringInner(run));
  putNext(root.querySelector('[data-slot="next"]'), run);
  dialMoments(root, run);
  paintNow();
  patchTools(root, run);
  const key = stepKey(run);
  const kind = E.step(run)?.kind;
  const set = (k, attrs) => {
    const b = root.querySelector(`[data-p="${k}"]`);
    if (!b) return;
    b.dataset.step = key;
    // A label around a hidden switch (B6-1) is switched off by aria-disabled
    // and its switch's own disabled, a button by disabled.
    const label = b.tagName === 'LABEL';
    if ('disabled' in attrs) {
      if (!label) b.disabled = !!attrs.disabled;
      else {
        const off = !!attrs.disabled;
        if (off) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
        // The switch is switched on at once, and off only once this tap's own
        // click has reached it: Set done switches itself off as the set closes,
        // and a switch disabled inside the handler never took the label's
        // forwarded click, so the one tap that mattered was never felt.
        const sw = b.querySelector(':scope > input.hap');
        if (sw && sw.disabled !== off) {
          if (!off) sw.disabled = false;
          else setTimeout(() => { if (b.getAttribute('aria-disabled') === 'true') sw.disabled = true; }, 0);
        }
      }
    }
    if (attrs.html != null) {
      // The label keeps its switch: only the words and the icon after it change.
      if (!label) { if (b.innerHTML !== attrs.html) b.innerHTML = attrs.html; }
      else if (b.__html !== attrs.html) {
        const sw = b.querySelector(':scope > input.hap');
        b.innerHTML = attrs.html;
        if (sw) b.prepend(sw);
        b.__html = attrs.html;
      }
    }
    if ('breathing' in attrs) b.classList.toggle('breathing', attrs.breathing);
  };
  // Resume breathes while he is paused (B1-7): the same button, now inviting him back.
  set('pause', { html: pauseLabel(run), breathing: pausedLook(run) });
  set('done', { disabled: !E.WORK.has(kind) });
  set('prev', { disabled: !hasPrevWork(run) });
  set('skip', { disabled: !['rest', 'switch', 'ready'].includes(kind) });
  set('more', { disabled: !['rest', 'switch', 'ready'].includes(kind) });
  set('next', {});
  set('reps-', { disabled: !repsEditable(run) });
  set('reps+', { disabled: !repsEditable(run) });
  patchRing(root.querySelector('.p-ring[data-slot="ring"]'), run, key);
  paintWake();
  patchZoom();
}

/**
 * A sync pull while the player is on screen (B2-1). While a run is RUNNING (or
 * counting back in to run) it never rebuilds the player: the synced data is
 * already applied (the store did that), the slots are patched in place, and the
 * full repaint waits for the first refresh after the run stops running (a
 * pause, the ready screen, the finish) or the next exercise's render. A Gold
 * Echo, a sweep or a breath in flight is never cut, and the ring under his
 * finger is never replaced. While an exercise is being saved (P.finishing)
 * nothing is patched at all: the finish repaints once the save is done, so the
 * retry screen is never drawn for a moment under the Orbit Seal. Returns false
 * when the shell should paint as usual.
 */
export function refreshPlayerSafe() {
  if (!P?.run || P.phase !== 'run') return false;
  if (P.finishing) { P.fullPaintPending = true; return true; }
  // A count back in is treated as running: a rebuild there cancelled its pips.
  if (P.run.state !== 'running' && !P.resumeAt) return false;
  P.fullPaintPending = true;
  refresh();
  return true;
}

/**
 * The ring is Set done while a set is his to finish (B2-3): a reps step, or a
 * manual step with a target, while the run is running. Otherwise it is the
 * step's picture and nothing more (his rule: a control that does not apply is
 * not there). The dock's Set done never changes.
 */
const setLive = (run) => !!run && repsEditable(run) && run.state === 'running' && !P?.resumeAt;
function ringAttrs(run) {
  return setLive(run)
    ? `data-p="ringdone" data-step="${esc(stepKey(run))}" role="button" tabindex="0" aria-label="Set done"`
    : 'role="group" aria-label="Current step"';
}
/**
 * The ring's picture, written only when it changed (review, 2026-09-23). An SVG
 * never reads back as the string it was written from (a self closing tag comes
 * back open and closed), so comparing innerHTML rewrote the ring on every
 * refresh, and during a set the caption also carries the set's own clock,
 * which paintClock keeps. A set's ring is therefore compared with what was last
 * written, less that clock: a sync pull, or any other refresh mid set, leaves
 * its nodes alone, so a press on the number is never lost to a replaced node
 * (a mouse click was, on the Mac and the iPad). Every other step keeps the old
 * rule: its clock and arc change every second anyway, and it is not a control.
 */
const SETCAP = /(<span data-p-setcap>)[\s\S]*?(<\/span><\/div>)/;
const ringKey = (html) => (SETCAP.test(html) ? html.replace(SETCAP, '$1$2') : null);
function putRing(el, html) {
  if (!el) return;
  const key = ringKey(html);
  if (key != null && key === el.__drawn) return;
  el.__drawn = key;
  if (el.innerHTML !== html) el.innerHTML = html;
}

function patchRing(ring, run, key) {
  if (!ring) return;
  if (setLive(run)) {
    if (ring.dataset.p !== 'ringdone') ring.dataset.p = 'ringdone';
    if (ring.dataset.step !== key) ring.dataset.step = key;
    if (ring.getAttribute('role') !== 'button') ring.setAttribute('role', 'button');
    if (ring.getAttribute('tabindex') !== '0') ring.setAttribute('tabindex', '0');
    if (ring.getAttribute('aria-label') !== 'Set done') ring.setAttribute('aria-label', 'Set done');
  } else if (ring.hasAttribute('data-p')) {
    ring.removeAttribute('data-p');
    ring.removeAttribute('data-step');
    ring.removeAttribute('tabindex');
    ring.setAttribute('role', 'group');
    ring.setAttribute('aria-label', 'Current step');
  }
}

/** An earlier work step exists for Previous to go back to (at the first one it did nothing). */
function hasPrevWork(run) {
  for (let j = Math.min(run.i, run.steps.length) - 1; j >= 0; j--) if (E.WORK.has(run.steps[j].kind)) return true;
  return false;
}

// ------------------------------------------------------ dial moments ----
// 2026-09-15, his pick: a confirmed set pulses the ring, and the moment a rest
// (or the get ready, or a switch) turns back into work a light sweeps once
// round the dial. Both are Web Animations on transform and opacity; at 30
// frames (Low Power Mode) the sweep is a glow without the turn; nothing under
// Reduce Motion.
// The dial's last working state, per run. Seeded when a run's screen is first
// drawn (renderPlayer), because an exercise the session carries on to is drawn
// in full, never refreshed, until its get ready turns into work.
let lastDial = { runId: null, working: false };
// The set that just closed was closed by his tap, not by a timer (announceEvents,
// read once by dialMoments): only a tap may carry a haptic on iOS.
let pulseByTap = false;
const dialWorking = (run) => E.WORK.has(E.step(run)?.kind) && run.state === 'running';
/**
 * Paused, and not on its way back (B1-7): the words read PAUSED, the dial
 * veils and the arc dims, and the dock's Resume breathes. During the count
 * back in the step's own word and the live dial come back at once.
 */
const pausedLook = (run) => (run?.state === 'paused' || run?.state === 'interrupted') && !P?.resumeAt;

/**
 * The across the room wash (his pick, 23 Sep 2026: option A of the two rendered
 * by tools/aura_options.py). A flat tint of the whole screen, so the state reads
 * from across the room: the exercise's category while he works, the new leg's
 * colour on a switch, nothing on rest, get ready or pause. The colour stays set
 * when the wash goes off, so it fades out in its own colour.
 */
function washOf(run) {
  const st = E.step(run);
  if (!run || !st || run.state !== 'running' || P?.resumeAt) return '';
  if (st.kind === 'switch') return st.side === 'L' ? 'left' : st.side === 'R' ? 'right' : '';
  return E.WORK.has(st.kind) ? 'cat' : '';
}
const washAttrs = (run) => { const w = washOf(run); return w ? `data-wash="${w}" data-wash-on` : ''; };
function setWash(root, run) {
  const w = washOf(run);
  if (w && root.dataset.wash !== w) root.dataset.wash = w;
  root.toggleAttribute('data-wash-on', !!w);
}

/**
 * The dial's state classes as a render draws them. After a repaint a sync pull
 * held back (B2-1), the first render draws the dial as it was on screen, working
 * and not yet paused, and settleDial moves it to the state now two frames later,
 * so its CSS transitions (the veil's 280 ms, the calm's 320 ms) play exactly as
 * they do when no sync came. The set's breath ('reps') is never redrawn that
 * way: it stops at a pause, and a restarted breath would flash.
 */
let dialShown = null;   // { runId, working, paused, at }
function dialClasses(run) {
  const shown = dialShown && dialShown.runId === run.runId && Date.now() - dialShown.at < 1000 ? dialShown : null;
  dialShown = null;
  const now = { working: dialWorking(run), reps: setLive(run), paused: pausedLook(run) };
  const draw = shown ? { working: shown.working, reps: now.reps, paused: shown.paused } : now;
  if (shown && (draw.working !== now.working || draw.paused !== now.paused)) settleDial();
  return [draw.working && 'working', draw.reps && 'reps', draw.paused && 'paused'].filter(Boolean).join(' ');
}
function settleDial() {
  let done = false;
  const apply = () => {
    if (done) return;
    done = true;
    const run = P?.run;
    const dial = document.querySelector('.player[data-player] .p-dial');
    if (!run || !dial || P.phase !== 'run') return;
    dial.classList.toggle('working', dialWorking(run));
    dial.classList.toggle('reps', setLive(run));
    dial.classList.toggle('paused', pausedLook(run));
  };
  // Two frames, so the dial is styled once as it was before it moves; a timer
  // behind them for a hidden tab, where frames never come.
  requestAnimationFrame(() => requestAnimationFrame(apply));
  setTimeout(apply, 300);
}

function dialMoments(root, run) {
  const kind = E.step(run)?.kind || null;
  const working = dialWorking(run);
  // The wake plays on the EDGE into working, whatever came before it: a rest, a
  // get ready, a switch, or the count in after a pause or a skipped rest
  // (review, 2026-09-16: keyed on the step kind alone it fired at the Skip rest
  // tap, under the count in, and never when the work began).
  const woke = lastDial.runId === run.runId && working && !lastDial.working;
  // The edge into a switch, within the same run: the leg's pill flips over to
  // the new leg (B2-2), once, after the phase slot was patched above.
  const flipped = lastDial.runId === run.runId && kind === 'switch' && lastDial.kind !== 'switch';
  lastDial = { runId: run.runId, working, kind };
  // Calm while waiting, alive while working (2026-09-16). Kept in step on every
  // refresh as well as in the markup, because a pause or a resume changes it
  // without the dial being redrawn. Not motion, so reduced motion does not skip it.
  root.querySelector('.p-dial')?.classList.toggle('working', working);
  root.querySelector('.p-dial')?.classList.toggle('paused', pausedLook(run));
  // A set in hand breathes (B2-4): a slow fixed 4.8 s swell of the category
  // colour just outside the disc, so a reps set is never dead air. Fixed, so it
  // can never read as a pace; the set segments themselves never move.
  root.querySelector('.p-dial')?.classList.toggle('reps', setLive(run));
  setWash(root, run);
  const lite = liteMotion();
  // On the Set done tap itself: the ring may already show the other leg's sets.
  // Only a pulse raised for THIS run. A final Set done ends the run in review
  // without a refresh, so a plain true used to survive into the next exercise
  // and fire its gold wave ten seconds later (review, 2026-09-16).
  const pulse = P.pulseSet === run.runId;
  const tapped = pulse && pulseByTap;
  P.pulseSet = false;
  pulseByTap = false;
  if (pulse) {
    // Gold Echo (ChatGPT's handoff, 2026-09-16): flash, expand, recover. It
    // replaces the old ring bump and pulse, which it draws for itself. Called
    // under reduced motion too: goldEcho has a quieter version that still makes
    // the finish clear, which the handoff asks for.
    goldEcho(root.querySelector('.p-dial'));
    // And the bell that means a set closed (B2-7), heard wherever cues are
    // heard, Reduce Motion included: it celebrates finishing, never effort.
    if (cuesHeard()) A.goldBell();
    // In Buzz it is felt instead, as a Pause is (B1-7): one tick, only when his
    // tap closed the set, because iOS blocks a haptic from a timer. Where touch
    // feedback is on, announceEvents has already felt this tap ('phase'), and a
    // second toggle of the switch in the same moment could cancel the first.
    else if (tapped && cuesOn() && A.silentMode() === 'buzz' && !hapticsOn()) buzz('tick');
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (flipped) flip(root.querySelector('[data-slot="phase"] .p-side'));
  // The intro's picture settles back as the work begins (B3-2).
  if (working && introCtl?.runId === run.runId) { introCtl.ctl.settle(); introCtl = null; }
  if (woke) {
    // Saturation Wake's label: the phase reads STARTING, then the real word.
    wakeLabel(root.querySelector('[data-slot="phase"]'), stepWord(run, kind));
    const sweep = root.querySelector('.p-dial__sweep');
    if (!sweep) return;
    if (lite) {
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
}

/** What is playing, patched on its own when the song's state changes. */
function paintNow() {
  const run = P?.run;
  const el = document.querySelector('.player [data-slot="now"]');
  if (!run || !el) return;
  const html = nowPlaying(run);
  if (el.innerHTML !== html) el.innerHTML = html;
}
S.onSongStatus(() => paintNow());

/**
 * The workout line: in a session, the day thread (B3-3) and "Workout 2 of 5",
 * each number in its own span so it rolls when it changes.
 */
function countLine(run) {
  const s = P.session;
  const bits = [s ? `<span class="p-count-word">Workout</span> <span class="p-cnum" data-roll>${s.pos + 1}</span> of <span class="p-cnum" data-roll>${s.queue.length}</span>` : 'Exercise'];
  if (run.iso !== todayIso()) bits.push(`<span class="p-day">${esc(fmtDate(run.iso, 'dow'))}</span>`);
  return `${threadRing()}<span class="p-ctext">${bits.join(' · ')}</span>`;
}

/**
 * The day thread (B3-3): Today's day ring at 32 px beside the workout line, the
 * same items and rows (dayRingItems), so the two always agree. Only in a
 * session, on the day it logs to, and only while each exercise can have its
 * own segment (12 or fewer; a denser plan draws category arcs). While an
 * exercise is being saved and sealed its segment is drawn not done
 * (P.threadPending); the render after the seal lands draws it in
 * (P.threadDraw, marked `closing` so it carries a unit length to draw).
 */
function threadRing() {
  const s = P?.session;
  if (!s || (s.planIso && s.planIso !== s.iso)) return '';
  const R = dayRingItems(state.data, s.iso);
  if (!R.items.length || R.items.length > 12) return '';
  const pend = P.threadPending;
  const entries = pend ? R.entries.filter((e) => e.pid !== pend) : R.entries;
  const ring = dayRing(R.items, entries, { size: 32, stroke: 4, mini: true, center: 'none', closing: P.threadDraw || null });
  return `<span class="p-thread">${ring.html}</span>`;
}

/** "Workout 2 of 5" rolls to 3 when the session moves on; never on a first draw or a reload. */
function rollCount(player) {
  const s = P?.session;
  const el = player?.querySelector('.p-count .p-cnum');
  if (!s || !el || P.phase !== 'run') return;
  const was = countShownAt;
  const list = `${s.iso}|${s.queue.join(',')}`;
  countShownAt = { list, pos: s.pos };
  if (was && was.list === list && was.pos !== s.pos) roll(el, s.pos > was.pos ? 1 : -1, { ms: 280 });
}

/** The workout line, written only when it changed; a segment drawing in is not a change. */
const countKey = (html) => html.replace(/ closing| pathLength="1"/g, '');
function putCount(slot, run) {
  if (!slot) return;
  const html = countLine(run);
  const key = countKey(html);
  if (slot.__key === key) return;
  slot.__key = key;
  slot.innerHTML = html;
}

function wakeText() {
  const running = P?.run?.state === 'running';
  return {
    on: 'The screen stays awake while this runs',
    off: running ? 'Asking to keep the screen awake' : 'Paused: the screen may lock',
    unavailable: 'This browser cannot keep the screen awake: the screen may lock',
    denied: 'Screen may lock: this device refused to keep it awake. Tap any control to ask again',
    lost: 'Screen may lock: keeping it awake stopped. Tap any control to ask again',
  }[wakeState] || '';
}
function wakeNote() {
  return P?.run?.state === 'running' && ['denied', 'lost', 'unavailable'].includes(wakeState) ? 'Screen may lock' : '';
}

/**
 * A control that counts a tap (B6-1): a <button>, or, where a finger can feel
 * it (hapTaps), a label around a hidden switch with the same classes, words,
 * place and size. `off` is disabled on a button, aria-disabled on a label.
 */
function tapCtl(hap, attrs, inner, off = false) {
  return hap
    ? `<label ${attrs} role="button" tabindex="0"${off ? ' aria-disabled="true"' : ''}>${hapInput(off)}${inner}</label>`
    : `<button ${attrs}${off ? ' disabled' : ''}>${inner}</button>`;
}

function pauseLabel(run) {
  // During the count back in the run is still paused, but it is on its way:
  // the button says Pause, and a tap still cancels the five (B1-6).
  return run.state === 'running' || P?.resumeAt ? `${I.pause}<span>Pause</span>`
    : `${I.play}<span>${run.state === 'ready' ? 'Start' : 'Resume'}</span>`;
}

function repsEditable(run) {
  const st = E.step(run);
  return !!st && (st.kind === 'reps' || st.kind === 'manual') && st.reps != null;
}

/** The side a step belongs to: a switch names the side it switches TO. */
function sideOfStep(run, st) {
  if (!st) return 'B';
  const s = st.kind === 'rest' || st.kind === 'ready'
    ? (run.steps.slice(run.i).find((x) => E.WORK.has(x.kind))?.side || 'B')
    : (st.side || 'B');
  return s === 'L' || s === 'R' ? s : 'B';
}

function phaseRow(run) {
  const st = E.step(run);
  const kind = st?.kind || 'ready';
  const side = sideOfStep(run, st);
  const paused = pausedLook(run);
  const word = paused ? 'PAUSED' : stepWord(run, kind);
  const dflt = !paused && kind === 'rest' && st.restSrc === 'default' ? '<span class="p-default">default</span>' : '';
  // Grey is the colour of a state that is not working (B1-7): PAUSED is neutral.
  const neutral = paused || ['rest', 'ready', 'switch'].includes(kind) ? 'neutral' : '';
  // Word, leg, word: the leg dead centre and the prompt mirrored either side
  // (his ask, 2026-09-18).
  return `<span class="p-label l ${neutral}">${dflt}${esc(word)}</span>
    <span class="p-side ${side}">${side === 'L' ? 'Left leg' : side === 'R' ? 'Right leg' : 'Both legs'}</span>
    <span class="p-label r ${neutral}" aria-hidden="true">${esc(word)}${dflt}</span>`;
}

/** The screen's word for a step: the exercise's own prompt for work, "Balance!". */
function stepWord(run, kind) {
  if (kind === 'switch') return 'SWITCH';
  if (kind === 'ready') return 'READY';
  if (kind === 'rest' || kind === 'ready') return phaseLabel(kind);
  const w = cueWord(exerciseById(ITEM[run.pid]?.ex));
  return `${w || phaseLabel(kind)}!`;
}

/**
 * The one status line under the title: the set in hand, "Logged" with the
 * previous exercise's full title for a moment after a durable save (while the
 * next get ready already runs), or the interruption note. No empty banner.
 */
function statusLine(run) {
  const r = P.receipt;
  if (r && Date.now() < r.until) {
    const fresh = !r.shown;
    r.shown = true;
    return `<span class="p-logged ${fresh ? 'fresh' : ''}" role="status" aria-label="Logged ${esc(r.title)}">${I.checkCircle}<span aria-hidden="true">Logged · ${esc(r.title)}</span></span>`;
  }
  if (draftFailed) return '<span class="p-note bad">Not kept on this device: storage is full. <button class="p-retry" data-p="draft-retry">Retry</button></span>';
  if (run.state === 'interrupted') {
    // An open hold stopped by a lock keeps the bout before it (engine.pause), so
    // "Nothing was counted" was untrue there (2026-09-22 audit).
    const st = E.step(run);
    const kept = st?.open && ((run.openTries?.[run.i] || []).length || run.openShort?.[run.i]);
    return `<span class="p-note">Paused while you were away. ${kept ? 'The hold before it is kept.' : 'Nothing was counted.'}</span>`;
  }
  return esc(unitLine(run, E.step(run)));
}

function backBtn(ctx) {
  const to = ctx.playerFrom === 'program' ? 'My Program' : 'Today';
  return `<button class="p-back" data-p="close" aria-label="Back to ${to}">${I.back}<span>${to}</span></button>`;
}

/** The phone header's back button calls this (mobile.js). */
export function playerBack(ctx) {
  // Not while a finished exercise is being saved: Back then offered to leave a
  // run that was already recorded (2026-09-23 audit). It moves on by itself.
  if (P?.finishing) return;
  if (currentRerender) closePlayer(ctx, currentRerender);
  else ctx.go(ctx.playerFrom || 'today');
}

function currentReps(run) {
  const st = E.step(run);
  if (P.repsAdjust && P.repsAdjust.i === run.i) return P.repsAdjust.n;
  return st?.reps ?? '';
}

/**
 * The tendon loading is one exercise to him, so it runs as one timer (his ask,
 * 2026-09-15): "30 seconds, then two minutes, then 30 seconds ... one
 * continuous thing". The arc is the whole exercise and never resets. Since
 * 2026-09-16 the big number is the step in hand and the line under it the
 * whole exercise ("the big clock should show the specific durations"), and
 * every transition gets the three pips and the end tone, like any other step
 * ("I want the three beeps leading up to each transition"). Programme items
 * opt in with `continuous: true`.
 */
const isFlow = (run) => !!ITEM[run?.pid]?.continuous;
function flowLeft(run, now) {
  const rem = E.remainingSec(run, now);
  if (rem == null) return null;
  let t = rem;
  for (let j = run.i + 1; j < run.steps.length; j++) {
    if (run.steps[j].secs == null) return null;
    t += run.steps[j].secs;
  }
  return t;
}
function flowTotal(run) {
  let t = 0;
  for (const st of run.steps) { if (st.secs == null) return null; t += st.secs; }
  return t;
}

function arcDash(run, st, now) {
  if (isFlow(run)) {
    const left = flowLeft(run, now);
    const total = flowTotal(run);
    return left == null || !total ? null : Math.max(0, Math.min(1, left / total));
  }
  const rem = E.remainingSec(run, now);
  if (rem == null || !st?.secs) return null;
  // An open hold fills toward its goal and stays full past it.
  if (st.open) return Math.max(0, Math.min(1, E.elapsedMs(run, now) / 1000 / st.secs));
  return Math.max(0, Math.min(1, rem / st.secs));
}

/**
 * Past the goal of an open hold (B4-1): how far round the second lap is, the
 * time past the goal as a share of the goal, full at twice the goal. Worked out
 * from the clock every time it is asked, so a rebuilt ring slot draws it right
 * with no flag to carry. Null for anything but an open hold.
 */
function lapDash(run, st, now) {
  if (!st?.open || !st.secs || isFlow(run)) return null;
  const past = E.elapsedMs(run, now) / 1000 - st.secs;
  return Math.max(0, Math.min(1, past / st.secs));
}

/**
 * The caption under an open hold's clock (B4-1): "Goal 30s" until the goal,
 * then "Past goal 0:07", a plain fact and never a reward (his best is the goal,
 * and rewards follow the plan). The two parts break only between each other.
 */
function goalCap(st, secs) {
  const past = secs - st.secs;
  return past > 0
    ? `<span class="p-capbit">Past goal</span> <span class="p-capbit mono">${fmtClock(past)}</span>`
    : `Goal ${st.secs}s`;
}

function ringInner(run) {
  const st = E.step(run);
  const now = performance.now();
  return `${ringSvg(run, st, now)}<div class="p-center">${ringCenter(run, st, now)}</div>
    ${run.pace ? `<i class="p-beat ${metronomeOn(run.pid) && st?.kind === 'work' && run.state === 'running' ? 'on' : ''}" aria-hidden="true"></i>` : ''}`;
}

function segArcs(units, r, stroke, cls, gapPx) {
  const { size } = RING;
  const mid = size / 2;
  const c = 2 * Math.PI * r;
  const n = units.length;
  if (!n) return '';
  const gap = n > 1 ? gapPx : 0;
  const seg = c / n;
  let out = '';
  units.forEach((u, k) => {
    const len = Math.max(1, seg - gap);
    const start = k * seg + gap / 2;
    const state = u.result ? (u.result.full === false || u.result.short ? 'part' : 'done') : 'todo';
    const just = P.justDone && P.justDone.runId === P.run.runId && P.justDone.i === u.i;
    out += `<circle class="${cls} ${state} ${just ? 'just' : ''}" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"${just ? ` style="--c:${c.toFixed(2)}"` : ''}/>`;
    if (u.current && cls === 'p-seg') {
      const ang = (start / c) * 2 * Math.PI - Math.PI / 2;
      out += `<circle class="p-mark" cx="${(mid + r * Math.cos(ang)).toFixed(2)}" cy="${(mid + r * Math.sin(ang)).toFixed(2)}" r="${stroke * 0.55}"/>`;
    }
  });
  return out;
}

/**
 * The arc's colour, decided here and nowhere else (B2-2: the colour map in
 * code, not in memory). The category gradient for work and holds; neutral grey
 * for rest, get ready and a count back in; a switch in the colour of the leg it
 * switches to, blue left and orange right. A continuous exercise's arc is the
 * whole exercise, so it keeps its category gradient through its rests. Gold and
 * green are never an arc: gold is a finished set, green a confirmed one.
 */
function arcTone(run, st) {
  if (isFlow(run)) return { cls: '', stroke: '' };
  if (P?.resumeAt || st?.kind === 'rest' || st?.kind === 'ready') return { cls: 'neutral', stroke: '' };
  if (st?.kind === 'switch' && (st.side === 'L' || st.side === 'R')) return { cls: 'side', stroke: st.side === 'L' ? 'var(--left)' : 'var(--right)' };
  return { cls: '', stroke: '' };
}

function ringSvg(run, st, now) {
  const { size, stroke, inner, r, c, ri } = RING;
  const mid = size / 2;
  const repsLike = st && (st.kind === 'reps' || st.kind === 'manual');
  const side = st?.side || sideOfStep(run, st);
  const units = E.progress(run).filter((p) => (p.side || 'B') === (side || 'B'));
  let body = '';
  if (repsLike) {
    // Reps: the outer ring is the sets on this side, confirmed ones green, a
    // category mark on the set in hand. Nothing moves with time.
    body = units.length > 1
      ? segArcs(units, r, stroke, 'p-seg', 12)
      : `<circle class="p-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>${units[0]?.result ? `<circle class="p-seg done" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>` : ''}`;
  } else {
    const frac = arcDash(run, st, now);
    body = `<circle class="p-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>`;
    // A new step's arc fades in over the phase token (Fable B12): a stroke
    // cannot animate from the work gradient to the rest colour, so the change
    // is a crossfade. Only when the step changed, never on a repaint.
    const stepNow = `${run.runId}:${run.i}`;
    const enter = !isFlow(run) && P.arcStep !== undefined && P.arcStep !== stepNow;
    P.arcStep = stepNow;
    if (frac != null) {
      const tone = arcTone(run, st);
      // style, never an attribute: an SVG attribute cannot read a CSS variable.
      const style = [tone.stroke ? `stroke:${tone.stroke}` : '', frac <= 0 ? 'opacity:0' : ''].filter(Boolean).join(';');
      body += `<circle class="p-arc ${tone.cls} ${enter ? 'enter' : ''}" data-p-arc cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})" ${style ? `style="${style}"` : ''}/>`;
    }
    // An open hold (B4-1): past the goal a second lap draws over the full arc
    // in a lighter tint of the same colour, and a still tick at 12 o'clock
    // marks the goal. Information only: no gold, no green, nothing pulses.
    const lap = lapDash(run, st, now);
    if (lap != null) {
      body += `<circle class="p-arc lap" data-p-lap cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${(lap * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})" ${lap <= 0 ? 'style="opacity:0"' : ''}/>`;
      const half = (stroke + 4) / 2;
      body += `<line class="p-goaltick" x1="${mid}" y1="${(mid - r - half).toFixed(2)}" x2="${mid}" y2="${(mid - r + half).toFixed(2)}" stroke-width="2"/>`;
    }
    // The inner ring: confirmed sets, green only once confirmed.
    if (units.length > 1) body += segArcs(units, ri, inner, 'p-iseg', 8);
  }
  P.justDone = null;   // one render's worth of the set animation
  return `<svg class="p-ringsvg ${pausedLook(run) ? 'paused' : ''}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <defs><linearGradient id="p-catgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--cat)"/><stop offset="1" style="stop-color:var(--cat-end, var(--cat))"/></linearGradient></defs>
    ${body}</svg>`;
}

function unitLine(run, st) {
  if (!st) return 'Every step done';
  const work = st.kind === 'rest' || st.kind === 'switch' || st.kind === 'ready'
    ? run.steps.slice(run.i).find((x) => E.WORK.has(x.kind)) : st;
  if (!work) return '';
  if (run.mode === 'cardio') return 'One bout';
  if (!run.targetKnown) return 'Target not specified';
  if (run.mode === 'hold' && work.units > 1) return `Hold ${work.unit} of ${work.units}${work.sets > 1 ? ` · set ${work.set} of ${work.sets}` : ''}${triesTail(run, st)}`;
  if (run.mode === 'hold') return `Hold ${work.set} of ${work.sets}${triesTail(run, st)}`;
  return `Set ${work.set} of ${work.sets}`;
}

/**
 * An open hold's attempts (B4-1): once a pause has kept a bout (10 s or more,
 * engine.js), the line says which try this is and how long the last one was,
 * "· Try 2 · last 0:24", on the clock's own rounding so it matches what the
 * clock showed as he stepped off. Plain text, nothing compared.
 */
function triesTail(run, st) {
  if (!st?.open) return '';
  const tries = run.openTries?.[run.i] || [];
  return tries.length ? ` · Try ${tries.length + 1} · last ${fmtClock(tries[tries.length - 1])}` : '';
}

function secsWords(s) {
  if (s == null) return '';
  if (s >= 60 && s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  if (s >= 60) return fmtClock(s);
  return `${s} seconds`;
}

function ringCenter(run, st, now) {
  // Coming back from a pause, the middle of the ring counts him in (2026-09-15).
  const back = resumeLeft();
  if (back != null) {
    return `<div class="p-num" data-p-clock data-p-countin>${back}</div>
      <div class="p-cap">starting</div>`;
  }
  if (!st) return '';
  if (st.kind === 'reps' || (st.kind === 'manual' && st.reps != null)) {
    return `<div class="p-num reps" data-p-reps>${esc(String(currentReps(run)))}</div>
      <div class="p-cap"><span data-p-setcap>${setCap(run, st, now)}</span></div>`;
  }
  if (st.kind === 'manual') {
    return `<div class="p-num words">Your pace</div>
      <div class="p-cap"><span class="mono" data-p-elapsed>${fmtClock(E.elapsedMs(run, now) / 1000)}</span> so far</div>`;
  }
  const rem = E.remainingSec(run, now);
  if (isFlow(run)) {
    // The big number is the step in hand: two minutes of rest, thirty seconds
    // of hold. The whole exercise's time left is the small line underneath (his
    // ask, 2026-09-16: "the big clock should show the specific durations").
    // It was the other way round, so the number he was counting down to was the
    // one he could barely read.
    const word = st.kind === 'ready' ? 'Get ready' : st.kind === 'rest' ? 'Rest' : st.kind === 'switch' ? 'Switch' : 'Hold';
    const step = fmtClock(rem);
    return `<div class="p-num ${step.length > 4 ? 'long' : ''}" data-p-clock>${step}</div>
      <div class="p-cap">${word} · <span class="mono" data-p-stepclock>${fmtClock(flowLeft(run, now))}</span> left in all</div>`;
  }
  let cap = `of ${esc(secsWords(st.secs))}`;
  // An open hold counts up past its goal until Set done (2026-09-18).
  if (st.open) {
    const secs = E.elapsedMs(run, now) / 1000;
    const up = fmtClock(secs);
    return `<div class="p-num ${up.length > 4 ? 'long' : ''}" data-p-clock>${up}</div>
      <div class="p-cap"><span data-p-goalcap>${goalCap(st, secs)}</span></div>`;
  }
  if (st.kind === 'ready') cap = P.session && run.state === 'running' ? 'Starts by itself' : 'Get ready';
  if (st.kind === 'switch') cap = `Now the ${st.side === 'L' ? 'left' : 'right'} leg`;
  if (st.kind === 'work' && run.mode === 'cardio') cap = `of ${esc(fmtMins(Math.round(st.secs / 60)))}${st.target === 'last' ? ', same as last time' : ''}`;
  const clock = fmtClock(rem);
  return `<div class="p-num ${clock.length > 4 ? 'long' : ''}" data-p-clock>${clock}</div><div class="p-cap">${cap}</div>`;
}

/**
 * The caption under a set's reps (B2-4): how long this set has run, "reps ·
 * 0:07", a plain fact like "Heaviest so far" and never compared with anything;
 * the reps are never counted or guessed from it. "reps you did" once he has
 * changed the number. For the first 3 s of an exercise's first set, while the
 * ring is Set done, it says so: "tap ring when done" (B2-3). Each part keeps to
 * one line, so the caption is two lines at most.
 */
const HINT_SECS = 3;
function setCap(run, st, now) {
  const edited = P.repsAdjust && P.repsAdjust.i === run.i && P.repsAdjust.n !== st.reps;
  const hold = st.hold ? ` <span class="p-capbit">· hold ${esc(fmtSecs(st.hold))}</span>` : '';
  if (edited) return `<span class="p-capbit">reps you did</span>${hold}`;
  const secs = E.elapsedMs(run, now) / 1000;
  if (setLive(run) && secs < HINT_SECS && !hasPrevWork(run)) return 'tap ring when done';
  return `<span class="p-capbit">reps · <span class="mono">${fmtClock(secs)}</span></span>${hold}`;
}

/**
 * The last three seconds of a timed step, seen (B2-6): as each whole second of
 * 3, 2 and 1 begins, the ring beats and the digit is stamped, with the pips.
 * Only on the step from the second before, seen within the same step, so a
 * return to the app mid count never beats late: unlocking the phone at 2.5 s
 * left used to beat at once, half a second after the pip and 0.3 s before the
 * next beat (review, 2026-09-23). A page frozen behind the lock screen never
 * runs the hidden branch at all, so the one second step is what guards it.
 * Not for an open hold, which has no end to count to.
 */
let beatAt = { key: null, n: null };
function beatCountdown(run, st, rem) {
  if (document.visibilityState !== 'visible') { beatAt = { key: null, n: null }; return; }
  if (!st || st.open || st.secs == null || rem == null || run.state !== 'running') return;
  const key = `${run.runId}:${run.i}`;
  const n = Math.ceil(rem - 1e-6);
  if (beatAt.key !== key) { beatAt = { key, n }; return; }
  if (n === beatAt.n) return;
  const next = n === beatAt.n - 1;
  beatAt.n = n;
  if (!next || n < 1 || n > 3) return;
  const ring = document.querySelector('.player[data-player] .p-ring');
  beat(ring);
  stamp(ring?.querySelector('[data-p-clock]'));
}

function paintClock(now) {
  const run = P?.run;
  if (!run) return;
  const rem = E.remainingSec(run, now);
  // Big number: the step (counting up on an open hold). Small number: the
  // whole of a continuous exercise.
  const stp = E.step(run);
  // A reps or manual step has no clock: leave what its template drew instead
  // of writing 0:00 into every clock, the zoom bar's included (2026-09-22).
  const secs = stp?.open ? E.elapsedMs(run, now) / 1000 : rem;
  const txt = secs == null ? null : fmtClock(secs);
  if (txt != null) for (const el of document.querySelectorAll('[data-p-clock]')) {
    if (el.textContent !== txt) { el.textContent = txt; el.classList.toggle('long', txt.length > 4); }
  }
  const part = document.querySelector('[data-p-stepclock]');
  if (part && isFlow(run)) {
    const t = fmtClock(flowLeft(run, now));
    if (part.textContent !== t) part.textContent = t;
  }
  const el = document.querySelector('[data-p-elapsed]');
  if (el) {
    const t = fmtClock(E.elapsedMs(run, now) / 1000);
    if (el.textContent !== t) el.textContent = t;
  }
  // A set's own clock, written only when its words change (B2-4).
  const cap = document.querySelector('.player [data-p-setcap]');
  if (cap && stp && (stp.kind === 'reps' || stp.kind === 'manual') && stp.reps != null) {
    const html = setCap(run, stp, now);
    if (cap.__html !== html) { cap.__html = html; if (cap.innerHTML !== html) cap.innerHTML = html; }
  }
  // An open hold's goal, then the time past it (B4-1).
  const gcap = stp?.open && stp.secs ? document.querySelector('.player [data-p-goalcap]') : null;
  if (gcap) {
    const html = goalCap(stp, secs);
    if (gcap.__html !== html) { gcap.__html = html; if (gcap.innerHTML !== html) gcap.innerHTML = html; }
  }
  beatCountdown(run, stp, rem);
  previewLift(run, stp, rem);
}

/**
 * The Next tile lifts once as a preview line names it (B3-1): when the rest's
 * (or the get ready's) clock crosses the time left at which the line was
 * placed (P.previewAtRem, B1-5), in step with "Right leg next." Once per
 * placed line; nothing moves in a hidden tab.
 */
let liftedFor = null;
function previewLift(run, st, rem) {
  if (!st || rem == null || P.previewAtRem == null || (st.kind !== 'rest' && st.kind !== 'ready')) return;
  if (rem > P.previewAtRem) return;
  const key = `${run.runId}:${run.i}:${P.previewAtRem}`;
  if (liftedFor === key) return;
  liftedFor = key;
  if (document.visibilityState === 'visible') lift(document.querySelector('.player [data-slot="next"] > *'));
}

/**
 * The arc, painted at most once a frame from the engine's clock while the run
 * is moving and visible. Attributes are patched in place.
 */
let arcFrame = 0;
const reduceMotionNow = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One paint of the arc and the clock; false when there is nothing timed to draw. */
function paintArcOnce() {
  const run = P?.run;
  if (!run || run.state !== 'running' || document.visibilityState !== 'visible') return false;
  const st = E.step(run);
  if (!st || st.secs == null) return false;
  const now = performance.now();
  patchArc(document.querySelector('[data-p-arc]'), arcDash(run, st, now));
  // The lap past an open hold's goal (B4-1), from the clock every frame.
  patchArc(document.querySelector('[data-p-lap]'), lapDash(run, st, now));
  paintClock(now);
  return true;
}
function patchArc(el, frac) {
  if (!el || frac == null) return;
  const dash = `${(frac * RING.c).toFixed(2)} ${RING.c.toFixed(2)}`;
  if (el.getAttribute('stroke-dasharray') !== dash) el.setAttribute('stroke-dasharray', dash);
  // Opacity only when it changes (Fable B8): the dash is the one write a frame.
  // Hidden at nothing, or a round cap would draw a dot.
  const hide = frac <= 0;
  if (el.__hidden !== hide) { el.style.opacity = hide ? '0' : ''; el.__hidden = hide; }
}
function paintArc() {
  arcFrame = 0;
  // Frames only while a timed step is moving (Codex audit P01): a reps set, a
  // pause, a hidden page or Reduce Motion schedules none. The clock loop keeps
  // the numbers right either way.
  if (reduceMotionNow() || !paintArcOnce()) return;
  arcFrame = requestAnimationFrame(paintArc);
}
function startArc() {
  const st = P?.run ? E.step(P.run) : null;
  if (!st || st.secs == null) { stopArc(); return; }
  // Under Reduce Motion the arc steps with the clock (every 200 ms) instead of
  // sliding every frame: still the true time left, without the movement.
  if (reduceMotionNow()) { paintArcOnce(); return; }
  if (!arcFrame) arcFrame = requestAnimationFrame(paintArc);
}
function stopArc() {
  if (arcFrame) cancelAnimationFrame(arcFrame);
  arcFrame = 0;
}

// ------------------------------------------------------------ sound -------
/**
 * The now playing strip: always in its place. Music on shows the real track,
 * what it is doing (loading, playing, paused, blocked, could not play) and
 * where it is in the cycle, with Skip beside it; anything else says why there
 * is no music, with Skip dimmed.
 */
function nowPlaying(run) {
  const pool = songsAtPace(run.pid);
  const on = songOn(run.pid);
  // Nothing to pace and nothing to play means this whole bar is an announcement
  // that a feature he cannot use is unavailable (his call, 2026-09-15, after the
  // three buttons went: "shouldn't that bar that says music unavailable be
  // gone?"). The same rule, applied one box higher.
  //
  // A pace WITH no song is different and stays: that one is fixable by adding a
  // song, and it tells him which BPM to look for.
  if (!run.pace && !pool.length) return '';
  let title;
  let sub;
  let retry = false;
  let canSkip = false;
  if (!run.pace) { title = 'Music unavailable'; sub = 'No pace prescribed'; }
  else if (S.songsIndexFailed() && !pool.length) { title = 'Music unavailable'; sub = 'Your songs could not be loaded'; retry = true; }
  else if (!pool.length) { title = 'Music unavailable'; sub = `No ${run.pace} BPM song on this device`; }
  else if (!on) { title = 'Music off'; sub = `${pool.length} song${pool.length === 1 ? '' : 's'} at ${run.pace} BPM`; }
  else {
    const song = S.currentSong() || songFor(run.pid);
    title = song?.name || `Your ${run.pace} BPM song`;
    const st = S.songStatus();
    const q = S.queueInfo();
    const words = { loading: 'Loading', playing: 'Playing', paused: E.step(run)?.kind === 'work' || songThroughOn(run.pid) ? 'Paused' : 'Waits through rest',
      blocked: 'Tap Retry to play', error: 'Could not play', idle: 'Ready' }[st] || 'Ready';
    sub = `${words}${pool.length > 1 && q.position ? ` · Track ${q.position} of ${pool.length}` : ''}`;
    retry = st === 'blocked' || st === 'error';
    canSkip = pool.length > 1;
  }
  return `<span class="p-now-ico" aria-hidden="true">${I.song}</span>
    <span class="p-now-text ${on && pool.length && run.pace ? '' : 'off'}"><b>${esc(title)}</b><span>${esc(sub)}${retry ? ' <button class="p-retry" data-p="song-retry">Retry</button>' : ''}</span></span>
    <button class="p-skip" data-p="song-skip" ${canSkip ? '' : 'disabled'} aria-label="Skip to another song">${I.skipSong}<span>Skip</span></button>`;
}

function soundTools(run) {
  const metro = !!run.pace;
  const metroIsOn = metro && metronomeOn(run.pid);
  const pool = songsAtPace(run.pid);
  const usable = pool.length > 0;
  const on = usable && songOn(run.pid);
  const through = on && songThroughOn(run.pid);
  const cues = cuesOn();
  // Nothing to pace and nothing to play means three dead controls (his call,
  // 2026-09-15: "If music is unavailable and no pace is described, that music
  // player can be hidden for that workout"). The cue control always stays,
  // because every exercise has a countdown.
  if (!metro && !usable) return cueTool();
  return `
    <button class="p-tool ${metroIsOn ? 'on' : ''}" data-p="metro" ${metro ? '' : 'disabled'} aria-pressed="${metroIsOn}"
      aria-label="Metronome${metro ? ` at ${run.pace} beats per minute` : ', no pace prescribed'}">${I.metro}<span>Metronome</span></button>
    <button class="p-tool ${on ? 'on' : ''}" data-p="song" ${usable ? '' : 'disabled'} aria-pressed="${on}" aria-label="Music">${I.song}<span>Music</span></button>
    <button class="p-tool ${through ? 'on' : ''}" data-p="songthrough" ${on ? '' : 'disabled'} aria-pressed="${through}"
      aria-label="Keep music playing through rest">${I.loop}<span>Through rest</span></button>
    ${cueTool()}`;
}

/**
 * The cue control, in three states rather than two (his ask, 2026-09-15: make
 * the Silent choice reachable while he is actually in a workout).
 *
 *   Sound    the tones, ducking under his music
 *   Buzz     the same moments, felt, for when his phone is on Silent and a
 *            ducking session therefore makes no sound at all
 *   Off      neither
 *
 * One control and not three, because the three are mutually exclusive, and one
 * that cycles keeps the toolbar the width it already is. The label and the icon
 * both change, so the state is readable without pressing anything (his rule:
 * a control never changes what it does, and this one always means "the cue").
 */
/**
 * True when the cue control is the only one left, which is every exercise with
 * no prescribed pace and no song for it. A lone button in a row built for four
 * sat hard left with the width of three beside it doing nothing (his words,
 * 2026-09-15: "I really do not like that that cues button is off to the side
 * and not symmetrical... even if it was centered, there would be a lot of
 * negative space on both sides"). It becomes a full width bar instead: no
 * stranded button, and no empty thirds.
 */
function soloTools(run) {
  return !run.pace && songsAtPace(run.pid).length === 0;
}

/**
 * Whether cues are HEARD right now (2026-09-16). Buzz mode is felt instead of
 * heard, so every sound the player makes asks this first; a new sound that
 * skipped it would beep at him in the one mode he chose to be silent.
 */
function cuesHeard() {
  return cuesOn() && A.silentMode() !== 'buzz';
}

function cueTool() {
  const on = cuesOn();
  const mode = on ? (A.silentMode() === 'buzz' ? 'buzz' : 'sound') : 'off';
  const label = mode === 'sound' ? 'Cues' : mode === 'buzz' ? 'Buzz' : 'Cues off';
  const aria = mode === 'sound' ? `Countdown cues: sound. Tap for ${A.buzzCan() ? 'buzz' : 'off'}.`
    : mode === 'buzz' ? 'Countdown cues: buzz. Tap to turn off.'
      : 'Countdown cues: off. Tap for sound.';
  return `<button class="p-tool ${mode !== 'off' ? 'on' : ''}" data-p="cues"
    aria-pressed="${mode !== 'off'}" aria-label="${aria}">${mode === 'buzz' ? I.buzzIcon : I.cues}<span>${label}</span></button>`;
}

// ------------------------------------------------- the resume countdown ----
//
// His ask, 2026-09-15: "if I ever pause an exercise and then I want to restart,
// or continue, let's just put in a five second countdown before continuing every
// single time I unpause."
//
// The run stays PAUSED for the whole five, so nothing is credited to a clock he
// is not using yet. Only when it reaches zero does the engine resume.

const RESUME_SECS = 5;
let resumeTimer = null;
let countShown = null;   // the count in's digit last drawn, so each new one lands once

function clearResumeCountdown() {
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = null;
  if (P) P.resumeAt = null;
}

/** A new count in digit lands (B1-6): popped once, the moment it is drawn. */
function landCountDigit() {
  const n = resumeLeft();
  if (n == null || n === countShown) return;
  countShown = n;
  pop(document.querySelector('.player [data-p-countin]'));
  // The ring beats on 3, 2 and 1 of the count in too (B2-6), with its pips.
  if (n >= 1 && n <= 3) beat(document.querySelector('.player[data-player] .p-ring'));
}

function startResumeCountdown(ctx, { quiet = false } = {}) {
  if (!P?.run) return;
  clearResumeCountdown();
  A.unlockAudio();
  // Every caller is a tap, the one moment iOS grants the lock (2026-09-23 audit:
  // after a Pause the only request came from the timer 5 s later, and failed).
  holdWake();
  P.resumeAt = Date.now() + RESUME_SECS * 1000;
  countShown = null;
  const runId = P.run.runId;
  // After a pause, "Back in five". After a skipped rest, "Five seconds": the
  // work's own line waits for zero (B1-6).
  if (!quiet) sayLine('backin', `Back in ${RESUME_SECS}`, { force: true });
  else sayLine('five', 'Five seconds', { force: true });
  // Counted the same way a step's end is counted, so the pips mean the same
  // thing wherever he hears them: three, two, one, then it is running.
  if (cuesOn()) {
    if (cuesHeard()) A.scheduleCountIn(RESUME_SECS);
    // Felt in every mode, like every other cue (item 5), and scheduleBuzzes
    // clears any stale hold buzzes first.
    scheduleBuzzes(RESUME_SECS);
  }
  refresh();
  landCountDigit();
  resumeTimer = setInterval(() => {
    if (!P?.run || !P.resumeAt) { clearResumeCountdown(); return; }
    const left = Math.ceil((P.resumeAt - Date.now()) / 1000);
    if (left > 0) { refresh(); landCountDigit(); return; }
    clearResumeCountdown();
    if (P.run.state === 'paused' || P.run.state === 'interrupted') {
      const wall = Date.now();
      const evs = E.resume(P.run, performance.now(), wall) || [];
      if (evs.length) announceEvents(evs);
      writeDraft();
      // Read before syncEffects, which schedules the step's own end tone.
      const tail = A.endToneLeft();
      // The count in's "now" tone rings out even when the audio clock is late
      // (review, 2026-09-23): only once the run is really running again.
      if (P.run.state === 'running') A.claimCountInTone();
      syncEffects();
      // Zero lands (B1-6): the tone that means now ends the count, and the
      // step's own line follows it, only if this is still the run he resumed
      // and it is running.
      if (P?.run?.runId === runId && P.run.state === 'running') {
        const line = stepLine(P.run);
        if (line) sayLineAt(line[0], line[1], Math.max(0.25, tail + 0.05));
      }
    }
    refresh();
  }, 200);
}

/** Seconds left before the run comes back, or null. */
function resumeLeft() {
  if (!P?.resumeAt) return null;
  return Math.max(0, Math.ceil((P.resumeAt - Date.now()) / 1000));
}

function patchTools(root, run) {
  const el = root.querySelector('[data-slot="tools"]');
  if (!el) return;
  const html = soundTools(run);
  // Patch attributes on the same buttons: focus and a press in progress stay.
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const fresh = tmp.querySelectorAll('[data-p]');
  const live = el.querySelectorAll('[data-p]');
  if (fresh.length !== live.length) { el.innerHTML = html; return; }
  fresh.forEach((f, i) => {
    const b = live[i];
    b.className = f.className;
    b.disabled = f.disabled;
    b.setAttribute('aria-pressed', f.getAttribute('aria-pressed'));
    b.setAttribute('aria-label', f.getAttribute('aria-label'));
    // The icon and word too (Cues, Buzz, Cues off): patched inside the same
    // button, so focus stays. Since the ring design only the colour changed
    // and the word kept saying Cues (found 23 Sep).
    if (b.innerHTML !== f.innerHTML) b.innerHTML = f.innerHTML;
  });
}

// ------------------------------------------------------- between / done ----
function renderBetween(ctx) {
  const s = P.session;
  const pid = s.queue[s.pos];
  const item = ITEM[pid];
  const ex = exerciseById(item.ex);
  const m = minutesFor(item, ex, state.data, null, runsFor(state.data, state.rev, pid));
  const ready = readyAfter(state.data, s.iso);
  const early = ready && ready > new Date() && !item.first;
  const title = item.title || ex?.name || item.ex;
  return `
  <div class="player between" data-player style="--cat:${CATEGORIES[ex?.cat]?.color || 'var(--ink-2)'}">
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">Workout ${s.pos + 1} of ${s.queue.length}</span></div>
    <header class="p-hero">
      <h1 class="p-title">${esc(title)}</h1>
      <div class="p-setline">${m.mins == null ? 'Target not specified' : `${m.mins} min${m.src === 'learned' ? ', usually' : m.src === 'estimate' ? ', estimated' : ''}`}</div>
    </header>
    ${item.img ? `<div class="p-img still"><img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async"></div>` : ''}
    ${early ? `<div class="notice info p-readynote">Rest of your workout after ${esc(fmtTime12(ready))}.</div>` : ''}
    <div class="p-actions static">
      <div class="p-row1">
        <button class="btn big p-pause" data-p="skip-ex">${I.skip}<span>Skip this one</span></button>
        <button class="btn big primary" data-p="start-next">${I.play}<span>Start</span></button>
      </div>
      <div class="p-row2 one"><button class="btn p-link" data-p="end">End workout</button></div>
    </div>
  </div>`;
}

/**
 * The finish, revision 3. Shown once, inside the player:
 *   - the whole plan done: the day ring in its category colours with a green
 *     check drawn in its centre, "Plan Complete!", one warm line, the count,
 *     the recorded workout time, and a new milestone in the same summary
 *   - the tendon loading: a calm acknowledgment and when the rest may start
 *   - ended early: the facts, no celebration
 * A revisit, a reload or a sync shows the same facts without replaying it.
 */
function renderDone(ctx) {
  const iso = P.session?.iso || P.run?.iso || todayIso();
  const planned = oneTendon(state.data, iso, plannedItems(state.data, iso).filter((p) => !p.notYet));
  const entries = getDay(iso)?.entries || [];
  const back = ctx.playerFrom === 'program' ? 'My Program' : 'Today';

  if (P.stopForGap) {
    const r = readyAfter(state.data, iso);
    return `
    <div class="player done-screen gap" data-player>
      <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">Today · first job done</span></div>
      <div class="fin">
        <div class="fin-ring calm">${I.check}</div>
        <h2 class="fin-title">${esc(ITEM[P.stopForGap]?.title || 'Logged')}</h2>
        <p class="fin-line">${r ? `Rest of your workout after ${esc(fmtTime12(r))}.` : 'The rest of your workout waits six hours.'}</p>
        <button class="btn big primary fin-act" data-p="close">${I.list}<span>Back to ${esc(back)}</span></button>
      </div>
    </div>`;
  }

  const all = planned.length > 0 && planned.every((p) => itemStatus(p, entries).state === 'done');
  const fresh = all && !finishSeen(state.data, iso) && iso === todayIso();
  const newOnes = all && iso === todayIso() ? unseenMilestones(state.data, iso) : [];
  const moment = fresh ? milestoneSentence(newOnes) : null;
  P.celebrate = fresh ? { iso, milestones: newOnes.map((m) => m.key) } : null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mins = workoutMinutes(entries);

  if (all) {
    // Constellation Close (ChatGPT's handoff, 2026-09-16), the largest moment.
    // The copy is theirs and it is neutral on purpose: this used to say "Plan
    // Complete!" and "Nice work sticking to your plan", which praises him, and
    // the rule is to celebrate finishing the plan, never effort. The ring is
    // drawn plain in its category colours and celebrate.js lays the gold over it:
    // played once when fresh (quietly under reduced motion, which it handles),
    // and drawn settled on any repaint or later visit, so the gold never
    // vanishes once earned (review, 2026-09-16). The exercise just finished
    // draws its own segment first when it plays.
    const done = planned.filter((p) => itemStatus(p, entries).state === 'done').length;
    // His streak on plan (B3-5), derived here and never stored: shown from 2,
    // a fact about the plan, never about effort.
    const streak = planStreak(state.data, iso);
    const ring = dayRing(planned, entries, {
      size: 230, stroke: 14, center: 'custom',
      middle: `<small>${done} of ${planned.length}</small><b>Complete</b>`,
      closing: fresh ? P.run?.pid || null : null,
    });
    return `
    <div class="player done-screen all" data-player>
      <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">Today's plan</span></div>
      <div class="cel-day" ${fresh ? 'data-play' : 'data-settled'}>
        <div class="fin-ringhost">${ring.html}</div>
        <div class="cel-daycopy">
          <span class="cel-eyebrow">Plan complete</span>
          <span class="cel-sub">Everything planned is logged</span>
          ${streak >= 2 ? `<span class="cel-streak"><b class="cel-streakn">${streak}</b> days in a row on plan</span>` : ''}
          ${mins != null ? `<span class="cel-fact">Recorded workout time <b>${esc(fmtMins(mins.min))}</b></span>` : ''}
          <div class="cel-week">${weekDots(iso, { key: false })}</div>
        </div>
        ${moment ? `<div class="fin-ms ${reduce ? '' : 'play'}" style="--land-at:1500ms"><span class="ms-badge earned">${BADGE_ICON}</span>
          <span class="ms-text"><b>${esc(moment.headline)}</b><span>Milestone unlocked</span></span></div>` : ''}
        <button class="cel-daydone" data-p="viewlog">Done</button>
      </div>
    </div>`;
  }

  const ring = dayRing(planned, entries, { size: 180, stroke: 12, center: 'check' });
  return `
  <div class="player done-screen" data-player>
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">Today</span></div>
    <div class="fin">
      <div class="fin-ring">${I.check}</div>
      <h2 class="fin-title">Workout finished</h2>
      <section class="fin-card">
        <div class="fin-count"><b>${ring.done} of ${ring.total}</b><span>planned exercises</span></div>
        ${mins != null ? `<div class="fin-row"><span>Recorded workout time</span><b>${esc(fmtMins(mins.min))}</b></div>` : ''}
      </section>
      <button class="btn big primary fin-act" data-p="viewlog">${I.list}<span>View today's log</span></button>
    </div>
  </div>`;
}

const BADGE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5.5"/><path d="M9 13.8L7.5 21l4.5-2.4 4.5 2.4-1.5-7.2"/></svg>';

/**
 * Work plus recovery the player measured today, one per run. Only measured
 * time: exercises ticked without the player add nothing, and the label says
 * "Recorded" so it never passes for the whole workout.
 */
function workoutMinutes(entries) {
  const runs = new Map();
  for (const e of entries) if (e.logged && e.timing?.runId) runs.set(e.timing.runId, e.timing);
  if (!runs.size) return null;
  let secs = 0;
  for (const t of runs.values()) secs += (t.activeSec || 0) + (t.restSec || 0);
  return { min: Math.max(1, Math.round(secs / 60)), partial: entries.some((e) => e.logged && !e.timing) };
}

/**
 * The day finish gets its music (B3-5), on the first unsettled draw only, in
 * step with Constellation Close: the rising five and the chord where cues are
 * heard (Reduce Motion included, as the set's bell is), "That's everything for
 * today!" at 1140 ms as the words rise (a completion line, so it follows
 * "Exercise done!" if that is still sounding, and only while the finish is on
 * screen), the streak's number rolling up to today's at 1140 ms, and today's
 * check in the week drawing at 1300 ms (CSS). A later visit is static and silent.
 */
function dayFinishMoment(day) {
  if (cuesHeard()) A.scheduleDay();
  setTimeout(() => {
    if (day.isConnected && P?.phase === 'done') sayLine('alldone', "That's everything for today", { force: true });
  }, 1140);
  const n = day.querySelector('.cel-streakn');
  if (!n || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const to = n.textContent;
  n.textContent = String(Math.max(0, Number(to) - 1));
  setTimeout(() => {
    if (!n.isConnected) return;
    n.textContent = to;
    n.classList.add('roll');
    setTimeout(() => n.classList.remove('roll'), 420);
  }, 1140);
}

/**
 * The last seven days (F35): a check for a plan done, a line for planned rest,
 * an outlined circle for a known day not completed, and a small neutral dot
 * for a day before dated plans began, never an empty "missed" circle.
 */
export function weekDots(iso, { key = true } = {}) {
  const cells = [];
  let firstKnown = null;
  let anyUnknown = false;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(iso, -i);
    const r = dayComplete(state.data, d);
    const letter = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
    const kind = !r ? 'unknown' : !r.planned ? 'rest' : r.complete ? 'done' : 'open';
    if (kind === 'unknown') anyUnknown = true; else if (!firstKnown) firstKnown = d;
    const word = { unknown: 'no plan recorded', rest: 'planned rest', done: 'plan complete', open: 'not complete' }[kind];
    // Today's cell is marked, and its check carries a length of 14 so the day
    // finish can draw it in (B3-5, checkdraw).
    const now = i === 0;
    const check = now ? I.check.replace('<path ', '<path pathLength="14" ') : I.check;
    cells.push(`<span class="wd ${kind}${now ? ' wd-now' : ''}" role="img" aria-label="${esc(fmtDate(d, 'dow'))}: ${word}"><small>${esc(letter)}</small><i>${kind === 'done' ? check : kind === 'rest' ? '<b></b>' : kind === 'unknown' ? '<em></em>' : ''}</i></span>`);
  }
  const since = anyUnknown && firstKnown ? `Plans recorded since ${new Date(firstKnown + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
  return `<div class="weekdots" role="group" aria-label="The last seven days">${cells.join('')}</div>
    ${key ? `<div class="weekdots-key">${since ? `${esc(since)} · ` : ''}Planned rest counts</div>` : ''}`;
}

// ------------------------------------------------------------- review ----
function renderReview(ctx, run, item, ex) {
  const sum = E.summary(run);
  const title = item.title || ex?.name || item.ex;
  P.reviewStartedWall ||= Date.now();
  const unit = state.data.settings.weightUnit;
  // Last time's load, in today's unit: a 50 lb entry is 22.68 kg, never "50 kg".
  const prevLoad = (side) => {
    const e = lastEntry(item.ex, side);
    const l = num(e?.load);
    if (!l) return null;
    return round(fromKg(toKg(l, e.loadUnit || unit), unit), 2);
  };
  const showLoad = GYM_PROGRAM.includes(item) || [...new Set(sum.sides.map((s) => s.side))].some((s) => prevLoad(s) > 0);
  const band = state.data.program.band[item.id] ?? item.band ?? '';
  const r = (P.review ||= { rpe: null, discomfort: null, notes: '', inaccurate: false, sides: {} });
  const changed = P.base != null && rowsFingerprint(getDay(run.iso), run.pid) !== P.base
    && (getDay(run.iso)?.entries || []).some((e) => e.pid === run.pid && e.logged && e.runId !== run.runId);

  const sideRows = sum.sides.map((s) => {
    // What the sets recorded. If he went back and redid a set, the review
    // takes the new numbers; his own edits to load, band and minutes stay.
    const sig = JSON.stringify([s.sets, s.repsBySet, s.secsList]);
    const prev = r.sides[s.side];
    const v = (r.sides[s.side] = prev && prev.sig === sig ? prev : {
      sig,
      sets: s.sets,
      repsBySet: s.repsBySet.slice(),
      minutes: prev?.minutes ?? (run.mode === 'cardio' ? workMinutes(s.secsList) : null),
      load: prev && 'load' in prev ? prev.load : (showLoad ? prevLoad(s.side) : undefined),
      band: prev?.band ?? band,
      freeReps: prev?.freeReps,
    });
    const reps = run.mode === 'reps' || (run.mode === 'manual' && run.targetKnown);
    return `<div class="rv-side" data-rv-side="${esc(s.side)}">
      <div class="rv-head">${s.side === 'B' ? '<b>Both legs</b>' : sideTag(s.side)}
        <span class="tiny muted">${s.anyDone ? (s.full ? 'all done' : (run.mode === 'hold' ? `${s.secsList.length} of ${s.planned} holds` : `${s.sets} of ${plannedSets(run, s.side)} sets`)) : 'nothing done'}</span></div>
      <div class="rv-fields">
        ${run.mode === 'cardio' ? `<label class="fld">Minutes<input class="in-num" type="number" min="0" step="1" data-rv="minutes" value="${v.minutes ?? ''}"></label>` : ''}
        ${run.mode === 'hold' || run.mode === 'timed' ? `<div class="rv-holds">${s.secsList.length
          ? s.secsList.map((x) => `<span class="rv-chip">${esc(fmtSecs(x))}</span>`).join('')
          : '<span class="tiny muted">none</span>'}</div>` : ''}
        ${reps ? `<div class="rv-reps">${(v.repsBySet.length ? v.repsBySet : []).map((n, i) => `
          <label class="fld">Set ${i + 1}<input class="in-num" type="number" min="0" step="1" data-rv="rep" data-set="${i}" value="${n ?? ''}"></label>`).join('')
          || '<span class="tiny muted">no sets done</span>'}</div>` : ''}
        ${!run.targetKnown ? `<label class="fld">Sets<input class="in-num" type="number" min="0" step="1" data-rv="sets" value="${v.sets ?? ''}"></label>
          <label class="fld">Reps<input class="in-num" type="number" min="0" step="1" data-rv="freereps" value="${v.freeReps ?? ''}"></label>` : ''}
        ${showLoad ? `<label class="fld">Load ${esc(unit)}<input class="in-num" type="number" min="0" step="any" data-rv="load" value="${v.load ?? ''}"></label>` : ''}
        ${ex?.usesBand ? `<label class="fld">Band<select class="sel-sm" data-rv="band">
          <option value="">none</option>${THERABAND.map((b) => `<option value="${b.id}" ${v.band === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
      </div>
    </div>`;
  }).join('');

  const scale = (key, label) => `<div class="rv-scale" role="group" aria-label="${esc(label)}">
    <span class="rv-scale-label">${esc(label)}<b class="rv-scale-val">${r[key] == null ? '' : ` ${r[key]} of 10`}</b></span>
    <span class="rv-scale-btns">${Array.from({ length: 11 }, (_, i) => `<button class="rv-dot ${r[key] === i ? 'on' : ''}" data-rv-scale="${key}" data-v="${i}" aria-pressed="${r[key] === i}">${i}</button>`).join('')}</span>
  </div>`;

  return `
  <div class="player review" data-player>
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">${P.session ? `Workout · ${P.session.pos + 1} of ${P.session.queue.length}` : 'Exercise'}</span></div>
    <header class="p-hero">
      <div class="p-label">${sum.complete ? 'CONFIRM' : 'SAVE WHAT YOU DID'}</div>
      <h1 class="p-title">${esc(title)}</h1>
      <div class="p-setline">${sum.done} of ${sum.total} ${run.mode === 'hold' ? 'holds' : 'sets'} done · ${esc(fmtClock(sum.activeSec))} active${sum.restSec ? ` · ${esc(fmtClock(sum.restSec))} rest` : ''}</div>
    </header>
    ${changed ? `<div class="notice warn">This exercise was logged on another device while you worked. Saving keeps that entry and adds this workout beside it.</div>` : ''}
    <section class="card rv">
      <div class="card-body">
        ${sideRows}
        ${scale('discomfort', 'Discomfort (optional)')}
        ${scale('rpe', 'Effort (optional)')}
        <label class="fld wide">Note<input data-rv="notes" value="${esc(r.notes || '')}" placeholder="Optional"></label>
        <label class="rv-check"><input type="checkbox" data-rv="inaccurate" ${r.inaccurate ? 'checked' : ''}><span>Timing was inaccurate</span></label>
      </div>
    </section>
    <div class="p-actions static">
      <div class="p-row1">
        <button class="btn big p-pause" data-p="prev">${I.prev}Back to the sets</button>
        <button class="btn big primary" data-p="save" ${sum.anyDone ? '' : 'disabled'}>${I.check}Save and continue</button>
      </div>
    </div>
  </div>`;
}

function plannedSets(run, side) {
  const sets = run.steps.filter((x) => x.side === side && E.WORK.has(x.kind)).map((x) => x.set || 1);
  return sets.length ? Math.max(...sets) : 0;
}

function collectReview(run, item) {
  const sum = E.summary(run);
  const r = P.review || {};
  const sides = sum.sides.map((s) => {
    const v = r.sides?.[s.side] || {};
    const repsBySet = (v.repsBySet || s.repsBySet).map((x) => (x == null || x === '' ? null : Number(x)));
    const countsReps = run.mode === 'reps' || (run.mode === 'manual' && run.targetKnown);
    // Completion comes from the numbers he CONFIRMED here, not from what the
    // player first recorded: a set changed to 0 is not done, and a set below
    // its target is done but short.
    const target = run.steps.find((x) => x.side === s.side && E.WORK.has(x.kind))?.reps ?? null;
    const planned = plannedSets(run, s.side);
    let full = s.full;
    let anyDone = s.anyDone;
    let short = false;
    let sets = s.sets;
    if (countsReps) {
      const didSets = repsBySet.filter((x) => x != null && x > 0);
      sets = didSets.length;
      anyDone = sets > 0;
      full = sets >= planned;
      short = target != null && didSets.some((x) => x < target);
    }
    const doneReps = repsBySet.filter((x) => x != null && x > 0);
    const same = doneReps.length && doneReps.every((x) => x === doneReps[0]);
    let reps = doneReps.length ? (same ? doneReps[0] : Math.max(...doneReps)) : null;
    if (run.mode === 'hold') reps = doneReps.length ? Math.max(...doneReps) : null;
    if (!run.targetKnown) {
      sets = num(v.sets);
      reps = num(v.freeReps);
      anyDone = s.anyDone && sets !== 0 && reps !== 0;
    }
    // An open hold's row reads its best attempt, not the average of its tries.
    const open = run.steps.some((x) => x.open);
    const secs = !s.secsList.length ? null : open ? Math.max(...s.secsList) : Math.round(s.secsList.reduce((a, b) => a + b, 0) / s.secsList.length);
    // Cardio (Codex audit B02): the minutes are the work itself, from the
    // seconds the bout ran. Get ready, rest and time away are not exercise.
    // A number typed on the retry screen wins. One decimal, never rounded up.
    const cardioMin = num(v.minutes) ?? workMinutes(s.secsList);
    return {
      side: s.side,
      anyDone,
      full: anyDone && full,
      short,
      // A cardio bout is not a set: stored as minutes only, so no row reads "1 sets".
      sets: run.mode === 'cardio' ? null : sets,
      reps,
      repsBySet: countsReps ? repsBySet : [],
      // Seconds each reps set took, his pace (README "per set pace"): the engine
      // measured it all along but it was never passed on, so no row had it.
      tookBySet: countsReps ? (s.tookBySet || null) : null,
      secs: run.mode === 'cardio' ? null : secs,
      secsList: run.mode === 'cardio' ? [] : s.secsList,
      minutes: run.mode === 'cardio' ? cardioMin : null,
      load: v.load === undefined ? undefined : num(v.load),
      loadUnit: v.load != null ? state.data.settings.weightUnit : undefined,
      // With no review screen, the band is the one set for this exercise.
      band: exerciseById(item.ex)?.usesBand ? (v.band ?? state.data.program.band?.[item.id] ?? item.band ?? '') : undefined,
    };
  });
  const planSides = new Set(run.steps.filter((x) => E.WORK.has(x.kind)).map((x) => x.side || 'B'));
  const complete = sides.length === planSides.size && sides.every((x) => x.full);
  return {
    sides,
    complete,
    // Only a run done as prescribed, with honest timing, trains the estimate.
    trainable: complete && !sides.some((x) => x.short) && sum.asPrescribed !== false,
    rpe: r.rpe ?? null,
    discomfort: r.discomfort ?? null,
    notes: (r.notes || '').trim(),
    inaccurate: !!r.inaccurate,
    timing: {
      activeSec: sum.activeSec,
      restSec: sum.restSec,
      awaySec: sum.awaySec,
      interruptions: sum.interruptions,
      reviewSec: P.reviewStartedWall ? Math.round((Date.now() - P.reviewStartedWall) / 1000) : null,
    },
  };
}

let saving = false;
function saveCurrent() {
  if (saving || !P?.run) return false;
  const run = P.run;
  // Already in the document? (A08) Read the entries themselves, never a
  // "saved" flag set before the write was durable: after a failed save and a
  // reload the draft still carries the run, and it must be applied again.
  // In memory is not saved: after a failed flush the rows are here but not on
  // disk, and returning early meant a retry wrote nothing (audit F27). saveRun
  // is idempotent on runId, so running it again is safe.
  if ((getDay(run.iso)?.entries || []).some((e) => e.runId === run.runId && e.logged) && !saveOutstanding()) return true;
  saving = true;
  try {
    const item = ITEM[run.pid];
    const review = collectReview(run, item);
    if (!review.sides.some((x) => x.anyDone)) {
      // Nothing done (every set skipped or at zero): nothing to record, and
      // saying "Saved" would be a lie.
      return 'empty';
    }
    let inferred = null;
    update(() => {
      const day = ensureDay(run.iso);
      saveRun(day, { item, run, review, level: levelOf(state.data, item) });
      // A balance held as long as it lasts: each leg's best is the day's test.
      if (item?.stopwatch) recordBestTests(state.data, run.iso, item);
      // The tendon loading marks the collagen one gap earlier when he has
      // not marked it (2026-09-16). This is the path he actually uses; only the
      // tick used to do it.
      if (item?.first) inferred = inferCollagen(state.data, run.iso, new Date(), ensureDay) || null;
    });
    // A guess must never beat a real tick made on another device (rule zero).
    if (inferred) weakenDayPath(inferred.iso, `supps.${inferred.id}`);
    (P.savedRunIds ||= []).push(run.runId);
    return true;
  } finally {
    saving = false;
  }
}

let currentCtx = null;

/**
 * The last set is done: log it and keep going. No review screen in the flow
 * (his call, 2026-09-14: "If I complete the sets, it should just log it as
 * completed. I can always go back in"). Numbers are corrected afterwards in
 * the row on Today. The save is durable before anything moves on; if it
 * fails, the review screen stays as the place to retry.
 *
 * After the tendon loading the workout stops, because the rest of the day
 * waits six hours. After anything else the next exercise opens with a short
 * get ready and starts by itself. Music carrying on (Keep playing) is not cut
 * at the handover (F14): only the clock stops while the save runs.
 */
async function finishRun(ctx, { leave = false } = {}) {
  if (!P?.run || P.finishing) return;
  P.finishing = true;
  const run = P.run;
  const item = ITEM[run.pid];
  stopClock();
  // The day thread's segment for this exercise is held back until the seal
  // lands in it (B3-3); only for an exercise that was not already done.
  const thread = P.session ? document.querySelector('.player[data-player] .p-thread') : null;
  if (thread && itemStatus(item, getDay(run.iso)?.entries || []).state !== 'done') P.threadPending = item.id;
  const saved = saveCurrent();
  if (saved === true) {
    const ok = await flushSave();
    // The player may have been closed while the save was in flight (2026-09-23 audit).
    if (!P || P.run !== run) return;
    if (!ok) {
      P.finishing = false;
      P.threadPending = null;
      stopEffects();
      announce('Not saved yet. Your workout is kept here.');
      toast('<b>Not saved yet</b><br><span>Your workout is kept here. Tap Save to try again.</span>', 'warn', { key: 'player-save' });
      currentRerender?.();
      return;
    }
    // The draft records the save before anything says so.
    writeDraft();
    // The seal's end, for what waits on it (the step back offer, B3-4).
    let sealEnd = () => {};
    const sealed = new Promise((res) => { sealEnd = res; });
    savedMoment(item, run, { complete: E.summary(run).complete, sealed });
    // Orbit Seal (ChatGPT's handoff, 2026-09-16) for an exercise actually
    // FINISHED, every set done. It replaces the receipt and the toast, and it
    // never asks for anything: it dismisses itself. A partial save ("Save what I
    // did") is not a finish, so it gets the plain toast and no celebration,
    // because the rule is to celebrate completing the plan, never effort.
    if (E.summary(run).complete) {
      // The seal lands in the day thread when it is on screen (B3-3).
      try { await orbitSeal({ title: nameOf(item), ringEl: document.querySelector('.player .p-ring'), landEl: thread?.isConnected ? thread : null }); } finally { sealEnd(); }
    } else {
      sealEnd();
      if (leave || !P.session || item.first) toast(`<b>Logged</b><br><span>${esc(nameOf(item))}</span>`, 'good', { key: 'player-logged' });
      else showReceipt(nameOf(item));
    }
  }
  if (!P || P.run !== run) return;
  P.finishing = false;
  // The seal has landed: the next render draws this exercise's segment in.
  if (P.threadPending === item.id) {
    P.threadPending = null;
    if (saved === true && itemStatus(item, getDay(run.iso)?.entries || []).state === 'done') P.threadDraw = item.id;
  }
  if (leave || !P.session) {
    stopEffects();
    clearDraft();
    notifyIdle();
    ctx.go(ctx.playerFrom || 'today');
    return;
  }
  // Nothing was done on the first job (Next through every set): nothing is
  // logged, so there is no recovery break to wait for (Fable A1). Back to
  // Today, which says so once, and the row stays unticked. No confirm step.
  if (item.first && saved === 'empty') {
    leaveEmptyFirst(ctx, item);
    return;
  }
  if (item.first) {
    stopEffects();
    P.phase = 'done';
    P.stopForGap = item.id;
    writeDraft();
    // His report, 2026-09-16: "the celebration screen that I clicked confirm on
    // was pretty stale and boring." That was this screen, which waited for a tap
    // on Back to Today. The Orbit Seal has now celebrated the finish, and Today
    // already says when the rest of his workout may start, so it closes the
    // session the same way that button did and goes there. Nothing to confirm.
    if (saved === true) { closePlayer(ctx, currentRerender, { keepCompletion: true }); return; }
    currentRerender?.();
    return;
  }
  moveOn(P.session);
  if (P.phase === 'between') {
    const nextPid = P.session.queue[P.session.pos];
    // The music carries on only into an exercise that plays the same way.
    if (!(songFor(nextPid) && songThroughOn(nextPid) && S.songWanted())) stopEffects();
    startNextNow();
  } else {
    stopEffects();
  }
  writeDraft();
  currentRerender?.();
}

/**
 * The one saved moment (B1-4, seam S7), on every durable save path: finishing,
 * changing exercise with sets done, and the retry screen's Save. Called only
 * once the save is on this device, so every sound here means "it is written
 * down", never "you stopped": the announcement, the step back offer, the saved
 * chime (C E G, kept so nothing cuts it), the end buzz, and for an exercise
 * finished in full "Exercise done!", which follows the chime as the seal's
 * words rise. A failed save says nothing: the toast and the retry screen do.
 */
function savedMoment(item, run, { complete = false, receipt = false, sealed = null } = {}) {
  announce(`Logged ${nameOf(item)}`);
  offerStepBack(item, run, sealed);
  if (cuesHeard()) A.scheduleFinish();
  if (cuesOn()) buzz('end');
  if (complete) sayLineAt('exdone', 'Exercise done', 0.45);
  if (receipt) showReceipt(nameOf(item));
}

const RECEIPT_MS = 240 + 1500;   // enter, then readable for about a second and a half
let receiptTimer = null;
/** "Logged · title" in the status line, put back in place so nothing re-renders. */
function showReceipt(title) {
  P.receipt = { title, until: Date.now() + RECEIPT_MS, shown: false };
  clearTimeout(receiptTimer);
  receiptTimer = setTimeout(() => {
    if (!P) return;
    P.receipt = null;
    const slot = document.querySelector('.player [data-slot="status"]');
    if (slot && P.run) slot.innerHTML = statusLine(P.run);
  }, RECEIPT_MS);
}

/** Open the session's next exercise and start its get ready. */
function startNextNow() {
  const s = P.session;
  const pid = s.queue[s.pos];
  P.run = newRun(pid, s.iso, { readySec: NEXT_READY_SEC });
  P.base = rowsFingerprint(getDay(s.iso), pid);
  // A fresh pick for each exercise, unless the music is meant to carry on.
  if (!(songFor(pid) && songThroughOn(pid))) {
    P.songSha = null;
    P.songPos = 0;
  } else {
    P.songPos = S.songPosition() || P.songPos || 0;
  }
  P.phase = 'run';
  // It introduces itself once its push has landed (B3-2).
  P.introRun = P.run.runId;
  // Only with the player on screen: left during the save, the next exercise
  // waits at Start instead of running with nothing ticking it, which credited
  // its timed sets as full on return (2026-09-22 audit).
  if (player()) { E.start(P.run, performance.now(), Date.now()); sayStart(); }
}

/** After a save: the next exercise in the session, or the finish. */
function afterSave(ctx, saved = true) {
  const s = P.session;
  if (!s) { clearDraft(); ctx.go(ctx.playerFrom || 'today'); return; }
  // A retried save follows the same rules as the automatic one: the tendon
  // loading stops for the recovery break, anything else carries on. An empty
  // save of the first job logs nothing and starts no break (Fable A1).
  const item = ITEM[P.run?.pid];
  if (item?.first && saved === 'empty') { leaveEmptyFirst(ctx, item); return; }
  if (item?.first) { P.phase = 'done'; P.stopForGap = item.id; writeDraft(); return; }
  moveOn(s);
  if (P.phase === 'between') startNextNow();
  writeDraft();
}

/** Leave the player after a first job with nothing done, and tell Today once. */
function leaveEmptyFirst(ctx, item) {
  const iso = P.run?.iso;
  stopEffects();
  clearDraft();
  notifyIdle();
  ctx.todayNotice = { iso, text: `Nothing logged for ${item.title || exerciseById(item.ex)?.name || item.ex}` };
  announce(ctx.todayNotice.text);
  ctx.go('today');
}

function moveOn(s) {
  const entries = getDay(s.iso)?.entries || [];
  let pos = s.pos + 1;
  while (pos < s.queue.length && itemStatus(ITEM[s.queue[pos]], entries).state === 'done') pos++;
  if (pos >= s.queue.length) {
    P.phase = 'done';
    P.review = null;
    writeDraft();
    return;
  }
  s.pos = pos;
  P.phase = 'between';
  P.review = null;
  P.reviewStartedWall = null;
  writeDraft();
}

// ------------------------------------------------- choose the exercise ----
// Swipe the title and pictures to change exercise without leaving the player
// (his ask, 2026-09-14 late). Left is the next exercise in today's list, right
// the previous one; anything already done is passed over. Sets already
// confirmed on the one being left are saved first, the same way finishing
// saves them (fewer than prescribed reads as done but short, and he corrects
// it on Today). A run with nothing confirmed is simply dropped. The chosen
// exercise opens on its get ready without starting, so choosing never starts
// a clock, and the workout carries on from there in the list's order.

/** Today's exercises he can move between, in Today's order. */
function exerciseChoices(iso, currentPid) {
  // The plan being worked through (a future day's, when started from it), done
  // or not by the day it logs to.
  const planIso = P?.session?.planIso || iso;
  const entries = getDay(iso)?.entries || [];
  return plannedItems(state.data, planIso)
    .filter((p) => !p.notYet && (p.id === currentPid || itemStatus(p, entries).state !== 'done'))
    .map((p) => p.id);
}

function swipeButtons(run) {
  const list = exerciseChoices(run.iso, run.pid);
  const i = list.indexOf(run.pid);
  const name = (pid) => { const it = ITEM[pid]; return it ? (it.title || exerciseById(it.ex)?.name || it.ex) : ''; };
  const prev = list[i - 1];
  const next = list[i + 1];
  return `<div class="p-pick" aria-label="Change exercise">
    <button class="p-pick-btn" data-p="ex-prev" ${prev ? '' : 'disabled'} aria-label="${prev ? `Previous exercise: ${esc(name(prev))}` : 'No earlier exercise'}">${I.left}</button>
    <span class="p-pick-dots" aria-hidden="true">${list.length > 1 ? list.map((pid) => `<i class="${pid === run.pid ? 'on' : ''}"></i>`).join('') : ''}</span>
    <button class="p-pick-btn" data-p="ex-next" ${next ? '' : 'disabled'} aria-label="${next ? `Next exercise: ${esc(name(next))}` : 'No later exercise'}">${I.right}</button>
  </div>`;
}

async function switchExercise(ctx, dir) {
  if (!P?.run || P.finishing || P.phase !== 'run' || saving) return;
  clearResumeCountdown();
  const run = P.run;
  const iso = run.iso;
  const list = exerciseChoices(iso, run.pid);
  const pid = list[list.indexOf(run.pid) + dir];
  if (!pid) return;
  const item = ITEM[run.pid];
  // A hold or timed bout under way keeps its seconds, exactly as Close then
  // Save what I did keeps them (Codex audit B10). Before this, a first hold
  // part done was dropped because nothing was "done" yet.
  E.capturePartial(run, performance.now());
  if (E.summary(run).anyDone) {
    P.finishing = true;
    player()?.setAttribute('aria-busy', 'true');
    stopClock();
    // Hold the run still while it saves; on a failure it stays here, paused,
    // with every confirmed set.
    if (run.state === 'running') E.pause(run, performance.now(), Date.now());
    writeDraft();
    const saved = saveCurrent();
    if (saved === true) {
      const ok = await flushSave();
      if (!P || P.run !== run) return;   // closed while saving (2026-09-23 audit)
      if (!ok) {
        P.finishing = false;
        player()?.removeAttribute('aria-busy');
        announce('Not saved yet. Your workout is kept here.');
        toast('<b>Not saved yet</b><br><span>Stayed on this exercise so nothing is lost.</span>', 'warn', { key: 'player-save' });
        currentRerender?.();
        return;
      }
      savedMoment(item, run, { complete: E.summary(run).complete, receipt: true });
    }
    P.finishing = false;
    player()?.removeAttribute('aria-busy');
  }
  stopEffects();
  // The list from here on, with the chosen one in hand. The tendon loading
  // leads the day; it is only in the list while it is still to do.
  const queue = exerciseChoices(iso, pid);
  P.session = { queue, pos: Math.max(0, queue.indexOf(pid)), iso, planIso: P.session?.planIso || iso };
  P.run = newRun(pid, iso);
  P.base = rowsFingerprint(getDay(iso), pid);
  P.songSha = null;
  P.songPos = 0;
  P.repsAdjust = null;
  P.swipeDir = dir;
  writeDraft();
  const it = ITEM[pid];
  announce(`${it.title || exerciseById(it.ex)?.name || it.ex}, ${P.session.pos + 1} of ${queue.length}`);
  currentRerender?.();
}

const player = () => document.querySelector('[data-player]');

function bindSwipe(zone, ctx) {
  if (!zone) return;
  let start = null;
  zone.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const quick = Date.now() - start.t < 800;
    start = null;
    if (quick && Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      // A swipe is not a tap: the picture must not open as well.
      zone.dataset.swiped = String(Date.now());
      switchExercise(ctx, dx < 0 ? 1 : -1);
    }
  };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', () => { start = null; });
  zone.addEventListener('click', (e) => {
    if (zone.dataset.swiped && Date.now() - Number(zone.dataset.swiped) < 500) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}

// --------------------------------------------------------------- bind ----
// One delegated listener on the player, so patched slots never lose their
// handlers. Transport taps carry the step they were drawn for (F09): a tap
// meant for one step can never act on the next one, and the same action
// twice within 350 ms (one physical double tap) acts once.
const TRANSPORT = new Set(['pause', 'done', 'ringdone', 'skip', 'next', 'prev']);
let lastAct = { k: null, at: 0 };

/**
 * Set done lands (B2-7): a turquoise wash spreading from the ring's centre under
 * the bezel's solid disc, the set's number flying home to its segment while the
 * segment draws in green, and the rest's clock rolling in. One impact, on the
 * dial, whichever Set done he tapped (review, 2026-09-23): the dock's wash ran
 * behind its words and halved their contrast, and a wash from the finger point
 * sat lopsided across a dial where everything else is concentric (his rules:
 * words on solid ground, and symmetry). The dock's button keeps its icon press.
 * Nothing is measured in the tap: the boxes are read in the next frame. The
 * 350 ms guard and the save never wait for any of it. Low Power Mode keeps the
 * wash and the roll; Reduce Motion none.
 */
// How long the ring's middle stays clear while the set's number flies out of
// it: by then the number is under 10% (its curve), so two numbers never share
// the middle at a strength that reads (review, 2026-09-23).
const FLY_CLEAR_MS = 100;
function flightTarget(run, from, nx) {
  const was = run.steps[from.i];
  if (!was || !(was.kind === 'reps' || was.kind === 'manual') || !nx || nx.kind === 'switch') return null;
  const side = (s) => (s === 'L' || s === 'R' ? s : 'B');
  // Only when the ring goes on showing this side's sets: never the last set of
  // a side, where it turns to the other leg, nor of the exercise.
  if (side(sideOfStep(run, nx)) !== side(was.side)) return null;
  const units = E.progress(run).filter((u) => side(u.side) === side(was.side));
  const k = units.findIndex((u) => u.i === from.i);
  if (k < 0 || units.length < 2) return null;
  // A rest draws the confirmed sets on the inner ring; straight into the next
  // set, the outer ring holds them.
  return { k, n: units.length, radius: nx.kind === 'reps' || nx.kind === 'manual' ? RING.r : RING.ri };
}
function setDoneImpact(el, from) {
  const run = P?.run;
  const moved = !!run && run.runId === from.runId && run.i === from.i + 1 && run.state !== 'review';
  const nx = moved ? E.step(run) : null;
  const root = el.closest('.player[data-player]');
  if (!root || reduceMotionNow()) return;
  // The number flies in full motion only (fly() makes nothing in Low Power Mode).
  const flight = nx && from.text && !liteMotion() ? flightTarget(run, from, nx) : null;
  // The rest's clock rolls in as the set's number leaves (B2-7). With a flight
  // it waits for the number to leave the middle first (arrive, below).
  if (!flight && nx && (nx.kind === 'rest' || nx.kind === 'switch')) roll(root.querySelector('.p-ring [data-p-clock]'), 1, { ms: 220 });
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    const dial = root.querySelector('.p-dial');
    const ring = root.querySelector('.p-ring');
    if (!dial || !ring) return;
    // Under the bezel's solid disc: it washes out round the disc, never behind
    // a digit or a word.
    ripple(dial, ring.getBoundingClientRect(), dial.getBoundingClientRect(), { before: dial.querySelector('.p-dial__bezel') });
    if (!flight) return;
    const s = ring.offsetWidth / RING.size;
    const a = ((flight.k + 0.5) / flight.n) * 2 * Math.PI - Math.PI / 2;
    const flown = fly(dial, ring, from.text, [Math.cos(a) * flight.radius * s, Math.sin(a) * flight.radius * s], { size: ring.offsetWidth * 0.25 });
    // Started in the same frame as the flight, so both share one clock: the
    // middle is clear while the number crosses it, then the next number (the
    // rest's clock, or the next set's reps) rolls in.
    const centre = ring.querySelector('.p-center');
    if (flown && centre) arrive(centre, centre.querySelector('[data-p-clock], [data-p-reps]'), { delay: FLY_CLEAR_MS, ms: 220 });
  });
}

export function bindPlayer(root, ctx, rerender) {
  // Constellation Close plays once, the first time the fresh plan finish is on
  // screen. The flag lives on the element, so a repaint of the same screen does
  // not play it twice.
  const day = root.querySelector?.('.cel-day[data-play]');
  if (day && !day.dataset.played) {
    day.dataset.played = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      constellation(day.querySelector('.fin-ringhost'), {
        copy: day.querySelector('.cel-daycopy'),
        done: day.querySelector('.cel-daydone'),
      });
      dayFinishMoment(day);
    }));
  }
  const settledDay = root.querySelector?.('.cel-day[data-settled]');
  if (settledDay) {
    constellation(settledDay.querySelector('.fin-ringhost'), {
      copy: settledDay.querySelector('.cel-daycopy'),
      done: settledDay.querySelector('.cel-daydone'),
      settled: true,
    });
  }
  currentRerender = () => { if (ctx.view === 'player') rerender(); };
  currentCtx = ctx;
  const player = root.querySelector('[data-player]');
  const landed = playSlide(player);
  const run = P?.run;
  // The day thread's new segment draws in, once (B3-3): only that one, so work
  // already done is never replayed.
  const drawPid = P?.threadDraw;
  if (P) P.threadDraw = null;
  // What the render drew, so the first refresh after it rewrites neither slot:
  // a rewrite would cut the segment's draw and decode the Next picture again.
  if (P?.run && P.phase === 'run') {
    const cs = player?.querySelector('[data-slot="count"]');
    if (cs) cs.__key = countKey(countLine(P.run));
    const ns = player?.querySelector('[data-slot="next"]');
    if (ns) ns.__html = nextTile(P.run);
  }
  if (drawPid) drawSeg(player?.querySelector(`.p-thread .dr-seg.closing[data-seg-pid="${drawPid}"]`));
  rollCount(player);
  // A tap on Today's Start, Resume or Begin: the day ring grows into the dial (B3-6).
  const L = takeLaunch();
  const launching = !!L && !!run && P.phase === 'run' && run.state !== 'review' && ctx.playerFrom === 'today' && !reduceMotionNow();
  if (launching) playLaunch(player, L);
  // Next up introduces itself once the push has landed (B3-2), once per run.
  // Under a full launch the launch brings the words in; the picture still pushes.
  if (run && P.phase === 'run' && run.state !== 'review' && P.introRun === run.runId) {
    P.introRun = null;
    const words = !launching || liteMotion();
    landed.then(() => playIntro(player, run, { words }));
  }
  // Load his song ahead of the tap that starts it: iOS allows the first play
  // only inside that tap, so the file has to be ready by then.
  const song = run ? songFor(run.pid) : null;
  if (song) S.prepareSong(song, P.songPos);

  const act = (fn) => {
    if (!P?.run) return;
    // Any action ends a count back in that is under way (Skip starts a new
    // one): a stale countdown used to resume a run he had just paused again,
    // or one sitting behind the Stop sheet (2026-09-22 audit).
    clearResumeCountdown();
    A.unlockAudio();
    // A line held for the end tone is dropped once he acts (B1-4).
    cancelPendingLine();
    if (songFor(P.run.pid)) S.primeSong();
    const i0 = P.run.i;
    const events = fn(P.run, performance.now(), Date.now()) || [];
    if (events.length) announceEvents(events);
    // His minus and plus belong to the set in hand: kept through a pause, gone
    // once the step moves on (a pause used to put 8 back to 10).
    if (P.run.i !== i0) P.repsAdjust = null;
    writeDraft();
    if (P.run.state === 'review' && P.phase === 'run') { finishRun(ctx); return; }
    syncEffects();
    refresh();
  };

  bindSwipe(player?.querySelector('[data-p-swipe]'), ctx);
  // The audio context is built while nothing is moving, a moment after the
  // player opens (Fable B6), so Start only resumes it and a swipe or an arrow
  // never waits on it.
  // A no-op when Today's Start already warmed it. The session's own lines are
  // decoded first: each exercise's Next up and its cue word (B1-2).
  setTimeout(() => { A.prepareAudio(); if (speakOn()) A.loadVoice(); }, 400);
  if (P?.session?.queue) {
    A.preferVoice(['right-first', 'left-first', 'right-next', 'left-next', 'lastset-next'].concat(P.session.queue.flatMap((pid) => {
      const w = cueWord(exerciseById(ITEM[pid]?.ex));
      return [`next-${pid}`, w ? `cue-${w.toLowerCase()}` : null];
    }).filter(Boolean)));
  }
  // The ring as Set done takes Enter and Space like a button (B2-3); a key held
  // down counts once.
  player?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const ring = e.target.closest?.('.p-ring[data-p="ringdone"]');
    if (!ring || e.target !== ring) return;
    e.preventDefault();
    if (!e.repeat) ring.click();
  });
  // Any touch on the player while the workout is under way asks for the wake
  // lock again if iOS let it go: inside a tap is the only time it is granted.
  player?.addEventListener('pointerdown', () => { if (!wake && workoutUnderWay()) holdWake(); }, { passive: true });
  player?.addEventListener('click', (ev) => {
    // A label's forwarded second click is not a tap (B6-1), and a label that is
    // switched off (aria-disabled) is off like a disabled button.
    if (forwarded(ev)) return;
    const b = ev.target.closest('[data-p]');
    if (!b || isOff(b) || !player.contains(b)) return;
    const k = b.dataset.p;
    if (k === 'ex-next' || k === 'ex-prev') { switchExercise(ctx, k === 'ex-next' ? 1 : -1); return; }
    // While the outgoing exercise is being saved nothing may change it (A20):
    // the save was taken from it, and a set confirmed now would be lost when
    // the run is replaced.
    if (P?.finishing && (TRANSPORT.has(k) || k === 'reps-' || k === 'reps+' || k === 'more' || k === 'close')) return;
    // 'more' gets the stale-step guard but NOT the double tap guard: tapping
    // +30 s twice for a minute is the point of it.
    if (TRANSPORT.has(k) || k === 'reps-' || k === 'reps+' || k === 'more') {
      if (!P?.run || (b.dataset.step && b.dataset.step !== stepKey(P.run))) return;
      const now = Date.now();
      // The ring and the dock's Set done are one action (B2-3): a double tap
      // across the two still counts once.
      const g = k === 'ringdone' ? 'done' : k;
      if (TRANSPORT.has(k) && lastAct.k === g && now - lastAct.at < 350) return;
      if (TRANSPORT.has(k)) lastAct = { k: g, at: now };
    }
    const r = P?.run;
    if (k === 'close') return closePlayer(ctx, rerender);
    if (k === 'pause') {
      // Pausing is immediate. Coming back is not: he asked for five seconds
      // every time (2026-09-15), so he is never dropped straight back into a
      // hold he is not braced for. Tapping again during the five cancels it and
      // leaves him paused, which is the only way out that does not surprise him.
      // Interrupted counts as paused here: a run left by a reload, a lock or
      // leaving the app gets the same five seconds (audit F10, 2026-09-19).
      if (r && (r.state === 'paused' || r.state === 'interrupted')) {
        // syncEffects, not only the cues: after a skipped rest the song was
        // carried through the count in, and a paused run must stop it.
        // Cancelling the five is a Pause like any other (review, 2026-09-23): the
        // falling E C, the tick in Buzz and "Paused." ("Back in five" stops there).
        if (P.resumeAt) { clearResumeCountdown(); syncEffects(); refresh(); pausedMoment(); return; }
        startResumeCountdown(ctx);
        return;
      }
      const pausing = r.state === 'running';
      // The sound is unlocked inside this tap BEFORE the first line, so "Get
      // ready" is said in the coach's voice (B1-2); act() unlocking it later
      // left the line to the device's speech.
      if (r.state === 'ready') { A.unlockAudio(); sayStart(); }
      act((x, now, wall) => (x.state === 'running' ? E.pause(x, now, wall)
        : x.state === 'ready' ? E.start(x, now, wall) : E.resume(x, now, wall)));
      if (pausing && P?.run?.state === 'paused') pausedMoment();
      return;
    }
    // The ring is Set done while a set is his (B2-3): the same action as the
    // dock's button, with the same stale step and double tap guards above.
    if (k === 'done' || k === 'ringdone') {
      const st = E.step(r);
      const adj = P.repsAdjust && P.repsAdjust.i === r.i ? P.repsAdjust.n : undefined;
      // The gold is raised by announceEvents, from what was actually recorded.
      if (st && E.WORK.has(st.kind)) P.justDone = { runId: r.runId, i: r.i };
      // The number that flies home is the one on screen as he tapped (B2-7).
      const from = { k, runId: r.runId, i: r.i, text: player.querySelector('[data-p-reps]')?.textContent.trim() || null };
      act((x, now, wall) => E.setDone(x, now, wall, adj));
      setDoneImpact(b, from);
      return;
    }
    if (k === 'skip') {
      // Skipping a rest used to drop him straight into the next set. His ask,
      // 2026-09-15: "I will need five or so seconds before I get started." So
      // the same five second count in the unpause uses, for the same reason,
      // and the run stays PAUSED through it, so those seconds are never counted
      // as work he did.
      //
      // Paused INSIDE the action (review, 2026-09-16), so syncEffects and the
      // dial see the paused run: the work step's cues and metronome are never
      // started under the count in, and the dial wakes when work really starts.
      // A run he left mid rest is 'interrupted', not running, and gets the same
      // count in; the countdown resumes either (review, 2026-09-16).
      // The work line waits for zero, when the work really starts (B1-6).
      P.holdLine = E.WORK.has(r.steps[r.i + 1]?.kind);
      act((x, now, wall) => {
        const evs = E.skipRest(x, now, wall);
        if (E.WORK.has(E.step(x)?.kind)) {
          if (x.state === 'running') E.pause(x, now, wall, 'skip');
          if (x.state === 'paused' || x.state === 'interrupted') P.resumeAt = Date.now() + RESUME_SECS * 1000;
        }
        return evs;
      });
      if (P) P.holdLine = false;   // used by this tap's step, or by nothing
      if (P?.resumeAt) startResumeCountdown(ctx, { quiet: true });
      return;
    }
    // +30 s on a wait (item 11). Returns no events: the step got longer, it did
    // not change, so the cues are rescheduled off the new length by syncEffects.
    if (k === 'more') {
      if (!r) return;
      act((x, now) => { E.addRest(x, 30, now); return []; });
      return;
    }
    if (k === 'next') return act((x, now, wall) => E.next(x, now, wall));
    if (k === 'prev') return act((x, now) => E.prev(x, now));
    if (k === 'reps-' || k === 'reps+') {
      const st = E.step(r);
      const cur = P.repsAdjust && P.repsAdjust.i === r.i ? P.repsAdjust.n : (st.reps ?? 0);
      P.repsAdjust = { i: r.i, n: Math.max(0, cur + (k === 'reps+' ? 1 : -1)) };
      const ring = player.querySelector('[data-slot="ring"] .p-center');
      if (ring) {
        ring.innerHTML = ringCenter(r, st, performance.now());
        // One more rises from below, one fewer drops from above (B2-4); only a
        // number that changed moves (minus at 0 stays still).
        if (P.repsAdjust.n !== cur) roll(ring.querySelector('[data-p-reps]'), k === 'reps+' ? 1 : -1);
        // The ring now shows this number: a refresh that would draw the same
        // leaves it alone (putRing), so the node he taps next stays put.
        const slot = ring.parentElement;
        if (slot?.dataset.slot === 'ring') slot.__drawn = ringKey(ringInner(r));
      }
      writeDraft();
      return;
    }
    // Sound: no success notices (F01); the switch itself shows the state.
    if (k === 'cues') {
      // Sound -> Buzz -> Off -> Sound, and Sound -> Off where a timer cannot
      // buzz (his iPhone, A.buzzCan). 'through' is a Settings choice and is
      // left alone here: it pauses his music, which is not something to step
      // into by tapping a toolbar button mid workout.
      const mode = cuesOn() ? (A.silentMode() === 'buzz' ? 'buzz' : 'sound') : 'off';
      const next = mode === 'sound' ? (A.buzzCan() ? 'buzz' : 'off') : mode === 'buzz' ? 'off' : 'sound';
      try { localStorage.setItem(CUES_KEY, next === 'off' ? 'off' : 'on'); } catch { /* per device */ }
      if (next !== 'off' && A.silentMode() !== 'through') A.setSilentMode(next === 'buzz' ? 'buzz' : 'duck');
      // Say what it will do, once, with the thing itself rather than a notice.
      if (next === 'buzz') haptic('phase');
      if (next === 'sound' && !A.soundCheck()) toast('<b>Sound is not available here</b><br><span>The countdown and labels still show every step.</span>', 'warn', { key: 'cues-unavailable' });
      if (!P.resumeAt) syncEffects();   // the count back in keeps its pips; it applies this at zero
      refresh();
      return;
    }
    if (k === 'metro') {
      const on = !metronomeOn(r.pid);
      A.unlockAudio();
      update((d) => {
        d.program.timer ||= {};
        // The metronome on means the music off.
        d.program.timer[r.pid] = { ...(d.program.timer[r.pid] || {}), metronome: on, ...(on ? { song: false } : {}) };
      });
      if (on) S.pauseSong();
      if (!P.resumeAt) syncEffects();   // the count back in keeps its pips; it applies this at zero
      refresh();
      return;
    }
    if (k === 'song') {
      const next = songOn(r.pid) ? false : 'shuffle';
      update((d) => {
        d.program.timer ||= {};
        // The music on means the metronome off.
        d.program.timer[r.pid] = { ...(d.program.timer[r.pid] || {}), song: next, ...(next ? { metronome: false } : {}) };
      });
      if (next) {
        const pick = songFor(r.pid);
        if (pick) S.prepareSong(pick, P.songPos).then(() => S.primeSong());
      } else {
        S.pauseSong();
      }
      if (!P.resumeAt) syncEffects();   // the count back in keeps its pips; it applies this at zero
      refresh();
      return;
    }
    if (k === 'songthrough') {
      const on = !songThroughOn(r.pid);
      update((d) => {
        d.program.timer ||= {};
        d.program.timer[r.pid] = { ...(d.program.timer[r.pid] || {}), songThrough: on };
      });
      if (!P.resumeAt) syncEffects();   // the count back in keeps its pips; it applies this at zero
      refresh();
      return;
    }
    if (k === 'song-skip') {
      A.unlockAudio();
      S.primeSong();
      S.skipSong().then((t) => { if (t && P) { P.songSha = t.sha; P.songPos = 0; writeDraft(); } paintNow(); });
      return;
    }
    if (k === 'song-retry') {
      S.loadSongs({ force: true }).then(() => {
        const pick = P?.run ? songFor(P.run.pid) : null;
        if (pick && P.run.state === 'running') S.prepareSong(pick, P.songPos).then(() => S.playSong(true));
        refresh();
      });
      return;
    }
    if (k === 'draft-retry') { writeDraft(); return; }
    if (k === 'zoom') return openZoom(ctx, rerender);
    if (k === 'level') return openLevel(b);
    if (k === 'level-up') {
      const item = ITEM[P?.run?.pid];
      const steps = stepsFor(item, state.data);
      if (!steps.length) return;
      const i = stageOf(item, state.data);
      if (i < steps.length) {
        setLevel(item, i + 1);
        toast(`<b>${stepHtml(steps[i])}</b><br><span>From now on. Tap Where you are to step back.</span>`);
      }
      return;
    }
    if (k === 'save') {
      // One save at a time: a sync repaint re-enabled the button mid flush and
      // a second Save moved on twice, skipping an exercise (2026-09-23 audit).
      if (P.finishing) return;
      const savedRun = P.run;
      const savedAs = saveCurrent();
      if (!savedAs) return;
      const item = ITEM[P.run.pid];
      // Nothing done: nothing was written, so there is no "Saved" to say (A1).
      if (savedAs === 'empty') { afterSave(ctx, savedAs); if (P) rerender(); return; }
      b.disabled = true;
      P.finishing = true;
      // "Saved" only once it is on this device, and the recovery draft stays
      // until then. A failed write keeps the workout here to try again.
      flushSave().then((ok) => {
        if (!P || P.run !== savedRun) return;
        P.finishing = false;
        if (!ok) {
          b.disabled = false;
          toast('<b>Not saved yet</b><br><span>Your workout is kept here. Tap Save again.</span>', 'warn', { key: 'player-save' });
          return;
        }
        savedMoment(item, savedRun, { complete: E.summary(savedRun).complete });
        toast(`<b>Saved</b><br><span>${esc(nameOf(item))}</span>`, 'good', { key: 'player-logged' });
        afterSave(ctx, savedAs);
        if (P) rerender();
      });
      return;
    }
    if (k === 'start-next') {
      A.unlockAudio();
      startNextNow();
      writeDraft();
      rerender();
      return;
    }
    if (k === 'skip-ex') { moveOn(P.session); rerender(); return; }
    if (k === 'end') { P.phase = 'done'; writeDraft(); rerender(); return; }
    if (k === 'viewlog') {
      const iso = P.session?.iso || P.run?.iso || todayIso();
      clearDraft();
      stopEffects();
      notifyIdle();
      ctx.date = iso;
      ctx.editing = null;
      ctx.go('today');
    }
  });

  // Review sheet inputs (the retry screen): kept on the draft as he types, saved only on Save.
  root.querySelectorAll('[data-rv-side] [data-rv]').forEach((inp) => inp.addEventListener('input', () => {
    const side = inp.closest('[data-rv-side]').dataset.rvSide;
    const v = P.review.sides[side];
    const f = inp.dataset.rv;
    if (f === 'rep') v.repsBySet[Number(inp.dataset.set)] = inp.value === '' ? null : Number(inp.value);
    else if (f === 'band') v.band = inp.value;
    else v[f === 'freereps' ? 'freeReps' : f] = inp.value === '' ? null : Number(inp.value);
    writeDraft();
  }));
  root.querySelectorAll('select[data-rv="band"]').forEach((sel) => sel.addEventListener('change', () => {
    const side = sel.closest('[data-rv-side]').dataset.rvSide;
    P.review.sides[side].band = sel.value;
    writeDraft();
  }));
  root.querySelector('input[data-rv="notes"]')?.addEventListener('input', (e) => { P.review.notes = e.target.value; writeDraft(); });
  root.querySelector('input[data-rv="inaccurate"]')?.addEventListener('change', (e) => { P.review.inaccurate = e.target.checked; writeDraft(); });
  root.querySelectorAll('[data-rv-scale]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.rvScale;
    const v = Number(btn.dataset.v);
    P.review[key] = P.review[key] === v ? null : v;   // tap again to clear: it is optional
    writeDraft();
    rerender();
  }));

  // The finish moment is recorded as played the first time it is drawn, and
  // any milestones it carried with it; so do first-ever milestone records.
  // A run that started itself (B1-3) says its first line now the player is on
  // screen; the syncEffects below starts its loop, pips, buzzes and wake lock
  // exactly as a Start tap does. Cleared first, so a repaint never says it twice.
  if (P?.run && P.phase === 'run' && P.sayOnOpen && P.sayOnOpen === P.run.runId) {
    P.sayOnOpen = null;
    sayStart();
  }
  if (P?.phase === 'done' && (P.celebrate || needsSeed(state.data))) {
    const c = P.celebrate;
    const iso = P.session?.iso || P.run?.iso || todayIso();
    update((d) => {
      if (c) markFinishSeen(d, c.iso);
      markSeen(d, iso, c ? unseenMilestones(d, iso).filter((m) => c.milestones.includes(m.key)) : []);
    });
    P.celebrate = null;
  }
  syncEffects();
  paintWake();
  patchZoom();
}


// -------------------------------------------------------------- close ----
function closePlayer(ctx, rerender, { keepCompletion = false } = {}) {
  hush({ keepCompletion });
  clearResumeCountdown();
  // Closing stops every cue at once, one already sounding too.
  A.cancelAll();
  const back = () => { dropWake(); ctx.go(ctx.playerFrom || 'today'); };
  if (!P) return back();
  if (P.phase === 'done' || P.phase === 'between') {
    if (P.phase === 'done') clearDraft(); else writeDraft();
    stopEffects();
    notifyIdle();
    return back();
  }
  const run = P.run;
  // Only a run that never really started is closed without asking. A hold
  // under way counts as started, even before its first set is done.
  if (run.state === 'ready' || (!E.started(run, performance.now()) && run.state !== 'review')) {
    clearDraft();
    stopEffects();
    notifyIdle();
    return back();
  }
  if (run.state === 'running') E.pause(run, performance.now(), Date.now());
  stopEffects();
  writeDraft();
  rerender();   // so the screen behind the sheet reads Resume, if he dismisses it
  const sum = E.summary(run);
  const inProgress = E.started(run, performance.now()) && !sum.anyDone;
  // Three choices, not four (his call, 2026-09-15): "Save what I did and Finish
  // later seem like they effectively do the same thing... combined into one
  // button and simplified so I don't have so many options."
  //
  // Finish later kept the work on the device and logged NOTHING; Save what I did
  // writes it down. From where he sits both are "I am stopping and keeping it",
  // and the one that survives is the one that actually records the work, which
  // is also the safer of the two: nothing depends on this device surviving.
  openModal({
    title: 'Stop this exercise?',
    body: `<div class="menu">
      <button class="btn" data-s="resume">Resume</button>
      <button class="btn" data-s="save">Save what I did<span class="tiny muted">${inProgress ? 'the part of this hold you did, marked partial' : `${sum.done} of ${sum.total} done, marked partial`}</span></button>
      <button class="btn danger" data-s="discard">Leave without recording</button>
    </div>`,
    onMount(m) {
      m.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
        const s = b.dataset.s;
        closeModal();
        if (s === 'resume') { startResumeCountdown(ctx); writeDraft(); rerender(); return; }

        if (s === 'save') {
          // Log what was done straight away, no review screen, and go back.
          // A hold stopped part way keeps its seconds.
          E.capturePartial(run, performance.now());
          run.state = 'review';
          run.since = null;
          run.reviewAt = new Date().toISOString();
          writeDraft();
          finishRun(ctx, { leave: true });
          return;
        }
        if (s === 'discard') {
          // The sheet's own "Leave without recording" is the decision; a second
          // pop-up asking again was one warning too many (his words, 2026-09-18).
          clearDraft();
          notifyIdle();
          back();
        }
      }));
    },
  });
}

function notifyIdle() {
  window.dispatchEvent(new Event('rehab-player-idle'));
}

// -------------------------------------------------------------- level ----
// Where he is in this exercise's progressions, changeable mid-workout (his ask,
// 22 Sep: "level up while doing the exercise"). The same program.stage that My
// Program and Today's rows use, so all three agree. One quiet line on the
// screen; the choices open in a sheet so the player does not get crowded.
// Every step names who set it (23 Sep): "Hold 4 kg (Name)", from progressions.js.
function levelName(item) {
  return stepLabel(currentStep(item, state.data));
}
// The next step is offered right there (his words: "naturally presented to me
// as an option"): one tap on Try moves him on, from this workout onwards, and
// the current level opens the list so he can step back if it was too hard.
//
// "First time" (B3-4): a neutral chip beside the level when he has never logged
// this exercise at it. A fact, never praise: ink on the quiet panel, not
// turquoise (which means action), and nothing to do with the gold seal.
function levelLine(item) {
  const steps = stepsFor(item, state.data);
  if (!steps.length) return '';
  const i = stageOf(item, state.data);
  const now = steps[i - 1] || null;
  const next = steps[i];
  const first = neverAtLevel(state.data, item.id, levelOf(state.data, item));
  return `<div class="p-levelrow">
    <button class="p-level" data-p="level" aria-label="Where you are: ${esc(levelName(item))}${first ? ', first time' : ''}. Change it">
      <span>Where you are</span><span class="p-level-now"><b>${stepHtml(now)}</b>${I.right}${first ? '<span class="p-first" aria-hidden="true">First time</span>' : ''}</span></button>
    ${next ? `<button class="btn sm p-try" data-p="level-up" aria-label="Try the next step: ${esc(stepLabel(next))}"><span class="p-try-t">Try: ${stepHtml(next)}</span></button>` : ''}
  </div>`;
}
function setLevel(item, i) {
  if ((state.data.program.stage?.[item.id] || 0) !== i) update((d) => { (d.program.stage ||= {})[item.id] = i; });
  patchLevelRow(item);
}
/**
 * The level line follows a change in place (B3-4), never swapped whole: the
 * level word slides to the new one (swapWord), the chip and Try follow, and the
 * row, the button and the word keep their nodes.
 */
function patchLevelRow(item) {
  const row = document.querySelector('.player .p-levelrow');
  if (!row) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = levelLine(item).trim();
  const fresh = tpl.content.firstElementChild;
  const btn = row.querySelector('.p-level');
  const nb = fresh?.querySelector('.p-level');
  if (!btn || !nb) { row.outerHTML = levelLine(item); return; }
  btn.setAttribute('aria-label', nb.getAttribute('aria-label'));
  const word = btn.querySelector('b');
  const text = nb.querySelector('b')?.textContent || '';
  if (word && word.textContent !== text) swapWord(word, text, nb.querySelector('b')?.innerHTML ?? null);
  const chip = btn.querySelector('.p-first');
  const nchip = nb.querySelector('.p-first');
  if (chip && !nchip) chip.remove();
  else if (!chip && nchip) { btn.querySelector('.p-level-now')?.appendChild(nchip); appear(nchip); }
  const tr = row.querySelector('.p-try');
  const ntr = fresh.querySelector('.p-try');
  if (tr && ntr) {
    if (tr.innerHTML !== ntr.innerHTML) tr.innerHTML = ntr.innerHTML;
    tr.setAttribute('aria-label', ntr.getAttribute('aria-label'));
  } else if (tr) tr.remove();
  else if (ntr) row.appendChild(ntr);
}
function openLevel(btn) {
  const item = ITEM[P?.run?.pid];
  const steps = stepsFor(item, state.data);
  if (!steps.length) return;
  const stage = stageOf(item, state.data);
  openModal({
    title: 'Where you are',
    body: `<div class="stagebar p-levels" role="group" aria-label="Where you are in the progressions">
      ${[null].concat(steps).map((step, i) => `
        <button type="button" class="stagestep ${i === stage ? 'on' : ''} ${i < stage ? 'past' : ''}" data-lv="${i}" aria-pressed="${i === stage}">${stepHtml(step)}</button>`).join('')}
    </div>`,
    onMount(m) {
      m.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => {
        closeModal();
        setLevel(item, Number(b.dataset.lv));
      }));
    },
  });
}

/**
 * After the first logged go at a new step, one quiet offer to step back (his
 * words: "if it was the first time I was trying something in the progression
 * and it was too much for me"). A toast with a button, never a question: it
 * waits for nothing and goes by itself. The session just saved keeps its step.
 */
//
// It waits its turn (B3-4): until the Orbit Seal has gone (`after`, the seal's
// promise, or at once when there is none), then the next exercise's push and
// 300 ms, then 600 ms more, so it never lands under the seal, the push or the
// "Next up" line. And it sits clear of the dock's buttons while it shows.
const STEP_BACK_MS = 12000;
function offerStepBack(item, run, after = null) {
  const level = levelOf(state.data, item);
  if (!item || !run || !level || !firstAtLevel(state.data, item.id, level, run.runId)) return;
  const i = stageOf(item, state.data);
  const steps = stepsFor(item, state.data);
  const now = steps[i - 1] ? stepHtml(steps[i - 1]) : esc(level);
  const below = stepHtml(i > 1 ? steps[i - 2] : null);
  const show = () => {
    actionToast(`<b>First time at ${now}</b><br><span>Too much? Go back to ${below} next time.</span>`,
      'Step back', () => {
        if ((state.data.program.stage?.[item.id] || 0) !== i) return;
        update((d) => { (d.program.stage ||= {})[item.id] = i - 1; });
        if (P?.run?.pid === item.id) patchLevelRow(item);
        toast(`<b>${below}</b><br><span>From your next session. Move up again any time.</span>`, 'good', { key: `stepped|${item.id}` });
      }, { kind: 'good', key: `stepback|${item.id}`, ms: STEP_BACK_MS });
    toastsClearDock(STEP_BACK_MS + 400);
  };
  Promise.resolve(after).then(() => setTimeout(show, PUSH_MS + 300 + 600));
}

/**
 * Toasts sit above the tab bar, which in the player is where the dock's
 * buttons are once he has scrolled to them. While one that asks for a tap is
 * on screen, the toasts rise clear of the dock (8 px above it), following a
 * scroll, and settle back after `ms`. Read in a scroll frame, never in a tap.
 */
let dockClear = null;
function toastsClearDock(ms) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  dockClear?.stop();
  let frame = 0;
  const place = () => {
    frame = 0;
    root.style.bottom = '';
    const dock = document.querySelector('.player [data-p-dock]');
    if (!dock) return;
    const d = dock.getBoundingClientRect();
    if (d.top >= window.innerHeight || d.bottom <= 0) return;
    const need = window.innerHeight - d.top + 8;
    if (need > window.innerHeight - root.getBoundingClientRect().bottom) root.style.bottom = `${Math.round(need)}px`;
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(place); };
  const stop = () => {
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    root.style.bottom = '';
    if (dockClear?.stop === stop) dockClear = null;
  };
  const timer = setTimeout(stop, ms);
  window.addEventListener('scroll', onScroll, { passive: true });
  dockClear = { stop };
  place();
}

// --------------------------------------------------------------- zoom ----
/** Start before a run has begun, Pause while it runs, Resume when paused (A27). */
function zoomPauseLabel(run) {
  return run.state === 'running' || P?.resumeAt ? 'Pause' : run.state === 'ready' ? 'Start' : 'Resume';
}

// The open photo zoom, so a step change can patch it (Codex audit B09: opened
// during a rest it kept saying REST through the last hold and the finish).
let zoomOpen = null;

/** Phase and Pause follow the run; a different exercise, the finish or a save closes it. */
function patchZoom() {
  const z = zoomOpen;
  if (!z) return;
  if (!z.back.isConnected) { zoomOpen = null; return; }
  const run = P?.run;
  if (!run || P.phase !== 'run' || run.state === 'review' || run.runId !== z.runId) {
    z.close({ repaint: false });
    return;
  }
  const word = pausedLook(run) ? 'PAUSED' : phaseLabel(E.step(run)?.kind);
  const label = z.back.querySelector('[data-z-phase]');
  if (label && label.textContent !== word) label.textContent = word;
  const pause = z.back.querySelector('[data-z="pause"]');
  const words = zoomPauseLabel(run);
  if (pause && pause.textContent !== words) pause.textContent = words;
}

function openZoom(ctx, rerender) {
  const item = ITEM[P.run.pid];
  const back = document.createElement('div');
  back.className = 'p-zoom';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-label', 'Step pictures');
  const opener = document.activeElement;
  back.innerHTML = `
    <div class="p-zoom-scroll"><img src="${esc(item.img)}" alt="Step pictures: ${esc(nameOf(item))}"></div>
    <div class="p-zoom-bar">
      <span class="p-zoom-phase"><span data-z-phase>${esc(pausedLook(P.run) ? 'PAUSED' : phaseLabel(E.step(P.run)?.kind))}</span> <span class="mono" data-p-clock>${E.remainingSec(P.run, performance.now()) != null ? fmtClock(E.remainingSec(P.run, performance.now())) : ''}</span></span>
      <button class="btn" data-z="zoom" aria-pressed="false">Zoom</button>
      <button class="btn" data-z="pause">${zoomPauseLabel(P.run)}</button>
      <button class="btn primary" data-z="close">${I.close}Close</button>
    </div>`;
  document.getElementById('modal-root').appendChild(back);
  const img = back.querySelector('img');
  let release = () => {};
  const close = ({ repaint = true } = {}) => {
    if (zoomOpen?.back === back) zoomOpen = null;
    back.remove();
    release();
    if (repaint) rerender();
    const z = document.querySelector('[data-p="zoom"]') || document.querySelector('.player [data-p="pause"]') || opener;
    try { z?.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  release = holdFocus(back, () => close());
  zoomOpen = { back, runId: P.run.runId, close };
  const zoomBtn = back.querySelector('[data-z="zoom"]');
  const box = back.querySelector('.p-zoom-scroll');
  // Zooming in keeps the spot he tapped under his finger (the Zoom button
  // zooms on the middle); both halves can then be scrolled to.
  const zoom = (ev) => {
    const r = img.getBoundingClientRect();
    const fx = ev?.clientX != null && ev.target === img ? (ev.clientX - r.left) / r.width : 0.5;
    const fy = ev?.clientY != null && ev.target === img ? (ev.clientY - r.top) / r.height : 0.5;
    const on = img.classList.toggle('big');
    zoomBtn.setAttribute('aria-pressed', String(on));
    if (!on) return;
    const b = box.getBoundingClientRect();
    const n = img.getBoundingClientRect();
    const keepX = ev?.clientX != null && ev.target === img ? ev.clientX - b.left : b.width / 2;
    const keepY = ev?.clientY != null && ev.target === img ? ev.clientY - b.top : b.height / 2;
    box.scrollLeft = Math.max(0, n.left - b.left + box.scrollLeft + fx * n.width - keepX);
    box.scrollTop = Math.max(0, n.top - b.top + box.scrollTop + fy * n.height - keepY);
  };
  requestAnimationFrame(() => back.querySelector('[data-z="close"]')?.focus());
  img.addEventListener('click', zoom);
  zoomBtn.addEventListener('click', zoom);
  // The video for reference, over the picture (his call, 22 Sep): a tap plays
  // it in the picture's place, muted, and the picture comes back at the end.
  // Zoom has nothing to act on while it plays, so it is hidden, not dimmed.
  loadVideos().then(() => mountVideo(box, img, item.id, {
    // style, not the hidden attribute: a .btn is display:flex, which beats it
    onPlaying: () => { img.classList.remove('big'); zoomBtn.setAttribute('aria-pressed', 'false'); zoomBtn.style.display = 'none'; },
    onDone: () => { zoomBtn.style.display = ''; },
  }));
  back.querySelector('[data-z="close"]').addEventListener('click', () => close());
  back.querySelector('[data-z="pause"]').addEventListener('click', (e) => {
    const r = P?.run;
    if (!r) return;
    // The dock's rules exactly: a tap during the five seconds cancels them, and
    // syncEffects never runs straight after the count in starts (it cancelled
    // the pips and buzzes the count in had just scheduled).
    if (r.state === 'paused' || r.state === 'interrupted') {
      // Cancelling the five sounds like every Pause, and the dock and the dial
      // behind the zoom follow (review, 2026-09-23: they kept the count in's
      // Pause and HOLD until the zoom closed).
      if (P.resumeAt) { clearResumeCountdown(); syncEffects(); pausedMoment(); } else startResumeCountdown(ctx);   // five seconds here too (audit F10)
    } else {
      A.unlockAudio();
      if (songFor(r.pid)) S.primeSong();
      const pausing = r.state === 'running';
      if (pausing) { cancelPendingLine(); E.pause(r, performance.now(), Date.now()); }
      else if (r.state === 'ready') { E.start(r, performance.now(), Date.now()); sayStart(); }
      syncEffects();
      if (pausing) pausedMoment();
    }
    refresh();
    e.target.textContent = zoomPauseLabel(r);
    writeDraft();
  });
}
