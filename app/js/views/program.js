// The clinician program: pictures, prescriptions, the days each exercise is
// planned for, and behind a tap the written steps, progressions, band and
// the minutes it takes. One list, filtered by day.
//
// Tapping a day in the strip filters the list to that day. His words: "if I
// click on one of the dates, it should just filter out and only show me the
// ones that I have on that date". The seven chips on each exercise are still
// the control that changes the arrangement; the strip only reads it.

import { esc, fmtDate, round, fmtDateNum, todayIso, num } from '../util.js';
import { state, update, maxLoad, loadSeries, lastEntry } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, PROGRAM_SOURCE, GYM_SOURCE, THERABAND, BAND_BY_ID, DAYS, DAY_NAME, dayKeyOf } from '../../data/program.js';
import { exerciseById, openPicture, thumb, prescriptionLine, loadBars, goButton } from '../components.js';
import { minutesFor, fmtMins, fmtDayTotal } from '../timing.js';
import { runsFor } from '../logging.js';
import { recordScheduleVersion } from '../planstreak.js';
import { renderHistory, bindHistory } from './exhistory.js';
import { startExercise } from '../player/player.js';
import { growIn, foldAway, insertBody } from '../fold.js';
import { liteMotion } from '../motion.js';

// The week matrix only shows in a container 760px wide or more (styles.css);
// narrower, it is not built at all (Fable B9: 25 rows of 7 buttons each, drawn
// for nothing on a phone). A resize across the line repaints the page.
const MATRIX_MIN = 760;
const viewWidth = () => document.getElementById('view')?.getBoundingClientRect().width || window.innerWidth;
let matrixBuilt = null;
let lastRerender = null;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (matrixBuilt === null || !lastRerender || !document.querySelector('.program-page')) return;
    if ((viewWidth() >= MATRIX_MIN) !== matrixBuilt) lastRerender();
  });
}

const ALL_ITEMS = REHAB_PROGRAM.concat(GYM_PROGRAM);

function daysOf(pid) {
  const d = state.data.program.days?.[pid];
  return Array.isArray(d) ? d : null;            // null = every day (never set)
}
function onDay(pid, key) {
  const d = daysOf(pid);
  return d === null || d.includes(key);
}
function rowMinutes(item, ex = exerciseById(item.ex)) {
  const last = ex?.cardio ? num(lastEntry(item.ex, 'B')?.time) : null;
  return minutesFor(item, ex, state.data, last, runsFor(state.data, state.rev, item.id));
}

export function renderProgram(ctx) {
  const filter = DAY_NAME[ctx.pday] ? ctx.pday : null;
  const todayKey = dayKeyOf(todayIso());
  const rehab = filter ? REHAB_PROGRAM.filter((p) => onDay(p.id, filter)) : REHAB_PROGRAM;
  const gym = filter ? GYM_PROGRAM.filter((p) => onDay(p.id, filter)) : GYM_PROGRAM;
  const sumMins = (list) => fmtDayTotal(list.map((p) => rowMinutes(p)));
  const src = PROGRAM_SOURCE;

  return `
  <div class="stack today program-page">
    <header class="pagehead">
      <h1>My Program</h1>
      <div class="lede">${esc(src.clinician)}${src.updated ? ` · updated ${esc(fmtDate(src.updated))}` : ''}</div>
      ${src.videos ? `<div class="prog-source">${esc(src.title)} · videos at <strong>${esc(src.videos)}</strong>${src.code ? ' · access code in Settings' : ''}</div>` : ''}
    </header>

    ${(matrixBuilt = viewWidth() >= MATRIX_MIN) ? scheduleMatrix(todayKey) : ''}

    <section class="card prog-days-card">
      <div class="card-body tight">
        <div class="dayfilter" role="group" aria-label="Show a day">
          <button class="${filter ? '' : 'on'}" data-pfilter="" title="Every exercise">
            <span class="fd">All</span><span class="fn">${ALL_ITEMS.length}</span></button>
          ${DAYS.map(([k, name]) => {
            const n = ALL_ITEMS.filter((p) => onDay(p.id, k)).length;
            return `<button class="${filter === k ? 'on' : ''} ${k === todayKey ? 'today' : ''}" data-pfilter="${k}"
              title="${esc(name)}" aria-pressed="${filter === k}">
              <span class="fd">${esc(name.slice(0, 3))}</span><span class="fn">${n || '·'}</span></button>`;
          }).join('')}
        </div>
        <div class="prog-filterline">${filter
          ? `${esc(DAY_NAME[filter])}: ${rehab.length + gym.length} exercise${rehab.length + gym.length === 1 ? '' : 's'}, ${esc(sumMins(rehab.concat(gym)))}. Clinic days drop to the tendon loading and balance work.`
          : 'Tap a day to see what is planned. Tap the days on any exercise to change them; what you set is kept.'}</div>
      </div>
    </section>

    <section class="card listcard">
      <header class="sectionhead">
        <div><h2>Rehab</h2>
          <div class="sectionhead-sub">${rehab.length} exercise${rehab.length === 1 ? '' : 's'} · ${esc(sumMins(rehab))}</div></div>
      </header>
      <div class="checklist">
        ${rehab.length ? rehab.map((p) => progRow(p, ctx)).join('') : `<div class="empty">Nothing from the program on a ${esc(DAY_NAME[filter])}.</div>`}
      </div>
    </section>

    <section class="card listcard">
      <header class="sectionhead">
        <div><h2>Gym</h2>
          <div class="sectionhead-sub">${esc(GYM_SOURCE)}</div></div>
      </header>
      <div class="checklist">
        ${gym.length ? gym.map((p) => progRow(p, ctx)).join('') : `<div class="empty">Nothing at the gym on a ${esc(DAY_NAME[filter])}.</div>`}
      </div>
    </section>
  </div>`;
}

/**
 * The week as a matrix, for a screen wide enough to read it (2026-09-14 ring
 * design, audit item 18): every exercise by its full name down the side, the
 * seven days across. A cell is the same toggle as the chips on a row, through
 * the same change: the arrangement is edited, and a dated schedule version is
 * written from today, so no earlier day's plan is rewritten.
 */
function scheduleMatrix(todayKey) {
  const col = (k) => ALL_ITEMS.filter((p) => onDay(p.id, k));
  const group = (title, list) => `
    <tr class="mx-group"><th colspan="8" scope="colgroup">${esc(title)}</th></tr>
    ${list.map((p) => {
      const name = p.title || exerciseById(p.ex)?.name || p.ex;
      return `<tr>
        <th scope="row" class="mx-name">${esc(name)}${p.notYet ? ' <span class="mx-note">not yet</span>' : ''}</th>
        ${DAYS.map(([k, dname]) => {
          const on = onDay(p.id, k);
          return `<td class="${k === todayKey ? 'today' : ''}"><button class="mx-cell ${on ? 'on' : ''}" data-pday="${esc(p.id)}" data-day="${k}"
            aria-pressed="${on}" aria-label="${esc(name)} on ${esc(dname)}">${on ? CHECK : ''}</button></td>`;
        }).join('')}
      </tr>`;
    }).join('')}`;
  return `
  <section class="card matrix">
    <header class="sectionhead"><div><h2>Week</h2>
      <div class="sectionhead-sub">A change applies from today. Earlier days keep the plan they had.</div></div></header>
    <div class="mx-scroll">
      <table class="mx">
        <thead><tr><th scope="col" class="mx-name">Exercise</th>
          ${DAYS.map(([k, name]) => `<th scope="col" class="${k === todayKey ? 'today' : ''}">${esc(name.slice(0, 3))}</th>`).join('')}</tr></thead>
        <tbody>
          ${group('Rehab', REHAB_PROGRAM)}
          ${group('Gym', GYM_PROGRAM)}
        </tbody>
        <tfoot><tr><th scope="row" class="mx-name">Planned</th>
          ${DAYS.map(([k]) => {
            const list = col(k);
            return `<td class="${k === todayKey ? 'today' : ''}"><b>${list.length}</b><span>${esc(fmtDayTotal(list.map((p) => rowMinutes(p))).replace(/^about /, ''))}</span></td>`;
          }).join('')}</tr></tfoot>
      </table>
    </div>
  </section>`;
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/** Seven toggles. Always all seven, on or off; the control never changes shape. */
function dayChips(pid) {
  const days = daysOf(pid);
  return `<span class="daychips" role="group" aria-label="Days of the week">
    ${DAYS.map(([k, name, letter]) => `<button class="daychip ${days === null || days.includes(k) ? 'on' : ''}"
      data-pday="${esc(pid)}" data-day="${k}" title="${esc(name)}" aria-pressed="${days === null || days.includes(k)}">${letter}</button>`).join('')}
  </span>
  ${days === null ? '<span class="tiny muted">every day</span>' : days.length === 0 ? '<span class="tiny muted">not planned</span>' : ''}`;
}

function progRow(p, ctx) {
  const ex = exerciseById(p.ex);
  const open = ctx.popen === p.id;
  const band = state.data.program.band[p.id] ?? p.band ?? '';
  const m = rowMinutes(p, ex);
  const own = num(state.data.program.mins?.[p.id]);
  const name = p.title || ex?.name || p.ex;
  const isGym = GYM_PROGRAM.includes(p);
  const usesBand = ex?.usesBand;
  const stage = state.data.program.stage[p.id] || 0;

  const flags = [];
  if (p.first) flags.push(`<span class="accent">first thing, then ${esc(p.gap || '')} before the rest</span>`);
  if (p.notYet) flags.push('<span style="color:var(--warn)">not yet</span>');
  if (p.typed) flags.push('<span title="From your typed list, not the PhysiApp program">typed list</span>');

  return `
  <div class="prog-row ${open ? 'open' : ''} ${p.notYet ? 'not-yet' : ''}">
    <div class="prog-head">
      <span class="prog-n">${p.n ?? ''}</span>
      ${p.thumb
        ? `<button class="prog-shot" data-bigpic="${esc(p.id)}" title="Show it bigger"><img src="${esc(p.thumb)}" alt="" decoding="async"></button>`
        : `<span class="prog-shot plain">${thumb(p.ex, 43)}</span>`}
      <button class="prog-main" data-popen="${esc(p.id)}" aria-expanded="${open}" aria-controls="pbody-${esc(p.id)}">
        <span class="prog-title">${esc(name)}</span>
        <span class="prog-sub">${[prescriptionLine(p, band), m.mins == null ? 'target not specified' : `${m.mins} min${m.src === 'yours' ? ' (yours)' : m.src === 'learned' ? ' (usual)' : ''}`].concat(flags)
          .filter(Boolean).join('<span class="dot">·</span>')}${ex?.aka ? `<span class="muted"><em>${esc(ex.aka)}</em></span>` : ''}</span>
        <span class="prog-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></svg></span>
      </button>
      <div class="prog-days">${dayChips(p.id)}</div>
    </div>
    ${open ? `<div class="crow-body" id="pbody-${esc(p.id)}"><div class="crow-body-clip"><div class="prog-body">
      ${goButton({ attrs: `data-timer="${esc(p.id)}" ${p.notYet ? 'disabled' : ''}`, label: 'Begin', cls: 'row-begin' })}
      ${renderHistory(state.data, p, todayIso())}
      ${p.notYet ? `<div class="notice" style="margin-bottom:.5rem">${esc(p.notYetNote)}</div>` : ''}
      ${p.pre ? `<div class="small" style="margin-bottom:.4rem"><strong>Before this:</strong> ${esc(p.pre)}</div>` : ''}
      ${p.note ? `<div class="small muted" style="margin-bottom:.4rem">${esc(p.note)}</div>` : ''}
      ${p.notes?.length ? `<div class="callout small" style="margin-bottom:.5rem">${p.notes.map(esc).join('<br>')}</div>` : ''}
      ${p.photoNote ? `<div class="tiny muted" style="margin-bottom:.4rem">${esc(p.photoNote)}</div>` : ''}
      ${p.steps?.length ? `<div class="section-title">How to do it</div>
        <ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
      ${p.goal ? `<div class="tiny muted" style="margin-top:.4rem">Goal: ${esc(p.goal)}</div>` : ''}

      <div class="row" style="gap:.7rem;align-items:flex-end;margin-top:.7rem">
        <label class="fld minsfld" title="Minutes this takes you. Leave it empty to use the estimate.">Minutes
          <input type="number" class="in-num" min="0" step="1" data-mins="${esc(p.id)}" placeholder="${m.src !== 'yours' && m.mins != null ? m.mins : ''}" value="${own ?? ''}"></label>
        <span class="tiny muted" style="flex:1;min-width:140px">${own != null
          ? 'Your number. Clear the box to go back to the estimate.'
          : 'Estimated from the prescription. Type your own if it is wrong.'}</span>
        ${usesBand ? `<label class="fld" style="width:120px">Theraband
          <select data-pband="${esc(p.id)}" class="sel-sm" style="width:100%">
            <option value="">none</option>
            ${THERABAND.map((b) => `<option value="${b.id}" ${band === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select></label>` : ''}
      </div>
      ${p.band && band !== p.band ? `<div class="tiny muted" style="margin-top:.25rem">Prescribed: ${esc(BAND_BY_ID[p.band]?.name || p.band)} band</div>` : ''}

      ${p.progressions?.length ? `
        <div style="margin-top:.7rem">
          <div class="section-title">Where you are</div>
          <div class="stagebar">
            ${['Base'].concat(p.progressions).map((label, i) => `
              <button class="stagestep ${i === stage ? 'on' : ''} ${i < stage ? 'past' : ''}"
                data-pstage="${esc(p.id)}" data-i="${i}">${esc(label)}</button>`).join('')}
          </div>
        </div>` : ''}

      ${isGym ? gymBoards(p, ex) : ''}
    </div></div></div>` : ''}
  </div>`;
}

function closeProgRow(row, pid, ctx, clear = true) {
  const body = row.querySelector(':scope > .crow-body');
  row.querySelector(`[data-popen="${CSS.escape(pid)}"]`)?.setAttribute('aria-expanded', 'false');
  if (clear && ctx.popen === pid) ctx.popen = null;
  if (!body) { row.classList.remove('open'); return; }
  if (!liteMotion()) row.classList.add('closing');
  foldAway(body, 240, () => { body.remove(); row.classList.remove('open', 'closing'); });
}

/** Working resistance for a gym lift: heaviest ever per side, and the last twelve sessions. */
function gymBoards(item, ex) {
  const unit = state.data.settings.weightUnit;
  const cardio = !!ex?.cardio;
  const field = cardio ? 'resistance' : 'load';
  const sides = item.sides === 'each' ? ['L', 'R'] : ['B'];
  return `
  <div style="margin-top:.7rem">
    <div class="section-title">Working resistance</div>
    <div class="boards">
      ${sides.map((s) => {
        const key = s === 'B' ? null : s;
        const mx = maxLoad(item.ex, key, field);
        const series = loadSeries(item.ex, key, 12, field);
        const last = series.length ? series[series.length - 1] : null;
        return `<div class="board">
          <div class="row between" style="gap:.4rem">
            <span class="sidetag ${s}">${cardio ? 'best level' : s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'both legs'}</span>
            <span class="mono board-max">${mx ? (cardio ? `L${round(mx.load, 0)}` : `${round(mx.load, 2)} ${esc(mx.loadUnit || unit)}`) : '·'}</span>
          </div>
          ${loadBars(series, 34)}
          <div class="tiny muted">${last
            ? cardio
              ? `last ${esc(fmtDateNum(last.date))} · level ${round(last.load, 0)}${last.time ? ` · ${round(last.time, 0)} min` : ''}${last.calories ? ` · ${last.calories} cal` : ''}`
              : `last ${esc(fmtDateNum(last.date))} · ${round(last.load, 2)} ${esc(last.unit)}${last.sets ? ` · ${last.sets} × ${last.reps ?? '?'}` : ''}`
            : 'nothing logged yet'}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="tiny muted" style="margin-top:.4rem">The big number is your heaviest ever on that side. Bars are your top load in each of the last twelve sessions, oldest on the left. Log loads on Today and these move on their own.</div>
  </div>`;
}

export function bindProgram(root, ctx, rerender) {
  lastRerender = rerender;
  bindHistory(root);
  root.querySelectorAll('[data-timer]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    startExercise(ctx, b.dataset.timer, todayIso());
  }));
  root.querySelectorAll('[data-pfilter]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.pfilter;
    ctx.pday = (!k || ctx.pday === k) ? null : k;
    rerender();
  }));
  root.querySelectorAll('[data-popen]').forEach((h) => h.addEventListener('click', (e) => {
    // The day chips and the picture inside the head are their own controls.
    if (e.target.closest('[data-pday], [data-bigpic]')) return;
    // Open and close in place, like Today's rows (Fable B9).
    const pid = h.dataset.popen;
    const row = h.closest('.prog-row');
    const page = h.closest('.program-page') || document;
    if (ctx.popen === pid && row?.querySelector(':scope > .crow-body')) { closeProgRow(row, pid, ctx); return; }
    const was = ctx.popen;
    const other = was && was !== pid ? page.querySelector(`[data-popen="${CSS.escape(was)}"]`)?.closest('.prog-row') : null;
    ctx.popen = pid;
    const item = ALL_ITEMS.find((p) => p.id === pid);
    const body = row && item && insertBody(row, progRow(item, ctx), '.crow-body');
    if (!body) { rerender(); return; }
    bindProgram(body, ctx, rerender);
    if (!liteMotion()) {
      row.classList.add('just-open');
      setTimeout(() => row.classList.remove('just-open'), 320);
    }
    growIn(body, 280);
    if (other) closeProgRow(other, was, ctx, false);
  }));
  root.querySelectorAll('[data-bigpic]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicture(b.dataset.bigpic);
  }));
  root.querySelectorAll('[data-pband]').forEach((sel) => sel.addEventListener('change', () => {
    update((d) => { d.program.band[sel.dataset.pband] = sel.value; });
    rerender();
  }));
  root.querySelectorAll('[data-pday]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const pid = b.dataset.pday;
    const day = b.dataset.day;
    update((d) => {
      d.program.days = d.program.days || {};
      // "Every day" (never set) becomes an explicit seven, then the tap applies.
      const cur = Array.isArray(d.program.days[pid]) ? d.program.days[pid].slice() : DAYS.map((x) => x[0]);
      d.program.days[pid] = cur.includes(day) ? cur.filter((x) => x !== day) : cur.concat(day);
      // The change applies from today; earlier days keep the plan they had.
      recordScheduleVersion(d, todayIso());
    });
    rerender();
  }));
  root.querySelectorAll('[data-pstage]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    update((d) => { d.program.stage[b.dataset.pstage] = i; });
    rerender();
  }));
  root.querySelectorAll('[data-mins]').forEach((inp) => inp.addEventListener('change', () => {
    const pid = inp.dataset.mins;
    update((d) => {
      d.program.mins = d.program.mins || {};
      const v = num(inp.value);
      if (v == null || v < 0) delete d.program.mins[pid]; else d.program.mins[pid] = Math.round(v);
    });
    rerender();
  }));
}
