import { esc, todayIso, pct, round, fmtDateNum, uid } from '../util.js';
import { state, update, best, latest, focusCoverage } from '../store.js';
import { PLAN_MONTHS, monthForDate } from '../../data/plan.js';
import { MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { openMeasureEntry } from '../components.js';
import { toKg } from '../util.js';

/** Progress on one month goal, as {p, detail, done}. */
export function goalProgress(g) {
  const manual = state.data.planGoals[g.id] || {};
  if (g.kind === 'check') {
    return { p: manual.done ? 100 : 0, detail: manual.done ? `done ${manual.date ? fmtDateNum(manual.date) : ''}` : '', done: !!manual.done, manual: true };
  }
  if (g.kind === 'ratio') {
    const bw = bodyweightKg();
    const b = best(g.measure, MEASURE_BY_ID[g.measure]?.perLeg ? 'L' : null);
    const b2 = MEASURE_BY_ID[g.measure]?.perLeg ? best(g.measure, 'R') : null;
    if (!bw || !b) return { p: manual.done ? 100 : 0, detail: bw ? 'no lift recorded' : 'set your bodyweight in settings', done: !!manual.done };
    const val = (rec) => toKg(rec.value, rec.unit || state.data.settings.weightUnit);
    const worst = b2 ? Math.min(val(b), val(b2)) : val(b);
    const ratio = worst / bw;
    return { p: pct(ratio, g.target), detail: `${round(ratio, 2)}x bodyweight`, done: ratio >= g.target };
  }
  // metric
  const m = MEASURE_BY_ID[g.measure];
  if (!m) return { p: 0, detail: '', done: false };
  if (m.perLeg) {
    const bl = best(g.measure, 'L');
    const br = best(g.measure, 'R');
    if (!bl && !br) return { p: 0, detail: 'not tested yet', done: false };
    const lo = Math.min(bl?.value ?? 0, br?.value ?? 0);
    return {
      p: pct(lo, g.target),
      detail: `L ${bl ? round(bl.value, 1) : '—'} · R ${br ? round(br.value, 1) : '—'} ${UNIT_LABEL[m.unit] || ''}`,
      done: lo >= g.target,
    };
  }
  const b = best(g.measure, null);
  if (!b) return { p: 0, detail: 'not tested yet', done: false };
  return { p: pct(b.value, g.target), detail: `${round(b.value, 1)} ${UNIT_LABEL[m.unit] || ''}`, done: b.value >= g.target };
}

function bodyweightKg() {
  const rec = latest('bodyweight', null);
  if (rec) return toKg(rec.value, rec.unit || state.data.settings.weightUnit);
  const s = state.data.settings.bodyweight;
  if (s) return toKg(s, state.data.settings.weightUnit);
  return null;
}

export function monthCompletion(m) {
  const goals = m.goals.map(goalProgress);
  const focusKeys = m.focus.flatMap((f, fi) => f.items.map((_, ii) => `${m.id}:${fi}:${ii}`));
  const focusDone = m.focus.flatMap((f) => f.items).filter((it, i) => {
    const cov = focusCoverage(it, m.start, m.end);
    return cov.kind === 'auto' ? cov.hit : !!state.data.planFocus[focusKeys[i]];
  }).length;
  const goalScore = goals.reduce((a, g) => a + Math.min(100, g.p), 0) / (goals.length || 1);
  const focusScore = pct(focusDone, focusKeys.length);
  return { goalScore: Math.round(goalScore), focusScore, focusDone, focusTotal: focusKeys.length, goals };
}

export function renderPlan(ctx) {
  const today = todayIso();
  const current = monthForDate(today);
  const openId = ctx.openMonth || current?.id || PLAN_MONTHS[0].id;

  return `
  <div class="stack">
    <section class="card">
      <header class="hero"><h2>6-month protocol</h2><span class="sub">August 2026 → January 2027 · goal-based, not date-based</span></header>
      <div class="card-body">
        <div class="monthstrip">
          ${PLAN_MONTHS.map((m) => {
            const c = monthCompletion(m);
            const isNow = m.id === current?.id;
            return `<button class="kpi" data-month="${m.id}" style="border-color:${m.id === openId ? 'var(--accent)' : 'var(--line-2)'}">
              <div class="v" style="font-size:1.05rem">${c.goalScore}%</div>
              <div class="k">${esc(m.name)}${isNow ? ' ●' : ''}</div>
            </button>`;
          }).join('')}
        </div>
        <div class="tiny muted" style="margin-top:.5rem">● = the month you're in now. The percentage is progress against that month's measurable goals.</div>
      </div>
    </section>

    ${PLAN_MONTHS.filter((m) => m.id === openId).map(monthCard).join('')}
  </div>`;
}

function monthCard(m) {
  const c = monthCompletion(m);
  return `
  <section class="card">
    <header class="hero">
      <div>
        <h2>${esc(m.name)} · ${esc(m.monthLabel)}</h2>
        <div class="sub">${esc(m.title)}</div>
      </div>
      <span class="pill accent">Melbourne Phase ${m.melbournePhase}</span>
    </header>
    <div class="card-body">
      ${m.note ? `<div class="callout small" style="margin-bottom:.9rem">${esc(m.note)}</div>` : ''}

      <div class="section-title">Goals / markers for progression</div>
      ${m.goals.map((g) => goalRow(g)).join('')}

      <div class="section-title" style="margin-top:1.1rem">Main rehabilitation focus
        <span class="pill" style="margin-left:.4rem">${c.focusDone}/${c.focusTotal}</span>
      </div>
      ${m.focus.map((f, fi) => `
        <div style="margin-bottom:.7rem">
          <h3 style="font-size:.83rem;margin-bottom:.2rem">${esc(f.heading)}</h3>
          ${f.items.map((it, ii) => {
            const key = `${m.id}:${fi}:${ii}`;
            const cov = focusCoverage(it, m.start, m.end);
            const on = cov.kind === 'auto' ? cov.hit : !!state.data.planFocus[key];
            return `<label class="checkline ${on ? 'done' : ''}">
              <input type="checkbox" ${cov.kind === 'auto' ? 'disabled' : `data-focus="${esc(key)}"`} ${on ? 'checked' : ''}>
              <span class="t">${esc(it.t)}
                ${cov.kind === 'auto'
                  ? `<span class="pill" title="Ticked automatically from what you log">${cov.days ? cov.days + ' day' + (cov.days === 1 ? '' : 's') + ' this month' : 'auto · not yet'}</span>`
                  : '<span class="pill">your call</span>'}</span>
            </label>`;
          }).join('')}
        </div>`).join('')}

      <div class="section-title" style="margin-top:1rem">Weekly targets this month</div>
      <ul class="plain">
        ${m.weeklyTargets.map((t) => `<li>${esc(t.label)} — <strong>${state.data.settings.weeklyOverrides?.[t.id] ?? t.target}x/week</strong>
          ${t.src === 'plan' ? '<span class="pill">from plan</span>' : '<span class="pill">my default</span>'}</li>`).join('')}
      </ul>
    </div>
  </section>`;
}

function goalRow(g) {
  const p = goalProgress(g);
  const m = g.measure ? MEASURE_BY_ID[g.measure] : null;
  return `
  <div style="margin-bottom:.75rem;padding-bottom:.75rem;border-bottom:1px solid var(--line-2)">
    <div class="row between" style="align-items:flex-start;gap:.5rem">
      <div style="flex:1;min-width:0">
        <div class="small" style="font-weight:${p.done ? 550 : 450};color:${p.done ? 'var(--good)' : 'var(--ink)'}">
          ${p.done ? '✓ ' : ''}${esc(g.text)}
        </div>
        ${p.detail ? `<div class="tiny muted${/\d/.test(p.detail) ? ' mono' : ''}" style="margin-top:.15rem">${esc(p.detail)}</div>` : ''}
        ${g.caution ? `<div class="tiny" style="color:var(--warn);margin-top:.15rem">⚠ ${esc(g.caution)}</div>` : ''}
      </div>
      <div class="row" style="gap:.3rem;flex:none">
        ${m ? `<button class="btn sm" data-record="${esc(g.measure)}">Record</button>` : ''}
        ${g.kind === 'check' || !m ? `<label class="row tiny" style="gap:.25rem"><input type="checkbox" data-goal="${esc(g.id)}" ${state.data.planGoals[g.id]?.done ? 'checked' : ''}> done</label>` : ''}
      </div>
    </div>
    ${p.p != null && m ? `<div class="bar ${p.done ? 'good' : ''}" style="margin-top:.35rem"><i style="width:${Math.min(100, p.p)}%"></i></div>` : ''}
  </div>`;
}

export function bindPlan(root, ctx, rerender) {
  root.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
    ctx.openMonth = b.dataset.month;
    rerender();
  }));
  root.querySelectorAll('[data-focus]').forEach((cb) => cb.addEventListener('change', () => {
    update((d) => { d.planFocus[cb.dataset.focus] = cb.checked || undefined; });
    rerender();
  }));
  root.querySelectorAll('[data-goal]').forEach((cb) => cb.addEventListener('change', () => {
    update((d) => { d.planGoals[cb.dataset.goal] = { done: cb.checked, date: todayIso() }; });
    rerender();
  }));
  root.querySelectorAll('[data-record]').forEach((b) => b.addEventListener('click', () => {
    openMeasureEntry({
      measureId: b.dataset.record,
      date: todayIso(),
      lockMeasure: false,
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  }));
}
