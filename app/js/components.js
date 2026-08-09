// Shared UI pieces: modal, exercise picker, measurement entry, charts.

import { esc, el, round, fromIso, fmtDate, fmtDateNum, addDays, currentDayIso } from './util.js';
import { EXERCISES, EXERCISE_BY_ID } from '../data/exercises.js';
import { CATEGORIES, MEASURES, MEASURE_BY_ID, UNIT_LABEL } from '../data/measurements.js';
import { REHAB_PROGRAM, BAND_BY_ID } from '../data/program.js';
import { ICONS, iconNameFor } from '../data/icons.js';
import { state } from './store.js';

// ------------------------------------------------------------- pictures ----
const IMG_BY_EX = {};
for (const p of REHAB_PROGRAM) {
  if (p.img && !IMG_BY_EX[p.ex]) IMG_BY_EX[p.ex] = { img: p.img, thumb: p.thumb, title: p.title, pid: p.id };
}

// Only the 16 clinician-program exercises came with photos. These other movements are close
// enough that her picture still shows the shape of it — flagged as `borrowed`
// so nothing pretends to be a photo of that exact exercise.
const BORROWED = {
  // bridges
  dl_bridge: 'pa01',
  dl_glute_bridge_chair: 'pa01',
  sl_bridge: 'pa03',
  sl_glute_bridge: 'pa03',
  // sit to stand
  sts_high: 'pa05',
  sts_low: 'pa05',
  high_sts_band: 'pa05',
  // knee extension — band, machine and terminal are the same movement
  sl_full_quad: 'pa06',
  sl_inner_quad: 'pa06',
  leg_extension: 'pa06',
  tke: 'pa08',
  slr: 'pa06',
  // calf
  sl_calf: 'pa09',
  sl_calf_foam: 'pa09',
  sl_calf_coord: 'pa09',
  seated_calf_raise: 'pa09',
  standing_calf_raise_load: 'pa09',
  weighted_calf_straight: 'pa09',
  weighted_calf_bent: 'pa09',
  dl_calf: 'pa10',
  dl_calf_raise_band: 'pa10',
  // balance
  sl_stance: 'pa11',
  sl_foam: 'pa11',
  sl_stance_ec: 'pa11',
  vestib_balance: 'pa11',
  // steps
  fwd_stepdown: 'pa13',
  lat_stepdown: 'pa14',
  hip_lift_step: 'pa14',
  step_down_backward: 'pa13',
  stepup_hop: 'pa15',
  // squat
  wall_sit_adductor: 'pa16',
  dl_squat: 'pa16',
  sl_squat: 'pa08',
};
for (const [ex, pid] of Object.entries(BORROWED)) {
  if (IMG_BY_EX[ex]) continue;
  const p = REHAB_PROGRAM.find((x) => x.id === pid);
  if (p) IMG_BY_EX[ex] = { img: p.img, thumb: p.thumb, title: p.title, pid: p.id, borrowed: true };
}

// Which exercise performs each measurable test, so the record sheet can show
// the same picture you see when logging it.
const EX_FOR_MEASURE = {};
for (const e of EXERCISES) {
  if (e.measure && !EX_FOR_MEASURE[e.measure]) EX_FOR_MEASURE[e.measure] = e.id;
}
Object.assign(EX_FOR_MEASURE, {
  sl_squat_reps: 'sl_squat', sl_bridge: 'sl_bridge_band_abd', sl_calf_raise: 'sl_calf_band',
  lateral_step_up: 'lat_stepup', sl_foam_task: 'sl_foam_task', side_bridge: 'side_bridge',
  balance_eyes_open: 'sl_stance', balance_eyes_closed: 'sl_stance_ec', sebt_composite: 'sebt',
  squat_1rm: 'barbell_squat', leg_press_1rm: 'leg_press', knee_flexion: 'flexion',
  knee_extension: 'ext_prop', extension_lag: 'ext_prop', prone_hang: 'ext_prop',
  repeated_hops: 'repeated_hops', single_hop: 'sl_hop', triple_hop: 'sl_hop',
  triple_crossover_hop: 'sl_hop', side_hop: 'lateral_hops',
  show_runthrough_pct: 'partial_run', show_minutes: 'full_run',
});

export function exerciseForMeasure(measureId) {
  return EX_FOR_MEASURE[measureId] || null;
}

/** The program picture for an exercise, if one exists. */
export function pictureFor(exId) {
  return IMG_BY_EX[exId] || null;
}

/** A drawn pictogram, for exercises that never came with a photograph. */
export function iconTile(exId, size = 46) {
  const ex = EXERCISE_BY_ID[exId] || (state.data.customExercises || []).find((e) => e.id === exId);
  const cat = ex?.cat || 'strength';
  const glyph = ICONS[iconNameFor(exId, cat)];
  const colour = CATEGORIES[cat]?.color || 'var(--ink-3)';
  return `<span class="thumb icon-tile" title="${esc(ex?.name || exId)}"
    style="width:${Math.round(size * 16 / 9)}px;height:${size}px;
           color:${colour};background:color-mix(in srgb, ${colour} 12%, transparent)">
    <svg viewBox="0 0 48 48" aria-hidden="true">${glyph}</svg></span>`;
}

/** A photo where one exists, otherwise a drawn pictogram. Never blank. */
export function thumb(exId, size = 46) {
  const p = pictureFor(exId);
  if (!p) return iconTile(exId, size);
  return `<img class="thumb${p.borrowed ? ' borrowed' : ''}" src="${esc(p.thumb)}" alt="" decoding="async"
    title="${esc(p.borrowed ? 'Closest picture in your program: ' + p.title : p.title)}"
    style="width:${size * 16 / 9}px;height:${size}px" data-bigpic="${esc(p.pid)}">`;
}

/** Full-size picture in a modal, with the written steps beside it. */
export function openPicture(pid) {
  const p = REHAB_PROGRAM.find((x) => x.id === pid);
  if (!p) return;
  openModal({
    title: `${p.n}. ${p.title}`,
    wide: true,
    body: `
      <img src="${esc(p.img)}" alt="${esc(p.title)}" style="width:100%;border-radius:var(--radius-sm);display:block">
      ${p.photoNote ? `<div class="tiny muted" style="margin-top:.3rem">${esc(p.photoNote)}</div>` : ''}
      ${prescriptionPills(p)}
      <ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      ${p.notes?.length ? `<div class="callout small" style="margin-top:.6rem">${p.notes.map(esc).join('<br>')}</div>` : ''}
      ${p.progressions?.length ? `<div style="margin-top:.7rem"><div class="section-title">Progressions</div>
        <ol class="steps">${p.progressions.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}`,
  });
}

export function prescriptionPills(p) {
  const bits = [];
  if (p.sets) bits.push(`${p.sets} sets`);
  if (p.reps) bits.push(`${p.reps} reps`);
  if (p.hold) bits.push(`hold ${p.hold}`);
  if (p.sides === 'each') bits.push('each side');
  if (p.sides === 'left') bits.push('left side only');
  if (p.goal) bits.push(`goal: ${p.goal}`);
  const band = p.band ? BAND_BY_ID[p.band] : null;
  return `<div class="row" style="gap:.3rem;margin:.55rem 0 .4rem">
    ${bits.map((b) => `<span class="pill">${esc(b)}</span>`).join('')}
    ${band ? `<span class="pill"><i class="swatch" style="background:${band.swatch}"></i>${esc(band.name)} band</span>` : ''}
  </div>`;
}

/** Small bar chart of top load per session. */
export function loadBars(series, height = 30) {
  if (!series.length) return `<div class="bars empty-bars" style="height:${height}px"></div>`;
  const max = Math.max(...series.map((s) => s.load));
  return `<div class="bars" style="height:${height}px">${series.map((s, i) => {
    const h = Math.max(3, Math.round((s.load / max) * height));
    const top = i === series.length - 1;
    return `<i style="height:${h}px" class="${top ? 'now' : ''}"
      title="${esc(fmtDateNum(s.date))} — ${round(s.load, 2)} ${esc(s.unit)}"></i>`;
  }).join('')}</div>`;
}

// ----------------------------------------------------------------- toast ---
/** A small self-dismissing notice, bottom-right. For good news, mostly. */
export function toast(html, kind = 'good') {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  const t = el(`<div class="toast ${kind}">${html}</div>`);
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 350);
  }, 4200);
}

// ----------------------------------------------------------------- modal ---
export function openModal({ title, body, footer, wide = false, onMount }) {
  closeModal();
  const back = el(`
    <div class="modal-back">
      <div class="modal" style="${wide ? 'width:min(880px,100%)' : ''}">
        <header><h2>${esc(title)}</h2><button class="icon-btn" data-close>✕</button></header>
        <div class="mbody"></div>
        ${footer ? '<footer></footer>' : ''}
      </div>
    </div>`);
  back.querySelector('.mbody').innerHTML = body;
  if (footer) back.querySelector('footer').innerHTML = footer;
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) closeModal();
  });
  document.getElementById('modal-root').appendChild(back);
  document.addEventListener('keydown', escClose);
  if (onMount) onMount(back);
  return back;
}

function escClose(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.removeEventListener('keydown', escClose);
}

// -------------------------------------------------------- exercise picker --
export function allExercises() {
  return EXERCISES.concat(state.data.customExercises || []);
}

export function exerciseById(id) {
  return EXERCISE_BY_ID[id] || (state.data.customExercises || []).find((e) => e.id === id) || null;
}

/**
 * Exercise picker. `monthN` puts this month's exercises at the top.
 * onPick(exercise, side) where side is 'L' | 'R' | 'B'.
 */
export function openExercisePicker({ monthN, onPick }) {
  const render = (q, showAll) => {
    const list = allExercises().filter((x) => {
      if (q && !x.name.toLowerCase().includes(q.toLowerCase())) return false;
      if (!showAll && !q && monthN && x.months && !x.months.includes(monthN)) return false;
      return true;
    });
    const byCat = {};
    for (const x of list) (byCat[x.cat] ||= []).push(x);
    if (!list.length) return '<div class="empty">Nothing matched.</div>';
    return Object.entries(byCat)
      .map(([cat, xs]) => `
        <div class="picker-group">${esc(CATEGORIES[cat]?.label || cat)}</div>
        ${xs.map((x) => `
          <div class="picker-item" data-ex="${esc(x.id)}">
            ${thumb(x.id, 34)}
            <span style="flex:1">${esc(x.name)}${x.clinic ? ' <span class="pill">clinic</span>' : ''}</span>
            <span class="row" style="gap:.2rem">
              <button class="btn sm" data-side="L" data-ex="${esc(x.id)}">L</button>
              <button class="btn sm" data-side="R" data-ex="${esc(x.id)}">R</button>
              <button class="btn sm" data-side="B" data-ex="${esc(x.id)}">Both</button>
            </span>
          </div>`).join('')}
      `).join('');
  };

  openModal({
    title: 'Add exercise',
    body: `
      <div class="row" style="margin-bottom:.6rem">
        <input id="pk-q" placeholder="Search exercises…" autocomplete="off" style="flex:1">
        <label class="row tiny" style="gap:.3rem;white-space:nowrap">
          <input type="checkbox" id="pk-all"> show all months
        </label>
      </div>
      <div id="pk-list" class="picker-list">${render('', false)}</div>
      <div class="row" style="margin-top:.8rem;border-top:1px solid var(--line-2);padding-top:.6rem">
        <input id="pk-new" placeholder="Or type a new exercise name…" style="flex:1">
        <select id="pk-newcat" style="width:auto">
          ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}
        </select>
        <button class="btn" id="pk-add">Create</button>
      </div>`,
    onMount(root) {
      const q = root.querySelector('#pk-q');
      const all = root.querySelector('#pk-all');
      const list = root.querySelector('#pk-list');
      const redraw = () => { list.innerHTML = render(q.value.trim(), all.checked); };
      q.addEventListener('input', redraw);
      all.addEventListener('change', redraw);
      setTimeout(() => q.focus(), 30);

      list.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-side]');
        const item = e.target.closest('.picker-item');
        if (!item) return;
        const id = (btn || item).dataset.ex;
        const side = btn ? btn.dataset.side : 'B';
        const ex = exerciseById(id);
        if (ex) { closeModal(); onPick(ex, side); }
      });

      root.querySelector('#pk-add').addEventListener('click', () => {
        const name = root.querySelector('#pk-new').value.trim();
        if (!name) return;
        const cat = root.querySelector('#pk-newcat').value;
        const ex = { id: 'x_' + Math.random().toString(36).slice(2, 8), name, cat, track: 'setsreps', custom: true };
        state.data.customExercises.push(ex);
        closeModal();
        onPick(ex, 'B');
      });
    },
  });
}

// ------------------------------------------------------------ measurements --
export function unitFor(measure) {
  const m = MEASURE_BY_ID[measure];
  if (!m) return '';
  if (m.unit === 'weight') return state.data.settings.weightUnit;
  return UNIT_LABEL[m.unit] ?? '';
}

/** Modal that records one measurement (both legs at once when relevant). */
export function openMeasureEntry({ measureId, date, onSave, prefill = null, lockMeasure = false }) {
  const opts = MEASURES.map((m) => `<option value="${m.id}" ${m.id === measureId ? 'selected' : ''}>${esc(m.group)} — ${esc(m.label)}</option>`).join('');
  const build = (id) => {
    const m = MEASURE_BY_ID[id];
    if (!m) return '';
    const isGrade = m.unit === 'grade';
    const field = (leg) => {
      const lbl = leg === 'L' ? 'Left' : leg === 'R' ? 'Right' : 'Value';
      if (isGrade) {
        return `<label class="fld" style="flex:1">${lbl}
          <select data-v="${leg || 'X'}"><option value="">—</option>${m.options.map((o) => `<option>${o}</option>`).join('')}</select></label>`;
      }
      const pre = prefill ? prefill[leg || 'X'] ?? prefill.L ?? '' : '';
      return `<label class="fld" style="flex:1">${lbl} <span class="muted">${esc(unitFor(id))}</span>
        <input type="number" step="any" inputmode="decimal" data-v="${leg || 'X'}"
          value="${pre === null || pre === undefined ? '' : pre}"></label>`;
    };
    const exId = exerciseForMeasure(id);
    const art = exId ? thumb(exId, 74) : '';
    return `
      ${art ? `<div class="measure-hero">${art}<div>
        <div class="pname">${esc(m.label)}</div>
        <div class="tiny muted">${esc(m.group)}</div></div></div>` : ''}
      ${m.how ? `<div class="callout small" style="margin-bottom:.7rem">${esc(m.how)}</div>` : ''}
      <div class="row" style="align-items:flex-end">
        ${m.perLeg ? field('L') + field('R') : field(null)}
      </div>
      ${m.vald ? `<div class="row" style="margin-top:.5rem">
        <label class="fld" style="width:110px">Percentile L <input type="number" data-p="L"></label>
        ${m.perLeg ? '<label class="fld" style="width:110px">Percentile R <input type="number" data-p="R"></label>' : ''}
      </div>` : ''}
      <label class="fld" style="margin-top:.6rem">Note <input data-note placeholder="Optional"></label>`;
  };

  openModal({
    title: 'Record a measurement',
    body: `
      <label class="fld">Test
        <select id="me-measure" ${lockMeasure ? 'disabled' : ''}>${opts}</select></label>
      <label class="fld" style="margin-top:.5rem;width:170px">Date
        <input type="date" id="me-date" value="${esc(date)}"></label>
      <div id="me-fields" style="margin-top:.7rem">${build(measureId)}</div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="me-save">Save</button>',
    onMount(root) {
      const sel = root.querySelector('#me-measure');
      const fields = root.querySelector('#me-fields');
      sel.addEventListener('change', () => { fields.innerHTML = build(sel.value); });
      root.querySelector('#me-save').addEventListener('click', () => {
        const id = sel.value;
        const m = MEASURE_BY_ID[id];
        const d = root.querySelector('#me-date').value;
        const note = root.querySelector('[data-note]')?.value.trim() || undefined;
        const rows = [];
        const grab = (legKey, legOut) => {
          const inp = fields.querySelector(`[data-v="${legKey}"]`);
          if (!inp) return;
          const raw = inp.value;
          if (raw === '' || raw === null) return;
          const value = m.unit === 'grade' ? raw : Number(raw);
          if (m.unit !== 'grade' && !Number.isFinite(value)) return;
          const p = fields.querySelector(`[data-p="${legKey}"]`)?.value;
          rows.push({
            date: d, measure: id, leg: legOut, value,
            unit: m.unit === 'weight' ? state.data.settings.weightUnit : m.unit,
            pctile: p ? Number(p) : undefined, note,
          });
        };
        if (m.perLeg) { grab('L', 'L'); grab('R', 'R'); } else { grab('X', null); }
        closeModal();
        if (rows.length) onSave(rows);
      });
    },
  });
}

export function fmtMeasure(rec) {
  const m = MEASURE_BY_ID[rec.measure];
  if (!m) return String(rec.value);
  if (m.unit === 'grade') return String(rec.value);
  const u = m.unit === 'weight' ? (rec.unit || state.data.settings.weightUnit) : UNIT_LABEL[m.unit] || '';
  return `${round(rec.value, 2)}${u ? ' ' + u : ''}`;
}

// ---------------------------------------------------------------- charts ---
/**
 * Line chart of measurement history. series = [{label, cls, points:[{date,value}]}]
 */
export function lineChart(series, { target, height = 130, lowerBetter = false } = {}) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 1) return '<div class="empty">No data yet.</div>';
  const xs = all.map((p) => fromIso(p.date).getTime());
  const ys = all.map((p) => p.value).concat(target != null ? [target] : []);
  let x0 = Math.min(...xs); let x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= 86400000; x1 += 86400000; }
  let y0 = Math.min(...ys); let y1 = Math.max(...ys);
  const padY = (y1 - y0) * 0.15 || Math.abs(y1 * 0.15) || 1;
  y0 = lowerBetter ? Math.max(0, y0 - padY) : Math.max(0, y0 - padY);
  y1 += padY;

  const W = 320; const H = height; const L = 30; const R = 6; const T = 8; const B = 18;
  const px = (t) => L + ((t - x0) / (x1 - x0)) * (W - L - R);
  const py = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);

  const ticks = [y0, (y0 + y1) / 2, y1];
  const grid = ticks.map((v) => `
    <line class="gridline" x1="${L}" y1="${py(v).toFixed(1)}" x2="${W - R}" y2="${py(v).toFixed(1)}"/>
    <text x="${L - 4}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end">${round(v, 1)}</text>`).join('');

  const paths = series.map((s) => {
    const pts = s.points.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!pts.length) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(fromIso(p.date).getTime()).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ');
    const dots = pts.map((p) => `<circle cx="${px(fromIso(p.date).getTime()).toFixed(1)}" cy="${py(p.value).toFixed(1)}" r="2.6" fill="currentColor"/>`).join('');
    return `<g class="${s.cls}" style="color:var(--${s.color || 'accent'})"><path class="series ${s.cls}" d="${d}" stroke="currentColor"/>${dots}</g>`;
  }).join('');

  const targetLine = target != null
    ? `<line class="target" x1="${L}" y1="${py(target).toFixed(1)}" x2="${W - R}" y2="${py(target).toFixed(1)}"/>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
    ${grid}${targetLine}${paths}
    <line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>
    <text x="${L}" y="${H - 5}">${esc(fmtDate(all.reduce((a, b) => (a.date < b.date ? a : b)).date, 'short'))}</text>
    <text x="${W - R}" y="${H - 5}" text-anchor="end">${esc(fmtDate(all.reduce((a, b) => (a.date > b.date ? a : b)).date, 'short'))}</text>
  </svg>`;
}

/** Week-column activity heatmap ending at `endIso`. */
export function heatmap(endIso, weeks, levelFor) {
  const cols = [];
  // Walk back to the Monday of the earliest week we want to show.
  const endShift = (fromIso(endIso).getDay() + 6) % 7;
  const cursor = addDays(endIso, -endShift - (weeks - 1) * 7);
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const iso = addDays(cursor, w * 7 + d);
      const future = iso > endIso;
      const lvl = future ? 'future' : `l${levelFor(iso)}`;
      const isToday = iso === endIso;
      cells.push(`<div class="heat-cell ${lvl}${isToday ? ' today' : ''}" title="${esc(fmtDate(iso))}" data-date="${iso}"></div>`);
    }
    cols.push(`<div class="heat-col">${cells.join('')}</div>`);
  }
  return `<div class="heat">${cols.join('')}</div>`;
}

// ------------------------------------------------------------- date pill ---
/**
 * The shared date control: chevrons, a calendar icon that opens the native
 * picker, and the date. Used by Today and Supplements so history browsing
 * behaves identically in both.
 */
export function renderDatePill(iso, { done = 0, showDone = true } = {}) {
  const isToday = iso === currentDayIso();
  return `<div class="datepill-wrap">
    <div class="datepill">
      <button class="dp-arrow" data-nav="-1" aria-label="Previous day">‹</button>
      <span class="dp-mid">
        <span class="dp-cal" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
        </span>
        <span class="dp-date">${esc(fmtDate(iso))}</span>
        <input type="date" data-jump value="${iso}" aria-label="Jump to a date">
      </span>
      <button class="dp-arrow" data-nav="1" aria-label="Next day">›</button>
    </div>
    <button class="dp-today ${isToday ? 'is-today' : ''}" data-nav="today"
            ${isToday ? 'disabled aria-disabled="true"' : ''}>today</button>
    ${showDone && done ? `<span class="pill good dp-done">${done} done</span>` : ''}
  </div>`;
}

/** Wire the pill. `onChange(newIso)` receives the chosen date. */
export function bindDatePill(root, iso, onChange) {
  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset.nav;
    if (d === 'today') return onChange(currentDayIso());
    onChange(addDays(iso, Number(d)));
  }));
  root.querySelector('[data-jump]')?.addEventListener('change', (e) => {
    if (e.target.value) onChange(e.target.value);
  });
}
