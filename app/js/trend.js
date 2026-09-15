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

import { parse } from './morph.js';
import { esc, round, fmtDate, fromIso, toKg, fromKg } from './util.js';
import { state, measurementsFor } from './store.js';
import { MEASURES, MEASURE_BY_ID, UNIT_LABEL } from '../data/measurements.js';

// Revision 3 (2026-09-14) added:
//   F05  weight observations in different units are converted, in this view
//        only, to the unit in Settings; the stored value and unit stay as
//        recorded and the panel shows the original beside the converted one
//   F29  a chart binds once, however many times a panel asks
//   F31  every observation is its own point with its record id; two results
//        on one date sit side by side, and the panel lists every result on
//        the selected date. The line uses the last one entered that day, and
//        the panel says so when there is more than one
//   F32  All, 6 months and 3 months are always there; an empty range says so
//   F44  with no remembered choice, the chart opens on the most recent
//        recorded per-leg test (a knee test), not whatever was logged last
//   F46  a caller can limit the measures on offer (the VALD tab does)

const LAST_KEY = 'rehab.trend.measure';
const charts = {};   // key -> geometry and data of the chart on screen
const RANGES = [['all', 'All'], ['6m', '6 months'], ['3m', '3 months']];

function unitOf(m, r) {
  if (m.unit === 'weight') return state.data.settings.weightUnit || r?.unit || 'kg';
  return UNIT_LABEL[m.unit] || '';
}
function fmtNum(m, v, u) {
  const n = round(v, 2);
  return u ? (u.length > 2 || /^[A-Za-z]/.test(u) ? `${n} ${u}` : `${n}${u}`) : String(n);
}
function fmtVal(m, r) {
  if (!r) return null;
  return fmtNum(m, r.value, unitOf(m, r));
}
/** The value as it was recorded, when the chart shows it converted. */
function fmtOrig(m, r) {
  if (!r?.orig) return '';
  return fmtNum(m, r.orig.value, r.orig.unit);
}

/** Measures that can be charted: numeric, with at least one observation. */
export function chartableMeasures(allowed = null) {
  return MEASURES.filter((m) => m.unit !== 'grade' && (!allowed || allowed.includes(m.id)) && measurementsFor(m.id).length);
}

function latestDate(m) {
  return measurementsFor(m.id).map((r) => r.date).sort().pop() || '';
}

function defaultMeasure(list) {
  let last = null;
  try { last = localStorage.getItem(LAST_KEY); } catch { /* per device */ }
  if (last && list.some((m) => m.id === last)) return last;
  const newest = (xs) => xs.slice().sort((a, b) => (latestDate(a) < latestDate(b) ? 1 : -1))[0]?.id || null;
  // A per-leg test is a knee test in this data; bodyweight never is.
  return newest(list.filter((m) => m.perLeg)) || newest(list);
}

/** One leg's observations in range, in date order, weights in one unit. */
function seriesFor(m, range) {
  const since = rangeStart(range);
  const want = m.unit === 'weight' ? (state.data.settings.weightUnit || 'kg') : null;
  const norm = (r) => {
    if (!want) return r;
    const from = r.unit || want;
    if (from === want) return r;
    return { ...r, value: round(fromKg(toKg(r.value, from), want), 3), orig: { value: r.value, unit: from } };
  };
  const pick = (leg) => measurementsFor(m.id, leg)
    .filter((r) => typeof r.value === 'number' && Number.isFinite(r.value) && (!since || r.date >= since))
    .map(norm);
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
  // Always reach past the highest value (audit A25): stopping half a step
  // short put a 4.9 above a top tick of 4, outside the plot.
  const ticks = [];
  for (let v = start; ticks.length < 12; v += step) {
    ticks.push(round(v, 6));
    if (v >= hi - step * 1e-9) break;
  }
  return ticks;
}

const recId = (r, i) => String(r.id || `${r.date}:${i}`);

/**
 * The chart, its controls and its selected-record panel.
 * opts: { key, width, compact, measures }
 */
const lastOpts = {};   // key -> the options it was last drawn with, to redraw it alone
export function renderTrend(ctx, { key = 'overview', width = 640, compact = false, measures = null } = {}) {
  lastOpts[key] = { key, width, compact, measures };
  const list = chartableMeasures(measures);
  ctx.trend ||= {};
  const st = (ctx.trend[key] ||= {});
  if (!list.length) {
    return `<div class="trend empty-trend"><b>No measurements recorded</b>
      <button class="btn sm" data-tr-record>Record a test</button></div>`;
  }
  if (!st.measure || !list.some((m) => m.id === st.measure)) st.measure = defaultMeasure(list);
  const m = MEASURE_BY_ID[st.measure];
  const range = st.range || 'all';
  const series = seriesFor(m, range);
  const dates = [...new Set(Object.values(series).flat().map((r) => r.date))].sort();
  if (!st.sel || !dates.includes(st.sel)) { st.sel = dates[dates.length - 1] || null; st.rec = null; }
  const u = unitOf(m, Object.values(series).flat()[0]);

  const head = `
    <div class="tr-head">
      <div class="tr-title">
        <label class="tr-pick"><span class="sr-only">Measurement</span>
          <select data-tr-measure>${list.map((x) => `<option value="${esc(x.id)}" ${x.id === m.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        <div class="tr-sub">${esc(m.group)}${u ? ` · ${esc(unitName(m, u))}` : ''}${m.lower ? ' · lower is better' : ''}</div>
      </div>
      ${m.perLeg ? '<div class="tr-legend"><span class="L">Left</span><span class="R">Right</span></div>' : ''}
    </div>
    <div class="tr-ranges" role="group" aria-label="Range">${RANGES.map(([k, l]) =>
      `<button class="${range === k ? 'on' : ''}" data-tr-range="${k}" aria-pressed="${range === k}">${esc(l)}</button>`).join('')}</div>`;

  if (!dates.length) {
    charts[key] = null;
    return `<div class="trend" data-trend="${esc(key)}">${head}
      <div class="tr-empty" role="status">No results in this range.</div></div>`;
  }

  const W = Math.max(280, Math.min(900, Math.round(width)));
  const H = compact ? 210 : 250;
  const M = { l: 46, r: m.perLeg ? 58 : 18, t: 16, b: 34 };
  const vals = Object.values(series).flat().map((r) => r.value);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const t0 = fromIso(dates[0]).getTime();
  const t1 = fromIso(dates[dates.length - 1]).getTime();
  const px = (iso) => (dates.length < 2 ? (M.l + (W - M.r)) / 2
    : M.l + ((fromIso(iso).getTime() - t0) / (t1 - t0)) * (W - M.l - M.r));
  const py = (v) => M.t + (1 - (v - y0) / ((y1 - y0) || 1)) * (H - M.t - M.b);
  charts[key] = { m, series, dates, px, W, H, M };

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
    // The line uses the last result entered on a date. A line joins two
    // observations of this leg only when no test date of the chart falls
    // between them without this leg: a known gap stays a gap.
    const byDate = new Map();
    for (const r of pts) byDate.set(r.date, r);
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
    // Same-date results sit side by side, 7px apart, so each can be chosen.
    const perDate = {};
    const dots = pts.map((r, i) => {
      const same = pts.filter((x) => x.date === r.date);
      const k = (perDate[r.date] = (perDate[r.date] ?? -1) + 1);
      const off = same.length > 1 ? (k - (same.length - 1) / 2) * 7 : 0;
      const id = recId(r, i);
      const on = r.date === st.sel && (!st.rec || st.rec === id || !pts.some((x, j) => recId(x, j) === st.rec));
      return `<circle class="tr-pt ${on ? 'sel' : ''}" data-tr-pt="${esc(r.date)}" data-tr-rec="${esc(id)}" cx="${(px(r.date) + off).toFixed(1)}" cy="${py(r.value).toFixed(1)}" r="4"/>`;
    }).join('');
    return `<g class="tr-series ${cls}">
      ${d.includes('L') ? `<path class="tr-line" d="${d.trim()}"/>` : ''}
      ${dots}
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

  return `
  <div class="trend" data-trend="${esc(key)}">
    ${head}
    <div class="tr-split">
      <div class="tr-main">
        <div class="tr-plot" tabindex="0" role="group" aria-label="${esc(m.label)} over time. Arrow keys move between dates.">
          <svg class="tr-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
            ${grid}
            <g class="tr-guide" style="transform:translateX(${st.sel ? px(st.sel).toFixed(1) : -100}px)"><line x1="0" x2="0" y1="${M.t}" y2="${H - M.b}"/></g>
            ${hits}${lines}${endLabels}${xlabs}
          </svg>
        </div>
        <div class="tr-readout" aria-live="polite" data-tr-readout>${readout(m, series, st.sel)}</div>
        ${dates.length === 1 ? '<div class="tr-note">One measurement so far: a dated point, not a trend.</div>' : ''}
      </div>
      <aside class="tr-panel" data-tr-panel>${panel(m, series, st.sel, st.rec)}</aside>
    </div>
  </div>`;
}

function unitName(m, u) {
  return { N: 'newtons (N)', s: 'seconds', '°': 'degrees', cm: 'centimetres', mm: 'millimetres', '%': 'per cent',
    reps: 'reps', min: 'minutes', 'mm/s': 'millimetres a second', 'W/kg': 'watts per kilogram' }[u] || u;
}

function recsOn(series, leg, iso) {
  return (series[leg] || []).filter((r) => r.date === iso);
}
/** The result the line uses on a date: the last one entered. */
function recOn(series, leg, iso) {
  return recsOn(series, leg, iso).pop() || null;
}

function readout(m, series, iso) {
  if (!iso) return '';
  const d = fmtDate(iso, 'short').replace(/^\w+,\s*/, '');
  const text = (leg) => {
    const all = recsOn(series, leg, iso);
    if (!all.length) return 'not recorded';
    return all.map((r) => fmtVal(m, r)).join(' and ');
  };
  if (!m.perLeg) return `<b>Selected</b> ${esc(d)} · ${esc(text('B'))}`;
  return `<b>Selected</b> ${esc(d)} · <span class="L">Left ${esc(text('L'))}</span> · <span class="R">Right ${esc(text('R'))}</span>`;
}

function panel(m, series, iso, recSel = null) {
  if (!iso) return '';
  const legs = m.perLeg ? [['L', 'Left'], ['R', 'Right']] : [['B', 'Result']];
  const any = legs.flatMap(([leg]) => recsOn(series, leg, iso));
  const src = [...new Set(any.map((r) => r.src).filter(Boolean))];
  const notes = legs.flatMap(([leg, name]) => recsOn(series, leg, iso).filter((r) => r.note).map((r) => (m.perLeg ? `${name}: ${r.note}` : r.note)));
  const asym = any.find((r) => r.asym)?.asym;
  const several = legs.some(([leg]) => recsOn(series, leg, iso).length > 1);
  const d = new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const cell = (leg, name) => {
    const all = recsOn(series, leg, iso);
    if (!all.length) return `<div class="tr-val ${leg}"><small>${esc(name)}</small><b>Not recorded</b></div>`;
    return `<div class="tr-val ${leg}"><small>${esc(name)}</small>${all.map((r, i) => {
      const id = String(r.id || '');
      const picked = recSel && id === recSel;
      return `<b class="${picked ? 'picked' : ''}">${esc(fmtVal(m, r))}</b>
        ${r.orig ? `<span>Recorded as ${esc(fmtOrig(m, r))}</span>` : ''}
        ${r.pctile != null ? `<span>${esc(ordinal(r.pctile))} percentile</span>` : ''}
        ${all.length > 1 ? `<span>${i === all.length - 1 ? 'Entered last, used for the line' : `Result ${i + 1} of ${all.length}`}</span>` : ''}`;
    }).join('')}</div>`;
  };
  return `
    <h3>Selected test</h3>
    <div class="tr-when">${esc(d)} · ${esc(m.label)}</div>
    <div class="tr-vals ${m.perLeg ? 'two' : ''}">${legs.map(([leg, name]) => cell(leg, name)).join('')}</div>
    ${several ? '<div class="tr-note">More than one result on this date; every one is listed.</div>' : ''}
    ${asym ? `<div class="tr-line2"><span>Asymmetry, as printed in the report</span><b>${esc(String(asym.pct))}% ${esc(asym.side)}</b></div>` : ''}
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

/** Patch a chart to a date (and a record on it): guide, points, readout and panel, no re-render. */
function selectDate(root, key, iso, { pin = true, rec = null } = {}) {
  const c = charts[key];
  if (!c || !iso) return;
  const wrap = root.querySelector(`[data-trend="${key}"]`);
  if (!wrap) return;
  wrap.querySelector('.tr-guide')?.setAttribute('style', `transform:translateX(${c.px(iso).toFixed(1)}px)`);
  // On the chosen date every leg's point lights; within the leg that holds
  // the chosen record, only that record does.
  wrap.querySelectorAll('.tr-series').forEach((g) => {
    const mine = rec && [...g.querySelectorAll('[data-tr-rec]')].some((p) => p.dataset.trRec === rec);
    g.querySelectorAll('.tr-pt').forEach((p) => {
      const on = p.dataset.trPt === iso && (!mine || p.dataset.trRec === rec);
      p.classList.toggle('sel', on);
    });
  });
  const ro = wrap.querySelector('[data-tr-readout]');
  if (ro) ro.innerHTML = readout(c.m, c.series, iso);
  if (pin) {
    const pn = wrap.querySelector('[data-tr-panel]');
    if (pn) pn.innerHTML = panel(c.m, c.series, iso, rec);
  }
}

export function bindTrend(root, ctx, rerender, { onOpen, onRecord } = {}) {
  root.querySelectorAll('[data-trend]').forEach((wrap) => {
    // One binding per chart, however many panels ask (F29).
    if (wrap.dataset.bound) return;
    wrap.dataset.bound = '1';
    const key = wrap.dataset.trend;
    const st = ctx.trend?.[key];
    if (!st) return;
    const c = charts[key];
    const plot = wrap.querySelector('.tr-plot');
    const pin = (iso, rec = null) => { st.sel = iso; st.rec = rec; selectDate(root, key, iso, { rec }); };
    wrap.addEventListener('click', (e) => {
      const pt = e.target.closest('[data-tr-rec]');
      if (pt) { pin(pt.dataset.trPt, pt.dataset.trRec); return; }
      const hit = e.target.closest('[data-tr-date]');
      if (hit) { pin(hit.dataset.trDate); return; }
      const rb = e.target.closest('[data-tr-range]');
      if (rb) {
        // A new range redraws this chart only, fading in on the open token
        // (Fable B10); the page around it stays as it is.
        st.range = rb.dataset.trRange;
        const next = lastOpts[key] && parse(renderTrend(ctx, lastOpts[key])).firstElementChild;
        if (!next || !wrap.parentElement) { rerender(); return; }
        const holder = wrap.parentElement;
        const focused = document.activeElement === rb;
        wrap.replaceWith(next);
        next.querySelector('.tr-plot, .tr-empty')?.classList.add('tr-enter');
        bindTrend(holder, ctx, rerender, { onOpen, onRecord });
        if (focused) next.querySelector(`[data-tr-range="${CSS.escape(st.range)}"]`)?.focus({ preventScroll: true });
        return;
      }
      const b = e.target.closest('[data-tr-open]');
      if (b && onOpen) onOpen(b.dataset.trOpen, b.dataset.trOpeniso);
    });
    if (c) {
      wrap.querySelectorAll('[data-tr-date]').forEach((r) => {
        r.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') selectDate(root, key, r.dataset.trDate, { pin: false, rec: null }); });
      });
      plot?.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') selectDate(root, key, st.sel, { pin: false, rec: st.rec }); });
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
    }
    wrap.querySelector('[data-tr-measure]')?.addEventListener('change', (e) => {
      st.measure = e.target.value;
      st.sel = null;
      st.rec = null;
      try { localStorage.setItem(LAST_KEY, st.measure); } catch { /* per device */ }
      rerender();
    });
  });
  root.querySelectorAll('[data-tr-record]').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', () => onRecord?.());
  });
}
