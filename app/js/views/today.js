// The one place data goes in. Everything else in the app reads from here.
//
// Today is a checklist. The date, one line saying what the day is for, then
// the exercises planned for the day with a circle to tick each one, then the
// day's supplements. Everything that used to sit above the list (the six
// month road, the week cadence, the month board, the insight cards) lives on
// Progress > Overview now. He opens this screen to answer one question, what
// do I do today, and the first exercise has to be on the first screen.

import { esc, todayIso, addDays, fmtDate, fmtDateNum, uid, num, round, currentDayIso } from '../util.js';
import { state, update, ensureDay, getDay, lastEntry, maxLoad, loadSeries, entriesFor } from '../store.js';
import { monthForDate } from '../../data/plan.js';
import { CATEGORIES, MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { REHAB_PROGRAM, GYM_PROGRAM, BAND_BY_ID, THERABAND, plannedOn, dayPlanFor } from '../../data/program.js';
import { CLINIC_HEP } from '../../data/history.js';
import { goalGroups } from './week.js';
import { shortCat } from './monthboard.js';
import { openExercisePicker, allExercises, exerciseById, openMeasureEntry, loadBars, thumb,
         openPicture, renderDatePill, prescriptionLine, toast, openModal, closeModal } from '../components.js';
import { minutesFor, fmtMins, fmtDayTotal } from '../timing.js';
import { streakDays } from '../insights.js';
import { renderSuppGroups, bindSuppGroups, suppScore, prnSummary } from './supplements.js';
import { itemStatus, isDone, sidesFor, setLogged, newEntriesFor as makeEntries, runsFor } from '../logging.js';
import { startExercise, startWorkout, resumePlayer, draftInfo, workoutQueue, readyAfter, fmtTime12 } from '../player/player.js';

const EFFUSION = ['', 'Zero', 'Trace', '1+', '2+', '3+'];
const ALL_ITEMS = REHAB_PROGRAM.concat(GYM_PROGRAM);

// ------------------------------------------------------------- the day ----
/**
 * Program items planned for the day, both lists, in program order except that
 * anything marked `first` leads: the tendon loading is the morning's first
 * job, with six hours before the rest.
 */
function plannedItems(iso) {
  const all = ALL_ITEMS.filter((p) => plannedOn(state.data, p.id, iso));
  return all.filter((p) => p.first).concat(all.filter((p) => !p.first));
}
function restItems(iso) {
  return ALL_ITEMS.filter((p) => !plannedOn(state.data, p.id, iso));
}

/** Minutes for a row: his number, else the estimate; cardio uses last time. */
function rowMinutes(item, ex = exerciseById(item.ex)) {
  const last = ex?.cardio ? num(lastEntry(item.ex, 'B')?.time) : null;
  return minutesFor(item, ex, state.data, last, runsFor(state.data, state.rev, item.id));
}

/** Green means every required side confirmed. See itemStatus in logging.js. */
function isLogged(item, entries) {
  return isDone(item, entries);
}

export function renderToday(ctx) {
  const iso = ctx.date || todayIso();
  const day = getDay(iso);
  const entries = day?.entries || [];
  const c = day?.checkin || {};
  const warn = kneeWarning(c);
  const planned = plannedItems(iso);
  const rest = restItems(iso);
  const extras = entries.filter((e) => !e.pid);

  return `
  <div class="stack today">
    ${renderDatePill(iso, { showDone: false })}
    ${warn ? `<div class="notice ${warn.level}">${warn.html}</div>` : ''}
    ${day?.seeded ? `<div class="notice info">Seeded from ${esc(day.source || 'your clinical notes')}. Edit anything that is not right.</div>` : ''}

    <section class="card listcard" id="session-card">
      ${dayHead(iso, planned, extras, entries, ctx)}
      <div class="checklist">
        ${planned.map((p, i) => checkRow(p, iso, entries, ctx) + gapAfter(planned, i, iso)).join('')}
        ${extras.map((e) => extraRow(e, iso, ctx)).join('')}
        <button class="list-add" data-act="add-ex"><span class="plus">+</span>Add something else</button>
      </div>
      ${restGroup(rest, iso, entries, ctx, planned.length ? 'Not planned today' : 'All exercises')}
      ${goalsGroup(iso, entries, ctx)}
    </section>

    ${suppCard(iso, ctx)}
    ${kneeCard(c, ctx)}
    ${noteRow(day, ctx)}
    ${weekFoot(iso)}
  </div>`;
}

/**
 * What today IS, in one line, and what it costs. The list on its own never
 * answered "what am I meant to do today", so the day keeps its name; the
 * count and the minutes tell him what he is in for before he starts.
 */
function dayHead(iso, planned, extras, entries, ctx) {
  const plan = dayPlanFor(state.data, iso);
  const doneP = planned.filter((p) => isLogged(p, entries));
  const doneN = doneP.length + extras.filter((e) => e.logged).length;
  const total = planned.length + extras.length;
  const allMins = planned.map((p) => rowMinutes(p));
  const leftMins = planned.filter((p) => !doneP.includes(p)).map((p) => rowMinutes(p));
  const mins = allMins.reduce((a, m) => a + (m.mins || 0), 0);

  const complete = total > 0 && doneN >= total;
  const streak = streakDays(iso);
  let sub;
  if (!total) sub = 'Nothing planned. Everything is below if you want it.';
  else if (!doneN) sub = `${total} to do · ${fmtDayTotal(allMins)}`;
  else if (complete) sub = `All ${total} done · ${fmtMins(mins)} of rehab. Nice work.`;
  else sub = `${doneN} of ${total} done · ${fmtDayTotal(leftMins)} left`;
  if (streak >= 2) sub += ` · ${streak} days in a row`;

  // The ring bursts once, on the render where the day becomes complete.
  const celebrate = complete && ctx.lastComplete !== iso;
  ctx.lastComplete = complete ? iso : null;

  return `
  <header class="dayhead ${complete ? 'complete' : ''} ${celebrate ? 'celebrate' : ''}">
    ${ring(doneN, total)}
    <div class="dayhead-main">
      <h2>${esc(plan.name || (total ? 'Today' : 'Rest day'))}</h2>
      <div class="dayhead-sub">${esc(sub)}${plan.clinic ? ` · ${esc(plan.sub)}` : ''}</div>
    </div>
    ${workoutButton(iso)}
    <button class="icon-btn" data-act="menu" title="More" aria-label="More">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
    </button>
  </header>`;
}

/** What the minutes on a row are based on, for its tooltip and the open row. */
export function minsTitle(m) {
  if (m.src === 'yours') return 'Your number';
  if (m.src === 'logged') return 'What you logged';
  if (m.src === 'learned') return `Usually about ${m.mins} min, from your last ${m.learned?.runs ?? ''} timed runs`;
  if (m.src === 'untimed') return 'Target not specified, so no time estimate';
  return 'Estimated from the prescription. Open the row to change it.';
}

/**
 * Start or Resume: one control in one place, its label saying which. Dimmed
 * when there is nothing left and no workout open.
 */
function workoutButton(iso) {
  const d = draftInfo();
  const left = workoutQueue(state.data, iso).length;
  const resume = !!d;
  return `<button class="btn primary dayplay" data-act="${resume ? 'resume' : 'start'}" ${resume || left ? '' : 'disabled'}
    aria-label="${resume ? `Resume ${esc(d.title || 'workout')}` : 'Start the workout'}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>${resume ? 'Resume' : 'Start'}</button>`;
}

/**
 * The line between the morning's first job and everything else. Once the
 * tendon loading is confirmed with a time, it says when the rest may start;
 * before that, or for a row logged without a time, just the gap.
 */
function gapAfter(planned, i, iso) {
  const p = planned[i];
  const next = planned[i + 1];
  if (!p?.first || !next || next.first) return '';
  const ready = readyAfter(state.data, iso);
  if (ready) {
    return `<button class="list-sep readysep" data-act="readytime" title="Change when the tendon loading was done">
      <span>Rest of your workout after ${esc(fmtTime12(ready))}</span></button>`;
  }
  return `<div class="list-sep"><span>${esc(p.gap || '')} later</span></div>`;
}

/** Progress ring for the day: done over total, a check when full. */
function ring(done, total) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const frac = total ? Math.min(1, done / total) : 0;
  const on = frac * c;
  return `<span class="dayring ${total && done >= total ? 'full' : ''}" aria-hidden="true">
    <svg viewBox="0 0 46 46">
      <circle class="bg" cx="23" cy="23" r="${r}"/>
      <circle class="on" cx="23" cy="23" r="${r}" stroke-dasharray="${on.toFixed(1)} ${(c - on).toFixed(1)}" transform="rotate(-90 23 23)"/>
    </svg>
    <b>${total ? `${done}/${total}` : ''}</b></span>`;
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
  const status = itemStatus(item, entries);
  const started = mine.length > 0;
  const done = status.state === 'done';
  const partial = status.state === 'partial';
  // Only confirmed rows are results. Scaffolding from opening the row keeps
  // showing the prescription, so a prefilled number never reads as done.
  const confirmed = mine.filter((e) => e.logged);
  const editing = started && ctx.editing === item.id;
  const band = state.data.program.band[item.id] ?? item.band ?? '';
  const name = item.title || ex?.name || item.ex;
  // A logged cardio row shows the minutes it actually took.
  const logged = confirmed.length && ex?.cardio ? num(confirmed[0].time) : null;
  const m = logged ? { mins: Math.round(logged), src: 'logged' } : rowMinutes(item, ex);

  return `
  <div class="crow ${done ? 'done' : ''} ${partial ? 'partial' : ''} ${started && !done && !partial ? 'started' : ''} ${editing ? 'editing' : ''} ${ctx.pop === item.id ? 'pop' : ''}" data-pid="${esc(item.id)}"${catStyle(ex)}>
    <div class="crow-head">
      <input type="checkbox" class="tick" data-ptoggle="${esc(item.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(name)}${partial ? ', partly done' : ''}">
      ${item.thumb
        ? `<button class="crow-shot" data-bigpic="${esc(item.id)}" title="Show it bigger"><img src="${esc(item.thumb)}" alt="" decoding="async"></button>`
        : `<span class="crow-shot plain">${thumb(item.ex, 34)}</span>`}
      <div class="crow-main" data-rowclick="${esc(item.id)}">
        <span class="crow-name">${esc(name)}</span>
        <span class="crow-sub">${confirmed.length ? entryChips(confirmed) + statusNote(status) : prescriptionLine(item, band)}</span>
        ${item.notYet && !confirmed.length ? `<span class="crow-note warn">${esc(item.notYetNote)}</span>` : ''}
        ${item.pre && !confirmed.length ? `<span class="crow-note">${esc(item.preShort || item.pre)}</span>` : ''}
      </div>
      <span class="crow-mins ${m.src}" data-rowclick="${esc(item.id)}"
        title="${esc(minsTitle(m))}">${m.mins == null ? '·' : `${m.mins}<small>min</small>`}</span>
    </div>
    ${editing ? boards(item, ex) + mine.map((e) => entryFields(e, ex)).join('') + logBar(item.id, item, ex) : ''}
  </div>`;
}

/** Something logged outside the program: a walk, a rehearsal, a clinic drill. */
function extraRow(e, iso, ctx) {
  const ex = exerciseById(e.ex);
  const editing = ctx.editing === e.id;
  const done = !!e.logged;
  const cat = CATEGORIES[ex?.cat];
  return `
  <div class="crow ${done ? 'done' : 'started'} ${editing ? 'editing' : ''} ${e.id === ctx.flash ? 'flash' : ''} ${ctx.pop === e.id ? 'pop' : ''}"${catStyle(ex)}>
    <div class="crow-head">
      <input type="checkbox" class="tick" data-etoggle="${esc(e.id)}" ${done ? 'checked' : ''} aria-label="Done: ${esc(ex?.name || e.ex)}">
      <span class="crow-shot plain">${thumb(e.ex, 34)}</span>
      <div class="crow-main" data-rowclick="${esc(e.id)}">
        <span class="crow-name">${esc(ex?.name || e.ex)}</span>
        <span class="crow-sub">${entryChips([e])}${cat ? `<span class="muted">${esc(cat.label)}</span>` : ''}${e.seeded ? '<span class="seeded-dot" title="from your clinical notes">●</span>' : ''}</span>
      </div>
    </div>
    ${editing ? entryFields(e, ex) + logBar(e.id, null, ex, e) : ''}
  </div>`;
}

/** The folded group under the list. Open state lives on ctx so a tick does not close it. */
function restGroup(rows, iso, entries, ctx, label) {
  if (!rows.length) return '';
  const done = rows.filter((p) => isLogged(p, entries)).length;
  return `
  <details class="fold" data-rest="openRest" ${ctx.openRest ? 'open' : ''}>
    <summary>${esc(label)} · ${rows.length}${done ? ` <span class="good">${done} done</span>` : ''}</summary>
    <div class="checklist">${rows.map((p) => checkRow(p, iso, entries, ctx)).join('')}</div>
  </details>`;
}

function logBar(key, item, ex, entry = null) {
  const est = item ? rowMinutes(item, ex) : null;
  const own = item ? num(state.data.program.mins?.[item.id]) : null;
  return `<div class="logbar">
    ${item ? `<label class="fld minsfld" title="Minutes this takes you. Leave it empty to use the estimate.">Minutes
      <input type="number" class="in-num" min="0" step="1" data-mins="${esc(item.id)}" placeholder="${est.src !== 'yours' && est.mins != null ? est.mins : ''}" value="${own ?? ''}"></label>` : ''}
    ${entry ? `<button class="btn sm ghost danger" data-del-entry="${esc(entry.id)}">Remove</button>` : ''}
    <span class="spacer"></span>
    ${item ? `<button class="btn sm" data-timer="${esc(item.id)}">
      <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>Start timer</button>` : ''}
    <button class="btn primary sm" data-log="${esc(key)}">Log it</button>
  </div>`;
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
          ? `last ${esc(fmtDateNum(last.date))} · level ${round(last.load, 0)}${last.time ? ` · ${round(last.time, 0)} min` : ''}${last.calories ? ` · ${last.calories} cal` : ''}`
          : `last ${esc(fmtDateNum(last.date))} · ${round(last.load, 2)} ${esc(last.unit)}${last.sets ? ` · ${last.sets} × ${last.reps ?? '?'}` : ''}`
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
  return mine.map((e) => {
    const bits = [];
    const bySet = Array.isArray(e.repsBySet) ? e.repsBySet.filter((x) => x != null) : [];
    if (bySet.length > 1 && bySet.some((x) => x !== bySet[0])) bits.push(`${bySet.join(' + ')} reps`);
    else if (e.sets && e.reps) bits.push(`${e.sets}×${e.reps}`);
    else if (e.reps) bits.push(`${e.reps} reps`);
    else if (e.sets) bits.push(`${e.sets} sets`);
    if (num(e.load)) bits.push(`${round(num(e.load), 2)} ${e.loadUnit || state.data.settings.weightUnit}`);
    if (num(e.time)) bits.push(`${round(num(e.time), 2)} min`);
    if (num(e.secs)) bits.push(`${round(num(e.secs), 1)} s`);
    else if (num(e.hold)) bits.push(`hold ${round(num(e.hold), 1)} s`);
    if (num(e.secsL) != null || num(e.secsR) != null) bits.push(`L ${e.secsL ?? '·'} · R ${e.secsR ?? '·'} s`);
    if (num(e.testL) != null || num(e.testR) != null) bits.push(`best L ${e.testL ?? '·'} · R ${e.testR ?? '·'}`);
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
function goalsGroup(iso, entries, ctx) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  const month = monthForDate(iso);
  const met = groups.filter((g) => g.met).length;
  const openKey = ctx.openGoal === undefined ? (groups.find((g) => !g.met)?.t.id ?? null) : ctx.openGoal;

  return `
  <details class="fold" data-rest="openGoals" ${ctx.openGoals ? 'open' : ''}>
    <summary>This week's targets · ${met}/${groups.length} met</summary>
    <div class="goalbox">
    ${groups.map((g) => {
      const open = openKey === g.t.id;
      const all = allExercises().filter((x) => g.t.tagged ? x.tag === g.t.tagged : g.t.cats.includes(x.cat));
      const showAll = ctx.goalAll === g.t.id;
      const list = showAll || !month.n ? all : all.filter((x) => !x.months || x.months.includes(month.n));
      return `
      <div class="goalgroup ${g.met ? 'met' : ''} ${open ? 'open' : ''}" style="--c:${g.colour}">
        <button class="goalhead" data-goalgroup="${esc(g.t.id)}">
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
                <div class="crow-main" data-catclick="${esc(ex.id)}">
                  <span class="crow-name">${esc(ex.name)}</span>
                  <span class="crow-sub">${started ? entryChips(mine) : (ex.clinic ? '<span class="muted">clinic</span>' : '')}</span>
                </div>
              </div>
              ${editing ? mine.map((e) => entryFields(e, ex)).join('') + logBar('cat:' + ex.id, null, ex) : ''}
            </div>`;
          }).join('')}
          ${all.length > list.length || showAll
            ? `<button class="btn sm ghost" data-goalall="${esc(g.t.id)}" style="margin-top:.4rem">
                ${showAll ? 'Just this month' : `Show all ${all.length}`}</button>` : ''}
        </div>` : ''}
      </div>`;
    }).join('')}
    </div>
  </details>`;
}

// ---------------------------------------------------------- supplements ----
/**
 * The day's supplements, right under the exercises. Between midnight and 5am
 * the checklist is still yesterday's, exactly as the Supplements tab does it
 * (see currentDayIso), so the same rows show here for the same day.
 */
function suppIsoFor(iso) {
  return iso === todayIso() ? currentDayIso() : iso;
}

function suppCard(iso, ctx) {
  const sIso = suppIsoFor(iso);
  const score = suppScore(sIso);
  if (!score) return '';
  const prn = prnSummary(sIso);
  return `
  <section class="card listcard supps">
    <header class="dayhead slim">
      <div class="dayhead-main">
        <h2>Supplements</h2>
        <div class="dayhead-sub">${score.taken} of ${score.total} taken${sIso !== iso ? ` · ${esc(fmtDate(sIso, 'dow'))}'s list until 5am` : ''}</div>
      </div>
      <button class="btn sm ghost" data-goto="supplements" title="Edit the list">Edit</button>
    </header>
    <div class="card-body tight">
      ${renderSuppGroups(sIso, ctx)}
    </div>
    ${prn ? `<button class="rowlink" data-goto="supplements"><b>As needed</b><span class="sub">${esc(prn)}</span><span class="chev">›</span></button>` : ''}
  </section>`;
}

// --------------------------------------------------------------- knees ----
function kneeCard(c, ctx) {
  return `
  <section class="card panel ${ctx.openKnees ? 'open' : ''}">
    <button class="panel-head" data-panel="knees">
      <span class="panel-title"><h2>Knees</h2>
        <span class="sub">${kneeSummary(c)}</span></span>
      <span class="chev">⌄</span>
    </button>
    ${ctx.openKnees ? `<div class="card-body">
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
    </div>` : ''}
  </section>`;
}

function kneeSummary(c) {
  const bits = [];
  if (num(c.painL) != null || num(c.painR) != null) {
    bits.push(`pain L ${c.painL ?? '·'} · R ${c.painR ?? '·'}`);
  }
  const eff = [c.effusionL, c.effusionR].filter((v) => v && v !== 'Zero');
  if (eff.length) bits.push(`swelling ${eff.join(', ')}`);
  else if (c.effusionL === 'Zero' || c.effusionR === 'Zero') bits.push('no swelling');
  if (c.nextDay) bits.push(`yesterday: ${c.nextDay.toLowerCase()}`);
  return bits.length ? esc(bits.join('  ·  ')) : '<em>not logged</em>';
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
      <strong class="mono" style="font-size:.8rem">${painVal === '' ? '·' : painVal + '/10'}</strong>
      <span class="spacer"></span>
      <label class="tiny muted" style="display:flex;gap:.3rem;align-items:center">swelling
        <select data-ck="${effKey}" class="sel-sm">
          ${EFFUSION.map((o) => `<option value="${o}" ${(c[effKey] || '') === o ? 'selected' : ''}>${o || '·'}</option>`).join('')}
        </select>
      </label>
    </div>
    <input type="range" min="0" max="10" step="1" data-ck="${painKey}" value="${painVal === '' ? 0 : painVal}">
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

/** One quiet line of feedback at the very bottom: this week against the plan. */
function weekFoot(iso) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  return `<button class="today-foot" data-goto="progress">
    This week · ${groups.map((g) => `${esc(shortCat(g.t.label))} <span class="mono">${g.hit}/${g.goal}</span>`).join(' · ')} · more ›
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
        (x) => x.measure === m.id && x.date === iso && (x.leg || null) === (leg || null));
      if (exists) continue;
      rows.push({ id: uid(), date: iso, measure: m.id, leg: leg || null, value });
      const u = UNIT_LABEL[m.unit] || '';
      const withUnit = u.length > 2 ? `${value} ${u}` : `${value}${u}`;
      saved.push(`${m.label}${leg ? ` (${leg === 'L' ? 'left' : 'right'})` : ''} ${withUnit}`);
    }
  }
  if (rows.length) update((d) => { d.measurements.push(...rows); });
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
  return `<span class="testboxes" title="${esc(mf.m.label)}: your best, recorded as a test">
    ${sideBox(e, 'test', 'L', 'Best')}${sideBox(e, 'test', 'R', 'Best')}
  </span>`;
}

function entryFields(e, ex) {
  const unit = e.loadUnit || state.data.settings.weightUnit;
  const usesBand = ex?.usesBand;
  const side = `<span class="sidetag ${e.side || 'B'}">${e.side === 'L' ? 'Left' : e.side === 'R' ? 'Right' : 'both'}</span>`;

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
  <div class="pfields ${e.logged ? '' : 'prefill'}" data-entry="${esc(e.id)}" ${e.logged ? '' : 'title="Filled in from last time. Not logged until you confirm it."'}>
    ${side}
    <label class="fld">Sets<input type="number" step="1" min="0" data-f="sets" value="${e.sets ?? ''}"></label>
    ${repsFields(e)}
    <label class="fld">Load ${esc(unit)}<input type="number" step="any" min="0" data-f="load" value="${e.load ?? ''}"></label>
    ${secsFields(e, ex)}
    ${usesBand ? `<label class="fld" style="width:104px">Theraband
      <select data-f="band" class="bandsel">
        <option value="">none</option>
        ${THERABAND.map((b) => `<option value="${b.id}" ${e.band === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select></label>` : ''}
    ${testBoxes(e, ex)}
    <label class="fld wide">Note<input data-f="notes" value="${esc(e.notes || '')}"></label>
    ${ex?.measure ? `<button class="btn sm astest" data-astest="${esc(e.id)}"
      title="Record this as a test result, so it counts towards your month markers">as test</button>` : ''}
  </div>`;
}

// ------------------------------------------------------------- helpers ----
/**
 * The most recent earlier day with something LOGGED from the program, so
 * "Same as last time" copies a real session, not a day that was only looked at.
 */
function lastSessionFor(iso) {
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

function newEntriesFor(item, ex, logged = false) {
  return makeEntries(item, ex, {
    logged,
    prev: (side) => lastEntry(item.ex, side),
    weightUnit: state.data.settings.weightUnit,
    band: state.data.program.band[item.id] || '',
  });
}

/**
 * Tick a program item done. Rows he already has are confirmed; a required
 * side with no row gets one, unless an unsplit result already covers it.
 */
function tickItem(d, item, on) {
  const mine = d.entries.filter((e) => e.pid === item.id);
  if (!on) { setLogged(mine, false); return; }
  if (!mine.length) { d.entries.push(...newEntriesFor(item, exerciseById(item.ex), true)); return; }
  const coversAll = mine.some((e) => (e.side || 'B') === 'B');
  if (!coversAll) {
    const fresh = newEntriesFor(item, exerciseById(item.ex), true)
      .filter((row) => !mine.some((e) => (e.side || 'B') === row.side));
    d.entries.push(...fresh);
  }
  setLogged(mine, true);
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

/** Announce a personal best when a loaded entry gets marked done. */
function pbCheck(iso, list) {
  for (const e of list) {
    const l = num(e.load);
    if (!l) continue;
    const prior = entriesFor(e.ex, e.side === 'B' ? null : e.side)
      .filter((x) => x.date < iso && num(x.load) > 0)
      .map((x) => num(x.load));
    if (prior.length && l > Math.max(...prior)) {
      const name = exerciseById(e.ex)?.name || e.ex;
      toast(`<b>New best: ${esc(String(round(l, 1)))} ${esc(e.loadUnit || state.data.settings.weightUnit)}</b><br>
        <span>${esc(name)}${e.side && e.side !== 'B' ? ` (${e.side === 'L' ? 'left' : 'right'})` : ''} · was ${esc(String(round(Math.max(...prior), 1)))}</span>`);
    }
  }
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
  const planned = plannedItems(iso);
  const hasHep = !!(CLINIC_HEP.entries || []).length;
  const clinic = dayPlanFor(state.data, iso).clinic;
  openModal({
    title: fmtDate(iso),
    body: `<div class="menu">
      <button class="btn" data-m="same" ${last ? '' : 'disabled'}>Same as last time${last ? `<span class="tiny muted">${esc(fmtDateNum(last.date))}, with the same numbers</span>` : ''}</button>
      <button class="btn" data-m="tickall">Tick everything planned<span class="tiny muted">${planned.length} exercise${planned.length === 1 ? '' : 's'}, with last time's numbers</span></button>
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
              const { id, seeded, via, paSnap, doneAt, timing, runId, partial, ...rest } = e;
              const row = { id: uid(), ...rest };
              setLogged([row], true);
              d.entries.push(row);
              marked.push(row);
            }
          });
          const tests = recordAsTests(iso, marked);
          pbCheck(iso, marked);
          const n = new Set(marked.map((x) => x.pid)).size;
          toast(`<b>Same as ${esc(fmtDateNum(last.date))}</b><br><span>${n} exercise${n === 1 ? '' : 's'} ticked${tests.length ? ` · also saved as ${tests.length === 1 ? 'a test' : 'tests'}` : ''}</span>`);
        }
        if (act === 'tickall') {
          update(() => {
            const d = ensureDay(iso);
            for (const item of (planned.length ? planned : ALL_ITEMS)) {
              if (item.notYet) continue;
              tickItem(d, item, true);
            }
          });
        }
        if (act === 'repeat') {
          const prev = Object.keys(state.data.days)
            .filter((k) => k < iso && (state.data.days[k].entries || []).length)
            .sort().pop();
          if (!prev) { toast('<b>No earlier session to copy</b>', 'warn'); return; }
          update(() => {
            const d = ensureDay(iso);
            for (const e of state.data.days[prev].entries) {
              const { id, seeded, via, paSnap, doneAt, timing, runId, partial, ...rest } = e;
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
              d.entries.push({ id: uid(), ...e, logged: false });
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
          const n = (getDay(iso)?.entries || []).filter((e) => e.pid).length;
          if (!n || !confirm(`Remove all ${n} program exercise${n === 1 ? '' : 's'} from ${fmtDate(iso)}? Anything you added yourself stays.`)) return;
          update(() => {
            const d = ensureDay(iso);
            d.entries = d.entries.filter((e) => !e.pid);
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
  const first = ALL_ITEMS.find((p) => p.first);
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
        });
        closeModal();
        rerender();
      });
    },
  });
}

// ---------------------------------------------------------------- bind ----
export function bindToday(root, ctx, rerender) {
  const iso = ctx.date || todayIso();
  // One-shot animation flags: consumed by this render, gone for the next.
  ctx.pop = null;

  if (ctx.flash) {
    const el = root.querySelector('.crow.flash');
    if (el) scrollToEl(el);
    ctx.flash = null;
  }
  if (ctx.scrollGoals) {
    ctx.scrollGoals = false;
    scrollToEl(root.querySelector('[data-rest="openGoals"]'));
  }

  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.nav;
    ctx.date = v === 'today' ? todayIso() : addDays(iso, Number(v));
    ctx.editing = null;
    rerender();
  }));
  root.querySelector('[data-jump]')?.addEventListener('change', (e) => {
    if (e.target.value) { ctx.date = e.target.value; ctx.editing = null; rerender(); }
  });
  root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.goto;
    if (v === 'progress') ctx.gtab = 'overview';
    ctx.go(v);
  }));
  root.querySelector('[data-act="menu"]')?.addEventListener('click', () => openDayMenu(iso, ctx, rerender));
  root.querySelector('[data-act="start"]')?.addEventListener('click', () => startWorkout(ctx, iso));
  root.querySelector('[data-act="resume"]')?.addEventListener('click', () => resumePlayer(ctx));
  root.querySelectorAll('[data-timer]').forEach((b) => b.addEventListener('click', () => startExercise(ctx, b.dataset.timer, iso)));
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
  root.querySelectorAll('[data-panel="knees"]').forEach((b) => b.addEventListener('click', () => {
    ctx.openKnees = !ctx.openKnees;
    rerender();
  }));

  root.querySelectorAll('[data-ck]').forEach((inp) => {
    const key = inp.dataset.ck;
    const ev = inp.type === 'range' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      update(() => {
        const d = ensureDay(iso);
        const raw = inp.value;
        d.checkin[key] = inp.type === 'number' || inp.type === 'range' ? (raw === '' ? '' : Number(raw)) : raw;
      });
      if (inp.type === 'range' || key === 'nextDay' || key.startsWith('effusion')) rerender();
    });
  });

  root.querySelector('[data-daynote]')?.addEventListener('input', (e) => {
    update(() => { ensureDay(iso).notes = e.target.value; });
  });

  // Tick a program item on or off. The circle only toggles done; it never
  // expands the row.
  root.querySelectorAll('[data-ptoggle]').forEach((cb) => cb.addEventListener('change', () => {
    const pid = cb.dataset.ptoggle;
    const item = ALL_ITEMS.find((p) => p.id === pid);
    if (!item) return;
    update(() => {
      const d = ensureDay(iso);
      tickItem(d, item, cb.checked);
      if (cb.checked) pbCheck(iso, d.entries.filter((e) => e.pid === pid));
    });
    if (cb.checked) testToast(recordAsTests(iso, ensureDay(iso).entries.filter((e) => e.pid === pid)));
    ctx.editing = null;
    ctx.pop = cb.checked ? pid : null;
    rerender();
  }));

  // Same for a row he added himself.
  root.querySelectorAll('[data-etoggle]').forEach((cb) => cb.addEventListener('change', () => {
    update(() => {
      const e = ensureDay(iso).entries.find((x) => x.id === cb.dataset.etoggle);
      if (e) setLogged([e], cb.checked);
    });
    if (cb.checked) {
      const e = ensureDay(iso).entries.find((x) => x.id === cb.dataset.etoggle);
      testToast(e ? recordAsTests(iso, [e]) : []);
    }
    ctx.editing = null;
    ctx.pop = cb.checked ? cb.dataset.etoggle : null;
    rerender();
  }));

  // Tapping the name opens the row for numbers, or closes it again. Closing
  // this way does not mark it done.
  root.querySelectorAll('[data-rowclick]').forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.rowclick;
    const item = ALL_ITEMS.find((p) => p.id === key);
    const d = ensureDay(iso);
    const has = item ? d.entries.some((e) => e.pid === key) : d.entries.some((e) => e.id === key);
    if (item && !has) {
      update(() => { d.entries.push(...newEntriesFor(item, exerciseById(item.ex), false)); });
      ctx.editing = key;
    } else {
      ctx.editing = ctx.editing === key ? null : key;
    }
    rerender();
  }));

  // "Log it" marks it done and collapses. The numbers saved as you typed.
  root.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.log;
    const catEx = key.startsWith('cat:') ? key.slice(4) : null;
    const marked = [];
    update(() => {
      for (const e of ensureDay(iso).entries) {
        if (catEx ? (e.ex === catEx && !e.pid) : (e.pid === key || e.id === key)) {
          setLogged([e], true);
          marked.push(e);
        }
      }
    });
    testToast(recordAsTests(iso, marked));
    pbCheck(iso, marked);
    ctx.editing = null;
    ctx.pop = catEx || key;
    rerender();
  }));

  // His minutes for a program item. Empty means back to the estimate.
  root.querySelectorAll('[data-mins]').forEach((inp) => inp.addEventListener('change', () => {
    const pid = inp.dataset.mins;
    update((d) => {
      d.program.mins = d.program.mins || {};
      const v = num(inp.value);
      if (v == null || v < 0) delete d.program.mins[pid]; else d.program.mins[pid] = Math.round(v);
    });
    rerender();
  }));

  root.querySelectorAll('[data-rest]').forEach((d) => d.addEventListener('toggle', () => {
    ctx[d.dataset.rest] = d.open;
  }));

  root.querySelectorAll('[data-entry] [data-f]').forEach((inp) => {
    const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      const id = inp.closest('[data-entry]').dataset.entry;
      const f = inp.dataset.f;
      update(() => {
        const e = ensureDay(iso).entries.find((x) => x.id === id);
        if (!e) return;
        e[f] = inp.type === 'number' ? num(inp.value) : inp.value;
        if (f === 'load' && e.load != null && !e.loadUnit) e.loadUnit = state.data.settings.weightUnit;
        // remember the band for this program item
        if (f === 'band' && e.pid) state.data.program.band[e.pid] = inp.value;
      });
      if (f === 'band' || f === 'load') rerender();
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
    const d = ensureDay(iso);
    if (!d.entries.some((e) => e.ex === exId && !e.pid)) {
      update(() => { d.entries.push(newCatEntry(exId)); });
      ctx.editing = key;
    } else {
      ctx.editing = ctx.editing === key ? null : key;
    }
    ctx.openGoals = true;
    rerender();
  }));

  root.querySelectorAll('[data-astest]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const entry = ensureDay(iso).entries.find((x) => x.id === b.dataset.astest);
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
      monthN: month?.n,
      onPick(ex, side) {
        const day = ensureDay(iso);
        if (alreadyLogged(day, ex.id, side)) {
          // Already there: take him to it instead of stacking another row.
          ctx.flash = (day.entries.find((e) => e.ex === ex.id && (e.side || 'B') === (side || 'B')) || {}).id;
          rerender();
          return;
        }
        const prev = lastEntry(ex.id, side);
        update(() => {
          day.entries.push({
            id: uid(), ex: ex.id, side, logged: false,
            sets: prev?.sets ?? null, reps: prev?.reps ?? null,
            load: prev?.load ?? null, loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
            band: ex.usesBand ? (prev?.band || '') : undefined,
          });
        });
        ctx.editing = day.entries[day.entries.length - 1]?.id || null;
        rerender();
      },
    });
  });

  // The supplement rows share their handlers with the Supplements tab.
  bindSuppGroups(root, suppIsoFor(iso), ctx, rerender);
}
