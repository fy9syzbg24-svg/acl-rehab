// Progress > Trends: the expanded view (2026-09-16). One region at a time in
// the same fixed order as the board: a small multiple per test (the honest
// trend chart, both legs, a neutral rule at each published reference that
// can be placed), then the test sessions as paired "passports": one panel
// per session with its date, place, device and position, matching scales,
// and a seam between sessions from different devices that says no change
// is calculated across it. Lines only ever join the same test.

import { esc, round, fmtDate, toKg, fromKg } from '../util.js';
import { state, measurementsFor } from '../store.js';
import { MEASURE_BY_ID, UNIT_LABEL, toN, fromN } from '../../data/measurements.js';
import { LEVELS } from '../../data/norms.js';
import { setForceUnit, FORCE_UNITS, isForce, convertForce } from '../trend.js';
import { kitChart, bindKitCharts, nativeSpec, menu, sheet, msOf, isoOf, nfmt, DOWN, INFO } from './pkit.js';
import { contentWidth } from './overview.js';
import { REGIONS, REGION_BY_ID, placedRefs, latestLegs, sinceLast, tablet } from './standboard.js';
import { goalsFor } from '../clinicgoals.js';

const CURSOR_BOUND = new WeakSet();   // wrappers already wired, never a data attribute (morph refuses those)
const unitOf = (m, r) => (m.unit === 'weight' ? (r?.unit || state.data.settings.weightUnit || 'kg') : UNIT_LABEL[m.unit] || '');

function regionTests(region) {
  return region.tests.map((id) => MEASURE_BY_ID[id]).filter((m) => m && measurementsFor(m.id).length);
}

// Rehab Test v3 (2026-09-30, research 04 H and E2, audit R1 to R3): one chart per test with
// the shared kit, the plot first. No stacked legend lines above the plot: each reference is
// labelled at the trailing end of its own line, his clinician's goal solid, published marks
// dashed. No range chips (a handful of sessions has nothing to range over) and one unit menu
// instead of three chips. The population sources sit behind the (i), never under the chart.
// A single result is its numbers, never a one point chart (R2). The region is picked from a
// menu, not a two row switch.
export function renderTrends(ctx) {
  const withData = REGIONS.filter((r) => regionTests(r).length);
  if (!withData.length) return '<div class="stack"><div class="empty">No test results yet.</div></div>';
  if (!ctx.region || !withData.some((r) => r.id === ctx.region)) ctx.region = withData[0].id;
  const region = REGION_BY_ID[ctx.region];
  const tests = regionTests(region);
  const cw = contentWidth();
  const wide = cw >= 940;
  // The iPad (tablet(): wide and tall, never an iPhone held sideways): the tests as a grid, two
  // across, each chart drawn at its column's width (rt-progress.css `.tr-tab`).
  const tab = tablet() && cw >= 620;
  const force = tests.some(isForce);
  return `<div class="stack trends tr3${tab ? ' tr-tab' : ''}">
    <div class="t3-bar">
      <button type="button" class="t3-pick" data-tr-region aria-label="Region: ${esc(region.label)}. Change">${esc(region.label)}${DOWN}</button>
      ${force ? `<button type="button" class="t3-unit" data-tr-unit aria-label="Force unit: ${esc(fu())}. Change">${esc(fu())}${DOWN}</button>` : ''}
    </div>
    ${tests.map((m) => testPanel(ctx, m, tab ? Math.floor((cw + 20) / 2) - 36 : wide ? cw - 324 : cw)).join('')}
    ${sessionPassports(region, tests)}
  </div>`;
}

// One force unit for every force test on the page, pounds unless he picked another (04 E2:
// he reads one unit). The stored value never changes; this is the view only.
function fu() {
  try { const v = localStorage.getItem('rehab.trend.force'); if (FORCE_UNITS.includes(v)) return v; } catch { /* per device */ }
  return 'lb';
}
function shown(m, v) {
  return isForce(m) ? convertForce(v, m.unit, fu()) : v;
}

function testPanel(ctx, m, width) {
  const legs = latestLegs(m);
  const u = isForce(m) ? fu() : unitOf(m, legs?.L || legs?.R || legs?.B);
  const refs = placedRefs(m);
  const goals = goalsFor(m.id).map((g) => ({ v: shown(m, g.value), label: `${g.stage === 'discharge' ? 'Discharge' : 'Goal'} ${round(shown(m, g.value), 0)}`, kind: 'goal' }));
  const rules = goals.concat(refs.map((p) => ({ v: shown(m, p.value), label: `${LEVELS[p.r.level]} ${round(shown(m, p.value), 0)}`, kind: 'ref' })));
  const series = (m.perLeg ? ['L', 'R'] : [null]).map((leg) => {
    const byDate = new Map();
    for (const r of measurementsFor(m.id, leg)) if (typeof r.value === 'number') byDate.set(r.date, r);
    return { key: leg || 'B', name: leg === 'L' ? 'Left' : leg === 'R' ? 'Right' : 'Result', points: [...byDate.values()].map((r) => ({ t: msOf(r.date), v: shown(m, r.value) })) };
  }).filter((x) => x.points.length);
  const dates = new Set(series.flatMap((x) => x.points.map((p) => p.t)));
  const grade = m.unit === 'grade';
  // Fix d-progress:d34: a degree sign rides on its number ("140°"), as on the board.
  const deg = u === '°';
  // Fix d-progress:d5: when the legs were last tested on different days, each number carries its
  // own date; a result is never shown under another session's date.
  const split = m.perLeg && legs?.L && legs?.R && legs.L.date !== legs.R.date;
  const big = (leg, r) => `<span class="t3-big ${leg}" data-tr-leg="${leg}"${deg ? ' data-suffix="°"' : ''}><small>${leg === 'L' ? 'Left' : leg === 'R' ? 'Right' : ''}${split && r ? `, ${esc(fmtDate(r.date, 'short'))}` : ''}</small><b>${r ? esc(grade ? String(r.value) : nfmt(shown(m, r.value), 1)) + (deg && !grade ? '°' : '') : '<em>none</em>'}</b></span>`;
  const date = split ? '' : [legs?.L?.date, legs?.R?.date, legs?.B?.date].filter(Boolean).sort().pop();
  const W = Math.max(260, width);
  return `<section class="t3-card" data-tr-card="${esc(m.id)}">
    <div class="t3-head">
      <span class="t3-name">${esc(m.label)}</span>
      ${refs.length ? `<button type="button" class="t3-i" data-tr-src="${esc(m.id)}" aria-label="Where the reference lines come from">${INFO}</button>` : ''}
    </div>
    <div class="t3-sub" data-tr-date>${esc([date ? fmtDate(date, 'short') : '', m.device || m.group || ''].filter(Boolean).join(' · '))}</div>
    <div class="t3-nums">${m.perLeg ? big('L', legs?.L) + big('R', legs?.R) : big('B', legs?.B)}${grade || deg ? '' : `<span class="t3-u">${esc(u)}</span>`}</div>
    ${dates.size > 1 && !grade ? kitChart({ series, rules, unit: u, width: W, height: 180, label: m.label,
      native: nativeSpec({ kind: 'strength', title: m.label, unit: u, series, rules }) }) : ''}
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
  return Object.values(by).sort((a, b) => a.date.localeCompare(b.date) || a.src.localeCompare(b.src));
}

function deviceOf(m) { return m.device || (m.vald ? 'VALD' : m.group); }

function sessionPassports(region, tests) {
  const list = sessions(tests);
  if (list.length < 2) return '';
  // The unit each test family shows in: the newest test's unit, force converted.
  // Only the dynamometer families convert (a VALD Dynamo newton and a handheld
  // pound are the same quantity); force plate newtons stay newtons.
  // Every force test in the one force unit the cards use (d2: one unit per test on every screen).
  const unitFor = (m) => (isForce(m) ? fu() : unitOf(m));
  const show = (m, r) => {
    if (!r) return '·';
    if ((m.unit === 'N' || m.unit === 'lb') && unitFor(m) !== m.unit) return `${round(fromN(toN(r.value, m.unit), unitFor(m)), 1)}`;
    // A weight recorded in kg under an lb setting is converted, never relabelled.
    if (m.unit === 'weight' && r.unit && r.unit !== unitFor(m)) return `${round(fromKg(toKg(r.value, r.unit), unitFor(m)), 1)}`;
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
      // One short fact at a seam, never a sentence about the screen (fix d-progress:d12).
      out.push(`<div class="pp-seam ${differs ? 'differs' : ''}">${differs ? 'Different device or position, not compared' : ''}</div>`);
    }
    out.push(panel(list[i]));
  }
  return `<section class="ov-sec panelsec"><div class="ov-head"><h2>Test sessions</h2></div><div class="passports">${out.join('')}</div></section>`;
}

export function bindTrends(root, ctx, rerender) {
  root.querySelector('[data-tr-region]')?.addEventListener('click', async (e) => {
    const withData = REGIONS.filter((r) => regionTests(r).length);
    const pick = await menu(e.currentTarget, { title: 'Region', items: withData.map((r) => ({ id: r.id, title: r.label, checked: r.id === ctx.region })) });
    if (!pick || pick === ctx.region) return;
    ctx.region = pick;
    rerender();
    window.scrollTo(0, 0);
  });
  root.querySelector('[data-tr-unit]')?.addEventListener('click', async (e) => {
    const cur = fu();
    const pick = await menu(e.currentTarget, { title: 'Show force in', items: FORCE_UNITS.map((u) => ({ id: u, title: u === 'N' ? 'Newtons' : u === 'kgf' ? 'Kilograms force' : 'Pounds', checked: u === cur })) });
    if (!pick || pick === cur) return;
    setForceUnit(pick);
    rerender();
  });
  root.querySelectorAll('[data-tr-src]').forEach((b) => b.addEventListener('click', () => {
    const m = MEASURE_BY_ID[b.dataset.trSrc];
    const refs = placedRefs(m);
    const u = unitOf(m, latestLegs(m)?.L || latestLegs(m)?.R || latestLegs(m)?.B);
    sheet({ title: m.label, cls: 'rs-sheet', body: `<div class="rs"><ul class="rs-about">${refs.map((p) => `<li><i class="k-ref"></i><span><b>${esc(`${LEVELS[p.r.level]} ${round(p.r.value, 2)}${p.r.sd != null ? ` plus or minus ${round(p.r.sd, 2)}` : ''} ${p.r.unit}`)}${p.r.unit !== m.unit ? esc(` (${round(p.value, 1)} ${u} here)`) : ''}</b>${esc([p.r.population, p.r.protocol].filter(Boolean).join('. '))}. ${p.r.url ? `<a href="${esc(p.r.url)}" target="_blank" rel="noopener">${esc(p.r.source)}</a>` : esc(p.r.source)}</span></li>`).join('')}</ul></div>` });
  }));
  // Scrub: each card's numbers and date swap to the session under the finger, and back.
  bindKitCharts(root, {
    onScrub(t, values, host) {
      const card = host.closest('.t3-card');
      if (!card) return;
      const m = MEASURE_BY_ID[card.dataset.trCard];
      if (!card.__keep) card.__keep = { nums: [...card.querySelectorAll('.t3-big b')].map((b) => b.innerHTML), legs: [...card.querySelectorAll('.t3-big small')].map((x) => x.innerHTML), date: card.querySelector('[data-tr-date]').innerHTML };
      if (t == null) {
        card.querySelectorAll('.t3-big b').forEach((b, i) => { b.innerHTML = card.__keep.nums[i]; });
        card.querySelectorAll('.t3-big small').forEach((x, i) => { x.innerHTML = card.__keep.legs[i]; });
        card.querySelector('[data-tr-date]').innerHTML = card.__keep.date;
        card.__keep = null;
        return;
      }
      card.querySelectorAll('.t3-big').forEach((el) => { const v = values[el.dataset.trLeg]; el.querySelector('b').innerHTML = v == null ? '<em>none</em>' : esc(nfmt(v, 1)) + (el.dataset.suffix || ''); });
      // Under the finger one session is shown, so its one date heads the card and the legs lose theirs.
      card.querySelectorAll('.t3-big small').forEach((x) => { x.textContent = x.textContent.split(',')[0]; });
      card.querySelector('[data-tr-date]').textContent = [fmtDate(isoOf(t), 'short'), m?.device || m?.group || ''].filter(Boolean).join(' · ');
    },
  });
}
