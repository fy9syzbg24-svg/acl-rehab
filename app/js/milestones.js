// Earned milestones. Small, restrained, and aligned with following the plan:
// nothing here rewards more reps, more weight or extra sessions, only doing
// what was planned, consistently.
//
// Everything is derived from confirmed records at render time; nothing is
// stored, so there is no second copy to drift or to wipe. A tick without a
// timing record never claims a timed hold was done: the guided milestones
// count only runs the player actually recorded.

import { planStreak, dayComplete } from './planstreak.js';
import { itemStatus } from './logging.js';
import { REHAB_PROGRAM, GYM_PROGRAM } from '../data/program.js';
import { addDays, weekStart, weekDays } from './util.js';

const ALL = REHAB_PROGRAM.concat(GYM_PROGRAM);
const FIRST = ALL.find((p) => p.first);

/** Distinct run ids the player saved, ever. */
function guidedRuns(doc) {
  const ids = new Set();
  for (const day of Object.values(doc.days || {})) {
    for (const e of day.entries || []) if (e.logged && e.timing?.runId) ids.add(e.timing.runId);
  }
  return ids.size;
}

function firstItemDays(doc) {
  if (!FIRST) return 0;
  let n = 0;
  for (const day of Object.values(doc.days || {})) {
    if (itemStatus(FIRST, day.entries || []).state === 'done') n++;
  }
  return n;
}

/** Known weeks (Mon to Sun, all past) where every planned day was done. */
function fullWeeks(doc, today) {
  let n = 0;
  let ws = weekStart(addDays(weekStart(today), -1));
  for (let guard = 0; guard < 60; guard++) {
    const days = weekDays(ws);
    const results = days.map((d) => dayComplete(doc, d));
    if (results.some((r) => r === null)) break;          // before the first version
    if (results.every((r) => r.complete)) n++;
    ws = addDays(ws, -7);
  }
  return n;
}

const LADDERS = [
  { id: 'streak', label: (n) => `${n} day plan streak`, steps: [3, 7, 14, 30, 60], value: (doc, t) => planStreak(doc, t) },
  { id: 'first', label: (n) => `${n} tendon loading days`, steps: [7, 30, 60, 100], value: (doc) => firstItemDays(doc) },
  { id: 'weeks', label: (n) => `${n} full planned week${n === 1 ? '' : 's'}`, steps: [1, 4, 8, 12], value: (doc, t) => fullWeeks(doc, t) },
  { id: 'guided', label: (n) => (n === 1 ? 'First guided exercise' : `${n} guided exercises`), steps: [1, 10, 50, 100], value: (doc) => guidedRuns(doc) },
];

/**
 * { earned: [{ id, label, n }], next: [{ id, label, left }] } - the highest
 * step reached per ladder, and how far the next one is.
 */
export function milestones(doc, today) {
  const earned = [];
  const next = [];
  for (const l of LADDERS) {
    const v = l.value(doc, today);
    const reached = l.steps.filter((s) => v >= s);
    if (reached.length) earned.push({ id: l.id, label: l.label(reached[reached.length - 1]), n: reached[reached.length - 1] });
    const up = l.steps.find((s) => v < s);
    if (up) next.push({ id: l.id, label: l.label(up), left: up - v });
  }
  return { earned, next };
}
