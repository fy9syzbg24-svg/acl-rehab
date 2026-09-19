// Progress > Trends: the expanded view (2026-09-16). One region at a time in
// the same fixed order as the board: a small multiple per test (the honest
// trend chart, both legs, a neutral rule at each published reference that
// can be placed), then the test sessions as paired "passports": one panel
// per session with its date, place, device and position, matching scales,
// and a seam between sessions from different devices that says no change
// is calculated across it. Lines only ever join the same test.

import { esc, round, fmtDate } from '../util.js';
import { state, measurementsFor } from '../store.js';
import { MEASURE_BY_ID, UNIT_LABEL, toN, fromN } from '../../data/measurements.js';
import { LEVELS } from '../../data/norms.js';
import { renderTrend, bindTrend, pinAcross, restoreAcross } from '../trend.js';
import { contentWidth } from './overview.js';
import { REGIONS, REGION_BY_ID, placedRefs, latestLegs, sinceLast } from './standboard.js';
import { goalsFor } from '../clinicgoals.js';

const CURSOR_BOUND = new WeakSet();   // wrappers already wired, never a data attribute (morph refuses those)
const unitOf = (m, r) => (m.unit === 'weight' ? (r?.unit || state.data.settings.weightUnit || 'kg') : UNIT_LABEL[m.unit] || '');

function regionTests(region) {
  return region.tests.map((id) => MEASURE_BY_ID[id]).filter((m) => m && measurementsFor(m.id).length);
}

export function renderTrends(ctx) {
  const withData = REGIONS.filter((r) => regionTests(r).length);
  if (!withData.length) return '<div class="stack"><div class="empty">No test results yet.</div></div>';
  if (!ctx.region || !withData.some((r) => r.id === ctx.region)) ctx.region = withData[0].id;
  const region = REGION_BY_ID[ctx.region];
  const tests = regionTests(region);
  const cw = contentWidth();
  const wide = cw >= 940;
  return `<div class="stack trends">
    <div class="tabrow subtabs" role="tablist" aria-label="Region">
      ${withData.map((r) => `<button class="btn sm ${r.id === region.id ? 'primary' : ''}" data-region-pick="${esc(r.id)}" role="tab" aria-selected="${r.id === region.id}">${esc(r.label)}</button>`).join('')}
    </div>
    ${tests.map((m) => testPanel(ctx, m, wide ? cw - 324 : cw)).join('')}
    ${sessionPassports(region, tests)}
  </div>`;
}

function testPanel(ctx, m, width) {
  const refs = placedRefs(m);
  const u = unitOf(m, latestLegs(m)?.L || latestLegs(m)?.R || latestLegs(m)?.B);
  // His clinician's goals first, drawn solid (2026-09-18), then the published references.
  const goals = goalsFor(m.id).map((g) => ({ value: g.value, label: `${g.stage === 'discharge' ? 'Discharge goal' : 'Goal'} ${round(g.value, 0)}`, goal: true }));
  const lines = goals.concat(refs.map((p) => ({ value: p.value, label: `${LEVELS[p.r.level]} ${round(p.value, 0)}` })));
  return `<section class="ov-sec panelsec tr-sec">
    ${renderTrend(ctx, { key: `tr:${m.id}`, width, measures: [m.id], refs: lines })}
    ${refs.length ? `<div class="tr-refsrc">${refs.map((p) => `<div><b>${esc(LEVELS[p.r.level])}</b> ${esc(`${round(p.r.value, 2)}${p.r.sd != null ? ` ± ${round(p.r.sd, 2)}` : ''} ${p.r.unit}`)}${p.r.unit !== m.unit ? ` (${esc(String(round(p.value, 1)))} ${esc(u)} here)` : ''}. ${esc([p.r.population, p.r.protocol].filter(Boolean).join('. '))}. ${p.r.url ? `<a href="${esc(p.r.url)}" target="_blank" rel="noopener">${esc(p.r.source)}</a>` : esc(p.r.source)}</div>`).join('')}</div>` : ''}
  </section>`;
}

/** Sessions: every date and source that holds a result for one of the region's tests. */
function sessions(tests) {
  const by = {};
  for (const m of tests) for (const r of measurementsFor(m.id)) {
    const key = `${r.date}|${r.src || ''}`;
    (by[key] ||= { date: r.date, src: r.src || '', rows: {} });
    (by[key].rows[m.id] ||= {});
    by[key].rows[m.id][r.leg || 'B'] = r;
  }
  return Object.values(by).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function deviceOf(m) { return m.device || (m.vald ? 'VALD' : m.group); }

function sessionPassports(region, tests) {
  const list = sessions(tests);
  if (list.length < 2) return '';
  // The unit each test family shows in: the newest test's unit, force converted.
  // Only the dynamometer families convert (a VALD Dynamo newton and a handheld
  // pound are the same quantity); force plate newtons stay newtons.
  const unitFor = (m) => (m.family && (m.unit === 'N' || m.unit === 'lb')) ? 'lb' : unitOf(m);
  const show = (m, r) => {
    if (!r) return '·';
    if ((m.unit === 'N' || m.unit === 'lb') && unitFor(m) !== m.unit) return `${round(fromN(toN(r.value, m.unit), unitFor(m)), 1)}`;
    return `${round(r.value, 1)}`;
  };
  const scaleMax = {};
  for (const s of list) for (const [id, legs] of Object.entries(s.rows)) {
    const m = MEASURE_BY_ID[id];
    for (const r of Object.values(legs)) if (typeof r.value === 'number') scaleMax[m.family || id] = Math.max(scaleMax[m.family || id] || 0, Number(show(m, r)));
  }
  const panel = (s) => {
    const devices = [...new Set(Object.keys(s.rows).map((id) => deviceOf(MEASURE_BY_ID[id])))];
    const rows = Object.entries(s.rows).map(([id, legs]) => {
      const m = MEASURE_BY_ID[id];
      const max = (scaleMax[m.family || id] || 1) * 1.08;
      const w = (r) => `${r && typeof r.value === 'number' ? Math.max(0, Math.min(100, (Number(show(m, r)) / max) * 100)).toFixed(1) : 0}%`;
      const grade = m.unit === 'grade';
      const since = m.perLeg ? null : sinceLast(m, null);
      if (!m.perLeg) {
        const r = legs.B;
        return `<div class="pp-row one"><span class="pp-name">${esc(m.label)}${m.setup ? `<small>${esc(m.setup)}</small>` : ''}</span>
          <span class="pp-val B">${grade ? esc(String(r.value)) : esc(show(m, r))}<small>${grade ? '' : esc(unitFor(m))}</small></span></div>`;
      }
      return `<div class="pp-row"><span class="pp-name">${esc(m.label)}${m.setup ? `<small>${esc(m.setup)}</small>` : ''}</span>
        <span class="pp-bars">${grade ? '' : `<i class="L" style="width:${w(legs.L)}"></i><i class="R" style="width:${w(legs.R)}"></i>`}</span>
        <span class="pp-vals"><b class="L">${grade ? esc(String(legs.L?.value ?? '·')) : esc(show(m, legs.L))}</b> <b class="R">${grade ? esc(String(legs.R?.value ?? '·')) : esc(show(m, legs.R))}</b><small>${grade ? '' : esc(unitFor(m))}</small></span></div>`;
    }).join('');
    return `<article class="passport">
      <header><b>${esc(fmtDate(s.date, 'short'))}</b><span>${esc(s.src || 'Your entry')}</span><small>${esc(devices.join(' · '))}</small></header>
      <div class="pp-rows">${rows}</div>
    </article>`;
  };
  const out = [];
  for (let i = 0; i < list.length; i++) {
    if (i) {
      const prevIds = new Set(Object.keys(list[i - 1].rows)); const sameTest = Object.keys(list[i].rows).some((id) => prevIds.has(id));
      const prevDev = new Set(Object.keys(list[i - 1].rows).map((id) => deviceOf(MEASURE_BY_ID[id])));
      const dev = new Set(Object.keys(list[i].rows).map((id) => deviceOf(MEASURE_BY_ID[id])));
      const differs = [...dev].some((d) => !prevDev.has(d)) || !sameTest;
      out.push(`<div class="pp-seam ${differs ? 'differs' : ''}">${differs ? 'Different device, tester or position: shown in one unit, no change calculated across this seam.' : 'Same tests repeated: changes are on the charts above.'}</div>`);
    }
    out.push(panel(list[i]));
  }
  return `<section class="ov-sec panelsec"><div class="ov-head"><h2>Test sessions</h2><span class="ov-sub">then and now, side by side</span></div><div class="passports">${out.join('')}</div></section>`;
}

export function bindTrends(root, ctx, rerender) {
  root.querySelectorAll('[data-region-pick]').forEach((b) => b.addEventListener('click', () => {
    if (ctx.region === b.dataset.regionPick) return;
    ctx.region = b.dataset.regionPick;
    rerender();
  }));
  bindTrend(root, ctx, rerender, {
    onOpen(measureId, date) { ctx.gtab = 'clinical'; ctx.ctab = 'tests'; ctx.mtab = 'history'; ctx.chartMeasure = measureId; ctx.focusTest = { measure: measureId, date }; rerender(); },
    onRecord() { ctx.gtab = 'clinical'; ctx.ctab = 'tests'; rerender(); },
  });
  // One date cursor for the whole region (2026-09-16): pin a date on any
  // chart and every chart that holds it follows; hovering previews the same
  // way and lets go on leaving. Charts without that date stay put.
  const wrap = root.querySelector('.trends');
  if (!wrap || CURSOR_BOUND.has(wrap)) return;
  CURSOR_BOUND.add(wrap);
  wrap.addEventListener('click', (e) => {
    const hit = e.target.closest('[data-tr-rec], [data-tr-date]');
    if (!hit) return;
    pinAcross(root, ctx, hit.dataset.trPt || hit.dataset.trDate, { pin: true });
  });
  wrap.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const hit = e.target.closest('[data-tr-date]');
    if (hit) pinAcross(root, ctx, hit.dataset.trDate, { pin: false });
  });
  wrap.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.target.closest('.tr-plot') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.tr-plot'))) restoreAcross(root, ctx);
  });
}
