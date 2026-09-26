import { esc, todayIso, round, fmtDateShort, uid, num, ord, toKg, fromKg } from '../util.js';
import { state, update, measurementsFor, latest, best, allMeasurements } from '../store.js';
import { MEASURES, MEASURE_BY_ID, MEASURE_GROUPS, UNIT_LABEL, FAMILIES, toN, fromN } from '../../data/measurements.js';
import { OPEN_CHAIN } from '../../data/exercises.js';
import { openMeasureEntry, lineChart, exerciseById } from '../components.js';
import { ptMark } from '../ptmark.js';
import { renderTrend, bindTrend } from '../trend.js';
import { LEVELS, refsFor, inMeasureUnit, ageFrom } from '../../data/norms.js';
import { bodyweightKg } from '../goals.js';
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
        const cand = { ex: e.ex, side: s, load, unit: e.loadUnit || state.data.settings.weightUnit || 'kg', sets: e.sets, reps: e.reps, date, seeded: e.seeded, clinic: e.clinic, both: e.side === 'B' };
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
      <div class="brow-meta">${top.sets ? `best set ${esc(`${top.sets} x ${top.reps ?? '?'}`)} · ` : ''}${esc(fmtDateShort(top.date))}</div>
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
          <td>${esc(exerciseById(id)?.name || id)} ${ptMark(top)}</td>
          <td class="num mono">${L ? `${round(L.load, 2)} ${esc(L.unit)}` : '·'}</td>
          <td class="num mono">${R ? `${round(R.load, 2)} ${esc(R.unit)}` : '·'}</td>
          <td class="num mono">${B ? `${round(B.load, 2)} ${esc(B.unit)}` : '·'}</td>
          <td class="num mono tiny ${delta ? '' : 'muted'}">${esc(delta || '·')}</td>
          <td class="tiny muted mono">${top.sets ? `${top.sets} x ${top.reps ?? '?'}` : ''}</td>
          <td class="tiny muted">${esc(fmtDateShort(top.date))}</td>
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

  ${familyCard()}

  <section class="card">
    <header><h2>Best test results</h2><span class="sub">personal bests across every measurement</span></header>
    <div class="card-body">
      ${prTable()}
    </div>
  </section>`;
}

/**
 * The same movement on two devices, one row per test, in one unit (2026-09-16).
 * The unit is the newest test's; the others are converted and their recorded
 * value kept beside. Nothing is joined or scored across rows: a different
 * device, tester and position is a different test, and the card says so.
 */
function familyCard() {
  const byFam = {};
  for (const m of MEASURES) if (m.family) (byFam[m.family] ||= []).push(m);
  const dateOf = (x) => [x.L, x.R].filter(Boolean).map((r) => r.date).sort().pop() || '';
  const blocks = Object.entries(FAMILIES).map(([fam, label]) => {
    const tests = (byFam[fam] || []).map((m) => ({ m, L: latest(m.id, 'L'), R: latest(m.id, 'R') }))
      .filter((x) => x.L || x.R).sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1));
    if (tests.length < 2) return '';
    const want = tests[tests.length - 1].m.unit;
    const shown = (r, m) => (r ? `${round(fromN(toN(r.value, m.unit), want), 1)}` : null);
    const orig = (r, m) => (r && m.unit !== want ? `${round(r.value, 2)} ${UNIT_LABEL[m.unit]}` : '');
    const cell = (r, m, tag) => `<span class="mv"><b class="sidetag ${tag}">${tag}</b>${r ? `${esc(shown(r, m))}<small>${esc(UNIT_LABEL[want])}</small>` : '<span class="muted">·</span>'}</span>`;
    const rows = tests.map(({ m, L, R }) => ({ m, L, R, when: sideDates(L, R), setup: [m.device, m.setup].filter(Boolean).join(', '), recorded: [orig(L, m) ? `L ${orig(L, m)}` : '', orig(R, m) ? `R ${orig(R, m)}` : ''].filter(Boolean).join(' · ') }));
    return `<div class="fam">
      <div class="fam-title">${esc(label)}</div>
      <div class="only-narrow brows">${rows.map((r) => `<div class="brow">
          <div class="brow-name">${esc(r.setup)}</div>
          <div class="brow-vals">${cell(r.L, r.m, 'L')}${cell(r.R, r.m, 'R')}</div>
          <div class="brow-meta">${esc(r.when)}${r.recorded ? ` · recorded as ${esc(r.recorded)}` : ''}</div>
        </div>`).join('')}</div>
      <div class="only-wide scroll-x"><table class="tbl" style="min-width:520px">
        <thead><tr><th>Test</th><th class="num">Left</th><th class="num">Right</th><th>Recorded as</th><th>When</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.setup)}</td>
          <td class="num mono">${r.L ? `${esc(shown(r.L, r.m))} ${esc(UNIT_LABEL[want])}` : '·'}</td>
          <td class="num mono">${r.R ? `${esc(shown(r.R, r.m))} ${esc(UNIT_LABEL[want])}` : '·'}</td>
          <td class="tiny muted">${esc(r.recorded || 'as shown')}</td>
          <td class="tiny muted">${esc(r.when)}</td>
        </tr>`).join('')}</tbody></table></div>
    </div>`;
  }).filter(Boolean);
  if (!blocks.length) return '';
  return `
  <section class="card">
    <header><h2>Same movement, two devices</h2><span class="sub">one unit so the rows read together</span></header>
    <div class="card-body">
      <div class="callout small" style="margin-bottom:.8rem">
        Different devices, testers and positions. The step between rows is partly the test, not all you, so nothing here is scored or joined; each test keeps its own chart.
      </div>
      ${blocks.join('')}
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
      if (!cur || eff.total > cur.total) rec[key] = { ex: e.ex, side, ...eff, date, seeded: e.seeded, clinic: e.clinic };
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
      <div class="brow-meta">${esc(r.detail)} · ${esc(fmtDateShort(r.date))}</div>
    </div>`).join('')}</div>
  <div class="only-wide scroll-x"><table class="tbl" style="min-width:460px">
    <thead><tr><th>Exercise</th><th>Best effort</th><th class="num">Total</th><th>When</th></tr></thead>
    <tbody>${list.map((r) => `<tr>
      <td>${tag(r)}${esc(name(r.ex))} ${ptMark(r)}</td>
      <td class="mono tiny">${esc(r.detail)}</td>
      <td class="num mono">${esc(total(r))}</td>
      <td class="tiny muted">${esc(fmtDateShort(r.date))}</td>
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
      const single = !m.perLeg;
      const cell = (r) => `${esc(String(showValue(r.value)))} ${esc(unitOf(m, r))}`;
      const when = cells.filter(Boolean).map((c) => c.date).sort().pop();
      const lat = m.perLeg ? [latest(m.id, 'L'), latest(m.id, 'R')] : [latest(m.id, null)];
      return `<tr>
        <td>${esc(m.label)} ${m.lower ? '<span class="pill" title="lower is better">↓ better</span>' : ''}</td>
        <td class="num mono">${single ? '' : cells[0] ? cell(cells[0]) : '·'}</td>
        <td class="num mono">${single ? '' : cells[1] ? cell(cells[1]) : '·'}</td>
        <td class="num mono">${lat.filter(Boolean).map(cell).join(' / ')}</td>
        <td class="tiny muted">${esc(fmtDateShort(when))}</td>
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
    return `<span title="as printed on the report">${esc(stated.asym.pct)}% ${esc(stated.asym.side)}${sameDay ? '' : ` <span class="muted">(${esc(fmtDateShort(stated.date))} report)</span>`}</span>`;
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
  if (L && R && L.date !== R.date) return `L ${fmtDateShort(L.date)} · R ${fmtDateShort(R.date)}`;
  return fmtDateShort((L || R).date);
}

function valdRow(m) {
  const u = UNIT_LABEL[m.unit] || '';
  if (!m.perLeg) {
    const r = latest(m.id, null);
    return `<tr>
      <td>${esc(m.label)}${m.lower ? ' <span class="pill" title="lower is better">↓</span>' : ''}</td>
      <td class="num mono" colspan="2">${round(r.value, 2)} ${esc(u)} ${r.pctile != null ? `<span class="pill">${esc(ord(r.pctile))} pct</span>` : ''}</td>
      <td class="num mono tiny">${r.asym ? `${esc(r.asym.pct)}% ${esc(r.asym.side)}` : ''}</td>
      <td class="tiny muted">${esc(fmtDateShort(r.date))}</td>
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
    const any = MEASURES.some((m) => m.vald && distinctDates(m.id) > 0);
    return `<section class="ov-sec"><div class="empty">Charts appear once a VALD metric has two or more test dates.${any ? ' Every VALD metric has one date so far.' : ''}</div></section>`;
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

// --------------------------------------------------------- where you stand --
/**
 * His latest result per test against published reference levels (2026-09-16):
 * a track per test with the typical band (mean and one standard deviation when
 * the paper gives it), the college athlete mark, and his left and right dots.
 * Only tests with a real reference AND a result of his are drawn; a reference
 * that cannot be put in the test's unit is named under the row, never placed.
 * Percent of a reference is arithmetic on two printed numbers, nothing more.
 */
function standView() {
  const s = state.data.settings;
  const sex = s.sex || null;
  const age = ageFrom(s.dob);
  const bw = bodyweightKg();
  const missing = [!sex && 'sex', age == null && 'date of birth'].filter(Boolean);
  const groups = [];
  for (const g of MEASURE_GROUPS) {
    const rows = [];
    for (const m of MEASURES.filter((x) => x.group === g)) {
      const refs = refsFor(m.id, { sex, age });
      if (!refs.length) continue;
      const L = m.perLeg ? latest(m.id, 'L') : latest(m.id, null);
      const R = m.perLeg ? latest(m.id, 'R') : null;
      if (!L && !R) continue;
      rows.push(standRow(m, L, R, refs.map((r) => ({ r, ...inMeasureUnit(r, m, bw, { weightUnit: s.weightUnit || 'kg' }) }))));
    }
    if (rows.length) groups.push(`<div class="st-group"><div class="section-title">${esc(g)}</div>${rows.join('')}</div>`);
  }
  return `
  <section class="card">
    <header><h2>Where you stand</h2><span class="sub">your latest result on each test, beside published reference levels</span></header>
    <div class="card-body">
      <div class="callout small" style="margin-bottom:.8rem">
        ${missing.length ? `Set your ${esc(missing.join(' and '))} in Settings to pick the band for someone like you; until then only references with no sex or age band are shown. ` : ''}
        Every mark is a printed figure from the paper named under the row, converted only between force units or by your bodyweight. A different protocol is said where it differs. Nothing here is a verdict.
      </div>
      ${groups.length ? groups.join('') : '<div class="empty">No reference level matches a test you have recorded yet.</div>'}
    </div>
  </section>`;
}

function standRow(m, L, R, placed) {
  const u = unitOf(m, L || R);
  const ok = placed.filter((p) => p.value != null);
  const no = placed.filter((p) => p.value == null);
  const vals = [L?.value, R?.value, ...ok.map((p) => p.value + (p.sd || 0))].filter((v) => typeof v === 'number' && Number.isFinite(v));
  const max = (Math.max(...vals) || 1) * 1.08;
  const pct = (v) => Math.max(0, Math.min(100, (v / max) * 100));
  const at = (v) => `${pct(v).toFixed(1)}%`;
  // Reference labels sit above the track; when two marks are close the second
  // label steps up a line so the words never sit on each other.
  const sorted = ok.slice().sort((a, b) => a.value - b.value);
  let lifted = 0;
  const marks = sorted.map((p, i) => {
    const prev = sorted[i - 1];
    lifted = prev && pct(p.value) - pct(prev.value) < 18 ? Math.min(2, lifted + 1) : 0;
    const lift = lifted ? ` up${lifted}` : '';
    // A label near either end of the track hangs inward, never past the edge.
    const edge = pct(p.value) > 80 ? ' end' : pct(p.value) < 20 ? ' start' : '';
    return `${p.sd != null ? `<span class="st-band ${p.r.level}" style="left:${at(p.value - p.sd)};width:${(pct(p.value + p.sd) - pct(p.value - p.sd)).toFixed(1)}%"></span>` : ''}
      <span class="st-tick ${p.r.level}" style="left:${at(p.value)}"></span>
      <span class="st-lab ${p.r.level}${lift}${edge}" style="left:${at(p.value)}">${esc(LEVELS[p.r.level] || p.r.level)} ${esc(String(round(p.value, 0)))}</span>`;
  }).join('');
  // Two legs within a dot's width of each other straddle the track, left
  // above and right below, so neither ever hides the other.
  const pair = L && R && m.perLeg && Math.abs(pct(L.value) - pct(R.value)) < 4 ? ' pair' : '';
  const dots = [['L', L], ['R', R]].filter(([, r]) => r).map(([leg, r]) => `<span class="st-dot ${m.perLeg ? leg : 'B'}${pair}" style="left:${at(r.value)}" title="${esc(m.perLeg ? (leg === 'L' ? 'Left' : 'Right') : 'You')} ${esc(String(round(r.value, 1)))} ${esc(u)}"></span>`).join('');
  const share = (r) => ok.map((p) => `${Math.round((r.value / p.value) * 100)}% of ${(LEVELS[p.r.level] || p.r.level).toLowerCase()}`).join(' · ');
  const vals2 = [['L', L], ['R', R]].filter(([, r]) => r).map(([leg, r]) => `<span class="st-val"><b class="sidetag ${m.perLeg ? leg : 'B'}">${m.perLeg ? leg : 'You'}</b> ${esc(String(round(r.value, 1)))} ${esc(u)}${m.lower ? '' : ` <span class="muted">${esc(share(r))}</span>`}</span>`).join('');
  const src = placed.map((p) => {
    const r = p.r;
    const who = [r.population, r.protocol].filter(Boolean).join('. ');
    const printed = `${round(r.value, 2)}${r.sd != null ? ` ± ${round(r.sd, 2)}` : ''} ${r.unit}`;
    const cite = r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source);
    return `<div class="st-src"><b>${esc(LEVELS[r.level] || r.level)}</b> ${p.value == null ? `not placed: ${esc(p.why)}. ` : ''}${esc(printed)}${p.value != null && r.unit !== m.unit ? ` (${esc(String(round(p.value, 1)))} ${esc(u)} here)` : ''}. ${esc(who)}${who ? '. ' : ''}${cite}${r.also ? `. ${esc(r.also)}` : ''}</div>`;
  }).join('');
  return `<div class="st-row">
    <div class="st-name">${esc(m.label)}${m.lower ? ' <span class="pill" title="lower is better">↓ better</span>' : ''}</div>
    <div class="st-track">${marks}${dots}</div>
    <div class="st-vals">${vals2}</div>
    ${src}
  </div>`;
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
            const L = m.perLeg ? latest(m.id, 'L') : latest(m.id, null);
            const R = m.perLeg ? latest(m.id, 'R') : null;
            const when = [L, R].filter(Boolean).map((r) => r.date).sort().pop();
            // A grade ("4/5", "Trace") prints as recorded, never through round(),
            // which made it NaN; a load carries the unit it was recorded in.
            const cell = (r) => `${esc(String(showValue(r.value)))} ${esc(unitOf(m, r))}`;
            return `<tr>
              <td>${esc(m.label)}
                ${m.how ? `<details class="disc" data-key="how:${esc(m.id)}" style="margin-top:.25rem"><summary>How to test</summary><div class="tiny">${esc(m.how)}</div></details>` : ''}</td>
              <td class="num mono">${L ? cell(L) : '·'}</td>
              <td class="num mono">${m.perLeg ? (R ? cell(R) : '·') : ''}</td>
              <td class="tiny muted">${m.perLeg && (L || R) ? esc(sideDates(L, R)) : when ? esc(fmtDateShort(when)) : ''}</td>
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
  // A comparator that returns 0 on a tie keeps equal dates in a stable order.
  const rows = allMeasurements().slice().sort((a, b) => b.date.localeCompare(a.date) || String(a.id).localeCompare(String(b.id)));
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
            <td class="nowrap">${esc(fmtDateShort(r.date))}</td>
            <td>${esc(m?.label || r.measure)} ${!r.history && ptMark(r) ? ptMark(r) : r.seeded ? '<span class="seeded-dot" title="seeded from a report">●</span>' : ''}</td>
            <td>${r.leg ? `<span class="sidetag ${r.leg}">${r.leg}</span>` : '<span class="tiny muted">both</span>'}</td>
            <td class="num mono">${esc(String(r.value))} ${esc(m?.unit === 'grade' ? '' : u)}</td>
            <td class="num mono tiny">${r.pctile != null ? esc(r.pctile) : ''}</td>
            <td class="tiny muted">${esc([r.src, r.note].filter(Boolean).join(' · '))}</td>
            <td class="num">${r.history ? ptMark(r) : `<button class="btn sm ghost danger" data-delm="${esc(r.id)}" aria-label="Delete this result">Delete</button>`}</td>
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
/** A number rounded for show; a grade or any other text exactly as recorded. */
const showValue = (v) => (typeof v === 'number' ? round(v, 2) : v);
function val(m, r) {
  if (!r) return '<span class="muted">·</span>';
  const u = unitOf(m, r);
  return `${esc(String(showValue(r.value)))}${u ? `<small>${esc(u.length > 2 ? ` ${u}` : u)}</small>` : ''}`;
}

function metricRow(m) {
  const L = m.perLeg ? latest(m.id, 'L') : null;
  const R = m.perLeg ? latest(m.id, 'R') : null;
  const S = m.perLeg ? null : latest(m.id, null);
  const when = m.perLeg ? (L || R ? sideDates(L, R) : null) : S ? fmtDateShort(S.date) : null;
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
        ${count ? `<button class="btn sm ghost" data-chart="${esc(m.id)}">Chart</button>` : ''}
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
      <div class="tline-date">${esc(fmtDateShort(date))}</div>
      ${list.map((r) => {
        const m = MEASURE_BY_ID[r.measure];
        const hit = ctx.focusTest && ctx.focusTest.measure === r.measure && ctx.focusTest.date === r.date;
        return `<div class="tline-row ${hit ? 'focus-row' : ''}">
          <span class="tline-main">${esc(m?.label || r.measure)}${ptMark(r)}${r.src || r.note ? `<span class="tline-sub">${esc([r.src, r.note].filter(Boolean).join(' · '))}</span>` : ''}</span>
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
    if (!confirm(`Delete ${label} from ${r ? fmtDateShort(r.date) : 'that date'}? This removes it on every device.`)) return;
    update((d) => { d.measurements = d.measurements.filter((m) => m.id !== b.dataset.delm); });
    rerender();
  }));
}
