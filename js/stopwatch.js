// Balance held as long as it lasts (his idea, 2026-09-18). The workout player
// runs it as an open hold (engine.js): the hold counts past its goal until Set
// done, a pause starts a new attempt, and each hold records its best attempt.
// Here: the day's best per leg becomes that leg's test result, so Progress gets
// the same test from every session without a separate step.

import { uid } from './util.js';
import { exerciseById } from './components.js';
import { MEASURE_BY_ID } from '../data/measurements.js';
import { parseSeconds } from './timing.js';

/**
 * The goal for an open hold (his rule, 18 Sep): his all-time best hold of this
 * exercise on either leg, the same goal for both legs, never below the
 * prescribed start. Rounded up to a whole second so the goal is never under
 * the record. Null until there is a round to go on. Today's rounds count.
 * Until then the goal is the prescribed hold, which is his clinicians' number:
 * Elise's 45 s for the bridge, Elise's and Derrick's 30 s for the balance. His
 * own rounds count from GOALS_FROM (his call: "starting tomorrow").
 */
export const GOALS_FROM = '2026-09-19';
export function openGoal(d, item, iso) {
  if (!item?.stopwatch) return null;
  const vals = Object.keys(d?.days || {}).filter((k) => k >= GOALS_FROM && k <= iso)
    .flatMap((k) => d.days[k].entries || [])
    .filter((e) => e.pid === item.id && e.logged)
    .flatMap((e) => (e.secsList?.length ? e.secsList : [e.secs]))
    .filter((x) => typeof x === 'number' && x > 0);
  if (!vals.length) return null;
  return Math.max(parseSeconds(item.hold) || 0, Math.ceil(Math.max(...vals)));
}

/** The item with his goal in it: `holdBySide` for the player, `hold` for the line. */
export function withGoals(d, item, iso) {
  const g = openGoal(d, item, iso);
  if (g == null) return item;
  return { ...item, holdBySide: { L: g, R: g, B: g }, hold: `${g}s` };
}

/**
 * After the player saves an open-hold exercise: each leg's best hold that day
 * becomes the leg's test result (inside update()). A result from anywhere else
 * that day is left alone; the player's own is kept at the day's best.
 */
export function recordBestTests(d, iso, item) {
  const ex = exerciseById(item.ex);
  const m = ex?.measure ? MEASURE_BY_ID[ex.measure] : null;
  if (!m || m.unit !== 'sec' || !m.perLeg) return;
  const rows = (d.days?.[iso]?.entries || []).filter((e) => e.pid === item.id && e.logged);
  for (const side of ['L', 'R']) {
    const vals = rows.filter((e) => e.side === side).flatMap((e) => (e.secsList?.length ? e.secsList : [e.secs])).filter((x) => typeof x === 'number');
    if (!vals.length) continue;
    const best = Math.max(...vals);
    const r = d.measurements.find((x) => x.measure === m.id && x.date === iso && x.leg === side && x.src === 'Workout player');
    if (r) { if (best > r.value) r.value = best; continue; }
    if (d.measurements.some((x) => x.measure === m.id && x.date === iso && x.leg === side)) continue;
    d.measurements.push({ id: uid(), date: iso, measure: m.id, leg: side, value: best, unit: 'sec', src: 'Workout player' });
  }
}
