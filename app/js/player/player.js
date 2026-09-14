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

import { esc, uid, todayIso, num, fmtDate, toKg, fromKg, round } from '../util.js';
import { state, update, ensureDay, getDay, lastEntry, flushSave } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, THERABAND, BAND_BY_ID, plannedOn } from '../../data/program.js';
import { CATEGORIES } from '../../data/measurements.js';
import { exerciseById, thumb, openModal, closeModal, toast } from '../components.js';
import { fmtClock, fmtMins, timerPrefs, minutesFor } from '../timing.js';
import { itemStatus, saveRun, rowsFingerprint, runsFor } from '../logging.js';
import { planStreak } from '../planstreak.js';
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
  return { iso: P.run?.iso, pid: P.run?.pid, title: item?.title || item?.ex, session: !!P.session };
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
function newRun(pid, iso) {
  const item = ITEM[pid];
  const ex = exerciseById(item.ex);
  const last = ex?.cardio ? num(lastEntry(item.ex, 'B')?.time) : null;
  return E.createRun({ item, ex, iso, prefs: timerPrefs(state.data, pid), cardioMin: last, runId: `run-${uid()}` });
}

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
  open(ctx, { run: newRun(pid, iso), session: null, phase: 'run', base: rowsFingerprint(getDay(iso), pid), savedRunIds: [] });
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
  if (last.type === 'review') el.textContent = 'All steps done. Review and save.';
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
  return s >= 60 && s % 60 === 0 ? `${s / 60} min` : s >= 60 ? fmtClock(s) : `${s} s`;
}

function setLine(run, st, item) {
  if (!st) return 'Every step done';
  const work = st.kind === 'rest' || st.kind === 'switch' || st.kind === 'ready'
    ? run.steps.slice(run.i).find((x) => E.WORK.has(x.kind)) : st;
  if (!work) return '';
  if (run.mode === 'cardio') return 'One bout';
  if (!run.targetKnown) return `Target not specified${work.side && work.side !== 'B' ? ` · ${sideTag(work.side)}` : ''}`;
  const unit = run.mode === 'hold' && work.units > 1
    ? `Hold ${work.unit} of ${work.units}${work.sets > 1 ? ` · set ${work.set} of ${work.sets}` : ''}`
    : run.mode === 'hold' ? `Hold ${work.set} of ${work.sets}` : `Set ${work.set} of ${work.sets}`;
  return `${unit}${work.side && work.side !== 'B' ? ` · ${sideTag(work.side)}` : ''}`;
}

function nextLine(run) {
  const nx = run.steps[run.i + 1];
  if (!nx) return run.i >= run.steps.length ? '' : 'Review and save';
  if (nx.kind === 'rest') return `Rest ${fmtSecs(nx.secs)}`;
  if (nx.kind === 'switch') return `Switch to the ${sideName(nx.side).toLowerCase()} side`;
  if (nx.kind === 'hold') return `Hold ${nx.units > 1 ? `${nx.unit} of ${nx.units}` : `${nx.set} of ${nx.sets}`}${nx.side !== 'B' ? `, ${sideName(nx.side).toLowerCase()}` : ''}`;
  if (nx.kind === 'work') return run.mode === 'cardio' ? 'Work' : `Set ${nx.set} of ${nx.sets}`;
  return `Set ${nx.set} of ${nx.sets}${nx.side && nx.side !== 'B' ? `, ${sideName(nx.side).toLowerCase()}` : ''}`;
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
};

// -------------------------------------------------------------- render ----
export function renderPlayer(ctx) {
  if (!P) {
    return `<div class="player empty-player">
      <div class="p-top">${backBtn(ctx)}</div>
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
  const cat = CATEGORIES[ex?.cat]?.color || 'var(--accent)';
  const upcoming = kind === 'switch' ? st.side : null;
  const isWork = E.WORK.has(kind);
  const timedWork = kind === 'hold' || kind === 'work';
  const canSkip = ['rest', 'switch', 'ready'].includes(kind);
  const title = item.title || ex?.name || item.ex;
  const metro = !!run.pace;
  const metroIsOn = metro && metronomeOn(run.pid);
  const beat = metroIsOn && kind === 'work' && run.state === 'running';

  return `
  <div class="player" data-player data-kind="${esc(kind)}" data-state="${esc(run.state)}"
    style="--cat:${cat};${upcoming ? `--phase:var(--${upcoming === 'L' ? 'left' : 'right'});` : ''}${run.pace ? `--beat:${(60 / run.pace).toFixed(3)}s;` : ''}">
    <div class="p-top">
      ${backBtn(ctx)}
      <span></span>
      <span class="p-tools">
        <span class="p-wake" data-p-wake data-state="${wakeState}" aria-hidden="true">${I.wake}</span>
        <button class="p-toggle ${metroIsOn ? 'on' : ''}" data-p="metro" ${metro ? '' : 'disabled'}
          aria-pressed="${metroIsOn}" aria-label="Metronome${metro ? ` at ${run.pace} beats per minute` : ', no pace prescribed'}">
          ${I.metro}<span class="mono">${metro ? run.pace : 'BPM'}</span></button>
        ${songToggle(run)}
        <button class="p-toggle ${cuesOn() ? 'on' : ''}" data-p="cues" aria-pressed="${cuesOn()}" aria-label="Sound cues">${I.cues}</button>
      </span>
    </div>

    <header class="p-hero">
      <h2 class="p-title">${esc(title)}</h2>
      <div class="p-setline">${setLine(run, st, item)}${P.session ? ` · <span class="p-count">exercise ${P.session.pos + 1} of ${P.session.queue.length}</span>` : ''}${run.iso !== todayIso() ? ` · <span class="warnish">${esc(fmtDate(run.iso, 'dow'))}</span>` : ''}</div>
    </header>

    ${item.img
      ? `<button class="p-img" data-p="zoom" aria-label="Show the step pictures larger">
          <img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async">
          <span class="p-expand">${I.zoom}</span></button>
         ${item.photoNote ? `<div class="p-photonote">${esc(item.photoNote)}</div>` : ''}`
      : `<div class="p-img plain">${thumb(item.ex, 90)}</div>`}

    <section class="p-phase" aria-label="Current step">
      <div class="p-label">${esc(phaseLabel(kind))}${kind === 'rest' && st.restSrc === 'default' ? '<span class="p-default">default</span>' : ''}</div>
      ${bigNumber(run, st, now)}
      <div class="p-sub" data-p-sub>${subLine(run, st, item)}</div>
      ${pips(run)}
      ${metro ? `<i class="p-beat ${beat ? 'on' : ''}" aria-hidden="true"></i>` : ''}
    </section>

    <div class="p-next"><span>Next</span><b>${esc(nextLine(run))}</b></div>

    <div class="p-actions">
      <div class="p-row1">
        <button class="btn p-big-btn" data-p="pause">${run.state === 'running' ? `${I.pause}Pause` : `${I.play}${run.state === 'ready' ? 'Start' : 'Resume'}`}</button>
        <button class="btn p-big-btn primary" data-p="done" ${isWork ? '' : 'disabled'}>${I.check}Set done</button>
      </div>
      <div class="p-row2">
        <button class="btn" data-p="prev" ${run.i > 0 ? '' : 'disabled'}>${I.prev}Previous</button>
        <button class="btn" data-p="skip" ${canSkip ? '' : 'disabled'}>${I.skip}Skip rest</button>
        <button class="btn" data-p="next">${I.next}Next</button>
      </div>
      ${run.state === 'interrupted' ? `<div class="p-interrupted">Paused while you were away. Nothing was counted.</div>` : ''}
      ${(kind === 'reps' || kind === 'manual') && st.reps != null ? `
        <div class="p-reps-adjust" role="group" aria-label="Reps this set">
          <button class="btn sm" data-p="reps-" aria-label="One fewer rep">&minus;</button>
          <span class="mono" data-p-reps>${esc(String(currentReps(run)))}</span><span class="tiny muted">reps this set</span>
          <button class="btn sm" data-p="reps+" aria-label="One more rep">+</button>
        </div>` : ''}
    </div>
    <div class="sr-only" aria-live="polite" data-p-live></div>
  </div>`;
}

function songToggle(run) {
  const pool = songsAtPace(run.pid);
  const usable = pool.length > 0;
  const on = usable && songOn(run.pid);
  const now = on ? songFor(run.pid) : null;
  const label = !run.pace ? 'No pace prescribed, so no song'
    : !usable ? 'No song at this pace on this device'
    : on ? `Songs on: ${now?.name || ''}` : `Play one of your ${pool.length} song${pool.length === 1 ? '' : 's'} during the work`;
  const through = on && songThroughOn(run.pid);
  const tLabel = on ? (through ? 'Keep playing through rest: on' : 'Keep playing through rest') : 'Keep playing through rest (turn songs on first)';
  return `<span class="p-songgroup">
    <button class="p-toggle ${on ? 'on' : ''}" data-p="song" ${usable ? '' : 'disabled'} aria-pressed="${on}"
      aria-label="${esc(label)}" title="${esc(label)}">${I.song}</button>
    <button class="p-toggle ${through ? 'on' : ''}" data-p="songthrough" ${on ? '' : 'disabled'} aria-pressed="${through}"
      aria-label="${esc(tLabel)}" title="${esc(tLabel)}">${I.loop}</button>
  </span>`;
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

function bigNumber(run, st, now) {
  if (!st) return '';
  if (st.kind === 'reps' || (st.kind === 'manual' && st.reps != null)) {
    return `<div class="p-bignum"><span class="mono">${esc(String(currentReps(run)))}</span><small>reps</small></div>`;
  }
  if (st.kind === 'manual') {
    return `<div class="p-bignum small"><span>At your pace</span></div>
      <div class="p-elapsed mono" data-p-elapsed>${fmtClock(E.elapsedMs(run, now) / 1000)}</div>`;
  }
  const rem = E.remainingSec(run, now);
  return `<div class="p-bignum"><span class="mono" data-p-clock>${fmtClock(rem)}</span></div>`;
}

function subLine(run, st, item) {
  if (!st) return '';
  if (st.kind === 'ready') return 'Starting soon';
  if (st.kind === 'rest') return `${esc(fmtSecs(st.secs))} rest, ${st.restSrc === 'prescribed' ? 'prescribed' : st.restSrc === 'yours' ? 'your setting' : 'default, adjustable'}`;
  if (st.kind === 'switch') return `Next: ${esc(sideName(st.side).toLowerCase())} side`;
  if (st.kind === 'hold') return `of ${esc(fmtSecs(st.secs))}`;
  if (st.kind === 'work') {
    if (run.mode === 'cardio') return `of ${esc(fmtMins(Math.round(st.secs / 60)))}, ${st.target === 'last' ? 'same as last time' : 'default, adjustable'}`;
    return `of ${esc(fmtSecs(st.secs))}${run.pace ? ` · ${run.pace} BPM` : ''}`;
  }
  if (st.kind === 'reps') return `at your pace${st.hold ? ` · ${esc(fmtSecs(st.hold))} hold each rep` : ''}`;
  if (st.kind === 'manual') return st.reps != null ? 'Check the notes on this one' : 'Tap Set done when you finish';
  return '';
}

function pips(run) {
  const list = E.progress(run);
  if (list.length < 2) return '';
  return `<div class="p-pips" aria-hidden="true">${list.map((p) => {
    const cls = p.result ? (p.result.full ? 'done' : 'part') : p.current ? 'now' : '';
    return `<i class="${cls} ${p.side === 'R' ? 'r' : p.side === 'L' ? 'l' : ''}"></i>`;
  }).join('')}</div>`;
}

function paintClock(now) {
  const run = P?.run;
  if (!run) return;
  const rem = E.remainingSec(run, now);
  for (const el of document.querySelectorAll('[data-p-clock]')) {
    const txt = fmtClock(rem);
    if (el.textContent !== txt) el.textContent = txt;
  }
  const el = document.querySelector('[data-p-elapsed]');
  if (el) {
    const txt = fmtClock(E.elapsedMs(run, now) / 1000);
    if (el.textContent !== txt) el.textContent = txt;
  }
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
    <div class="p-top">${backBtn(ctx)}<span class="p-count">${s.pos + 1} of ${s.queue.length}</span><span></span></div>
    <header class="p-hero">
      <div class="p-label">UP NEXT</div>
      <h2 class="p-title">${esc(title)}</h2>
      <div class="p-setline">${m.mins == null ? 'Target not specified' : `${m.mins} min${m.src === 'learned' ? ', usually' : m.src === 'estimate' ? ', estimated' : ''}`}</div>
    </header>
    ${item.img ? `<div class="p-img still"><img src="${esc(item.img)}" alt="Step pictures: ${esc(title)}" decoding="async"></div>` : ''}
    ${early ? `<div class="notice info p-readynote">Do the rest of your workout after ${esc(fmtTime12(ready))}.</div>` : ''}
    <div class="p-actions static">
      <div class="p-row1">
        <button class="btn p-big-btn" data-p="skip-ex">${I.skip}Skip this one</button>
        <button class="btn p-big-btn primary" data-p="start-next">${I.play}Start</button>
      </div>
      <div class="p-row2 one"><button class="btn" data-p="end">End workout</button></div>
    </div>
  </div>`;
}

function renderDone(ctx) {
  const iso = P.session?.iso || P.run?.iso || todayIso();
  const planned = plannedItems(state.data, iso).filter((p) => !p.notYet);
  const entries = getDay(iso)?.entries || [];
  const done = planned.filter((p) => itemStatus(p, entries).state === 'done').length;
  const all = planned.length && done >= planned.length;
  return `
  <div class="player done-screen ${all ? 'all' : ''}" data-player>
    <div class="p-top">${backBtn(ctx)}<span></span><span></span></div>
    <div class="p-finish">
      <div class="p-finish-ring">${I.check}</div>
      <h2>${all ? 'Done for today' : 'Workout finished'}</h2>
      <div class="p-setline">${done} of ${planned.length} planned exercises done</div>
      ${(() => { const n = iso === todayIso() ? planStreak(state.data, iso) : 0; return n >= 2 ? `<div class="p-streak">Plan streak: ${n} days</div>` : ''; })()}
      <button class="btn primary p-big-btn" data-p="close">Back to ${ctx.playerFrom === 'program' ? 'My Program' : 'Today'}</button>
    </div>
  </div>`;
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
    <div class="p-top">${backBtn(ctx)}${P.session ? `<span class="p-count">${P.session.pos + 1} of ${P.session.queue.length}</span>` : '<span></span>'}<span></span></div>
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
        <button class="btn p-big-btn" data-p="prev">${I.prev}Back to the sets</button>
        <button class="btn p-big-btn primary" data-p="save" ${sum.anyDone ? '' : 'disabled'}>${I.check}Save and continue</button>
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
      band: exerciseById(item.ex)?.usesBand ? (v.band ?? '') : undefined,
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
      // Every set corrected to zero: there is nothing to record, and saying
      // "Saved" would be a lie.
      toast('<b>Nothing to save</b><br><span>Every set is at 0. Change a set, or close to leave without recording.</span>', 'warn');
      return false;
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

  const act = (fn) => {
    if (!P?.run) return;
    A.unlockAudio();
    if (songFor(P.run.pid)) S.primeSong();
    const events = fn(P.run, performance.now(), Date.now()) || [];
    if (events.length) announce(events);
    P.repsAdjust = null;
    writeDraft();
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
      const wasReps = st?.kind === 'reps' || st?.kind === 'manual';
      act((r, now, wall) => E.setDone(r, now, wall, adj));
      if (wasReps) popPip(root);
      return;
    }
    if (k === 'skip') return act((r, now, wall) => E.skipRest(r, now, wall));
    if (k === 'next') return act((r, now, wall) => E.next(r, now, wall));
    if (k === 'prev') return act((r, now) => E.prev(r, now));
    if (k === 'reps-' || k === 'reps+') {
      const st = E.step(run);
      const cur = P.repsAdjust && P.repsAdjust.i === run.i ? P.repsAdjust.n : (st.reps ?? 0);
      P.repsAdjust = { i: run.i, n: Math.max(0, cur + (k === 'reps+' ? 1 : -1)) };
      root.querySelectorAll('[data-p-reps], .p-bignum .mono').forEach((el) => { el.textContent = String(P.repsAdjust.n); });
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
      const s = P.session;
      const pid = s.queue[s.pos];
      P.run = newRun(pid, s.iso);
      P.base = rowsFingerprint(getDay(s.iso), pid);
      // A fresh pick for each exercise, unless the music is meant to carry on.
      if (!(songFor(pid) && songThroughOn(pid))) {
        P.songSha = null;
        P.songPos = 0;
      } else {
        P.songPos = S.songPosition() || P.songPos || 0;
      }
      P.phase = 'run';
      A.unlockAudio();
      E.start(P.run, performance.now(), Date.now());
      writeDraft();
      rerender();
      return;
    }
    if (k === 'skip-ex') { moveOn(P.session); rerender(); return; }
    if (k === 'end') { P.phase = 'done'; writeDraft(); rerender(); }
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

  syncEffects();
  paintWake();
}

function popPip(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  requestAnimationFrame(() => {
    const done = document.querySelectorAll('.p-pips i.done');
    done[done.length - 1]?.classList.add('pop');
  });
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
          // To the review sheet, with what was done; Save there commits it.
          // A hold stopped part way keeps its seconds.
          E.capturePartial(run, performance.now());
          run.state = 'review';
          run.since = null;
          run.reviewAt = new Date().toISOString();
          writeDraft();
          rerender();
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
