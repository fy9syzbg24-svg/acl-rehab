// What counts as done, and the one way rows get written.
//
// Today's tick, the Log it button, the bulk menu and the workout player all
// go through here, so a quick tick and a guided workout can never disagree
// about what an exercise's state is.
//
// Pure where it can be: itemStatus and sidesFor read only what they are given,
// so the tests run them against fixtures.

import { uid, num } from './util.js';

/** The rows an item needs: both legs at once, each leg, or one leg. */
export function sidesFor(item) {
  if (item?.sides === 'each') return ['L', 'R'];
  if (item?.sides === 'left') return ['L'];
  if (item?.sides === 'right') return ['R'];
  return ['B'];
}

/**
 * One program item on one day.
 *
 *   none     no rows at all
 *   started  rows exist but none is logged: scaffolding from opening the row,
 *            which is never a claim about what he did
 *   partial  something confirmed, but a required side is missing or a run
 *            was saved as partial
 *   done     every required side confirmed in full
 *
 * An unlogged scaffolding row beside a logged one is ignored: it is a copy
 * the app made, not an unfinished side. A logged side B row (a PhysiApp
 * import, or a tick on a both-legs item) covers every side, flagged `unsplit`
 * when the item is per leg, so nothing downstream reads it as a left and a
 * right measurement.
 */
export function itemStatus(item, entries) {
  const mine = (entries || []).filter((e) => e && e.pid === item.id);
  if (!mine.length) return { state: 'none', rows: mine };
  const logged = mine.filter((e) => e.logged);
  if (!logged.length) return { state: 'started', rows: mine };
  const need = sidesFor(item);
  const full = logged.filter((e) => !e.partial);

  const b = full.find((e) => (e.side || 'B') === 'B');
  if (b) {
    return {
      state: 'done', rows: mine,
      unsplit: need.length > 1,
      imported: b.via === 'physiapp',
    };
  }
  const covered = need.filter((s) => (s === 'B'
    ? ['L', 'R'].every((x) => full.some((e) => e.side === x))
    : full.some((e) => e.side === s)));
  if (covered.length === need.length) return { state: 'done', rows: mine };
  return { state: 'partial', rows: mine, missing: need.filter((s) => !covered.includes(s)) };
}

export const isDone = (item, entries) => itemStatus(item, entries).state === 'done';

/**
 * Fresh rows for an item, one per side. `prev(side)` supplies last time's
 * entry so a quick tick records the numbers he usually does.
 */
export function newEntriesFor(item, ex, { logged = false, prev = () => null, weightUnit = 'kg', band = '' } = {}) {
  return sidesFor(item).map((side) => {
    const p = prev(side);
    const row = {
      id: uid(),
      pid: item.id,
      ex: item.ex,
      logged,
      side,
      sets: p?.sets ?? item.sets ?? null,
      reps: p?.reps ?? item.reps ?? null,
      load: p?.load ?? null,
      loadUnit: p?.loadUnit || weightUnit,
      time: p?.time ?? null,
      band: ex?.usesBand ? (band || p?.band || item.band || '') : undefined,
    };
    if (logged) row.doneAt = new Date().toISOString();
    return row;
  });
}

/**
 * Tick or untick rows. A row confirmed now gets the time it was confirmed,
 * which is what the six hour notice reads; an untick drops it, because an
 * unticked row was not done at any time. A time already recorded is kept.
 */
export function setLogged(rows, on, now = new Date()) {
  for (const e of rows) {
    if (on) {
      if (!e.logged || !e.doneAt) e.doneAt = e.doneAt || now.toISOString();
      e.logged = true;
      delete e.partial;
    } else {
      e.logged = false;
      delete e.doneAt;
    }
  }
}

/** Seconds from any of the places a hold or duration can live on a row. */
export function secondsOn(e) {
  return num(e?.secs) ?? num(e?.hold) ?? null;
}
