// The plan streak, and the dated schedule versions it reads.
//
// A streak that counts "any day with a tick or a check-in" rewards the wrong
// thing and breaks on a planned rest day. This one counts days whose PLANNED
// work was done, judged against the plan that day actually had:
//
//   program.schedule[iso] = { days: { pid: ['mon', ...] }, clinicIds: [...] }
//
// A version is the RESOLVED plan (weekday lists and the clinic-day list), not
// a pointer to code, so neither a later edit on My Program nor a later code
// change can rewrite what an earlier day asked of him. A version takes effect
// on the day it is written, from that day onwards (his rule for the supplement
// list: a change applies from today, and past days keep what they had).
// A clinic mark is a fact about one date, read from program.clinicDays.
//
// Dates before the first version are unknown: the walk stops there, rather
// than judging old days against today's arrangement. A known day with nothing
// planned keeps the streak without adding to it. Check-ins never count.
//
// Pure: everything reads the document it is given.

import { REHAB_PROGRAM, GYM_PROGRAM, CLINIC_DAY_IDS, DAY_KEYS, dayKeyOf } from '../data/program.js';
import { itemStatus } from './logging.js';
import { addDays } from './util.js';

const ALL = REHAB_PROGRAM.concat(GYM_PROGRAM);
const BY_ID = Object.fromEntries(ALL.map((p) => [p.id, p]));

/** Today's arrangement, resolved into plain lists. */
export function resolveSchedule(doc) {
  const days = {};
  for (const p of ALL) {
    if (p.notYet) { days[p.id] = []; continue; }
    const d = doc?.program?.days?.[p.id];
    days[p.id] = Array.isArray(d) ? DAY_KEYS.filter((k) => d.includes(k)) : DAY_KEYS.slice();
  }
  const clinicIds = CLINIC_DAY_IDS.filter((id) => BY_ID[id] && !BY_ID[id].notYet);
  return { days, clinicIds };
}

/** The version in force on a date: { iso, value } or null before the first. */
export function versionFor(doc, iso) {
  const map = doc?.program?.schedule || {};
  let best = null;
  for (const k of Object.keys(map)) {
    if (k <= iso && (!best || k > best)) best = k;
  }
  return best ? { iso: best, value: map[best] } : null;
}

/**
 * Write a version effective `iso` if the arrangement differs from the one in
 * force. Returns true when it wrote. Call inside a stamped mutation.
 */
export function recordScheduleVersion(doc, iso) {
  const now = resolveSchedule(doc);
  const cur = versionFor(doc, iso);
  if (cur && JSON.stringify(cur.value) === JSON.stringify(now)) return false;
  doc.program ||= {};
  doc.program.schedule ||= {};
  doc.program.schedule[iso] = now;
  return true;
}

/** Program ids a version plans for a date (a clinic mark narrows the day). */
export function plannedFromVersion(version, doc, iso) {
  if (!version) return null;
  if (doc?.program?.clinicDays?.[iso]) return (version.clinicIds || []).slice();
  const key = dayKeyOf(iso);
  return Object.entries(version.days || {}).filter(([, ks]) => ks.includes(key)).map(([id]) => id);
}

/**
 * One slot per planned item, true when done, with the tendon loading counted
 * ONCE (his call, 18 Sep; oneTendon in firstup.js): any one first-up item done
 * covers them all. Today's header, ring and badge already counted it that way,
 * so the day could read "All done!" while the streak refused it (2026-09-22).
 */
function slotsDone(ids, entries) {
  const ok = (id) => !BY_ID[id] || itemStatus(BY_ID[id], entries).state === 'done';
  const firsts = ids.filter((id) => BY_ID[id]?.first);
  const slots = ids.filter((id) => !BY_ID[id]?.first).map(ok);
  if (firsts.length) slots.push(firsts.some(ok));
  return slots;
}

/**
 * Days in a row with the planned work done, ending today. Today counts once
 * it is complete and never breaks the streak while it is still going.
 */
export function planStreak(doc, today) {
  let n = 0;
  let d = today;
  for (let guard = 0; guard < 2000; guard++) {
    const v = versionFor(doc, d);
    if (!v) break;
    const ids = plannedFromVersion(v.value, doc, d);
    if (ids.length) {
      const done = slotsDone(ids, doc.days?.[d]?.entries || []).every(Boolean);
      if (done) n++;
      else if (d !== today) break;
    }
    d = addDays(d, -1);
  }
  return n;
}

/** Was every planned item done on a known date? null when the date is unknown. */
export function dayComplete(doc, iso) {
  const v = versionFor(doc, iso);
  if (!v) return null;
  const ids = plannedFromVersion(v.value, doc, iso);
  if (!ids.length) return { planned: 0, done: 0, complete: true };
  const slots = slotsDone(ids, doc.days?.[iso]?.entries || []);
  const done = slots.filter(Boolean).length;
  return { planned: slots.length, done, complete: done === slots.length };
}
