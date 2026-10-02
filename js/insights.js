// A small, honest rules engine. Every insight is computed from real logged
// data; if the data isn't there, the insight simply doesn't appear.

import { state, entriesFor, hasCheckin, measurementsFor } from './store.js';
import { addDays, num, round, toKg, fromKg } from './util.js';
import { EXERCISE_BY_ID } from '../data/exercises.js';
import { planStreak } from './planstreak.js';

// Drawn glyphs, never emoji: iOS renders emoji as stickers and they read as
// "random little things". Stroke SVGs take the card's colour.
const ICON = {
  flame: '<svg viewBox="0 0 24 24"><path d="M12 3c1 3 4 4.5 4 9a4 4 0 0 1-8 0c0-2 1-3 1-3s.5 2 2 2c0-3-1-5 1-8z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M4 7l6 6 4-4 6 7"/><path d="M15 16h5v-5"/></svg>',
};

/** Biggest personal best set in the last 7 days, if any. */
function recentPB(iso) {
  const from = addDays(iso, -6);
  const best = { jump: 0 };
  // In the Settings unit (Codex audit B04): 50 lb after 30 kg is not a 20 point jump.
  const unit = state.data.settings.weightUnit || 'kg';
  const inUnit = (x) => fromKg(toKg(num(x.load), x.loadUnit || unit), unit);
  // The window's heaviest per exercise and side, then compared: it used to look
  // at the first row it met and miss a heavier one later in the week
  // (2026-09-22 audit).
  const top = new Map();
  for (const [date, day] of Object.entries(state.data.days)) {
    if (date < from || date > iso) continue;
    for (const e of day.entries || []) {
      if (!num(e.load) || !e.logged) continue;
      const k = e.ex + '|' + (e.side || 'B');
      if (!top.has(k) || inUnit(e) > inUnit(top.get(k))) top.set(k, e);
    }
  }
  for (const e of top.values()) {
    const prior = entriesFor(e.ex, e.side === 'B' ? null : e.side)
      .filter((x) => x.date < from && num(x.load) > 0)
      .map(inUnit);
    if (!prior.length) continue;
    const was = Math.max(...prior);
    const now = inUnit(e);
    if (now > was && now - was > best.jump) {
      Object.assign(best, { jump: round(now - was, 1), now: round(now, 1), was: round(was, 1), ex: e.ex, unit });
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

  // The plan streak: days whose planned work was done. Rest days keep it.
  // 2026-09-14 ring design: the plan streak has its own summary on Overview,
  // and nothing here praises more load. A heaviest set is a fact, stated
  // plainly; green is kept for confirmed done.

  const pb = recentPB(iso);
  if (pb) {
    const name = EXERCISE_BY_ID[pb.ex]?.name || pb.ex;
    out.push({ icon: ICON.star, title: `Heaviest so far: ${round(pb.now, 1)} ${pb.unit}`, sub: `${name}: was ${round(pb.was, 1)}`, kind: 'info' });
  }

  const g = testGain(iso);
  if (g) {
    out.push({ icon: ICON.up, title: `${MEASURE_NAMES[g.id] || g.id} climbing`, sub: `${g.leg === 'L' ? 'left' : 'right'}: ${round(g.was, 1)} → ${round(g.now, 1)}`, kind: 'info' });
  }

  const p = painTrend(iso);
  if (p) {
    if (p.now < p.was) out.push({ icon: ICON.down, title: 'Pain trending down', sub: `avg ${p.was} → ${p.now} over two weeks`, kind: 'info' });
    else if (p.now > p.was + 0.5) out.push({ icon: ICON.warn, title: 'Pain creeping up', sub: `avg ${p.was} → ${p.now}. Ease off`, kind: 'warn' });
  }

  return out.slice(0, 3);
}
