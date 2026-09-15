// Progress against the plan's month markers. One place for it, because the
// Plan tab, the month board on Overview and the journey road all read it.

import { pct, round, fmtDateNum, toKg } from './util.js';
import { state, best, latest, focusCoverage } from './store.js';
import { MEASURE_BY_ID, UNIT_LABEL } from '../data/measurements.js';

/** Progress on one month goal, as {p, detail, done}. */
export function goalProgress(g) {
  const manual = state.data.planGoals[g.id] || {};
  if (g.kind === 'check') {
    return { p: manual.done ? 100 : 0, detail: manual.done ? `done ${manual.date ? fmtDateNum(manual.date) : ''}` : '', done: !!manual.done, manual: true };
  }
  if (g.kind === 'ratio') {
    const bw = bodyweightKg();
    const perLeg = !!MEASURE_BY_ID[g.measure]?.perLeg;
    const b = best(g.measure, perLeg ? 'L' : null);
    const b2 = perLeg ? best(g.measure, 'R') : null;
    if (!bw || (!b && !b2)) return { p: manual.done ? 100 : 0, detail: bw ? 'no lift recorded' : 'set your bodyweight in settings', done: !!manual.done, untested: !manual.done };
    const val = (rec) => toKg(rec.value, rec.unit || state.data.settings.weightUnit);
    // A per-leg goal needs both legs (audit A24): one leg's lift never stands
    // in for the other, so a missing side is shown and the goal is not met.
    if (perLeg && (!b || !b2)) {
      const has = b || b2;
      const ratio = val(has) / bw;
      return { p: Math.min(99, pct(ratio, g.target)), detail: `${b ? 'left' : 'right'} ${round(ratio, 2)}x bodyweight, ${b ? 'right' : 'left'} not tested yet`, done: false };
    }
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
    if (!bl && !br) return { p: 0, detail: 'not tested yet', done: false, untested: true };
    const lo = Math.min(bl?.value ?? 0, br?.value ?? 0);
    return {
      p: pct(lo, g.target),
      detail: `L ${bl ? round(bl.value, 1) : '·'} · R ${br ? round(br.value, 1) : '·'} ${UNIT_LABEL[m.unit] || ''}`,
      sides: { L: bl ? round(bl.value, 1) : null, R: br ? round(br.value, 1) : null, unit: UNIT_LABEL[m.unit] || '' },
      done: lo >= g.target,
    };
  }
  const b = best(g.measure, null);
  if (!b) return { p: 0, detail: 'not tested yet', done: false, untested: true };
  return { p: pct(b.value, g.target), detail: `${round(b.value, 1)} ${UNIT_LABEL[m.unit] || ''}`, done: b.value >= g.target };
}

export function bodyweightKg() {
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
