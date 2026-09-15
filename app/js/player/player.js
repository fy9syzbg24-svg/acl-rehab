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

import { esc, uid, todayIso, num, fmtDate, toKg, fromKg, round, addDays } from '../util.js';
import { state, update, ensureDay, getDay, lastEntry, flushSave } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, THERABAND, BAND_BY_ID, plannedOn } from '../../data/program.js';
import { CATEGORIES } from '../../data/measurements.js';
import { exerciseById, thumb, openModal, closeModal, toast, announce, holdFocus } from '../components.js';
import { dayRing } from '../dayring.js';
import { fmtClock, fmtMins, timerPrefs, minutesFor } from '../timing.js';
import { itemStatus, saveRun, rowsFingerprint, runsFor } from '../logging.js';
import { planStreak, dayComplete } from '../planstreak.js';
import { unseenMilestones, markSeen, markFinishSeen, finishSeen, milestoneSentence, needsSeed } from '../milestones.js';
import * as E from './engine.js';
import * as A from './audio.js';
import { liteMotion } from '../motion.js';
import * as S from './songs.js';

const ALL_ITEMS = REHAB_PROGRAM.concat(GYM_PROGRAM);
const ITEM = Object.fromEntries(ALL_ITEMS.map((p) => [p.id, p]));
const DRAFT_KEY = 'rehab.player.v1';
const CUES_KEY = 'rehab.player.cues';
const DRAFT_EVERY_MS = 5000;
const GAP_IS_INTERRUPTION_MS = 4000;
export const GAP_HOURS = 6;

// ------------------------------------------------------------- the draft --
// P is the open workout: { run, session: { queue, pos } | null, phase, from,
//   base, reviewStartedWall, savedRunIds, reconcile }
let P = null;

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return null;
    d.finishing = false;   // a reload mid-save retries from the review screen
    d.pulseSet = false;    // the set dot pulses for the tap, never for a reload
    // A draft left running (a crash, a reload, an update) comes back
    // interrupted. The time since it was last saved is not credited.
    if (d.run?.state === 'running') {
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

let lastDraftWrite = 0;
function writeDraft() {
  try {
    if (!P) { localStorage.removeItem(DRAFT_KEY); return; }
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
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...snapshot, v: 1, savedAtWall: Date.now() }));
    lastDraftWrite = Date.now();
  } catch { /* storage full or blocked: the workout still runs */ }
}

function clearDraft() {
  S.stopSong();
  P = null;
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to do */ }
}

P = readDraft();

// Which songs this device can play; the player repaints once it knows.
S.loadSongs().then(() => { if (P?.phase === 'run') refresh(); });

export function hasDraft() { return !!P; }
export function draftInfo() {
  if (!P) return null;
  const item = ITEM[P.run?.pid];
  const run = P.run;
  // Where the open workout is, for Today's status line.
  let where = '';
  if (P.phase === 'between' && P.session) {
    const nx = ITEM[P.session.queue[P.session.pos]];
    return { iso: P.session.iso, pid: nx?.id, title: nx?.title || nx?.ex, session: true, phase: 'between',
             where: `next up, ${P.session.pos + 1} of ${P.session.queue.length}`, pausedAt: null };
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
export function workoutQueue(doc, iso) {
  const entries = doc.days?.[iso]?.entries || [];
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
  const first = ALL_ITEMS.find((p) => p.first);
  if (!first) return null;
  const rows = (doc.days?.[iso]?.entries || []).filter((e) => e.pid === first.id && e.logged && e.doneAt);
  if (!rows.length || itemStatus(first, doc.days[iso].entries).state !== 'done') return null;
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
  const item = ITEM[pid];
  const ex = exerciseById(item.ex);
  const last = ex?.cardio ? num(lastEntry(item.ex, 'B')?.time) : null;
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

/** One exercise, from a row. An open workout for something else is kept, not lost. */
export function startExercise(ctx, pid, iso = ctx.date || todayIso()) {
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
  const queue = [pid, ...workoutQueue(state.data, iso).filter((x) => x !== pid && !ITEM[x]?.first)];
  open(ctx, { run: newRun(pid, iso), session: { queue, pos: 0, iso }, phase: 'run', base: rowsFingerprint(getDay(iso), pid), savedRunIds: [] });
}

/** The day's list in order, skipping what is done. */
export function startWorkout(ctx, iso = ctx.date || todayIso()) {
  if (P && playerBusy()) { ctx.go('player'); return; }
  const queue = workoutQueue(state.data, iso);
  if (!queue.length) { toast('<b>Nothing left to do today</b>'); return; }
  open(ctx, { run: newRun(queue[0], iso), session: { queue, pos: 0, iso }, phase: 'run',
              base: rowsFingerprint(getDay(iso), queue[0]), savedRunIds: [] });
}

export function resumePlayer(ctx) {
  if (!P) return;
  ctx.playerFrom = ctx.view === 'player' ? (ctx.playerFrom || 'today') : ctx.view;
  ctx.go('player');
}

/** The shells call this when he leaves the player's tab: pause, keep the draft. */
export function playerLeaving() {
  if (!P?.run) return;
  if (P.run.state === 'running') E.pause(P.run, performance.now(), Date.now(), 'left');
  stopEffects();
  writeDraft();
}

// ------------------------------------------------------------ effects ----
let wake = null;
let wakeState = 'off';   // on | off | unavailable | lost
let tickTimer = null;
let lastTick = 0;
let currentRerender = null;

async function holdWake() {
  if (wake) return;
  if (!('wakeLock' in navigator)) { wakeState = 'unavailable'; paintWake(); return; }
  try {
    wake = await navigator.wakeLock.request('screen');
    wakeState = 'on';
    wake.addEventListener('release', () => {
      wake = null;
      wakeState = P?.run?.state === 'running' ? 'lost' : 'off';
      paintWake();
    });
  } catch {
    wakeState = 'lost';
  }
  paintWake();
}

function dropWake() {
  if (wake) { try { wake.release(); } catch { /* already gone */ } }
  wake = null;
  wakeState = 'off';
}

function paintWake() {
  const el = document.querySelector('[data-p-wake]');
  if (!el) return;
  el.dataset.state = wakeState;
  el.title = {
    on: 'The screen stays awake while this runs',
    off: 'The screen may lock while paused',
    unavailable: 'This browser cannot keep the screen awake',
    lost: 'The screen may lock: keeping it awake was refused',
  }[wakeState];
}

/** Stop the clock's own effects: the tick, scheduled cues, the arc, the wake lock. */
function stopClock() {
  stopArc();
  clearTimeout(tickTimer);
  tickTimer = null;
  A.cancelAll();
  dropWake();
}

function stopEffects() {
  stopClock();
  if (P) P.songPos = S.songPosition() || P.songPos || 0;
  S.pauseSong();
}

/** Start or stop everything that belongs to a running clock. */
function syncEffects() {
  A.cancelAll();
  const run = P?.run;
  if (!run || run.state !== 'running' || P.phase !== 'run') {
    // Keep playing carries the music over the save and the screen between
    // exercises, so momentum is not lost while the next one opens.
    if (run && songFor(run.pid) && songThroughOn(run.pid) && (run.state === 'review' || P.phase === 'between')) {
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
  if (cuesOn() && rem != null) {
    // A continuous exercise hears one tone at each switch and the countdown only before its end.
    if (isFlow(run) && run.i < run.steps.length - 1) A.scheduleSwitch(rem);
    else A.scheduleCues(rem);
  }
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

function loop() {
  tickTimer = null;
  const run = P?.run;
  if (!run || run.state !== 'running') return;
  const now = performance.now();
  // A timer that did not fire for seconds means the page was frozen (locked,
  // backgrounded). That time is an interruption, never credited work.
  if (lastTick && now - lastTick > GAP_IS_INTERRUPTION_MS) {
    E.pause(run, lastTick, Date.now(), 'hidden');
    writeDraft();
    stopEffects();
    currentRerender?.();
    return;
  }
  lastTick = now;
  const events = E.tick(run, now, Date.now());
  if (events.length) {
    announceEvents(events);
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
  paintClock(now);
  if (Date.now() - lastDraftWrite > DRAFT_EVERY_MS) writeDraft();
  tickTimer = setTimeout(loop, 200);
}

function announceEvents(events) {
  const last = events[events.length - 1];
  // "Logged" is said only after the save is durable (F10), in finishRun.
  if (last.type === 'review') announce('Sets complete. Saving.');
  else if (last.type === 'step') announce(phaseLabel(E.step(P.run)?.kind));
}

document.addEventListener('visibilitychange', () => {
  if (!P?.run) return;
  if (document.visibilityState === 'hidden') {
    if (P.run.state === 'running') E.pause(P.run, performance.now(), Date.now(), 'hidden');
    stopEffects();
    writeDraft();
  } else {
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

// --------------------------------------------------------------- icons ----
const I = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6l-8 6 8 6z"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 6l8 6-8 6z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6l7 6-7 6M13 6l7 6-7 6"/></svg>',
  cues: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h4l5-4v13l-5-4H4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
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

const RING = { size: 160, stroke: 9, inner: 3.5 };
RING.r = RING.size / 2 - 17;
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
  if (!s || !content) return;
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
    const end = once(unclip);
    content.animate([{ transform: `translateX(${s.dir * 32}px)` }, { transform: 'none' }],
      { duration: 200, easing: 'cubic-bezier(.16, 1, .3, 1)' }).finished.then(end, end);
    setTimeout(end, 500);
    return;
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
  const clean = once(() => { old.remove(); unclip(); });
  Promise.all([out.finished, inn.finished]).then(clean, clean);
  setTimeout(clean, PUSH_MS + 300);
}

const stepKey = (run) => `${run.runId}:${run.i}:${run.state}`;

export function renderPlayer(ctx) {
  if (!P) {
    return `<div class="player empty-player">
      <div class="p-eyebrow">${backBtn(ctx)}</div>
      <div class="empty">No workout is open. Start one from Today.</div>
    </div>`;
  }
  if (P.phase === 'between') return renderBetween(ctx);
  if (P.phase === 'done') return renderDone(ctx);
  const run = P.run;
  const item = ITEM[run.pid];
  const ex = exerciseById(item.ex);
  if (run.state === 'review') return renderReview(ctx, run, item, ex);

  const title = item.title || ex?.name || item.ex;
  const enter = lastContentKey !== null && lastContentKey !== run.runId;
  lastContentKey = run.runId;
  const swipeDir = P.swipeDir || 0;
  P.swipeDir = 0;
  if (enter) pendingSlide = captureLeaving(swipeDir < 0 ? -1 : 1);
  const cat = CATEGORIES[ex?.cat]?.color || 'var(--ink-2)';
  const catEnd = ex?.cat === 'strength' ? 'var(--cat-strength-end)' : cat;

  return `
  <div class="player" data-player data-run="${esc(run.runId)}" style="--cat:${cat};--cat-end:${catEnd}">
    <div class="p-eyebrow">
      ${backBtn(ctx)}
      <span class="p-count" data-slot="count">${countLine(run)}</span>
      <span class="p-wake" data-p-wake data-state="${wakeState}" role="img" aria-label="${esc(wakeText())}">${I.wake}<span class="p-wake-note">${wakeState === 'lost' ? 'Screen may lock' : ''}</span></span>
    </div>
    <div class="p-stage"><div class="p-content">
      <div class="p-swipe" data-p-swipe>
      <h2 class="p-title">${esc(title)}</h2>
      ${swipeButtons(run)}
      <div class="p-status" data-slot="status">${statusLine(run)}</div>
      ${item.img
        ? `<button class="p-img" data-p="zoom" aria-label="Show the step pictures larger">
            <img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async">
            <span class="p-expand">${I.zoom}</span></button>
           ${item.photoNote ? `<div class="p-photonote">${esc(item.photoNote)}</div>` : ''}`
        : `<div class="p-img plain">${thumb(item.ex, 90)}</div>`}
      </div>
      <div class="p-phaserow" data-slot="phase">${phaseRow(run)}</div>
      <div class="p-dial">
        <span class="p-dial__bezel" aria-hidden="true"></span>
        <span class="p-dial__sweep" aria-hidden="true"></span>
        <span class="p-dial__pulse" aria-hidden="true"></span>
        <button class="p-adj" data-p="reps-" data-step="${stepKey(run)}" aria-label="One fewer rep this set" ${repsEditable(run) ? '' : 'disabled'}>${I.minus}</button>
        <div class="p-ring" role="group" aria-label="Current step" data-slot="ring">${ringInner(run)}</div>
        <button class="p-adj" data-p="reps+" data-step="${stepKey(run)}" aria-label="One more rep this set" ${repsEditable(run) ? '' : 'disabled'}>${I.plus}</button>
      </div>
      <div class="p-next" data-slot="next">${esc(nextLine(run))}</div>
      <div class="p-now" data-slot="now">${nowPlaying(run)}</div>
      <div class="p-sound" role="group" aria-label="Sound" data-slot="tools">${soundTools(run)}</div>
    </div></div>
    <div class="p-actions" data-p-dock>
      <div class="p-row1">
        <button class="btn big p-pause" data-p="pause" data-step="${stepKey(run)}">${pauseLabel(run)}</button>
        <button class="btn big primary" data-p="done" data-step="${stepKey(run)}" ${E.WORK.has(E.step(run)?.kind) ? '' : 'disabled'}>${I.check}<span>Set done</span></button>
      </div>
      <div class="p-row2">
        <button class="btn p-link" data-p="prev" data-step="${stepKey(run)}" ${run.i > 0 ? '' : 'disabled'}>${I.prev}<span>Previous</span></button>
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
  const put = (slot, html) => {
    const el = root.querySelector(`[data-slot="${slot}"]`);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  };
  put('count', countLine(run));
  put('status', statusLine(run));
  put('phase', phaseRow(run));
  put('ring', ringInner(run));
  put('next', esc(nextLine(run)));
  dialMoments(root, run);
  paintNow();
  patchTools(root, run);
  const key = stepKey(run);
  const kind = E.step(run)?.kind;
  const set = (k, attrs) => {
    const b = root.querySelector(`[data-p="${k}"]`);
    if (!b) return;
    b.dataset.step = key;
    if ('disabled' in attrs) b.disabled = !!attrs.disabled;
    if (attrs.html != null && b.innerHTML !== attrs.html) b.innerHTML = attrs.html;
  };
  set('pause', { html: pauseLabel(run) });
  set('done', { disabled: !E.WORK.has(kind) });
  set('prev', { disabled: !(run.i > 0) });
  set('skip', { disabled: !['rest', 'switch', 'ready'].includes(kind) });
  set('next', {});
  set('reps-', { disabled: !repsEditable(run) });
  set('reps+', { disabled: !repsEditable(run) });
  paintWake();
}

// ------------------------------------------------------ dial moments ----
// 2026-09-15, his pick: a confirmed set pulses the ring, and the moment a rest
// (or the get ready, or a switch) turns back into work a light sweeps once
// round the dial. Both are Web Animations on transform and opacity; at 30
// frames (Low Power Mode) the sweep is a glow without the turn; nothing under
// Reduce Motion.
let lastDialKind = { runId: null, kind: null };
const WAITING = new Set(['rest', 'ready', 'switch']);
function dialMoments(root, run) {
  const kind = E.step(run)?.kind || null;
  const prev = lastDialKind.runId === run.runId ? lastDialKind.kind : null;
  lastDialKind = { runId: run.runId, kind };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lite = liteMotion();
  // On the Set done tap itself: the ring may already show the other leg's sets.
  const pulse = P.pulseSet;
  P.pulseSet = false;
  if (pulse) {
    root.querySelector('.p-ring')?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.05)', offset: 0.35 }, { transform: 'scale(1)' }],
      { duration: 380, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    root.querySelector('.p-dial__pulse')?.animate(
      [{ transform: 'translate(-50%, -50%) scale(.92)', opacity: 0.85 }, { transform: 'translate(-50%, -50%) scale(1.28)', opacity: 0 }],
      { duration: 560, easing: 'ease-out' });
  }
  if (prev && WAITING.has(prev) && E.WORK.has(kind)) {
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

function countLine(run) {
  const bits = [P.session ? `<span class="p-count-word">Workout</span> ${P.session.pos + 1} of ${P.session.queue.length}` : 'Exercise'];
  if (run.iso !== todayIso()) bits.push(`<span class="p-day">${esc(fmtDate(run.iso, 'dow'))}</span>`);
  return bits.join(' · ');
}

function wakeText() {
  return {
    on: 'The screen stays awake while this runs',
    off: 'The screen may lock while paused',
    unavailable: 'This browser cannot keep the screen awake',
    lost: 'The screen may lock: keeping it awake was refused',
  }[wakeState] || '';
}

function pauseLabel(run) {
  return run.state === 'running' ? `${I.pause}<span>Pause</span>`
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
  const neutral = ['rest', 'ready', 'switch'].includes(kind);
  return `<span class="p-label ${neutral ? 'neutral' : ''}">${esc(phaseLabel(kind))}${kind === 'rest' && st.restSrc === 'default' ? '<span class="p-default">default</span>' : ''}</span>
    <span class="p-side ${side}">${side === 'L' ? 'Left leg' : side === 'R' ? 'Right leg' : 'Both legs'}</span>`;
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
  if (run.state === 'interrupted') return '<span class="p-note">Paused while you were away. Nothing was counted.</span>';
  return esc(unitLine(run, E.step(run)));
}

function backBtn(ctx) {
  const to = ctx.playerFrom === 'program' ? 'My Program' : 'Today';
  return `<button class="p-back" data-p="close" aria-label="Back to ${to}">${I.back}<span>${to}</span></button>`;
}

/** The phone header's back button calls this (mobile.js). */
export function playerBack(ctx) {
  if (currentRerender) closePlayer(ctx, currentRerender);
  else ctx.go(ctx.playerFrom || 'today');
}

function currentReps(run) {
  const st = E.step(run);
  if (P.repsAdjust && P.repsAdjust.i === run.i) return P.repsAdjust.n;
  return st?.reps ?? '';
}

/** Arc fraction for a timed step: the time remaining, from 12 o'clock. */
/**
 * The tendon loading is one exercise to him, so it runs as one timer (his ask,
 * 2026-09-15): "30 seconds, then two minutes, then 30 seconds ... one
 * continuous thing". The big number is the whole exercise counting down and
 * never resets, the arc is the whole exercise, the line under the number says
 * hold or rest and the seconds left in it, and a switch between them is one
 * tone instead of a countdown. The 3, 2, 1 plays only before the very end.
 * Programme items opt in with `continuous: true`.
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
  return Math.max(0, Math.min(1, rem / st.secs));
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
      body += `<circle class="p-arc ${enter ? 'enter' : ''}" data-p-arc cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${(frac * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})" ${frac <= 0 ? 'style="opacity:0"' : ''}/>`;
    }
    // The inner ring: confirmed sets, green only once confirmed.
    if (units.length > 1) body += segArcs(units, ri, inner, 'p-iseg', 8);
  }
  P.justDone = null;   // one render's worth of the set animation
  return `<svg class="p-ringsvg" viewBox="0 0 ${size} ${size}" aria-hidden="true">
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
  if (run.mode === 'hold' && work.units > 1) return `Hold ${work.unit} of ${work.units}${work.sets > 1 ? ` · set ${work.set} of ${work.sets}` : ''}`;
  if (run.mode === 'hold') return `Hold ${work.set} of ${work.sets}`;
  return `Set ${work.set} of ${work.sets}`;
}

function secsWords(s) {
  if (s == null) return '';
  if (s >= 60 && s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
  if (s >= 60) return fmtClock(s);
  return `${s} seconds`;
}

function ringCenter(run, st, now) {
  if (!st) return '';
  if (st.kind === 'reps' || (st.kind === 'manual' && st.reps != null)) {
    const edited = P.repsAdjust && P.repsAdjust.i === run.i && P.repsAdjust.n !== st.reps;
    return `<div class="p-num reps" data-p-reps>${esc(String(currentReps(run)))}</div>
      <div class="p-cap">${edited ? 'reps you did' : 'reps · your pace'}${st.hold ? ` · hold ${esc(fmtSecs(st.hold))}` : ''}</div>`;
  }
  if (st.kind === 'manual') {
    return `<div class="p-num words">Your pace</div>
      <div class="p-cap"><span class="mono" data-p-elapsed>${fmtClock(E.elapsedMs(run, now) / 1000)}</span> so far</div>`;
  }
  const rem = E.remainingSec(run, now);
  if (isFlow(run)) {
    const left = flowLeft(run, now);
    const word = st.kind === 'ready' ? 'Get ready' : st.kind === 'rest' ? 'Rest' : st.kind === 'switch' ? 'Switch' : 'Hold';
    const whole = fmtClock(left);
    return `<div class="p-num ${whole.length > 4 ? 'long' : ''}" data-p-clock>${whole}</div>
      <div class="p-cap">${word} <span class="mono" data-p-stepclock>${fmtClock(rem)}</span></div>`;
  }
  let cap = `of ${esc(secsWords(st.secs))}`;
  if (st.kind === 'ready') cap = P.session && run.state === 'running' ? 'Starts by itself' : 'Get ready';
  if (st.kind === 'switch') cap = `Now the ${st.side === 'L' ? 'left' : 'right'} leg`;
  if (st.kind === 'work' && run.mode === 'cardio') cap = `of ${esc(fmtMins(Math.round(st.secs / 60)))}${st.target === 'last' ? ', same as last time' : ''}`;
  const clock = fmtClock(rem);
  return `<div class="p-num ${clock.length > 4 ? 'long' : ''}" data-p-clock>${clock}</div><div class="p-cap">${cap}</div>`;
}

function paintClock(now) {
  const run = P?.run;
  if (!run) return;
  const rem = E.remainingSec(run, now);
  const txt = fmtClock(isFlow(run) ? flowLeft(run, now) : rem);
  for (const el of document.querySelectorAll('[data-p-clock]')) {
    if (el.textContent !== txt) { el.textContent = txt; el.classList.toggle('long', txt.length > 4); }
  }
  const part = document.querySelector('[data-p-stepclock]');
  if (part) {
    const t = fmtClock(rem);
    if (part.textContent !== t) part.textContent = t;
  }
  const el = document.querySelector('[data-p-elapsed]');
  if (el) {
    const t = fmtClock(E.elapsedMs(run, now) / 1000);
    if (el.textContent !== t) el.textContent = t;
  }
}

/**
 * The arc, painted at most once a frame from the engine's clock while the run
 * is moving and visible. Attributes are patched in place.
 */
let arcFrame = 0;
function paintArc() {
  arcFrame = 0;
  const run = P?.run;
  if (!run || run.state !== 'running' || document.visibilityState !== 'visible') return;
  const el = document.querySelector('[data-p-arc]');
  const st = E.step(run);
  if (el && st) {
    const frac = arcDash(run, st, performance.now());
    if (frac != null) {
      el.setAttribute('stroke-dasharray', `${(frac * RING.c).toFixed(2)} ${RING.c.toFixed(2)}`);
      // Opacity only when it changes (Fable B8): the dash is the one write a frame.
      const hide = frac <= 0;
      if (el.__hidden !== hide) { el.style.opacity = hide ? '0' : ''; el.__hidden = hide; }
    }
  }
  paintClock(performance.now());
  arcFrame = requestAnimationFrame(paintArc);
}
function startArc() {
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
  return `
    <button class="p-tool ${metroIsOn ? 'on' : ''}" data-p="metro" ${metro ? '' : 'disabled'} aria-pressed="${metroIsOn}"
      aria-label="Metronome${metro ? ` at ${run.pace} beats per minute` : ', no pace prescribed'}">${I.metro}<span>Metronome</span></button>
    <button class="p-tool ${on ? 'on' : ''}" data-p="song" ${usable ? '' : 'disabled'} aria-pressed="${on}" aria-label="Music">${I.song}<span>Music</span></button>
    <button class="p-tool ${through ? 'on' : ''}" data-p="songthrough" ${on ? '' : 'disabled'} aria-pressed="${through}"
      aria-label="Keep music playing through rest">${I.loop}<span>Through rest</span></button>
    <button class="p-tool ${cues ? 'on' : ''}" data-p="cues" aria-pressed="${cues}" aria-label="Countdown cues">${I.cues}<span>Cues</span></button>`;
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
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">Up next · ${s.pos + 1} of ${s.queue.length}</span></div>
    <header class="p-hero">
      <h2 class="p-title">${esc(title)}</h2>
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
  const planned = plannedItems(state.data, iso).filter((p) => !p.notYet);
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
  const ring = dayRing(planned, entries, { size: 180, stroke: 12, center: 'check', celebrate: fresh && !reduce });
  const mins = workoutMinutes(entries);

  return `
  <div class="player done-screen ${all ? 'all' : ''}" data-player>
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">${all ? 'Today · plan complete' : 'Today'}</span></div>
    <div class="fin">
      ${all ? ring.html : `<div class="fin-ring">${I.check}</div>`}
      <h2 class="fin-title">${all ? 'Plan Complete!' : 'Workout finished'}</h2>
      ${all ? '<p class="fin-line">Nice work sticking to your plan.</p>' : ''}
      <section class="fin-card">
        <div class="fin-count"><b>${ring.done} of ${ring.total}</b><span>planned exercises</span></div>
        ${mins != null ? `<div class="fin-row"><span>${mins.partial ? 'Recorded workout time' : 'Recorded workout time'}</span><b>${esc(fmtMins(mins.min))}</b></div>` : ''}
      </section>
      ${moment ? `<div class="fin-ms ${reduce ? '' : 'play'}" style="--land-at:${(ring.fillEnd || 0) + 200}ms"><span class="ms-badge earned">${BADGE_ICON}</span>
        <span class="ms-text"><b>${esc(moment.headline)}</b><span>Milestone unlocked</span></span></div>` : ''}
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
 * The last seven days (F35): a check for a plan done, a line for planned rest,
 * an outlined circle for a known day not completed, and a small neutral dot
 * for a day before dated plans began, never an empty "missed" circle.
 */
export function weekDots(iso) {
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
    cells.push(`<span class="wd ${kind}" role="img" aria-label="${esc(fmtDate(d, 'dow'))}: ${word}"><small>${esc(letter)}</small><i>${kind === 'done' ? I.check : kind === 'rest' ? '<b></b>' : kind === 'unknown' ? '<em></em>' : ''}</i></span>`);
  }
  const since = anyUnknown && firstKnown ? `Plans recorded since ${new Date(firstKnown + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '';
  return `<div class="weekdots" role="group" aria-label="The last seven days">${cells.join('')}</div>
    <div class="weekdots-key">${since ? `${esc(since)} · ` : ''}Planned rest counts</div>`;
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
      minutes: prev?.minutes ?? (run.mode === 'cardio' ? Math.max(1, Math.round((s.secsList[0] || 0) / 60)) : null),
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
      <h2 class="p-title">${esc(title)}</h2>
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
    const secs = s.secsList.length ? Math.round(s.secsList.reduce((a, b) => a + b, 0) / s.secsList.length) : null;
    return {
      side: s.side,
      anyDone,
      full: anyDone && full,
      short,
      sets,
      reps,
      repsBySet: countsReps ? repsBySet : [],
      secs: run.mode === 'cardio' ? null : secs,
      secsList: run.mode === 'cardio' ? [] : s.secsList,
      minutes: run.mode === 'cardio' ? num(v.minutes) : null,
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
  if ((getDay(run.iso)?.entries || []).some((e) => e.runId === run.runId && e.logged)) return true;
  saving = true;
  try {
    const item = ITEM[run.pid];
    const review = collectReview(run, item);
    if (!review.sides.some((x) => x.anyDone)) {
      // Nothing done (every set skipped or at zero): nothing to record, and
      // saying "Saved" would be a lie.
      return 'empty';
    }
    update(() => {
      const day = ensureDay(run.iso);
      saveRun(day, { item, run, review });
    });
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
  const saved = saveCurrent();
  if (saved === true) {
    const ok = await flushSave();
    if (!ok) {
      P.finishing = false;
      stopEffects();
      announce('Not saved yet. Your workout is kept here.');
      toast('<b>Not saved yet</b><br><span>Your workout is kept here. Tap Save to try again.</span>', 'warn', { key: 'player-save' });
      currentRerender?.();
      return;
    }
    announce(`Logged ${item.title || item.ex}`);
    // Carrying on: the receipt shows in the player while the next exercise is
    // already counting down. Leaving: the toast says it on the way out.
    if (leave || !P.session || item.first) toast(`<b>Logged</b><br><span>${esc(item.title || item.ex)}</span>`, 'good', { key: 'player-logged' });
    else showReceipt(item.title || item.ex);
  }
  P.finishing = false;
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
  E.start(P.run, performance.now(), Date.now());
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
  const entries = getDay(iso)?.entries || [];
  return plannedItems(state.data, iso)
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
  const run = P.run;
  const iso = run.iso;
  const list = exerciseChoices(iso, run.pid);
  const pid = list[list.indexOf(run.pid) + dir];
  if (!pid) return;
  const item = ITEM[run.pid];
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
      if (!ok) {
        P.finishing = false;
        player()?.removeAttribute('aria-busy');
        announce('Not saved yet. Your workout is kept here.');
        toast('<b>Not saved yet</b><br><span>Stayed on this exercise so nothing is lost.</span>', 'warn', { key: 'player-save' });
        currentRerender?.();
        return;
      }
      announce(`Logged ${item.title || item.ex}`);
      showReceipt(item.title || item.ex);
    }
    P.finishing = false;
    player()?.removeAttribute('aria-busy');
  }
  stopEffects();
  // The list from here on, with the chosen one in hand. The tendon loading
  // leads the day; it is only in the list while it is still to do.
  const queue = exerciseChoices(iso, pid);
  P.session = { queue, pos: Math.max(0, queue.indexOf(pid)), iso };
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
const TRANSPORT = new Set(['pause', 'done', 'skip', 'next', 'prev']);
let lastAct = { k: null, at: 0 };

export function bindPlayer(root, ctx, rerender) {
  currentRerender = () => { if (ctx.view === 'player') rerender(); };
  currentCtx = ctx;
  const player = root.querySelector('[data-player]');
  playSlide(player);
  const run = P?.run;
  // Load his song ahead of the tap that starts it: iOS allows the first play
  // only inside that tap, so the file has to be ready by then.
  const song = run ? songFor(run.pid) : null;
  if (song) S.prepareSong(song, P.songPos);

  const act = (fn) => {
    if (!P?.run) return;
    A.unlockAudio();
    if (songFor(P.run.pid)) S.primeSong();
    const events = fn(P.run, performance.now(), Date.now()) || [];
    if (events.length) announceEvents(events);
    P.repsAdjust = null;
    writeDraft();
    if (P.run.state === 'review' && P.phase === 'run') { finishRun(ctx); return; }
    syncEffects();
    refresh();
  };

  bindSwipe(player?.querySelector('[data-p-swipe]'), ctx);
  // The audio context is built while nothing is moving, a moment after the
  // player opens (Fable B6), so Start only resumes it and a swipe or an arrow
  // never waits on it.
  setTimeout(A.prepareAudio, 400);
  player?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-p]');
    if (!b || b.disabled || !player.contains(b)) return;
    const k = b.dataset.p;
    if (k === 'ex-next' || k === 'ex-prev') { switchExercise(ctx, k === 'ex-next' ? 1 : -1); return; }
    // While the outgoing exercise is being saved nothing may change it (A20):
    // the save was taken from it, and a set confirmed now would be lost when
    // the run is replaced.
    if (P?.finishing && (TRANSPORT.has(k) || k === 'reps-' || k === 'reps+')) return;
    if (TRANSPORT.has(k) || k === 'reps-' || k === 'reps+') {
      if (!P?.run || (b.dataset.step && b.dataset.step !== stepKey(P.run))) return;
      const now = Date.now();
      if (TRANSPORT.has(k) && lastAct.k === k && now - lastAct.at < 350) return;
      if (TRANSPORT.has(k)) lastAct = { k, at: now };
    }
    const r = P?.run;
    if (k === 'close') return closePlayer(ctx, rerender);
    if (k === 'pause') {
      return act((x, now, wall) => (x.state === 'running' ? E.pause(x, now, wall)
        : x.state === 'ready' ? E.start(x, now, wall) : E.resume(x, now, wall)));
    }
    if (k === 'done') {
      const st = E.step(r);
      const adj = P.repsAdjust && P.repsAdjust.i === r.i ? P.repsAdjust.n : undefined;
      if (st && E.WORK.has(st.kind)) { P.justDone = { runId: r.runId, i: r.i }; P.pulseSet = true; }
      act((x, now, wall) => E.setDone(x, now, wall, adj));
      return;
    }
    if (k === 'skip') return act((x, now, wall) => E.skipRest(x, now, wall));
    if (k === 'next') return act((x, now, wall) => E.next(x, now, wall));
    if (k === 'prev') return act((x, now) => E.prev(x, now));
    if (k === 'reps-' || k === 'reps+') {
      const st = E.step(r);
      const cur = P.repsAdjust && P.repsAdjust.i === r.i ? P.repsAdjust.n : (st.reps ?? 0);
      P.repsAdjust = { i: r.i, n: Math.max(0, cur + (k === 'reps+' ? 1 : -1)) };
      const ring = player.querySelector('[data-slot="ring"] .p-center');
      if (ring) ring.innerHTML = ringCenter(r, st, performance.now());
      writeDraft();
      return;
    }
    // Sound: no success notices (F01); the switch itself shows the state.
    if (k === 'cues') {
      const on = !cuesOn();
      try { localStorage.setItem(CUES_KEY, on ? 'on' : 'off'); } catch { /* per device */ }
      if (on && !A.soundCheck()) toast('<b>Sound is not available here</b><br><span>The countdown and labels still show every step.</span>', 'warn', { key: 'cues-unavailable' });
      syncEffects();
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
      syncEffects();
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
      syncEffects();
      refresh();
      return;
    }
    if (k === 'songthrough') {
      const on = !songThroughOn(r.pid);
      update((d) => {
        d.program.timer ||= {};
        d.program.timer[r.pid] = { ...(d.program.timer[r.pid] || {}), songThrough: on };
      });
      syncEffects();
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
    if (k === 'zoom') return openZoom(ctx, rerender);
    if (k === 'save') {
      const savedAs = saveCurrent();
      if (!savedAs) return;
      const item = ITEM[P.run.pid];
      // Nothing done: nothing was written, so there is no "Saved" to say (A1).
      if (savedAs === 'empty') { afterSave(ctx, savedAs); if (P) rerender(); return; }
      b.disabled = true;
      // "Saved" only once it is on this device, and the recovery draft stays
      // until then. A failed write keeps the workout here to try again.
      flushSave().then((ok) => {
        if (!ok) {
          b.disabled = false;
          toast('<b>Not saved yet</b><br><span>Your workout is kept here. Tap Save again.</span>', 'warn', { key: 'player-save' });
          return;
        }
        announce(`Logged ${item.title || item.ex}`);
        toast(`<b>Saved</b><br><span>${esc(item.title || item.ex)}</span>`, 'good', { key: 'player-logged' });
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
}


// -------------------------------------------------------------- close ----
function closePlayer(ctx, rerender) {
  const back = () => { ctx.go(ctx.playerFrom || 'today'); };
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
  openModal({
    title: 'Stop this exercise?',
    body: `<div class="menu">
      <button class="btn" data-s="resume">Resume</button>
      <button class="btn" data-s="later">Finish later<span class="tiny muted">keeps your progress on this device</span></button>
      <button class="btn" data-s="save">Save what I did<span class="tiny muted">${inProgress ? 'the part of this hold you did, marked partial' : `${sum.done} of ${sum.total} done, marked partial`}</span></button>
      <button class="btn danger" data-s="discard">Leave without recording</button>
    </div>`,
    onMount(m) {
      m.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => {
        const s = b.dataset.s;
        closeModal();
        if (s === 'resume') { E.resume(run, performance.now(), Date.now()); writeDraft(); rerender(); return; }
        if (s === 'later') { writeDraft(); notifyIdle(); back(); return; }
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
          if (!confirm('Leave without recording this exercise? What you did in the player is not saved.')) return;
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

// --------------------------------------------------------------- zoom ----
/** Start before a run has begun, Pause while it runs, Resume when paused (A27). */
function zoomPauseLabel(run) {
  return run.state === 'running' ? 'Pause' : run.state === 'ready' ? 'Start' : 'Resume';
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
    <div class="p-zoom-scroll"><img src="${esc(item.img)}" alt="Step pictures: ${esc(item.title || item.ex)}"></div>
    <div class="p-zoom-bar">
      <span class="p-zoom-phase">${esc(phaseLabel(E.step(P.run)?.kind))} <span class="mono" data-p-clock>${E.remainingSec(P.run, performance.now()) != null ? fmtClock(E.remainingSec(P.run, performance.now())) : ''}</span></span>
      <button class="btn" data-z="zoom" aria-pressed="false">Zoom</button>
      <button class="btn" data-z="pause">${zoomPauseLabel(P.run)}</button>
      <button class="btn primary" data-z="close">${I.close}Close</button>
    </div>`;
  document.getElementById('modal-root').appendChild(back);
  const img = back.querySelector('img');
  let release = () => {};
  const close = () => {
    back.remove();
    release();
    rerender();
    const z = document.querySelector('[data-p="zoom"]') || opener;
    try { z?.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  release = holdFocus(back, close);
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
  back.querySelector('[data-z="close"]').addEventListener('click', close);
  back.querySelector('[data-z="pause"]').addEventListener('click', (e) => {
    const r = P.run;
    if (r.state === 'running') E.pause(r, performance.now(), Date.now());
    else if (r.state === 'ready') E.start(r, performance.now(), Date.now());
    else E.resume(r, performance.now(), Date.now());
    e.target.textContent = zoomPauseLabel(r);
    writeDraft();
    syncEffects();
  });
}
