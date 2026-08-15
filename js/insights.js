// A small, honest rules engine. Every insight is computed from real logged
// data; if the data isn't there, the insight simply doesn't appear.

import { state, entriesFor, hasCheckin, measurementsFor } from './store.js';
import { addDays, num, round } from './util.js';
import { EXERCISE_BY_ID } from '../data/exercises.js';

/** Consecutive days with anything logged, ending today or yesterday. */
function streak(iso) {
  const has = (d) => {
    const day = state.data.days[d];
    return !!day && ((day.entries || []).some((e) => e.logged) || hasCheckin(day));
  };
  let cur = has(iso) ? iso : addDays(iso, -1);
  let n = 0;
  while (has(cur)) { n++; cur = addDays(cur, -1); }
  return n;
}

/** Biggest personal best set in the last 7 days, if any. */
function recentPB(iso) {
  const from = addDays(iso, -6);
  const best = { jump: 0 };
  const seen = new Set();
  for (const [date, day] of Object.entries(state.data.days)) {
    if (date < from || date > iso) continue;
    for (const e of day.entries || []) {
      const l = num(e.load);
      if (!l || !e.logged || seen.has(e.ex + '|' + (e.side || 'B'))) continue;
      seen.add(e.ex + '|' + (e.side || 'B'));
      const prior = entriesFor(e.ex, e.side === 'B' ? null : e.side)
        .filter((x) => x.date < from && num(x.load) > 0)
        .map((x) => num(x.load));
      if (!prior.length) continue;
      const was = Math.max(...prior);
      if (l > was && l - was > best.jump) {
        Object.assign(best, { jump: l - was, now: l, was, ex: e.ex, unit: e.loadUnit || state.data.settings.weightUnit });
      }
    }
  }
  return best.jump > 0 ? best : null;
}

/** Average worst-knee pain, last 7 days vs the 7 before. */
function painTrend(iso) {
  const sample = (from, to) => {
    const vals = [];
    for (const [date, day] of Object.entries(state.data.days)) {
      if (date < from || date > to) continue;
      const c = day.checkin || {};
      const worst = Math.max(num(c.painL) ?? -1, num(c.painR) ?? -1);
      if (worst >= 0) vals.push(worst);
    }
    return vals;
  };
  const recent = sample(addDays(iso, -6), iso);
  const before = sample(addDays(iso, -13), addDays(iso, -7));
  if (recent.length < 2 || before.length < 2) return null;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return { now: round(avg(recent), 1), was: round(avg(before), 1) };
}

/** A measured test that improved within the last 14 days. */
function testGain(iso) {
  const from = addDays(iso, -13);
  let best = null;
  const CANDIDATES = ['sl_foam_task', 'sl_calf_raise', 'sl_squat_reps', 'sl_bridge', 'balance_eyes_open'];
  for (const id of CANDIDATES) {
    for (const leg of ['L', 'R']) {
      const rows = measurementsFor(id, leg).filter((r) => typeof r.value === 'number');
      const recent = rows.filter((r) => r.date >= from && r.date <= iso);
      const prior = rows.filter((r) => r.date < from);
      if (!recent.length || !prior.length) continue;
      const now = Math.max(...recent.map((r) => r.value));
      const was = Math.max(...prior.map((r) => r.value));
      if (now > was && (!best || (now - was) / was > best.rel)) {
        best = { id, leg, now, was, rel: (now - was) / was };
      }
    }
  }
  return best;
}

const MEASURE_NAMES = {
  sl_foam_task: 'foam balance', sl_calf_raise: 'calf raises', sl_squat_reps: 'single-leg squats',
  sl_bridge: 'single-leg bridges', balance_eyes_open: 'balance hold',
};

export function computeInsights(iso) {
  const out = [];

  const s = streak(iso);
  if (s >= 2) out.push({ icon: '🔥', title: `${s}-day streak`, sub: 'logged every day — keep the chain going', kind: 'good' });

  const pb = recentPB(iso);
  if (pb) {
    const name = EXERCISE_BY_ID[pb.ex]?.name || pb.ex;
    out.push({ icon: '🏆', title: `New best: ${round(pb.now, 1)} ${pb.unit}`, sub: `${name} — up from ${round(pb.was, 1)}`, kind: 'good' });
  }

  const g = testGain(iso);
  if (g) {
    out.push({ icon: '📈', title: `${MEASURE_NAMES[g.id] || g.id} climbing`, sub: `${g.leg === 'L' ? 'left' : 'right'}: ${round(g.was, 1)} → ${round(g.now, 1)}`, kind: 'good' });
  }

  const p = painTrend(iso);
  if (p) {
    if (p.now < p.was) out.push({ icon: '💚', title: 'Pain trending down', sub: `avg ${p.was} → ${p.now} over two weeks`, kind: 'good' });
    else if (p.now > p.was + 0.5) out.push({ icon: '⚠️', title: 'Pain creeping up', sub: `avg ${p.was} → ${p.now} — worth easing off`, kind: 'warn' });
  }

  return out.slice(0, 3);
}
