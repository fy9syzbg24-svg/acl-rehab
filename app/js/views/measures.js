import { esc, todayIso, round, fmtDateNum, uid, num, ord } from '../util.js';
import { state, update, measurementsFor, latest, best } from '../store.js';
import { MEASURES, MEASURE_BY_ID, MEASURE_GROUPS, UNIT_LABEL } from '../../data/measurements.js';
import { OPEN_CHAIN } from '../../data/exercises.js';
import { openMeasureEntry, lineChart, exerciseById } from '../components.js';

export function renderMeasuresPanel(ctx) {
  const tab = ctx.mtab || 'baselines';
  return `
    <div class="row" style="gap:.3rem">
      ${[['baselines', 'Baselines & PRs'], ['vald', 'VALD'], ['tests', 'All tests'], ['history', 'Test history']]
        .map(([k, l]) => `<button class="btn sm ${tab === k ? 'primary' : ''}" data-mtab="${k}">${l}</button>`).join('')}
      <span class="spacer"></span>
      <button class="btn primary sm" data-newmeasure>+ Record a test</button>
    </div>
    ${tab === 'baselines' ? baselines() : ''}
    ${tab === 'vald' ? valdView() : ''}
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
      const sides = e.side === 'B' ? ['L', 'R'] : [e.side || 'B'];
      for (const s of sides) {
        const key = `${e.ex}|${s}`;
        const cur = rec[key];
        const cand = { ex: e.ex, side: s, load, unit: e.loadUnit || 'kg', sets: e.sets, reps: e.reps, date, seeded: e.seeded, both: e.side === 'B' };
        if (!cur || load > cur.load) rec[key] = cand;
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

  const table = (list) => !list.length ? '<div class="empty">Nothing logged with a load yet.</div>' : `
    <div class="scroll-x"><table class="tbl" style="min-width:560px">
      <thead><tr><th>Exercise</th><th class="num">Left</th><th class="num">Right</th><th class="num">Δ</th><th>Best set</th><th>When</th></tr></thead>
      <tbody>${list.map((id) => {
        const L = byEx[id].L; const R = byEx[id].R;
        const delta = L && R && L.load !== R.load ? `${round(Math.abs(L.load - R.load), 1)} ${L.unit} ${L.load > R.load ? 'L' : 'R'}` : '';
        const top = (L && R ? (L.load >= R.load ? L : R) : L || R);
        return `<tr>
          <td>${esc(exerciseById(id)?.name || id)} ${top.seeded ? '<span class="seeded-dot" title="from clinical notes">●</span>' : ''}</td>
          <td class="num mono">${L ? `${round(L.load, 2)} ${esc(L.unit)}` : '—'}</td>
          <td class="num mono">${R ? `${round(R.load, 2)} ${esc(R.unit)}` : '—'}</td>
          <td class="num mono tiny ${delta ? '' : 'muted'}">${esc(delta || '—')}</td>
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
    <header><h2>Bodyweight work</h2><span class="sub">biggest set volume logged, no external load</span></header>
    <div class="card-body">${volumeTable()}</div>
  </section>

  <section class="card">
    <header><h2>Best test results</h2><span class="sub">personal bests across every measurement</span></header>
    <div class="card-body">
      ${prTable()}
    </div>
  </section>`;
}

/** Best unloaded effort per exercise: most total reps, or longest time. */
function volumeTable() {
  const rec = {};
  for (const [date, day] of Object.entries(state.data.days)) {
    for (const e of day.entries || []) {
      if (num(e.load)) continue;
      const sets = num(e.sets) || 1;
      const reps = num(e.reps);
      const time = num(e.time);
      if (!reps && !time) continue;
      const score = reps ? sets * reps : sets * time * 100;
      const cur = rec[e.ex];
      if (!cur || score > cur.score) rec[e.ex] = { ex: e.ex, sets, reps, time, score, date, seeded: e.seeded };
    }
  }
  const list = Object.values(rec).sort((a, b) => (exerciseById(a.ex)?.name || a.ex).localeCompare(exerciseById(b.ex)?.name || b.ex));
  if (!list.length) return '<div class="empty">Nothing logged without a load yet.</div>';
  return `<div class="scroll-x"><table class="tbl" style="min-width:460px">
    <thead><tr><th>Exercise</th><th>Best effort</th><th class="num">Total</th><th>When</th></tr></thead>
    <tbody>${list.map((r) => `<tr>
      <td>${esc(exerciseById(r.ex)?.name || r.ex)} ${r.seeded ? '<span class="seeded-dot" title="from clinical notes">●</span>' : ''}</td>
      <td class="mono tiny">${r.reps ? `${r.sets} x ${r.reps}` : `${r.sets} x ${round(r.time, 2)} min`}</td>
      <td class="num mono">${r.reps ? r.sets * r.reps + ' reps' : round(r.sets * r.time, 1) + ' min'}</td>
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
  return `<div class="scroll-x"><table class="tbl" style="min-width:560px">
    <thead><tr><th>Test</th><th class="num">Left</th><th class="num">Right</th><th class="num">Latest</th><th>When</th></tr></thead>
    <tbody>${rows.map(({ m, cells }) => {
      const u = m.unit === 'weight' ? state.data.settings.weightUnit : UNIT_LABEL[m.unit] || '';
      const single = !m.perLeg;
      const when = cells.filter(Boolean).map((c) => c.date).sort().pop();
      const lat = m.perLeg ? [latest(m.id, 'L'), latest(m.id, 'R')] : [latest(m.id, null)];
      return `<tr>
        <td>${esc(m.label)} ${m.lower ? '<span class="pill" title="lower is better">↓ better</span>' : ''}</td>
        <td class="num mono">${single ? '' : cells[0] ? `${round(cells[0].value, 2)} ${esc(u)}` : '—'}</td>
        <td class="num mono">${single ? '' : cells[1] ? `${round(cells[1].value, 2)} ${esc(u)}` : '—'}</td>
        <td class="num mono">${lat.filter(Boolean).map((r) => round(r.value, 2)).join(' / ')} ${esc(u)}</td>
        <td class="tiny muted">${esc(fmtDateNum(when))}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ------------------------------------------------------------------ VALD ---
function valdView() {
  const groups = MEASURE_GROUPS.filter((g) => g.startsWith('VALD'));
  return `
  <section class="card">
    <header><h2>VALD</h2><span class="sub">Dynamo isometric strength + force plate assessments</span></header>
    <div class="card-body">
      <div class="callout small" style="margin-bottom:.9rem">
        Seeded from your 24 Jul Dynamo test (Back In Motion) and the 31 Jul force plate session (Performance Medicine,
        report dated 3 Aug). Percentiles are recorded alongside the raw numbers so you can see both the value and where it sits.
      </div>
      ${groups.map((g) => {
        const ms = MEASURES.filter((m) => m.group === g);
        const tested = ms.filter((m) => measurementsFor(m.id).length);
        const untested = ms.filter((m) => !measurementsFor(m.id).length);
        return `
        <div class="section-title" style="margin-top:.9rem">${esc(g)}</div>
        ${tested.length ? `<div class="scroll-x"><table class="tbl" style="min-width:600px">
          <thead><tr><th>Metric</th><th class="num">Left</th><th class="num">Right</th><th class="num">Asym</th><th>Date</th><th></th></tr></thead>
          <tbody>${tested.map((m) => valdRow(m)).join('')}</tbody></table></div>` : ''}
        ${untested.length ? `<div class="tiny muted" style="margin-top:.4rem">Not tested yet: ${untested.map((m) => esc(m.label)).join(', ')}.
          <button class="btn sm ghost" data-record="${esc(untested[0].id)}">record one</button></div>` : ''}`;
      }).join('')}
    </div>
  </section>

  ${valdCharts()}`;
}

/** Report-stated asymmetry wins over anything we would compute ourselves. */
function asymCell(L, R) {
  const stated = L?.asym || R?.asym;
  if (stated) return `<span title="as printed on the report">${esc(stated.pct)}% ${esc(stated.side)}</span>`;
  if (!L || !R || !Math.max(L.value, R.value)) return '';
  const v = round((Math.abs(L.value - R.value) / Math.max(L.value, R.value)) * 100, 1);
  return `<span class="muted" title="computed here, not from a report">${v}% ${L.value > R.value ? 'L' : 'R'}</span>`;
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
    <td class="num mono">${L ? `${round(L.value, 2)} ${esc(u)}` : '—'} ${L?.pctile != null ? `<span class="pill">${esc(ord(L.pctile))}</span>` : ''}</td>
    <td class="num mono">${R ? `${round(R.value, 2)} ${esc(u)}` : '—'} ${R?.pctile != null ? `<span class="pill">${esc(ord(R.pctile))}</span>` : ''}</td>
    <td class="num mono tiny">${asymCell(L, R)}</td>
    <td class="tiny muted">${esc(fmtDateNum((L || R).date))}</td>
    <td class="num"><button class="btn sm" data-record="${esc(m.id)}">+</button></td>
  </tr>`;
}

function distinctDates(measureId) {
  return new Set(measurementsFor(measureId).map((r) => r.date)).size;
}

function valdCharts() {
  const withData = MEASURES.filter((m) => m.vald && distinctDates(m.id) > 1);
  if (!withData.length) {
    return `<section class="card"><div class="card-body">
      <div class="empty">Charts appear once a metric has two or more test dates. Right now everything has a single data point — your 24 and 31 July baselines.</div>
    </div></section>`;
  }
  return `<section class="card"><header><h2>Trends</h2></header><div class="card-body">
    ${withData.map((m) => chartCard(m)).join('')}
  </div></section>`;
}

// ------------------------------------------------------------- all tests ---
function allTests() {
  return MEASURE_GROUPS.map((g) => {
    const ms = MEASURES.filter((m) => m.group === g);
    if (!ms.length) return '';
    return `<section class="card">
      <header><h2>${esc(g)}</h2></header>
      <div class="card-body tight">
        <div class="scroll-x"><table class="tbl" style="min-width:520px">
          <thead><tr><th>Test</th><th class="num">Latest L</th><th class="num">Latest R</th><th>Date</th><th></th></tr></thead>
          <tbody>${ms.map((m) => {
            const u = m.unit === 'weight' ? state.data.settings.weightUnit : UNIT_LABEL[m.unit] || '';
            const L = m.perLeg ? latest(m.id, 'L') : latest(m.id, null);
            const R = m.perLeg ? latest(m.id, 'R') : null;
            const when = [L, R].filter(Boolean).map((r) => r.date).sort().pop();
            return `<tr>
              <td>${esc(m.label)}
                ${m.how ? `<details class="disc" style="margin-top:.25rem"><summary>how to test</summary><div class="tiny">${esc(m.how)}</div></details>` : ''}</td>
              <td class="num mono">${L ? `${round(L.value, 2)} ${esc(m.unit === 'grade' ? '' : u)}` : '—'}</td>
              <td class="num mono">${m.perLeg ? (R ? `${round(R.value, 2)} ${esc(m.unit === 'grade' ? '' : u)}` : '—') : ''}</td>
              <td class="tiny muted">${when ? esc(fmtDateNum(when)) : ''}</td>
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
  ${focus ? chartCardSection(focus) : ''}
  <section class="card">
    <header><h2>Every recorded result</h2><span class="sub">${rows.length} entries</span></header>
    <div class="card-body tight">
      ${rows.length ? `<div class="scroll-x"><table class="tbl" style="min-width:640px">
        <thead><tr><th>Date</th><th>Test</th><th>Side</th><th class="num">Value</th><th class="num">Pct</th><th>Source / note</th><th></th></tr></thead>
        <tbody>${rows.map((r) => {
          const m = MEASURE_BY_ID[r.measure];
          const u = m?.unit === 'weight' ? (r.unit || state.data.settings.weightUnit) : UNIT_LABEL[m?.unit] || '';
          return `<tr>
            <td class="nowrap">${esc(fmtDateNum(r.date))}</td>
            <td>${esc(m?.label || r.measure)} ${r.seeded ? '<span class="seeded-dot" title="seeded from a report">●</span>' : ''}</td>
            <td>${r.leg ? `<span class="sidetag ${r.leg}">${r.leg}</span>` : '<span class="tiny muted">both</span>'}</td>
            <td class="num mono">${esc(String(r.value))} ${esc(m?.unit === 'grade' ? '' : u)}</td>
            <td class="num mono tiny">${r.pctile != null ? esc(r.pctile) : ''}</td>
            <td class="tiny muted">${esc([r.src, r.note].filter(Boolean).join(' · '))}</td>
            <td class="num"><button class="btn sm ghost danger" data-delm="${esc(r.id)}">✕</button></td>
          </tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty">Nothing recorded yet.</div>'}
    </div>
  </section>`;
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

// ------------------------------------------------------------------ bind ---
export function bindMeasuresPanel(root, ctx, rerender) {
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
    update((d) => { d.measurements = d.measurements.filter((m) => m.id !== b.dataset.delm); });
    rerender();
  }));
}
