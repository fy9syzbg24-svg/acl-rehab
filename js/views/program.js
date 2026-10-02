// The clinician program: pictures, prescriptions, the days each exercise is
// planned for, and behind a tap the written steps, progressions, band and
// the minutes it takes. One list, filtered by day.
//
// Tapping a day in the strip filters the list to that day. His words: "if I
// click on one of the dates, it should just filter out and only show me the
// ones that I have on that date". The seven chips on each exercise are still
// the control that changes the arrangement; the strip only reads it.

import { esc, fmtDate, round, fmtDateShort, todayIso, num, durWords } from '../util.js';
import { state, update, maxLoad, loadSeries, lastEntry, lastCardioMinutes } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, PROGRAM_SOURCE, GYM_SOURCE, THERABAND, BAND_BY_ID, DAYS, DAY_NAME, dayKeyOf } from '../../data/program.js';
import { exerciseById, openPicture, pictureFor, thumb, prescriptionLine, loadBars, goButton } from '../components.js';
import { minutesFor, fmtMins, fmtDayTotal } from '../timing.js';
import { runsFor } from '../logging.js';
import { recordScheduleVersion } from '../planstreak.js';
import { renderHistory, bindHistory } from './exhistory.js';
import { startExercise } from '../player/player.js';
import * as A from '../player/audio.js';
import { speakOn } from '../feedback.js';
import { growIn, foldAway, insertBody } from '../fold.js';
import { liteMotion } from '../motion.js';
import { bandPicker, bandMark, nameWithMarks } from '../ptmark.js';
import { frameHtml } from '../frames.js';
import { stepsFor, stepHtml, stageOf } from '../progressions.js';
import { glide } from '../glide.js';

// The week matrix only shows in a container 760px wide or more (styles.css);
// narrower, it is not built at all (Fable B9: 25 rows of 7 buttons each, drawn
// for nothing on a phone). A resize across the line repaints the page.
//
// The IPAD (wide AND tall, so never an iPhone held sideways) has no separate matrix card: the
// list IS the week matrix. Each row carries its seven days in columns at its trailing end, and
// the day strip above sits over the same seven columns (rt-plan.css `.pr-wide`). Decided in
// script because the rows are built differently, so a rotation or a Split View resize that flips
// it repaints.
const MATRIX_MIN = 760;
const WIDE_MIN = 620;
const viewWidth = () => document.getElementById('view')?.getBoundingClientRect().width || window.innerWidth;
const progWide = () => {
  try { return matchMedia('(min-width: 700px) and (min-height: 560px)').matches && viewWidth() - 32 >= WIDE_MIN; } catch { return false; }
};
const layoutSig = () => `${progWide() ? 'w' : ''}${!progWide() && viewWidth() >= MATRIX_MIN ? 'm' : ''}`;
let matrixBuilt = null;
let lastRerender = null;
let dayTap = false;   // a tap on the day filter, read by the paint it asks for (B5-4)
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    if (matrixBuilt === null || !lastRerender || !document.querySelector('.program-page')) return;
    if (layoutSig() !== matrixBuilt) lastRerender();
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
  const last = ex?.cardio ? lastCardioMinutes(item.ex) : null;
  return minutesFor(item, ex, state.data, last, runsFor(state.data, state.rev, item.id));
}

export function renderProgram(ctx) {
  const filter = DAY_NAME[ctx.pday] ? ctx.pday : null;
  const todayKey = dayKeyOf(todayIso());
  const rehab = filter ? REHAB_PROGRAM.filter((p) => onDay(p.id, filter)) : REHAB_PROGRAM;
  const gym = filter ? GYM_PROGRAM.filter((p) => onDay(p.id, filter)) : GYM_PROGRAM;
  const sumMins = (list) => fmtDayTotal(list.map((p) => rowMinutes(p)));
  const src = PROGRAM_SOURCE;

  // Rehab Test v3 (2026-09-30, audit PR1 to PR5): compact. The day filter is one strip; a
  // chosen day says its count and minutes as a fact, no helper sentence; rows lead with ONE
  // frame of the exercise, big (his view: the picture beats the name), full titles, no list
  // numbers; the days each exercise is planned read as seven small pips, and the toggles appear
  // only in Edit (he sets the program "every month or two"). The website and access code line
  // is gone from the page (the access code already lives in Settings).
  const edit = !!ctx.pedit;
  const dayMins = Object.fromEntries(DAYS.map(([k]) => [k, ALL_ITEMS.filter((p) => onDay(p.id, k))
    .reduce((a, p) => a + (rowMinutes(p).mins || 0), 0)]));
  const maxMins = Math.max(1, ...Object.values(dayMins));
  const wide = progWide();
  matrixBuilt = layoutSig();
  return `
  <div class="stack today program-page pr3 ${edit ? 'editing' : ''}${wide ? ' pr-wide' : ''}">
    <header class="pagehead">
      <h1>My Program</h1>
      <div class="pr-ledeRow"><div class="lede">${esc(src.clinician)}${src.updated ? ` · updated ${esc(shortDay(src.updated))}` : ''}</div>
        <button type="button" class="pr-edit" data-pedit aria-pressed="${edit}">${edit ? 'Done' : 'Edit days'}</button></div>
    </header>

    ${!wide && viewWidth() >= MATRIX_MIN ? scheduleMatrix(todayKey) : ''}

    <section class="pr-days">
      <div class="dayfilter" role="group" aria-label="Show a day">
        <button class="${filter ? '' : 'on'}" data-pfilter="" aria-pressed="${!filter}" aria-label="Every exercise, ${ALL_ITEMS.length}">
          <span class="fd">All</span><span class="fn">${ALL_ITEMS.length}</span></button>
        ${DAYS.map(([k, name]) => {
          const list = ALL_ITEMS.filter((p) => onDay(p.id, k));
          const n = list.length;
          const mins = dayMins[k];
          // Round 3: each day carries a small bar of its planned minutes, so the heavy days read
          // at a glance (the week as a tiny histogram); the minutes are in the accessible name.
          return `<button class="${filter === k ? 'on' : ''} ${k === todayKey ? 'today' : ''}" data-pfilter="${k}"
            aria-label="${esc(name)}, ${n} exercise${n === 1 ? '' : 's'}${mins ? `, about ${mins} minutes` : ''}" aria-pressed="${filter === k}">
            <span class="fd">${esc(name.slice(0, 1))}</span><span class="fn">${n || '·'}</span>
            <i class="pr-mbar" aria-hidden="true"><i style="--h:${(mins / maxMins).toFixed(3)}"></i></i></button>`;
        }).join('')}
      </div>
      ${/* A picked day says its name and total time once, on one line: the count is on the chip
        above and each section's untimed items on its heading (fix d-progress:d31). With no day
        picked the line is gone (round 3: "Every day" there misread as a schedule). */ ''}
      ${filter ? `<div class="pr-dayline">
        <b>${esc(DAY_NAME[filter])}</b><span>${esc(sumMins(rehab.concat(gym)).replace(/\s*\+\s*\d+\s*untimed$/, ''))}</span></div>` : ''}
    </section>

    <section class="pr-sec">
      <div class="pr-head"><h2>Rehab</h2><span>${rehab.length} · ${esc(sumMins(rehab))}</span></div>
      <div class="pr-list">
        ${rehab.length ? rehab.map((p) => progRow(p, ctx, wide)).join('') : `<div class="empty">Nothing from the program on a ${esc(DAY_NAME[filter])}.</div>`}
      </div>
    </section>

    <section class="pr-sec">
      <div class="pr-head"><h2>Gym</h2><span>${esc(GYM_SOURCE)}</span></div>
      <div class="pr-list">
        ${gym.length ? gym.map((p) => progRow(p, ctx, wide)).join('') : `<div class="empty">Nothing at the gym on a ${esc(DAY_NAME[filter])}.</div>`}
      </div>
    </section>
  </div>`;
}

/** "Aug 5", the year only when it is not this year (C30). */
function shortDay(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

/** The prescription as plain words (the band is the loop beside the title, not a second swatch). */
function prescText(p) {
  const bits = [];
  if (p.sets && p.reps) bits.push(`${p.sets} × ${p.reps}${p.sides === 'each' ? ' each side' : p.sides === 'left' ? ', left leg' : p.sides === 'right' ? ', right leg' : ''}`);
  else if (p.reps) bits.push(`${p.reps} rep${p.reps === 1 ? '' : 's'}`);
  else if (p.sets) bits.push(`${p.sets} set${p.sets === 1 ? '' : 's'}`);
  if (p.hold) bits.push(`hold ${durWords(p.hold)}`);
  if (p.rest) bits.push(`rest ${durWords(p.rest)}`);
  return bits.map(esc).join(' · ');
}

/**
 * The days an exercise is planned for, read only: seven dots under its picture (Monday first),
 * the planned ones filled, today's slot ringed turquoise. Round 3: they sat on a line of their
 * own under every row; under the picture they cost no height. Hidden while a day is picked (the
 * filter already says it) and in Edit (the toggles replace them). The days in words for VoiceOver.
 */
function dayPips(pid, exName) {
  const days = daysOf(pid);
  const on = (k) => days === null || days.includes(k);
  const words = days === null ? 'every day' : days.length === 0 ? 'not planned' : DAYS.filter(([k]) => on(k)).map(([, n]) => n).join(', ');
  const t = dayKeyOf(todayIso());
  return `<span class="pr-pips pr-dots" role="img" aria-label="${esc(exName)}: ${esc(words)}">${DAYS.map(([k]) => `<i class="${on(k) ? 'on' : ''} ${k === t ? 'today' : ''}"></i>`).join('')}</span>`;
}

/**
 * The week as a matrix, for a screen wide enough to read it (2026-09-14 ring
 * design, audit item 18): every exercise by its full name down the side, the
 * seven days across. A cell is the same toggle as the chips on a row, through
 * the same change: the arrangement is edited, and a dated schedule version is
 * written from today, so no earlier day's plan is rewritten.
 */
// His ask, 2026-09-20: "this week tab can collapse I don't need to see that
// grid all the time." Shut by default, and the choice is remembered on this
// device: an open grid is for the day he rearranges his week, not every visit.
const MX_KEY = 'rehab.mxopen';
const mxOpen = () => { try { return localStorage.getItem(MX_KEY) === '1'; } catch { return false; } };
const setMxOpen = (v) => { try { localStorage.setItem(MX_KEY, v ? '1' : '0'); } catch { /* per device */ } };

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
  const open = mxOpen();
  const planned = DAYS.filter(([k]) => col(k).length).length;
  return `
  <details class="card matrix" data-key="mx" ${open ? 'open' : ''}>
    <summary class="sectionhead mx-sum">
      <div><h2>Week</h2>
      <div class="sectionhead-sub mx-shut">Something planned on ${planned} of the 7 days. Open to rearrange them.</div>
      <div class="sectionhead-sub mx-open">A change applies from today. Earlier days keep the plan they had.</div></div>
      <svg class="mx-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </summary>
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
  </details>`;
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/**
 * The iPad's week: one exercise's seven days as columns at the end of its row, under the day strip
 * (same seven columns). Read only as a dot (planned = filled, today's column in turquoise, the
 * picked day's column tinted); in Edit each is a 46 pt button, the same toggle as the chips on a
 * phone (`[data-pday]`), so a change is dated from today exactly as there.
 */
function weekCells(p, exName, edit, pick) {
  const days = daysOf(p.id);
  const on = (k) => days === null || days.includes(k);
  const t = dayKeyOf(todayIso());
  const cls = (k) => `wkc ${on(k) ? 'on' : ''} ${k === t ? 'today' : ''} ${k === pick ? 'pick' : ''}`;
  if (edit) {
    return `<span class="pr-wk edit" role="group" aria-label="${esc(`Days for ${exName}`)}">${DAYS.map(([k, name]) =>
      `<button type="button" class="${cls(k)}" data-pday="${esc(p.id)}" data-day="${k}" title="${esc(name)}" aria-label="${esc(`${exName} on ${name}`)}" aria-pressed="${on(k)}"><i></i></button>`).join('')}</span>`;
  }
  const words = days === null ? 'every day' : days.length === 0 ? 'not planned' : DAYS.filter(([k]) => on(k)).map(([, n]) => n).join(', ');
  return `<span class="pr-wk" role="img" aria-label="${esc(`${exName}: ${words}`)}">${DAYS.map(([k]) => `<span class="${cls(k)}"><i></i></span>`).join('')}</span>`;
}

/** Seven toggles. Always all seven, on or off; the control never changes shape. */
function dayChips(pid, exName = '') {
  const days = daysOf(pid);
  // The letters stay short on screen; each is named in full for VoiceOver,
  // with the exercise (Codex audit A02): "Bridges on Tuesday", not "T".
  return `<span class="daychips" role="group" aria-label="${esc(exName ? `Days for ${exName}` : 'Days of the week')}">
    ${DAYS.map(([k, name, letter]) => `<button class="daychip ${days === null || days.includes(k) ? 'on' : ''}"
      data-pday="${esc(pid)}" data-day="${k}" title="${esc(name)}" aria-label="${esc(exName ? `${exName} on ${name}` : name)}" aria-pressed="${days === null || days.includes(k)}">${letter}</button>`).join('')}
  </span>`;
  // The seven chips already say every day or none; the words under them sat alone on a line (d31).
}

function progRow(p, ctx, wide = false) {
  const ex = exerciseById(p.ex);
  const open = ctx.popen === p.id;
  const band = state.data.program.band[p.id] ?? p.band ?? '';
  const m = rowMinutes(p, ex);
  const own = num(state.data.program.mins?.[p.id]);
  const name = p.title || ex?.name || p.ex;
  const isGym = GYM_PROGRAM.includes(p);
  const usesBand = ex?.usesBand;

  const flags = [];
  if (p.first) flags.push(`<span class="accent">first thing, then ${esc(p.gap || '')} before the rest</span>`);
  if (p.notYet) flags.push('<span style="color:var(--warn)">not yet</span>');
  // Fix d-progress:d31: "typed list" was the app's own bookkeeping word, not a prescription (and it
  // was the whole line on a row with no prescription). The source stays in the data.

  return `
  <div class="prog-row pr-row ${open ? 'open' : ''} ${p.notYet ? 'not-yet' : ''}">
    <div class="prog-head">
      ${p.img || p.thumb
        ? `<button class="pr-shot" data-bigpic="${esc(p.id)}" aria-label="Show every step of ${esc(name)}">${frameHtml(p.img || p.thumb, { size: wide ? 88 : 64, radius: wide ? 18 : 14 })}</button>`
        : pictureFor(p.ex)?.img ? `<span class="pr-shot">${frameHtml(pictureFor(p.ex).img, { size: wide ? 88 : 64, radius: wide ? 18 : 14 })}</span>`
        : `<span class="pr-shot plain">${thumb(p.ex, wide ? 48 : 36)}</span>`}
      ${wide || ctx.pedit || DAY_NAME[ctx.pday] ? '' : dayPips(p.id, name)}
      <button class="prog-main" data-popen="${esc(p.id)}" aria-expanded="${open}" aria-controls="pbody-${esc(p.id)}">
        <span class="prog-title">${nameWithMarks(name, bandMark({ band }, { planned: p.band || '', usesBand: !!usesBand }))}</span>
        <span class="prog-sub">${[prescText(p), m.mins == null ? '' : `${m.mins} min${m.src === 'yours' ? ' (yours)' : m.src === 'learned' ? ' (usual)' : ''}`].concat(flags)
          .filter(Boolean).join('<i class="pr-sep"> · </i>')}${ex?.aka ? ` <em class="pr-aka">${esc(ex.aka)}</em>` : ''}</span>
      </button>
      ${wide ? weekCells(p, name, !!ctx.pedit, DAY_NAME[ctx.pday] ? ctx.pday : '') : ctx.pedit ? `<div class="prog-days">${dayChips(p.id, name)}</div>` : ''}
    </div>
    ${open ? `<div class="crow-body" id="pbody-${esc(p.id)}"><div class="crow-body-clip"><div class="prog-body">
      ${p.notYet ? '' : goButton({ attrs: `data-timer="${esc(p.id)}"`, label: 'Begin', cls: 'row-begin' })}
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
      </div>
      ${usesBand ? `<div class="fld wide bandfld" style="margin-top:.6rem"><span>Band</span>${bandPicker({ value: band || '', attr: 'data-pband', key: p.id, label: `Band for ${p.title}` })}</div>` : ''}
      ${p.band && band !== p.band ? `<div class="tiny muted" style="margin-top:.25rem">Prescribed: ${esc(BAND_BY_ID[p.band]?.name || p.band)} band</div>` : ''}

      ${whereYouAre(p, name)}

      ${isGym ? gymBoards(p, ex) : ''}
    </div></div></div>` : ''}
  </div>`;
}

/**
 * Where you are: every step names who set it, "Hold 4 kg (Name)", and his own
 * read "(Ours)" (23 Sep, progressions.js). One line under it adds his own step,
 * after the clinicians' steps so his place never shifts. A step of his own he
 * is not on or past has a remove; once he reaches it, the remove is not drawn.
 */
function whereYouAre(p, name) {
  const steps = stepsFor(p, state.data);
  const stage = stageOf(p, state.data);
  const pill = (step, i) => `<button class="stagestep ${i === stage ? 'on' : ''} ${i < stage ? 'past' : ''}"
    data-pstage="${esc(p.id)}" data-i="${i}">${stepHtml(step)}</button>`;
  return `
    <div style="margin-top:.7rem">
      <div class="section-title">Where you are</div>
      ${steps.length ? `<div class="stagebar">
        ${[null].concat(steps).map((step, i) => (step?.own == null || stage >= i ? pill(step, i)
          : `<span class="stage-own">${pill(step, i)}<button type="button" class="stage-x" data-ownrm="${esc(p.id)}" data-k="${step.own}" aria-label="Remove your step: ${esc(step.t)}">✕</button></span>`)).join('')}
      </div>` : ''}
      <div class="stage-add">
        <input type="text" data-ownstep="${esc(p.id)}" placeholder="Add your own step" aria-label="Add your own step to ${esc(name)}" maxlength="80" autocomplete="off" enterkeyhint="done">
        <button type="button" class="btn sm primary" data-ownadd="${esc(p.id)}">Add</button>
      </div>
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
              ? `last ${esc(fmtDateShort(last.date))} · level ${round(last.load, 0)}${last.time ? ` · ${round(last.time, 0)} min` : ''}${last.calories ? ` · ${last.calories} cal` : ''}`
              : `last ${esc(fmtDateShort(last.date))} · ${round(last.load, 2)} ${esc(last.unit)}${last.sets ? ` · ${last.sets} × ${last.reps ?? '?'}` : ''}`
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
  // The Week grid remembers whether he left it open. The summary line under
  // the heading says something different shut, so a repaint follows the toggle.
  // Remembered, but never repainted on the toggle: a repaint would replace the
  // element half way through its own opening animation (fold.js).
  const mx = root.querySelector('details.matrix');
  if (mx) mx.addEventListener('toggle', () => setMxOpen(mx.open));
  // Begin here starts the exercise the same way Today's does (B1-2, B1-3): the
  // finger going down warms the sound, the tap unlocks it before the player opens.
  root.querySelectorAll('[data-timer]').forEach((b) => b.addEventListener('pointerdown', () => { A.prepareAudio(); if (speakOn()) A.loadVoice(); }, { passive: true }));
  root.querySelectorAll('[data-timer]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    A.unlockAudio();
    startExercise(ctx, b.dataset.timer, todayIso());
  }));
  root.querySelector('[data-pedit]')?.addEventListener('click', () => { ctx.pedit = !ctx.pedit; rerender(); });
  root.querySelectorAll('[data-pfilter]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.pfilter;
    const was = ctx.pday || null;
    ctx.pday = (!k || ctx.pday === k) ? null : k;
    dayTap = was !== (ctx.pday || null);
    rerender();
  }));
  // The chosen day's fill glides to the new one on a tap (B5-4).
  const days = root.querySelector('.dayfilter');
  if (days) glide(days, days.querySelector(':scope > button.on'), { key: 'program-days', cls: 'gi-fill', animate: dayTap });
  dayTap = false;
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
  // The band picker (2026-09-18): each button carries the band id; the item is its key.
  root.querySelectorAll('[data-pband]').forEach((b) => b.addEventListener('click', () => {
    update((d) => { d.program.band[b.dataset.bpkey] = b.dataset.pband; });
    rerender({ soft: true });
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
  // His own steps (23 Sep): Add, or Enter in the field, puts one after the
  // clinicians' steps, dated, through update() so it is stamped and syncs.
  // Empty or blank text does nothing.
  const addOwn = (pid) => {
    const inp = root.querySelector(`[data-ownstep="${CSS.escape(pid)}"]`);
    const t = (inp?.value || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    inp.value = '';
    inp.blur();
    update((d) => {
      const own = ((d.program ||= {}).ownSteps ||= {});
      own[pid] = (Array.isArray(own[pid]) ? own[pid] : []).concat({ t, at: todayIso() });
    });
    rerender();
  };
  root.querySelectorAll('[data-ownadd]').forEach((b) => b.addEventListener('click', () => addOwn(b.dataset.ownadd)));
  root.querySelectorAll('[data-ownstep]').forEach((inp) => inp.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    addOwn(inp.dataset.ownstep);
  }));
  // Removing one of his steps: only one he is not on or past, checked again at
  // the tap in case the page is older than his data.
  root.querySelectorAll('[data-ownrm]').forEach((b) => b.addEventListener('click', () => {
    const pid = b.dataset.ownrm;
    const k = Number(b.dataset.k);
    const item = ALL_ITEMS.find((p) => p.id === pid);
    const i = stepsFor(item, state.data).findIndex((s) => s.own === k) + 1;
    if (!item || i < 1 || stageOf(item, state.data) >= i) return;
    update((d) => {
      const list = d.program.ownSteps?.[pid];
      if (!Array.isArray(list) || !list[k]) return;
      const rest = list.filter((_, j) => j !== k);
      if (rest.length) d.program.ownSteps[pid] = rest; else delete d.program.ownSteps[pid];
    });
    rerender();
  }));
  root.querySelectorAll('[data-mins]').forEach((inp) => inp.addEventListener('change', () => {
    const pid = inp.dataset.mins;
    update((d) => {
      d.program.mins = d.program.mins || {};
      const v = num(inp.value);
      if (v == null || v < 0) delete d.program.mins[pid]; else d.program.mins[pid] = Math.round(v);   // 0 is untimed, his call
    });
    rerender();
  }));
}
