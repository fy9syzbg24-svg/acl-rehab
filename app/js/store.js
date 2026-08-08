// State + persistence. The whole document is PUT back to the server on a
// short debounce; the file on disk is the source of truth.

import { debounce, uid, todayIso, weekStart, weekDays } from './util.js';
import { CASE, hydrateCase, loadLocalCase } from '../data/history.js';
import { hydrateProgramSource } from '../data/program.js';
import { monthForDate } from '../data/plan.js';
import { EXERCISE_BY_ID } from '../data/exercises.js';
import { CATEGORIES } from '../data/measurements.js';
import { seedSupplements, seedPrnMeds } from './views/supplements.js';
import { collectRecords, fingerprint } from './sync/records.js';
import { stampChanges, stampAll, pendingCount } from './sync/merge.js';
import { readLocalDoc, writeLocalDoc, SERVER_MODE } from './sync/local-store.js';
import { syncNow } from './sync/engine.js';
import { isConfigured, getConfig } from './sync/config.js';

const SCHEMA = 7;   // 7 adds supplements/doses; 6 added _sync and caseFile

/**
 * A stable id for THIS device, kept out of the synced document on purpose —
 * it identifies the machine, not the data, and is what breaks a dead-heat
 * conflict the same way on both devices.
 */
export const DEVICE_ID = (() => {
  const KEY = 'rehab.deviceId';
  try {
    let v = localStorage.getItem(KEY);
    if (!v) { v = `${navigator.platform || 'dev'}-${uid()}`.replace(/\s+/g, ''); localStorage.setItem(KEY, v); }
    return v;
  } catch {
    return `ephemeral-${uid()}`;   // private browsing; still deterministic per session
  }
})();

function blank() {
  return {
    schema: SCHEMA,
    settings: {
      surgeryLeft: CASE.legs.left.date,
      surgeryRight: CASE.legs.right.date,
      injuryDate: CASE.injuryDate,
      dominantLeg: 'right',
      weightUnit: 'kg',
      lengthUnit: 'cm',
      bodyweight: null,
      weeklyOverrides: {},
      seeded: false,
    },
    days: {},
    measurements: [],
    planGoals: {},
    planFocus: {},
    melbourne: { phases: {}, measures: {} },
    mrss: [],
    customExercises: [],
    supplements: [],
    prnMeds: [],
    doses: [],
    // Clinician program: which progression step you're on, and your current
    // band colour, per program item.
    program: { stage: {}, band: {}, weeklyTarget: {} },
  };
}

export const state = {
  data: blank(),
  saving: false,
  lastSaved: null,
  error: null,
  // Set when the first load could not reach the server. While true the app
  // shows an empty shell but refuses to write, so a failed load can never
  // overwrite good data on disk with a freshly seeded blank.
  readOnly: false,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  // A sync pull can replace caseFile, so repoint the live bindings first.
  hydrateCase(state.data);
  hydrateProgramSource(state.data);
  for (const fn of listeners) fn();
}

// ---------------------------------------------------------------- loading ---
export async function load() {
  let incoming = null;
  let reachable = false;
  try {
    incoming = await readLocalDoc();     // Mac: server. iPhone: IndexedDB.
    reachable = true;
  } catch (err) {
    /* handled below */
  }

  if (!reachable) {
    if (SERVER_MODE) {
      // Mac only: the server is down. Never seed and never save off a failed
      // read — that is how a blank document overwrites a real one on disk.
      state.readOnly = true;
      state.error = 'Cannot reach the server. Nothing you type will be saved — start the server and reload.';
      state.data = migrate(blank());
      emit();
      return;
    }
    // iPhone: IndexedDB itself failed (rare). Open anyway with a blank doc so
    // the app is never dead on arrival; the next sync repopulates it.
    incoming = {};
  }

  state.readOnly = false;
  const hadContent = incoming && Object.keys(incoming).length > 0;
  const hadSchema = incoming?.schema || 0;
  incoming = incoming || {};

  // Your clinical history is not in this repo. On the Mac it comes from the
  // gitignored data/case.local.js the first time and is then carried in the
  // document itself, so the iPhone receives it over sync like any other data.
  // Fill in per field, not all-or-nothing: an older document may already have
  // a caseFile from before a field existed, and an all-or-nothing check would
  // skip it forever.
  const localCase = await loadLocalCase();
  let seededCase = false;
  if (localCase) {
    const cf = (incoming.caseFile ||= {});
    const want = {
      case: localCase.case, timeline: localCase.timeline, hep: localCase.hep,
      programSource: localCase.programSource, gymSource: localCase.gymSource,
    };
    for (const [k, v] of Object.entries(want)) {
      if (cf[k] === undefined && v !== undefined) { cf[k] = v; seededCase = true; }
    }
  }
  // Hydrate before migrate(): blank() reads CASE for the default surgery dates.
  hydrateCase(incoming);
  hydrateProgramSource(incoming);

  state.data = migrate(hadContent ? incoming : blank());
  hydrateCase(state.data);

  const alreadySynced = !!incoming._sync;

  if (!state.data.settings.seeded && localCase) {
    // Fresh Mac: seed from the local clinical file, then baseline-stamp so the
    // seeded data syncs UP to the repo on first connect.
    seed(state.data, localCase);
    state.data.settings.seeded = true;
    queueSave();
  } else if (hadSchema < SCHEMA || seededCase) {
    queueSave();
  }

  // Baseline-stamp anything on a populated device that has no timestamp yet.
  // Runs unconditionally (it only fills gaps) so that records introduced by a
  // LATER version — caseFile was one — get stamped and pushed rather than
  // sitting invisible to sync forever.
  if (seedSupplements(state.data)) queueSave();
  if (seedPrnMeds(state.data)) queueSave();

  if (hadContent) stampAll(state.data, DEVICE_ID);

  // A fresh device with no local content (a new iPhone) is deliberately left
  // UNSTAMPED and unseeded: its records default to time 0, so the first sync
  // pulls the real data down wholesale instead of a blank default winning.

  emit();

  // Pull anything new the moment we open, if this device is connected. Never
  // blocks startup — the app is already usable from local data above.
  if (isConfigured()) runSync('startup');
}

function migrate(d) {
  const base = blank();
  const out = { ...base, ...d };
  out.settings = { ...base.settings, ...(d.settings || {}) };
  out.melbourne = { ...base.melbourne, ...(d.melbourne || {}) };
  out.melbourne.phases = out.melbourne.phases || {};
  out.melbourne.measures = out.melbourne.measures || {};
  out.days = out.days || {};
  out.measurements = out.measurements || [];
  out.planGoals = out.planGoals || {};
  out.planFocus = out.planFocus || {};
  out.mrss = out.mrss || [];
  out.customExercises = out.customExercises || [];
  out.supplements = out.supplements || [];
  out.prnMeds = out.prnMeds || [];
  out.doses = out.doses || [];
  out.program = { stage: {}, band: {}, weeklyTarget: {}, ...(d.program || {}) };
  out.program.stage = out.program.stage || {};
  out.program.band = out.program.band || {};
  out.program.weeklyTarget = out.program.weeklyTarget || {};
  if ((d.schema || 0) < 4) dedupeEntries(out);
  if ((d.schema || 0) < 5) markExistingLogged(out);
  out.schema = SCHEMA;
  return out;
}

/**
 * One-time repair. Earlier builds let "Repeat last session" copy a whole day
 * including rows it had copied before, so entries multiplied every press.
 * Collapse each exercise+side back to a single row, keeping the one that
 * actually carries numbers.
 */
function dedupeEntries(d) {
  for (const day of Object.values(d.days || {})) {
    const seen = new Map();
    for (const e of day.entries || []) {
      const key = `${e.pid || ''}|${e.ex}|${e.side || 'B'}`;
      const prev = seen.get(key);
      if (!prev) { seen.set(key, e); continue; }
      // keep whichever row has more filled in
      const score = (x) => ['sets', 'reps', 'load', 'time', 'rpe', 'notes', 'band']
        .reduce((n, k) => n + (x[k] !== undefined && x[k] !== null && x[k] !== '' ? 1 : 0), 0);
      if (score(e) > score(prev)) seen.set(key, e);
    }
    day.entries = [...seen.values()];
  }
}

/**
 * Before schema 5 an entry existing meant it was done. Green now means
 * explicitly logged, so backfill the flag rather than have old days read
 * as unfinished.
 */
function markExistingLogged(d) {
  for (const day of Object.values(d.days || {})) {
    for (const e of day.entries || []) {
      if (e.logged === undefined) e.logged = true;
    }
  }
}

// `seeds` comes from the Mac's local clinical file. A device without that file
// seeds nothing — its history arrives over sync instead, and seeding here too
// would duplicate what sync is already delivering.
function seed(d, seeds) {
  if (!seeds) return;
  for (const [date, day] of Object.entries(seeds.seedDays || {})) {
    if (d.days[date]) continue;
    d.days[date] = {
      checkin: day.checkin || {},
      checklist: {},
      notes: day.notes || '',
      source: day.source,
      seeded: true,
      entries: (day.entries || []).map((e) => ({ id: uid(), seeded: true, logged: true, ...e })),
    };
  }
  const have = new Set(d.measurements.map((m) => `${m.date}|${m.measure}|${m.leg || ''}`));
  for (const m of seeds.seedMeasurements || []) {
    const key = `${m.date}|${m.measure}|${m.leg || ''}`;
    if (have.has(key)) continue;
    d.measurements.push({ id: uid(), seeded: true, ...m });
  }
}

// ---------------------------------------------------------------- saving ---
const doSave = debounce(async () => {
  state.saving = true;
  emit();
  try {
    state.lastSaved = await writeLocalDoc(state.data);   // Mac: server. iPhone: IDB.
    state.error = null;
  } catch (err) {
    state.error = SERVER_MODE
      ? 'Save failed — the server may have stopped. Your data is still on screen.'
      : 'Could not save locally. Your data is still on screen.';
  } finally {
    state.saving = false;
    emit();
  }
  // A local save is durable on its own; the cloud is a follow-on. Nudge a sync
  // shortly after edits settle, so the other device sees them soon — but never
  // block the save on it.
  scheduleSync();
}, 450);

export function queueSave() {
  if (state.readOnly) return;   // a failed load must never write
  doSave();
}

// ---------------------------------------------------------------- syncing ---
export const syncState = {
  running: false,
  lastResult: null,   // the object returned by the last syncNow
  lastError: null,    // set when the last attempt failed
  lastSyncedAt: null,
};

let remoteChangeCb = null;
/** app.js registers a repaint here, so a pull refreshes the visible view. */
export function onRemoteChange(fn) { remoteChangeCb = fn; }

/** How many records are still waiting to reach the server. */
export function pendingSyncCount() {
  return pendingCount(state.data, getConfig().lastPushedAt || 0);
}

let syncing = false;
export async function runSync(reason = 'manual') {
  if (!isConfigured() || state.readOnly) return { ok: false, reason: 'unconfigured' };
  if (syncing) return { ok: false, reason: 'busy' };
  syncing = true;
  syncState.running = true;
  emit();
  let pulledSomething = false;
  try {
    const res = await syncNow(
      () => state.data,
      async (merged) => {
        // A pull produced a newer document: adopt it, persist it, note that
        // the view needs a repaint.
        state.data = merged;
        pulledSomething = true;
        await writeLocalDoc(state.data);
      },
      { deviceId: DEVICE_ID },
    );
    syncState.lastResult = res;
    syncState.lastError = res.ok ? null : res;
    if (res.ok) syncState.lastSyncedAt = getConfig().lastSyncedAt || Date.now();
    return res;
  } catch (err) {
    syncState.lastError = { ok: false, reason: 'crash', error: String(err) };
    return syncState.lastError;
  } finally {
    syncing = false;
    syncState.running = false;
    emit();
    if (pulledSomething && remoteChangeCb) remoteChangeCb();
  }
}

const scheduleSync = debounce(() => { runSync('edit'); }, 2500);


/**
 * Apply a one-off repair the way a user edit is applied: snapshot, mutate,
 * stamp. Anything it deletes gets a tombstone, so the fix travels to the
 * other devices instead of being undone by the next sync.
 */
function repair(fn) {
  const before = new Map();
  for (const [k, v] of collectRecords(state.data)) before.set(k, fingerprint(v));
  const changed = fn();
  if (!changed) return false;
  stampChanges(state.data, before, DEVICE_ID);
  queueSave();
  return true;
}

/** Mutate then persist then re-render. */
export function update(fn) {
  // Snapshot first: sync needs to know WHICH records a mutation touched, and
  // this is the only funnel every write in the app goes through, so stamping
  // here means no view code had to learn about sync at all.
  const before = new Map();
  for (const [k, v] of collectRecords(state.data)) before.set(k, fingerprint(v));

  fn(state.data);

  stampChanges(state.data, before, DEVICE_ID);
  queueSave();
  emit();
}

// ----------------------------------------------------------- day accessors --
export function getDay(iso) {
  return state.data.days[iso] || null;
}

export function ensureDay(iso) {
  if (!state.data.days[iso]) {
    state.data.days[iso] = { checkin: {}, checklist: {}, notes: '', entries: [] };
  }
  const d = state.data.days[iso];
  d.checkin = d.checkin || {};
  d.checklist = d.checklist || {};
  d.entries = d.entries || [];
  return d;
}

export function loggedDates() {
  return Object.keys(state.data.days)
    .filter((k) => {
      const d = state.data.days[k];
      return (d.entries && d.entries.length) || hasCheckin(d) || Object.values(d.checklist || {}).some(Boolean);
    })
    .sort();
}

export function hasCheckin(day) {
  const c = day?.checkin || {};
  return ['painL', 'painR', 'effusionL', 'effusionR', 'nextDay', 'rpe', 'notes'].some(
    (k) => c[k] !== undefined && c[k] !== '' && c[k] !== null,
  );
}

// -------------------------------------------------- measurement accessors ---
export function addMeasurement(rec) {
  update((d) => {
    d.measurements.push({ id: uid(), date: rec.date || todayIso(), ...rec });
  });
}

export function measurementsFor(measureId, leg) {
  return state.data.measurements
    .filter((m) => m.measure === measureId && (leg === undefined || (m.leg || null) === (leg || null)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Most recent value for a measure/leg, or null. */
export function latest(measureId, leg) {
  const rows = measurementsFor(measureId, leg);
  return rows.length ? rows[rows.length - 1] : null;
}

/** Best value ever for a measure/leg, honouring lower-is-better measures. */
export function best(measureId, leg, lower = false) {
  const rows = measurementsFor(measureId, leg).filter((r) => typeof r.value === 'number');
  if (!rows.length) return null;
  return rows.reduce((a, b) => {
    if (lower) return b.value < a.value ? b : a;
    return b.value > a.value ? b : a;
  });
}

export function deleteMeasurement(id) {
  update((d) => {
    d.measurements = d.measurements.filter((m) => m.id !== id);
  });
}

// ------------------------------------------------------ weekly cadence ------
/** Used only when a date sits outside the six-month plan window. */
export const DEFAULT_WEEKLY_TARGET = 5;

function exerciseFor(exId) {
  return EXERCISE_BY_ID[exId] || (state.data.customExercises || []).find((e) => e.id === exId) || null;
}

/**
 * How often to do an exercise in a given week.
 *
 * The 6-month plan sets weekly *session* counts per category — Month 1 asks for
 * 3 strength, 4 balance, 5 aerobic. Each exercise inherits the number for its
 * own category in whichever month the date falls in, so the quota changes as
 * you move through the plan. A number you type yourself always wins.
 *
 * Returns { target, src, from } where target may be null, meaning the plan has
 * nothing for that category this month.
 *   src: 'yours' | 'plan' | 'derived' | 'none' | 'fallback'
 */
export function weeklyTargetInfo(exId, iso) {
  const manual = state.data.program.weeklyTarget?.[exId];
  if (typeof manual === 'number') {
    return { target: manual, src: 'yours', from: 'you set this' };
  }

  const ex = exerciseFor(exId);
  const month = iso ? monthForDate(iso) : null;

  if (ex && month) {
    const t = month.weeklyTargets.find(
      (w) => !w.tagged && !w.cats.includes('*') && w.cats.includes(ex.cat),
    );
    if (t) {
      const override = state.data.settings.weeklyOverrides?.[t.id];
      return {
        target: typeof override === 'number' ? override : t.target,
        src: typeof override === 'number' ? 'yours' : t.src,
        from: `${month.name}: ${t.label}`,
      };
    }
    const catName = CATEGORIES[ex.cat]?.label || ex.cat;
    return { target: null, src: 'none', from: `${month.name} has no ${catName.toLowerCase()} target` };
  }

  return { target: DEFAULT_WEEKLY_TARGET, src: 'fallback', from: 'outside the plan window' };
}

export function weeklyTarget(exId, iso) {
  return weeklyTargetInfo(exId, iso).target;
}

export function setWeeklyTarget(key, n) {
  update((d) => {
    d.program.weeklyTarget = d.program.weeklyTarget || {};
    if (n === null || n === undefined || n === '') delete d.program.weeklyTarget[key];
    else d.program.weeklyTarget[key] = Number(n);
  });
}

/**
 * Which days of the week containing `anchorIso` this exercise was logged on.
 * Keyed on the exercise, so it counts whether you ticked it in the program or
 * added it under Anything else.
 */
export function weekDots(exId, anchorIso) {
  const start = weekStart(anchorIso);
  return weekDays(start).map((iso) => {
    const day = state.data.days[iso];
    return !!day && (day.entries || []).some((e) => e.ex === exId && e.logged);
  });
}

export function weekCount(exId, anchorIso) {
  return weekDots(exId, anchorIso).filter(Boolean).length;
}

// ------------------------------------------------------- plan coverage -----
/** Every logged, ticked entry between two dates inclusive. */
export function loggedBetween(fromIso, toIso) {
  const out = [];
  for (const [date, day] of Object.entries(state.data.days)) {
    if (date < fromIso || date > toIso) continue;
    for (const e of day.entries || []) if (e.logged) out.push({ ...e, date });
  }
  return out;
}

/**
 * How well a focus bullet has been covered in a date range.
 * Bullets carry either a list of exercise ids, a category, or 'checkin'
 * (satisfied by filling in the knee check-in). Anything with none of those is
 * a judgement call and stays a manual tick.
 */
export function focusCoverage(item, fromIso, toIso) {
  if (item.auto === 'checkin') {
    let days = 0;
    for (const [date, day] of Object.entries(state.data.days)) {
      if (date >= fromIso && date <= toIso && hasCheckin(day)) days++;
    }
    return { kind: 'auto', days, hit: days > 0 };
  }
  const ids = item.ex ? new Set(item.ex) : null;
  if (!ids && !item.cat) return { kind: 'manual' };

  const seen = new Set();
  for (const e of loggedBetween(fromIso, toIso)) {
    const ex = EXERCISE_BY_ID[e.ex];
    const match = ids ? ids.has(e.ex) : ex?.cat === item.cat;
    if (match) seen.add(e.date);
  }
  return { kind: 'auto', days: seen.size, hit: seen.size > 0 };
}

// ------------------------------------------------- resistance history -------
/** Every logged entry for an exercise/side, oldest first. */
export function entriesFor(exId, side) {
  const out = [];
  for (const [date, day] of Object.entries(state.data.days)) {
    for (const e of day.entries || []) {
      if (e.ex !== exId) continue;
      if (side && e.side !== side && e.side !== 'B') continue;
      out.push({ ...e, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Highest value ever recorded for an exercise/side. `field` is 'load' for
 * weights or 'resistance' for a cardio machine level.
 */
export function maxLoad(exId, side, field = 'load') {
  const rows = entriesFor(exId, side).filter((e) => Number(e[field]) > 0);
  if (!rows.length) return null;
  const top = rows.reduce((a, b) => (Number(b[field]) > Number(a[field]) ? b : a));
  return { ...top, load: Number(top[field]) };
}

/** One point per session: the highest value used that day. */
export function loadSeries(exId, side, limit = 12, field = 'load') {
  const byDate = {};
  for (const e of entriesFor(exId, side)) {
    const l = Number(e[field]);
    if (!(l > 0)) continue;
    if (!byDate[e.date] || l > byDate[e.date].load) {
      byDate[e.date] = {
        date: e.date, load: l,
        unit: field === 'resistance' ? '' : (e.loadUnit || 'kg'),
        sets: e.sets, reps: e.reps, time: e.time, calories: e.calories,
      };
    }
  }
  return Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-limit);
}

/** The most recent logged entry for an exercise/side, for prefilling. */
export function lastEntry(exId, side) {
  const rows = entriesFor(exId, side).filter((e) => e.side === side || side === undefined);
  return rows.length ? rows[rows.length - 1] : null;
}
