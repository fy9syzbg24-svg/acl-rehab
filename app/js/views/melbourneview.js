import { esc, currentDayIso, round, lsi as calcLsi, fmtDateNum, uid, toKg } from '../util.js';
import { state, update, latest, best } from '../store.js';
import { MELBOURNE_PHASES, MRSS_PART_A, MRSS_PART_D, MRSS_PART_F, lsiPoints } from '../../data/melbourne.js';
import { MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { ACL_RSI, TSK11, IKDC, scoreAclRsi, scoreTsk11, scoreIkdc } from '../../data/questionnaires.js';
import { openMeasureEntry } from '../components.js';

const BILATERAL_NOTE =
  'Both of your knees are reconstructed, so a limb symmetry index compares two operated legs — it can read 100% while both are well below where they need to be. Treat the absolute hurdles (reps, seconds, degrees, bodyweight multiples) as the real test, and read LSI as a balance check only. Your own 6-month plan makes the same point.';

// --------------------------------------------------------------- scoring ---
function measureState(row) {
  const g = row.goal || {};
  const store = state.data.melbourne.measures[row.id] || {};
  const m = row.measure ? MEASURE_BY_ID[row.measure] : null;

  if (g.kind === 'manual') {
    return { status: store.pass ? 'pass' : 'none', text: store.pass ? 'marked complete' : '—', manual: true };
  }
  if (g.kind === 'rating') {
    const r = store.rating;
    return { status: r ? (g.allowed.includes(r) ? 'pass' : 'fail') : 'none', text: r || '—', rating: true };
  }
  if (g.kind === 'mrss') {
    const a = latestMrss();
    if (!a) return { status: 'none', text: 'not scored yet' };
    const s = mrssTotal(a).final;
    return { status: s >= g.target ? 'pass' : 'fail', text: `${round(s, 1)} / 100` };
  }
  if (!m) return { status: 'none', text: '—' };

  const u = UNIT_LABEL[m.unit] || '';
  if (g.kind === 'ratio') {
    const bw = bodyweightKg();
    if (!bw) return { status: 'none', text: 'set bodyweight in settings' };
    const legs = m.perLeg ? ['L', 'R'] : [null];
    const vals = legs.map((l) => best(row.measure, l)).filter(Boolean)
      .map((r) => toKg(r.value, r.unit || state.data.settings.weightUnit) / bw);
    if (!vals.length) return { status: 'none', text: 'not tested' };
    const worst = Math.min(...vals);
    return { status: worst >= g.target ? 'pass' : 'fail', text: `${round(worst, 2)}x BW` };
  }

  if (!m.perLeg) {
    const rec = latest(row.measure, null);
    if (!rec) return { status: 'none', text: 'not tested' };
    if (g.kind === 'grade') {
      return { status: g.allowed.includes(rec.value) ? 'pass' : 'fail', text: String(rec.value) };
    }
    const ok = g.cmp === '<=' ? rec.value <= g.target : rec.value >= g.target;
    return { status: ok ? 'pass' : 'fail', text: `${round(rec.value, 1)} ${u}`.trim() };
  }

  const L = latest(row.measure, 'L');
  const R = latest(row.measure, 'R');
  if (!L && !R) return { status: 'none', text: 'not tested' };

  if (g.kind === 'grade') {
    const bad = [L, R].filter(Boolean).some((r) => !g.allowed.includes(r.value));
    return { status: bad ? 'fail' : 'pass', text: `L ${L?.value ?? '—'} · R ${R?.value ?? '—'}` };
  }

  const text = `L ${L ? round(L.value, 1) : '—'} · R ${R ? round(R.value, 1) : '—'} ${u}`.trim();
  const lsiVals = L && R ? [calcLsi(L.value, R.value), calcLsi(R.value, L.value)] : [];
  const worstLsi = lsiVals.length ? Math.min(...lsiVals) : null;

  if (g.kind === 'lsi') {
    if (worstLsi === null) return { status: 'none', text, lsi: worstLsi };
    return { status: worstLsi >= g.target ? 'pass' : 'fail', text, lsi: worstLsi };
  }
  if (g.kind === 'hurdle_lsi') {
    if (!L || !R) return { status: 'none', text, lsi: worstLsi };
    const hurdleOk = L.value >= g.hurdle && R.value >= g.hurdle;
    const lsiOk = worstLsi != null && worstLsi >= g.lsi;
    return { status: hurdleOk && lsiOk ? 'pass' : 'fail', text, lsi: worstLsi, hurdleOk };
  }
  // absolute, both legs
  const ok = [L, R].filter(Boolean).every((r) => (g.cmp === '<=' ? r.value <= g.target : r.value >= g.target));
  const complete = L && R;
  return { status: complete ? (ok ? 'pass' : 'fail') : 'none', text, lsi: worstLsi };
}

function bodyweightKg() {
  const rec = latest('bodyweight', null);
  if (rec) return toKg(rec.value, rec.unit || state.data.settings.weightUnit);
  const s = state.data.settings.bodyweight;
  return s ? toKg(s, state.data.settings.weightUnit) : null;
}

export function phaseSummary(phase) {
  const rows = (phase.measures || []).map(measureState);
  const passed = rows.filter((r) => r.status === 'pass').length;
  return { passed, total: rows.length };
}

// ---------------------------------------------------------------- render ---
export function renderMelbourne(ctx) {
  if (ctx.mrssId) return renderMrssForm(ctx);

  const openId = ctx.phase || 'phase2';
  const phase = MELBOURNE_PHASES.find((p) => p.id === openId) || MELBOURNE_PHASES[2];

  return `
  <div class="stack">
    <section class="card">
      <header class="hero"><h2>Melbourne ACL Rehabilitation Guide 2.0</h2><span class="sub">criteria-driven — the criteria set the pace, not the calendar</span></header>
      <div class="card-body">
        <div class="callout warn small" style="margin-bottom:.8rem"><strong>Bilateral reconstruction.</strong> ${esc(BILATERAL_NOTE)}</div>
        <div class="tabrow">
          ${MELBOURNE_PHASES.map((p) => {
            const s = phaseSummary(p);
            const on = p.id === openId;
            return `<button class="btn sm ${on ? 'primary' : ''}" data-phase="${p.id}">
              ${esc(p.name)}${s.total ? ` <span class="mono" style="opacity:.75">${s.passed}/${s.total}</span>` : ''}
            </button>`;
          }).join('')}
        </div>
      </div>
    </section>

    <section class="card">
      <header>
        <div><h2>${esc(phase.name)} · ${esc(phase.title)}</h2>
          ${phase.archived ? '<div class="sub">already behind you — kept for reference and back-comparison</div>' : ''}</div>
        <label class="row tiny" style="gap:.3rem"><input type="checkbox" data-phasedone="${phase.id}"
          ${state.data.melbourne.phases[phase.id]?.completed ? 'checked' : ''}> phase complete</label>
      </header>
      <div class="card-body">
        <div class="section-title">Most important goals</div>
        <ul class="plain">${phase.keyGoals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
        ${phase.note ? `<div class="callout small" style="margin-top:.7rem">${esc(phase.note)}</div>` : ''}

        ${phase.hurdles ? `
          <div class="section-title" style="margin-top:1rem">Hurdle criteria before ${esc(phase.name)} testing</div>
          <ul class="plain">${phase.hurdles.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}

        <div class="section-title" style="margin-top:1rem">Outcome measures</div>
        ${measureTable(phase.measures)}

        ${phase.supplementary ? `
          <div class="section-title" style="margin-top:1rem">Supplementary goals
            <span class="pill">bonus — not a road-block</span></div>
          ${measureTable(phase.supplementary)}` : ''}
      </div>
    </section>

    ${openId === 'phase4' ? mrssSection() : ''}
  </div>`;
}

function measureTable(rows) {
  return `<div class="scroll-x"><table class="tbl" style="min-width:600px"><thead>
    <tr><th>Test</th><th>Goal</th><th>Latest</th><th class="num">LSI</th><th></th><th></th></tr>
  </thead><tbody>
  ${rows.map((row) => {
    const st = measureState(row);
    const cls = st.status === 'pass' ? 'good' : st.status === 'fail' ? 'bad' : '';
    return `<tr>
      <td>
        <div>${esc(row.label)}</div>
        ${row.how || MEASURE_BY_ID[row.measure]?.how
          ? `<details class="disc" style="margin-top:.25rem"><summary>how to test</summary><div class="tiny">${esc(row.how || MEASURE_BY_ID[row.measure].how)}</div></details>` : ''}
      </td>
      <td class="tiny muted">${esc(row.goalText || '')}</td>
      <td class="tiny${/\d/.test(st.text) ? ' mono' : ''}">${esc(st.text)}</td>
      <td class="num mono tiny" title="Less meaningful with two reconstructed knees">${st.lsi != null ? esc(round(st.lsi, 0)) + '%' : ''}</td>
      <td>${st.status === 'none' ? '<span class="pill">not tested</span>' : `<span class="pill ${cls}">${st.status === 'pass' ? 'met' : 'not yet'}</span>`}</td>
      <td class="num nowrap">
        ${st.manual ? `<label class="row tiny" style="gap:.25rem"><input type="checkbox" data-mmanual="${esc(row.id)}" ${state.data.melbourne.measures[row.id]?.pass ? 'checked' : ''}> done</label>` : ''}
        ${st.rating ? `<select data-mrating="${esc(row.id)}" class="sel-sm">
            <option value="">—</option>${row.goal.options.map((o) => `<option ${state.data.melbourne.measures[row.id]?.rating === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
          </select>` : ''}
        ${row.measure ? `<button class="btn sm" data-record="${esc(row.measure)}">Record</button>` : ''}
      </td>
    </tr>`;
  }).join('')}
  </tbody></table></div>`;
}

// ------------------------------------------------------------------ MRSS ---
export function latestMrss() {
  const list = state.data.mrss || [];
  if (!list.length) return null;
  return list.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
}

export function mrssTotal(a) {
  const partA = MRSS_PART_A.reduce((s, it) => s + (a.partA?.[it.id] ?? 0), 0);
  const partAConv = partA / 2; // /20 -> /10

  const rsi = scoreAclRsi(a.aclrsi || []);
  const rsiPts = rsi == null ? 0 : rsi > 90 ? 10 : 0;
  const ikdc = scoreIkdc(a.ikdc || {});
  const ikdcPts = ikdc == null ? 0 : ikdc.score / 10;
  const partB = rsiPts + ikdcPts;

  const tsk = scoreTsk11(a.tsk || []);
  const tskPass = tsk == null ? null : tsk <= 18;

  const partD = MRSS_PART_D.reduce((s, it) => s + (a.partD?.[it.id] ?? 0), 0);
  const partF = MRSS_PART_F.reduce((s, it) => s + (a.partF?.[it.id] ?? 0), 0);

  const fitnessPass = a.partE?.t1 === 'Pass' && a.partE?.t2 === 'Pass';

  return {
    partA, partAConv, partB, rsi, rsiPts, ikdc, ikdcPts, tsk, tskPass, partD, partF, fitnessPass,
    final: partAConv + partB + partD + partF,
  };
}

function mrssSection() {
  const list = (state.data.mrss || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return `
  <section class="card">
    <header>
      <h2>Melbourne Return to Sport Score 2.0</h2>
      <button class="btn primary sm" data-newmrss>+ New assessment</button>
    </header>
    <div class="card-body">
      <div class="callout small" style="margin-bottom:.8rem">
        Six parts: A stability/swelling/range (/10 after conversion), B ACL-RSI + IKDC (/20), C TSK-11 (pass/fail hurdle),
        D functional testing (/50), E general fitness (pass/fail hurdle), F functional testing fatigued (/20).
        The guide suggests two sessions at least 3 days apart — A–D first, then E and F.
      </div>
      ${list.length ? `<table class="tbl"><thead><tr><th>Date</th><th class="num">Score</th><th>TSK-11</th><th>Fitness</th><th></th></tr></thead><tbody>
        ${list.map((a) => {
          const t = mrssTotal(a);
          return `<tr>
            <td>${esc(fmtDateNum(a.date))}</td>
            <td class="num mono"><strong>${round(t.final, 1)}</strong> / 100</td>
            <td>${t.tsk == null ? '<span class="muted tiny">—</span>' : `<span class="pill ${t.tskPass ? 'good' : 'bad'}">${t.tsk} ${t.tskPass ? 'pass' : 'fail'}</span>`}</td>
            <td>${a.partE?.t1 ? `<span class="pill ${t.fitnessPass ? 'good' : 'bad'}">${t.fitnessPass ? 'pass' : 'fail'}</span>` : '<span class="muted tiny">—</span>'}</td>
            <td class="num"><button class="btn sm" data-openmrss="${esc(a.id)}">Open</button></td>
          </tr>`;
        }).join('')}
      </tbody></table>` : '<div class="empty">No assessment yet. Phase 4 asks for 95+.</div>'}
    </div>
  </section>`;
}

function renderMrssForm(ctx) {
  const a = (state.data.mrss || []).find((x) => x.id === ctx.mrssId);
  if (!a) return '<div class="empty">Assessment not found.</div>';
  const t = mrssTotal(a);

  const slider = (path, i, val, lo, hi, q) => `
    <div style="margin-bottom:.6rem">
      <div class="small">${i + 1}. ${esc(q)}</div>
      <input type="range" min="0" max="100" step="10" data-q="${path}" data-i="${i}" value="${val ?? 50}">
      <div class="row between tiny muted"><span>${esc(lo)}</span><strong class="mono">${val ?? '—'}</strong><span>${esc(hi)}</span></div>
    </div>`;

  return `
  <div class="stack">
    <div class="row between">
      <button class="btn ghost" data-backmrss>‹ Back to Melbourne</button>
      <div class="row">
        <label class="fld" style="width:150px">Date<input type="date" data-mdate value="${esc(a.date)}"></label>
        <button class="btn danger" data-delmrss>Delete</button>
      </div>
    </div>

    <section class="card">
      <header><h2>Final score</h2></header>
      <div class="card-body">
        <div class="kpis">
          <div class="kpi"><div class="v">${round(t.final, 1)}</div><div class="k">/ 100 · need 95+</div></div>
          <div class="kpi"><div class="v">${t.tsk ?? '—'}</div><div class="k">TSK-11 ${t.tskPass == null ? '' : t.tskPass ? '· pass' : '· FAIL'}</div></div>
          <div class="kpi"><div class="v">${t.fitnessPass ? 'Pass' : a.partE?.t1 ? 'Fail' : '—'}</div><div class="k">general fitness</div></div>
        </div>
        <div class="row" style="margin-top:.7rem;gap:.5rem">
          <span class="pill">A ${round(t.partAConv, 1)}/10</span>
          <span class="pill">B ${round(t.partB, 1)}/20</span>
          <span class="pill">D ${round(t.partD, 1)}/50</span>
          <span class="pill">F ${round(t.partF, 1)}/20</span>
        </div>
        ${t.tskPass === false ? '<div class="callout bad small" style="margin-top:.7rem">TSK-11 is 19 or more. The guide says to stop MRSS testing here and keep rehabbing rather than considering return to sport.</div>' : ''}
      </div>
    </section>

    <section class="card">
      <header><h2>Part A — stability, swelling &amp; range</h2><span class="sub">${t.partA}/20 → ${round(t.partAConv, 1)}/10</span></header>
      <div class="card-body">
        ${MRSS_PART_A.map((it) => `
          <label class="fld" style="margin-bottom:.5rem">${esc(it.label)}
            <select data-pa="${it.id}">
              <option value="">—</option>
              ${it.options.map(([lbl, pts]) => `<option value="${pts}" ${a.partA?.[it.id] === pts ? 'selected' : ''}>${esc(lbl)} — ${pts} pts</option>`).join('')}
            </select>
          </label>`).join('')}
      </div>
    </section>

    <section class="card">
      <header><h2>Part B — ACL-RSI</h2><span class="sub">${t.rsi == null ? 'incomplete' : round(t.rsi, 1) + '% → ' + t.rsiPts + '/10'}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">${esc(ACL_RSI.note)}</div>
        ${ACL_RSI.items.map((it, i) => slider('aclrsi', i, a.aclrsi?.[i], it.lo, it.hi, it.q)).join('')}
      </div>
    </section>

    <section class="card">
      <header><h2>Part B — IKDC</h2><span class="sub">${t.ikdc == null ? 'incomplete' : round(t.ikdc.score, 1) + ' → ' + round(t.ikdcPts, 1) + '/10'}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">${esc(IKDC.note)}</div>
        ${IKDC.items.map((it) => {
          if (it.choices) {
            return `<label class="fld" style="margin-bottom:.5rem">${it.group ? `<span style="color:var(--ink);font-weight:600">${esc(it.group)}</span>` : ''}${esc(it.q)}
              <select data-ik="${it.id}"><option value="">—</option>
                ${it.choices.map(([v, lbl]) => `<option value="${v}" ${a.ikdc?.[it.id] === v ? 'selected' : ''}>${esc(lbl)}</option>`).join('')}
              </select></label>`;
          }
          const v = a.ikdc?.[it.id];
          return `<div style="margin-bottom:.6rem">
            <div class="small">${esc(it.q)}</div>
            <input type="range" min="0" max="${it.max}" step="1" data-ikr="${it.id}" value="${v ?? Math.round(it.max / 2)}">
            <div class="row between tiny muted"><span>${esc(it.scale.lo)}</span><strong class="mono">${v ?? '—'}</strong><span>${esc(it.scale.hi)}</span></div>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section class="card">
      <header><h2>Part C — TSK-11</h2><span class="sub">${t.tsk == null ? 'incomplete' : t.tsk + ' / 44'}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">${esc(TSK11.note)}</div>
        ${TSK11.items.map((q, i) => `
          <label class="fld" style="margin-bottom:.45rem">${i + 1}. ${esc(q)}
            <select data-tsk="${i}"><option value="">—</option>
              ${TSK11.choices.map(([v, lbl]) => `<option value="${v}" ${a.tsk?.[i] === v ? 'selected' : ''}>${v} — ${esc(lbl)}</option>`).join('')}
            </select></label>`).join('')}
      </div>
    </section>

    <section class="card">
      <header><h2>Part D — functional testing</h2><span class="sub">${round(t.partD, 1)}/50</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">Enter points directly, or use the LSI helper to convert a limb symmetry index into points.</div>
        ${MRSS_PART_D.map((it) => pointRow('pd', it, a.partD?.[it.id])).join('')}
      </div>
    </section>

    <section class="card">
      <header><h2>Part E — general fitness</h2><span class="sub">pass / fail hurdle</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">Two sport-specific tests you have done before. Same result or better than pre-injury.</div>
        <div class="grid2">
          <div><label class="fld">Test 1 name<input data-pe="n1" value="${esc(a.partE?.n1 || '')}"></label>
            <label class="fld" style="margin-top:.4rem">Result<select data-pe="t1"><option value="">—</option>
              <option ${a.partE?.t1 === 'Pass' ? 'selected' : ''}>Pass</option><option ${a.partE?.t1 === 'Fail' ? 'selected' : ''}>Fail</option></select></label></div>
          <div><label class="fld">Test 2 name<input data-pe="n2" value="${esc(a.partE?.n2 || '')}"></label>
            <label class="fld" style="margin-top:.4rem">Result<select data-pe="t2"><option value="">—</option>
              <option ${a.partE?.t2 === 'Pass' ? 'selected' : ''}>Pass</option><option ${a.partE?.t2 === 'Fail' ? 'selected' : ''}>Fail</option></select></label></div>
        </div>
      </div>
    </section>

    <section class="card">
      <header><h2>Part F — functional testing, fatigued</h2><span class="sub">${round(t.partF, 1)}/20</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">Performed after sport-specific work has taken you to 7/10 general fatigue.</div>
        ${MRSS_PART_F.map((it) => pointRow('pf', it, a.partF?.[it.id])).join('')}
      </div>
    </section>
  </div>`;
}

function pointRow(kind, it, val) {
  return `<div class="row" style="margin-bottom:.45rem;gap:.5rem">
    <span class="small" style="flex:1;min-width:140px">${esc(it.label)}</span>
    <label class="fld" style="width:96px">LSI %<input type="number" step="any" data-${kind}lsi="${it.id}" data-full="${it.full}" placeholder="—"></label>
    <label class="fld" style="width:86px">Points /${it.full}
      <input type="number" step="any" min="0" max="${it.full}" data-${kind}="${it.id}" value="${val ?? ''}"></label>
  </div>`;
}

// ------------------------------------------------------------------ bind ---
export function bindMelbourne(root, ctx, rerender) {
  root.querySelectorAll('[data-phase]').forEach((b) => b.addEventListener('click', () => {
    ctx.phase = b.dataset.phase;
    rerender();
  }));
  root.querySelector('[data-phasedone]')?.addEventListener('change', (e) => {
    update((d) => {
      const id = e.target.dataset.phasedone;
      d.melbourne.phases[id] = { completed: e.target.checked, completedDate: currentDayIso() };
    });
    rerender();
  });
  root.querySelectorAll('[data-mmanual]').forEach((cb) => cb.addEventListener('change', () => {
    update((d) => {
      const id = cb.dataset.mmanual;
      d.melbourne.measures[id] = { ...(d.melbourne.measures[id] || {}), pass: cb.checked, date: currentDayIso() };
    });
    rerender();
  }));
  root.querySelectorAll('[data-mrating]').forEach((sel) => sel.addEventListener('change', () => {
    update((d) => {
      const id = sel.dataset.mrating;
      d.melbourne.measures[id] = { ...(d.melbourne.measures[id] || {}), rating: sel.value, date: currentDayIso() };
    });
    rerender();
  }));
  root.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', () => {
    openMeasureEntry({
      measureId: b.dataset.record,
      date: currentDayIso(),
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  }));

  root.querySelector('[data-newmrss]')?.addEventListener('click', () => {
    const id = uid();
    update((d) => {
      d.mrss.push({ id, date: currentDayIso(), partA: {}, aclrsi: [], ikdc: {}, tsk: [], partD: {}, partE: {}, partF: {} });
    });
    ctx.mrssId = id;
    rerender();
  });
  root.querySelectorAll('[data-openmrss]').forEach((b) => b.addEventListener('click', () => {
    ctx.mrssId = b.dataset.openmrss;
    rerender();
  }));
  root.querySelector('[data-backmrss]')?.addEventListener('click', () => {
    ctx.mrssId = null;
    rerender();
  });
  root.querySelector('[data-delmrss]')?.addEventListener('click', () => {
    if (!confirm('Delete this assessment?')) return;
    update((d) => { d.mrss = d.mrss.filter((x) => x.id !== ctx.mrssId); });
    ctx.mrssId = null;
    rerender();
  });

  const withA = (fn) => update((d) => {
    const a = d.mrss.find((x) => x.id === ctx.mrssId);
    if (a) fn(a);
  });

  root.querySelector('[data-mdate]')?.addEventListener('change', (e) => { withA((a) => { a.date = e.target.value; }); rerender(); });
  root.querySelectorAll('[data-pa]').forEach((s) => s.addEventListener('change', () => {
    withA((a) => { a.partA[s.dataset.pa] = s.value === '' ? undefined : Number(s.value); }); rerender();
  }));
  root.querySelectorAll('[data-q="aclrsi"]').forEach((s) => s.addEventListener('change', () => {
    withA((a) => { a.aclrsi[Number(s.dataset.i)] = Number(s.value); }); rerender();
  }));
  root.querySelectorAll('[data-ik]').forEach((s) => s.addEventListener('change', () => {
    withA((a) => { a.ikdc[s.dataset.ik] = s.value === '' ? undefined : Number(s.value); }); rerender();
  }));
  root.querySelectorAll('[data-ikr]').forEach((s) => s.addEventListener('change', () => {
    withA((a) => { a.ikdc[s.dataset.ikr] = Number(s.value); }); rerender();
  }));
  root.querySelectorAll('[data-tsk]').forEach((s) => s.addEventListener('change', () => {
    withA((a) => { a.tsk[Number(s.dataset.tsk)] = s.value === '' ? undefined : Number(s.value); }); rerender();
  }));
  root.querySelectorAll('[data-pe]').forEach((s) => s.addEventListener('change', () => {
    withA((a) => { a.partE[s.dataset.pe] = s.value; }); rerender();
  }));

  for (const kind of ['pd', 'pf']) {
    root.querySelectorAll(`[data-${kind}]`).forEach((inp) => inp.addEventListener('change', () => {
      withA((a) => {
        const bucket = kind === 'pd' ? 'partD' : 'partF';
        a[bucket][inp.dataset[kind]] = inp.value === '' ? undefined : Number(inp.value);
      });
      rerender();
    }));
    root.querySelectorAll(`[data-${kind}lsi]`).forEach((inp) => inp.addEventListener('change', () => {
      const full = Number(inp.dataset.full);
      const dominant = state.data.settings.dominantLeg === 'right';
      const pts = lsiPoints(Number(inp.value), full, dominant);
      if (pts == null) return;
      withA((a) => {
        const bucket = kind === 'pd' ? 'partD' : 'partF';
        a[bucket][inp.dataset[kind + 'lsi']] = pts;
      });
      rerender();
    }));
  }
}
