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
import { exerciseById, thumb, openModal, closeModal, toast } from '../components.js';
import { fmtClock, fmtMins, timerPrefs, minutesFor } from '../timing.js';
import { itemStatus, saveRun, rowsFingerprint, runsFor } from '../logging.js';
import { planStreak, dayComplete } from '../planstreak.js';
import { unseenMilestones, markSeen, markFinishSeen, finishSeen, milestoneSentence, needsSeed } from '../milestones.js';
import * as E from './engine.js';
import * as A from './audio.js';
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
S.loadSongs().then((list) => { if (list.length) currentRerender?.(); });

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

function stopEffects() {
  stopArc();
  clearTimeout(tickTimer);
  tickTimer = null;
  A.cancelAll();
  if (P) P.songPos = S.songPosition() || P.songPos || 0;
  S.pauseSong();
  dropWake();
}

/** Start or stop everything that belongs to a running clock. */
function syncEffects() {
  A.cancelAll();
  const run = P?.run;
  if (!run || run.state !== 'running' || P.phase !== 'run') {
    // Keep playing carries the music over the review and the screen between
    // exercises, so momentum is not lost while he confirms and moves on.
    if (run && songFor(run.pid) && songThroughOn(run.pid) && (run.state === 'review' || P.phase === 'between')) {
      clearTimeout(tickTimer);
      tickTimer = null;
      A.cancelAll();
      dropWake();
      return;
    }
    stopEffects();
    return;
  }
  holdWake();
  const now = performance.now();
  const st = E.step(run);
  const rem = E.remainingSec(run, now);
  if (cuesOn() && rem != null) A.scheduleCues(rem);
  if (st?.kind === 'work' && run.pace && metronomeOn(run.pid) && rem != null) A.startMetronome(run.pace, rem);
  // His song plays through the work bouts and waits, where it stopped,
  // through rest and pause. With Keep playing on it carries on through rest,
  // side switches and get ready too, moving to another track when one ends;
  // only Pause, an interruption or closing stops it.
  const song = songFor(run.pid);
  const through = !!song && songThroughOn(run.pid);
  S.setContinuous(through ? songsAtPace(run.pid) : null, (t) => { if (P) { P.songSha = t.sha; P.songPos = 0; writeDraft(); } });
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
    announce(events);
    writeDraft();
    if (run.state === 'review' && P.phase === 'run' && currentCtx) { finishRun(currentCtx); return; }
    currentRerender?.();
    return;
  }
  paintClock(now);
  if (Date.now() - lastDraftWrite > DRAFT_EVERY_MS) writeDraft();
  tickTimer = setTimeout(loop, 200);
}

function announce(events) {
  const el = document.querySelector('[data-p-live]');
  if (!el) return;
  const last = events[events.length - 1];
  if (last.type === 'review') el.textContent = 'All sets done. Logged.';
  else if (last.type === 'step') el.textContent = phaseLabel(E.step(P.run)?.kind);
}

document.addEventListener('visibilitychange', () => {
  if (!P?.run) return;
  if (document.visibilityState === 'hidden') {
    if (P.run.state === 'running') E.pause(P.run, performance.now(), Date.now(), 'hidden');
    stopEffects();
    writeDraft();
  } else {
    currentRerender?.();
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
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.5 1.5 2.5-2.5M3.5 12l1.5 1.5 2.5-2.5M3.5 17.5l1.5 1.5 2.5-2.5"/></svg>',
  checkCircle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.6"/></svg>',
};

// -------------------------------------------------------------- render ----
// 2026-09-14 ring design (ChatGPT revision 2, settled): the whole photo grid
// on top, one ring in the same place for every phase, the phase and the leg
// named outside it, the next step in one line under it, four sound controls,
// and the transport dock pinned above the tab bar. The ring tells the truth:
// a timed step drains with the engine clock; a reps step shows confirmed sets
// and never animates reps or time it cannot know.

const RING = { size: 164, stroke: 7 };
RING.r = (RING.size - RING.stroke) / 2;
RING.c = 2 * Math.PI * RING.r;

let lastContentKey = null;   // which exercise the content region last showed

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

  const st = E.step(run);
  const now = performance.now();
  const kind = st?.kind || 'ready';
  const cat = CATEGORIES[ex?.cat]?.color || 'var(--ink-2)';
  const isWork = E.WORK.has(kind);
  const canSkip = ['rest', 'switch', 'ready'].includes(kind);
  const title = item.title || ex?.name || item.ex;
  const metro = !!run.pace;
  const metroIsOn = metro && metronomeOn(run.pid);
  // The content crossfades once when a different exercise opens, never on a tick.
  const key = `${run.runId}`;
  const enter = lastContentKey !== null && lastContentKey !== key;
  lastContentKey = key;
  const count = P.session ? `Workout · ${P.session.pos + 1} of ${P.session.queue.length}` : 'Exercise';
  const side = sideOfStep(run, st);

  return `
  <div class="player" data-player data-kind="${esc(kind)}" data-state="${esc(run.state)}"
    style="--cat:${cat};${run.pace ? `--beat:${(60 / run.pace).toFixed(3)}s;` : ''}">
    <div class="p-eyebrow">
      ${backBtn(ctx)}
      <span class="p-count">${esc(count)}${run.iso !== todayIso() ? ` · <span class="warnish">${esc(fmtDate(run.iso, 'dow'))}</span>` : ''}</span>
      <span class="p-wake" data-p-wake data-state="${wakeState}" aria-hidden="true">${I.wake}</span>
    </div>
    ${receiptSlot(run)}
    <div class="p-content ${enter ? 'p-enter' : ''}">
      <h2 class="p-title">${esc(title)}</h2>
      ${item.img
        ? `<button class="p-img" data-p="zoom" aria-label="Show the step pictures larger">
            <img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async">
            <span class="p-expand">${I.zoom}</span></button>
           ${item.photoNote ? `<div class="p-photonote">${esc(item.photoNote)}</div>` : ''}`
        : `<div class="p-img plain">${thumb(item.ex, 90)}</div>`}
      <div class="p-phaserow">
        <span class="p-label">${esc(phaseLabel(kind))}${kind === 'rest' && st.restSrc === 'default' ? '<span class="p-default">default</span>' : ''}</span>
        <span class="p-side ${side}">${side === 'L' ? 'Left leg' : side === 'R' ? 'Right leg' : 'Both legs'}</span>
      </div>
      <div class="p-ringrow">
        ${repsAdjust(run, st, 'minus')}
        <div class="p-ring" role="group" aria-label="Current step">
          ${ringSvg(run, st, now)}
          <div class="p-center">${ringCenter(run, st, now)}</div>
          ${metro ? `<i class="p-beat ${metroIsOn && kind === 'work' && run.state === 'running' ? 'on' : ''}" aria-hidden="true"></i>` : ''}
        </div>
        ${repsAdjust(run, st, 'plus')}
      </div>
      <div class="p-next">${esc(nextLine(run))}</div>
    </div>

    <div class="p-sound" role="group" aria-label="Sound">
      <button class="p-tool ${metroIsOn ? 'on' : ''}" data-p="metro" ${metro ? '' : 'disabled'} aria-pressed="${metroIsOn}"
        aria-label="Metronome${metro ? ` at ${run.pace} beats per minute` : ', no pace prescribed'}">${I.metro}<span>Metronome</span></button>
      ${songTools(run)}
      <button class="p-tool ${cuesOn() ? 'on' : ''}" data-p="cues" aria-pressed="${cuesOn()}" aria-label="Countdown cues">${I.cues}<span>Cues</span></button>
    </div>

    <div class="p-actions">
      <div class="p-row1">
        <button class="btn big p-pause" data-p="pause">${run.state === 'running' ? `${I.pause}Pause` : `${I.play}${run.state === 'ready' ? 'Start' : 'Resume'}`}</button>
        <button class="btn big primary" data-p="done" ${isWork ? '' : 'disabled'}>${I.check}Set done</button>
      </div>
      <div class="p-row2">
        <button class="btn p-link" data-p="prev" ${run.i > 0 ? '' : 'disabled'}>${I.prev}Previous</button>
        <button class="btn p-link" data-p="skip" ${canSkip ? '' : 'disabled'}>${I.skip}Skip rest</button>
        <button class="btn p-link" data-p="next">${I.next}Next</button>
      </div>
    </div>
    <div class="sr-only" aria-live="polite" data-p-live></div>
  </div>`;
}

/** The side a step belongs to: a switch names the side it switches TO. */
function sideOfStep(run, st) {
  if (!st) return 'B';
  const s = st.kind === 'rest' || st.kind === 'ready'
    ? (run.steps.slice(run.i).find((x) => E.WORK.has(x.kind))?.side || 'B')
    : (st.side || 'B');
  return s === 'L' || s === 'R' ? s : 'B';
}

/**
 * The reserved receipt slot. After a durable save, "Logged · full title" shows
 * here for about a second and a half while the next exercise is already
 * counting down. It never holds a button, so nothing below it moves under a
 * finger. An interruption notice uses the same slot.
 */
function receiptSlot(run) {
  const r = P.receipt;
  if (r && Date.now() < r.until) {
    const fresh = !r.shown;
    r.shown = true;
    return `<div class="p-receipt on ${fresh ? 'fresh' : ''}" aria-hidden="true">${I.checkCircle}<span>Logged · ${esc(r.title)}</span></div>`;
  }
  if (run.state === 'interrupted') {
    return '<div class="p-receipt note" aria-hidden="true"><span>Paused while you were away. Nothing was counted.</span></div>';
  }
  return '<div class="p-receipt" aria-hidden="true"></div>';
}

function songTools(run) {
  const pool = songsAtPace(run.pid);
  const usable = pool.length > 0;
  const on = usable && songOn(run.pid);
  const now = on ? songFor(run.pid) : null;
  const label = !run.pace ? 'Music: no pace prescribed, so no song'
    : !usable ? 'Music: no song at this pace on this device'
    : on ? `Music on: ${now?.name || ''}` : `Music: play one of your ${pool.length} song${pool.length === 1 ? '' : 's'} during the work`;
  const through = on && songThroughOn(run.pid);
  const tLabel = on ? (through ? 'Keep playing through rest: on' : 'Keep playing through rest: off') : 'Keep playing through rest (turn music on first)';
  return `<button class="p-tool ${on ? 'on' : ''}" data-p="song" ${usable ? '' : 'disabled'} aria-pressed="${on}"
      aria-label="${esc(label)}" title="${esc(label)}">${I.song}<span>Music</span></button>
    <button class="p-tool ${through ? 'on' : ''}" data-p="songthrough" ${on ? '' : 'disabled'} aria-pressed="${through}"
      aria-label="${esc(tLabel)}" title="${esc(tLabel)}">${I.loop}<span>Keep playing</span></button>`;
}

function backBtn(ctx) {
  const to = ctx.playerFrom === 'program' ? 'My Program' : 'Today';
  return `<button class="p-back" data-p="close" aria-label="Back to ${to}">${I.back}<span>${to}</span></button>`;
}

function currentReps(run) {
  const st = E.step(run);
  if (P.repsAdjust && P.repsAdjust.i === run.i) return P.repsAdjust.n;
  return st?.reps ?? '';
}

function repsAdjust(run, st, which) {
  const show = st && (st.kind === 'reps' || st.kind === 'manual') && st.reps != null;
  if (!show) return '<span class="p-adj-spacer" aria-hidden="true"></span>';
  return which === 'minus'
    ? '<button class="p-adj" data-p="reps-" aria-label="One fewer rep this set">&minus;</button>'
    : '<button class="p-adj" data-p="reps+" aria-label="One more rep this set">+</button>';
}

/** Arc length for a timed step: the remaining fraction, drawn from 12 o'clock. */
function arcDash(run, st, now) {
  const rem = E.remainingSec(run, now);
  if (rem == null || !st?.secs) return null;
  const frac = Math.max(0, Math.min(1, rem / st.secs));
  return frac;
}

function ringSvg(run, st, now) {
  const { size, stroke, r, c } = RING;
  const mid = size / 2;
  const repsLike = st && (st.kind === 'reps' || st.kind === 'manual');
  // Several sets draw their own pieces (with gaps); one set or a timer sits on the full track.
  const pieces = repsLike && E.progress(run).filter((p) => (p.side || 'B') === (st.side || 'B')).length > 1;
  const base = pieces ? '' : `<circle class="p-track" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"/>`;
  let marks = '';
  if (repsLike) {
    marks = setSegments(run, st);
  } else {
    const frac = arcDash(run, st, now);
    if (frac != null) {
      const on = frac * c;
      marks = `<circle class="p-arc" data-p-arc cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${on.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${mid} ${mid})" ${frac <= 0 ? 'style="opacity:0"' : ''}/>`;
    }
  }
  return `<svg class="p-ringsvg" viewBox="0 0 ${size} ${size}" aria-hidden="true">${base}${marks}</svg>`;
}

/**
 * Confirmed sets for the side in progress, one segment each. Neutral until a
 * set is confirmed, green once it is, a small category mark on the one he is
 * doing. Left and right never share segments: finishing the left set does not
 * paint the right one.
 */
function setSegments(run, st) {
  const { size, stroke, r, c } = RING;
  const mid = size / 2;
  const side = st.side || 'B';
  const units = E.progress(run).filter((p) => (p.side || 'B') === side);
  const n = units.length;
  if (!n) return '';
  const gap = n > 1 ? 10 : 0;
  const seg = c / n;
  const just = P.justDone && P.justDone.runId === run.runId ? P.justDone.i : null;
  P.justDone = null;   // one render only: a later repaint never replays it
  let out = '';
  units.forEach((u, k) => {
    const len = Math.max(1, seg - gap);
    const start = k * seg + gap / 2;
    const res = u.result;
    const cls = res ? (res.full === false || res.short ? 'part' : 'done') : '';
    if (cls) {
      out += `<circle class="p-seg ${cls} ${u.i === just ? 'just' : ''}" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`;
    } else if (n > 1) {
      // an unconfirmed set: its own neutral piece, so the gaps read as sets
      out += `<circle class="p-seg todo" cx="${mid}" cy="${mid}" r="${r}" stroke-width="${stroke}"
        stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 ${mid} ${mid})"/>`;
    }
    if (u.current) {
      const ang = ((start) / c) * 2 * Math.PI - Math.PI / 2;
      out += `<circle class="p-mark" cx="${(mid + r * Math.cos(ang)).toFixed(2)}" cy="${(mid + r * Math.sin(ang)).toFixed(2)}" r="${stroke}"/>`;
    }
  });
  return out;
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
  const unit = `<div class="p-unit">${esc(unitLine(run, st))}</div>`;
  if (st.kind === 'reps' || (st.kind === 'manual' && st.reps != null)) {
    return `<div class="p-num reps"><span data-p-reps>${esc(String(currentReps(run)))}</span><small>reps</small></div>
      <div class="p-cap">Your pace${st.hold ? ` · hold ${esc(fmtSecs(st.hold))}` : ''}</div>${unit}`;
  }
  if (st.kind === 'manual') {
    return `<div class="p-num words">Your pace</div>
      <div class="p-cap"><span class="mono" data-p-elapsed>${fmtClock(E.elapsedMs(run, now) / 1000)}</span> so far</div>${unit}`;
  }
  const rem = E.remainingSec(run, now);
  let cap = `of ${esc(secsWords(st.secs))}`;
  if (st.kind === 'ready') cap = P.session && run.state === 'running' ? 'Starts automatically' : 'Get ready';
  if (st.kind === 'switch') cap = `Switch to the ${st.side === 'L' ? 'left' : 'right'} leg`;
  if (st.kind === 'work' && run.mode === 'cardio') cap = `of ${esc(fmtMins(Math.round(st.secs / 60)))}${st.target === 'last' ? ', same as last time' : ''}`;
  return `<div class="p-num" data-p-clock>${fmtClock(ceilSec(rem))}</div><div class="p-cap">${cap}</div>${unit}`;
}

/** Whole seconds, counted the way a countdown reads: 0:30 until a full second has gone. */
function ceilSec(rem) {
  return rem == null ? rem : Math.ceil(rem - 1e-6);
}

function paintClock(now) {
  const run = P?.run;
  if (!run) return;
  const rem = E.remainingSec(run, now);
  const txt = fmtClock(ceilSec(rem));
  for (const el of document.querySelectorAll('[data-p-clock]')) {
    if (el.textContent !== txt) el.textContent = txt;
  }
  const el = document.querySelector('[data-p-elapsed]');
  if (el) {
    const t = fmtClock(E.elapsedMs(run, now) / 1000);
    if (el.textContent !== t) el.textContent = t;
  }
}

/**
 * The arc, painted at most once a frame from the engine's clock while the run
 * is moving. Attributes are patched in place; nothing is re-rendered, so a
 * field or a button under his finger is never replaced.
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
      el.style.opacity = frac <= 0 ? '0' : '';
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
  <div class="player between" data-player style="--cat:${CATEGORIES[ex?.cat]?.color || 'var(--accent)'}">
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">Up next · ${s.pos + 1} of ${s.queue.length}</span></div>
    <header class="p-hero">
      <h2 class="p-title">${esc(title)}</h2>
      <div class="p-setline">${m.mins == null ? 'Target not specified' : `${m.mins} min${m.src === 'learned' ? ', usually' : m.src === 'estimate' ? ', estimated' : ''}`}</div>
    </header>
    ${item.img ? `<div class="p-img still"><img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async"></div>` : ''}
    ${early ? `<div class="notice info p-readynote">Do the rest of your workout after ${esc(fmtTime12(ready))}.</div>` : ''}
    <div class="p-actions static">
      <div class="p-row1">
        <button class="btn big p-pause" data-p="skip-ex">${I.skip}Skip this one</button>
        <button class="btn big primary" data-p="start-next">${I.play}Start</button>
      </div>
      <div class="p-row2 one"><button class="btn" data-p="end">End workout</button></div>
    </div>
  </div>`;
}

/**
 * The finish, 2026-09-14 ring design. Shown once, inside the player:
 *   - the whole plan done: one check draws with one outline dissipating, the
 *     count, the workout time, the week, and one sentence (a new milestone's
 *     sentence when one was earned, combined, never a second moment)
 *   - the tendon loading: a calm acknowledgment and when the rest may start
 *   - ended early: the facts, no celebration
 * A revisit, a reload or a sync shows the same facts without replaying it.
 */
function renderDone(ctx) {
  const iso = P.session?.iso || P.run?.iso || todayIso();
  const planned = plannedItems(state.data, iso).filter((p) => !p.notYet);
  const entries = getDay(iso)?.entries || [];
  const doneItems = planned.filter((p) => itemStatus(p, entries).state === 'done');
  const done = doneItems.length;
  const all = planned.length > 0 && done >= planned.length;
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
        <button class="btn big fin-act" data-p="close">Back to ${esc(back)}</button>
      </div>
    </div>`;
  }

  const fresh = all && !finishSeen(state.data, iso) && iso === todayIso();
  const newOnes = all && iso === todayIso() ? unseenMilestones(state.data, iso) : [];
  const moment = fresh ? milestoneSentence(newOnes) : null;
  P.celebrate = fresh ? { iso, milestones: newOnes.map((m) => m.key) } : null;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mins = workoutMinutes(entries);

  return `
  <div class="player done-screen ${all ? 'all' : ''}" data-player>
    <div class="p-eyebrow">${backBtn(ctx)}<span class="p-count">${all ? 'Today · plan complete' : 'Today'}</span></div>
    <div class="fin">
      <div class="fin-ring ${all ? 'good' : ''} ${fresh && !reduce ? 'play' : ''}" aria-hidden="true">${I.check}</div>
      <h2 class="fin-title">${all ? 'Plan complete.' : 'Workout finished'}</h2>
      ${all ? `<p class="fin-line">${esc(moment ? moment.sentence : 'You did what you came to do.')}</p>` : ''}
      <section class="fin-card">
        <div class="fin-count"><b>${done} of ${planned.length}</b><span>planned exercises</span></div>
        <div class="segbar" aria-hidden="true">${planned.map((p) => `<i class="${itemStatus(p, entries).state === 'done' ? 'on' : ''}"></i>`).join('')}</div>
        ${mins != null ? `<div class="fin-row"><span>Workout time</span><b>${esc(fmtMins(mins))}</b></div>` : ''}
      </section>
      ${moment ? `<div class="fin-ms ${reduce ? '' : 'play'}"><span class="ms-badge earned">${BADGE_ICON}</span>
        <span class="ms-text"><b>${esc(moment.label)}</b><span>${esc(moment.detail)}</span></span></div>` : ''}
      ${all ? weekDots(iso) : ''}
      <button class="btn big fin-act" data-p="viewlog">${I.list}View today's log</button>
    </div>
  </div>`;
}

const BADGE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5.5"/><path d="M9 13.8L7.5 21l4.5-2.4 4.5 2.4-1.5-7.2"/></svg>';

/** Active plus recovery minutes the player recorded today, one per run. */
function workoutMinutes(entries) {
  const runs = new Map();
  for (const e of entries) if (e.logged && e.timing?.runId) runs.set(e.timing.runId, e.timing);
  if (!runs.size) return null;
  let secs = 0;
  for (const t of runs.values()) secs += (t.activeSec || 0) + (t.restSec || 0);
  return Math.max(1, Math.round(secs / 60));
}

/** The last seven days: a check for a plan done, a line for planned rest. */
export function weekDots(iso) {
  const cells = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(iso, -i);
    const r = dayComplete(state.data, d);
    const letter = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
    const kind = !r ? 'unknown' : !r.planned ? 'rest' : r.complete ? 'done' : 'open';
    const word = { unknown: 'no plan recorded', rest: 'planned rest', done: 'plan complete', open: 'not complete' }[kind];
    cells.push(`<span class="wd ${kind}" aria-label="${esc(fmtDate(d, 'dow'))}: ${word}"><small>${esc(letter)}</small><i>${kind === 'done' ? I.check : kind === 'rest' ? '<b></b>' : ''}</i></span>`);
  }
  return `<div class="weekdots" role="group" aria-label="The last seven days">${cells.join('')}</div>
    <div class="weekdots-key">Check: plan complete · line: planned rest</div>`;
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
  if ((P.savedRunIds || []).includes(run.runId)) return true;
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
 * get ready and starts by itself.
 */
async function finishRun(ctx, { leave = false } = {}) {
  if (!P?.run || P.finishing) return;
  P.finishing = true;
  const run = P.run;
  const item = ITEM[run.pid];
  stopEffects();
  const saved = saveCurrent();
  if (saved === true) {
    const ok = await flushSave();
    if (!ok) {
      P.finishing = false;
      toast('<b>Not saved yet</b><br><span>Your workout is kept here. Tap Save to try again.</span>', 'warn');
      currentRerender?.();
      return;
    }
    // Carrying on: the receipt shows in the player while the next exercise is
    // already counting down. Leaving: the toast says it on the way out.
    if (leave || !P.session || item.first) toast(`<b>Logged</b><br><span>${esc(item.title || item.ex)}</span>`);
    else showReceipt(item.title || item.ex);
  }
  P.finishing = false;
  if (leave || !P.session) {
    clearDraft();
    notifyIdle();
    ctx.go(ctx.playerFrom || 'today');
    return;
  }
  if (item.first) {
    P.phase = 'done';
    P.stopForGap = item.id;
    writeDraft();
    currentRerender?.();
    return;
  }
  moveOn(P.session);
  if (P.phase === 'between') startNextNow();
  writeDraft();
  currentRerender?.();
}

const RECEIPT_MS = 240 + 1500;   // enter, then readable for about a second and a half
let receiptTimer = null;
/** "Logged · title" in the reserved slot, cleared in place so nothing re-renders. */
function showReceipt(title) {
  P.receipt = { title, until: Date.now() + RECEIPT_MS, shown: false };
  const el = document.querySelector('[data-p-live]');
  if (el) el.textContent = `Logged ${title}`;
  clearTimeout(receiptTimer);
  receiptTimer = setTimeout(() => {
    if (P) P.receipt = null;
    const slot = document.querySelector('.p-receipt.on');
    if (slot) { slot.className = 'p-receipt'; slot.innerHTML = ''; }
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
function afterSave(ctx) {
  const s = P.session;
  if (!s) { clearDraft(); ctx.go(ctx.playerFrom || 'today'); return; }
  moveOn(s);
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

// --------------------------------------------------------------- bind ----
export function bindPlayer(root, ctx, rerender) {
  currentRerender = () => { if (ctx.view === 'player') rerender(); };
  const run = P?.run;
  // Load his song ahead of the tap that starts it: iOS allows the first play
  // only inside that tap, so the file has to be ready by then.
  const song = run ? songFor(run.pid) : null;
  if (song) S.prepareSong(song, P.songPos);

  currentCtx = ctx;
  const act = (fn) => {
    if (!P?.run) return;
    A.unlockAudio();
    if (songFor(P.run.pid)) S.primeSong();
    const events = fn(P.run, performance.now(), Date.now()) || [];
    if (events.length) announce(events);
    P.repsAdjust = null;
    writeDraft();
    if (P.run.state === 'review' && P.phase === 'run') { finishRun(ctx); return; }
    rerender();
  };

  root.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.p;
    if (k === 'close') return closePlayer(ctx, rerender);
    if (k === 'pause') {
      return act((r, now, wall) => (r.state === 'running' ? E.pause(r, now, wall)
        : r.state === 'ready' ? E.start(r, now, wall) : E.resume(r, now, wall)));
    }
    if (k === 'done') {
      const st = E.step(run);
      const adj = P.repsAdjust && P.repsAdjust.i === run.i ? P.repsAdjust.n : undefined;
      if (st && E.WORK.has(st.kind)) P.justDone = { runId: run.runId, i: run.i };
      act((r, now, wall) => E.setDone(r, now, wall, adj));
      return;
    }
    if (k === 'skip') return act((r, now, wall) => E.skipRest(r, now, wall));
    if (k === 'next') return act((r, now, wall) => E.next(r, now, wall));
    if (k === 'prev') return act((r, now) => E.prev(r, now));
    if (k === 'reps-' || k === 'reps+') {
      const st = E.step(run);
      const cur = P.repsAdjust && P.repsAdjust.i === run.i ? P.repsAdjust.n : (st.reps ?? 0);
      P.repsAdjust = { i: run.i, n: Math.max(0, cur + (k === 'reps+' ? 1 : -1)) };
      root.querySelectorAll('[data-p-reps]').forEach((el) => { el.textContent = String(P.repsAdjust.n); });
      writeDraft();
      return;
    }
    if (k === 'cues') {
      const on = !cuesOn();
      try { localStorage.setItem(CUES_KEY, on ? 'on' : 'off'); } catch { /* per device */ }
      if (on && !A.soundCheck()) toast('<b>Sound is not available here</b><br><span>The countdown and labels still show every step.</span>', 'warn');
      rerender();
      return;
    }
    if (k === 'metro') {
      const on = !metronomeOn(run.pid);
      A.unlockAudio();
      update((d) => {
        d.program.timer ||= {};
        // The metronome on means the music off.
        d.program.timer[run.pid] = { ...(d.program.timer[run.pid] || {}), metronome: on, ...(on ? { song: false } : {}) };
      });
      if (on) S.pauseSong();
      rerender();
      return;
    }
    if (k === 'song') {
      const next = songOn(run.pid) ? false : 'shuffle';
      update((d) => {
        d.program.timer ||= {};
        // The music on means the metronome off.
        d.program.timer[run.pid] = { ...(d.program.timer[run.pid] || {}), song: next, ...(next ? { metronome: false } : {}) };
      });
      if (next) {
        const pick = songFor(run.pid);
        if (pick) {
          S.prepareSong(pick, P.songPos).then(() => S.primeSong());
          toast(`<b>Songs on</b><br><span>${esc(pick.name)} this time. It plays during the work and waits through rest.</span>`);
        }
      } else {
        S.pauseSong();
      }
      rerender();
      return;
    }
    if (k === 'songthrough') {
      const on = !songThroughOn(run.pid);
      update((d) => {
        d.program.timer ||= {};
        d.program.timer[run.pid] = { ...(d.program.timer[run.pid] || {}), songThrough: on };
      });
      if (on) toast('<b>Keep playing on</b><br><span>The music carries on through rest and moves to another track when one ends.</span>');
      rerender();
      return;
    }
    if (k === 'zoom') return openZoom(ctx, rerender);
    if (k === 'save') {
      if (!saveCurrent()) return;
      const item = ITEM[P.run.pid];
      b.disabled = true;
      // "Saved" only once it is on this device, and the recovery draft stays
      // until then. A failed write keeps the workout here to try again.
      flushSave().then((ok) => {
        if (!ok) {
          b.disabled = false;
          toast('<b>Not saved yet</b><br><span>Your workout is kept here. Tap Save again.</span>', 'warn');
          return;
        }
        toast(`<b>Saved</b><br><span>${esc(item.title || item.ex)}</span>`);
        afterSave(ctx);
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
    if (k === 'end') { P.phase = 'done'; writeDraft(); rerender(); }
    if (k === 'viewlog') {
      const iso = P.session?.iso || P.run?.iso || todayIso();
      clearDraft();
      stopEffects();
      notifyIdle();
      ctx.date = iso;
      ctx.editing = null;
      ctx.go('today');
    }
  }));

  // Review sheet inputs: kept on the draft as he types, saved only on Save.
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
  root.querySelectorAll('[data-rv-scale]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.rvScale;
    const v = Number(b.dataset.v);
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
function openZoom(ctx, rerender) {
  const item = ITEM[P.run.pid];
  const back = document.createElement('div');
  back.className = 'p-zoom';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-label', 'Step pictures');
  back.innerHTML = `
    <div class="p-zoom-scroll"><img src="${esc(item.img)}" alt="Step pictures: ${esc(item.title || item.ex)}"></div>
    <div class="p-zoom-bar">
      <span class="p-zoom-phase">${esc(phaseLabel(E.step(P.run)?.kind))} <span class="mono" data-p-clock>${E.remainingSec(P.run, performance.now()) != null ? fmtClock(E.remainingSec(P.run, performance.now())) : ''}</span></span>
      <button class="btn" data-z="zoom">Zoom</button>
      <button class="btn" data-z="pause">${P.run.state === 'running' ? 'Pause' : 'Resume'}</button>
      <button class="btn primary" data-z="close">${I.close}Close</button>
    </div>`;
  document.getElementById('modal-root').appendChild(back);
  const img = back.querySelector('img');
  const close = () => { back.remove(); document.removeEventListener('keydown', esc_); rerender(); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  const zoom = () => { img.classList.toggle('big'); };
  img.addEventListener('click', zoom);
  back.querySelector('[data-z="zoom"]').addEventListener('click', zoom);
  back.querySelector('[data-z="close"]').addEventListener('click', close);
  back.querySelector('[data-z="pause"]').addEventListener('click', (e) => {
    const r = P.run;
    if (r.state === 'running') E.pause(r, performance.now(), Date.now());
    else if (r.state === 'ready') E.start(r, performance.now(), Date.now());
    else E.resume(r, performance.now(), Date.now());
    e.target.textContent = r.state === 'running' ? 'Pause' : 'Resume';
    writeDraft();
    syncEffects();
  });
}
