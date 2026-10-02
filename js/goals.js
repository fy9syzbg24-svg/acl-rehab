// Progress against the plan's month markers. One place for it, because the
// Plan tab, the month board on Overview and the journey road all read it.

import { pct, round, fmtDateShort, toKg } from './util.js';
import { state, best, latest, focusCoverage } from './store.js';
import { MEASURE_BY_ID, UNIT_LABEL } from '../data/measurements.js';
import { steadiness, sleepAbove, ringReady, SLEEP_TARGET_H, STEADY_WINDOW } from './ring.js';

// A stored grade can be a word ('Zero grade', 'Trace') or a number; compare on the first word.
const gradeWord = (v) => String(v ?? '').trim().split(/\s+/)[0];

/** Progress on one month goal, as {p, detail, done}. */
export function goalProgress(g) {
  const manual = state.data.planGoals[g.id] || {};
  if (g.kind === 'check') {
    return { p: manual.done ? 100 : 0, detail: manual.done ? `done ${manual.date ? fmtDateShort(manual.date) : ''}` : '', done: !!manual.done, manual: true };
  }
  // Measured by the ring, not by him: no manual tick, and nothing to record.
  // A marker like this simply says "not measured yet" until the layer loads,
  // which is also what happens on a device that has never seen it.
  if (g.kind === 'ring') return ringGoal(g);
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
  const unit = UNIT_LABEL[m.unit] || '';
  // Swelling, graded (19 Sep 2026): the LATEST reading on each leg, never the
  // best, because the question is how the knee is now.
  if (g.kind === 'grade') {
    const legs = g.legs || (m.perLeg ? ['L', 'R'] : [null]);
    const now = legs.map((leg) => latest(g.measure, leg));
    if (now.every((r) => !r)) return { p: 0, detail: 'not tested yet', done: false, untested: true };
    const ok = now.filter((r) => r && (g.allowed || []).includes(gradeWord(r.value))).length;
    const words = legs.map((leg, i) => `${leg === 'L' ? 'left' : leg === 'R' ? 'right' : ''} ${now[i] ? gradeWord(now[i].value) : 'not tested'}`.trim());
    return { p: pct(ok, legs.length), detail: words.join(', '), done: ok === legs.length };
  }
  // Lower is better (pain): the latest reading, never the best.
  if (m.lower || g.cmp === '<=') {
    const r = latest(g.measure, null);
    if (!r) return { p: 0, detail: 'not recorded yet', done: false, untested: true };
    const v = Number(r.value);
    const shown = unit.startsWith('/') ? `${round(v, 1)}${unit}` : `${round(v, 1)} ${unit}`;
    return { p: v <= g.target ? 100 : pct(g.target, v), detail: `latest ${shown} (${fmtDateShort(r.date)})`, done: v <= g.target };
  }
  // Left against right (both legs reconstructed, so neither is normal; the
  // goal is the two within a percentage of each other).
  if (g.kind === 'lsi') {
    const bl = best(g.measure, 'L');
    const br = best(g.measure, 'R');
    if (!bl || !br) return { p: 0, detail: bl || br ? 'one leg not tested yet' : 'not tested yet', done: false, untested: !bl && !br };
    const lsi = (Math.min(bl.value, br.value) / Math.max(bl.value, br.value)) * 100;
    return { p: pct(lsi, g.target), detail: `the weaker leg is ${Math.round(lsi)}% of the stronger`,
      sides: { L: round(bl.value, 1), R: round(br.value, 1), unit }, done: lsi >= g.target };
  }
  if (m.perLeg && g.legs && g.legs.length === 1) {
    const leg = g.legs[0];
    const b = best(g.measure, leg);
    if (!b) return { p: 0, detail: `${leg === 'L' ? 'left' : 'right'} not tested yet`, done: false, untested: true };
    return { p: pct(b.value, g.target), detail: `${leg === 'L' ? 'left' : 'right'} ${round(b.value, 1)} ${unit}`, done: b.value >= g.target };
  }
  if (m.perLeg) {
    const bl = best(g.measure, 'L');
    const br = best(g.measure, 'R');
    if (!bl && !br) return { p: 0, detail: 'not tested yet', done: false, untested: true };
    const lo = Math.min(bl?.value ?? 0, br?.value ?? 0);
    return {
      p: pct(lo, g.target),
      detail: `L ${bl ? round(bl.value, 1) : '·'} · R ${br ? round(br.value, 1) : '·'} ${UNIT_LABEL[m.unit] || ''}`,
      sides: { L: bl ? round(bl.value, 1) : null, R: br ? round(br.value, 1) : null, unit: UNIT_LABEL[m.unit] || '' },
      done: g.cmp === '>' ? lo > g.target : lo >= g.target,
    };
  }
  const b = best(g.measure, null);
  if (!b) return { p: 0, detail: 'not tested yet', done: false, untested: true };
  return { p: pct(b.value, g.target), detail: `${round(b.value, 1)} ${UNIT_LABEL[m.unit] || ''}`, done: b.value >= g.target };
}

/**
 * A marker the ring measures for him. Two of them, and both are the
 * relationships that held in both halves of his own record:
 *  - bedtimeSteadiness: the typical swing off his own recent bedtime, in
 *    hours, where SMALLER is better, so the bar fills as it comes down.
 *  - sleepNights: the share of recent nights at the sleep target or better.
 */
function ringGoal(g) {
  if (!ringReady()) return { p: 0, detail: 'no ring nights on this device', done: false, untested: true, auto: true };
  if (g.metric === 'bedtimeSteadiness') {
    const st = steadiness();
    if (!st) return { p: 0, detail: 'not enough nights yet', done: false, untested: true, auto: true };
    const target = g.target || 1;
    return {
      p: Math.min(100, Math.round((target / Math.max(target, st.hours)) * 100)),
      detail: `${round(st.hours, 1)}h typical swing, last ${st.n} nights`,
      done: st.hours <= target,
      auto: true,
    };
  }
  if (g.metric === 'sleepNights') {
    const hours = g.hours || SLEEP_TARGET_H;
    const ab = sleepAbove(hours, g.window || STEADY_WINDOW);
    if (!ab || !ab.n) return { p: 0, detail: 'not enough nights yet', done: false, untested: true, auto: true };
    const share = ab.hit / ab.n;
    const target = g.target || 0.5;
    return {
      p: pct(share, target),
      detail: `${ab.hit} of ${ab.n} nights at ${hours} hours or more`,
      done: share >= target,
      auto: true,
    };
  }
  return { p: 0, detail: '', done: false, untested: true, auto: true };
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
