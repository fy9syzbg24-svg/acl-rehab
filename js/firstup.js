// The tendon loading can be either of two exercises (his physio, 18 Sep): the
// mini squat or the lunge. Both sit in First up; he does one in the morning and
// the other later. Whichever he logs first that day is the ANCHOR: it sets the
// collagen time (the gap before) and the six hours before the rest of the
// workout. Everything that used to read "the first item" reads the anchor.

import { REHAB_PROGRAM, GYM_PROGRAM } from '../data/program.js';
import { itemStatus } from './logging.js';

export const FIRST_ITEMS = REHAB_PROGRAM.concat(GYM_PROGRAM).filter((p) => p.first);

const doneAtOf = (entries, item) => {
  const t = entries.filter((e) => e.pid === item.id && e.logged && e.doneAt)
    .map((e) => Date.parse(e.doneAt)).filter((x) => !Number.isNaN(x));
  return t.length ? Math.max(...t) : Infinity;
};

/** The first-up item he finished first on `iso`, or null when neither is done. */
export function anchorFirst(doc, iso) {
  const entries = doc?.days?.[iso]?.entries || [];
  const done = FIRST_ITEMS.filter((p) => itemStatus(p, entries).state === 'done');
  if (!done.length) return null;
  return done.slice().sort((a, b) => doneAtOf(entries, a) - doneAtOf(entries, b))[0];
}

/** True when no OTHER first-up item was finished before `at` that day. */
export function leadsTheDay(doc, iso, item, at) {
  const entries = doc?.days?.[iso]?.entries || [];
  const t = at instanceof Date ? at.getTime() : Date.parse(at);
  return !FIRST_ITEMS.some((p) => p.id !== item.id
    && itemStatus(p, entries).state === 'done' && doneAtOf(entries, p) < t);
}

/**
 * The plan with the tendon loading counted once (his call, 18 Sep): the one he
 * did first stands for both, else the first listed. For counters and the ring;
 * the list itself still shows both rows.
 */
export function oneTendon(doc, iso, planned) {
  const firsts = planned.filter((p) => p.first);
  if (firsts.length < 2) return planned;
  const a = anchorFirst(doc, iso);
  const keep = (a && firsts.find((p) => p.id === a.id)) || firsts[0];
  return planned.filter((p) => !p.first || p === keep);
}
