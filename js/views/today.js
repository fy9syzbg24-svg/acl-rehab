// The one place data goes in. Everything else in the app reads from here.
//
// Today is a checklist. The date, one line saying what the day is for, then
// the exercises planned for the day with a circle to tick each one, then the
// day's supplements. Everything that used to sit above the list (the six
// month road, the week cadence, the month board, the insight cards) lives on
// Progress > Overview now. He opens this screen to answer one question, what
// do I do today, and the first exercise has to be on the first screen.

import { loadVideos, videoFor, VIDEO_TAG } from '../videos.js';
import { esc, todayIso, addDays, fmtDate, fmtDateShort, uid, num, round, currentDayIso, onTimePicked } from '../util.js';
import { haptic, speakOn, hapTaps, hapInput, forwarded, isOff } from '../feedback.js';
import * as A from '../player/audio.js';
import { ptMark, bandMark, bandPicker, bandSvg } from '../ptmark.js';
import { paintBadge } from '../badge.js';
import { state, update, ensureDay, getDay, lastEntry, lastCardioMinutes, maxLoad, loadSeries, entriesFor, stageEdit, weakenDayPath, historyEntries} from '../store.js';
import { monthForDate } from '../../data/plan.js';
import { CATEGORIES, MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { REHAB_PROGRAM, GYM_PROGRAM, BAND_BY_ID, THERABAND, plannedOn, dayPlanFor } from '../../data/program.js';
import { CLINIC_HEP } from '../../data/history.js';
import { goalGroups } from './week.js';
import { shortCat } from './monthboard.js';
import { openExercisePicker, allExercises, exerciseById, openMeasureEntry, loadBars, thumb,
         openPicture, renderDatePill, prescriptionLine, toast, openModal, closeModal, goButton, actionToast, rowName } from '../components.js';
import { minutesFor, fmtMins, fmtDayTotal, learnedRest} from '../timing.js';
import { withGoals } from '../stopwatch.js';
import { anchorFirst, leadsTheDay, oneTendon, FIRST_ITEMS } from '../firstup.js';
import { planStreak, versionFor } from '../planstreak.js';
import { renderHistory, bindHistory, summaryLine } from './exhistory.js';
import { dayRing, ringLegend, dayRingItems } from '../dayring.js';
import { suppTime, onSuppTime, suppScore } from './supplements.js';
import { itemStatus, isDone, sidesFor, setLogged, newEntriesFor as makeEntries, runsFor, inferCollagen, COLLAGEN_GAP_MIN, levelOf } from '../logging.js';
import { stepsFor, stepHtml, stageOf } from '../progressions.js';
import { startExercise, startWorkout, resumePlayer, keepAwakeFromTap, draftInfo, workoutQueue, readyAfter, fmtTime12, logDateFor, setLaunchFrom } from '../player/player.js';
import { growIn, foldAway, insertBody, patchHead, reducedMotion} from '../fold.js';
import { liteMotion } from '../motion.js';
import { parse, morph } from '../morph.js';
import { onSwipe } from '../swipe.js';
import { CUSTOM_EX, readConfig, summaryText, totalSeconds, fmtDur, customChips, saveConfig, openCustomWorkout, runName } from '../customworkout.js';

const EFFUSION = ['', 'Zero', 'Trace', '1+', '2+', '3+'];
const ALL_ITEMS = REHAB_PROGRAM.concat(GYM_PROGRAM);

// ------------------------------------------------------------- the day ----
/**
 * Program items planned for the day, both lists, in program order except that
 * anything marked `first` leads: the tendon loading is the morning's first
 * job, with six hours before the rest.
 */
/** Today's rows, read only: never create the day record. A day made outside
 * update() is saved unstamped, and the next load stamps it as the newest thing
 * in the document (audit F04, 2026-09-19). */
const rowsOf = (iso) => getDay(iso)?.entries || [];

function plannedItems(iso) {
  const all = ALL_ITEMS.filter((p) => plannedOn(state.data, p.id, iso));
  return all.filter((p) => p.first).concat(all.filter((p) => !p.first));
}
function restItems(iso) {
  const added = new Set(addedItems(iso).map((p) => p.id));
  return ALL_ITEMS.filter((p) => !plannedOn(state.data, p.id, iso) && !added.has(p.id));
}

/**
 * Program exercises not planned today that he added to today himself (his
 * report, 2026-09-18: he added "Knee extension into the band" and its row only
 * let him type sets and reps, with no Start and no pictures). Added from the
 * picker, a program exercise brings its whole program row into today's list,
 * after the planned ones; only rows marked `added` do this, so opening a row in
 * the fold (which makes scaffolding rows) never moves it.
 */
function addedItems(iso) {
  const entries = getDay(iso)?.entries || [];
  return ALL_ITEMS.filter((p) => !plannedOn(state.data, p.id, iso) && entries.some((e) => e.pid === p.id && e.added));
}

/** The program item an exercise belongs to, clinician program first. */
function itemForExercise(exId) {
  return REHAB_PROGRAM.find((p) => p.ex === exId) || GYM_PROGRAM.find((p) => p.ex === exId) || null;
}

/** Minutes for a row: his number, else the estimate; cardio uses last time. */
const minsMemo = { rev: -1, byId: new Map() };
function rowMinutes(item, ex = exerciseById(item.ex), iso = null) {
  // Once per item per document revision: the head, the row and the fold all
  // ask, and a tick patches all three (B2). An open hold is priced at the goal
  // he is actually holding to, the same item the player builds its run from,
  // or the row's minutes and the learned time never agree (audit F11).
  if (minsMemo.rev !== state.rev) { minsMemo.rev = state.rev; minsMemo.byId.clear(); }
  const withG = iso && item.stopwatch ? withGoals(state.data, item, iso) : item;
  const key = iso && item.stopwatch ? `${item.id}|${iso}` : item.id;
  const hit = minsMemo.byId.get(key);
  if (hit) return hit;
  const last = ex?.cardio ? lastCardioMinutes(item.ex) : null;
  const m = minutesFor(withG, ex, state.data, last, runsFor(state.data, state.rev, item.id));
  minsMemo.byId.set(key, m);
  return m;
}

/** Green means every required side confirmed. See itemStatus in logging.js. */
function isLogged(item, entries) {
  return isDone(item, entries);
}

let currentIso = todayIso();

// ------------------------------------------------------- the morning pair --
// His rule, 2026-09-14: the tendon loading is always exactly one gap after the
// collagen (thirty minutes then, an hour since 2026-09-20). So a time he sets
// for either one sets the other, and marks it done or taken if it was not.
// Only a time he SETS carries over; a plain tick records now and changes
// nothing else. The gap itself lives in logging.js, so the inference that
// fills in a missing collagen tick can never drift from this.
export const MORNING_GAP_MIN = COLLAGEN_GAP_MIN;

function collagenSupp() {
  return (state.data.supplements || []).find((s) => /collagen/i.test(s.name || '')) || null;
}

/**
 * Inside update(): the tendon loading done at `at`. `from` says where the time
 * came from when it was not typed for this row (Codex audit K02): a time set
 * on the collagen is an inference, and `doneAtFrom: 'collagen'` keeps that
 * visible to anything that later reads doneAt as a real completion. What the
 * app shows and does is unchanged.
 */
function setFirstDoneAt(iso, at, from = null, which = null) {
  // Which tendon loading: the one named, else the one he did first that day.
  // With two to choose from, a collagen time alone never guesses and ticks one.
  const item = which || anchorFirst(state.data, iso);
  if (!item) return;
  const d = ensureDay(iso);
  tickItem(d, item, true);
  for (const e of d.entries) {
    if (e.pid !== item.id || !e.logged) continue;
    e.doneAt = at.toISOString();
    if (from) e.doneAtFrom = from; else delete e.doneAtFrom;
  }
}

/** Inside update(): the collagen taken at `at`. */
function setCollagenAt(iso, at) {
  const c = collagenSupp();
  if (!c) return;
  // The collagen's own supplement day (5am rollover), as inferCollagen does:
  // a 00:30 loading puts the collagen at 23:30 on the day before.
  const day = ensureDay(currentDayIso(at) || iso);
  day.supps = { ...(day.supps || {}), [c.id]: at.toISOString() };
}

/**
 * Inside update(): he ticked the tendon loading and the collagen is not marked
 * taken, so mark it an hour earlier (item 19, his words: "if I log
 * tendon and collagen isnt log, it can automatically log the collagen for 30
 * mins before").
 *
 * It only ever ADDS a tick that is missing. A collagen he has already marked,
 * at any time, is left exactly as it is, because the time he recorded is the
 * real one and this is a guess from the pair rule. Undo is the ordinary untick
 * on the Supplements tab.
 */
function inferCollagenFromFirst(iso, at) {
  // One implementation for both the tick and the player (logging.js), so the
  // two ways of logging the loading can never disagree about the collagen.
  return inferCollagen(state.data, iso, at, ensureDay);
}

onSuppTime((iso, suppId, at) => {
  if (collagenSupp()?.id !== suppId) return;
  // Which loading that time belongs to: the one already logged nearest the
  // collagen plus the gap, within three hours. With two of them and no
  // near match, a collagen time moves nothing (audit F07, 2026-09-19).
  const due = new Date(at.getTime() + MORNING_GAP_MIN * 60000);
  const rows = getDay(iso)?.entries || [];
  // Only a loading that is fully done: a half-done lunge must not get its
  // other leg invented by a collagen time (2026-09-23 audit).
  const near = FIRST_ITEMS
    .filter((p) => itemStatus(p, rows).state === 'done')
    .map((p) => {
      const t = rows.filter((e) => e.pid === p.id && e.logged && e.doneAt)
        .map((e) => Date.parse(e.doneAt)).sort((a, b) => a - b)[0];
      return t ? { item: p, off: Math.abs(t - due.getTime()) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.off - b.off)[0];
  const which = near && near.off <= 3 * 3600e3 ? near.item : null;
  const done = FIRST_ITEMS.filter((p) => itemStatus(p, rows).state === 'done');
  if (!which && done.length > 1) return;
  setFirstDoneAt(iso, due, 'collagen', which);
});

export function renderToday(ctx) {
  const iso = ctx.date || todayIso();
  currentIso = iso;
  const day = getDay(iso);
  const entries = day?.entries || [];
  const c = day?.checkin || {};
  const warn = kneeWarning(c);
  const planned = plannedItems(iso);
  const rest = restItems(iso);
  // Runs of the custom workout list right under it, at the top of the rest of
  // the workout; everything else he added sits at the end of the list as before.
  const extras = entries.filter((e) => !e.pid && e.ex !== CUSTOM_EX);
  const customs = entries.filter((e) => !e.pid && e.ex === CUSTOM_EX);
  const firsts = planned.filter((p) => p.first);
  const first = anchorFirst(state.data, iso) || firsts[0];
  const others = planned.filter((p) => !p.first);

  // 2026-09-14 ring design. Today is the dated queue, not a dashboard: the
  // date and title, the count and the time, one Start, one status line, the
  // tendon loading, one quiet sentence for the recovery break, the rest of the
  // plan in order (rows never move when ticked), the knee check-in, a note and
  // one quiet line about the streak. Supplements live on their own tab only
  // (his call, 2026-09-15): the collagen still sets the loading time, and the
  // loading time still marks the collagen, so the morning pair is unaffected.
  return `
  <div class="stack today">
    ${dayHead(iso, planned, extras, entries, ctx)}
    ${warn ? `<div class="notice ${warn.level}">${warn.html}</div>` : ''}
    ${day?.seeded ? `<div class="notice info">Seeded from ${esc(day.source || 'your clinical notes')}. Edit anything that is not right.</div>` : ''}

    ${first ? `<section class="queue-group" id="first-card">
      <div class="queue-label"><span>First up</span>${catLabel(first)}</div>
      <div class="card listcard"><div class="checklist">${firsts.map((p) => checkRow(p, iso, entries, ctx)).join('')}</div></div>
    </section>
    ${others.length ? recoveryLine(first, iso, planned, entries) : ''}` : ''}

    <section class="card listcard" id="session-card">
      <div class="checklist">
        ${customRow(iso, ctx)}
        ${customs.map((e) => extraRow(e, iso, ctx)).join('')}
        ${others.concat(addedItems(iso)).map((p) => checkRow(p, iso, entries, ctx)).join('')}
        ${extras.map((e) => extraRow(e, iso, ctx)).join('')}
        ${!planned.length ? emptyPlan(iso) : ''}
        <button class="list-add" data-act="add-ex"><span class="plus">+</span>Add something else</button>
      </div>
      ${restGroup(rest, iso, entries, ctx, planned.length ? 'Not planned today' : 'All exercises')}
      ${goalsGroup(iso, entries, ctx)}
    </section>
    ${historyGroup(iso)}

    ${kneeCard(c, ctx)}
    ${noteRow(day, ctx)}
    ${weekFoot(iso)}
  </div>`;
}

// ------------------------------------------------------ custom workout ----
/**
 * The custom workout (his ask, 2026-09-18): on Today every day, pinned at the
 * top of the rest of the workout (his call the same afternoon; it sat under the
 * tendon loading for the first session). One row that says what it is set to,
 * a Start that opens the timer (customworkout.js), and his settings under the
 * row when it opens. Every run he logs lists right under it, ticked, like
 * anything else he added.
 */
function customRow(iso, ctx) {
  const cfg = readConfig(state.data);
  const open = !!ctx.openCustom;
  // On a future day Start works as a shortcut and logs today (his call,
  // 2026-09-18), so it is never dimmed.
  const mins = Math.max(1, Math.round(totalSeconds(cfg) / 60));
  // The row reads like every other row (the picture, the name, what it is set
  // to, the minutes, the chevron that opens it), lined up with the rows below
  // by a lead the width of their tick circle. Start lives INSIDE the open row,
  // under the name and the times (his call, 2026-09-18: "don't let me start
  // the custom workout until the dropdown expands so I can fill out the forms
  // and name it"), as a full width button: never squeezed. Closed, a small
  // turquoise arrow beside the minutes says it opens to set one up (his ask,
  // the same afternoon: "a little subtle prompt that I can click on it to
  // expand"). It is part of the row's own button, so it opens the row.
  return `
  <div class="crow cwrow ${open ? 'open editing' : ''}" data-cwrow>
    <div class="crow-head">
      <span class="cw-lead" aria-hidden="true"></span>
      <span class="crow-shot plain">${thumb(CUSTOM_EX, 34)}</span>
      <button class="crow-main" data-cwopen aria-expanded="${open}" aria-controls="cw-set">
        <span class="crow-text">
          <span class="crow-name">${esc(cfg.name)}</span>
          <span class="crow-sub">${esc(summaryText(cfg))}</span>
        </span>
        ${open ? '' : `<span class="cw-nudge" aria-hidden="true">${ICON.go}</span>`}
        <span class="crow-mins" title="${esc(`About ${fmtDur(totalSeconds(cfg))} with rest`)}"><b>${mins}</b><small>min</small></span>
        <span class="crow-chev" aria-hidden="true">${ICON.down}</span>
      </button>
    </div>
    ${open ? `<div class="crow-body" id="cw-set"><div class="crow-body-clip"><div class="crow-body-in">${customForm(cfg, ctx)}
      <div class="cw-gowrap">${goButton({
        attrs: `data-cwstart aria-label="Start ${esc(cfg.name)}"`,
        label: `Start ${cfg.name.toLowerCase() === 'custom workout' ? 'custom workout' : cfg.name}`,
        cls: 'cw-go',
      })}</div></div></div></div>` : ''}
  </div>`;
}

/** His settings. Seconds are typed; every change is saved as he makes it. */
function customForm(cfg, ctx = {}) {
  const sides = cfg.mode === 'sides';
  const fld = (key, label, value, min, max, cls = '') => `<label class="fld cw-fld ${cls}">${esc(label)}
    <input type="number" class="in-num" inputmode="numeric" min="${min}" max="${max}" step="1" data-cwf="${key}" value="${value}"></label>`;
  // Left always sits on the left and right on the right (his call, 2026-09-18:
  // "the right is on the left and the left is on the right" bothered him).
  // Which side goes FIRST is its own control; it never moves the boxes.
  const sideFld = (x) => (x === 'R'
    ? fld('right', 'Right, seconds', cfg.right, 1, 3600, 'right')
    : fld('left', 'Left, seconds', cfg.left, 1, 3600, 'left'));
  // The band is a small button beside the name (his layout, 2026-09-18: "just a
  // little band icon up at the top underneath the workout name on the right
  // side"). It shows the chosen band, or a clear one when there is none; a tap
  // opens the colours, a tap on a colour picks it and closes them.
  const bandLabel = cfg.banded && cfg.band ? `${BAND_BY_ID[cfg.band].name} band. Change` : 'No band. Choose a band';
  return `<div class="cw-form">
    <div class="cw-namerow">
      <label class="fld cw-name">Name
        <input type="text" data-cwname value="${esc(cfg.name)}" maxlength="60" autocomplete="off" enterkeyhint="done"
          placeholder="Custom workout"></label>
      <button type="button" class="cw-bandbtn${ctx.cwBandOpen ? ' on' : ''}" data-cwbandtoggle aria-expanded="${!!ctx.cwBandOpen}"
        aria-label="${esc(bandLabel)}" title="${esc(bandLabel)}"><span class="band-mark${cfg.banded && cfg.band ? '' : ' unknown clear'}">${bandSvg(cfg.banded && cfg.band ? BAND_BY_ID[cfg.band].swatch : null)}</span></button>
    </div>
    ${ctx.cwBandOpen ? bandPicker({ value: cfg.banded ? cfg.band : '', attr: 'data-cwband', label: 'Band for the custom workout' }) : ''}
    <span class="seg cw-seg" role="group" aria-label="Timer type">
      <button data-cwmode="sides" class="${sides ? 'on' : ''}" aria-pressed="${sides}">Right and left</button>
      <button data-cwmode="single" class="${sides ? '' : 'on'}" aria-pressed="${!sides}">Work and rest</button>
    </span>
    <div class="cw-fields ${sides ? 'n4' : 'n3'}">
      ${sides ? ['L', 'R'].map(sideFld).join('') : fld('work', 'Work, seconds', cfg.work, 1, 3600)}
      ${fld('rest', 'Rest, seconds', cfg.rest, 0, 3600)}
      ${fld('rounds', 'Rounds', cfg.rounds, 1, 50)}
    </div>
    ${sides ? `<div class="cw-opts">
      <span class="seg cw-seg" role="group" aria-label="Which side goes first">
        <button data-cwfirst="L" class="${cfg.first === 'L' ? 'on' : ''}" aria-pressed="${cfg.first === 'L'}">Left first</button>
        <button data-cwfirst="R" class="${cfg.first === 'R' ? 'on' : ''}" aria-pressed="${cfg.first === 'R'}">Right first</button>
      </span>
      <span class="seg cw-seg"><button data-cwbetween class="${cfg.restBetween ? 'on' : ''}" aria-pressed="${cfg.restBetween}"
        title="${esc(cfg.first === 'L' ? 'Left, rest, right, rest' : 'Right, rest, left, rest')}">Rest between</button></span>
    </div>` : ''}
    <p class="cw-total">${esc(`${fmtDur(totalSeconds(cfg))} in all.`)} Each ${sides ? 'side' : 'work segment'} waits for your tap; rest starts by itself.</p>
  </div>`;
}

/** The category of an item, as a label in its own colour (never colour alone). */
function catLabel(item) {
  const cat = CATEGORIES[exerciseById(item.ex)?.cat];
  return cat ? `<span class="queue-cat" style="--cat:${cat.color}">${esc(shortCat(cat.label))}</span>` : '';
}

/** Nothing planned: a known rest day says so, an unknown one does not guess. */
function emptyPlan(iso) {
  const known = !!versionFor(state.data, iso);
  return `<div class="queue-empty">
    <b>${known ? 'Planned rest today' : 'No exercises planned today'}</b>
    ${known ? '' : '<button class="btn sm" data-goto="program">Open My Program</button>'}
  </div>`;
}

/**
 * The page head, revision 3: the date with its picker, the arrows in fixed
 * slots, and a Today control that appears to their LEFT only when he is on
 * another day (2026-09-22, his rule: a dead control is hidden, never dimmed;
 * on the left, so the arrows never move under his thumb), then a compact
 * group (the title, the count, the estimate) beside the 88 px day ring, then
 * the one Start or Resume and the status line under it.
 */
function dayHead(iso, plannedAll, extras, entries, ctx) {
  // The tendon loading is one slot in every count, whichever he did.
  // What is not yet due never counts, as in the status line and the streak (2026-09-23 audit).
  const planned = oneTendon(state.data, iso, plannedAll.filter((p) => !p.notYet));
  const plan = dayPlanFor(state.data, iso);
  const doneP = planned.filter((p) => isLogged(p, entries));
  // The icon badge counts exactly what this header counts, so the two can never
  // disagree (item 3). Only for today: a badge about a day he is reading back
  // would be a lie about what is due now.
  if (iso === todayIso()) {
    const sc = suppScore(suppIsoFor(iso));
    paintBadge({ exercises: Math.max(0, planned.length - doneP.length), supplements: sc ? sc.total - sc.taken : 0 });
  }
  const allMins = planned.map((p) => rowMinutes(p, exerciseById(p.ex), iso));
  const leftMins = planned.filter((p) => !doneP.includes(p)).map((p) => rowMinutes(p, exerciseById(p.ex), iso));
  const today = todayIso();
  const title = iso === today ? 'Today' : iso === addDays(today, -1) ? 'Yesterday' : iso === addDays(today, 1) ? 'Tomorrow' : fmtDate(iso, 'dow');
  // 2026-09-15, his call: "there's plenty of negative space available to make
  // this circle icon with the rings more prominent and bigger... without
  // compromising the vertical space that the app is taking up." The estimate
  // moved up beside the count on one line, which is what pays for the extra
  // height, and the ring grew into the space that was already empty beside it.
  // Everything he did counts (his call, 18 Sep, after a two hour physio
  // session read as "1/4 planned"): each exercise logged today that is not in
  // the plan, a clinic session's included, joins the ring as a done segment.
  // The same items and rows the player's day thread draws (dayRingItems, B3-3).
  const drawn = dayRingItems(state.data, iso);
  const allDone = planned.length > 0 && doneP.length >= planned.length;
  const ring = dayRing(drawn.items, drawn.entries,
    { size: 118, stroke: 10, center: 'count', label: drawn.extras || allDone ? 'done' : 'planned',
      won: true, wonPlay: allDone && iso === todayIso() && firstWon(iso) });
  let count;
  let est;
  if (!planned.length) { count = plan.name ? esc(plan.name) : 'Nothing planned'; est = ''; }
  else if (doneP.length >= planned.length) {
    // The finished day reads as one (his ask, 18 Sep): gold words, everything counted.
    const n = ring.total;
    const physio = entries.some((e) => e.logged && e.clinic);
    count = `<span class="sum-won">All done!</span>`;
    est = `${n} exercise${n === 1 ? '' : 's'} today${physio ? ', physio included' : ''}`;
  }
  else if (!doneP.length) { count = `${planned.length} exercise${planned.length === 1 ? '' : 's'}`; est = cap(fmtDayTotal(allMins)); }
  else { count = `${planned.length - doneP.length} left`; est = cap(fmtDayTotal(leftMins)); }

  return `
  <header class="pagehead today-head">
    <div class="daynav">
      <span class="daynav-date eyebrow"><span class="dn-long">${esc(longDate(iso))}</span><span class="dn-short">${esc(longDate(iso, true))}</span>
        <input type="date" data-jump value="${iso}" aria-label="Jump to a date"></span>
      <span class="daynav-ctl">
        ${iso === today ? '' : '<button class="btn sm daynav-today" data-nav="today">Today</button>'}
        <button class="daynav-arrow" data-nav="-1" aria-label="Previous day">${ICON.left}</button>
        <button class="daynav-arrow" data-nav="1" aria-label="Next day">${ICON.right}</button>
        <button class="icon-btn daynav-menu" data-act="menu" title="More" aria-label="More for this day">${ICON.more}</button>
      </span>
    </div>
    <div class="today-top">
      <div class="today-sum">
        <h1>${esc(title)}</h1>
        <div class="sum-count">${plan.name && planned.length ? `<span class="sum-plan">${esc(plan.name)}</span>` : ''}${count}${
          est ? `<span class="sum-est">${esc(est)}${plan.clinic && !allDone ? ` · ${esc(plan.sub)}` : ''}</span>` : ''}</div>
        ${ring.total > 12 ? ringLegend(drawn.items) : ''}
      </div>
      ${planned.length ? ring.html : '<span class="dayring-slot" aria-hidden="true"></span>'}
    </div>
  </header>
  ${workoutButton(iso)}
  ${statusLine(iso, planned, entries, ctx)}`;
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** True the first time a day is drawn finished on this device, so the burst plays once. */
// Held for a few seconds once spent, so a patch that builds the head and then
// falls back to a full redraw still draws the burst the first build earned.
const wonAt = {};
function firstWon(iso) {
  if (wonAt[iso] && Date.now() - wonAt[iso] < 4000) return true;
  try {
    const k = `rehab-won-${iso}`;
    if (localStorage.getItem(k)) return false;
    localStorage.setItem(k, '1');
    wonAt[iso] = Date.now();
    return true;
  } catch { return false; }
}


/**
 * The one session-status slot, under the one Start. It names the open workout
 * with its full title, side, set and when it stopped; otherwise what Start
 * will do; otherwise that the plan is done. Text only: the button is the one
 * place to start or resume.
 */
function statusLine(iso, planned, entries, ctx = {}) {
  const d = draftInfo();
  // Said once, for the visit after the player left with nothing logged (A1).
  if (ctx.todayNotice && ctx.todayNotice.iso === iso && !(d && d.phase !== 'done')) {
    return `<div class="daystatus notice">${esc(ctx.todayNotice.text)}</div>`;
  }
  const t12 = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  let html;
  let cls = '';
  if (d && d.phase !== 'done') {
    cls = 'resume';
    // Between two exercises the workout waits for Resume, which is a pause to
    // him (never "Up next", his call 2026-09-15: he does not work in order).
    const label = d.phase !== 'between' && d.state === 'running' ? 'Running' : 'Paused';
    const when = d.pausedAt ? `since ${t12(d.pausedAt)}` : '';
    const other = d.iso && d.iso !== iso ? fmtDate(d.iso, 'dow') : '';
    // One flex item for the words after the label, so a wrap never starts a
    // line with a lone separator ("· Tendon loading...", 2026-09-22).
    html = `<b>${esc(label)}</b><span class="ds-rest">${esc([d.title, d.where, when, other].filter(Boolean).join(' · '))}</span>`;
  } else if (planned.length && iso > todayIso()) {
    // Starting a future day's plan logs on today (his call, 2026-09-18). Ticks
    // on this page log to this page's date.
    html = `Start logs on today, ${esc(fmtDate(todayIso(), 'dow'))}`;
  } else if (planned.length) {
    const next = planned.find((p) => !p.notYet && itemStatus(p, entries, iso).state !== 'done');
    if (!next) {
      cls = 'alldone';
      html = `${ICON.check}<b>Plan complete</b>`;
    } else if (next.first && !anchorFirst(state.data, iso)) {
      html = FIRST_ITEMS.length > 1 ? 'Tendon loading first' : `${esc(shortTitle(next))} first`;
    } else {
      // No "Up next" (his call, 2026-09-15): "this just takes up space and I
      // think is unnecessary, especially because sometimes I don't do my
      // workouts in order." Naming one exercise as next implies an order the
      // list does not have, and the list is right there underneath.
      //
      // The tendon loading keeps its line above, because that one really is
      // first: it is an hour after his collagen and the day is built
      // around it.
      return EMPTY_STATUS;
    }
  } else {
    return EMPTY_STATUS;
  }
  return `<div class="daystatus ${cls}">${html}</div>`;
}
// The slot stays in the page even when it has nothing to say, so a tick can
// patch the head in place (it expects three pieces: head, Start, status). With
// no slot every tick in the commonest state fell back to a whole redraw.
const EMPTY_STATUS = '<div class="daystatus empty" aria-hidden="true"></div>';

/** "Monday, September 14", with the year only when it is not this year. */
function longDate(iso, short = false) {
  const d = new Date(iso + 'T12:00:00');
  const opts = short ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

/** "Tendon loading" rather than the whole prescription name, for one short line. */
function shortTitle(item) {
  const t = item.title || exerciseById(item.ex)?.name || item.ex;
  return /tendon loading/i.test(t) ? 'Tendon loading' : t;
}

const ICON = {
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>',
  chev: '<svg class="disc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
};

/** What the minutes on a row are based on, for its tooltip and the open row. */
export function minsTitle(m) {
  if (m.src === 'yours') return 'Your number';
  if (m.src === 'logged') return 'What you logged';
  if (m.src === 'learned') return `Usually about ${m.mins} min, from your last ${m.learned?.runs ?? ''} timed runs`;
  if (m.src === 'untimed') return m.zero ? 'Untimed: you set it to 0, so it adds nothing to the day' : 'Target not specified, so no time estimate';
  return 'Estimated from the prescription. Open the row to change it.';
}

/**
 * Start or Resume: one control in one place, its label saying which. Dimmed,
 * never removed, when there is nothing left and no workout open.
 */
function workoutButton(iso) {
  const d = draftInfo();
  const left = workoutQueue(state.data, iso, logDateFor(iso)).length;
  const resume = !!d && d.phase !== 'done';
  // A day that has not come yet can be started as a shortcut to its plan (his
  // call, 2026-09-18, replacing audit A30's dimmed Start); what it logs goes on
  // today (logDateFor). Future means after the calendar date, so the small
  // hours still count as today.
  const future = iso > todayIso();
  // An open workout from another day says which day it is.
  const other = resume && d.iso && d.iso !== iso ? ` from ${fmtDate(d.iso, 'dow')}` : '';
  // C2 (2026-09-15): while today has nothing logged at all, Start breathes very
  // slightly, so the one thing worth tapping is the one thing moving. It stops
  // the moment anything is logged, and never appears on another day, because a
  // day he is reading back has nothing to start.
  const plan = plannedItems(iso).filter((p) => !p.notYet);
  // B5-1 (2026-09-23): it breathes again once the recovery window has opened,
  // while nothing after the first job is logged, so the next thing worth
  // tapping is again the one thing moving. Never on another day.
  const isToday = iso === todayIso();
  const ready = isToday ? readyAfter(state.data, iso) : null;
  const opened = !!ready && ready.getTime() <= Date.now();
  const firstIds = new Set(FIRST_ITEMS.map((p) => p.id));
  const afterFirst = rowsOf(iso).some((e) => e.logged && !firstIds.has(e.pid));
  const empty = isToday && !resume && plan.length > 0 && left > 0
    && (left === plan.length || (opened && !afterFirst));
  // The one Start (and Resume) a finger can feel (B6-1): a label around a
  // hidden switch where there is one to feel, a button everywhere else.
  return goButton({
    attrs: `data-act="${resume ? 'resume' : 'start'}" aria-label="${resume ? `Resume ${esc(d.title || 'workout')}${esc(other)}` : future ? `Start ${esc(fmtDate(iso, 'dow'))}'s workout, logged today` : 'Start the workout'}"`,
    label: resume ? `Resume workout${esc(other)}` : 'Start workout',
    cls: `startbtn${empty && !future ? ' breathing' : ''}`,
    disabled: !(resume || left),
    haptic: true,
  });
}

/**
 * The recovery break as one quiet sentence between the first job and the rest.
 * Before the tendon loading is confirmed with a time it names the break
 * without inventing a clock time; once it is, the actual time, tappable to
 * correct when it was done. When nothing is left to do, it says the recovery
 * is complete instead of pointing at work that no longer waits (F23).
 */
function recoveryLine(first, iso, planned, entries) {
  const ready = readyAfter(state.data, iso);
  const left = planned.some((p) => !p.first && !p.notYet && itemStatus(p, entries, iso).state !== 'done');
  if (!left) {
    return `<div class="recovery-line done">${ICON.clock}<span>Recovery complete</span></div>`;
  }
  if (ready) {
    // B5-1 (2026-09-23): on the day itself the window counts down, one fixed
    // line with a thin neutral fill under it (elapsed over the whole gap), and
    // says when it has opened. Information only: nothing is blocked, the time
    // is still tappable to correct, and it is never gold (nothing is finished)
    // or turquoise (it is not the action; Start is). The countdown's text and
    // the fill are patched every 30 s by watchRecovery, never repainted. Where
    // the whole sentence cannot fit one line (a 393 px phone with "5 h 59 min"
    // and a two digit hour), the clock time drops out rather than the line
    // wrapping; the countdown says the same thing and the time is one tap away.

    const w = iso === todayIso() ? recoveryWindow(iso, ready) : null;
    if (w) {
      const open = w.left <= 0;
      return `<button class="recovery-line readysep counting${open ? ' open' : ''}" data-act="readytime" title="Change when the tendon loading was done">
      ${ICON.clock}<span class="rl-text">${open ? '<span class="rl-in">Rest of your workout is ready</span>'
        : `<span class="rl-in">Rest of your workout in <span data-recov-left>${esc(fmtLeft(w.left))}</span></span><span class="rl-at">&nbsp;· after ${esc(fmtTime12(ready))}</span>`}</span>
      <span class="rl-fill" aria-hidden="true"><i style="transform:scaleX(${w.frac.toFixed(4)})"></i></span></button>`;
    }
    return `<button class="recovery-line readysep" data-act="readytime" title="Change when the tendon loading was done">
      ${ICON.clock}<span>Rest of your workout after ${esc(fmtTime12(ready))}</span></button>`;
  }
  return `<div class="recovery-line">${ICON.clock}<span>Rest of your workout after tendon recovery</span></div>`;
}

/**
 * The recovery window on `iso`: from the moment the anchor tendon loading was
 * done (the same rows readyAfter reads) to `ready`. `frac` is the elapsed share
 * of the whole gap, `left` the milliseconds still to go (0 or less once open).
 */
function recoveryWindow(iso, ready, now = Date.now()) {
  const first = anchorFirst(state.data, iso);
  const t = rowsOf(iso).filter((e) => e.pid === first?.id && e.logged && e.doneAt)
    .map((e) => Date.parse(e.doneAt)).filter((x) => Number.isFinite(x));
  if (!t.length) return null;
  const start = Math.max(...t);
  const end = ready.getTime();
  if (!(end > start)) return null;
  return { start, end, left: end - now, frac: Math.min(1, Math.max(0, (now - start) / (end - start))) };
}

/** "3 h 42 min", "42 min", "1 min": whole minutes, rounded up so it never reads 0 before it opens. */
function fmtLeft(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ------------------------------------------------ the window counting down ---
// One watch at a time, for the Today page on screen (B5-1). A 30 s interval
// writes only the span's words and the fill's transform; one timeout at the
// ready time asks for a soft repaint, which turns the line to ready and lets
// Start breathe. A new date, a new page or a new ready time replaces it; a page
// that is no longer on screen (another tab) stops it at its next tick.
const recov = { iv: 0, to: 0, page: null, ctx: null, iso: null, rerender: null, readyAt: 0 };

function stopRecovery() {
  clearInterval(recov.iv);
  clearTimeout(recov.to);
  recov.iv = 0;
  recov.to = 0;
  recov.page = null;
  recov.readyAt = 0;
}

const recovLive = () => !!recov.page && recov.page.isConnected
  && recov.ctx?.view === 'today' && (recov.ctx.date || todayIso()) === recov.iso && todayIso() === recov.iso;

function recovTick() {
  if (!recovLive()) { stopRecovery(); return; }
  const line = recov.page.querySelector(':scope > .recovery-line.counting');
  const ready = readyAfter(state.data, recov.iso);
  const w = ready && recoveryWindow(recov.iso, ready);
  if (!line || !w || ready.getTime() !== recov.readyAt) { stopRecovery(); return; }
  const span = line.querySelector('[data-recov-left]');
  const text = fmtLeft(w.left);
  if (span && span.textContent !== text) span.textContent = text;
  const fill = line.querySelector('.rl-fill > i');
  if (fill) fill.style.transform = `scaleX(${w.frac.toFixed(4)})`;
}

function watchRecovery(page, ctx, iso, rerender) {
  stopRecovery();
  if (!page || iso !== todayIso()) return;
  const ready = readyAfter(state.data, iso);
  if (!ready) return;
  const left = ready.getTime() - Date.now();
  if (left <= 0 || !recoveryWindow(iso, ready)) return;
  Object.assign(recov, { page, ctx, iso, rerender, readyAt: ready.getTime() });
  if (document.visibilityState === 'hidden') return;   // restarted when he comes back
  recov.iv = setInterval(recovTick, 30000);
  recov.to = setTimeout(() => {
    const live = recovLive();
    const again = recov.rerender;
    stopRecovery();
    if (live) again({ soft: true });
  }, left + 250);
}

/** After a tick: start, move or stop the watch when the tendon loading's time changed. */
function ensureRecovery(page, ctx, iso, rerender) {
  if (!page?.isConnected) return;
  const at = readyAfter(state.data, iso)?.getTime() || 0;
  if (recov.page === page && recov.readyAt === at) return;
  watchRecovery(page, ctx, iso, rerender);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!recov.page) return;
    if (document.visibilityState === 'hidden') {
      clearInterval(recov.iv);
      clearTimeout(recov.to);
      recov.iv = 0;
      recov.to = 0;
      return;
    }
    if (!recovLive()) { stopRecovery(); return; }
    const { page, ctx, iso, rerender } = recov;
    const ready = readyAfter(state.data, iso);
    if (ready && ready.getTime() <= Date.now()) {
      // It opened while the phone was away: the line and Start catch up at once.
      stopRecovery();
      rerender({ soft: true });
      return;
    }
    watchRecovery(page, ctx, iso, rerender);
    recovTick();
  });
}

// ------------------------------------------------------------- the rows ----
// Three states per row:
//   untouched  - collapsed, neutral
//   editing    - expanded with the input fields and a Log button
//   done       - collapsed, green tick, with what you entered shown underneath

function catStyle(ex) {
  const c = CATEGORIES[ex?.cat]?.color;
  return c ? ` style="--cat:${c}"` : '';
}

function checkRow(item, iso, entries, ctx) {
  const ex = exerciseById(item.ex);
  const mine = entries.filter((e) => e.pid === item.id);
  const status = itemStatus(item, entries, iso);
  const started = mine.length > 0;
  const done = status.state === 'done';
  const partial = status.state === 'partial';
  // Only confirmed rows are results. Scaffolding from opening the row keeps
  // showing the prescription, so a prefilled number never reads as done.
  const confirmed = mine.filter((e) => e.logged);
  const open = ctx.editing === item.id;
  const band = state.data.program.band[item.id] ?? item.band ?? '';
  const name = item.title || ex?.name || item.ex;
  // A logged cardio row shows the minutes it actually took.
  const logged = confirmed.length && ex?.cardio ? num(confirmed[0].time) : null;
  const m = logged ? { mins: Math.round(logged), src: 'logged' } : rowMinutes(item, ex, iso);
  const bodyId = `row-${item.id}`;

  return `
  <div class="crow ${done ? 'done' : ''} ${partial ? 'partial' : ''} ${started && !done && !partial ? 'started' : ''} ${open ? 'open editing' : ''} ${ctx.pop === item.id ? 'pop' : ''}" data-pid="${esc(item.id)}"${catStyle(ex)}>
    <div class="crow-head">
      ${hapTaps()
        ? `<label class="tick" role="checkbox" tabindex="0" aria-checked="${done}" data-ptoggle="${esc(item.id)}" aria-label="Done: ${esc(name)}${partial ? ', partly done' : ''}">${hapInput()}</label>`
        : `<input type="checkbox" class="tick" data-ptoggle="${esc(item.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(name)}${partial ? ', partly done' : ''}">`}
      ${item.thumb
        ? `<button class="crow-shot" data-bigpic="${esc(item.id)}" aria-label="Show the pictures for ${esc(name)}"><img src="${esc(item.thumb)}" alt="" decoding="async"></button>`
        : `<span class="crow-shot plain">${thumb(item.ex, 34)}</span>`}
      <button class="crow-main" data-rowclick="${esc(item.id)}" aria-expanded="${open}" aria-controls="${bodyId}">
        <span class="crow-text">
          <span class="crow-name">${esc(name)}${bandMark(confirmed.find((e) => e.band || e.bands), { planned: band, usesBand: !!(ex?.usesBand || band) })}</span>
          <span class="crow-sub">${confirmed.length ? entryChips(confirmed) + statusNote(status) : prescriptionLine(withGoals(state.data, item, iso), null)}</span>
          ${item.notYet && !confirmed.length ? `<span class="crow-note warn">${esc(item.notYetNote)}</span>` : ''}
          ${item.pre && !confirmed.length ? `<span class="crow-note">${esc(preNote(item, iso))}</span>` : ''}
        </span>
        <span class="crow-mins ${m.src}" title="${esc(minsTitle(m))}">${m.mins == null ? '' : `<b>${m.mins}</b><small>min</small>`}</span>
        <span class="crow-chev" aria-hidden="true">${ICON.down}</span>
      </button>
    </div>
    ${open ? `<div class="crow-body" id="${bodyId}"><div class="crow-body-clip"><div class="crow-body-in">${rowBody(item, ex, iso, mine, confirmed)}</div></div></div>` : ''}
  </div>`;
}

/**
 * An open row, revision 3: Begin first, then the category and the whole step
 * pictures, the one most useful line (this session, or last session), then
 * Instructions and the session's details as deliberate disclosures. The
 * details hold the existing editor (every entry's fields, the minutes, Done at,
 * Remove) with no approval step. No Log it: the circle logs.
 */
/**
 * What he actually rests on this exercise, offered once (D2, 2026-09-15).
 *
 * Only where the program prescribes no rest and he has set none, so the player
 * has been using a flat thirty seconds that has nothing to do with him. It is
 * an offer, never applied on its own: he taps Use, and it becomes his setting.
 */
function restSuggestion(item, ex) {
  const prefs = (state.data.program?.timer || {})[item.id] || {};
  if (prefs.restSec != null) return '';
  const learned = learnedRest(item, ex, runsFor(state.data, state.rev, item.id));
  if (!learned) return '';
  return `<div class="rest-learned">
    <span>You usually rest about ${learned.secs} seconds here. The player is using 30.</span>
    <button type="button" class="btn sm" data-uselearned="${esc(item.id)}" data-secs="${learned.secs}">Use ${learned.secs}s</button>
  </div>`;
}

/**
 * A progression his clinician has moved him on to, offered in the open row
 * (2026-09-23, his call: "suggest trying it when I open, then I decide").
 * Never applied on its own. Try it moves "Where you are" in My Program; Not yet
 * hides it for a week (a dated key in the synced seen map), then it asks again.
 */
const SUGGEST_SNOOZE_DAYS = 7;
function offeredStep(item, sg) {
  const step = stepsFor(item, state.data)[sg.stage - 1];
  return step && step.n === sg.stage - 1 ? step : null;
}
function progressSuggestion(item, iso) {
  const sg = item.suggest;
  // sg.stage counts into the whole list (progressions.js); his own steps come
  // after the clinicians', so a clinician's step keeps its number. If a step
  // before it were ever dropped for naming no source, the number would point
  // at the wrong one, so the offer only stands when it is still that step.
  const step = sg ? offeredStep(item, sg) : null;
  if (!sg || iso < sg.from || !step) return '';
  if (stageOf(item, state.data) >= sg.stage) return '';
  const snoozed = state.data.program.seen?.[`suggest:${item.id}:${sg.stage}`];
  if (snoozed && iso < addDays(snoozed, SUGGEST_SNOOZE_DAYS)) return '';
  return `<div class="rest-learned prog-suggest">
    <span>${esc(sg.text)} Try it today?</span>
    <button type="button" class="btn sm" data-sugnot="${esc(item.id)}">Not yet</button>
    <button type="button" class="btn sm primary" data-sugtry="${esc(item.id)}"><span>${stepHtml(step)}</span></button>
  </div>`;
}

/**
 * Where he is in the exercise's progressions, the same buttons My Program has
 * (his ask, 22 Sep: level up while doing the exercise). One setting,
 * program.stage, so the two places always agree.
 */
function whereYouAre(item) {
  const steps = stepsFor(item, state.data);
  if (!steps.length) return '';
  const stage = stageOf(item, state.data);
  return `<div class="row-stage">
    <div class="section-title">Where you are</div>
    <div class="stagebar" role="group" aria-label="Where you are in the progressions">
      ${[null].concat(steps).map((step, i) => `
        <button type="button" class="stagestep ${i === stage ? 'on' : ''} ${i < stage ? 'past' : ''}"
          data-tstage="${esc(item.id)}" data-i="${i}" aria-pressed="${i === stage}">${stepHtml(step)}</button>`).join('')}
    </div>
  </div>`;
}

function rowBody(item, ex, iso, mine, confirmed) {
  const cat = CATEGORIES[ex?.cat];
  const sum = summaryLine(state.data, item, iso);
  const name = item.title || ex?.name || item.ex;
  const hasInstr = (item.steps && item.steps.length) || (item.notes && item.notes.length) || item.note || item.pre;
  return `
    ${goButton({ attrs: `data-timer="${esc(item.id)}" ${item.notYet ? 'disabled' : ''}`, label: 'Begin', cls: 'row-begin' })}
    ${cat ? `<div class="row-cat" style="--cat:${cat.color}">${esc(cat.label)}</div>` : ''}
    ${item.img ? `<button class="row-photo" data-bigpic="${esc(item.id)}" aria-label="Show the pictures for ${esc(name)} larger${videoFor(item.id) ? ', with a video' : ''}">
        <img src="${esc(item.img)}" alt="Step pictures: ${esc(name)}" decoding="async"><span class="row-photo-zoom" aria-hidden="true">${ICON.zoom}</span>${videoFor(item.id) ? VIDEO_TAG : ''}</button>` : ''}
    ${!item.img && videoFor(item.id) ? `<button type="button" class="btn sm row-watch" data-bigpic="${esc(item.id)}">Watch the video</button>` : ''}
    <div class="row-summary"><small>${esc(sum.label)}</small><b>${sum.html}</b></div>
    ${progressSuggestion(item, iso)}
    ${whereYouAre(item)}
    ${restSuggestion(item, ex)}
    ${hasInstr ? `<details class="row-disc" data-key="instr-${esc(item.id)}">
      <summary>Instructions${ICON.chev}</summary>
      <div class="row-disc-body">
        ${item.pre ? `<p><strong>Before this:</strong> ${esc(item.pre)}</p>` : ''}
        ${item.steps?.length ? `<ol class="steps">${item.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
        ${item.note ? `<p class="muted">${esc(item.note)}</p>` : ''}
        ${item.notes?.length ? `<div class="callout small">${item.notes.map(esc).join('<br>')}</div>` : ''}
      </div>
    </details>` : ''}
    <details class="row-disc" data-key="details-${esc(item.id)}">
      <summary>${confirmed.length ? 'Correct this session' : 'Enter details'}${ICON.chev}</summary>
      <div class="row-disc-body">
        ${renderHistory(state.data, item, iso, { compact: true })}
        ${itemBand(item, ex, mine)}
        ${foldedBoards(item, ex)}
        ${bothLegs(item, ex, mine)
          ? entryFields(mine.find((e) => e.side === 'L'), ex, { band: false, ids: mine.map((e) => e.id) })
          : mine.map((e) => entryFields(e, ex, { band: false })).join('')}
        ${detailBar(item, ex)}
        ${mine.some((e) => e.added) ? `<div class="logbar"><span class="spacer"></span><button class="btn sm ghost danger" data-del-item="${esc(item.id)}">Remove from today</button></div>` : ''}
      </div>
    </details>`;
}

/**
 * One band for the exercise, whatever its sides (his call, 2026-09-18: "I'm
 * going to be using the same color band for both sides. It's redundant to have
 * to choose it twice"). The choice goes on every row of the day and becomes the
 * exercise's band from then on ("the color band that I use for that exercise
 * should be the default for that exercise moving forward").
 */
/** The per-leg load boards, folded so the fields come first (18 Sep, "very busy"). */
function foldedBoards(item, ex) {
  const b = boards(item, ex);
  if (!b || !b.trim()) return '';
  return `<details class="row-disc" data-key="boards-${esc(item.id)}"><summary>Load by leg${ICON.chev}</summary><div class="row-disc-body">${b}</div></details>`;
}

function itemBand(item, ex, mine) {
  const planned = state.data.program.band[item.id] ?? item.band ?? '';
  const value = mine.find((e) => e.band)?.band || planned;
  const picker = bandPicker({ value, attr: 'data-itemband', key: item.id, label: `Band for ${item.title || ex?.name || item.ex}` });
  if (ex?.usesBand || planned || mine.some((e) => e.band)) return `<div class="fld wide bandfld"><span>Band</span>${picker}</div>`;
  // Any other strength or balance exercise can take a band too (his report,
  // 18 Sep: a knee extension done with a TheraBand had nowhere to say so).
  // Folded, so exercises he never bands stay quiet.
  if (!['strength', 'balance'].includes(ex?.cat)) return '';
  return `<details class="fld wide bandfold"><summary>Add a band</summary>${picker}</details>`;
}

/**
 * What the clinic's note says was done at physical therapy that day (Mac only,
 * read-only). No tick and no editor: it is the chart's record, not his log.
 */
function historyGroup(iso) {
  const rows = historyEntries(iso);
  if (!rows.length) return '';
  return `<section class="queue-group" id="pt-history">
    <div class="queue-label"><span>At physical therapy</span><span class="muted">from the clinic's note</span></div>
    <div class="card listcard"><div class="checklist">${rows.map((e) => {
      const ex = exerciseById(e.ex);
      const cat = CATEGORIES[ex?.cat];
      return `<div class="crow done history"${catStyle(ex)}>
        <div class="crow-head">
          <span class="crow-shot plain">${thumb(e.ex, 34)}</span>
          <div class="crow-main static">
            <span class="crow-text">
              <span class="crow-name">${esc(rowName(e, ex?.name || e.ex))}${ptMark(e)}${bandMark(e, { usesBand: !!ex?.usesBand })}</span>
              <span class="crow-sub">${entryChips([e])}${cat ? `<span class="muted">${esc(cat.label)}</span>` : ''}</span>
              <span class="crow-note">${esc(e.notes || '')}</span>
            </span>
          </div>
        </div>
      </div>`;
    }).join('')}</div></div>
  </section>`;
}

/** Something logged outside the program: a walk, a rehearsal, a clinic drill. */
function extraRow(e, iso, ctx) {
  const ex = exerciseById(e.ex);
  const open = ctx.editing === e.id;
  const done = !!e.logged;
  const cat = CATEGORIES[ex?.cat];
  const bodyId = `row-${e.id}`;
  // A custom workout run carries his own name for it.
  const name = e.ex === CUSTOM_EX ? runName(e) : rowName(e, ex?.name || e.ex);
  // The minutes it took, in the same column as every planned row (his report,
  // 2026-09-18: a finished custom workout "did not show the time on the right
  // side"). Whole minutes like the rest of the list; under one minute reads 1.
  const t = num(e.time);
  const mins = t != null && t > 0 ? Math.max(1, Math.round(t)) : null;
  return `
  <div class="crow ${done ? 'done' : 'started'} ${e.ex === CUSTOM_EX ? 'cw-run' : ''} ${open ? 'open editing' : ''} ${e.id === ctx.flash ? 'flash' : ''} ${ctx.pop === e.id ? 'pop' : ''}"${catStyle(ex)}>
    <div class="crow-head">
      <input type="checkbox" class="tick" data-etoggle="${esc(e.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(name)}">
      <span class="crow-shot plain">${thumb(e.ex, 34)}</span>
      <button class="crow-main" data-rowclick="${esc(e.id)}" aria-expanded="${open}" aria-controls="${bodyId}">
        <span class="crow-text">
          <span class="crow-name">${esc(name)}${ptMark(e)}${bandMark(e, { usesBand: !!ex?.usesBand })}</span>
          <span class="crow-sub">${entryChips([e])}${cat ? `<span class="muted">${esc(cat.label)}</span>` : ''}</span>
        </span>
        ${mins != null ? `<span class="crow-mins logged" title="What you logged"><b>${mins}</b><small>min</small></span>` : '<span class="crow-mins"></span>'}
        <span class="crow-chev" aria-hidden="true">${ICON.down}</span>
      </button>
    </div>
    ${open ? `<div class="crow-body" id="${bodyId}"><div class="crow-body-clip"><div class="crow-body-in">${entryFields(e, ex)}${detailBar(null, ex, e)}</div></div></div>` : ''}
  </div>`;
}

/** The fold's one line, on its own so a tick can patch it (B2). */
function restSummary(rows, entries, label) {
  const done = rows.filter((p) => isLogged(p, entries)).length;
  return `<summary>${esc(label)} · ${rows.length}${done ? ` <span class="good">${done} done</span>` : ''}</summary>`;
}

/** The folded group under the list. Open state lives on ctx so a tick does not close it. */
function restGroup(rows, iso, entries, ctx, label) {
  if (!rows.length) return '';
  return `
  <details class="fold" data-rest="openRest" ${ctx.openRest ? 'open' : ''}>
    ${restSummary(rows, entries, label)}
    <div class="fold-body"><div class="fold-clip"><div class="checklist">${rows.map((p) => checkRow(p, iso, entries, ctx)).join('')}</div></div></div>
  </details>`;
}

/** Minutes, Done at and Remove, inside a row's details. No Log it: the circle logs. */
function detailBar(item, ex, entry = null) {
  const est = item ? rowMinutes(item, ex) : null;
  const own = item ? num(state.data.program.mins?.[item.id]) : null;
  return `<div class="logbar">
    ${item ? `<label class="fld minsfld" title="Minutes this takes you. Leave it empty to use the estimate.">Minutes
      <input type="number" class="in-num" min="0" step="1" data-mins="${esc(item.id)}" placeholder="${est.src !== 'yours' && est.mins != null ? est.mins : ''}" value="${own ?? ''}"></label>` : ''}
    ${item?.first ? doneAtField(item) : ''}
    <span class="spacer"></span>
    ${entry ? `<button class="btn sm ghost danger" data-del-entry="${esc(entry.id)}">Remove</button>` : ''}
  </div>`;
}

/**
 * "Done at" for the morning's first job, on the time wheel. For the days he
 * does the tendon loading and logs it later: setting a time marks it done at
 * that time, and the six hour line follows it.
 */
function doneAtField(item) {
  const iso = currentIso;
  const rows = (getDay(iso)?.entries || []).filter((e) => e.pid === item.id && e.logged && e.doneAt);
  const t = rows.length ? new Date(Math.max(...rows.map((e) => Date.parse(e.doneAt)))) : null;
  const v = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '';
  return `<label class="fld doneatfld" title="When you did it. Setting a time marks it done.">Done at
    <input type="time" class="in-num" data-doneat="${esc(item.id)}" value="${v}"></label>`;
}

/** Load history for a gym lift, shown only while the row is open. */
function boards(item, ex) {
  if (!GYM_PROGRAM.includes(item)) return '';
  const unit = state.data.settings.weightUnit;
  const cardio = !!ex?.cardio;
  const field = cardio ? 'resistance' : 'load';
  const html = sidesFor(item).map((s) => {
    const leg = s === 'B' ? null : s;
    const mx = maxLoad(item.ex, leg, field);
    const series = loadSeries(item.ex, leg, 12, field);
    const last = series.length ? series[series.length - 1] : null;
    return `
    <div class="board">
      <div class="row between" style="gap:.4rem">
        <span class="sidetag ${s}">${cardio ? 'best level' : s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'both legs'}</span>
        <span class="mono board-max">${mx ? (cardio ? `L${round(mx.load, 0)}` : `${round(mx.load, 2)} ${esc(mx.loadUnit || unit)}`) : '·'}</span>
      </div>
      ${loadBars(series)}
      <div class="tiny muted">${last
        ? cardio
          ? `last ${esc(fmtDateShort(last.date))} · level ${round(last.load, 0)}${last.time ? ` · ${round(last.time, 0)} min` : ''}${last.calories ? ` · ${last.calories} cal` : ''}`
          : `last ${esc(fmtDateShort(last.date))} · ${round(last.load, 2)} ${esc(last.unit)}${last.sets ? ` · ${last.sets} × ${last.reps ?? '?'}` : ''}`
        : 'nothing logged yet'}</div>
    </div>`;
  }).join('');
  return `<div class="boards">${html}</div>`;
}

/**
 * The line before the first job. Once the collagen is ticked with a time, it
 * says when the loading should start by ("within the hour", his clinic's
 * wording in the program), instead of the general reminder.
 */
function preNote(item, iso) {
  // With two tendon loadings, the collagen pairs with the one he did first.
  // The other row keeps the general reminder, or it would show a past time
  // that belongs to the other exercise (audit F08, 2026-09-19).
  const led = anchorFirst(state.data, iso);
  if (led && led.id !== item.id) return item.preShort || item.pre;
  const sIso = suppIsoFor(iso);
  const list = state.data.supplements || [];
  const ticks = getDay(sIso)?.supps || {};
  const collagen = list.find((s) => /collagen/i.test(s.name || '') && ticks[s.id]);
  const at = collagen ? suppTime(ticks[collagen.id]) : null;
  if (!at) return item.preShort || item.pre;
  const due = new Date(at.getTime() + MORNING_GAP_MIN * 60000);
  const t12 = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `Collagen at ${t12(at)} · loading at ${t12(due)}`;
}

/** The small print after a result: which side is still to do, or that one
 *  figure covers both legs. Secondary, never the headline. */
function statusNote(status) {
  const bits = [];
  if (status.state === 'partial') {
    const sides = (status.missing || []).filter((s) => s === 'L' || s === 'R');
    bits.push(sides.length
      ? `${sides.map((s) => (s === 'L' ? 'left' : 'right')).join(' and ')} still to do`
      : 'partly done');
  }
  if (status.unsplit) bits.push('one figure for both legs');
  if (status.imported) bits.push('PhysiApp');
  return bits.length ? `<span class="srcnote">${esc(bits.join(' · '))}</span>` : '';
}

/** One-line readout of what was entered, for a started or done row. */
function entryChips(mine) {
  if (!mine.length) return '';
  // Left and right that read the same are one chip, "each side" (2026-09-18).
  if (mine.length === 2 && mine.some((e) => e.side === 'L') && mine.some((e) => e.side === 'R') && !mine.some((e) => e.custom)) {
    const [a, b] = ['L', 'R'].map((s) => chipsFor([{ ...mine.find((e) => e.side === s), side: 'B' }]));
    if (a === b) return a.replace(/<\/span>$/, '<span class="muted"> each side</span></span>');
  }
  return chipsFor(mine);
}

function chipsFor(mine) {
  return mine.map((e) => {
    // A custom run reads as two chips that wrap, what was done then how it was
    // set, so a long line never runs off the row (his iPhone, 2026-09-18).
    if (e.custom) {
      const c = customChips(e);
      const set = c.filter((t) => /^(Right|Left|Work|Rest) /.test(t));
      const did = c.filter((t) => !set.includes(t));
      // Each item keeps its words together, so a narrow row breaks between
      // "6 min 30 s" and "Right 30 s", never inside them.
      const keep = (t) => t.replace(/ /g, '\u00a0');
      return [did, set].filter((x) => x.length).map((x) => `<span class="sumchip">${esc(x.map(keep).join(' · '))}</span>`).join('') || '<span class="sumchip">done</span>';
    }
    const bits = [];
    const bySet = Array.isArray(e.repsBySet) ? e.repsBySet.filter((x) => x != null) : [];
    const holds = Array.isArray(e.secsList) ? e.secsList.filter((x) => x != null) : [];
    // Holds read as holds ("4 × 30 s"), never as sets of one rep plus a time.
    if (holds.length) bits.push(holds.every((x) => x === holds[0]) ? `${holds.length} × ${holds[0]} s` : `${holds.join(' + ')} s`);
    else if (bySet.length > 1 && bySet.some((x) => x !== bySet[0])) bits.push(`${bySet.join(' + ')} reps`);
    else if (e.sets && e.reps) bits.push(`${e.sets}×${e.reps}`);
    else if (e.reps) bits.push(`${e.reps} reps`);
    else if (e.sets) bits.push(`${e.sets} set${Number(e.sets) === 1 ? '' : 's'}`);
    if (num(e.load)) bits.push(`${round(num(e.load), 2)} ${e.loadUnit || state.data.settings.weightUnit}`);
    if (num(e.time)) bits.push(`${round(num(e.time), 2)} min`);
    if (!holds.length && num(e.secs)) bits.push(`${round(num(e.secs), 1)} s`);
    else if (num(e.hold)) bits.push(`hold ${round(num(e.hold), 1)} s`);
    // Only the legs that have a number: a missing one read as a separator ("R · s").
    const legs = (a, b, unit = '') => [num(a) != null ? `L ${a}${unit}` : '', num(b) != null ? `R ${b}${unit}` : ''].filter(Boolean).join(' · ');
    if (num(e.secsL) != null || num(e.secsR) != null) bits.push(legs(e.secsL, e.secsR, ' s'));
    if (num(e.testL) != null || num(e.testR) != null) bits.push(`best ${legs(e.testL, e.testR)}`);
    if (num(e.resistance)) bits.push(`level ${e.resistance}`);
    if (num(e.calories)) bits.push(`${e.calories} cal`);
    if (num(e.rpe)) bits.push(`effort ${e.rpe}`);
    const b = e.band ? BAND_BY_ID[e.band] : null;
    const side = (e.side || 'B') !== 'B' ? `<b class="sidetag ${e.side}">${e.side}</b> ` : '';
    return `<span class="sumchip">${side}${b ? `<i class="swatch" style="background:${b.swatch}"></i>` : ''}${
      bits.length ? esc(bits.join(' · ')) : '<span class="muted">done</span>'}</span>`;
  }).join('');
}

// ------------------------------------------------ this month's targets ----
/**
 * The plan's weekly targets, each a group you can open and tick into. Folded
 * under the list: in the early months the program covers them, but from
 * Month 3 the plan asks for landing, running and dance work that no program
 * row holds, and this is where that gets logged.
 */
function goalsSummary(groups) {
  return `<summary>This week's targets · ${groups.filter((g) => g.met).length}/${groups.length} met</summary>`;
}

function goalsGroup(iso, entries, ctx) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  const month = monthForDate(iso);
  const openKey = ctx.openGoal === undefined ? (groups.find((g) => !g.met)?.t.id ?? null) : ctx.openGoal;

  return `
  <details class="fold" data-rest="openGoals" ${ctx.openGoals ? 'open' : ''}>
    ${goalsSummary(groups)}
    <div class="fold-body"><div class="fold-clip"><div class="goalbox">
    ${groups.map((g) => {
      const open = openKey === g.t.id;
      const all = allExercises().filter((x) => g.t.tagged ? x.tag === g.t.tagged : g.t.cats.includes(x.cat));
      const showAll = ctx.goalAll === g.t.id;
      const mN = month.exMonth ?? month.n;
      const list = showAll || !mN ? all : all.filter((x) => !x.months || x.months.includes(mN));
      return `
      <div class="goalgroup ${g.met ? 'met' : ''} ${open ? 'open' : ''}" style="--c:${g.colour}">
        <button class="goalhead" data-goalgroup="${esc(g.t.id)}" aria-expanded="${open}">
          <span class="goalname">${esc(g.label)}</span>
          <span class="pips">${Array.from({ length: g.goal }, (_, i) => `<i class="${i < g.hit ? 'on' : ''}"></i>`).join('')}</span>
          <span class="tiny mono nowrap ${g.met ? 'metx' : ''}">${g.met ? 'done' : `${g.left} to go`}</span>
          <span class="chev">⌄</span>
        </button>
        ${open ? `<div class="goalbody checklist">
          ${list.map((ex) => {
            const mine = entries.filter((e) => e.ex === ex.id && !e.pid);
            const started = mine.length > 0;
            const done = started && mine.every((e) => e.logged);
            const editing = started && ctx.editing === 'cat:' + ex.id;
            return `<div class="crow ${done ? 'done' : started ? 'started' : ''} ${editing ? 'editing' : ''} ${ctx.pop === ex.id ? 'pop' : ''}"${catStyle(ex)}>
              <div class="crow-head">
                <input type="checkbox" class="tick" data-cattoggle="${esc(ex.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(ex.name)}">
                <span class="crow-shot plain">${thumb(ex.id, 34)}</span>
                <button class="crow-main" data-catclick="${esc(ex.id)}" aria-expanded="${editing}">
                  <span class="crow-name">${esc(ex.name)}</span>
                  <span class="crow-sub">${started ? entryChips(mine) : (ex.clinic ? '<span class="muted">clinic</span>' : '')}</span>
                </button>
              </div>
              ${editing ? mine.map((e) => entryFields(e, ex)).join('') : ''}
            </div>`;
          }).join('')}
          ${all.length > list.length || showAll
            ? `<button class="btn sm ghost" data-goalall="${esc(g.t.id)}" style="margin-top:.4rem">
                ${showAll ? 'Just this month' : `Show all ${all.length}`}</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('')}
    </div></div></div>
  </details>`;
}

// ---------------------------------------------------------- supplements ----
/**
 * Supplements are the Supplements tab's job, not Today's (his call,
 * 2026-09-15). Today still reads the collagen tick for the loading time, and
 * between midnight and 5am it reads it from yesterday's list, exactly as that
 * tab does (see currentDayIso), so both screens agree on which day it is.
 */
function suppIsoFor(iso) {
  return iso === todayIso() ? currentDayIso() : iso;
}

// --------------------------------------------------------------- knees ----
function kneeCard(c, ctx) {
  return `
  <section class="card panel kneerow ${ctx.openKnees ? 'open' : ''}">
    <button class="panel-head" data-panel="knees" aria-expanded="${!!ctx.openKnees}">
      <span class="panel-title"><h2>Knee check-in</h2>
        <span class="sub">${kneeSummary(c)}</span></span>
      <span class="chev">⌄</span>
    </button>
    ${ctx.openKnees ? `<div class="fold-body"><div class="fold-clip"><div class="card-body">
      ${legBlock('L', 'Left', c)}
      ${legBlock('R', 'Right', c)}
      <div class="row" style="margin-top:.5rem">
        <label class="fld" style="flex:1;min-width:150px">Yesterday's session left me
          <select data-ck="nextDay">
            ${['', 'Better', 'Same', 'Worse'].map((o) => `<option ${c.nextDay === o ? 'selected' : ''}>${o || '·'}</option>`).join('')}
          </select>
        </label>
        <label class="fld" style="width:110px">Effort (1 to 10)
          <input type="number" min="0" max="10" step="1" data-ck="rpe" value="${c.rpe ?? ''}">
        </label>
      </div>
      <label class="fld" style="margin-top:.5rem">Notes
        <textarea data-ck="notes" placeholder="How it felt, anything that flared, sleep, mood">${esc(c.notes || '')}</textarea>
      </label>
    </div></div></div>` : ''}
  </section>`;
}

function kneeSummary(c) {
  const bits = [];
  if (num(c.painL) != null || num(c.painR) != null) {
    bits.push(`pain ${[num(c.painL) != null ? `L ${c.painL}` : '', num(c.painR) != null ? `R ${c.painR}` : ''].filter(Boolean).join(' · ')}`);
  }
  const eff = [c.effusionL, c.effusionR].filter((v) => v && v !== 'Zero');
  if (eff.length) bits.push(`swelling ${eff.join(', ')}`);
  else if (c.effusionL === 'Zero' || c.effusionR === 'Zero') bits.push('no swelling');
  if (c.nextDay) bits.push(`yesterday: ${c.nextDay.toLowerCase()}`);
  return bits.length ? esc(bits.join('  ·  ')) : 'Left and right · optional';
}

function legBlock(side, label, c) {
  const painKey = side === 'L' ? 'painL' : 'painR';
  const effKey = side === 'L' ? 'effusionL' : 'effusionR';
  const painVal = c[painKey] ?? '';
  return `
  <div style="margin-bottom:.45rem">
    <div class="row" style="gap:.4rem;margin-bottom:.15rem">
      <span class="sidetag ${side}">${esc(label)}</span>
      <span class="tiny muted">pain</span>
      <strong class="mono" style="font-size:.8rem" data-ckout>${painVal === '' ? '·' : painVal + '/10'}</strong>
      <span class="spacer"></span>
      <label class="tiny muted" style="display:flex;gap:.3rem;align-items:center">swelling
        <select data-ck="${effKey}" class="sel-sm" aria-label="${esc(label)} knee swelling">
          ${EFFUSION.map((o) => `<option value="${o}" ${(c[effKey] || '') === o ? 'selected' : ''}>${o || '·'}</option>`).join('')}
        </select>
      </label>
    </div>
    <input type="range" min="0" max="10" step="1" data-ck="${painKey}" value="${painVal === '' ? 0 : painVal}"
      aria-label="${esc(label)} knee pain, 0 to 10" aria-valuetext="${painVal === '' ? 'not recorded' : `${painVal} out of 10`}">
  </div>`;
}

/** The plan's own rules, as one line each, only when the day's check-in trips them. */
function kneeWarning(c) {
  const eff = [c.effusionL, c.effusionR].filter(Boolean);
  const swollen = eff.filter((v) => v && v !== 'Zero');
  const pain = Math.max(num(c.painL) ?? 0, num(c.painR) ?? 0);
  if (swollen.length) {
    return { level: 'bad', html: `<strong>Swelling logged (${esc(swollen.join(', '))}).</strong> The plan says regress as tolerated.` };
  }
  if (c.nextDay === 'Worse') {
    return { level: 'warn', html: '<strong>Yesterday left you worse.</strong> Back off rather than push through.' };
  }
  if (pain >= 2) {
    return { level: 'warn', html: `<strong>Pain at ${pain}/10.</strong> The plan gates impact work on staying under 2/10.` };
  }
  return null;
}

// ---------------------------------------------------------------- note ----
function noteRow(day, ctx) {
  if (day?.notes || ctx.openNote) {
    return `<section class="card"><div class="card-body tight">
      <label class="fld">About today
        <textarea data-daynote placeholder="Not an exercise: travel, a flare-up, how the rehearsal went">${esc(day?.notes || '')}</textarea>
      </label></div></section>`;
  }
  return `<button class="rowlink ghost" data-act="note"><span class="plus">+</span><b>Add a note about today</b></button>`;
}

/** The bottom of the day: this week against the plan, one small tile per
 *  target, and the plan streak beside them. Tiles rather than a sentence that
 *  wrapped mid-count (Fable's idea 6, 2026-09-19). */
function weekFoot(iso) {
  const groups = goalGroups(iso);
  const streak = iso === todayIso() ? planStreak(state.data, iso) : 0;
  if (!groups.length && streak < 1) return '';
  // Each bar grows in its turn as the foot comes into view (--i, B5-3).
  const tile = (g, i) => {
    const p = g.goal ? Math.min(100, Math.round((g.hit / g.goal) * 100)) : 0;
    return `<span class="wf-tile ${g.met ? 'met' : ''}">
      <span class="wf-k">${esc(shortCat(g.t.label))}</span>
      <span class="wf-v mono">${g.hit}<small>/${g.goal}</small></span>
      <span class="wf-bar" aria-hidden="true"><i style="width:${p}%;background:${esc(g.colour)};--i:${i}"></i></span>
    </span>`;
  };
  const streakTile = streak >= 1 ? `<span class="wf-tile streak">
      <span class="wf-k">Streak</span>
      <span class="wf-v mono">${streak}<small> ${streak === 1 ? 'day' : 'days'}</small></span>
      <span class="wf-bar" aria-hidden="true"><i style="width:100%;background:var(--good);--i:${groups.length}"></i></span>
    </span>` : '';
  return `<button class="today-foot" data-goto="progress" aria-label="This week against the plan. Opens Progress">
    <span class="wf-head">This week <span class="wf-go" aria-hidden="true">›</span></span>
    <span class="wf-tiles">${groups.map(tile).join('')}${streakTile}</span>
  </button>`;
}

// -------------------------------------------------------------- fields ----
/** Log once, count twice: turn logged rows into test results as well, so a
 *  number never has to be typed in two places.
 *
 *  Deliberately conservative. It writes only a value you actually entered,
 *  only for exercises that map to a test, and never a second result for the
 *  same test, leg and day. Re-logging or an edit must not stack duplicates
 *  or quietly overwrite a real test you recorded properly.
 *  Returns labels for what it saved.
 */
function recordAsTests(iso, entries) {
  const saved = [];
  const rows = [];
  for (const e of entries) {
    const ex = exerciseById(e.ex);
    const m = testableMeasure(ex);
    if (!m) continue;

    const mf = measureField(ex);
    if (!mf) continue;   // no honest equivalent on a training row

    let pairs;
    const split = splitOn(e, ex);
    if (split) {
      pairs = [['L', num(e.secsL)], ['R', num(e.secsR)]];
    } else if (testFields(ex)) {
      pairs = [['L', num(e.testL)], ['R', num(e.testR)]];
    } else {
      const v = num(e[mf.f]);
      const leg = e.side === 'L' || e.side === 'R' ? e.side : null;
      // A both-sides row for a per-leg test is one number for two legs; that
      // is a guess, so it is left for the "as test" button to confirm.
      if (m.perLeg && !leg) continue;
      pairs = [[leg, v]];
    }

    for (const [leg, value] of pairs) {
      if (value == null || Number.isNaN(value)) continue;
      const exists = state.data.measurements.some(
        (x) => x.measure === m.id && x.date === iso && (x.leg || null) === (leg || null))
        // the L and R rows of one item both carry Best L and Best R (2026-09-23 audit)
        || rows.some((x) => x.measure === m.id && (x.leg || null) === (leg || null));
      if (exists) continue;
      rows.push({ id: uid(), date: iso, measure: m.id, leg: leg || null, value });
      const u = UNIT_LABEL[m.unit] || '';
      const withUnit = u.length > 2 ? `${value} ${u}` : `${value}${u}`;
      saved.push(`${m.label}${leg ? ` (${leg === 'L' ? 'left' : 'right'})` : ''} ${withUnit}`);
    }
  }
  if (rows.length) update((d) => { d.measurements.push(...rows); });
  saved.ids = rows.map((r) => r.id);   // so an Undo can take exactly these back
  return saved;
}

/** True when logging this row can also stand as a test result. */
export function testableMeasure(ex) {
  const m = ex?.measure ? MEASURE_BY_ID[ex.measure] : null;
  return m || null;
}

// Which entry field actually holds the quantity a test measures. Only these
// are honest equivalences: seconds held and reps performed. A measure in cm,
// degrees, newtons or per cent has no counterpart on a training row, so those
// keep the manual "as test" button and are never written automatically.
const UNIT_FIELD = { sec: 'secs', reps: 'reps' };

function measureField(ex) {
  const m = testableMeasure(ex);
  const f = m && UNIT_FIELD[m.unit];
  return f ? { m, f } : null;
}

/** True for a both-sides row whose test is measured in seconds. Only the
 *  seconds field is split into left and right; reps are deliberately not,
 *  because PhysiApp syncs into `reps` and a working set is not a max effort. */
function splitOn(e, ex) {
  const mf = measureField(ex);
  if (!mf || !mf.m.perLeg || mf.f !== 'secs') return null;
  if ((e.side || 'B') !== 'B') return null;
  return 'secs';
}

/** The dedicated per-side test inputs, for rep-counted tests. */
function testFields(ex) {
  const mf = measureField(ex);
  if (!mf || mf.f !== 'reps' || !mf.m.perLeg) return null;
  return mf;
}

function sideBox(e, field, side, label) {
  const k = field + side;
  return `<label class="fld"><span class="sidetag ${side}">${side}</span> ${label}<input type="number" step="any" min="0" data-f="${k}" value="${e[k] ?? ''}"></label>`;
}

function secsFields(e, ex) {
  if (splitOn(e, ex)) {
    return sideBox(e, 'secs', 'L', 'Secs') + sideBox(e, 'secs', 'R', 'Secs');
  }
  if (!ex?.secs) {
    // Minutes only where time is the measure, or he already entered some: a
    // sets and reps exercise has no use for it (his report, 18 Sep: too busy).
    if (ex?.track !== 'time' && e.time == null) return '';
    return `<label class="fld">Min<input type="number" step="any" min="0" data-f="time" value="${e.time ?? ''}"></label>`;
  }
  return `<label class="fld">Secs<input type="number" step="any" min="0" data-f="secs" value="${e.secs ?? ''}"></label>`;
}

function repsFields(e) {
  return `<label class="fld">Reps<input type="number" step="1" min="0" data-f="reps" value="${e.reps ?? ''}"></label>`;
}

/** "Best L / Best R": the max-effort figure that counts as a test result,
 *  kept separate from the reps you did in a working set. */
function testBoxes(e, ex) {
  const mf = testFields(ex);
  if (!mf) return '';
  const boxes = `<span class="testboxes" title="${esc(mf.m.label)}: your best, recorded as a test">
    ${sideBox(e, 'test', 'L', 'Best')}${sideBox(e, 'test', 'R', 'Best')}
  </span>`;
  // Folded until he wants it (18 Sep, "very busy"): open when a best is in.
  const has = ['testL', 'testR', 'test'].some((k) => e[k] != null && e[k] !== '');
  return `<details class="fld wide testfold" ${has ? 'open' : ''}><summary>Test result</summary>${boxes}
    <button class="btn sm astest" data-astest="${esc(e.id)}"
      title="Record this as a test result, so it counts towards your month markers">as test</button></details>`;
}

/**
 * Sets and reps on both legs are one line (his call, 2026-09-18: "if it has to
 * do with reps and sets, I'm going to be doing the same amount on both
 * sides"). The rows stay one per leg underneath, and the line writes both.
 * Legs stay apart for held or timed work (a single-leg balance can be 30 s on
 * one leg and 45 on the other), and when the two rows already differ, so
 * nothing he entered per leg is overwritten.
 */
const SAME = ['sets', 'reps', 'load', 'loadUnit', 'time', 'secs', 'notes', 'rpe'];
function bothLegs(item, ex, mine) {
  if (mine.length !== 2) return false;
  const L = mine.find((e) => e.side === 'L');
  const R = mine.find((e) => e.side === 'R');
  if (!L || !R) return false;
  if (ex?.secs || ex?.cardio || ['hold', 'timed', 'cardio'].includes(item.timer)) return false;
  // Empty, zero and missing are the same thing here (a Min of 0 beside an
  // empty Min is not a difference he made).
  const v = (e, f) => JSON.stringify(e[f] === '' || e[f] === 0 || e[f] == null ? null : e[f]);
  if (SAME.some((f) => v(L, f) !== v(R, f))) return false;
  if (JSON.stringify(L.repsBySet || null) !== JSON.stringify(R.repsBySet || null)) return false;
  return true;
}

function entryFields(e, ex, { band: showBand = true, ids = null } = {}) {
  const unit = e.loadUnit || state.data.settings.weightUnit;
  const usesBand = ex?.usesBand;
  const side = ids
    ? '<span class="sidetag B">Both legs</span>'
    : `<span class="sidetag ${e.side || 'B'}">${e.side === 'L' ? 'Left' : e.side === 'R' ? 'Right' : 'both'}</span>`;

  // A custom workout run: what can honestly be corrected afterwards.
  if (e.ex === CUSTOM_EX) {
    return `
    <div class="pfields" data-entry="${esc(e.id)}">
      <label class="fld wide">Name<input data-f="name" data-rename value="${esc(runName(e))}" maxlength="60" autocomplete="off" enterkeyhint="done"></label>
      <label class="fld">Rounds<input type="number" step="1" min="0" data-f="sets" value="${e.sets ?? ''}"></label>
      <label class="fld">Minutes<input type="number" step="any" min="0" data-f="time" value="${e.time ?? ''}"></label>
      <label class="fld">Effort<input type="number" step="1" min="0" max="10" data-f="rpe" value="${e.rpe ?? ''}"></label>
      <label class="fld wide">Note<input data-f="notes" value="${esc(e.notes || '')}"></label>
    </div>`;
  }

  if (ex?.cardio) {
    return `
    <div class="pfields ${e.logged ? '' : 'prefill'}" data-entry="${esc(e.id)}">
      ${side}
      <label class="fld">Minutes<input type="number" step="any" min="0" data-f="time" value="${e.time ?? ''}"></label>
      <label class="fld">Level 1 to 20<input type="number" step="1" min="1" max="20" data-f="resistance" value="${e.resistance ?? ''}"></label>
      <label class="fld">Calories<input type="number" step="1" min="0" data-f="calories" value="${e.calories ?? ''}"></label>
      <label class="fld">Effort<input type="number" step="1" min="0" max="10" data-f="rpe" value="${e.rpe ?? ''}"></label>
      <label class="fld wide">Note<input data-f="notes" value="${esc(e.notes || '')}"></label>
    </div>`;
  }

  return `
  <div class="pfields ${e.logged ? '' : 'prefill'}" data-entry="${esc(e.id)}"${ids ? ` data-entries="${esc(ids.join(','))}"` : ''} ${e.logged ? '' : 'title="Filled in from last time. Not logged until you confirm it."'}>
    ${side}
    <label class="fld">Sets<input type="number" step="1" min="0" data-f="sets" value="${e.sets ?? ''}"></label>
    ${repsFields(e)}
    <label class="fld">Load ${esc(unit)}<input type="number" step="any" min="0" data-f="load" value="${e.load ?? ''}"></label>
    ${secsFields(e, ex)}
    ${showBand && (usesBand || e.band || e.bandText || ['strength', 'balance'].includes(ex?.cat)) ? `<div class="fld wide bandfld"><span>Band</span>${bandPicker({ value: e.band || '', attr: 'data-bandpick', key: e.id })}</div>` : ''}
    ${testBoxes(e, ex)}
    <label class="fld wide">Note<input data-f="notes" value="${esc(e.notes || '')}"></label>
    ${ex?.measure && !testFields(ex) ? `<button class="btn sm astest" data-astest="${esc(e.id)}"
      title="Record this as a test result, so it counts towards your month markers">as test</button>` : ''}
  </div>`;
}

// ------------------------------------------------------------- helpers ----
/**
 * The most recent earlier day with something LOGGED from the program, so
 * "Same as last time" copies a real session, not a day that was only looked at.
 */
const lastSessionMemo = { rev: -1, iso: null, value: null };
function lastSessionFor(iso) {
  // Read once per document revision (Fable B4): the day menu was scanning
  // every day's entries on each open, 30 ms at 6x CPU.
  if (lastSessionMemo.rev === state.rev && lastSessionMemo.iso === iso) return lastSessionMemo.value;
  lastSessionMemo.value = lastSessionScan(iso);
  lastSessionMemo.rev = state.rev;
  lastSessionMemo.iso = iso;
  return lastSessionMemo.value;
}
function lastSessionScan(iso) {
  const ids = new Set(ALL_ITEMS.map((p) => p.id));
  const prev = Object.keys(state.data.days)
    .filter((k) => k < iso && (state.data.days[k].entries || []).some((e) => e.logged && ids.has(e.pid)))
    .sort().pop();
  if (!prev) return null;
  return { date: prev, entries: state.data.days[prev].entries.filter((e) => e.logged && ids.has(e.pid)) };
}

/** An exercise+side may only appear once in a day. Editing beats duplicating. */
function alreadyLogged(day, exId, side) {
  return (day.entries || []).some((e) => e.ex === exId && (e.side || 'B') === (side || 'B'));
}

function newEntriesFor(item, ex, logged = false, onIso = null) {
  return makeEntries(item, ex, {
    logged,
    onIso,
    prev: (side) => lastEntry(item.ex, side),
    weightUnit: state.data.settings.weightUnit,
    band: state.data.program.band[item.id] || '',
  });
}

/**
 * Tick a program item done. Rows he already has are confirmed; a required
 * side with no row gets one, unless an unsplit result already covers it.
 */
function tickItem(d, item, on, iso = null) {
  const mine = d.entries.filter((e) => e.pid === item.id);
  if (!on) { setLogged(mine, false); return; }
  // Ticking the tendon loading marks the collagen an hour earlier when
  // he has not marked it himself (item 19). `iso` is passed only by the tick
  // handlers; setFirstDoneAt calls this while already setting a time, and does
  // its own pairing, so it must not double up here.
  // Returns the collagen id it marked, so the caller can weaken that path's sync
  // stamp once update() has finished (rule zero: a guess never beats a real tick).
  const inferred = item.first && iso ? inferCollagenFromFirst(iso, new Date()) : null;
  const stampable = iso == null || iso === todayIso();
  if (!mine.length) {
    const fresh = newEntriesFor(item, exerciseById(item.ex), true, iso);
    d.entries.push(...fresh);
    if (stampable) stampLevel(fresh, item);
    return inferred;
  }
  const coversAll = mine.some((e) => (e.side || 'B') === 'B');
  const confirmed = mine.filter((e) => !e.logged);
  if (!coversAll) {
    const fresh = newEntriesFor(item, exerciseById(item.ex), true, iso)
      .filter((row) => !mine.some((e) => (e.side || 'B') === row.side));
    d.entries.push(...fresh);
    confirmed.push(...fresh);
  }
  setLogged(mine, true);
  if (stampable) stampLevel(confirmed, item);
  return inferred;
}

/**
 * The progression step he is at, on the rows this tick confirmed (History
 * reads it). Only today's, and never over a step a row already carries
 * (2026-09-23 audit): a retick rewrote the step a run was saved at, and a
 * backfilled day took the step he reached later.
 */
function stampLevel(rows, item) {
  const level = levelOf(state.data, item);
  if (!level) return;
  for (const e of rows) if (e.pid === item.id && e.logged && !e.level) e.level = level;
}

function newCatEntry(exId) {
  const ex = exerciseById(exId);
  const prev = lastEntry(exId, 'B');
  return {
    id: uid(), ex: exId, side: 'B', logged: false,
    sets: prev?.sets ?? null, reps: prev?.reps ?? null,
    load: prev?.load ?? null, loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
    secs: prev?.secs ?? null, time: prev?.time ?? null,
    band: ex?.usesBand ? (prev?.band || '') : undefined,
  };
}

function testToast(tests) {
  if (!tests.length) return;
  toast(`<b>Also saved as ${tests.length === 1 ? 'a test' : 'tests'}</b><br><span>${esc(tests.join(' · '))}</span>`);
}

/**
 * Scroll the window, smoothly, without relying on `behavior: 'smooth'`,
 * which is silently a no-op in some engines.
 */
function scrollWindowTo(top, ms = 320) {
  const start = window.scrollY;
  const dist = Math.max(0, top) - start;
  if (Math.abs(dist) < 2) return;
  if (document.visibilityState !== 'visible') { window.scrollTo(0, Math.max(0, top)); return; }
  // The phone's own smooth scroll where there is one: it is drawn by the
  // system at the screen's rate, while a scroll stepped from animation frames
  // drops to 30 frames in Low Power Mode.
  if ('scrollBehavior' in document.documentElement.style) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
    window.scrollTo(0, start + dist * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function scrollToEl(el) {
  if (!el) return;
  const header = document.querySelector('.mtop') || document.querySelector('.topbar');
  const clear = (header ? header.getBoundingClientRect().height : 0) + 8;
  scrollWindowTo(el.getBoundingClientRect().top + window.scrollY - clear);
}

// ---------------------------------------------------------------- menu ----
/**
 * The day's bulk actions, behind one button so the header stays calm:
 * same as last time, tick everything, repeat last session, the clinic
 * program, record a test, clear the day.
 */
function openDayMenu(iso, ctx, rerender) {
  const last = lastSessionFor(iso);
  // The same count the header shows (2026-09-22: the menu said 15 while the
  // header said 14): the tendon loading is one slot, and what is not yet due
  // is not ticked. Nothing planned means nothing to tick, so no button.
  const planned = oneTendon(state.data, iso, plannedItems(iso)).filter((p) => !p.notYet);
  const hasHep = !!(CLINIC_HEP.entries || []).length;
  const clinic = dayPlanFor(state.data, iso).clinic;
  openModal({
    title: fmtDate(iso),
    body: `<div class="menu">
      ${last ? `<button class="btn" data-m="same">Same as last time<span class="tiny muted">${esc(fmtDateShort(last.date))}, with the same numbers</span></button>` : ''}
      ${planned.length ? `<button class="btn" data-m="tickall">Tick everything planned<span class="tiny muted">${planned.length} exercise${planned.length === 1 ? '' : 's'}, with last time's numbers</span></button>` : ''}
      <button class="btn" data-m="repeat">Repeat last session, unticked<span class="tiny muted">rows in grey, for you to tick</span></button>
      ${hasHep ? `<button class="btn" data-m="hep">${esc(CLINIC_HEP.label || 'Clinic program')}</button>` : ''}
      <button class="btn" data-m="test">Record a test</button>
      <button class="btn" data-m="clinic">${clinic ? 'Not a clinic day after all' : 'Mark as a clinic day'}<span class="tiny muted">${clinic ? 'the full list comes back' : 'the session is the workout; at home just tendon loading and balance'}</span></button>
      <button class="btn danger" data-m="clear">Clear today's exercises</button>
    </div>`,
    onMount(root) {
      root.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        const act = b.dataset.m;
        closeModal();
        if (act === 'same' && last) {
          const marked = [];
          update(() => {
            const d = ensureDay(iso);
            for (const e of last.entries) {
              const mine = d.entries.filter((x) => x.pid === e.pid && (x.side || 'B') === (e.side || 'B'));
              if (mine.length) { setLogged(mine, true); marked.push(...mine); continue; }
              // A clinic's badge belongs to that session only; so do its test
              // results and the step it was done at (2026-09-23 audit).
              const { id, seeded, via, paSnap, doneAt, timing, runId, partial, clinic, exWas, testL, testR, test, level, ...rest } = e;
              const row = { id: uid(), ...rest };
              setLogged([row], true);
              d.entries.push(row);
              marked.push(row);
              const item = ALL_ITEMS.find((p) => p.id === row.pid);
              if (item && iso === todayIso()) stampLevel([row], item);
            }
          });
          const tests = recordAsTests(iso, marked);
          const n = new Set(marked.map((x) => x.pid)).size;
          toast(`<b>Same as ${esc(fmtDateShort(last.date))}</b><br><span>${n} exercise${n === 1 ? '' : 's'} ticked${tests.length ? ` · also saved as ${tests.length === 1 ? 'a test' : 'tests'}` : ''}</span>`);
        }
        if (act === 'tickall') {
          const guessed = [];
          update(() => {
            const d = ensureDay(iso);
            for (const item of planned) {
              // iso so the tendon loading marks the collagen here too: the pair
              // rule holds however the row got ticked.
              const g = tickItem(d, item, true, iso);
              if (g) guessed.push(g);
            }
          });
          for (const g of guessed) weakenDayPath(g.iso, `supps.${g.id}`);
        }
        if (act === 'repeat') {
          const prev = Object.keys(state.data.days)
            .filter((k) => k < iso && (state.data.days[k].entries || []).length)
            .sort().pop();
          if (!prev) { toast('<b>No earlier session to copy</b>', 'warn'); return; }
          update(() => {
            const d = ensureDay(iso);
            for (const e of state.data.days[prev].entries) {
              const { id, seeded, via, paSnap, doneAt, timing, runId, partial, clinic, exWas, ...rest } = e;   // a clinic's badge belongs to that session only
              if (rest.pid && d.entries.some((x) => x.pid === rest.pid)) continue;
              if (alreadyLogged(d, rest.ex, rest.side)) continue;
              d.entries.push({ id: uid(), ...rest, logged: false });
            }
          });
        }
        if (act === 'hep') {
          update(() => {
            const d = ensureDay(iso);
            for (const e of CLINIC_HEP.entries) {
              if (alreadyLogged(d, e.ex, e.side)) continue;
              // Marked, so Clear takes them away again like any program row.
              d.entries.push({ id: uid(), ...e, logged: false, via: 'hep' });
            }
          });
        }
        if (act === 'test') {
          openMeasureEntry({
            measureId: 'sl_calf_raise',
            date: iso,
            onSave(rows) {
              update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
              rerender();
            },
          });
          return;
        }
        if (act === 'clinic') {
          // Marking one narrows the day to the tendon loading and balance
          // work, because the session itself is the big workout.
          update((d) => {
            const map = ((d.program ||= {}).clinicDays ||= {});
            if (map[iso]) delete map[iso]; else map[iso] = true;
          });
        }
        if (act === 'clear') {
          // Program rows and rows the Clinic program action added (A3: those
          // had no program id, so Clear left them behind).
          const bulk = (e) => e.pid || e.via === 'hep';
          const n = (getDay(iso)?.entries || []).filter(bulk).length;
          if (!n || !confirm(`Remove all ${n} program exercise${n === 1 ? '' : 's'} from ${fmtDate(iso)}? Anything you added yourself stays.`)) return;
          update(() => {
            const d = ensureDay(iso);
            d.entries = d.entries.filter((e) => !bulk(e));
          });
        }
        ctx.editing = null;
        rerender();
      }));
    },
  });
}

/**
 * Correct when the tendon loading was done, for when he logged it later than
 * he did it. Only rows that already carry a time are changed; nothing is
 * invented for a row without one.
 */
function editReadyTime(iso, rerender) {
  const first = anchorFirst(state.data, iso);
  const rows = (getDay(iso)?.entries || []).filter((e) => e.pid === first?.id && e.logged && e.doneAt);
  if (!rows.length) return;
  const t = new Date(Math.max(...rows.map((e) => Date.parse(e.doneAt))));
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  openModal({
    title: 'When did you finish the tendon loading?',
    body: `<label class="fld">Finished at<input type="time" class="in-num" data-readyinput value="${hh}:${mm}"></label>
      <div class="tiny muted" style="margin-top:.4rem">The rest of your workout can start ${esc(first.gap || '6 hours')} after this.</div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-readysave>Save</button>',
    onMount(root) {
      root.querySelector('[data-readysave]').addEventListener('click', () => {
        const v = root.querySelector('[data-readyinput]').value;
        if (!/^\d{2}:\d{2}$/.test(v)) return;
        const [h, m] = v.split(':').map(Number);
        const at = new Date(iso + 'T00:00:00');
        at.setHours(h, m, 0, 0);
        update(() => {
          for (const e of ensureDay(iso).entries) {
            if (e.pid === first.id && e.logged && e.doneAt) e.doneAt = at.toISOString();
          }
          setCollagenAt(iso, new Date(at.getTime() - MORNING_GAP_MIN * 60000));
        });
        closeModal();
        rerender();
      });
    },
  });
}

// ---------------------------------------------------------- patch a tick ----
/**
 * After a tick, patch only what a tick can change (Fable B2): the head (count,
 * estimate, ring), Start, the status line, the ticked rows, the recovery line,
 * the two fold summaries and the foot. Each is rendered on its own and morphed
 * into place; rendering the whole page to find them cost 20 ms at 6x CPU.
 * Returns false when any piece cannot be patched; the caller then patches the
 * whole view (or repaints it).
 *
 * The ticked row is patched in the tap; everything else once that frame has
 * been drawn, so the tick itself shows at once (tickPatch).
 */
function patchToday(page, iso, ctx, keys, { rows = true, rest = true, rerender = null } = {}) {
  if (!page || !page.isConnected || (ctx.date || todayIso()) !== iso) return false;
  const day = getDay(iso);
  const entries = day?.entries || [];
  const planned = plannedItems(iso);
  const extras = entries.filter((e) => !e.pid && e.ex !== CUSTOM_EX);
  const pairs = [];
  const one = (html) => parse(html).firstElementChild;

  if (rows) {
    for (const key of keys) {
      const item = ALL_ITEMS.find((p) => p.id === key);
      const live = item
        ? page.querySelector(`.crow[data-pid="${CSS.escape(key)}"]`)
        : page.querySelector(`[data-etoggle="${CSS.escape(key)}"]`)?.closest('.crow');
      const e = item ? null : entries.find((x) => x.id === key);
      if (!live || (!item && !e)) return false;
      pairs.push([live, one(item ? checkRow(item, iso, entries, ctx) : extraRow(e, iso, ctx))]);
    }
  }
  if (!rest) {
    for (const [live, tpl] of pairs) if (!tpl || !morph(live, tpl)) return false;
    return true;
  }

  const head = page.querySelector(':scope > header.today-head');
  const headTpl = [...parse(dayHead(iso, planned, extras, entries, ctx)).children];
  const liveHead = [head, head?.nextElementSibling, head?.nextElementSibling?.nextElementSibling];
  if (headTpl.length !== 3 || liveHead.some((x) => !x)) return false;
  headTpl.forEach((t, i) => pairs.push([liveHead[i], t]));

  const first = anchorFirst(state.data, iso) || planned.find((p) => p.first);
  const rec = page.querySelector(':scope > .recovery-line');
  if (first && planned.some((p) => !p.first)) {
    if (!rec) return false;
    const recTpl = one(recoveryLine(first, iso, planned, entries));
    if (recTpl && rec.tagName !== recTpl.tagName) {
      // Ticking the tendon loading makes the line a button (tap to correct the
      // time). Swap that one line and bind it, rather than redrawing the page,
      // which replaced the ticked row mid-animation (his report, 2026-09-15).
      rec.replaceWith(recTpl);
      if (recTpl.matches('[data-act="readytime"]') && rerender) recTpl.addEventListener('click', () => editReadyTime(iso, rerender));
    } else pairs.push([rec, recTpl]);
  } else if (rec) return false;

  // The fold summaries are plain text; render them without their rows.
  const restLive = page.querySelector('details[data-rest="openRest"] > summary');
  if (restLive) {
    const label = planned.length ? 'Not planned today' : 'All exercises';
    pairs.push([restLive, one(`<details>${restSummary(restItems(iso), entries, label)}</details>`)?.firstElementChild]);
  }
  const goalsLive = page.querySelector('details[data-rest="openGoals"] > summary');
  if (goalsLive) {
    // An open goal group lists rows that a tick may change: patch the view.
    if (goalsLive.parentElement.open) return false;
    pairs.push([goalsLive, one(`<details>${goalsSummary(goalGroups(iso))}</details>`)?.firstElementChild]);
  }
  const footLive = page.querySelector(':scope > .today-foot');
  const footTpl = one(weekFoot(iso) || '<i></i>');
  if (!!footLive !== (footTpl?.tagName === 'BUTTON')) return false;
  if (footLive) pairs.push([footLive, footTpl]);

  // The count, the estimate and the ring's number roll to their new values
  // (2026-09-15, his pick) instead of changing in place.
  const rollSel = ':scope > header.today-head :is(.sum-count, .sum-est, .dr-count b)';
  const before = new Map([...page.querySelectorAll(rollSel)].map((el) => [el, el.textContent]));
  for (const [live, tpl] of pairs) if (!tpl || !morph(live, tpl)) return false;
  for (const el of page.querySelectorAll(rollSel)) {
    if (!before.has(el) || before.get(el) === el.textContent) continue;
    el.classList.remove('roll');
    requestAnimationFrame(() => {
      el.classList.add('roll');
      setTimeout(() => el.classList.remove('roll'), 420);
    });
  }
  return true;
}

/**
 * The status line is announced from one live region that is never repainted
 * (Fable D2), and only when its words change: a region inside the view was
 * replaced on every tick, so VoiceOver read the line again each time.
 */
let lastStatusSaid = null;
function sayStatus(page) {
  const live = document.getElementById('today-live');
  const text = page?.querySelector?.('.daystatus')?.textContent.replace(/\s+/g, ' ').trim() || '';
  if (!live || text === lastStatusSaid) return;
  const first = lastStatusSaid === null;
  lastStatusSaid = text;
  if (!first) live.textContent = text;   // not on opening the app, only on a change
}

function tickPatch(page, iso, ctx, key, rerender, { fly = false } = {}) {
  if (!patchToday(page, iso, ctx, [key], { rest: false })) { rerender({ soft: true }); ensureRecovery(page, ctx, iso, rerender); return; }
  requestAnimationFrame(() => setTimeout(() => {
    if (!page.isConnected || (ctx.date || todayIso()) !== iso) return;
    if (!patchToday(page, iso, ctx, [], { rows: false, rerender })) rerender({ soft: true });
    if (!(fly && flyTick(page, iso, key))) drawRingSegment(page, iso, key);
    sayStatus(page);
    ensureRecovery(page, ctx, iso, rerender);
  }, 0));
}

/**
 * The tick flies home (B5-2, 2026-09-23): a 10 px dot in the row's category
 * colour leaves the tick circle and lands on its own segment of the day ring,
 * which then draws itself in. On the plan's last tick the ring's gold burst
 * waits for the landing instead of going off at the tap.
 *
 * Only a planned row that has its own segment (a dense ring has none, an extra
 * has none), only with the ring on screen, never in light motion or under
 * Reduce Motion; everything else draws the segment as before. The dot is an
 * overlay on the page, so no row moves. Its segment is held undrawn until it
 * lands, and a timer lands it anyway if the frames stop (a hidden tab).
 *
 * Called once the head has been patched, so the segment exists; the rects are
 * read in the next frame, never in the tap. Returns true when it took over the
 * segment's draw.
 */
const FLY_MS = 380;
function flyTick(page, iso, pid) {
  if (liteMotion() || reducedMotion()) return false;
  const seg = page.querySelector(`:scope > header.today-head .dr-seg.on[data-seg-pid="${CSS.escape(pid)}"]`);
  const ring = seg?.closest('.dayring2');
  const svg = seg?.ownerSVGElement;
  const box = page.querySelector(`.tick[data-ptoggle="${CSS.escape(pid)}"]`);
  const item = ALL_ITEMS.find((p) => p.id === pid);
  if (!seg || !ring || !svg || !box || !item || !seg.getTotalLength) return false;
  // Held until the landing: the segment undrawn, a finishing day's burst paused.
  seg.style.strokeDasharray = '0 9999';
  const burst = ring.classList.contains('play');
  if (burst) ring.classList.add('won-wait');
  let landed = false;
  let dot = null;
  const land = () => {
    if (landed) return;
    landed = true;
    dot?.remove();
    seg.style.strokeDasharray = '';
    ring.classList.remove('won-wait');
    if (page.isConnected) drawRingSegment(page, iso, pid);
  };
  requestAnimationFrame(() => {
    if (!page.isConnected || !seg.isConnected) { land(); return; }
    const from = box.getBoundingClientRect();
    const rr = ring.getBoundingClientRect();
    // The whole ring on screen: below the header while the header is on
    // screen, and above the bottom of the screen.
    const top = Math.max(0, document.querySelector('.mtop, .topbar')?.getBoundingClientRect().bottom || 0);
    if (rr.top < top || rr.bottom > window.innerHeight || rr.width < 1) { land(); return; }
    let to;
    try {
      const mid = seg.getPointAtLength(seg.getTotalLength() / 2);
      const pt = svg.createSVGPoint();
      pt.x = mid.x;
      pt.y = mid.y;
      to = pt.matrixTransform(seg.getScreenCTM());
    } catch { land(); return; }
    const x0 = from.left + from.width / 2;
    const y0 = from.top + from.height / 2;
    const colour = CATEGORIES[exerciseById(item.ex)?.cat || 'strength']?.color || 'var(--ink-2)';
    dot = document.createElement('span');
    dot.className = 'tick-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.background = colour;
    document.body.appendChild(dot);
    const anim = dot.animate([
      { transform: `translate(${x0}px, ${y0}px) scale(1)` },
      { transform: `translate(${(x0 + to.x) / 2}px, ${(y0 + to.y) / 2 - 24}px) scale(.8)`, offset: 0.5 },
      { transform: `translate(${to.x}px, ${to.y}px) scale(.6)` },
    ], { duration: FLY_MS, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'forwards' });
    anim.onfinish = land;
    anim.oncancel = land;
  });
  // Frames stop in a hidden tab: land it anyway.
  setTimeout(land, 700);
  return true;
}

/**
 * The day ring's segment for the row he just ticked draws itself in (C1,
 * 2026-09-15). It used to appear at its new value the instant the patch landed,
 * which was the most visible unfinished piece of motion left.
 *
 * Only the ONE segment moves. Redrawing the whole ring would animate work he
 * did hours ago, which would read as a reward for opening the app.
 */
function drawRingSegment(page, iso, pid) {
  if (liteMotion() || reducedMotion()) return;
  // By its own exercise, never by position in a different list (audit F28).
  const seg = page.querySelector(`.dr-seg.on[data-seg-pid="${CSS.escape(pid)}"]`);
  if (!seg || !seg.getTotalLength) return;
  try {
    const len = seg.getTotalLength();
    seg.animate([{ strokeDasharray: `0 ${len}` }, { strokeDasharray: `${len} 0` }],
      { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  } catch { /* an SVG that cannot measure itself simply does not animate */ }
}

// ------------------------------------------------------- open in place ----
const PANEL_OPEN_MS = 280;
const PANEL_CLOSE_MS = 240;
const FOLD_OPEN_MS = 220;
const FOLD_CLOSE_MS = 180;

/** Open a row where it is: render it alone, patch its head, grow its body. */
function openRow(row, key, item, iso, ctx, rerender) {
  const entries = getDay(iso)?.entries || [];
  let html;
  if (item) html = checkRow(item, iso, entries, ctx);
  else {
    const e = entries.find((x) => x.id === key);
    if (!e) return false;
    html = extraRow(e, iso, ctx);
  }
  const body = insertBody(row, html, '.crow-body');
  if (!body) return false;
  bindToday(body, ctx, rerender);
  if (!liteMotion()) {
    row.classList.add('just-open');              // outline and chevron ease in
    setTimeout(() => row.classList.remove('just-open'), PANEL_OPEN_MS + 40);
  }
  growIn(body, PANEL_OPEN_MS);
  return true;
}

/**
 * Fold a row's body away, then take it out in place. No repaint at the end
 * (2026-09-15, "choppier when closing"): the outline eases back to exactly a
 * plain row's spacing, so the last frame and the plain row are identical.
 */
function closeRow(row, key, ctx, clear = true) {
  const body = row.querySelector(':scope > .crow-body');
  row.querySelector(':scope > .crow-head [data-rowclick]')?.setAttribute('aria-expanded', 'false');
  if (clear && ctx.editing === key) ctx.editing = null;
  if (!body) { row.classList.remove('open', 'editing'); return; }
  // The outline eases back with the fold; at 30 frames (light motion) the
  // body only fades, and the row is plain again in one step.
  if (!liteMotion()) row.classList.add('closing');
  foldAway(body, PANEL_CLOSE_MS, () => {
    body.remove();
    row.classList.remove('open', 'editing', 'closing');
  });
}

// ---------------------------------------------------------------- bind ----
// Which items have a video, fetched once so an open row can offer it.
loadVideos();

export function bindToday(root, ctx, rerender) {
  const iso = ctx.date || todayIso();
  // One-shot animation flags: consumed by this render, gone for the next.
  ctx.pop = null;


  if (ctx.flash) {
    const el = root.querySelector('.crow.flash');
    if (el) scrollToEl(el);
    ctx.flash = null;
  }
  if (ctx.scrollToRow) {
    const key = ctx.scrollToRow;
    ctx.scrollToRow = null;
    // After the shell has put the page back where it was.
    requestAnimationFrame(() => scrollToEl(root.querySelector(`[data-pid="${CSS.escape(key)}"]`) || root.querySelector(`[data-rowclick="${CSS.escape(key)}"]`)?.closest('.crow')));
  }
  if (ctx.scrollGoals) {
    ctx.scrollGoals = false;
    scrollToEl(root.querySelector('[data-rest="openGoals"]'));
  }

  // Another date repaints in full: every handler here is bound to the date.
  // The content under the header pushes in from the side he went (B5-5).
  const toDate = (next) => {
    if (!next) return;
    ctx.pushDir = next === iso ? 0 : next > iso ? 1 : -1;
    ctx.date = next;
    ctx.editing = null;
    rerender();
  };
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.nav;
    toDate(v === 'today' ? todayIso() : addDays(iso, Number(v)));
  }));
  root.querySelector('[data-jump]')?.addEventListener('change', (e) => toDate(e.target.value));
  // A sideways swipe on the date header does what the arrows do, clear of the
  // screen's edges (swipe.js).
  onSwipe(root.querySelector(':scope > .today > header.today-head'), { left: () => toDate(addDays(iso, 1)), right: () => toDate(addDays(iso, -1)) });
  root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.goto;
    if (v === 'progress') ctx.gtab = 'overview';
    ctx.go(v);
  }));
  root.querySelector('[data-act="menu"]')?.addEventListener('click', () => openDayMenu(iso, ctx, rerender));
  bindHistory(root);
  // The coach's first word is in her voice (B1-2, 2026-09-23). The finger going
  // down on Start, Resume or Begin builds the audio context and starts decoding
  // the voice, which takes no audio session and plays nothing; the tap itself
  // then resumes the context, inside his gesture, before the player opens.
  // Never at first paint or when idle: that would build a context and decode
  // every clip on each visit to Today.
  // The finger going down also notes where the day ring is (B3-6): the player
  // opens with its dial growing out of it. That one rect is all the tap reads.
  const warm = () => {
    A.prepareAudio();
    if (speakOn()) A.loadVoice();
    const ring = root.querySelector('.today-head .dayring2');
    if (ring) setLaunchFrom({ rect: ring.getBoundingClientRect(), at: performance.now() });
  };
  root.querySelectorAll('[data-act="start"], [data-act="resume"], [data-timer]').forEach((b) => b.addEventListener('pointerdown', warm, { passive: true }));
  // Sound and the screen's wake lock are both asked for inside the tap itself:
  // iOS grants them there and nowhere else, and the workout now starts without
  // a second tap (his report, 23 Sep: the phone locked mid tendon loading).
  // Start and Resume may be a label around a hidden switch (B6-1): its second,
  // forwarded click is not a tap, and a dimmed one does nothing.
  root.querySelector('[data-act="start"]')?.addEventListener('click', (ev) => { if (forwarded(ev) || isOff(ev.currentTarget)) return; A.unlockAudio(); keepAwakeFromTap(); startWorkout(ctx, iso); });
  root.querySelector('[data-act="resume"]')?.addEventListener('click', (ev) => { if (forwarded(ev) || isOff(ev.currentTarget)) return; A.unlockAudio(); keepAwakeFromTap(); resumePlayer(ctx); });
  root.querySelectorAll('[data-timer]').forEach((b) => b.addEventListener('click', () => { A.unlockAudio(); keepAwakeFromTap(); startExercise(ctx, b.dataset.timer, iso); }));

  // The custom workout (2026-09-18). The timer is its own layer over the app;
  // when a run is logged, the new row under the card pops like a tick.
  root.querySelector('[data-cwstart]')?.addEventListener('click', () => openCustomWorkout(logDateFor(iso), {
    onDone: (id) => {
      if ((ctx.date || todayIso()) !== iso) return;
      ctx.pop = id;
      rerender({ soft: true });
    },
  }));
  // Its settings open under the row in place, like any other row.
  root.querySelector('[data-cwopen]')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget;
    const row = btn.closest('.crow');
    if (ctx.openCustom && row?.querySelector(':scope > .crow-body')) {
      ctx.openCustom = false;
      btn.setAttribute('aria-expanded', 'false');
      closeRow(row, 'custom', ctx, false);
      // Once folded, the closed row gets its arrow tile back.
      setTimeout(() => { if (!ctx.openCustom && row.isConnected) rerender({ soft: true }); }, PANEL_CLOSE_MS + 40);
      return;
    }
    ctx.openCustom = true;
    const body = row && insertBody(row, customRow(iso, ctx), '.crow-body');
    if (!body) { rerender(); return; }
    bindToday(body, ctx, rerender);
    if (!liteMotion()) {
      row.classList.add('just-open');
      setTimeout(() => row.classList.remove('just-open'), PANEL_OPEN_MS + 40);
    }
    growIn(body, PANEL_OPEN_MS);
  });
  // His name for it: saved when he leaves the field; empty goes back to
  // "Custom workout". Runs take the name they were started with.
  root.querySelector('[data-cwname]')?.addEventListener('change', (e) => {
    saveConfig({ name: e.target.value });
    rerender({ soft: true });
  });
  // Renaming a run already logged: the field saves as he types, like every
  // other field on a row; leaving it repaints the row's own title.
  root.querySelectorAll('[data-rename]').forEach((inp) => inp.addEventListener('change', () => rerender({ soft: true })));
  root.querySelector('[data-cwbandtoggle]')?.addEventListener('click', () => {
    ctx.cwBandOpen = !ctx.cwBandOpen;
    rerender({ soft: true });
  });
  // A colour picks it and closes the colours; None means no band.
  root.querySelectorAll('[data-cwband]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.cwband;
    saveConfig(v ? { banded: true, band: v } : { banded: false, band: '' });
    ctx.cwBandOpen = false;
    rerender({ soft: true });
  }));
  // The exercise's band: every row today, and its band from now on.
  root.querySelectorAll('[data-itemband]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.dataset.bpkey;
    const val = b.dataset.itemband;
    update((d) => {
      for (const e of ensureDay(iso).entries.filter((x) => x.pid === pid)) {
        if (val) e.band = val; else delete e.band;
        delete e.bands; delete e.bandText; delete e.bandDefault;
      }
      d.program.band[pid] = val;
    });
    rerender({ soft: true });
  }));
  // Take an exercise he added back off today (only rows he added).
  root.querySelectorAll('[data-del-item]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.dataset.delItem;
    update(() => {
      const d = ensureDay(iso);
      // Never remove a row he has logged: clear its added mark instead, so the
      // row stays with its numbers (audit F02, 2026-09-19).
      for (const e of d.entries) if (e.pid === pid && e.added && (e.logged || e.runId)) delete e.added;
      d.entries = d.entries.filter((x) => !(x.pid === pid && x.added));
    });
    if (ctx.editing === pid) ctx.editing = null;
    rerender();
  }));
  // A logged row's band, picked by looking at it. His choice replaces any
  // default or unrecorded band; tapping the chosen one again clears it.
  root.querySelectorAll('[data-bandpick]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.bpkey;
    const val = b.dataset.bandpick;
    update(() => {
      const e = ensureDay(iso).entries.find((x) => x.id === id);
      if (!e) return;
      const next = e.band === val ? '' : val;
      if (next) e.band = next; else delete e.band;
      delete e.bands; delete e.bandText; delete e.bandDefault;
      if (next && e.pid) state.data.program.band[e.pid] = next;
    });
    rerender({ soft: true });
  }));
  root.querySelectorAll('[data-cwmode]').forEach((b) => b.addEventListener('click', () => {
    saveConfig({ mode: b.dataset.cwmode });
    rerender({ soft: true });
  }));
  root.querySelectorAll('[data-cwfirst]').forEach((b) => b.addEventListener('click', () => {
    saveConfig({ first: b.dataset.cwfirst });
    rerender({ soft: true });
  }));
  root.querySelector('[data-cwbetween]')?.addEventListener('click', () => {
    saveConfig({ restBetween: !readConfig(state.data).restBetween });
    rerender({ soft: true });
  });
  // A typed time is kept in range; an empty or unreadable box puts his last
  // number back rather than saving nothing over it.
  root.querySelectorAll('[data-cwf]').forEach((inp) => inp.addEventListener('change', () => {
    const v = Number(inp.value);
    if (inp.value.trim() === '' || !Number.isFinite(v)) { rerender({ soft: true }); return; }
    const lo = Number(inp.min);
    const hi = Number(inp.max);
    saveConfig({ [inp.dataset.cwf]: Math.min(hi, Math.max(lo, Math.round(v))) });
    rerender({ soft: true });
  }));
  root.querySelectorAll('[data-doneat]').forEach((inp) => onTimePicked(inp, (v) => {
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    const item = ALL_ITEMS.find((p) => p.id === inp.dataset.doneat);
    if (!item) return;
    const [h, m] = v.split(':').map(Number);
    const at = new Date(iso + 'T00:00:00');
    at.setHours(h, m, 0, 0);
    update(() => {
      setFirstDoneAt(iso, at, null, item.first ? item : null);
      // Only the tendon loading he did first that day sets the collagen.
      if (item.first && leadsTheDay(state.data, iso, item, at)) setCollagenAt(iso, new Date(at.getTime() - MORNING_GAP_MIN * 60000));
    });
    ctx.editing = null;
    ctx.pop = item.id;
    rerender();
  }));
  root.querySelectorAll('[data-tstage]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const pid = b.dataset.tstage;
    const i = Number(b.dataset.i);
    if ((state.data.program.stage?.[pid] || 0) === i) return;
    update((d) => { (d.program.stage ||= {})[pid] = i; });
    rerender({ soft: true });
  }));
  root.querySelectorAll('[data-sugtry]').forEach((b) => b.addEventListener('click', () => {
    const item = REHAB_PROGRAM.find((p) => p.id === b.dataset.sugtry);
    const sg = item?.suggest;
    if (!sg) return;
    const step = offeredStep(item, sg);
    if (!step) return;
    update((d) => { (d.program.stage ||= {})[item.id] = sg.stage; });
    toast(`<b>${stepHtml(step)}</b><br><span>Change it any time under Where you are, in My Program.</span>`);
    rerender();
  }));
  root.querySelectorAll('[data-sugnot]').forEach((b) => b.addEventListener('click', () => {
    const item = REHAB_PROGRAM.find((p) => p.id === b.dataset.sugnot);
    if (!item?.suggest) return;
    update((d) => { (d.program.seen ||= {})[`suggest:${item.id}:${item.suggest.stage}`] = iso; });
    rerender();
  }));
  root.querySelectorAll('[data-uselearned]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.dataset.uselearned;
    const secs = Number(b.dataset.secs);
    if (!pid || !Number.isFinite(secs)) return;
    update(() => {
      const t = (state.data.program.timer ||= {});
      t[pid] = { ...(t[pid] || {}), restSec: secs };
    });
    toast(`<b>Rest set to ${secs} seconds</b><br><span>Change it any time in My Program.</span>`);
    rerender();
  }));
  root.querySelector('[data-act="readytime"]')?.addEventListener('click', () => editReadyTime(iso, rerender));
  root.querySelector('[data-act="note"]')?.addEventListener('click', () => {
    ctx.openNote = true;
    rerender();
    root.querySelector('[data-daynote]')?.focus();
  });

  root.querySelectorAll('[data-bigpic]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPicture(b.dataset.bigpic);
  }));
  // The knee check-in opens and closes in place (Fable B5).
  root.querySelectorAll('[data-panel="knees"]').forEach((b) => b.addEventListener('click', () => {
    const card = b.closest('.kneerow');
    ctx.openKnees = !ctx.openKnees;
    const html = kneeCard(getDay(iso)?.checkin || {}, ctx);
    if (ctx.openKnees) {
      const body = card && insertBody(card, html, '.fold-body');
      if (!body) { rerender(); return; }
      bindToday(body, ctx, rerender);
      growIn(body, FOLD_OPEN_MS);
      return;
    }
    const body = card?.querySelector(':scope > .fold-body');
    if (!body || !patchHead(card, html, '.fold-body')) { rerender(); return; }
    foldAway(body, FOLD_CLOSE_MS, () => { if (!ctx.openKnees) body.remove(); });
  }));

  root.querySelectorAll('[data-ck]').forEach((inp) => {
    const key = inp.dataset.ck;
    const value = () => (inp.type === 'number' || inp.type === 'range' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value);
    if (inp.type === 'range') {
      // The number beside the slider follows the drag in place; the value is
      // committed when he lets go (F17).
      inp.addEventListener('input', () => {
        const out = inp.closest('div')?.querySelector('[data-ckout]');
        if (out) out.textContent = `${inp.value}/10`;
        inp.setAttribute('aria-valuetext', `${inp.value} out of 10`);
      });
      inp.addEventListener('change', () => { update(() => { ensureDay(iso).checkin[key] = value(); }); rerender(); });
      return;
    }
    if (inp.tagName === 'SELECT') {
      inp.addEventListener('change', () => { update(() => { ensureDay(iso).checkin[key] = value(); }); rerender(); });
      return;
    }
    inp.dataset.focusKey = `ck|${key}`;
    inp.addEventListener('input', () => stageEdit(`ck|${iso}|${key}`, { kind: 'checkin', iso, key, value: value() }));
  });

  root.querySelector('[data-daynote]')?.addEventListener('input', (e) => {
    stageEdit(`note|${iso}`, { kind: 'note', iso, value: e.target.value });
  });

  // Tick a program item on or off. The circle only toggles done; it never
  // expands the row.
  //
  // The circle is an input, or where a finger can feel it a label around a
  // hidden switch (B6-1) whose state is aria-checked. The label's forwarded
  // second click is not a tick; the row's own open tap is a different control.
  const onTick = (cb, on) => {
    const pid = cb.dataset.ptoggle;
    const item = ALL_ITEMS.find((p) => p.id === pid);
    if (!item) return;
    haptic('tick');   // item 7; skipped when the switch under his finger gave the tap
    let inferred = null;
    // What the rows were before this tick, so Undo puts back exactly that: a
    // run logged earlier stays logged, rows the tick made go away, and the
    // collagen and tests it added are taken back (2026-09-22 audit; Undo used
    // to unlog every row of the exercise).
    const before = JSON.parse(JSON.stringify(rowsOf(iso).filter((e) => e.pid === pid)));
    update(() => {
      const d = ensureDay(iso);
      inferred = tickItem(d, item, on, iso);
    });
    if (inferred) weakenDayPath(inferred.iso, `supps.${inferred.id}`);
    if (on) {
      const tests = recordAsTests(iso, rowsOf(iso).filter((e) => e.pid === pid));
      testToast(tests);
      // The way back, on screen at the moment it is useful (item 10). Ticking is
      // the one action with no visible undo: the row just goes quiet. One key for
      // all of them, so ticking five rows leaves one offer, not five.
      actionToast(`Logged ${esc(item.title || 'exercise')}`, 'Undo', () => {
        update((doc) => {
          const d = ensureDay(iso);
          const was = new Map(before.map((e) => [e.id, e]));
          d.entries = d.entries.filter((e) => e.pid !== pid || was.has(e.id)).map((e) => was.get(e.id) || e);
          for (const e of before) if (!d.entries.some((x) => x.id === e.id)) d.entries.push(e);
          if (inferred) {
            const cd = ensureDay(inferred.iso);
            // Only the guess itself: a real tick synced in since then stays.
            if (cd.supps?.[inferred.id] === inferred.at) { const sp = { ...cd.supps }; delete sp[inferred.id]; cd.supps = sp; }
          }
          if (tests.ids?.length) doc.measurements = doc.measurements.filter((m) => !tests.ids.includes(m.id));
        });
        rerender();
      }, { key: 'tick-undo' });
    }
    // A tick never folds a row he has open to correct (ring design decision 2).
    // Patched in place (Fable B2): the row, the count, the ring, Start and the
    // status line change; nothing is rebuilt, so no photo decodes again.
    ctx.pop = on ? pid : null;
    // An untick clears the pop at once, so ticking again straight after replays it.
    if (!on) cb.closest('.crow')?.classList.remove('pop');
    // Only a tick flies home to its segment (B5-2); an untick reverses as before.
    tickPatch(cb.closest('.today'), iso, ctx, pid, rerender, { fly: on });
    ctx.pop = null;
  };
  root.querySelectorAll('[data-ptoggle]').forEach((cb) => {
    if (cb.tagName !== 'LABEL') { cb.addEventListener('change', () => onTick(cb, cb.checked)); return; }
    cb.addEventListener('click', (ev) => {
      if (forwarded(ev) || isOff(cb)) return;
      const on = cb.getAttribute('aria-checked') !== 'true';
      cb.setAttribute('aria-checked', String(on));
      onTick(cb, on);
    });
  });

  // Same for a row he added himself.
  root.querySelectorAll('[data-etoggle]').forEach((cb) => cb.addEventListener('change', () => {
    update(() => {
      const e = rowsOf(iso).find((x) => x.id === cb.dataset.etoggle);
      if (e) setLogged([e], cb.checked);
    });
    if (cb.checked) {
      const e = rowsOf(iso).find((x) => x.id === cb.dataset.etoggle);
      testToast(e ? recordAsTests(iso, [e]) : []);
    }
    ctx.pop = cb.checked ? cb.dataset.etoggle : null;
    if (!cb.checked) cb.closest('.crow')?.classList.remove('pop');
    tickPatch(cb.closest('.today'), iso, ctx, cb.dataset.etoggle, rerender);
    ctx.pop = null;
  }));

  // Tapping the name opens the row for numbers, or closes it again. Closing
  // this way does not mark it done.
  //
  // Both happen in place (Fable B1). Opening renders just this row, patches
  // its head and puts the body in under it, so nothing else on the page is
  // rebuilt and no photo decodes again; another open row folds away at the
  // same time. Closing folds the body away and takes it out.
  root.querySelectorAll('[data-rowclick]').forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.rowclick;
    const item = ALL_ITEMS.find((p) => p.id === key);
    const row = el.closest('.crow');
    const page = el.closest('.today') || document;
    if (ctx.editing === key && row?.querySelector(':scope > .crow-body')) {
      closeRow(row, key, ctx);
      return;
    }
    const rows = rowsOf(iso);
    const has = item ? rows.some((e) => e.pid === key) : rows.some((e) => e.id === key);
    if (item && !has) {
      update(() => { ensureDay(iso).entries.push(...newEntriesFor(item, exerciseById(item.ex), false, iso)); });
    }
    const was = ctx.editing;
    const other = was && was !== key
      ? page.querySelector(`.crow.open > .crow-head [data-rowclick="${CSS.escape(was)}"]`)?.closest('.crow')
      : null;
    ctx.editing = key;
    if (row && openRow(row, key, item, iso, ctx, rerender)) {
      if (other) closeRow(other, was, ctx, false);
      return;
    }
    ctx.justOpened = key;
    rerender();
  }));
  // A full repaint that opened a row (a fallback, or a row opened from
  // elsewhere) grows it the same way.
  if (ctx.justOpened) {
    const key = ctx.justOpened;
    ctx.justOpened = null;
    const body = [...root.querySelectorAll('.crow.open .crow-body')].find((b) => b.id === `row-${key}`);
    if (body) {
      const row = body.closest('.crow');
      if (!liteMotion()) {
        row?.classList.add('just-open');
        setTimeout(() => row?.classList.remove('just-open'), 320);
      }
      growIn(body, PANEL_OPEN_MS);
    }
  }

  // His minutes for a program item. Empty means back to the estimate.
  root.querySelectorAll('[data-mins]').forEach((inp) => inp.addEventListener('change', () => {
    const pid = inp.dataset.mins;
    update((d) => {
      d.program.mins = d.program.mins || {};
      const v = num(inp.value);
      if (v == null || v < 0) delete d.program.mins[pid]; else d.program.mins[pid] = Math.round(v);   // 0 is untimed, his call
    });
    rerender();
  }));

  root.querySelectorAll('[data-rest]').forEach((d) => d.addEventListener('toggle', () => {
    ctx[d.dataset.rest] = d.open;
  }));
  // The two folds under the list open and close like everything else (B5).
  root.querySelectorAll('details[data-rest] > summary').forEach((sum) => sum.addEventListener('click', (ev) => {
    const d = sum.parentElement;
    const body = d.querySelector(':scope > .fold-body');
    if (!body || d.classList.contains('closing')) { if (body) ev.preventDefault(); return; }
    ev.preventDefault();
    if (!d.open) {
      d.open = true;
      growIn(body, FOLD_OPEN_MS);
      return;
    }
    d.classList.add('closing');
    foldAway(body, FOLD_CLOSE_MS, () => {
      d.open = false;
      d.classList.remove('closing');
      body.classList.remove('animating', 'closing', 'shut');
    });
  }));

  root.querySelectorAll('[data-entry] [data-f]').forEach((inp) => {
    const id = inp.closest('[data-entry]').dataset.entry;
    const f = inp.dataset.f;
    if (inp.tagName === 'SELECT') {
      inp.addEventListener('change', () => {
        update(() => {
          const e = ensureDay(iso).entries.find((x) => x.id === id);
          if (!e) return;
          e[f] = inp.value;
          // remember the band for this program item
          if (f === 'band' && e.pid) state.data.program.band[e.pid] = inp.value;
        });
        rerender();
      });
      return;
    }
    // Typing stays in the field; the value is staged on this device at once and
    // committed when he pauses or leaves the field (F18).
    inp.dataset.focusKey = `entry|${id}|${f}`;
    // One line for both legs writes both rows (data-entries).
    const all = (inp.closest('[data-entry]').dataset.entries || id).split(',');
    inp.addEventListener('input', () => {
      const value = inp.type === 'number' ? num(inp.value) : inp.value;
      for (const rid of all) stageEdit(`entry|${iso}|${rid}|${f}`, { kind: 'entry', iso, id: rid, f, value });
    });
  });

  // --- this week's targets ---------------------------------------------
  root.querySelectorAll('[data-goalgroup]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.goalgroup;
    const groups = goalGroups(iso);
    const current = ctx.openGoal === undefined ? (groups.find((g) => !g.met)?.t.id ?? null) : ctx.openGoal;
    ctx.openGoal = current === id ? null : id;
    ctx.openGoals = true;
    rerender();
  }));
  root.querySelectorAll('[data-goalall]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = b.dataset.goalall;
    ctx.goalAll = ctx.goalAll === id ? null : id;
    ctx.openGoals = true;
    rerender();
  }));
  root.querySelectorAll('[data-cattoggle]').forEach((cb) => cb.addEventListener('change', () => {
    const exId = cb.dataset.cattoggle;
    update(() => {
      const d = ensureDay(iso);
      const mine = d.entries.filter((e) => e.ex === exId && !e.pid);
      if (mine.length) { setLogged(mine, cb.checked); return; }
      const row = newCatEntry(exId);
      setLogged([row], cb.checked);
      d.entries.push(row);
    });
    ctx.editing = null;
    ctx.openGoals = true;
    ctx.pop = cb.checked ? exId : null;
    rerender();
  }));
  root.querySelectorAll('[data-catclick]').forEach((el) => el.addEventListener('click', () => {
    const exId = el.dataset.catclick;
    const key = 'cat:' + exId;
    if (!rowsOf(iso).some((e) => e.ex === exId && !e.pid)) {
      update(() => { ensureDay(iso).entries.push(newCatEntry(exId)); });
      ctx.editing = key;
    } else {
      ctx.editing = ctx.editing === key ? null : key;
    }
    ctx.openGoals = true;
    rerender();
  }));

  root.querySelectorAll('[data-astest]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const entry = rowsOf(iso).find((x) => x.id === b.dataset.astest);
    const ex = entry && exerciseById(entry.ex);
    if (!ex?.measure) return;
    const seed = num(entry.secs) ?? num(entry.reps) ?? num(entry.load) ?? null;
    const sp = splitOn(entry, ex) ? 'secs' : (testFields(ex) ? 'test' : null);
    const split = sp && (num(entry[sp + 'L']) != null || num(entry[sp + 'R']) != null);
    openMeasureEntry({
      measureId: ex.measure,
      date: iso,
      prefill: split
        ? { L: num(entry[sp + 'L']), R: num(entry[sp + 'R']) }
        : (entry.side === 'L' || entry.side === 'R' ? { [entry.side]: seed } : { L: seed, R: seed }),
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  }));

  root.querySelectorAll('[data-del-entry]').forEach((b) => b.addEventListener('click', () => {
    update(() => {
      const d = ensureDay(iso);
      d.entries = d.entries.filter((x) => x.id !== b.dataset.delEntry);
    });
    ctx.editing = null;
    rerender();
  }));

  root.querySelector('[data-act="add-ex"]')?.addEventListener('click', () => {
    const month = monthForDate(iso);
    openExercisePicker({
      monthN: month?.exMonth ?? month?.n,
      onPick(ex, side) {
        const day = getDay(iso) || { entries: [] };
        // A program exercise comes in as its program row, whole (Start, the
        // pictures, the instructions), marked as added so it sits in today's list.
        const item = itemForExercise(ex.id);
        if (item) {
          update(() => {
            const d = ensureDay(iso);
            const mine = d.entries.filter((e) => e.pid === item.id);
            // Only rows not already logged are marked added: Remove takes added
            // rows off, and a logged run must never go that way (audit F02).
            if (mine.length) { for (const e of mine) if (!e.logged && !e.runId) e.added = true; return; }
            const rows = newEntriesFor(item, exerciseById(item.ex), false, iso)
              .filter((r) => side === 'B' || r.side === side || r.side === 'B');
            for (const r of rows) r.added = true;
            d.entries.push(...rows);
          });
          ctx.editing = item.id;
          ctx.justOpened = item.id;
          ctx.scrollToRow = item.id;
          rerender();
          return;
        }
        if (alreadyLogged(day, ex.id, side)) {
          // Already there: take him to it instead of stacking another row.
          ctx.flash = (day.entries.find((e) => e.ex === ex.id && (e.side || 'B') === (side || 'B')) || {}).id;
          rerender();
          return;
        }
        const prev = lastEntry(ex.id, side);
        const id = uid();
        // Into the day itself (ensureDay): on a day with no record yet the
        // row went into a detached object and was never saved (2026-09-22).
        update(() => {
          ensureDay(iso).entries.push({
            id, ex: ex.id, side, logged: false,
            sets: prev?.sets ?? null, reps: prev?.reps ?? null,
            load: prev?.load ?? null, loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
            band: ex.usesBand ? (prev?.band || '') : undefined,
          });
        });
        ctx.editing = id;
        rerender();
      },
    });
  });

  const page = root.querySelector?.(':scope > .today');
  if (page) {
    sayStatus(page);
    // The recovery window counts down on this page, or stops (B5-1).
    watchRecovery(page, ctx, iso, rerender);
  }
}
