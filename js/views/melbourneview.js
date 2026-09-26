import { esc, todayIso, round, lsi as calcLsi, fmtDateShort, uid, toKg } from '../util.js';
import { state, update, latest, best, measurementsFor, surgeryDate } from '../store.js';
import { MELBOURNE_PHASES, MRSS_PART_A, MRSS_PART_D, MRSS_PART_F, lsiPoints } from '../../data/melbourne.js';
import { MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { ACL_RSI, TSK11, IKDC, scoreAclRsi, scoreTsk11, scoreIkdc } from '../../data/questionnaires.js';
import { openMeasureEntry } from '../components.js';

// Shown only when the settings hold a reconstruction date for both knees, so
// this public code states a rule, not anyone's history (audit A28).
const BILATERAL_NOTE =
  'When both knees have been reconstructed, a limb symmetry index compares two operated legs, so it can read 100% while both are well below where they need to be. Treat the absolute hurdles (reps, seconds, degrees, bodyweight multiples) as the real test, and read LSI as a balance check only.';
const bothReconstructed = () => !!(surgeryDate('left') && surgeryDate('right'));

// --------------------------------------------------------------- scoring ---
export function measureState(row) {
  const g = row.goal || {};
  const store = state.data.melbourne.measures[row.id] || {};
  const m = row.measure ? MEASURE_BY_ID[row.measure] : null;

  if (g.kind === 'manual') {
    return { status: store.pass ? 'pass' : 'none', text: store.pass ? 'marked complete' : '·', manual: true };
  }
  if (g.kind === 'rating') {
    const r = store.rating;
    return { status: r ? (g.allowed.includes(r) ? 'pass' : 'fail') : 'none', text: r || '·', rating: true };
  }
  if (g.kind === 'mrss') {
    const a = latestMrss();
    if (!a) return { status: 'none', text: 'not scored yet' };
    const t = mrssTotal(a);
    const s = t.final;
    // Met only with every part answered and both pass/fail hurdles passed (C,
    // TSK-11, and E, fitness), as the guide describes the score (Codex audit
    // B08). A total alone never reads as met.
    const parts = mrssProgress(a);
    // IKDC may be scored with up to two items missing (the guide's own rule, scoreIkdc).
    const open = parts.reduce((n, x) => n + Math.max(0, x.total - x.done - (x.id === 'mrss-ikdc' ? 2 : 0)), 0);
    const text = `${round(s, 1)} / 100`;
    if (t.tskPass === false || (a.partE?.t1 && a.partE?.t2 && !t.fitnessPass)) {
      return { status: 'fail', text: `${text} · ${t.tskPass === false ? 'TSK-11' : 'fitness'} hurdle not passed` };
    }
    if (open) return { status: 'none', text: `${text} · ${open} question${open === 1 ? '' : 's'} unanswered`, missing: 'unfinished' };
    return { status: s >= g.target && t.tskPass === true && t.fitnessPass ? 'pass' : 'fail', text };
  }
  if (!m) return { status: 'none', text: '·' };

  const u = UNIT_LABEL[m.unit] || '';
  if (g.kind === 'ratio') {
    const bw = bodyweightKg();
    if (!bw) return { status: 'none', text: 'set bodyweight in settings' };
    const legs = m.perLeg ? ['L', 'R'] : [null];
    const recs = legs.map((l) => best(row.measure, l));
    const ratio = (r) => toKg(r.value, r.unit || state.data.settings.weightUnit) / bw;
    if (!recs.some(Boolean)) return { status: 'none', text: 'not tested' };
    // Both legs or not scored (Codex audit B07): one leg passing is not the criterion.
    if (m.perLeg && !(recs[0] && recs[1])) {
      return { status: 'none', text: `L ${recs[0] ? `${round(ratio(recs[0]), 2)}x` : '·'} · R ${recs[1] ? `${round(ratio(recs[1]), 2)}x` : '·'} BW`, missing: recs[0] ? 'right' : 'left' };
    }
    const worst = Math.min(...recs.map(ratio));
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
  const missing = !L ? 'left' : !R ? 'right' : null;

  if (g.kind === 'grade') {
    const text = `L ${L?.value ?? '·'} · R ${R?.value ?? '·'}`;
    // Both legs graded, or not scored (Codex audit B07).
    if (missing) return { status: 'none', text, missing };
    const bad = [L, R].some((r) => !g.allowed.includes(r.value));
    return { status: bad ? 'fail' : 'pass', text };
  }

  const text = `L ${L ? round(L.value, 1) : '·'} · R ${R ? round(R.value, 1) : '·'} ${u}`.trim();

  if (g.kind === 'lsi' || g.kind === 'hurdle_lsi') {
    // Symmetry compares a left and a right tested on the SAME day (Codex audit
    // B08): the newest date holding both. A newer single-leg result is shown
    // but never paired with an older one.
    const pair = latestPair(row.measure);
    if (!pair) return { status: 'none', text, missing: missing || 'same-day' };
    const worstLsi = Math.min(calcLsi(pair.L.value, pair.R.value), calcLsi(pair.R.value, pair.L.value));
    const older = pair.date !== [L?.date, R?.date].filter(Boolean).sort().pop();
    const ptext = older ? `L ${round(pair.L.value, 1)} · R ${round(pair.R.value, 1)} ${u} on ${fmtDateShort(pair.date)}`.replace(/\s+on/, ' on') : text;
    if (g.kind === 'lsi') return { status: worstLsi >= g.target ? 'pass' : 'fail', text: ptext, lsi: worstLsi };
    const hurdleOk = pair.L.value >= g.hurdle && pair.R.value >= g.hurdle;
    return { status: hurdleOk && worstLsi >= g.lsi ? 'pass' : 'fail', text: ptext, lsi: worstLsi, hurdleOk };
  }
  // absolute, both legs: each leg's latest result against the target.
  if (missing) return { status: 'none', text, missing };
  const ok = [L, R].every((r) => (g.cmp === '<=' ? r.value <= g.target : r.value >= g.target));
  return { status: ok ? 'pass' : 'fail', text };
}

/** The newest date with both a left and a right result, the last of each that day. */
function latestPair(measureId) {
  const byDate = {};
  for (const r of measurementsFor(measureId)) {
    if (r.leg !== 'L' && r.leg !== 'R') continue;
    if (typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
    (byDate[r.date] ||= {})[r.leg] = r;
  }
  const date = Object.keys(byDate).filter((d) => byDate[d].L && byDate[d].R).sort().pop();
  return date ? { date, L: byDate[date].L, R: byDate[date].R } : null;
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

/** The current phase: the first not marked complete, phase 1 onward. */
export function currentPhaseId() {
  const done = state.data.melbourne.phases || {};
  const live = MELBOURNE_PHASES.filter((p) => p.id !== 'preop');
  return (live.find((p) => !done[p.id]?.completed) || live[live.length - 1]).id;
}

/**
 * The guide as a ladder (2026-09-16): five rungs rising left to right, a
 * completed phase filled green, the current one outlined turquoise, later
 * ones neutral; one dot per gate, filled green when met, hollow when not,
 * dashed when not tested. Read only; a rung opens the phase under Clinical.
 */
export function renderLadder() {
  const live = MELBOURNE_PHASES.filter((p) => p.id !== 'preop');
  const now = currentPhaseId();
  const heights = [34, 55, 76, 97, 118];   // 21 apart, one Fibonacci step each
  // Each rung grows in its turn from the lowest up (--i, B5-3); they all grew at once before.
  return `<section class="ov-sec panelsec ladder-sec">
    <div class="ov-head"><h2>Melbourne guide</h2><span class="ov-sub">the gates, as recorded</span></div>
    <div class="ladder">${live.map((p, i) => {
      const done = !!state.data.melbourne.phases?.[p.id]?.completed;
      const states = (p.measures || []).map((row) => measureState(row).status);
      const met = states.filter((x) => x === 'pass').length;
      return `<button class="rung ${done ? 'done' : ''} ${p.id === now ? 'now' : ''}" data-ladder="${esc(p.id)}" aria-label="${esc(p.name)}, ${esc(p.title)}: ${met} of ${states.length} gates met${p.id === now ? ', current phase' : ''}">
        <span class="rung-bar" style="--h:${heights[i]}px;--i:${i}"></span>
        <span class="rung-dots">${states.map((x) => `<i class="${x === 'pass' ? 'ok' : x === 'fail' ? 'no' : 'na'}"></i>`).join('')}</span>
        <span class="rung-lab">${esc(p.name)}</span>
        <span class="rung-sub">${esc(p.title)}${p.id === now ? ' · you are here' : ''}</span>
      </button>`;
    }).join('')}</div>
    <div class="ladder-key"><span><i class="ok"></i>gate met</span><span><i class="no"></i>not met</span><span><i class="na"></i>not tested</span></div>
  </section>`;
}

export function bindLadder(root, ctx, rerender) {
  root.querySelectorAll('[data-ladder]').forEach((b) => b.addEventListener('click', () => {
    ctx.gtab = 'clinical'; ctx.ctab = 'melbourne'; ctx.phase = b.dataset.ladder; rerender(); window.scrollTo(0, 0);
  }));
}

// ---------------------------------------------------------------- render ---
export function renderMelbourne(ctx) {
  if (ctx.mrssId) return renderMrssForm(ctx);

  const openId = ctx.phase || 'phase2';
  const phase = MELBOURNE_PHASES.find((p) => p.id === openId) || MELBOURNE_PHASES[2];

  return `
  <div class="stack">
    <section class="card">
      <header class="hero"><h2>Melbourne ACL Rehabilitation Guide 2.0</h2><span class="sub">criteria-driven: the criteria set the pace, not the calendar</span></header>
      <div class="card-body">
        ${bothReconstructed() ? `<details class="disc" data-key="melb:why" style="margin-bottom:.8rem"><summary>Both knees reconstructed: read symmetry as a balance check only. Why</summary>
          <div class="tiny" style="padding:.3rem 0 .1rem;line-height:1.5">${esc(BILATERAL_NOTE)}</div></details>` : ''}
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
          ${phase.archived ? '<div class="sub">already behind you; kept for reference and back-comparison</div>' : ''}</div>
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
            <span class="pill">bonus, not a road block</span></div>
          ${measureTable(phase.supplementary)}` : ''}
      </div>
    </section>

    ${openId === 'phase4' ? mrssSection() : ''}
  </div>`;
}

/** One criterion as a compact row for a phone: name, status in words, the
 *  latest figure, and the goal, how to test and the controls behind a tap. */
function criterionRows(rows) {
  return `<div class="mrows">${rows.map((row) => {
    const st = measureState(row);
    const cls = st.status === 'pass' ? 'good' : st.status === 'fail' ? 'bad' : '';
    const how = row.how || MEASURE_BY_ID[row.measure]?.how;
    return `<details class="mrow crit ${cls}" data-key="crit:${esc(row.label)}">
      <summary>
        <span class="mrow-name">${esc(row.label)}<span class="mrow-date${st.status !== 'none' && /\d/.test(st.text) ? ' mono' : ''}">${st.status === 'none' && !st.missing
          ? esc(row.goalText || '')
          : `${esc(st.text)}${st.lsi != null ? ` · LSI ${esc(round(st.lsi, 0))}%` : ''}`}</span></span>
        <span class="crit-state">${critPill(st, cls)}</span>
      </summary>
      <div class="mrow-body">
        ${row.goalText ? `<div class="exh-line"><span class="exh-k">Goal</span><span class="exh-v">${esc(row.goalText)}</span></div>` : ''}
        ${how ? `<div class="tiny" style="margin:.2rem 0">${esc(how)}</div>` : ''}
        <div class="row" style="gap:.4rem;margin-top:.3rem">
          ${st.manual ? `<label class="row tiny" style="gap:.25rem"><input type="checkbox" data-mmanual="${esc(row.id)}" ${state.data.melbourne.measures[row.id]?.pass ? 'checked' : ''}> done</label>` : ''}
          ${st.rating ? `<select data-mrating="${esc(row.id)}" class="sel-sm" aria-label="${esc(row.label)}: rating">
              <option value="">·</option>${row.goal.options.map((o) => `<option ${state.data.melbourne.measures[row.id]?.rating === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
            </select>` : ''}
          ${row.measure ? `<button class="btn sm" data-record="${esc(row.measure)}">Record</button>` : ''}
        </div>
      </div>
    </details>`;
  }).join('')}</div>`;
}

/** Met, not yet, or what is missing: never "not tested" when one leg was. */
function critPill(st, cls) {
  if (st.status !== 'none') return `<span class="pill ${cls}">${st.status === 'pass' ? 'met' : 'not yet'}</span>`;
  const words = { left: 'left leg not tested', right: 'right leg not tested', 'same-day': 'needs both legs on one day', unfinished: 'unfinished' }[st.missing] || 'not tested';
  return `<span class="pill">${words}</span>`;
}

function measureTable(rows) {
  return `<div class="only-narrow">${criterionRows(rows)}</div>
  <div class="only-wide scroll-x"><table class="tbl" style="min-width:600px"><thead>
    <tr><th>Test</th><th>Goal</th><th>Latest</th><th class="num">LSI</th><th></th><th></th></tr>
  </thead><tbody>
  ${rows.map((row) => {
    const st = measureState(row);
    const cls = st.status === 'pass' ? 'good' : st.status === 'fail' ? 'bad' : '';
    return `<tr>
      <td>
        <div>${esc(row.label)}</div>
        ${row.how || MEASURE_BY_ID[row.measure]?.how
          ? `<details class="disc" data-key="melbhow:${esc(row.label)}" style="margin-top:.25rem"><summary>How to test</summary><div class="tiny">${esc(row.how || MEASURE_BY_ID[row.measure].how)}</div></details>` : ''}
      </td>
      <td class="tiny muted">${esc(row.goalText || '')}</td>
      <td class="tiny${/\d/.test(st.text) ? ' mono' : ''}">${esc(st.text)}</td>
      <td class="num mono tiny" title="Less meaningful with two reconstructed knees">${st.lsi != null ? esc(round(st.lsi, 0)) + '%' : ''}</td>
      <td>${critPill(st, cls)}</td>
      <td class="num nowrap">
        ${st.manual ? `<label class="row tiny" style="gap:.25rem"><input type="checkbox" data-mmanual="${esc(row.id)}" ${state.data.melbourne.measures[row.id]?.pass ? 'checked' : ''}> done</label>` : ''}
        ${st.rating ? `<select data-mrating="${esc(row.id)}" class="sel-sm" aria-label="${esc(row.label)}: rating">
            <option value="">·</option>${row.goal.options.map((o) => `<option ${state.data.melbourne.measures[row.id]?.rating === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
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
        The guide suggests two sessions at least 3 days apart. A to D first, then E and F.
      </div>
      ${list.length ? `<table class="tbl"><thead><tr><th>Date</th><th class="num">Score</th><th>TSK-11</th><th>Fitness</th><th></th></tr></thead><tbody>
        ${list.map((a) => {
          const t = mrssTotal(a);
          return `<tr>
            <td>${esc(fmtDateShort(a.date))}</td>
            <td class="num mono"><strong>${round(t.final, 1)}</strong> / 100${(() => { const pr = mrssProgress(a); const d = pr.reduce((n, p) => n + p.done, 0); const tt = pr.reduce((n, p) => n + p.total, 0); return d < tt ? ` <span class="pill warn">${d} of ${tt} answered</span>` : ''; })()}</td>
            <td>${t.tsk == null ? '<span class="muted tiny">·</span>' : `<span class="pill ${t.tskPass ? 'good' : 'bad'}">${t.tsk} ${t.tskPass ? 'pass' : 'fail'}</span>`}</td>
            <td>${a.partE?.t1 ? `<span class="pill ${t.fitnessPass ? 'good' : 'bad'}">${t.fitnessPass ? 'pass' : 'fail'}</span>` : '<span class="muted tiny">·</span>'}</td>
            <td class="num"><button class="btn sm" data-openmrss="${esc(a.id)}">Open</button></td>
          </tr>`;
        }).join('')}
      </tbody></table>` : '<div class="empty">No assessment yet. Phase 4 asks for 95+.</div>'}
    </div>
  </section>`;
}

/**
 * How much of each MRSS part is answered. The wording and scoring of every
 * question are untouched; this only counts answers so an unfinished part is
 * obvious before a score is read.
 */
export function mrssProgress(a) {
  const count = (obj, ids) => ids.filter((id) => obj?.[id] !== undefined && obj?.[id] !== null && obj?.[id] !== '').length;
  const arr = (list, n) => Array.from({ length: n }, (_, i) => list?.[i]).filter((v) => v !== undefined && v !== null).length;
  return [
    { id: 'mrss-a', label: 'A', name: 'Stability', done: count(a.partA, MRSS_PART_A.map((x) => x.id)), total: MRSS_PART_A.length },
    { id: 'mrss-rsi', label: 'B', name: 'ACL-RSI', done: arr(a.aclrsi, ACL_RSI.items.length), total: ACL_RSI.items.length },
    { id: 'mrss-ikdc', label: 'B', name: 'IKDC', done: count(a.ikdc, IKDC.items.map((x) => x.id)), total: IKDC.items.length },
    { id: 'mrss-c', label: 'C', name: 'TSK-11', done: arr(a.tsk, TSK11.items.length), total: TSK11.items.length },
    { id: 'mrss-d', label: 'D', name: 'Functional', done: count(a.partD, MRSS_PART_D.map((x) => x.id)), total: MRSS_PART_D.length },
    { id: 'mrss-e', label: 'E', name: 'Fitness', done: ['t1', 't2'].filter((k) => a.partE?.[k]).length, total: 2 },
    { id: 'mrss-f', label: 'F', name: 'Fatigued', done: count(a.partF, MRSS_PART_F.map((x) => x.id)), total: MRSS_PART_F.length },
  ];
}

function partTag(p) {
  return p.done >= p.total
    ? `<span class="pill good">${p.done} of ${p.total} answered</span>`
    : `<span class="pill ${p.done ? 'warn' : ''}">${p.done} of ${p.total} answered</span>`;
}

function renderMrssForm(ctx) {
  const a = (state.data.mrss || []).find((x) => x.id === ctx.mrssId);
  if (!a) return '<div class="empty">Assessment not found.</div>';
  const t = mrssTotal(a);
  const prog = mrssProgress(a);
  const P = Object.fromEntries(prog.map((p) => [p.id, p]));
  const answered = prog.reduce((n, p) => n + p.done, 0);
  const total = prog.reduce((n, p) => n + p.total, 0);

  const slider = (path, i, val, lo, hi, q) => `
    <div style="margin-bottom:.6rem">
      <div class="small">${i + 1}. ${esc(q)}</div>
      <input type="range" min="0" max="100" step="10" data-q="${path}" data-i="${i}" value="${val ?? 50}">
      <div class="row between tiny muted"><span>${esc(lo)}</span><strong class="mono">${val ?? '·'}</strong><span>${esc(hi)}</span></div>
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

    <nav class="mnav" aria-label="Assessment sections">
      ${prog.map((p) => `<button class="mnav-btn ${p.done >= p.total ? 'done' : p.done ? 'part' : ''}" data-jump-part="${p.id}"
        aria-label="Part ${p.label}, ${esc(p.name)}: ${p.done} of ${p.total} answered">
        <b>${p.label}</b><span>${esc(p.name)}</span><i>${p.done}/${p.total}</i></button>`).join('')}
    </nav>

    <section class="card">
      <header><h2>Final score</h2><span class="sub">${answered} of ${total} answered${answered < total ? ', so this score is incomplete' : ''}</span></header>
      <div class="card-body">
        <div class="kpis">
          <div class="kpi"><div class="v">${round(t.final, 1)}</div><div class="k">/ 100 · need 95+</div></div>
          <div class="kpi"><div class="v">${t.tsk ?? '·'}</div><div class="k">TSK-11 ${t.tskPass == null ? '' : t.tskPass ? '· pass' : '· FAIL'}</div></div>
          <div class="kpi"><div class="v">${t.fitnessPass ? 'Pass' : a.partE?.t1 ? 'Fail' : '·'}</div><div class="k">general fitness</div></div>
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

    <section class="card" id="mrss-a">
      <header><h2>Part A: stability, swelling &amp; range</h2><span class="sub">${t.partA}/20 → ${round(t.partAConv, 1)}/10 ${partTag(P['mrss-a'])}</span></header>
      <div class="card-body">
        ${MRSS_PART_A.map((it) => `
          <label class="fld" style="margin-bottom:.5rem">${esc(it.label)}
            <select data-pa="${it.id}">
              <option value="">·</option>
              ${it.options.map(([lbl, pts]) => `<option value="${pts}" ${a.partA?.[it.id] === pts ? 'selected' : ''}>${esc(lbl)}: ${pts} pts</option>`).join('')}
            </select>
          </label>`).join('')}
      </div>
    </section>

    <section class="card" id="mrss-rsi">
      <header><h2>Part B: ACL-RSI</h2><span class="sub">${t.rsi == null ? 'incomplete' : round(t.rsi, 1) + '% → ' + t.rsiPts + '/10'} ${partTag(P['mrss-rsi'])}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">${esc(ACL_RSI.note)}</div>
        ${ACL_RSI.items.map((it, i) => slider('aclrsi', i, a.aclrsi?.[i], it.lo, it.hi, it.q)).join('')}
      </div>
    </section>

    <section class="card" id="mrss-ikdc">
      <header><h2>Part B: IKDC</h2><span class="sub">${t.ikdc == null ? 'incomplete' : round(t.ikdc.score, 1) + ' → ' + round(t.ikdcPts, 1) + '/10'} ${partTag(P['mrss-ikdc'])}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">${esc(IKDC.note)}</div>
        ${IKDC.items.map((it) => {
          if (it.choices) {
            return `<label class="fld" style="margin-bottom:.5rem">${it.group ? `<span style="color:var(--ink);font-weight:600">${esc(it.group)}</span>` : ''}${esc(it.q)}
              <select data-ik="${it.id}"><option value="">·</option>
                ${it.choices.map(([v, lbl]) => `<option value="${v}" ${a.ikdc?.[it.id] === v ? 'selected' : ''}>${esc(lbl)}</option>`).join('')}
              </select></label>`;
          }
          const v = a.ikdc?.[it.id];
          return `<div style="margin-bottom:.6rem">
            <div class="small">${esc(it.q)}</div>
            <input type="range" min="0" max="${it.max}" step="1" data-ikr="${it.id}" value="${v ?? Math.round(it.max / 2)}">
            <div class="row between tiny muted"><span>${esc(it.scale.lo)}</span><strong class="mono">${v ?? '·'}</strong><span>${esc(it.scale.hi)}</span></div>
          </div>`;
        }).join('')}
      </div>
    </section>

    <section class="card" id="mrss-c">
      <header><h2>Part C: TSK-11</h2><span class="sub">${t.tsk == null ? 'incomplete' : t.tsk + ' / 44'} ${partTag(P['mrss-c'])}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">${esc(TSK11.note)}</div>
        ${TSK11.items.map((q, i) => `
          <label class="fld" style="margin-bottom:.45rem">${i + 1}. ${esc(q)}
            <select data-tsk="${i}"><option value="">·</option>
              ${TSK11.choices.map(([v, lbl]) => `<option value="${v}" ${a.tsk?.[i] === v ? 'selected' : ''}>${v}: ${esc(lbl)}</option>`).join('')}
            </select></label>`).join('')}
      </div>
    </section>

    <section class="card" id="mrss-d">
      <header><h2>Part D: functional testing</h2><span class="sub">${round(t.partD, 1)}/50 ${partTag(P['mrss-d'])}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">Enter points directly, or use the LSI helper to convert a limb symmetry index into points.</div>
        ${MRSS_PART_D.map((it) => pointRow('pd', it, a.partD?.[it.id])).join('')}
      </div>
    </section>

    <section class="card" id="mrss-e">
      <header><h2>Part E: general fitness</h2><span class="sub">pass / fail hurdle ${partTag(P['mrss-e'])}</span></header>
      <div class="card-body">
        <div class="tiny muted" style="margin-bottom:.6rem">Two sport-specific tests you have done before. Same result or better than pre-injury.</div>
        <div class="grid2">
          <div><label class="fld">Test 1 name<input data-pe="n1" value="${esc(a.partE?.n1 || '')}"></label>
            <label class="fld" style="margin-top:.4rem">Result<select data-pe="t1"><option value="">·</option>
              <option ${a.partE?.t1 === 'Pass' ? 'selected' : ''}>Pass</option><option ${a.partE?.t1 === 'Fail' ? 'selected' : ''}>Fail</option></select></label></div>
          <div><label class="fld">Test 2 name<input data-pe="n2" value="${esc(a.partE?.n2 || '')}"></label>
            <label class="fld" style="margin-top:.4rem">Result<select data-pe="t2"><option value="">·</option>
              <option ${a.partE?.t2 === 'Pass' ? 'selected' : ''}>Pass</option><option ${a.partE?.t2 === 'Fail' ? 'selected' : ''}>Fail</option></select></label></div>
        </div>
      </div>
    </section>

    <section class="card" id="mrss-f">
      <header><h2>Part F: functional testing, fatigued</h2><span class="sub">${round(t.partF, 1)}/20 ${partTag(P['mrss-f'])}</span></header>
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
    <label class="fld" style="width:96px">LSI %<input type="number" step="any" data-${kind}lsi="${it.id}" data-full="${it.full}" placeholder="·"></label>
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
      d.melbourne.phases[id] = { completed: e.target.checked, completedDate: todayIso() };
    });
    rerender();
  });
  root.querySelectorAll('[data-mmanual]').forEach((cb) => cb.addEventListener('change', () => {
    update((d) => {
      const id = cb.dataset.mmanual;
      d.melbourne.measures[id] = { ...(d.melbourne.measures[id] || {}), pass: cb.checked, date: todayIso() };
    });
    rerender();
  }));
  root.querySelectorAll('[data-mrating]').forEach((sel) => sel.addEventListener('change', () => {
    update((d) => {
      const id = sel.dataset.mrating;
      d.melbourne.measures[id] = { ...(d.melbourne.measures[id] || {}), rating: sel.value, date: todayIso() };
    });
    rerender();
  }));
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

  root.querySelector('[data-newmrss]')?.addEventListener('click', () => {
    const id = uid();
    update((d) => {
      d.mrss.push({ id, date: todayIso(), partA: {}, aclrsi: [], ikdc: {}, tsk: [], partD: {}, partE: {}, partF: {} });
    });
    ctx.mrssId = id;
    rerender();
  });
  root.querySelectorAll('[data-openmrss]').forEach((b) => b.addEventListener('click', () => {
    ctx.mrssId = b.dataset.openmrss;
    rerender();
  }));
  // Section navigation scrolls; it never touches the URL hash, which the app
  // reads as a tab name.
  root.querySelectorAll('[data-jump-part]').forEach((b) => b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.jumpPart);
    if (!el) return;
    const header = document.querySelector('.mtop') || document.querySelector('.topbar');
    const clear = (header ? header.getBoundingClientRect().height : 0) + 8;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - clear, behavior: 'smooth' });
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
      // An emptied helper box scores nothing; Number('') is 0, which wrote 0
      // points (2026-09-22 audit).
      if (inp.value.trim() === '') return;
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
