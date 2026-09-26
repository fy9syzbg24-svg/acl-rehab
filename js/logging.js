// What counts as done, and the one way rows get written.
//
// Today's tick, the Log it button, the bulk menu and the workout player all
// go through here, so a quick tick and a guided workout can never disagree
// about what an exercise's state is.
//
// Pure where it can be: itemStatus and sidesFor read only what they are given,
// so the tests run them against fixtures.

import { uid, num, currentDayIso, toIso } from './util.js';
import { currentStep } from './progressions.js';

/**
 * The rows an item needs: both legs at once, each leg, or one leg. An item
 * whose sides changed keeps its old sides for days before the change
 * (`sidesBefore: { from, sides }`), so a day logged on one leg when one leg was
 * the prescription stays done (2026-09-18: the single-leg balance went from the
 * left leg only to both).
 */
export function sidesFor(item, onIso = null) {
  const sides = item?.sidesBefore && onIso && onIso < item.sidesBefore.from ? item.sidesBefore.sides : item?.sides;
  if (sides === 'each') return ['L', 'R'];
  if (sides === 'left') return ['L'];
  if (sides === 'right') return ['R'];
  return ['B'];
}

/** The local calendar date of the earliest confirmation among rows, or null. */
function firstDoneIso(rows) {
  const t = rows.map((e) => Date.parse(e.doneAt)).filter(Number.isFinite);
  if (!t.length) return null;
  const d = new Date(Math.min(...t));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
export function itemStatus(item, entries, onIso = null) {
  const mine = (entries || []).filter((e) => e && e.pid === item.id);
  if (!mine.length) return { state: 'none', rows: mine };
  const logged = mine.filter((e) => e.logged);
  if (!logged.length) return { state: 'started', rows: mine };
  // The day the rows belong to, when the caller knows it: a row ticked after
  // midnight would otherwise read the next day's side rule (audit F31).
  const need = sidesFor(item, onIso || firstDoneIso(logged));
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
export function newEntriesFor(item, ex, { logged = false, prev = () => null, weightUnit = 'kg', band = '', onIso = null } = {}) {
  // The day's own sides rule (sidesBefore), when the caller knows the day.
  return sidesFor(item, onIso).map((side) => {
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
      // Finishing a partial row finishes it now: the time it was part done
      // is not when it was done.
      if (!e.doneAt || e.partial) { e.doneAt = now.toISOString(); delete e.doneAtFrom; }
      e.logged = true;
      delete e.partial;
    } else {
      e.logged = false;
      delete e.doneAt;
      delete e.doneAtFrom;
    }
  }
}

/** Seconds from any of the places a hold or duration can live on a row. */
export function secondsOn(e) {
  return num(e?.secs) ?? num(e?.hold) ?? null;
}

// ------------------------------------------------------------ player runs --

/**
 * Save a confirmed player run into a day, in place (call inside update()).
 *
 * `review` is what he confirmed on the review sheet, per side:
 *   { sides: [{ side, sets, reps, repsBySet, secs, secsList, minutes, load, loadUnit, band, anyDone, full }],
 *     complete, discomfort, rpe, notes, inaccurate, timing: { activeSec, restSec, awaySec, interruptions, reviewSec } }
 *
 * Idempotent on runId: saving the same run twice updates its rows instead of
 * adding more. A side with nothing done writes nothing. Unlogged scaffolding
 * for a side is reused (it was only ever a copy of last time); a row he
 * already confirmed another way is left alone, and this run's result sits
 * beside it.
 */
/**
 * Mark the collagen taken one gap before the tendon loading, when he has
 * not marked it himself (his rule: the loading is always that gap after
 * the collagen). Shared by BOTH ways the loading gets logged.
 *
 * It lived only in Today's tick handler, so finishing the loading in the player
 * (the way he actually does it) never marked the collagen. His report,
 * 2026-09-16: "i just completed my tendon exercise, it should have
 * automatically logged the collagen because I hadnt logged it yet."
 *
 * Only ever ADDS a tick that is missing. A collagen he marked himself, at any
 * time, is left exactly as it is, because his recorded time is real and this is
 * an inference from the pair rule. Returns the supplement id if it marked one.
 */
/** Collagen first, the tendon loading an hour later (his rule, 60 min from
 *  2026-09-20; it was 30 before that). One number for the whole app. */
export const COLLAGEN_GAP_MIN = 60;
/**
 * `dayFor(iso)` hands back that date's day record (ensureDay). The tick goes on
 * the SUPPLEMENT day of the collagen's own time, which runs to 5am: a loading
 * finished at 00:15 marks the collagen at 23:45 the day before, where the
 * checklist shows it (audit F06, 2026-09-19). Returns { id, iso }, or false.
 */
export function inferCollagen(doc, iso, loadingAt, dayFor) {
  const supp = (doc?.supplements || []).find((s) => /collagen/i.test(s?.name || ''));
  if (!supp) return false;
  // Only for a loading logged on its own day: backfilling yesterday's loading
  // at 10am must not mark TODAY's collagen at 9 (2026-09-22 audit). Its day
  // is either the calendar day or, before 5am, the supplement day.
  const when = new Date(loadingAt);
  if (iso && iso !== toIso(when) && iso !== currentDayIso(when)) return false;
  const at = new Date(when.getTime() - COLLAGEN_GAP_MIN * 60000);
  const on = currentDayIso(at) || iso;
  const day = dayFor(on);
  if (!day) return false;
  if (day.supps && day.supps[supp.id]) return false;
  day.supps = { ...(day.supps || {}), [supp.id]: at.toISOString() };
  return { id: supp.id, iso: on, at: at.toISOString() };
}

/**
 * The progression step an item is at, as its plain text, or null at Base
 * (2026-09-22): written on each logged row so History shows when he moved up.
 * The text only, never the source's name (23 Sep), so rows read the same as
 * the ones saved before steps named who set them.
 */
export function levelOf(doc, item) {
  return currentStep(item, doc)?.t || null;
}

// A level is its step text; a step object (progressions.js) reads as its text.
const levelText = (level) => (level && typeof level === 'object' ? level.t : level) || null;

/**
 * True when this run is the first time he has logged the item at `level`:
 * no other logged row carries it (his ask, 22 Sep: after a first go at a new
 * step, make stepping back easy if it was too much).
 */
export function firstAtLevel(doc, pid, level, runId) {
  level = levelText(level);
  if (!level) return false;
  for (const day of Object.values(doc?.days || {})) {
    for (const e of day.entries || []) {
      if (e?.pid === pid && e.logged && e.level === level && e.runId !== runId) return false;
    }
  }
  return true;
}

/**
 * True when he has never logged `pid` at `level` (B3-4): no logged row carries
 * that level, or, at the Base (no level), no logged row at all. A fact for the
 * ready screen's "First time" chip, computed at render and never stored.
 */
export function neverAtLevel(doc, pid, level) {
  level = levelText(level);
  for (const day of Object.values(doc?.days || {})) {
    for (const e of day.entries || []) {
      if (e?.pid === pid && e.logged && (!level || e.level === level)) return false;
    }
  }
  return true;
}

export function saveRun(day, { item, run, review, now = new Date(), level = null }) {
  day.entries ||= [];
  const written = [];
  const at = now.toISOString();
  const timing = {
    runId: run.runId,
    at,
    activeSec: review.timing.activeSec,
    restSec: review.timing.restSec,
    awaySec: review.timing.awaySec,
    interruptions: review.timing.interruptions,
    reviewSec: review.timing.reviewSec ?? null,
    complete: !!(review.trainable ?? review.complete),
    inaccurate: !!review.inaccurate,
    rx: run.rx,
  };
  for (const s of review.sides) {
    if (!s.anyDone) continue;
    let row = day.entries.find((e) => e.runId === run.runId && (e.side || 'B') === s.side);
    if (!row) {
      row = day.entries.find((e) => e.pid === item.id && (e.side || 'B') === s.side && !e.logged && !e.runId);
    }
    if (!row) {
      row = { id: uid(), pid: item.id, ex: item.ex, side: s.side };
      day.entries.push(row);
    }
    const again = row.runId === run.runId;
    row.logged = true;
    row.runId = run.runId;
    if (!(again && row.doneAt)) { row.doneAt = at; delete row.doneAtFrom; }
    row.sets = s.sets ?? null;
    row.reps = s.reps ?? null;
    if (s.repsBySet?.length) row.repsBySet = s.repsBySet; else delete row.repsBySet;
    // How long each set took, in set order (his ask, 2026-09-15: "remember all
    // of the pace data for all of my exercises"). Written for its own sake:
    // nothing reads it yet, and pace data not captured at the time is gone for
    // good, so it is recorded from now rather than when something needs it.
    if (s.tookBySet?.length) row.tookBySet = s.tookBySet; else delete row.tookBySet;
    if (s.secs != null) row.secs = s.secs; else delete row.secs;
    if (s.secsList?.length) row.secsList = s.secsList; else delete row.secsList;
    if (s.minutes != null) row.time = s.minutes;
    if (s.load !== undefined) { row.load = s.load; if (s.loadUnit) row.loadUnit = s.loadUnit; }
    if (s.band !== undefined) row.band = s.band;
    if (review.rpe != null) row.rpe = review.rpe; else delete row.rpe;
    if (review.discomfort != null) row.discomfort = review.discomfort; else delete row.discomfort;
    if (review.notes) row.notes = review.notes;
    // A side done in full is not partial, even if another side is still to do:
    // itemStatus already reads the missing side as the unfinished part.
    if (s.full) delete row.partial; else row.partial = true;
    if (level) row.level = level; else delete row.level;
    row.rxSnap = run.rxSnap;
    // The same timing record on each row of the run; learning dedupes by runId.
    row.timing = timing;
    written.push(row);
  }
  return written;
}

/** A cheap fingerprint of one item's rows on a day, to spot a change made elsewhere. */
export function rowsFingerprint(day, pid) {
  return JSON.stringify((day?.entries || []).filter((e) => e.pid === pid)
    .map((e) => [e.id, !!e.logged, e.sets ?? null, e.reps ?? null, e.secs ?? null, e.time ?? null, e.load ?? null, e.runId ?? null])
    .sort());
}

/**
 * Every timing record for an item, for learned estimates. Cached per document
 * revision, so a render never rescans history and a new save is never missed.
 */
let runsCache = { rev: -1, byPid: null };
export function runsFor(doc, rev, pid) {
  if (runsCache.rev !== rev || !runsCache.byPid) {
    const byPid = {};
    for (const day of Object.values(doc?.days || {})) {
      for (const e of day.entries || []) {
        if (!e?.pid || !e.logged || !e.timing) continue;
        (byPid[e.pid] ||= []).push(e.timing);
      }
    }
    runsCache = { rev, byPid };
  }
  return runsCache.byPid[pid] || [];
}
