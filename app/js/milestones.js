// Earned milestones. Small, restrained, and aligned with following the plan:
// nothing here rewards more reps, more weight or extra sessions, only doing
// what was planned, consistently.
//
// Everything is derived from confirmed records at render time; there is no
// second copy of an achievement to drift or to wipe. The one thing stored is
// which milestones have already been CELEBRATED (program.seen, synced), so the
// moment plays once, on one device, and never again after a reload or a sync.
// Deleting that map loses nothing but the memory of an animation.
//
// 2026-09-14 ring design, settled with ChatGPT through Reuben:
//   - the existing ladder stays, plus First plan complete
//   - guided exercises count at most once per planned item per date, and only
//     when that item was confirmed done: a repeat, an unplanned extra or a
//     partial attempt never adds to it
//   - an earned milestone never disappears: streak steps come from the best
//     run of planned days, not the current one

import { planStreak, dayComplete, versionFor, plannedFromVersion } from './planstreak.js';
import { itemStatus } from './logging.js';
import { REHAB_PROGRAM, GYM_PROGRAM } from '../data/program.js';
import { addDays, weekStart, weekDays } from './util.js';

const ALL = REHAB_PROGRAM.concat(GYM_PROGRAM);
const BY_ID = Object.fromEntries(ALL.map((p) => [p.id, p]));
const FIRST = ALL.find((p) => p.first);

/** Planned items per date that were guided by the player and confirmed done. */
export function guidedCount(doc) {
  let n = 0;
  for (const [iso, day] of Object.entries(doc.days || {})) {
    const entries = day.entries || [];
    const guided = new Set(entries.filter((e) => e.logged && e.pid && e.timing?.runId).map((e) => e.pid));
    if (!guided.size) continue;
    const v = versionFor(doc, iso);
    const planned = v ? new Set(plannedFromVersion(v.value, doc, iso)) : null;
    if (!planned) continue;                       // an unknown plan stays unknown
    for (const pid of guided) {
      if (planned.has(pid) && BY_ID[pid] && itemStatus(BY_ID[pid], entries).state === 'done') n++;
    }
  }
  return n;
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

function firstVersionIso(doc) {
  const keys = Object.keys(doc?.program?.schedule || {}).sort();
  return keys[0] || null;
}

/**
 * The longest run of planned days done, over the known history. A planned
 * rest day keeps a run without adding to it; today never breaks one while it
 * is still going.
 */
export function bestStreak(doc, today) {
  const from = firstVersionIso(doc);
  if (!from || from > today) return 0;
  let best = 0;
  let run = 0;
  for (let d = from, guard = 0; d <= today && guard < 3000; d = addDays(d, 1), guard++) {
    const r = dayComplete(doc, d);
    if (!r) { run = 0; continue; }
    if (!r.planned) continue;
    if (r.complete) { run++; best = Math.max(best, run); } else if (d !== today) run = 0;
  }
  return best;
}

function planDays(doc, today) {
  const from = firstVersionIso(doc);
  if (!from) return 0;
  let n = 0;
  for (let d = from, guard = 0; d <= today && guard < 3000; d = addDays(d, 1), guard++) {
    const r = dayComplete(doc, d);
    if (r && r.planned && r.complete) n++;
  }
  return n;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// value: the best ever (earned steps never disappear); now: what "left" counts from
const LADDERS = [
  { id: 'firstplan', steps: [1], value: planDays,
    label: () => 'First plan complete', headline: () => 'First Plan Complete!', detail: () => 'Your first fully completed planned day',
    sentence: () => 'Your first complete planned day. Nicely done.' },
  { id: 'streak', steps: [3, 7, 14, 30, 60], value: bestStreak, now: planStreak,
    label: (n) => `${n} planned days in a row`, headline: (n) => `${n} Planned Days in a Row!`, detail: () => 'Earned by following your plan',
    sentence: (n) => `${n} planned days in a row. Nicely done.` },
  { id: 'first', steps: [7, 30, 60, 100], value: firstItemDays,
    label: (n) => plural(n, 'tendon loading day', 'tendon loading days'), headline: (n) => `${n} Tendon Loading Days!`, detail: () => 'The first job of the day, done',
    sentence: (n) => `${n} tendon loading days. Nicely done.` },
  { id: 'weeks', steps: [1, 4, 8, 12], value: fullWeeks,
    label: (n) => plural(n, 'full planned week', 'full planned weeks'), headline: (n) => (n === 1 ? 'A Full Planned Week!' : `${n} Full Planned Weeks!`), detail: () => 'Every planned day in the week done',
    sentence: (n) => (n === 1 ? 'A full planned week. Nicely done.' : `${n} full planned weeks. Nicely done.`) },
  { id: 'guided', steps: [1, 10, 50, 100], value: guidedCount,
    label: (n) => (n === 1 ? 'First guided exercise' : `${n} guided exercises`), headline: (n) => (n === 1 ? 'First Guided Exercise!' : `${n} Guided Exercises!`), detail: () => 'Planned exercises done with the player',
    sentence: (n) => (n === 1 ? 'Your first guided exercise. Nicely done.' : `${n} guided exercises. Nicely done.`) },
];

/**
 * Every step earned, as the collection Progress shows, newest ladder step
 * last within each ladder: [{ key, id, n, label, detail, sentence }].
 */
export function earnedAll(doc, today) {
  const out = [];
  for (const l of LADDERS) {
    const v = l.value(doc, today);
    for (const n of l.steps.filter((s) => v >= s)) {
      out.push({ key: `ms:${l.id}:${n}`, id: l.id, n, label: l.label(n), headline: l.headline(n), detail: l.detail(n), sentence: l.sentence(n) });
    }
  }
  return out;
}

/**
 * { earned: [{ id, label, n }], next: [{ id, label, left }] }: the highest
 * step reached per ladder, and how far away the next one is.
 */
export function milestones(doc, today) {
  const earned = [];
  const next = [];
  for (const l of LADDERS) {
    const v = l.value(doc, today);
    const reached = l.steps.filter((s) => v >= s);
    if (reached.length) {
      const n = reached[reached.length - 1];
      earned.push({ key: `ms:${l.id}:${n}`, id: l.id, label: l.label(n), detail: l.detail(n), n });
    }
    const up = l.steps.find((s) => v < s);
    if (up) {
      const cur = l.now ? l.now(doc, today) : v;
      next.push({ id: l.id, label: l.label(up), left: Math.max(1, up - cur) });
    }
  }
  return { earned, next };
}

// ------------------------------------------------------------ celebrated --
/** True once this device's document has ever recorded a celebration. */
function hasSeen(doc) {
  return Object.keys(doc?.program?.seen || {}).some((k) => k.startsWith('ms:'));
}

/**
 * Milestones earned but not yet celebrated. The very first time (no record
 * at all) nothing counts as new: what he had already earned before this
 * existed is not replayed as a burst of celebrations.
 */
export function unseenMilestones(doc, today) {
  if (!hasSeen(doc)) return [];
  const seen = doc.program.seen;
  return earnedAll(doc, today).filter((m) => !seen[m.key]);
}

/**
 * Inside update(): record these as celebrated. The first time there is no
 * record at all, everything already earned is recorded silently instead.
 * Returns true when it wrote something.
 */
export function markSeen(doc, today, list = null) {
  doc.program ||= {};
  const had = hasSeen(doc);
  const seen = (doc.program.seen ||= {});
  let wrote = false;
  const rows = had ? (list || earnedAll(doc, today)) : earnedAll(doc, today);
  for (const m of rows) if (!seen[m.key]) { seen[m.key] = today; wrote = true; }
  // An empty history still needs a record, or the next milestone would be
  // mistaken for the first-ever look and pass without its moment.
  if (!had && !seen['ms:start']) { seen['ms:start'] = today; wrote = true; }
  return wrote;
}

export function needsSeed(doc) {
  return !hasSeen(doc);
}

/** Inside update(): the finish celebration for a date has played. */
export function markFinishSeen(doc, iso) {
  doc.program ||= {};
  doc.program.seen ||= {};
  doc.program.seen[`finish:${iso}`] ||= iso;
}

export function finishSeen(doc, iso) {
  return !!doc?.program?.seen?.[`finish:${iso}`];
}

/** The one sentence for a milestone moment: the most significant new one. */
export function milestoneSentence(list) {
  if (!list.length) return null;
  const order = ['weeks', 'streak', 'first', 'firstplan', 'guided'];
  const pick = list.slice().sort((a, b) => (order.indexOf(a.id) - order.indexOf(b.id)) || (b.n - a.n))[0];
  return pick;
}
