// The one place data goes in. Everything else in the app reads from here.
//
// Today is a checklist. The date, one line saying what the day is for, then
// the exercises planned for the day with a circle to tick each one, then the
// day's supplements. Everything that used to sit above the list (the six
// month road, the week cadence, the month board, the insight cards) lives on
// Progress > Overview now. He opens this screen to answer one question, what
// do I do today, and the first exercise has to be on the first screen.

import { loadVideos, videoFor, VIDEO_TAG } from '../videos.js';
import { esc, todayIso, addDays, fmtDate, fmtDateShort, uid, num, round, currentDayIso, onTimePicked, postOp } from '../util.js';
import { haptic, speakOn, hapTaps, hapInput, forwarded, isOff } from '../feedback.js';
import * as A from '../player/audio.js';
import { ptMark, bandMark, bandPicker, bandSvg, nameWithMarks } from '../ptmark.js';
import { paintBadge } from '../badge.js';
import { state, update, ensureDay, getDay, lastEntry, lastCardioMinutes, maxLoad, loadSeries, entriesFor, stageEdit, weakenDayPath, historyEntries, surgeryDate } from '../store.js';
import { monthForDate } from '../../data/plan.js';
import { CATEGORIES, MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { REHAB_PROGRAM, GYM_PROGRAM, BAND_BY_ID, THERABAND, plannedOn, dayPlanFor } from '../../data/program.js';
import { CLINIC_HEP } from '../../data/history.js';
import { goalGroups } from './week.js';
import { shortCat } from './monthboard.js';
import { openExercisePicker, allExercises, exerciseById, openMeasureEntry, loadBars, thumb, clinicWorkouts,
         openPicture, renderDatePill, prescriptionLine, toast, openModal, closeModal, goButton, actionToast, rowName,
         pictureFor, iconTile } from '../components.js';
import { frameHtml } from '../frames.js';
import { catGlyph, catWord } from '../glyphs.js';
import * as N from '../native-bridge.js';
import { menu as appMenu } from '../menu.js';
import { openExerciseSheet, revealStep, mountExercisePane, refreshPaneHistory } from './exsheet.js';
// Round 3 (2026-09-30): show day and days to the stage (A1, A8), the clinic card (A9), the
// picture peek (plan 2.11), and the last night's sleep as a fact in the head.
import { showRowHtml, bindShowRow, showOn, addShow, removeShow, openShowSheet, stageLine } from '../show.js';
import { clinicStripHtml, clinicHeadHtml, openClinicSheet } from '../clinic.js';
import { nightNow } from '../rtfx.js';
import { bindPeek } from '../peek.js';
import { lastNight, nightSpan } from '../ring.js';
// The routine hour (collagen to tendon loading) runs from startup: imported here so it does.
import { tendonDue } from '../routines.js';
import { minutesFor, fmtMins, fmtDayTotal, learnedRest} from '../timing.js';
import { withGoals } from '../stopwatch.js';
import { anchorFirst, leadsTheDay, oneTendon, FIRST_ITEMS } from '../firstup.js';
import { planStreak, versionFor } from '../planstreak.js';
import { renderHistory, bindHistory, summaryLine } from './exhistory.js';
import { dayRing, ringLegend, dayRingItems } from '../dayring.js';
import { suppTime, onSuppTime, suppScore, suppBands } from './supplements.js';
import { itemStatus, isDone, sidesFor, setLogged, newEntriesFor as makeEntries, runsFor, inferCollagen, COLLAGEN_GAP_MIN, levelOf } from '../logging.js';
import { stepsFor, stepHtml, stageOf } from '../progressions.js';
import { startExercise, startWorkout, resumePlayer, keepAwakeFromTap, draftInfo, workoutQueue, readyAfter, fmtTime12, logDateFor, setLaunchFrom } from '../player/player.js';
import { growIn, foldAway, insertBody, patchHead, reducedMotion} from '../fold.js';
import { liteMotion } from '../motion.js';
import { parse, morph } from '../morph.js';
import { onSwipe } from '../swipe.js';
import { CUSTOM_EX, readConfig, summaryText, totalSeconds, fmtDur, customChips, saveConfig, openCustomWorkout, runName, parseReps, repsText, repsTotal } from '../customworkout.js';

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
  // iPad (regular width): the selected exercise is drawn in a trailing pane instead of a sheet
  // (bindToday mounts it; rt-today.css shows it only where there is room, a phone never does).
  const hasPane = planned.length > 0 || addedItems(iso).length > 0;

  // 2026-09-14 ring design. Today is the dated queue, not a dashboard: the
  // date and title, the count and the time, one Start, one status line, the
  // tendon loading, one quiet sentence for the recovery break, the rest of the
  // plan in order (rows never move when ticked), the knee check-in, a note and
  // one quiet line about the streak. Supplements live on their own tab only
  // (his call, 2026-09-15): the collagen still sets the loading time, and the
  // loading time still marks the collagen, so the morning pair is unaffected.
  // v3 (2026-09-30), from his motives (research 09): M2 "tell me what to do now" and M6
  // "space is a budget". One hero row, then the list at the top of the screen: the tendon
  // loading first with its routine hour as a live line, then "Rest of workout" as a real
  // section header carrying the six hour window, then the rest of the plan in his order
  // (rows never move when ticked). No "First up" label, no grey caps (DESIGN-LANGUAGE,
  // Never 1): the order says it. Supplements live on their own tab only (his call,
  // 2026-09-15): the collagen still sets the loading time and the loading time still marks
  // the collagen, so the morning pair is unaffected.
  return `
  <div class="stack today td">
    ${dayHead(iso, planned, extras, entries, ctx)}
    ${warn ? `<div class="notice ${warn.level}">${warn.html}</div>` : ''}
    ${day?.seeded ? `<div class="notice info">Seeded from ${esc(day.source || 'your clinical notes')}. Edit anything that is not right.</div>` : ''}
    ${eveningRowHtml(iso)}
    ${headClinic === iso ? '' : clinicStripHtml(iso)}
    <div class="td-cols${hasPane ? ' has-pane' : ''}"><div class="td-lead">
    ${first ? '' : showRowHtml(iso)}

    ${first ? `<section class="td-list td-first" id="first-card" aria-label="${showOn(iso) ? 'The show and tendon loading' : 'Tendon loading'}">
      <div class="checklist">${showRowHtml(iso, { bare: true })}${firsts.map((p) => checkRow(p, iso, entries, ctx)).join('')}</div>
    </section>
    ${others.length ? recoveryLine(first, iso, planned, entries) : ''}` : ''}

    <section class="td-list" id="session-card" aria-label="${first ? 'Rest of workout' : 'Exercises'}">
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
    </div>${hasPane ? '<aside class="td-pane" data-td-pane aria-label="About the exercise"></aside>' : ''}</div>
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
  <div class="crow trow cwrow ${open ? 'open editing' : ''}" data-cwrow>
    <div class="crow-head">
      <span class="crow-shot plain td-shot cw-shot">${thumb(CUSTOM_EX, 30)}</span>
      <button class="crow-main" data-cwopen aria-expanded="${open}" aria-controls="cw-set">
        <span class="crow-text">
          <span class="crow-name">${esc(cfg.name)}${cfg.banded && cfg.band && BAND_BY_ID[cfg.band] ? `<span class="band-mark">${bandSvg(BAND_BY_ID[cfg.band].swatch)}</span>` : ''}</span>
          <span class="crow-sub">${keepFactsText(summaryText(cfg).replace(/\s*·\s*[A-Z][a-z]+ band$/, ''))}</span>
        </span>
        ${cfg.mode === 'reps'
          ? `<span class="crow-mins" title="${esc(`${repsTotal(cfg.reps) * (cfg.legs === 'each' ? 2 : 1)} reps`)}"><b>${repsTotal(cfg.reps) * (cfg.legs === 'each' ? 2 : 1)}</b><small>reps</small></span>`
          : `<span class="crow-mins" title="${esc(`About ${fmtDur(totalSeconds(cfg))} with rest`)}"><b>${mins}</b><small>min</small></span>`}
      </button>
      <span class="td-tickslot" aria-hidden="true">${open ? '' : ICON.down}</span>
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
  const reps = cfg.mode === 'reps';
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
    ${cwTemplates(cfg)}
    <span class="seg cw-seg" role="group" aria-label="Timer type">
      <button data-cwmode="sides" class="${sides ? 'on' : ''}" aria-pressed="${sides}">Right and left</button>
      <button data-cwmode="single" class="${cfg.mode === 'single' ? 'on' : ''}" aria-pressed="${cfg.mode === 'single'}">Work and rest</button>
      <button data-cwmode="reps" class="${reps ? 'on' : ''}" aria-pressed="${reps}">Sets of reps</button>
    </span>
    ${reps ? cwRepsFields(cfg) : `<div class="cw-fields ${sides ? 'n4' : 'n3'}">
      ${sides ? ['L', 'R'].map(sideFld).join('') : fld('work', 'Work, seconds', cfg.work, 1, 3600)}
      ${fld('rest', 'Rest, seconds', cfg.rest, 0, 3600)}
      ${fld('rounds', 'Rounds', cfg.rounds, 1, 50)}
    </div>`}
    ${sides ? `<div class="cw-opts">
      <span class="seg cw-seg" role="group" aria-label="Which side goes first">
        <button data-cwfirst="L" class="${cfg.first === 'L' ? 'on' : ''}" aria-pressed="${cfg.first === 'L'}">Left first</button>
        <button data-cwfirst="R" class="${cfg.first === 'R' ? 'on' : ''}" aria-pressed="${cfg.first === 'R'}">Right first</button>
      </span>
      <span class="seg cw-seg"><button data-cwbetween class="${cfg.restBetween ? 'on' : ''}" aria-pressed="${cfg.restBetween}"
        title="${esc(cfg.first === 'L' ? 'Left, rest, right, rest' : 'Right, rest, left, rest')}">Rest between</button></span>
    </div>` : ''}
    ${reps ? '' : `<p class="cw-total">${esc(`${fmtDur(totalSeconds(cfg))} in all.`)} Each ${sides ? 'side' : 'work segment'} waits for your tap; rest starts by itself.</p>`}
  </div>`;
}

/**
 * BFR templates (his ask, 2026-09-30: "now we would have a time and reps template for BFR
 * workouts"): every BFR exercise from his clinics' lists (clinicWorkouts), as it was set at
 * the latest session. A tap loads it into the custom workout (a reps list into Sets of reps,
 * intervals into Work and rest), named after the exercise; he adjusts anything after, as
 * always. Nothing is stored for the templates: a new session updates them.
 */
function bfrTemplates() {
  const out = [];
  for (const g of clinicWorkouts()) {
    for (const it of g.items) {
      if (!it.bfr) continue;
      const r = it.rows[0] || {};
      const iv = r.intervals;
      const sides = new Set(it.rows.map((x) => x.side || 'B'));
      if (iv && iv.work && iv.rounds) out.push({ key: it.key, name: it.name, cfg: { name: it.name, mode: 'single', work: iv.work, rest: iv.rest || 0, rounds: iv.rounds } });
      else if (Array.isArray(r.repsBySet) && r.repsBySet.length) out.push({ key: it.key, name: it.name, cfg: { name: it.name, mode: 'reps', reps: [...r.repsBySet], legs: sides.has('L') && sides.has('R') ? 'each' : 'both' } });
    }
  }
  return out;
}
function cwTemplates(cfg) {
  const list = bfrTemplates();
  if (!list.length) return '';
  return `<div class="cw-tpls" role="group" aria-label="BFR templates from your clinic">
      <span class="cw-tpls-h">BFR templates</span>
      ${list.map((t) => `<button type="button" class="cw-tpl${cfg.name === t.name ? ' on' : ''}" data-cwtpl="${esc(t.key)}"
        aria-pressed="${cfg.name === t.name}">${esc(t.name.replace(/^BFR\s+/, ''))}<small>${esc(t.cfg.mode === 'reps' ? `${t.cfg.reps.join(', ')} reps` : `${t.cfg.rounds} × ${fmtDur(t.cfg.work)}`)}</small></button>`).join('')}
    </div>`;
}

/**
 * Sets of reps (2026-09-30, his ask after PT: BFR is 75 reps, 30, 15, 15, 15). The reps per
 * set as one list he types, the rest between sets, and both legs together or each in turn.
 */
function cwRepsFields(cfg) {
  const each = cfg.legs === 'each';
  const total = repsTotal(cfg.reps);
  return `<div class="cw-fields n3 cw-repsf">
      <label class="fld cw-fld cw-repslist">Reps per set
        <input type="text" data-cwreps value="${esc(repsText(cfg.reps))}" placeholder="30, 15, 15, 15" autocomplete="off" autocorrect="off" autocapitalize="off" enterkeyhint="done"
          aria-label="Reps per set, separated by commas"></label>
      <label class="fld cw-fld">Rest, seconds
        <input type="number" class="in-num" inputmode="numeric" min="0" max="3600" step="1" data-cwf="rest" value="${cfg.rest}"></label>
    </div>
    <div class="cw-opts">
      <span class="seg cw-seg" role="group" aria-label="Legs">
        <button data-cwlegs="both" class="${each ? '' : 'on'}" aria-pressed="${!each}">Both legs</button>
        <button data-cwlegs="each" class="${each ? 'on' : ''}" aria-pressed="${each}">Each leg</button>
      </span>
      ${each ? `<span class="seg cw-seg" role="group" aria-label="Which leg goes first">
        <button data-cwfirst="L" class="${cfg.first === 'L' ? 'on' : ''}" aria-pressed="${cfg.first === 'L'}">Left first</button>
        <button data-cwfirst="R" class="${cfg.first === 'R' ? 'on' : ''}" aria-pressed="${cfg.first === 'R'}">Right first</button>
      </span>` : ''}
    </div>
    <p class="cw-total">${esc(`${cfg.reps.length} sets, ${total} reps${each ? ' each leg' : ''}.`)} Each set waits for your Set done; the rest starts by itself.</p>`;
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
 * The page head, v3 (2026-09-30). His notes that night: the top third "is taking up quite
 * a bit of space" and the first exercise sat in the bottom 40 percent (research 06 T1:
 * y 512 of 852). Everything above the list is now ONE hero row, grown sideways, never down
 * (his rule R9: a bigger ring "without compromising the vertical space"):
 *   the day ring | the date (tap: jump; swipe the header: a day either way), what is left
 *   in big rounded numerals, the minutes and the day's name | Start, a round play button.
 * His app name and post-op weeks stay on the line beside the bar's glass buttons (ruling K22),
 * the weeks as a blue L and an orange R (his colour contract). The day menu is the small
 * "..." beside the date. The arrows are gone from sight (the swipe and the date do their job)
 * but stay for VoiceOver. A Today control appears only on another day (hidden, never dimmed).
 * Each fact once: the date is the title, the count is said once, no legend (the rows carry
 * each category by glyph and word, so the ring's colours are explained where they are used).
 * Returns two pieces, the head and the status slot; patchToday relies on that.
 */
function dayHead(iso, plannedAll, extras, entries, ctx) {
  headClinic = null;
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
  // Everything he did counts (his call, 18 Sep, after a two hour physio session read as
  // "1/4 planned"): each exercise logged today that is not in the plan joins the ring as a
  // done segment. The same items and rows the player's day thread draws (dayRingItems, B3-3).
  const drawn = dayRingItems(state.data, iso);
  const allDone = planned.length > 0 && doneP.length >= planned.length;
  // A clinic day is its own state (V1, audit T14): the clinic's crown in the ring, "Clinic
  // day" as the headline, and what is left framed as the home part of the day.
  const clinicDay = !!plan.clinic;
  const crown = clinicDay ? clinicCrown() : '';
  const ring = dayRing(drawn.items, drawn.entries,
    { size: 84, stroke: 10, center: crown ? 'custom' : 'none', middle: crown, label: drawn.extras || allDone ? 'done' : 'planned',
      won: true, wonPlay: allDone && iso === todayIso() && firstWon(iso) });
  let count;
  let est;
  const NB = ' ';
  if (!planned.length) { count = `<span class="td-rest">${plan.name ? esc(plan.name) : 'Rest day'}</span>`; est = ''; }
  else if (allDone) {
    // The finished day reads as one (his ask, 18 Sep): gold words, everything counted.
    const n = ring.total;
    const physio = entries.some((e) => e.logged && e.clinic);
    count = '<span class="sum-won">All done</span>';
    est = `${n}${NB}exercise${n === 1 ? '' : 's'}${physio ? ', physio included' : ''}`;
  } else {
    const left = doneP.length ? planned.length - doneP.length : planned.length;
    count = `<b data-roll>${left}</b>${NB}${doneP.length ? 'left' : 'to do'}`;
    // "1h 21m", never "About 1h 21m": the rows already say minutes are estimates.
    est = cap(fmtDayTotal(doneP.length ? leftMins : allMins)).replace(/^About /, '');
    if (clinicDay) {
      // r3fix TS-09: the headline is the way into the clinic sheet (clinic.js clinicHeadHtml),
      // so the slim clinic row is not drawn above the list on this state.
      const word = clinicHeadHtml(iso);
      headClinic = word ? iso : null;
      count = `<span class="td-rest td-clinicday">${word || 'Clinic day'}</span>`;
      est = `${left}${NB}at home · ${est.replace(/\s*\+\s\d+\suntimed$/, '')}`;
    }
  }
  const bits = [est, planned.length && !allDone && !clinicDay && plan.name ? plan.name : ''].filter(Boolean);
  // One line at this width holds about 30 characters; past that the untimed count goes first.
  let estLine = bits.join(' · ');
  if (estLine.length > 30) estLine = bits.map((b, i) => (i === 0 ? b.replace(/\s*\+\s\d+\suntimed$/, '') : b)).join(' · ');
  // An open workout says so here, one line beside Resume, instead of a two line band above
  // the list that pushed the first row to y 288 (audit B9). Where in it he is (set 3 of 4,
  // right) sits on that exercise's own row (openLine).
  const dr = draftInfo();
  if (dr && dr.phase !== 'done') {
    const t12 = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const label = dr.phase !== 'between' && dr.state === 'running' ? 'Running' : 'Paused';
    estLine = [label, dr.pausedAt ? t12(dr.pausedAt) : '', dr.iso && dr.iso !== iso ? fmtDate(dr.iso, 'dow') : ''].filter(Boolean).join(' · ');
  }

  const opL = postOp(surgeryDate('left'), today);
  const opR = postOp(surgeryDate('right'), today);
  const legs = [opL && !opL.future ? `<span class="td-leg L"><b>L</b>${opL.weeks}w</span>` : '',
    opR && !opR.future ? `<span class="td-leg R"><b>R</b>${opR.weeks}w</span>` : ''].join('');
  const appLine = `<div class="rt-appline td-appline"><b>${esc(state.data.settings?.appTitle || 'Rehab')}</b>${legs}</div>`;

  // A finished day with nothing to start (audit T13): the ring's gold starburst reaches past
  // the ring, so the hero gives it a wider column and drops the empty Start slot; the rays
  // stay inside the gutter and clear of "All done", and the count line fits on one line.
  const startHtml = workoutButton(iso);
  const heroWon = allDone && !/startbtn/.test(startHtml);
  // Round 3, his words: "the rings here look a little stale when empty". Before the first
  // tick of today the ring is alive: every planned segment faint in its category colour,
  // breathing slowly in step with Start, which now sits nested at the ring's edge (plan 1D).
  // The first tick fills its segment solid and a spark lands in it (flyTick). Never a dead
  // grey track. Reduce Motion and Low Power: the colours stay, the breathing stops (CSS).
  const fresh = planned.length > 0 && ring.done === 0 && iso === today && !(dr && dr.phase !== 'done');
  const sleep = sleepChip(iso);
  // A8: a finished day points at the stage ("98 days to First run of the show").
  const stage = allDone && iso === today ? stageLine(today) : '';
  return `
  <header class="pagehead today-head td-head">
    ${appLine}
    <div class="td-hero${heroWon ? ' won' : ''}${sleep ? ' has-sleep' : ''}">
      <span class="td-ring${fresh ? ` fresh${liteMotion() || reducedMotion() ? '' : ' breathe'}` : ''}">${ring.html}${heroWon ? '' : startHtml}</span>
      <div class="td-sum">
        <div class="td-dateline">
          <span class="daynav-date td-date"><h1>${esc(longDate(iso, true))}</h1>
            <input type="date" data-jump value="${iso}" aria-label="Jump to a date"></span>
          <button class="td-more" data-act="menu" aria-label="More for this day">${ICON.more}</button>
          ${/* 2026-09-30 sweep: with a mouse or trackpad (the Mac) there was no visible way to change
               day (swipe is touch only). Shown only there; the phone keeps its swipe and the date tap. */ ''}
          <span class="td-daynav" aria-hidden="true"><button type="button" class="td-darr" data-nav="-1" tabindex="-1" title="Previous day"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><button type="button" class="td-darr" data-nav="1" tabindex="-1" title="Next day"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></span>
        </div>
        <div class="td-countline"><span class="td-count${allDone ? ' won' : ''}">${count}</span>${iso === today ? '' : '<button class="td-today" data-nav="today">Today</button>'}</div>
        ${estLine ? `<div class="td-est">${esc(estLine)}</div>` : ''}
        ${stage}
      </div>
      ${sleep}
      <span class="sr-only"><button data-nav="-1">Previous day</button><button data-nav="1">Next day</button></span>
    </div>
  </header>
  ${statusLine(iso, planned, entries, ctx)}`;
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** The day whose head carries the clinic headline button (set by dayHead, read by renderToday
 * and patchToday so the slim clinic row and the headline are never both drawn, or neither). */
let headClinic = null;

/**
 * r3fix TS-08, A7 behaviour 3 (research 11): from midnight to 5 am, while the ending day's
 * Evening band has items left, one slim row at the top of Today: the moon, "Evening, Tue",
 * "2 left", a chevron. A tap opens Supplements (which already shows the ending day) at the
 * Evening band. Nothing red, nothing called missed; no tiles on Today (R3). CSS hides it the
 * moment the root loses rt-night at 5 am, so a page left open never shows it by day.
 */
function eveningRowHtml(iso) {
  if (iso !== todayIso() || !nightNow()) return '';
  const endIso = currentDayIso();
  if (endIso === iso) return '';
  const band = suppBands(endIso).find((b) => b.id === 'evening');
  if (!band || band.taken >= band.total) return '';
  const left = band.total - band.taken;
  const dow = fmtDate(endIso, 'dow');
  return `<button type="button" class="td-evening" data-evening aria-label="Evening supplements, ${esc(dow)}: ${left} left. Open Supplements">
    <svg class="tde-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.6 14.6A7.2 7.2 0 0 1 9.4 5.4a7.2 7.2 0 1 0 9.2 9.2z"/></svg>
    <span class="tdc-t">Evening, ${esc(dow)}</span>
    <span class="tdc-ask">${left} left</span>
    <svg class="tdc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}

/** Supplements, opened at one band (the Morning band from the tendon row's collagen line,
 * the Evening band from the night row). The band is opened, then scrolled under the bar. */
function goSuppBand(ctx, band) {
  N.haptic('light');
  ctx.suppDate = null;
  ctx.suppOpen = { ...(ctx.suppOpen || {}), [band]: true };
  ctx.go('supplements');
  const t0 = Date.now();
  const seek = () => {
    const el = document.querySelector(`#view [data-band="${band}"]`);
    if (!el) { if (Date.now() - t0 < 1500) setTimeout(seek, 60); return; }
    requestAnimationFrame(() => scrollToEl(el));
  };
  setTimeout(seek, 60);
}

/**
 * Round 3, his words: "I definitely will be looking at the sleep data a lot, so maybe have
 * that a little less hidden". The last night the ring recorded, as ONE fact in the head: the
 * time asleep and which night it was. A record, never advice: no score, no colour for good
 * or bad, no sentence. Indigo is the ring's sleep colour (never a leg: it wears a moon, not
 * an L). A tap opens the Sleep view. Only on today; a night that is not last night says its
 * own name ("Mon night"), so a stale sync never passes for last night.
 */
function sleepChip(iso) {
  if (iso !== todayIso()) return '';
  const n = lastNight();
  if (!n || !Number.isFinite(n.sleepH) || n.sleepH <= 0) return '';
  const wake = String(n.bedEnd || n.day || '').slice(0, 10);
  const span = nightSpan(n, true);
  const which = wake === todayIso() ? 'Last night' : (span.split(' into ')[0] || span);
  const t = Math.round(n.sleepH * 60);
  const h = Math.floor(t / 60);
  const m = t % 60;
  const est = n.est ? ', an estimate' : '';
  return `<button class="td-sleep" data-sleep aria-label="${esc(`${which}: ${h} hours ${m} minutes asleep${est}. Open Sleep`)}">
    <svg class="tds-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.6 14.6A7.2 7.2 0 0 1 9.4 5.4a7.2 7.2 0 1 0 9.2 9.2z"/></svg>
    <b class="tds-t">${h}<small>h</small>${String(m).padStart(2, '0')}<small>m</small>${n.est ? '<i class="tds-est" aria-hidden="true"></i>' : ''}</b>
    <span class="tds-l">${esc(which)}</span>
  </button>`;
}

/** The clinic's own crown (its logo from his case file), for the ring on a clinic day. */
function clinicCrown() {
  const clinics = state.data?.caseFile?.clinics || {};
  const c = Object.values(clinics).find((x) => x?.logo && /^\s*<svg[\s>]/.test(x.logo));
  if (!c) return '';
  return `<img class="td-crown" src="data:image/svg+xml,${encodeURIComponent(c.logo)}" alt="">`;
}

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
 * The one session-status slot, under the hero. It speaks only when there is something the
 * list cannot say: an open workout (its full title, side, set and when it stopped), a future
 * day whose Start logs on today, or the once-only notice after the player left with nothing
 * logged. v3: "Tendon loading first" and "Plan complete" are gone (the tendon loading row IS
 * first, and the ring and "All done" already say the plan is complete: each fact once).
 * The slot stays in the page empty, so a tick can patch the head in place.
 */
function statusLine(iso, planned, entries, ctx = {}) {
  const d = draftInfo();
  // Said once, for the visit after the player left with nothing logged (A1).
  if (ctx.todayNotice && ctx.todayNotice.iso === iso && !(d && d.phase !== 'done')) {
    return `<div class="daystatus notice">${esc(ctx.todayNotice.text)}</div>`;
  }
  const t12 = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  // An open workout is said in the head's est line and on its own row (audit B9); the
  // VoiceOver line still names it. Between two exercises it is a pause to him (never
  // "Up next", his call 2026-09-15: he does not work in order).
  if (d && d.phase !== 'done') {
    const label = d.phase !== 'between' && d.state === 'running' ? 'Running' : 'Paused';
    const when = d.pausedAt ? `since ${t12(d.pausedAt)}` : '';
    return `<div class="daystatus srline">${esc([label, d.title, d.where, when].filter(Boolean).join(', '))}</div>`;
  }
  if (planned.length && iso > todayIso()) {
    // Starting a future day's plan logs on today (his call, 2026-09-18).
    return `<div class="daystatus">Start logs on today, ${esc(fmtDate(todayIso(), 'dow'))}</div>`;
  }
  return EMPTY_STATUS;
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

const ICON = {
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>',
  updown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>',
  chev: '<svg class="disc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  zoom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/></svg>',
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  tick: '<svg class="td-menu-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.8"/></svg>',
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
 * Start or Resume, v3: one round play button in the hero, the page's one primary action
 * (Apple's Workout: a play button on the card). Its label says which for VoiceOver; the
 * status slot under the hero names the open workout. Hidden, never dimmed, when there is
 * nothing left and no workout open (his rule: hidden rather than disabled dead controls);
 * the finished ring takes its place. Keeps the class startbtn: the native Log menu presses it.
 */
function workoutButton(iso) {
  const d = draftInfo();
  // What the head counts, not the raw queue (audit T12): the tendon loading is one slot, so
  // once either is done the other is not "left", and only program exercises count. An
  // "All done" day shows no Start (hidden, never a dead or misleading control).
  const logIso = logDateFor(iso);
  const slotDone = !!anchorFirst(state.data, logIso);
  const programIds = new Set(ALL_ITEMS.map((p) => p.id));
  const left = workoutQueue(state.data, iso, logIso)
    .filter((id) => programIds.has(id) && !(slotDone && FIRST_ITEMS.some((p) => p.id === id))).length;
  const resume = !!d && d.phase !== 'done';
  if (!resume && !left) return '<span class="td-start-slot" aria-hidden="true"></span>';
  // A day that has not come yet can be started as a shortcut to its plan (his
  // call, 2026-09-18); what it logs goes on today (logDateFor).
  const future = iso > todayIso();
  const other = resume && d.iso && d.iso !== iso ? ` from ${fmtDate(d.iso, 'dow')}` : '';
  // C2 (2026-09-15): while today has nothing logged at all, Start breathes very
  // slightly, so the one thing worth tapping is the one thing moving. B5-1: it
  // breathes again once the recovery window has opened, while nothing after the
  // first job is logged. Never on another day.
  const plan = plannedItems(iso).filter((p) => !p.notYet);
  const isToday = iso === todayIso();
  const ready = isToday ? readyAfter(state.data, iso) : null;
  const opened = !!ready && ready.getTime() <= Date.now();
  const firstIds = new Set(FIRST_ITEMS.map((p) => p.id));
  const afterFirst = rowsOf(iso).some((e) => e.logged && !firstIds.has(e.pid));
  const breathe = isToday && !resume && plan.length > 0 && left > 0
    && (left === plan.length || (opened && !afterFirst));
  const label = resume ? `Resume ${d.title || 'workout'}${other}` : future ? `Start ${fmtDate(iso, 'dow')}'s workout, logged today` : 'Start the workout';
  const glyph = resume
    // Resume is Apple's play triangle inside a thin progress ring (the Podcasts and Music
    // "continue" look), never the skip forward bar (audit B13).
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 7.6v8.8l7-4.4z"/><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="40 18" stroke-linecap="round" transform="rotate(-90 12 12)"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.2v13.6l11-6.8z"/></svg>';
  const attrs = `data-act="${resume ? 'resume' : 'start'}" aria-label="${esc(label)}"`;
  const cls = `startbtn td-start${resume ? ' resume' : ''}${breathe && !future ? ' breathing' : ''}`;
  // The one Start a finger can feel (B6-1): a label around a hidden switch where
  // there is one to feel, a button everywhere else.
  return hapTaps()
    ? `<label class="${cls}" role="button" tabindex="0" ${attrs}>${hapInput()}${glyph}</label>`
    : `<button class="${cls}" ${attrs}>${glyph}</button>`;
}

/**
 * The rest of the workout, v3: a section header (Title 3, sentence case, never grey caps)
 * that carries the six hour window after the tendon loading as a live line (research 08
 * lesson 8, the Flighty line: a track with a marker moving toward "ready"). Facts only:
 *   before the tendon loading   "Rest of workout" + "6 h after tendon loading"
 *   counting down (today)       "Rest of workout" + "in 3 h 42 min" (tap: correct the time)
 *   open                        "Rest of workout" + "Ready"
 *   another day, time known     "Rest of workout" + "after 2:10 pm"
 *   nothing left                "Rest of workout" + "Done" in green
 * Information only: nothing is blocked; never gold (nothing is finished) and the fill is
 * neutral (Start is the action). The countdown's words and fill are patched every 30 s by
 * watchRecovery; the class names and data hooks below are what it reads.
 */
function recoveryLine(first, iso, planned, entries) {
  const ready = readyAfter(state.data, iso);
  const left = planned.some((p) => !p.first && !p.notYet && itemStatus(p, entries, iso).state !== 'done');
  const head = '<span class="rl-h">Rest of workout</span>';
  if (!left) {
    return `<div class="recovery-line td-sec done">${head}<span class="rl-state">${ICON.check}Done</span></div>`;
  }
  if (ready) {
    const w = iso === todayIso() ? recoveryWindow(iso, ready) : null;
    if (w) {
      const open = w.left <= 0;
      return `<button class="recovery-line td-sec readysep counting${open ? ' open' : ''}" data-act="readytime" aria-label="Rest of workout${open ? ', ready' : `, in ${esc(fmtLeft(w.left))}, after ${esc(fmtTime12(ready))}`}. Change when the tendon loading was done">
      ${head}<span class="rl-state">${open ? 'Ready' : `in <b data-recov-left>${esc(fmtLeft(w.left))}</b><span class="rl-at"> · ${esc(fmtTime12(ready))}</span>`}</span>
      <span class="rl-fill" aria-hidden="true"><i style="transform:scaleX(${w.frac.toFixed(4)})"></i></span></button>`;
    }
    return `<button class="recovery-line td-sec readysep" data-act="readytime" aria-label="Rest of workout after ${esc(fmtTime12(ready))}. Change when the tendon loading was done">
      ${head}<span class="rl-state">after ${esc(fmtTime12(ready))}</span></button>`;
  }
  return `<div class="recovery-line td-sec">${head}<span class="rl-state">${esc(first.gap || '6 hours').replace(/ hours?$/, ' h')} after tendon loading</span></div>`;
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
  const line = recov.page.querySelector('.recovery-line.counting');
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

/** The row's picture, v3: ONE frame of the exercise, big (M1: he recognises it by sight). */
function rowPicture(item, ex, size = 64) {
  const src = item?.img || pictureFor(item?.ex || ex?.id)?.img || null;
  if (src) return frameHtml(src, { size, radius: 16, alt: '' });
  return `<span class="td-icon">${iconTile(item?.ex || ex?.id, size)}</span>`;
}

/** The category by its glyph and its word, in its colour (never colour alone). */
function catTag(ex) {
  const cat = CATEGORIES[ex?.cat];
  return cat ? `<span class="td-cat" style="--cat:${cat.color}">${catGlyph(ex.cat, 14)}${esc(catWord(ex.cat))}</span>` : '';
}

/**
 * The routine hour on the tendon loading row (his rule: an hour after the collagen). A live
 * countdown line, never an explanation sentence: "In 42 min · 9:40 AM" with a thin track that
 * fills over the hour, then "Now · since 9:40 AM" in turquoise (the one thing to do now).
 * Before the collagen is ticked, the fact alone: "1 h after collagen". Only on the first
 * tendon loading row of today, and only while no tendon loading is done.
 */
function routineLine(item, iso, ctx) {
  if (!item.first || iso !== todayIso() || anchorFirst(state.data, iso)) return '';
  const firsts = plannedItems(iso).filter((p) => p.first);
  if (firsts[0]?.id !== item.id) return '';
  const due = tendonDue(state.data, iso);
  const gap = COLLAGEN_GAP_MIN >= 60 && COLLAGEN_GAP_MIN % 60 === 0 ? `${COLLAGEN_GAP_MIN / 60} h` : `${COLLAGEN_GAP_MIN} min`;
  // r3fix TS-07 (A2 behaviour 3): the line is the way to the collagen, a tap opens Supplements
  // at the Morning band. It lives inside the row's button, so the view's capture handler takes
  // the tap before the row opens (bindToday).
  if (!due) return `<span class="td-routine quiet tap" data-tosupps="morning" role="link" aria-label="${gap} after collagen. Open Supplements, Morning">${ICON.clock}<span>${gap} after collagen</span></span>`;
  const to = due.dueAt.getTime();
  const from = due.collagenAt.getTime();
  const now = Date.now();
  if (to <= now) {
    return `<span class="td-routine now">${ICON.clock}<span><b>Now</b> · since ${esc(fmtTime12(due.dueAt))}</span></span>`;
  }
  const frac = Math.min(1, Math.max(0, (now - from) / (to - from)));
  return `<span class="td-routine live" data-routine-to="${to}" data-routine-from="${from}">${ICON.clock}<span>In <b data-routine-left>${esc(fmtLeft(to - now))}</b> · ${esc(fmtTime12(due.dueAt))}</span>
    <span class="td-rbar" aria-hidden="true"><i style="transform:scaleX(${frac.toFixed(4)})"></i></span></span>`;
}

/** Where the open workout is, on its exercise's row: "Paused · set 3 of 4, right" (audit B9). */
function openLine(item, iso) {
  const d = draftInfo();
  if (!d || d.phase === 'done' || d.pid !== item.id || (d.iso && d.iso !== iso)) return '';
  const label = d.phase !== 'between' && d.state === 'running' ? 'Running' : 'Paused';
  const glyph = label === 'Paused' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11M15 6.5v11"/></svg>' : ICON.clock;
  return `<span class="td-routine open">${glyph}<span><b>${label}</b>${d.where ? ` · ${esc(d.where)}` : ''}</span></span>`;
}

/**
 * The full title with the TheraBand loop trailing its LAST word, never alone on a line
 * (ruling K1: the loop never forces a new line).
 */
function nameWithMark(name, mark) {
  if (!mark) return esc(name);
  const at = name.lastIndexOf(' ');
  return at < 0 ? `<span class="td-nw">${esc(name)}${mark}</span>`
    : `${esc(name.slice(0, at))} <span class="td-nw">${esc(name.slice(at + 1))}${mark}</span>`;
}

/**
 * A prescription or a summary with every fact kept whole (audit T11, C4: a number never
 * sits on a line apart from its unit, "each side" never splits): each fact is one
 * unbreakable piece, and a line may only break after a separator dot.
 */
function keepFacts(html) {
  return String(html || '')
    .replace(/<span>([^<]*)<\/span>/g, '<span class="td-nw">$1</span>')
    .replace(/(<span class="dot">·<\/span>)/g, '$1<wbr>');
}
function keepFactsText(text) {
  return String(text || '').split(/\s*·\s*/).filter(Boolean)
    .map((t) => `<span class="td-nw">${esc(t)}</span>`).join(' · ');
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
  const anchorF = item.first && status.state !== 'done' && !mine.some((e) => e.logged) ? anchorFirst(state.data, iso) : null;
  const tickNote = anchorF && anchorF.id !== item.id ? `. Tendon loading done with ${anchorF.title || ''}` : '';
  // v3 row (research 07 4.3, K1, K2; his notes 2026-09-30): the single frame big and
  // leading, one tap to the exercise sheet; the full clinician title (never shortened), the
  // TheraBand loop after it; the category by glyph and word and the prescription quiet
  // under it; the minutes big and rounded; Apple's circle at the trailing edge, where the
  // thumb is, with his green wash across the whole row when done. The name opens the row
  // for numbers, the circle only ticks, the picture only teaches: never two at once.
  const tick = hapTaps()
    ? `<label class="tick" role="checkbox" tabindex="0" aria-checked="${done}" data-ptoggle="${esc(item.id)}" aria-label="Done: ${esc(name)}${partial ? ', partly done' : ''}${tickNote}">${hapInput()}</label>`
    : `<input type="checkbox" class="tick" data-ptoggle="${esc(item.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(name)}${partial ? ', partly done' : ''}${tickNote}">`;
  const sub = confirmed.length
    ? entryChips(confirmed) + statusNote(status)
    : `<span class="td-rx">${keepFacts(prescriptionLine(withGoals(state.data, item, iso), null))}</span>`;
  // The other tendon loading on a day one was done: the slot is covered (oneTendon), so
  // the row reads as done in green outline instead of an open circle (audit T12). The
  // circle still logs this one too, if he did both.
  const slotDone = !!tickNote;
  return `
  <div class="crow trow ${done ? 'done' : ''} ${slotDone ? 'slotdone' : ''} ${partial ? 'partial' : ''} ${started && !done && !partial ? 'started' : ''} ${open ? 'open editing' : ''} ${ctx.pop === item.id ? 'pop' : ''} ${paneSel === item.id ? 'sel' : ''}" data-pid="${esc(item.id)}"${catStyle(ex)}>
    <div class="crow-head">
      <button class="crow-shot td-shot" data-exsheet="${esc(item.id)}" aria-label="About ${esc(name)}: pictures and steps">${rowPicture(item, ex)}</button>
      <button class="crow-main" data-rowclick="${esc(item.id)}" aria-expanded="${open}" aria-controls="${bodyId}">
        <span class="crow-text">
          <span class="crow-name">${nameWithMark(name, bandMark(confirmed.find((e) => e.band || e.bands), { planned: band, usesBand: !!(ex?.usesBand || band) }))}</span>
          <span class="crow-sub">${catTag(ex)}${sub}</span>
          ${item.notYet && !confirmed.length ? '<span class="crow-note warn">Not yet</span>' : ''}
          ${!done && !confirmed.length ? routineLine(item, iso, ctx) : ''}
          ${openLine(item, iso)}
        </span>
        <span class="crow-mins ${m.src}" title="${esc(minsTitle(m))}">${m.mins == null ? '' : `<b>${m.mins}</b><small>min</small>`}</span>
      </button>
      ${tick}
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
  return `<div class="rest-learned prog-suggest" data-step-key="${esc(`${item.id}:${sg.stage}`)}">
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
  // v3: the pictures, the category and the instructions moved to the exercise sheet (one
  // tap on the row's picture); the open row is the editor: Begin, this session, the step
  // he is at, the offers, and the details.
  const sum = summaryLine(state.data, item, iso);
  return `
    ${goButton({ attrs: `data-timer="${esc(item.id)}" ${item.notYet ? 'disabled' : ''}`, label: 'Begin', cls: 'row-begin' })}
    <div class="row-summary"><small>${esc(sum.label)}</small><b>${sum.html}</b></div>
    ${progressSuggestion(item, iso)}
    ${whereYouAre(item)}
    ${restSuggestion(item, ex)}
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
    <h2 class="td-sec-h">At physical therapy</h2>
    <div class="td-list"><div class="checklist">${rows.map((e) => {
      const ex = exerciseById(e.ex);
      const cat = CATEGORIES[ex?.cat];
      return `<div class="crow trow done history"${catStyle(ex)}>
        <div class="crow-head">
          <span class="crow-shot plain td-shot">${rowPicture(null, ex)}</span>
          <div class="crow-main static">
            <span class="crow-text">
              <span class="crow-name">${nameWithMarks(rowName(e, ex?.name || e.ex), ptMark(e) + bandMark(e, { usesBand: !!ex?.usesBand }))}</span>
              <span class="crow-sub">${catTag(ex)}${entryChips([e])}</span>
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
  <div class="crow trow ${done ? 'done' : 'started'} ${e.ex === CUSTOM_EX ? 'cw-run' : ''} ${open ? 'open editing' : ''} ${e.id === ctx.flash ? 'flash' : ''} ${ctx.pop === e.id ? 'pop' : ''}"${catStyle(ex)}>
    <div class="crow-head">
      <span class="crow-shot plain td-shot${e.ex === CUSTOM_EX ? ' cw-shot' : ''}">${e.ex === CUSTOM_EX ? thumb(CUSTOM_EX, 30) : rowPicture(null, ex)}</span>
      <button class="crow-main" data-rowclick="${esc(e.id)}" aria-expanded="${open}" aria-controls="${bodyId}">
        <span class="crow-text">
          <span class="crow-name">${nameWithMarks(name, ptMark(e) + bandMark(e, { usesBand: !!ex?.usesBand }))}</span>
          <span class="crow-sub">${catTag(ex)}${entryChips([e])}</span>
        </span>
        ${mins != null ? `<span class="crow-mins logged" title="What you logged"><b>${mins}</b><small>min</small></span>` : '<span class="crow-mins"></span>'}
      </button>
      <input type="checkbox" class="tick" data-etoggle="${esc(e.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(name)}">
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
  return `<summary>This week's targets · ${groups.filter((g) => g.met).length} of ${groups.length} met</summary>`;
}

function goalsGroup(iso, entries, ctx) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  const month = monthForDate(iso);
  const openKey = ctx.openGoal === undefined ? (groups.find((g) => !g.met)?.t.id ?? null) : ctx.openGoal;
  // v3 (audit T3, T4): ONE fold, never folds inside a fold (07 4.4). The week's targets are a
  // row of filled pills (the glyph, the word, hit of goal, a bar in the category colour), the
  // picked one turquoise; its exercises list under them as v3 rows: the single frame, the
  // full name, the circle trailing, the 16 pt gutter. This replaces the four tiles that
  // repeated the same targets at the foot of the page (each fact once).
  const pill = (g) => {
    const on = openKey === g.t.id;
    const p = g.goal ? Math.min(100, Math.round((g.hit / g.goal) * 100)) : 0;
    const cat = g.t.cats?.[0];
    return `<button type="button" class="td-gpill${on ? ' on' : ''}${g.met ? ' met' : ''}" data-goalgroup="${esc(g.t.id)}" aria-pressed="${on}"
      aria-label="${esc(`${g.label}: ${g.hit} of ${g.goal}${g.met ? ', met' : ''}`)}" style="--c:${esc(g.colour)}">
      <span class="gp-k">${cat ? catGlyph(cat, 14) : ''}<span>${esc(shortCat(g.t.label))}</span></span>
      <span class="gp-v"><b>${g.hit}</b>/${g.goal}</span>
      <span class="gp-bar" aria-hidden="true"><i style="width:${p}%"></i></span>
    </button>`;
  };
  const g = groups.find((x) => x.t.id === openKey) || null;
  let list = '';
  if (g) {
    const all = allExercises().filter((x) => (g.t.tagged ? x.tag === g.t.tagged : g.t.cats.includes(x.cat)));
    const showAll = ctx.goalAll === g.t.id;
    const mN = month.exMonth ?? month.n;
    const shown = showAll || !mN ? all : all.filter((x) => !x.months || x.months.includes(mN));
    list = `<div class="checklist td-goallist">
      ${shown.map((ex) => {
        const mine = entries.filter((e) => e.ex === ex.id && !e.pid);
        const started = mine.length > 0;
        const done = started && mine.every((e) => e.logged);
        const editing = started && ctx.editing === 'cat:' + ex.id;
        return `<div class="crow trow ${done ? 'done' : started ? 'started' : ''} ${editing ? 'open editing' : ''} ${ctx.pop === ex.id ? 'pop' : ''}"${catStyle(ex)}>
          <div class="crow-head">
            <span class="crow-shot td-shot">${rowPicture(null, ex)}</span>
            <button class="crow-main" data-catclick="${esc(ex.id)}" aria-expanded="${editing}">
              <span class="crow-text">
                <span class="crow-name">${esc(ex.name)}</span>
                ${started ? `<span class="crow-sub">${entryChips(mine)}</span>` : ''}
              </span>
            </button>
            <input type="checkbox" class="tick" data-cattoggle="${esc(ex.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(ex.name)}">
          </div>
          ${editing ? `<div class="crow-body"><div class="crow-body-clip"><div class="crow-body-in">${mine.map((e) => entryFields(e, ex)).join('')}</div></div></div>` : ''}
        </div>`;
      }).join('')}
      ${all.length > shown.length || showAll
        ? `<button class="list-add td-goalall" data-goalall="${esc(g.t.id)}">${showAll ? 'Just this month' : `Show all ${all.length}`}</button>` : ''}
    </div>`;
  }
  return `
  <details class="fold td-goals" data-rest="openGoals" ${ctx.openGoals ? 'open' : ''}>
    ${goalsSummary(groups)}
    <div class="fold-body"><div class="fold-clip"><div class="goalbox td-goalbox">
      <div class="td-gpills" role="group" aria-label="This week's targets">${groups.map(pill).join('')}</div>
      ${list}
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
  // v3 (audit T24, B18): a grouped list of rows, each a label and its value, a tap opens the
  // app's one menu (07 4.4: selects and sliders become menus). "Not set" reads apart from
  // zero; no range slider whose knob sits at 0 for a value never recorded; no mono digits.
  return `
  <section class="card panel kneerow ${ctx.openKnees ? 'open' : ''}">
    <button class="panel-head" data-panel="knees" aria-expanded="${!!ctx.openKnees}">
      <span class="panel-title"><h2>Knee check-in</h2>
        <span class="sub">${kneeSummary(c)}</span></span>
      <span class="chev">⌄</span>
    </button>
    ${ctx.openKnees ? `<div class="fold-body"><div class="fold-clip"><div class="card-body td-knee">
      <div class="td-kgroup">
        ${legBlock('L', 'Left', c)}
        ${legBlock('R', 'Right', c)}
      </div>
      <div class="td-kgroup">
        ${kneeRow('nextDay', "Yesterday's session", c.nextDay, '')}
        ${kneeRow('rpe', 'Effort', c.rpe, '')}
      </div>
      <label class="td-knotes"><span>Notes</span>
        <textarea data-ck="notes" rows="2">${esc(c.notes || '')}</textarea>
      </label>
    </div></div></div>` : ''}
  </section>`;
}

const KNEE_OPTS = {
  pain: Array.from({ length: 11 }, (_, i) => i),
  effusion: EFFUSION.filter(Boolean),
  nextDay: ['Better', 'Same', 'Worse'],
  rpe: Array.from({ length: 10 }, (_, i) => i + 1),
};
const kneeKind = (key) => (/^pain/.test(key) ? 'pain' : /^effusion/.test(key) ? 'effusion' : key);
function kneeValue(key, v) {
  if (v === '' || v == null) return '';
  return kneeKind(key) === 'pain' || key === 'rpe' ? `${v} of 10` : String(v);
}
function kneeRow(key, label, v, side) {
  const val = kneeValue(key, v);
  return `<button type="button" class="td-krow" data-ckmenu="${esc(key)}" aria-label="${esc(`${side ? `${side} knee ` : ''}${label}: ${val || 'not set'}`)}">
    <span class="td-kl">${side ? `<span class="sidetag ${side === 'Left' ? 'L' : 'R'}">${side === 'Left' ? 'L' : 'R'}</span>` : ''}${esc(label)}</span>
    <span class="td-kv${val ? '' : ' unset'}">${esc(val || 'Not set')}${ICON.updown}</span>
  </button>`;
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
  return `${kneeRow(painKey, 'Pain', c[painKey], label)}${kneeRow(effKey, 'Swelling', c[effKey], label)}`;
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

/** The bottom of the day: the plan streak, when there is one. */
function weekFoot(iso) {
  // v3 (audit T3): the four target tiles are gone; the targets live once, in the fold above.
  // What is left here is the plan streak, one line, when there is one.
  const streak = iso === todayIso() ? planStreak(state.data, iso) : 0;
  if (streak < 1) return '';
  return `<button class="today-foot td-streak" data-goto="progress" aria-label="Plan streak, ${streak} ${streak === 1 ? 'day' : 'days'}. Opens Progress">
    <span class="wf-head">Plan streak</span>
    <span class="wf-streak"><b>${streak}</b> ${streak === 1 ? 'day' : 'days'}<span class="wf-go" aria-hidden="true">›</span></span>
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
 * The day menu, v3 (his words 2026-09-30: option sheets like this "feel very wordy,
 * redundant, and hard to navigate"; ruling 07 section 4.4). A native menu springing from
 * the "..." (native-bridge actions), short labels, no sub lines, three groups:
 *   fill the day:  Same as Sep 28 · Tick all planned · Sep 28, unticked · the clinic program
 *   the day:       Record a test · Clinic day (a checkmark when it is one)
 *   last, in red:  Clear today
 * No confirm anywhere: every bulk action says what it did in a toast with Undo (Apple:
 * no alert for an undoable action; his M13 "there's no command Z"). Without the app, or
 * with an older build that does not know the call, the same items in a compact sheet.
 */
export function dayMenuItems(iso) {
  const last = lastSessionFor(iso);
  // The same count the header shows (2026-09-22): the tendon loading is one slot, and
  // what is not yet due is not ticked. Nothing planned means nothing to tick, so no item.
  const planned = oneTendon(state.data, iso, plannedItems(iso)).filter((p) => !p.notYet);
  const prev = prevSessionIso(iso);
  const clinic = dayPlanFor(state.data, iso).clinic;
  const bulk = (getDay(iso)?.entries || []).some((e) => e.pid || e.via === 'hep');
  const items = [];
  // Short labels that never truncate in the native menu (about 18 characters fit, audit T6),
  // and two verbs so the two "earlier day" items read apart: Tick as copies the ticks, Plan
  // as adds that day's list unticked. An item that would change nothing is hidden, never
  // offered to then say "0 added" (his rule: hidden, never dead controls; audit B5).
  if (last) items.push({ id: 'same', title: `Tick as ${fmtDateShort(last.date)}`, symbol: 'arrow.uturn.backward', group: 0 });
  if (planned.length && planned.some((p) => !isLogged(p, getDay(iso)?.entries || []))) items.push({ id: 'tickall', title: 'Tick all planned', symbol: 'checklist.checked', group: 0 });
  if (prev && repeatAdds(iso, prev).length) items.push({ id: 'repeat', title: `Plan as ${fmtDateShort(prev)}`, symbol: 'doc.on.doc', group: 0 });
  if (hepAdds(iso).length) items.push({ id: 'hep', title: 'Clinic program', symbol: 'list.clipboard', group: 0 });
  items.push({ id: 'test', title: 'Record a test', symbol: 'ruler', group: 1 });
  items.push({ id: 'clinic', title: 'Clinic day', symbol: 'cross.case', checked: !!clinic, group: 1 });
  // Round 3, A1: a show on this day (the device store, never his record). Checked when the
  // day has one; choosing it again takes it off, with Undo.
  items.push({ id: 'show', title: 'Show', symbol: 'theatermasks', checked: !!showOn(iso), group: 1 });
  if (bulk) items.push({ id: 'clear', title: iso === todayIso() ? 'Clear today' : 'Clear this day', symbol: 'trash', destructive: true, group: 2 });
  return items;
}

/** What "Plan as" would add from `prev`, without writing: the repeat action's own filter. */
function repeatAdds(iso, prev) {
  const d = getDay(iso) || { entries: [] };
  const out = [];
  for (const e of state.data.days?.[prev]?.entries || []) {
    if (e.pid && ((d.entries || []).some((x) => x.pid === e.pid) || out.some((x) => x.pid === e.pid))) continue;
    if (alreadyLogged(d, e.ex, e.side) || out.some((x) => x.ex === e.ex && (x.side || 'B') === (e.side || 'B'))) continue;
    out.push(e);
  }
  return out;
}
/** What the clinic program item would add today, without writing. */
function hepAdds(iso) {
  const d = getDay(iso) || { entries: [] };
  return (CLINIC_HEP.entries || []).filter((e) => !alreadyLogged(d, e.ex, e.side));
}

/** The latest earlier day with anything on it: what "Plan as" copies. */
function prevSessionIso(iso) {
  return Object.keys(state.data.days || {})
    .filter((k) => k < iso && (state.data.days[k].entries || []).length)
    .sort().pop() || null;
}

async function openDayMenu(iso, ctx, rerender, anchor) {
  // One menu for the whole app (js/menu.js): native in a build that has actions.show,
  // else the app's one web menu springing from the button (consistency pass 2026-09-30;
  // this used to draw its own grouped sheet, a fourth look for the same control).
  const picked = await appMenu({ items: dayMenuItems(iso) }, anchor);
  if (picked != null) runDayAction(String(picked), iso, ctx, rerender);
}

/** Undo for a bulk action: the day's rows as they were, the collagen guesses and tests taken back. */
function undoBulk(iso, before, guessed = [], testIds = []) {
  update((doc) => {
    const d = ensureDay(iso);
    const was = new Map(before.map((e) => [e.id, e]));
    d.entries = d.entries.filter((e) => was.has(e.id)).map((e) => was.get(e.id));
    for (const e of before) if (!d.entries.some((x) => x.id === e.id)) d.entries.push(e);
    for (const g of guessed) {
      const cd = ensureDay(g.iso);
      if (cd.supps?.[g.id] === g.at) { const sp = { ...cd.supps }; delete sp[g.id]; cd.supps = sp; }
    }
    if (testIds.length) doc.measurements = doc.measurements.filter((m) => !testIds.includes(m.id));
  });
}

function runDayAction(act, iso, ctx, rerender) {
  const before = JSON.parse(JSON.stringify(getDay(iso)?.entries || []));
  const done = (msg, undo) => {
    ctx.editing = null;
    rerender();
    actionToast(msg, 'Undo', () => { undo(); rerender(); }, { key: 'day-undo' });
  };
  if (act === 'same') {
    const last = lastSessionFor(iso);
    if (!last) return;
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
    done(`<b>${n} ticked</b> <span>as ${esc(fmtDateShort(last.date))}</span>`, () => undoBulk(iso, before, [], tests.ids || []));
    return;
  }
  if (act === 'tickall') {
    const planned = oneTendon(state.data, iso, plannedItems(iso)).filter((p) => !p.notYet);
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
    done(`<b>${planned.length} ticked</b>`, () => undoBulk(iso, before, guessed));
    return;
  }
  if (act === 'repeat') {
    const prev = prevSessionIso(iso);
    if (!prev) return;
    let n = 0;
    update(() => {
      const d = ensureDay(iso);
      for (const e of state.data.days[prev].entries) {
        const { id, seeded, via, paSnap, doneAt, timing, runId, partial, clinic, exWas, ...rest } = e;   // a clinic's badge belongs to that session only
        if (rest.pid && d.entries.some((x) => x.pid === rest.pid)) continue;
        if (alreadyLogged(d, rest.ex, rest.side)) continue;
        d.entries.push({ id: uid(), ...rest, logged: false });
        n++;
      }
    });
    done(`<b>${n} added</b> <span>from ${esc(fmtDateShort(prev))}</span>`, () => undoBulk(iso, before));
    return;
  }
  if (act === 'hep') {
    let n = 0;
    update(() => {
      const d = ensureDay(iso);
      for (const e of CLINIC_HEP.entries) {
        if (alreadyLogged(d, e.ex, e.side)) continue;
        // Marked, so Clear takes them away again like any program row.
        d.entries.push({ id: uid(), ...e, logged: false, via: 'hep' });
        n++;
      }
    });
    done(`<b>${n} added</b>`, () => undoBulk(iso, before));
    return;
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
    // Marking one narrows the day to the tendon loading and balance work, because the
    // session itself is the big workout. The same item turns it off again.
    const toggle = () => update((d) => {
      const map = ((d.program ||= {}).clinicDays ||= {});
      if (map[iso]) delete map[iso]; else map[iso] = true;
    });
    toggle();
    const on = !!state.data.program?.clinicDays?.[iso];
    done(`<b>${on ? 'Clinic day' : 'Not a clinic day'}</b>`, toggle);
    return;
  }
  if (act === 'show') {
    if (showOn(iso)) { removeShow(iso, () => rerender({ soft: true })); return; }
    addShow(iso);
    rerender({ soft: true });
    openShowSheet(iso, { repaint: () => rerender({ soft: true }) });
    return;
  }
  if (act === 'clear') {
    // Program rows and rows the Clinic program action added (A3). Anything he added
    // himself stays. No confirm: Undo puts every row back exactly as it was.
    const bulk = (e) => e.pid || e.via === 'hep';
    const n = (getDay(iso)?.entries || []).filter(bulk).length;
    if (!n) return;
    update(() => {
      const d = ensureDay(iso);
      d.entries = d.entries.filter((e) => !bulk(e));
    });
    done(`<b>${n} cleared</b>`, () => undoBulk(iso, before));
  }
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
  const liveHead = [head, head?.nextElementSibling];
  if (headTpl.length !== 2 || liveHead.some((x) => !x)) return false;
  // The clinic headline and the slim clinic row trade places (a clinic day that finishes):
  // a patch cannot add or drop the row, so that change repaints in full.
  if (!!page.querySelector(':scope > .td-clinic') !== (headClinic !== iso && !!clinicStripHtml(iso))) return false;
  headTpl.forEach((t, i) => pairs.push([liveHead[i], t]));

  const first = anchorFirst(state.data, iso) || planned.find((p) => p.first);
  const rec = page.querySelector('.recovery-line');
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
  const footLive = page.querySelector('.today-foot');
  const footTpl = one(weekFoot(iso) || '<i></i>');
  if (!!footLive !== (footTpl?.tagName === 'BUTTON')) return false;
  if (footLive) pairs.push([footLive, footTpl]);

  // The count, the estimate and the ring's number roll to their new values
  // (2026-09-15, his pick) instead of changing in place.
  const rollSel = ':scope > header.today-head :is(.td-count b, .td-est)';
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
    const pane = page.querySelector('[data-td-pane]');
    if (pane?.dataset.pid) refreshPaneHistory(pane, iso);
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
  let at = null;
  let tint = '';
  const land = () => {
    if (landed) return;
    landed = true;
    dot?.remove();
    seg.style.strokeDasharray = '';
    ring.classList.remove('won-wait');
    if (page.isConnected) drawRingSegment(page, iso, pid);
    // Round 3 (plan #4): the tick lands as a small spark in its segment, a light tap with it.
    if (at && page.isConnected) sparkAt(at.x, at.y, tint);
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
    at = { x: to.x, y: to.y };
    tint = getComputedStyle(dot).backgroundColor;
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

/** "rgb(75, 42, 158)" to "#4B2A9E", for the native layer (it reads hex). */
function hexOf(rgb) {
  const m = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(String(rgb || ''));
  return m ? `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}` : null;
}

/**
 * A spark where a tick landed on the day ring: the native tick (a small ring, a few sparks,
 * one light tap) in the category's colour; without the app, six small dots burst on the page.
 * Never both. Only ever called after the fly, which light motion and Reduce Motion skip.
 */
function sparkAt(x, y, colour) {
  const hex = hexOf(colour);
  // quiet after midnight like every other cel.play (A7; round 3 consistency pass).
  N.call('cel.play', { kind: 'tick', rect: { x: x - 13, y: y - 13, w: 26, h: 26 }, accent: hex || undefined, quiet: !!window.__rtNight }).then((ok) => {
    if (ok === true) return;
    const box = document.createElement('span');
    box.className = 'tick-spark';
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = `left:${x}px;top:${y}px;--c:${colour || 'var(--accent)'}`;
    box.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 700);
  });
}

/**
 * Round 3, A12 (research 11c 20, his words: "Things like the TheraBand, et cetera, are things
 * I love"): ticking an exercise done with a band makes its loop stretch and snap back in the
 * band's own colour, with two light taps 60 ms apart. Transform only. Reduce Motion: no
 * stretch, the taps stay. Only on a tick on, never an untick.
 */
function snapBand(page, pid) {
  const mark = page?.querySelector(`.crow[data-pid="${CSS.escape(pid)}"] .crow-name .band-mark`);
  if (!mark) return;
  N.hapticScore([{ t: 0, type: 'tap', intensity: 0.45, sharpness: 0.6 }, { t: 0.06, type: 'tap', intensity: 0.45, sharpness: 0.6 }]);
  const svg = mark.querySelector('svg') || mark;
  if (reducedMotion() || liteMotion() || !svg.animate) return;
  svg.style.transformOrigin = '15% 50%';
  svg.style.transformBox = 'fill-box';
  svg.animate([
    { transform: 'scaleX(1)' },
    { transform: 'scaleX(1.18) scaleY(.94)', offset: 0.32 },
    { transform: 'scaleX(.94) scaleY(1.04)', offset: 0.66 },
    { transform: 'scaleX(1)' },
  ], { duration: 420, delay: 60, easing: 'cubic-bezier(.2, 1.1, .3, 1)' });
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
  // A12: a clinician's next step turns face up the first time it is offered.
  const sug = body.querySelector('.prog-suggest[data-step-key]');
  if (sug) setTimeout(() => revealStep(sug, sug.dataset.stepKey), PANEL_OPEN_MS - 60);
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

// ------------------------------------------------- the iPad exercise pane ---
// iPad, regular width (his words 2026-09-30: "a bit more robust and capable than the iPhone
// one"): the list keeps the leading two thirds and the selected exercise (the sheet's content,
// plus its history and Begin) is drawn in a trailing pane instead of a sheet over the list.
// RULES kept here so nobody re-derives them:
//  - The pane exists in the markup for every device but rt-today.css shows it only from
//    700 x 600 pt (an iPhone never has that, in either orientation); the same query gates the
//    JS (paneOn). Where it is off, a picture opens the sheet exactly as before.
//  - One exercise is always selected while the pane shows: the row he touched last (the picture
//    or the name), else the first exercise still to do. The selected row wears `sel` (turquoise
//    = selected); checkRow draws it, so a patched row keeps it.
//  - Selecting never writes. The pane makes only the sheet's two writes (Try it, Not yet).
//  - A tick repaints just the pane's history block, so the pane keeps its scroll and frame.
//  - The pane is not a second navigation: it is the detail of the list beside it.
const paneQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 700px) and (min-height: 600px)') : null;
let paneSel = null;       // the selected program item id (this device, this visit)
let paneRoot = null;      // the view the current pane lives in

function paneOn(root) {
  const el = root?.querySelector?.('[data-td-pane]');
  return !!el && !!paneQuery?.matches && getComputedStyle(el).display !== 'none';
}

function paintPaneSel(root) {
  root.querySelectorAll('.crow.trow.sel').forEach((r) => r.classList.remove('sel'));
  if (paneSel) root.querySelector(`.crow.trow[data-pid="${CSS.escape(paneSel)}"]`)?.classList.add('sel');
}

/** Draw the selected exercise into the pane (or empty it where the pane is not shown). */
function syncPane(root, ctx, rerender, { pick = null, animate = false } = {}) {
  const host = root.querySelector('[data-td-pane]');
  if (!host) return;
  const iso = ctx.date || todayIso();
  if (!paneOn(root)) { host.replaceChildren(); delete host.dataset.pid; return; }
  const rows = [...root.querySelectorAll('.crow.trow[data-pid]')].filter((r) => r.querySelector('[data-exsheet]'));
  const has = (pid) => rows.some((r) => r.dataset.pid === pid);
  // The default is the first exercise still to do among those he can SEE (not one inside a closed fold).
  const seen = rows.filter((r) => r.offsetParent !== null);
  const first = seen.find((r) => !r.classList.contains('done')) || seen[0] || rows[0];
  const next = pick && has(pick) ? pick : has(paneSel) ? paneSel : first?.dataset.pid || null;
  if (!next) { host.replaceChildren(); delete host.dataset.pid; return; }
  const changed = host.dataset.pid !== next;
  paneSel = next;
  paintPaneSel(root);
  if (!changed && host.firstElementChild) return;
  mountExercisePane(host, next, {
    iso,
    animate: animate && changed,
    onBegin: () => { A.unlockAudio(); keepAwakeFromTap(); startExercise(ctx, next, iso); },
    onChange: () => rerender({ soft: true }),
  });
}

// Rotating the iPad, or a window changing size, turns the pane on or off without a repaint.
if (paneQuery?.addEventListener) {
  paneQuery.addEventListener('change', () => {
    const root = paneRoot;
    if (!root || !root.isConnected || !root.__tdCtx) return;
    const host = root.querySelector('[data-td-pane]');
    if (host) delete host.dataset.pid;
    syncPane(root, root.__tdCtx, root.__tdRerender);
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
  root.querySelector('[data-act="menu"]')?.addEventListener('click', (ev) => openDayMenu(iso, ctx, rerender, ev.currentTarget));
  // Press and hold a row's picture: it turns over to the other key position (peek.js, plan
  // 2.11); letting go turns it back. Bound first, so the click a peek leaves is swallowed.
  root.querySelectorAll('[data-exsheet]').forEach((b) => {
    const it = ALL_ITEMS.find((p) => p.id === b.dataset.exsheet);
    bindPeek(b, it?.img || pictureFor(it?.ex)?.img || null);
  });
  // Round 3: the show row (A1), the clinic card (A9) and the last night's sleep.
  bindShowRow(root, iso, { ringEl: () => document.querySelector('#view .today-head .dayring2'), repaint: () => rerender({ soft: true }) });
  // The clinic way in (the headline or the slim row), the collagen line and the night's
  // Evening row: one capture handler on the view, bound once, reading the day from the page,
  // so a patched head (which is never rebound) still answers, and the collagen line wins over
  // the row button it sits in.
  if (!root.__tdTaps) {
    root.__tdTaps = true;
    root.addEventListener('click', (e) => {
      const page = e.target.closest?.('.today.td');
      if (!page || !root.contains(page)) return;
      const c = e.target.closest('[data-clinic]');
      const toS = e.target.closest('[data-tosupps]');
      const eve = e.target.closest('[data-evening]');
      if (!c && !toS && !eve) return;
      e.preventDefault();
      e.stopPropagation();
      const tctx = root.__tdCtx;
      if (c) openClinicSheet(c.dataset.clinic, { repaint: () => root.__tdRerender?.({ soft: true }) });
      else if (toS) goSuppBand(tctx, toS.dataset.tosupps);
      else goSuppBand(tctx, 'evening');
    }, true);
  }
  root.__tdCtx = ctx;
  root.__tdRerender = rerender;
  // 'recovery' lands on Progress > Sleep in the app (mobile.js sleepRoute, round 3 consistency).
  root.querySelector('[data-sleep]')?.addEventListener('click', () => { N.haptic('light'); ctx.go('recovery'); });
  // One tap from a row's picture: the exercise sheet, the picture growing into it (exsheet.js).
  root.querySelectorAll('[data-exsheet]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pid = b.dataset.exsheet;
    // iPad: the picture picks the exercise for the pane beside the list, no sheet.
    if (paneOn(root)) { N.haptic('selection'); syncPane(root, ctx, rerender, { pick: pid, animate: true }); return; }
    openExerciseSheet(pid, {
      from: b.querySelector('.frame-tile') || b,
      iso,
      onBegin: () => { A.unlockAudio(); keepAwakeFromTap(); startExercise(ctx, pid, iso); },
      onChange: () => rerender({ soft: true }),
    });
  }));
  bindHistory(root);
  // iPad: the pane follows the row he touches, and is drawn on arrival.
  if (root.querySelector('[data-td-pane]')) {
    paneRoot = root;
    root.querySelectorAll('[data-rowclick]').forEach((b) => b.addEventListener('click', () => {
      const pid = b.dataset.rowclick;
      if (paneOn(root) && root.querySelector(`[data-exsheet="${CSS.escape(pid)}"]`)) syncPane(root, ctx, rerender, { pick: pid, animate: true });
    }));
    syncPane(root, ctx, rerender);
  }
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
  root.querySelectorAll('[data-cwtpl]').forEach((b) => b.addEventListener('click', () => {
    const t = bfrTemplates().find((x) => x.key === b.dataset.cwtpl);
    if (!t) return;
    saveConfig(t.cfg);
    rerender({ soft: true });
  }));
  root.querySelectorAll('[data-cwlegs]').forEach((b) => b.addEventListener('click', () => {
    saveConfig({ legs: b.dataset.cwlegs });
    rerender({ soft: true });
  }));
  // "30, 15, 15, 15": anything unreadable puts his last list back rather than saving nothing.
  root.querySelector('[data-cwreps]')?.addEventListener('change', (e) => {
    const list = parseReps(e.target.value);
    if (list) saveConfig({ reps: list });
    rerender({ soft: true });
  });
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

  root.querySelectorAll('[data-ckmenu]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.ckmenu;
    const cur = getDay(iso)?.checkin?.[key];
    const opts = KNEE_OPTS[kneeKind(key)] || [];
    const items = opts.map((o) => ({ id: String(o), title: kneeValue(key, o), checked: cur !== '' && cur != null && String(cur) === String(o) }));
    if (cur !== '' && cur != null) items.push({ id: '__clear', title: 'Not set', group: 1 });
    const picked = await appMenu({ items }, b);
    if (picked == null) return;
    const v = picked === '__clear' ? '' : (typeof opts[0] === 'number' ? Number(picked) : String(picked));
    update(() => { ensureDay(iso).checkin[key] = v; });
    rerender();
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
    if (on) snapBand(cb.closest('.today'), pid);
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
      onPick(ex, side, extra) {
        const day = getDay(iso) || { entries: [] };
        // From a clinic's list (2026-09-30): the exercise as it was set at the latest session,
        // each side it was done on, ready to log. His own row (never marked as done at the
        // clinic), linked to the session row it came from (clinicRef), so the two sit together
        // in the exercise's history. Already on the day: take him to it, never a second row.
        if (extra?.clinic) {
          const it = extra.clinic;
          const same = (e) => e.ex === it.ex && !!e.bfr === it.bfr && !e.clinic;
          const there = day.entries.find(same);
          if (there) { ctx.flash = there.id; rerender(); return; }
          const ids = [];
          update(() => {
            const d = ensureDay(iso);
            for (const r of it.rows) {
              const id = uid();
              ids.push(id);
              d.entries.push({
                id, ex: it.ex, side: r.side || 'B', logged: false,
                sets: r.sets ?? null, reps: r.reps ?? null,
                ...(Array.isArray(r.repsBySet) ? { repsBySet: [...r.repsBySet] } : {}),
                ...(r.secs ? { secs: r.secs } : {}), ...(r.time ? { time: r.time } : {}),
                load: r.load ?? null, loadUnit: r.loadUnit || state.data.settings.weightUnit,
                ...(r.band ? { band: r.band } : {}), ...(Array.isArray(r.bands) ? { bands: [...r.bands] } : {}),
                ...(it.bfr ? { bfr: true } : {}),
                clinicRef: `${it.last}|${r.id}`,
              });
            }
          });
          ctx.editing = ids[0];
          rerender();
          return;
        }
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
    // So does the routine hour on the tendon loading row.
    watchRoutine(page, ctx, iso, rerender);
  }
}

// ------------------------------------------------- the routine hour, live ---
// The tendon loading row's countdown (routineLine): its minutes and track move every
// 15 s while Today is on screen; at the end of the hour the row repaints once to "Now".
// Words only, never a repaint mid count, so nothing under his thumb moves.
const routineWatch = { iv: 0, page: null, tick: null };
function watchRoutine(page, ctx, iso, rerender) {
  clearInterval(routineWatch.iv);
  routineWatch.iv = 0;
  routineWatch.page = page;
  if (!page.querySelector('[data-routine-to]')) return;
  const tick = () => {
    const el = routineWatch.page?.querySelector('[data-routine-to]');
    if (!el || !el.isConnected || document.visibilityState === 'hidden') {
      if (!el || !el.isConnected) { clearInterval(routineWatch.iv); routineWatch.iv = 0; }
      return;
    }
    const to = Number(el.dataset.routineTo);
    const from = Number(el.dataset.routineFrom);
    const now = Date.now();
    if (now >= to) {
      clearInterval(routineWatch.iv);
      routineWatch.iv = 0;
      if ((ctx.date || todayIso()) === iso && ctx.view === 'today') rerender({ soft: true });
      return;
    }
    const left = el.querySelector('[data-routine-left]');
    const text = fmtLeft(to - now);
    if (left && left.textContent !== text) left.textContent = text;
    const bar = el.querySelector('.td-rbar > i');
    if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, (now - from) / (to - from))).toFixed(4)})`;
  };
  routineWatch.tick = tick;
  routineWatch.iv = setInterval(tick, 15000);
}
if (typeof window !== 'undefined') {
  // The app came back: the countdown catches up at once.
  window.addEventListener('rt-wake', () => routineWatch.tick?.());
}
