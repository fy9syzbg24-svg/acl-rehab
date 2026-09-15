import { esc, todayIso, round, fmtDateNum, uid, num, ord, toKg, fromKg } from '../util.js';
import { state, update, measurementsFor, latest, best } from '../store.js';
import { MEASURES, MEASURE_BY_ID, MEASURE_GROUPS, UNIT_LABEL } from '../../data/measurements.js';
import { OPEN_CHAIN } from '../../data/exercises.js';
import { openMeasureEntry, lineChart, exerciseById } from '../components.js';
import { renderTrend, bindTrend } from '../trend.js';
import { contentWidth } from './overview.js';

export function renderMeasuresPanel(ctx) {
  const tab = ctx.mtab || 'baselines';
  return `
    <div class="panelbar">
      <div class="tabrow subtabs">
        ${[['baselines', 'Baselines and PRs'], ['vald', 'VALD'], ['tests', 'All tests'], ['history', 'Test history']]
          .map(([k, l]) => `<button class="btn sm ${tab === k ? 'primary' : ''}" data-mtab="${k}">${l}</button>`).join('')}
      </div>
      <button class="btn primary sm" data-newmeasure>+ Record a test</button>
    </div>
    ${tab === 'baselines' ? baselines() : ''}
    ${tab === 'vald' ? valdView(ctx) : ''}
    ${tab === 'tests' ? allTests() : ''}
    ${tab === 'history' ? historyView(ctx) : ''}`;
}

// -------------------------------------------------------------- baselines --
/** Walk every logged exercise entry and pull out the heaviest load per side. */
function loadRecords() {
  const rec = {};
  for (const [date, day] of Object.entries(state.data.days)) {
    for (const e of day.entries || []) {
      if (e.load == null || e.load === '') continue;
      const load = num(e.load);
      if (!load) continue;
      // A both-legs figure stays a both-legs figure: copying it into a left
      // and a right column would claim two measurements that never happened.
      if (!e.logged) continue;
      const sides = [e.side || 'B'];
      for (const s of sides) {
        const key = `${e.ex}|${s}`;
        const cur = rec[key];
        const cand = { ex: e.ex, side: s, load, unit: e.loadUnit || 'kg', sets: e.sets, reps: e.reps, date, seeded: e.seeded, both: e.side === 'B' };
        // Heaviest in one unit (audit A23): 50 lb is not heavier than 30 kg.
        if (!cur || toKg(load, cand.unit) > toKg(cur.load, cur.unit)) rec[key] = cand;
      }
    }
  }
  return rec;
}

function baselines() {
  const rec = loadRecords();
  const byEx = {};
  for (const r of Object.values(rec)) (byEx[r.ex] ||= {})[r.side] = r;
  const ids = Object.keys(byEx).sort((a, b) => (exerciseById(a)?.name || a).localeCompare(exerciseById(b)?.name || b));
  const open = ids.filter((id) => OPEN_CHAIN.has(id));
  const other = ids.filter((id) => !OPEN_CHAIN.has(id));

  // On a phone each exercise is one compact record with both sides side by
  // side (audit L07); the wide table stays for iPad and Mac.
  const side = (tag, r) => `<span class="mv"><b class="sidetag ${tag}">${tag === 'B' ? 'Both' : tag}</b>${r ? `${esc(String(round(r.load, 2)))}<small>${esc(r.unit)}</small>` : '<span class="muted">·</span>'}</span>`;
  const narrow = (list) => `<div class="only-narrow brows">${list.map((id) => {
    const L = byEx[id].L; const R = byEx[id].R; const B = byEx[id].B;
    const top = [L, R, B].filter(Boolean).sort((a, b) => toKg(b.load, b.unit) - toKg(a.load, a.unit))[0];
    return `<div class="brow">
      <div class="brow-name">${esc(exerciseById(id)?.name || id)}</div>
      <div class="brow-vals">${L || R ? side('L', L) + side('R', R) : ''}${B ? side('B', B) : ''}</div>
      <div class="brow-meta">${top.sets ? `best set ${esc(`${top.sets} x ${top.reps ?? '?'}`)} · ` : ''}${esc(fmtDateNum(top.date))}</div>
    </div>`;
  }).join('')}</div>`;
  const table = (list) => !list.length ? '<div class="empty">Nothing logged with a load yet.</div>' : `${narrow(list)}
    <div class="only-wide scroll-x"><table class="tbl" style="min-width:560px">
      <thead><tr><th>Exercise</th><th class="num">Left</th><th class="num">Right</th><th class="num">Both legs</th><th class="num">Difference</th><th>Best set</th><th>When</th></tr></thead>
      <tbody>${list.map((id) => {
        const L = byEx[id].L; const R = byEx[id].R; const B = byEx[id].B;
        // Compared in one unit, so 20 kg and 44 lb are never a 24 point gap.
        const want = state.data.settings.weightUnit || 'kg';
        const inU = (r) => fromKg(toKg(r.load, r.unit), want);
        const delta = L && R && round(inU(L), 1) !== round(inU(R), 1) ? `${round(Math.abs(inU(L) - inU(R)), 1)} ${want} ${inU(L) > inU(R) ? 'L' : 'R'}` : '';
        const top = [L, R, B].filter(Boolean).sort((a, b) => toKg(b.load, b.unit) - toKg(a.load, a.unit))[0];
        return `<tr>
          <td>${esc(exerciseById(id)?.name || id)} ${top.seeded ? '<span class="seeded-dot" title="from clinical notes">●</span>' : ''}</td>
          <td class="num mono">${L ? `${round(L.load, 2)} ${esc(L.unit)}` : '·'}</td>
          <td class="num mono">${R ? `${round(R.load, 2)} ${esc(R.unit)}` : '·'}</td>
          <td class="num mono">${B ? `${round(B.load, 2)} ${esc(B.unit)}` : '·'}</td>
          <td class="num mono tiny ${delta ? '' : 'muted'}">${esc(delta || '·')}</td>
          <td class="tiny muted mono">${top.sets ? `${top.sets} x ${top.reps ?? '?'}` : ''}</td>
          <td class="tiny muted">${esc(fmtDateNum(top.date))}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

  return `
  <section class="card">
    <header><h2>Open-chain resistance</h2><span class="sub">heaviest load you have tolerated, per side</span></header>
    <div class="card-body">
      <div class="callout small" style="margin-bottom:.8rem">
        Open chain = the foot moves freely, so the load lands almost entirely on the quad or hamstring.
        These are the numbers to quote when a new physio asks what you have been tolerating.
      </div>
      ${table(open)}
    </div>
  </section>

  <section class="card">
    <header><h2>Everything else with a load</h2></header>
    <div class="card-body">${table(other)}</div>
  </section>

  <section class="card">
    <header><h2>Bodyweight work</h2><span class="sub">most reps, longest hold or most minutes in one session, per side, no external load</span></header>
    <div class="card-body">${volumeTable()}</div>
  </section>

  <section class="card">
    <header><h2>Best test results</h2><span class="sub">personal bests across every measurement</span></header>
    <div class="card-body">
      ${prTable()}
    </div>
  </section>`;
}

/**
 * Best unloaded effort per exercise and side (Codex audit B05): the most reps,
 * the longest total hold or the most minutes, each from what was actually done.
 * Reps add up per set ([12, 10, 8] is 30, never 3 x 12); holds and timed work
 * are seconds, never the "1 rep" a hold row also carries; logged rows only.
 */
export function effortOf(e) {
  const bySet = Array.isArray(e.repsBySet) ? e.repsBySet.map(num).filter((x) => x != null && x > 0) : [];
  const secsList = Array.isArray(e.secsList) ? e.secsList.map(num).filter((x) => x != null && x > 0) : [];
  const sets = num(e.sets) || 1;
  if (secsList.length) return { kind: 'sec', total: secsList.reduce((a, b) => a + b, 0), detail: secsList.length > 1 && secsList.every((x) => x === secsList[0]) ? `${secsList.length} x ${secsList[0]} s` : `${secsList.join(' + ')} s` };
  if (num(e.secs) || num(e.hold)) { const x = num(e.secs) ?? num(e.hold); return { kind: 'sec', total: sets * x, detail: `${sets} x ${round(x, 1)} s` }; }
  if (bySet.length) return { kind: 'reps', total: bySet.reduce((a, b) => a + b, 0), detail: bySet.every((x) => x === bySet[0]) ? `${bySet.length} x ${bySet[0]}` : bySet.join(' + ') };
  if (num(e.reps)) return { kind: 'reps', total: sets * num(e.reps), detail: `${sets} x ${num(e.reps)}` };
  if (num(e.time)) return { kind: 'min', total: sets * num(e.time), detail: sets > 1 ? `${sets} x ${round(num(e.time), 2)} min` : `${round(num(e.time), 2)} min` };
  return null;
}
const EFFORT_UNIT = { reps: 'reps', sec: 's', min: 'min' };

function volumeTable() {
  const rec = {};
  for (const [date, day] of Object.entries(state.data.days)) {
    for (const e of day.entries || []) {
      if (num(e.load) || !e.logged) continue;
      const eff = effortOf(e);
      if (!eff || !(eff.total > 0)) continue;
      const side = e.side || 'B';
      const key = `${e.ex}|${side}|${eff.kind}`;
      const cur = rec[key];
      if (!cur || eff.total > cur.total) rec[key] = { ex: e.ex, side, ...eff, date, seeded: e.seeded };
    }
  }
  const name = (id) => exerciseById(id)?.name || id;
  const list = Object.values(rec).sort((a, b) => name(a.ex).localeCompare(name(b.ex)) || a.side.localeCompare(b.side));
  if (!list.length) return '<div class="empty">Nothing logged without a load yet.</div>';
  const tag = (r) => (r.side === 'L' || r.side === 'R' ? `<b class="sidetag ${r.side}">${r.side}</b> ` : '');
  const total = (r) => `${round(r.total, 1)} ${EFFORT_UNIT[r.kind]}`;
  return `<div class="only-narrow brows">${list.map((r) => `<div class="brow">
      <div class="brow-name">${tag(r)}${esc(name(r.ex))}</div>
      <div class="brow-vals"><span class="mv">${esc(String(round(r.total, 1)))}<small>${EFFORT_UNIT[r.kind]}</small></span></div>
      <div class="brow-meta">${esc(r.detail)} · ${esc(fmtDateNum(r.date))}</div>
    </div>`).join('')}</div>
  <div class="only-wide scroll-x"><table class="tbl" style="min-width:460px">
    <thead><tr><th>Exercise</th><th>Best effort</th><th class="num">Total</th><th>When</th></tr></thead>
    <tbody>${list.map((r) => `<tr>
      <td>${tag(r)}${esc(name(r.ex))} ${r.seeded ? '<span class="seeded-dot" title="from clinical notes">●</span>' : ''}</td>
      <td class="mono tiny">${esc(r.detail)}</td>
      <td class="num mono">${esc(total(r))}</td>
      <td class="tiny muted">${esc(fmtDateNum(r.date))}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function prTable() {
  const rows = MEASURES.map((m) => {
    const legs = m.perLeg ? ['L', 'R'] : [null];
    const cells = legs.map((l) => best(m.id, l, m.lower));
    if (!cells.some(Boolean)) return null;
    return { m, cells };
  }).filter(Boolean);
  if (!rows.length) return '<div class="empty">No measurements recorded yet.</div>';
  return `<div class="only-narrow mrows">${rows.map(({ m }) => metricRow(m)).join('')}</div>
  <div class="only-wide scroll-x"><table class="tbl" style="min-width:560px">
    <thead><tr><th>Test</th><th class="num">Left</th><th class="num">Right</th><th class="num">Latest</th><th>When</th></tr></thead>
    <tbody>${rows.map(({ m, cells }) => {
      const u = m.unit === 'weight' ? state.data.settings.weightUnit : UNIT_LABEL[m.unit] || '';
      const single = !m.perLeg;
      const when = cells.filter(Boolean).map((c) => c.date).sort().pop();
      const lat = m.perLeg ? [latest(m.id, 'L'), latest(m.id, 'R')] : [latest(m.id, null)];
      return `<tr>
        <td>${esc(m.label)} ${m.lower ? '<span class="pill" title="lower is better">↓ better</span>' : ''}</td>
        <td class="num mono">${single ? '' : cells[0] ? `${round(cells[0].value, 2)} ${esc(u)}` : '·'}</td>
        <td class="num mono">${single ? '' : cells[1] ? `${round(cells[1].value, 2)} ${esc(u)}` : '·'}</td>
        <td class="num mono">${lat.filter(Boolean).map((r) => round(r.value, 2)).join(' / ')} ${esc(u)}</td>
        <td class="tiny muted">${esc(fmtDateNum(when))}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------------ VALD ---
function valdView(ctx) {
  const groups = MEASURE_GROUPS.filter((g) => g.startsWith('VALD'));
  return `
  <section class="card">
    <header><h2>VALD</h2><span class="sub">Dynamo isometric strength + force plate assessments</span></header>
    <div class="card-body">
      <details class="disc" data-key="vald:source" style="margin-bottom:.6rem"><summary>Where these numbers come from</summary>
        <div class="tiny">Results from your recorded Dynamo and force plate tests, each with its own date. Percentiles are recorded alongside the raw numbers so you can see both the value and where it sits. An asymmetry printed on a report is shown as printed; one worked out here is shown in grey.</div>
      </details>
      ${groups.map((g) => {
        const ms = MEASURES.filter((m) => m.group === g);
        const tested = ms.filter((m) => measurementsFor(m.id).length);
        const untested = ms.filter((m) => !measurementsFor(m.id).length);
        return `
        <div class="section-title" style="margin-top:.9rem">${esc(g)}</div>
        ${tested.length ? `<div class="only-wide scroll-x"><table class="tbl" style="min-width:600px">
          <thead><tr><th>Metric</th><th class="num">Left</th><th class="num">Right</th><th class="num">Asym</th><th>Date</th><th></th></tr></thead>
          <tbody>${tested.map((m) => valdRow(m)).join('')}</tbody></table></div>
          <div class="only-narrow mrows">${tested.map((m) => metricRow(m)).join('')}</div>` : ''}
        ${untested.length ? `<div class="tiny muted" style="margin-top:.4rem">Not tested yet: ${untested.map((m) => esc(m.label)).join(', ')}.
          <button class="btn sm ghost" data-record="${esc(untested[0].id)}">record one</button></div>` : ''}`;
      }).join('')}
    </div>
  </section>

  ${valdCharts(ctx)}`;
}

/**
 * Report-stated asymmetry wins over anything we would compute ourselves, and
 * stays with its own report and date. A figure is only worked out here when
 * the latest left and right come from the same assessment (same date, same
 * report); results from different dates are never paired (revision 3 F06).
 */
function asymCell(L, R) {
  const stated = (L?.asym && L) || (R?.asym && R);
  if (stated) {
    const sameDay = L && R && L.date === R.date;
    return `<span title="as printed on the report">${esc(stated.asym.pct)}% ${esc(stated.asym.side)}${sameDay ? '' : ` <span class="muted">(${esc(fmtDateNum(stated.date))} report)</span>`}</span>`;
  }
  if (!pairable(L, R) || !Math.max(L.value, R.value)) return '';
  const v = round((Math.abs(L.value - R.value) / Math.max(L.value, R.value)) * 100, 1);
  return `<span class="muted" title="computed here, not from a report">${v}% ${L.value > R.value ? 'L' : 'R'}</span>`;
}

function pairable(L, R) {
  return !!(L && R && L.date === R.date && (L.src || '') === (R.src || ''));
}

/** The date of the latest result, one per side when the sides differ. */
function sideDates(L, R) {
  if (L && R && L.date !== R.date) return `L ${fmtDateNum(L.date)} · R ${fmtDateNum(R.date)}`;
  return fmtDateNum((L || R).date);
}

function valdRow(m) {
  const u = UNIT_LABEL[m.unit] || '';
  if (!m.perLeg) {
    const r = latest(m.id, null);
    return `<tr>
      <td>${esc(m.label)}${m.lower ? ' <span class="pill" title="lower is better">↓</span>' : ''}</td>
      <td class="num mono" colspan="2">${round(r.value, 2)} ${esc(u)} ${r.pctile != null ? `<span class="pill">${esc(ord(r.pctile))} pct</span>` : ''}</td>
      <td class="num mono tiny">${r.asym ? `${esc(r.asym.pct)}% ${esc(r.asym.side)}` : ''}</td>
      <td class="tiny muted">${esc(fmtDateNum(r.date))}</td>
      <td class="num"><button class="btn sm" data-record="${esc(m.id)}">+</button></td>
    </tr>`;
  }
  const L = latest(m.id, 'L'); const R = latest(m.id, 'R');
  return `<tr>
    <td>${esc(m.label)}${m.lower ? ' <span class="pill" title="lower is better">↓</span>' : ''}</td>
    <td class="num mono">${L ? `${round(L.value, 2)} ${esc(u)}` : '·'} ${L?.pctile != null ? `<span class="pill">${esc(ord(L.pctile))}</span>` : ''}</td>
    <td class="num mono">${R ? `${round(R.value, 2)} ${esc(u)}` : '·'} ${R?.pctile != null ? `<span class="pill">${esc(ord(R.pctile))}</span>` : ''}</td>
    <td class="num mono tiny">${asymCell(L, R)}</td>
    <td class="tiny muted">${esc(sideDates(L, R))}</td>
    <td class="num"><button class="btn sm" data-record="${esc(m.id)}">+</button></td>
  </tr>`;
}

function distinctDates(measureId) {
  return new Set(measurementsFor(measureId).map((r) => r.date)).size;
}

function valdCharts(ctx) {
  const withData = MEASURES.filter((m) => m.vald && distinctDates(m.id) > 1);
  if (!withData.length) {
    return `<section class="ov-sec"><div class="empty">Charts appear once a VALD metric has two or more test dates. Every VALD metric has one date so far.</div></section>`;
  }
  ctx.trend ||= {};
  const st = (ctx.trend.vald ||= {});
  if (!st.measure) st.measure = withData[0].id;
  return `<section class="ov-sec panelsec"><div class="ov-head"><h2>Trends</h2></div>
    ${renderTrend(ctx, { key: 'vald', width: trendWidth(), measures: withData.map((m) => m.id) })}</section>`;
}

function trendWidth() {
  const cw = contentWidth();
  return cw >= 940 ? cw - 324 : cw;
}

// ------------------------------------------------------------- all tests ---
function allTests() {
  return MEASURE_GROUPS.map((g) => {
    const ms = MEASURES.filter((m) => m.group === g);
    if (!ms.length) return '';
    return `<section class="card">
      <header><h2>${esc(g)}</h2></header>
      <div class="card-body tight">
        <div class="only-narrow mrows">${ms.map((m) => metricRow(m)).join('')}</div>
        <div class="only-wide scroll-x"><table class="tbl" style="min-width:520px">
          <thead><tr><th>Test</th><th class="num">Latest L</th><th class="num">Latest R</th><th>Date</th><th></th></tr></thead>
          <tbody>${ms.map((m) => {
            const u = m.unit === 'weight' ? state.data.settings.weightUnit : UNIT_LABEL[m.unit] || '';
            const L = m.perLeg ? latest(m.id, 'L') : latest(m.id, null);
            const R = m.perLeg ? latest(m.id, 'R') : null;
            const when = [L, R].filter(Boolean).map((r) => r.date).sort().pop();
            return `<tr>
              <td>${esc(m.label)}
                ${m.how ? `<details class="disc" data-key="how:${esc(m.id)}" style="margin-top:.25rem"><summary>How to test</summary><div class="tiny">${esc(m.how)}</div></details>` : ''}</td>
              <td class="num mono">${L ? `${round(L.value, 2)} ${esc(m.unit === 'grade' ? '' : u)}` : '·'}</td>
              <td class="num mono">${m.perLeg ? (R ? `${round(R.value, 2)} ${esc(m.unit === 'grade' ? '' : u)}` : '·') : ''}</td>
              <td class="tiny muted">${m.perLeg && (L || R) ? esc(sideDates(L, R)) : when ? esc(fmtDateNum(when)) : ''}</td>
              <td class="num nowrap">
                <button class="btn sm" data-record="${esc(m.id)}">Record</button>
                ${measurementsFor(m.id).length ? `<button class="btn sm ghost" data-chart="${esc(m.id)}">Chart</button>` : ''}
              </td>
            </tr>`;
          }).join('')}</tbody></table></div>
      </div>
    </section>`;
  }).join('');
}

// --------------------------------------------------------------- history ---
function historyView(ctx) {
  const focus = ctx.chartMeasure;
  const rows = state.data.measurements.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return `
  ${focus ? testsTrend(ctx, focus) : ''}
  <section class="card">
    <header><h2>Every recorded result</h2><span class="sub">${rows.length} entries</span></header>
    <div class="card-body tight">
      ${rows.length ? `<div class="only-narrow">${historyTimeline(rows, ctx)}</div>
      <div class="only-wide scroll-x"><table class="tbl" style="min-width:640px">
        <thead><tr><th>Date</th><th>Test</th><th>Side</th><th class="num">Value</th><th class="num">Pct</th><th>Source / note</th><th></th></tr></thead>
        <tbody>${rows.map((r) => {
          const m = MEASURE_BY_ID[r.measure];
          const u = m?.unit === 'weight' ? (r.unit || state.data.settings.weightUnit) : UNIT_LABEL[m?.unit] || '';
          const hit = ctx.focusTest && ctx.focusTest.measure === r.measure && ctx.focusTest.date === r.date;
          return `<tr class="${hit ? 'focus-row' : ''}">
            <td class="nowrap">${esc(fmtDateNum(r.date))}</td>
            <td>${esc(m?.label || r.measure)} ${r.seeded ? '<span class="seeded-dot" title="seeded from a report">●</span>' : ''}</td>
            <td>${r.leg ? `<span class="sidetag ${r.leg}">${r.leg}</span>` : '<span class="tiny muted">both</span>'}</td>
            <td class="num mono">${esc(String(r.value))} ${esc(m?.unit === 'grade' ? '' : u)}</td>
            <td class="num mono tiny">${r.pctile != null ? esc(r.pctile) : ''}</td>
            <td class="tiny muted">${esc([r.src, r.note].filter(Boolean).join(' · '))}</td>
            <td class="num"><button class="btn sm ghost danger" data-delm="${esc(r.id)}" aria-label="Delete this result">Delete</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Nothing recorded yet.</div>'}
    </div>
  </section>`;
}

function testsTrend(ctx, id) {
  const m = MEASURE_BY_ID[id];
  if (!m) return '';
  ctx.trend ||= {};
  const st = (ctx.trend.tests ||= {});
  if (st.measure !== id) { st.measure = id; st.sel = ctx.focusTest?.measure === id ? ctx.focusTest.date : null; }
  return `<section class="ov-sec panelsec"><div class="ov-head"><h2>${esc(m.label)}</h2>
    <button class="btn sm ghost" data-chart="">Close</button></div>
    ${renderTrend(ctx, { key: 'tests', width: trendWidth() })}</section>`;
}

function chartCardSection(id) {
  const m = MEASURE_BY_ID[id];
  if (!m) return '';
  return `<section class="card"><header><h2>${esc(m.label)}</h2>
    <button class="btn sm ghost" data-chart="">close</button></header>
    <div class="card-body">${chartCard(m)}</div></section>`;
}

function chartCard(m) {
  const series = [];
  if (m.perLeg) {
    series.push({ label: 'Left', cls: 'lineL', color: 'left', points: measurementsFor(m.id, 'L').map((r) => ({ date: r.date, value: r.value })) });
    series.push({ label: 'Right', cls: 'lineR', color: 'right', points: measurementsFor(m.id, 'R').map((r) => ({ date: r.date, value: r.value })) });
  } else {
    series.push({ label: m.label, cls: 'lineB', color: 'accent', points: measurementsFor(m.id, null).map((r) => ({ date: r.date, value: r.value })) });
  }
  const has = series.some((s) => s.points.length);
  return `<div style="margin-bottom:1rem">
    <div class="row between"><h3 style="font-size:.85rem">${esc(m.label)}</h3>
      <span class="legend">${m.perLeg
        ? '<span><i style="background:var(--left)"></i>Left</span><span><i style="background:var(--right)"></i>Right</span>'
        : ''}${m.lower ? '<span class="muted">lower is better</span>' : ''}</span></div>
    ${has ? lineChart(series.filter((s) => s.points.length), { lowerBetter: !!m.lower }) : '<div class="empty">No data.</div>'}
  </div>`;
}

// ------------------------------------------------------------ metric rows --
// On a phone a wide table is a sideways scroll for every ordinary look, so
// each metric is one row: its name, the latest values pinned on the right,
// the date under the name, and the detail (best, percentile, asymmetry, how
// to test, record, chart) behind a tap. Wider screens keep the tables.

function unitOf(m, r) {
  if (m.unit === 'grade') return '';
  if (m.unit === 'weight') return r?.unit || state.data.settings.weightUnit;
  return UNIT_LABEL[m.unit] || '';
}
function val(m, r) {
  if (!r) return '<span class="muted">·</span>';
  const u = unitOf(m, r);
  return `${esc(String(round(r.value, 2)))}${u ? `<small>${esc(u.length > 2 ? ` ${u}` : u)}</small>` : ''}`;
}

function metricRow(m) {
  const L = m.perLeg ? latest(m.id, 'L') : null;
  const R = m.perLeg ? latest(m.id, 'R') : null;
  const S = m.perLeg ? null : latest(m.id, null);
  const when = m.perLeg ? (L || R ? sideDates(L, R) : null) : S ? fmtDateNum(S.date) : null;
  const bestL = m.perLeg ? best(m.id, 'L', m.lower) : null;
  const bestR = m.perLeg ? best(m.id, 'R', m.lower) : null;
  const bestS = m.perLeg ? null : best(m.id, null, m.lower);
  const count = measurementsFor(m.id).length;
  const pct = (r) => (r?.pctile != null ? ` <span class="pill">${esc(ord(r.pctile))} pct</span>` : '');
  return `<details class="mrow" data-key="mrow:${esc(m.id)}">
    <summary>
      <span class="mrow-name">${esc(m.label)}<span class="mrow-date">${when ? esc(when) : 'not tested yet'}</span></span>
      <span class="mrow-vals">${m.perLeg
        ? `<span class="mv"><b class="sidetag L">L</b>${val(m, L)}</span><span class="mv"><b class="sidetag R">R</b>${val(m, R)}</span>`
        : `<span class="mv">${val(m, S)}</span>`}</span>
    </summary>
    <div class="mrow-body">
      ${count ? `<div class="exh-line"><span class="exh-k">Best</span><span class="exh-v">${m.perLeg
        ? `<b class="sidetag L">L</b> ${val(m, bestL)}${pct(bestL)} · <b class="sidetag R">R</b> ${val(m, bestR)}${pct(bestR)}`
        : `${val(m, bestS)}${pct(bestS)}`}${m.lower ? ' <span class="tiny muted">lower is better</span>' : ''}</span></div>` : ''}
      ${m.perLeg && L && R ? `<div class="exh-line"><span class="exh-k">Asymmetry</span><span class="exh-v">${asymCell(L, R) || (pairable(L, R) ? '·' : 'Left and right were tested on different dates')}</span></div>` : ''}
      ${m.how ? `<div class="tiny" style="margin:.3rem 0">${esc(m.how)}</div>` : ''}
      <div class="row" style="gap:.4rem;margin-top:.3rem">
        <button class="btn sm" data-record="${esc(m.id)}">Record</button>
        <button class="btn sm ghost" data-chart="${esc(m.id)}" ${count ? '' : 'disabled title="Nothing recorded to chart yet"'}>Chart</button>
        <span class="tiny muted">${count} result${count === 1 ? '' : 's'}</span>
      </div>
    </div>
  </details>`;
}

function historyTimeline(rows, ctx = {}) {
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  return `<div class="tline">${[...byDate.entries()].map(([date, list]) => `
    <div class="tline-day">
      <div class="tline-date">${esc(fmtDateNum(date))}</div>
      ${list.map((r) => {
        const m = MEASURE_BY_ID[r.measure];
        const hit = ctx.focusTest && ctx.focusTest.measure === r.measure && ctx.focusTest.date === r.date;
        return `<div class="tline-row ${hit ? 'focus-row' : ''}">
          <span class="tline-main">${esc(m?.label || r.measure)}${r.src || r.note ? `<span class="tline-sub">${esc([r.src, r.note].filter(Boolean).join(' · '))}</span>` : ''}</span>
          <span class="mv">${r.leg ? `<b class="sidetag ${r.leg}">${r.leg}</b>` : ''}${m ? val(m, r) : esc(String(r.value))}${r.pctile != null ? ` <span class="pill">${esc(ord(r.pctile))}</span>` : ''}</span>
          <button class="btn sm ghost danger" data-delm="${esc(r.id)}" aria-label="Delete this result">Delete</button>
        </div>`;
      }).join('')}
    </div>`).join('')}</div>`;
}

// ------------------------------------------------------------------ bind ---
export function bindMeasuresPanel(root, ctx, rerender) {
  bindTrend(root, ctx, rerender, {
    onOpen(measureId, date) {
      ctx.mtab = 'history';
      ctx.chartMeasure = measureId;
      ctx.focusTest = { measure: measureId, date };
      rerender();
    },
  });
  const focus = root.querySelector('.focus-row');
  if (focus && ctx.focusTest && !ctx.focusTest.scrolled) {
    ctx.focusTest.scrolled = true;
    requestAnimationFrame(() => focus.scrollIntoView({ block: 'center' }));
  }
  root.querySelectorAll('[data-mtab]').forEach((b) => b.addEventListener('click', () => {
    ctx.mtab = b.dataset.mtab; ctx.chartMeasure = null; rerender();
  }));
  root.querySelector('[data-newmeasure]')?.addEventListener('click', () => {
    openMeasureEntry({
      measureId: 'sl_calf_raise',
      date: todayIso(),
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  });
  root.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', () => {
    openMeasureEntry({
      measureId: b.dataset.record,
      date: todayIso(),
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  }));
  root.querySelectorAll('[data-chart]').forEach((b) => b.addEventListener('click', () => {
    ctx.mtab = 'history';
    ctx.chartMeasure = b.dataset.chart || null;
    rerender();
  }));
  root.querySelectorAll('[data-delm]').forEach((b) => b.addEventListener('click', () => {
    const r = state.data.measurements.find((m) => m.id === b.dataset.delm);
    const label = MEASURE_BY_ID[r?.measure]?.label || 'this result';
    if (!confirm(`Delete ${label} from ${r ? fmtDateNum(r.date) : 'that date'}? This removes it on every device.`)) return;
    update((d) => { d.measurements = d.measurements.filter((m) => m.id !== b.dataset.delm); });
    rerender();
  }));
}
