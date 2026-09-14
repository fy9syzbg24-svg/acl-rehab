// A measurement trend with a pinned selection and a detail panel.
//
// 2026-09-14 ring design (audit items 15 and 16). Honest by construction:
//   - actual dated observations only, one test and setup per chart (a measure
//     id is one test), straight lines between that leg's own observations
//   - a single observation is a dated point and its value, never a line
//   - no smoothing, no extrapolation, no clipped outliers, no invented target
//   - a side not recorded on a date says so; a missing value is never zero
//   - left is always blue and right orange, and both are named beside the
//     line, not only in a legend
//   - nothing here says a leg is healthy, unaffected or cleared
//
// Selection is pinned by tap, click or the arrow keys, and survives leaving
// and coming back (ctx.trend). Hover on a mouse previews without moving the
// pin. A selection change patches the chart in place; nothing re-renders, so
// the values update at once while the guide glides over 160 ms.

import { esc, round, fmtDate, fmtDateNum, fromIso } from './util.js';
import { state, measurementsFor } from './store.js';
import { MEASURES, MEASURE_BY_ID, UNIT_LABEL } from '../data/measurements.js';

const LAST_KEY = 'rehab.trend.measure';
const charts = {};   // key -> geometry and data of the chart on screen

function unitOf(m, r) {
  if (m.unit === 'weight') return r?.unit || state.data.settings.weightUnit;
  return UNIT_LABEL[m.unit] || '';
}
function fmtVal(m, r) {
  if (!r) return null;
  const u = unitOf(m, r);
  const v = round(r.value, 2);
  return u ? (u.length > 2 || /^[A-Za-z]/.test(u) ? `${v} ${u}` : `${v}${u}`) : String(v);
}

/** Measures that can be charted: numeric, with at least one observation. */
export function chartableMeasures() {
  return MEASURES.filter((m) => m.unit !== 'grade' && measurementsFor(m.id).length);
}

function latestDate(m) {
  return measurementsFor(m.id).map((r) => r.date).sort().pop() || '';
}

function defaultMeasure(list) {
  let last = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* per device */ }
  if (last && list.some((m) => m.id === last)) return last;
  return list.slice().sort((a, b) => (latestDate(a) < latestDate(b) ? 1 : -1))[0]?.id || null;
}

function seriesFor(m, range) {
  const since = rangeStart(range);
  const pick = (leg) => measurementsFor(m.id, leg)
    .filter((r) => typeof r.value === 'number' && Number.isFinite(r.value) && (!since || r.date >= since))
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return m.perLeg ? { L: pick('L'), R: pick('R') } : { B: pick(null) };
}

function rangeStart(range) {
  if (!range || range === 'all') return null;
  const months = range === '3m' ? 3 : 6;
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function niceTicks(lo, hi, n = 4) {
  if (lo === hi) { const pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) || raw;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.5 && ticks.length < 8; v += step) ticks.push(round(v, 6));
  return ticks;
}

/**
 * The chart, its controls and its selected-record panel.
 * opts: { key, width, compact }
 */
export function renderTrend(ctx, { key = 'overview', width = 640, compact = false } = {}) {
  const list = chartableMeasures();
  ctx.trend ||= {};
  const st = (ctx.trend[key] ||= {});
  if (!list.length) {
    return `<div class="trend empty-trend"><b>No measurements recorded</b>
      <button class="btn sm" data-tr-record>Record a test</button></div>`;
  }
  if (!st.measure || !list.some((m) => m.id === st.measure)) st.measure = defaultMeasure(list);
  const m = MEASURE_BY_ID[st.measure];
  const series = seriesFor(m, st.range);
  const dates = [...new Set(Object.values(series).flat().map((r) => r.date))].sort();
  const allDates = [...new Set(Object.values(seriesFor(m, 'all')).flat().map((r) => r.date))].sort();
  const spanDays = allDates.length > 1 ? (fromIso(allDates[allDates.length - 1]) - fromIso(allDates[0])) / 86400000 : 0;
  if (!st.sel || !dates.includes(st.sel)) st.sel = dates[dates.length - 1] || null;

  const W = Math.max(280, Math.min(900, Math.round(width)));
  const H = compact ? 210 : 250;
  const M = { l: 46, r: m.perLeg ? 58 : 18, t: 16, b: 34 };
  const vals = Object.values(series).flat().map((r) => r.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const t0 = dates.length ? fromIso(dates[0]).getTime() : 0;
  const t1 = dates.length ? fromIso(dates[dates.length - 1]).getTime() : 1;
  const px = (iso) => (dates.length < 2 ? (M.l + (W - M.r)) / 2
    : M.l + ((fromIso(iso).getTime() - t0) / (t1 - t0)) * (W - M.l - M.r));
  const py = (v) => M.t + (1 - (v - y0) / ((y1 - y0) || 1)) * (H - M.t - M.b);
  charts[key] = { m, series, dates, px, W, H, M };

  const u = unitOf(m, Object.values(series).flat()[0]);
  const grid = ticks.map((v) => `<line class="tr-grid" x1="${M.l}" x2="${W - M.r}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/>
    <text class="tr-ylab" x="${M.l - 8}" y="${(py(v) + 4).toFixed(1)}" text-anchor="end">${esc(String(round(v, 2)))}</text>`).join('');
  const every = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor((W - M.l - M.r) / 78))));
  const xlabs = dates.map((d, i) => (i % every === 0 || i === dates.length - 1) && !(i !== dates.length - 1 && dates.length - 1 - i < every)
    ? `<text class="tr-xlab" x="${px(d).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(fmtDate(d, 'short').replace(/^\w+,\s*/, ''))}</text>` : '').join('');

  const names = { L: 'Left', R: 'Right', B: m.label };
  const ends = [];
  const lines = Object.entries(series).map(([leg, pts]) => {
    if (!pts.length) return '';
    const cls = leg === 'L' ? 'L' : leg === 'R' ? 'R' : 'B';
    // A line joins two observations of this leg only when no test date of the
    // chart falls between them without this leg: a known gap stays a gap.
    const byDate = new Map(pts.map((r) => [r.date, r]));
    let d = '';
    let prevHad = false;
    for (const iso of dates) {
      const r = byDate.get(iso);
      if (!r) { prevHad = false; continue; }
      d += `${prevHad ? 'L' : 'M'}${px(r.date).toFixed(1)},${py(r.value).toFixed(1)} `;
      prevHad = true;
    }
    const last = pts[pts.length - 1];
    if (leg !== 'B') ends.push({ leg, x: px(last.date) + 10, y: py(last.value) + 4 });
    return `<g class="tr-series ${cls}">
      ${d.includes('L') ? `<path class="tr-line" d="${d.trim()}"/>` : ''}
      ${pts.map((r) => `<circle class="tr-pt ${r.date === st.sel ? 'sel' : ''}" data-tr-pt="${esc(r.date)}" cx="${px(r.date).toFixed(1)}" cy="${py(r.value).toFixed(1)}" r="${r.date === st.sel ? 6 : 4}"/>`).join('')}
    </g>`;
  }).join('');
  // Keep the two end labels from sitting on top of each other.
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 15) {
    const [a, b] = ends[0].y <= ends[1].y ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const mid = (a.y + b.y) / 2;
    a.y = mid - 8; b.y = mid + 8;
  }
  const endLabels = ends.map((e) => `<text class="tr-end ${e.leg}" x="${e.x.toFixed(1)}" y="${e.y.toFixed(1)}">${names[e.leg]}</text>`).join('');
  const hits = dates.map((d, i) => {
    const x = px(d);
    const prev = i ? px(dates[i - 1]) : M.l;
    const next = i < dates.length - 1 ? px(dates[i + 1]) : W - M.r;
    const a = i ? (prev + x) / 2 : M.l;
    const b = i < dates.length - 1 ? (x + next) / 2 : W - M.r;
    return `<rect class="tr-hit" data-tr-date="${esc(d)}" x="${a.toFixed(1)}" y="${M.t}" width="${Math.max(8, b - a).toFixed(1)}" height="${H - M.t - M.b}"/>`;
  }).join('');

  const ranges = [['all', 'All']].concat(spanDays > 200 ? [['6m', '6 months']] : [], spanDays > 100 ? [['3m', '3 months']] : []);
  return `
  <div class="trend" data-trend="${esc(key)}">
    <div class="tr-head">
      <div class="tr-title">
        <label class="tr-pick"><span class="sr-only">Measurement</span>
          <select data-tr-measure>${list.map((x) => `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        <div class="tr-sub">${esc(m.group)}${u ? ` · ${esc(unitName(m, u))}` : ''}${m.lower ? ' · lower is better' : ''}</div>
      </div>
      ${m.perLeg ? '<div class="tr-legend"><span class="L">Left</span><span class="R">Right</span></div>' : ''}
    </div>
    ${ranges.length > 1 ? `<div class="tr-ranges" role="group" aria-label="Range">${ranges.map(([k, l]) => `<button class="${(st.range || 'all') === k ? 'on' : ''}" data-tr-range="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
    <div class="tr-split">
      <div class="tr-main">
        <div class="tr-plot" tabindex="0" role="group" aria-label="${esc(m.label)} over time. Arrow keys move between dates.">
          <svg class="tr-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
            ${grid}
            <g class="tr-guide" style="transform:translateX(${st.sel ? px(st.sel).toFixed(1) : -100}px)"><line x1="0" x2="0" y1="${M.t}" y2="${H - M.b}"/></g>
            ${lines}${endLabels}${xlabs}${hits}
          </svg>
        </div>
        <div class="tr-readout" aria-live="polite" data-tr-readout>${readout(m, series, st.sel)}</div>
        ${dates.length === 1 ? '<div class="tr-note">One measurement so far: a dated point, not a trend.</div>' : ''}
      </div>
      <aside class="tr-panel" data-tr-panel>${panel(m, series, st.sel)}</aside>
    </div>
  </div>`;
}

function unitName(m, u) {
  return { N: 'newtons (N)', s: 'seconds', '°': 'degrees', cm: 'centimetres', mm: 'millimetres', '%': 'per cent',
    reps: 'reps', min: 'minutes', 'mm/s': 'millimetres a second', 'W/kg': 'watts per kilogram' }[u] || u;
}

function recOn(series, leg, iso) {
  return (series[leg] || []).filter((r) => r.date === iso).pop() || null;
}

function readout(m, series, iso) {
  if (!iso) return '';
  const d = fmtDate(iso, 'short').replace(/^\w+,\s*/, '');
  if (!m.perLeg) {
    const r = recOn(series, 'B', iso);
    return `<b>Selected</b> ${esc(d)} · ${esc(fmtVal(m, r) || 'not recorded')}`;
  }
  const L = recOn(series, 'L', iso);
  const R = recOn(series, 'R', iso);
  return `<b>Selected</b> ${esc(d)} · <span class="L">Left ${esc(fmtVal(m, L) || 'not recorded')}</span> · <span class="R">Right ${esc(fmtVal(m, R) || 'not recorded')}</span>`;
}

function panel(m, series, iso) {
  if (!iso) return '';
  const recs = m.perLeg ? [['L', 'Left', recOn(series, 'L', iso)], ['R', 'Right', recOn(series, 'R', iso)]]
    : [['B', 'Result', recOn(series, 'B', iso)]];
  const any = recs.map((x) => x[2]).filter(Boolean);
  const src = [...new Set(any.map((r) => r.src).filter(Boolean))];
  const notes = recs.filter(([, , r]) => r?.note).map(([leg, name, r]) => (m.perLeg ? `${name}: ${r.note}` : r.note));
  const asym = any.find((r) => r.asym)?.asym;
  const d = new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `
    <h3>Selected test</h3>
    <div class="tr-when">${esc(d)} · ${esc(m.label)}</div>
    <div class="tr-vals ${m.perLeg ? 'two' : ''}">${recs.map(([leg, name, r]) => `
      <div class="tr-val ${leg}"><small>${esc(name)}</small><b>${esc(fmtVal(m, r) || 'Not recorded')}</b>
        ${r?.pctile != null ? `<span>${esc(ordinal(r.pctile))} percentile</span>` : ''}</div>`).join('')}</div>
    ${asym ? `<div class="tr-line2"><span>Asymmetry, as printed</span><b>${esc(String(asym.pct))}% ${esc(asym.side)}</b></div>` : ''}
    ${src.length ? `<div class="tr-ctx"><span>Report</span>${src.map((x) => `<b>${esc(x)}</b>`).join('')}</div>` : ''}
    ${m.how ? `<div class="tr-ctx"><span>Method</span><p>${esc(m.how)}</p></div>` : ''}
    ${notes.length ? `<div class="tr-ctx"><span>Notes</span>${notes.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
    <button class="tr-open" data-tr-open="${esc(m.id)}" data-tr-openiso="${esc(iso)}">Open full test record<span aria-hidden="true">›</span></button>`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** Patch a chart to a date: guide, points, readout and panel, no re-render. */
function selectDate(root, key, iso, { pin = true } = {}) {
  const c = charts[key];
  if (!c || !iso) return;
  const wrap = root.querySelector(`[data-trend="${key}"]`);
  if (!wrap) return;
  wrap.querySelector('.tr-guide')?.setAttribute('style', `transform:translateX(${c.px(iso).toFixed(1)}px)`);
  wrap.querySelectorAll('.tr-pt').forEach((p) => {
    const on = p.dataset.trPt === iso;
    p.classList.toggle('sel', on);
    p.setAttribute('r', on ? 6 : 4);
  });
  const ro = wrap.querySelector('[data-tr-readout]');
  if (ro) ro.innerHTML = readout(c.m, c.series, iso);
  if (pin) {
    const pn = wrap.querySelector('[data-tr-panel]');
    if (pn) pn.innerHTML = panel(c.m, c.series, iso);
  }
}

export function bindTrend(root, ctx, rerender, { onOpen, onRecord } = {}) {
  root.querySelectorAll('[data-trend]').forEach((wrap) => {
    const key = wrap.dataset.trend;
    const st = ctx.trend?.[key];
    const c = charts[key];
    if (!st || !c) return;
    const plot = wrap.querySelector('.tr-plot');
    const pin = (iso) => { st.sel = iso; selectDate(root, key, iso); };
    wrap.querySelectorAll('[data-tr-date]').forEach((r) => {
      r.addEventListener('click', () => pin(r.dataset.trDate));
      r.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') selectDate(root, key, r.dataset.trDate, { pin: false }); });
    });
    plot?.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') selectDate(root, key, st.sel); });
    plot?.addEventListener('keydown', (e) => {
      const i = c.dates.indexOf(st.sel);
      let j = null;
      if (e.key === 'ArrowLeft') j = Math.max(0, i - 1);
      if (e.key === 'ArrowRight') j = Math.min(c.dates.length - 1, i + 1);
      if (e.key === 'Home') j = 0;
      if (e.key === 'End') j = c.dates.length - 1;
      if (j == null) return;
      e.preventDefault();
      pin(c.dates[j]);
    });
    wrap.querySelector('[data-tr-measure]')?.addEventListener('change', (e) => {
      st.measure = e.target.value;
      st.sel = null;
      try { localStorage.setItem(LAST_KEY, st.measure); } catch { /* per device */ }
      rerender();
    });
    wrap.querySelectorAll('[data-tr-range]').forEach((b) => b.addEventListener('click', () => {
      st.range = b.dataset.trRange;
      rerender();
    }));
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tr-open]');
      if (b && onOpen) onOpen(b.dataset.trOpen, b.dataset.trOpeniso);
    });
  });
  root.querySelectorAll('[data-tr-record]').forEach((b) => b.addEventListener('click', () => onRecord?.()));
}
