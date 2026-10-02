// Targets his clinician set, as the first mark every result is read against
// (2026-09-18). A population average is a fact about other people; a goal from
// his own clinician is about him, so it outranks it on every card and chart
// that has one.
//
// The goals are his clinical data, in the synced case file (`caseFile.goals`,
// one `k|goals` record), never in this public shell. Each goal:
//   measure  the test id in measurements.js
//   legs     ['L', 'R'], ['L'], or null for a test with no legs
//   value    the number, in `unit` (the measure's own unit)
//   cmp      '>=' (at least), '>' (over), '<=' or '<' for lower-is-better tests
//   stage    '6 weeks' or 'discharge', as the plan of care words it
//   by       ISO date the stage ends, when the plan gives one; null otherwise
//   set      ISO date of the note that set it
//   who      the clinician, as charted
//   words    the goal in the note's own words
//
// Pure where it can be: activeGoal and gapWords take what they read, so the
// tests run them against fixtures.

import { state } from './store.js';

export function goalsFor(measureId, doc = state.data) {
  return (doc?.caseFile?.goals || [])
    .filter((g) => g && g.measure === measureId && typeof g.value === 'number')
    .slice()
    // Earliest stage first: a dated stage before an undated one, then the
    // smaller mark, so "95 lb in six weeks" comes before "over 100 by discharge".
    .sort((a, b) => ((a.by || '9999') < (b.by || '9999') ? -1 : (a.by || '9999') > (b.by || '9999') ? 1 : a.value - b.value));
}

export function meets(g, v) {
  if (typeof v !== 'number') return false;
  if (g.cmp === '>') return v > g.value;
  if (g.cmp === '<=') return v <= g.value;
  if (g.cmp === '<') return v < g.value;
  return v >= g.value;
}

/** The legs a goal names that have a result: [{ leg, value }]. */
export function goalLegs(g, legs) {
  if (!legs) return [];
  if (!g.legs) return legs.B && typeof legs.B.value === 'number' ? [{ leg: 'B', value: legs.B.value }] : [];
  return g.legs.map((leg) => ({ leg, value: legs[leg]?.value })).filter((x) => typeof x.value === 'number');
}

/**
 * The goal to read these results against now: the earliest one not yet met by
 * every leg it names. Once all are met, the last one, so the card says so.
 */
export function activeGoal(measureId, legs, doc = state.data) {
  const gs = goalsFor(measureId, doc);
  for (const g of gs) {
    const have = goalLegs(g, legs);
    if (!have.length || have.some((x) => !meets(g, x.value))) return g;
  }
  return gs[gs.length - 1] || null;
}

const LEG = { L: 'left', R: 'right', B: '' };
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Arithmetic on the goal and the printed numbers, never a verdict:
 * "Both legs short of the goal: left 11 lb, right 14.8 lb to go",
 * "Left at the goal, right 3 lb to go", "At the goal".
 */
export function gapWords(g, legs, unit = g.unit || '') {
  const have = goalLegs(g, legs);
  if (!have.length) return '';
  const lower = g.cmp === '<=' || g.cmp === '<';
  const u = unit ? ` ${unit}` : '';
  // Level with a goal that must be passed ("> 100") is short by a hair, not
  // "0 lb to go" (2026-09-22 audit).
  const gap = (v) => { const d = r1(Math.abs(g.value - v)); return d === 0 ? (lower ? 'a little lower' : 'a little more') : `${d}${u}`; };
  const short = have.filter((x) => !meets(g, x.value));
  if (!short.length) return have.length > 1 ? 'Both legs at the goal' : 'At the goal';
  const dir = lower ? 'to come down' : 'to go';
  if (have.length === 1) return `${have[0].leg === 'B' ? '' : `${cap(LEG[have[0].leg])} `}${gap(have[0].value)} ${dir}`;
  if (short.length === have.length) {
    return `Both legs short of the goal: ${have.map((x) => `${LEG[x.leg]} ${gap(x.value)}`).join(', ')} ${dir}`;
  }
  const met = have.filter((x) => meets(g, x.value));
  return `${met.map((x) => cap(LEG[x.leg])).join(' and ')} at the goal, ${short.map((x) => `${LEG[x.leg]} ${gap(x.value)}`).join(', ')} ${dir}`;
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };

/** "Goal 95 lb by Oct 23" or "Discharge goal over 100 lb". */
export function goalLabel(g, unit = g.unit || '') {
  const u = unit ? ` ${unit}` : '';
  const amount = g.cmp === '>' ? `over ${g.value}` : g.cmp === '<' ? `under ${g.value}` : `${g.value}`;
  if (g.stage === 'discharge') return `Discharge goal ${amount}${u}`;
  return `Goal ${amount}${u}${g.by ? ` by ${shortDate(g.by)}` : ''}`;
}

/** The clinician's surname or first two words, for a short line. */
export const goalWho = (g) => String(g.who || '').split(',')[0].trim();
