// State + persistence. The whole document is PUT back to the server on a
// short debounce; the file on disk is the source of truth.

import { debounce, uid, todayIso, weekStart, weekDays, applyTheme, toKg } from './util.js';
import { CASE, hydrateCase, loadLocalCase } from '../data/history.js';
import { loadRing, carriesRing } from './ring.js';
import { hydrateProgramSource, seedProgramDays, REHAB_PROGRAM, GYM_PROGRAM, plannedOn } from '../data/program.js';
import { monthForDate, hydratePlan } from '../data/plan.js';
import { EXERCISE_BY_ID } from '../data/exercises.js';
import { CATEGORIES } from '../data/measurements.js';
import { seedSupplements, seedPrnMeds } from './views/supplements.js';
import { collectRecords, fingerprint, ensureSync } from './sync/records.js';
import { stampChanges, stampAll, pendingCount, pendingKeys, mergeDocs } from './sync/merge.js';
import { recordScheduleVersion } from './planstreak.js';
import { readLocalDoc, writeLocalDoc, SERVER_MODE, StaleWrite, RefusedWrite, adoptRevision } from './sync/local-store.js';
import { syncNow } from './sync/engine.js';
import { isConfigured, getConfig } from './sync/config.js';

const SCHEMA = 7;   // 7 adds supplements/doses; 6 added _sync and caseFile

/**
 * A stable id for THIS device, kept out of the synced document on purpose:
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
      theme: 'light',
      seeded: false,
    },
    days: {},
    measurements: [],
    planGoals: {},
    planFocus: {},
    // One push subscription per device, keyed by device id (registered in
    // sync/records.js as 'w'). Empty until he turns reminders on.
    pushSubs: {},
    melbourne: { phases: {}, measures: {} },
    mrss: [],
    customExercises: [],
    supplements: [],
    prnMeds: [],
    doses: [],
    // Clinician program: which progression step you're on, and your current
    // band colour, per program item.
    program: { stage: {}, band: {}, weeklyTarget: {}, days: {}, clinicDays: {}, mins: {}, timer: {}, schedule: {}, ownSteps: {} },
    // The medication level tab (registered in sync/records.js as 'x').
    pk: { drugs: {}, shots: {}, feel: {}, plans: {}, pens: {} },
  };
}

export const state = {
  data: blank(),
  // Bumped on every change to the document, so derived caches (learned
  // estimates) know when to recompute and can never go stale.
  rev: 0,
  saving: false,
  lastSaved: null,
  error: null,
  // Set when the first load could not reach the server. While true the app
  // shows an empty shell but refuses to write, so a failed load can never
  // overwrite good data on disk with a freshly seeded blank.
  readOnly: false,
  // The Mac-only PT history (GET /api/pt-history): days, measurements, clinical
  // note entries and the custom exercises they use. Read-only, never part of
  // state.data, so no save or sync can carry it to another device.
  history: null,
};

/** Fetch the Mac-only PT history once. Anywhere without the server it stays null. */
export async function loadHistory() {
  if (!SERVER_MODE) return;
  try {
    const r = await fetch('/api/pt-history', { cache: 'no-store' });
    if (!r.ok) return;
    const h = await r.json();
    // The view is drawn before this arrives, so it is drawn again once it has
    // (2026-09-18): a Progress card or Today's clinic group opened first thing
    // on the Mac used to miss the history until the next tab change.
    if (h && typeof h === 'object') { state.history = h; emit(); remoteChangeCb?.(); }
  } catch { /* no history on this machine */ }
}

/** History rows for a date (read-only), or []. */
export function historyEntries(iso) {
  return state.history?.days?.[iso]?.entries || [];
}

/** Every measurement: the document's, then the Mac-only history's. */
export function allMeasurements() {
  return state.history?.measurements?.length ? state.data.measurements.concat(state.history.measurements) : state.data.measurements;
}

/** A custom exercise by id, from the document or the history layer. */
export function customExercise(id) {
  return (state.data.customExercises || []).find((e) => e.id === id)
    || (state.history?.customExercises || []).find((e) => e.id === id) || null;
}

/** True if a document carries anything from the history layer (it must never). */
export function carriesHistory(doc) {
  if ((doc.measurements || []).some((m) => m && m.history)) return true;
  if ((doc.customExercises || []).some((c) => c && c.history)) return true;
  return Object.values(doc.days || {}).some((d) => (d.entries || []).some((e) => e && e.history));
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let themeApplied = null;
function emit() {
  state.rev++;
  // A sync pull can replace caseFile or the theme, so repoint first. The theme
  // only when it changed (Fable B2): setting data-theme again, even to the
  // same value, restyled the whole page after every tick.
  const theme = state.data.settings?.theme || 'light';
  if (theme !== themeApplied) { applyTheme(theme); themeApplied = theme; }
  hydrateCase(state.data);
  hydrateProgramSource(state.data);
  hydratePlan(state.data);
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
      // read: that is how a blank document overwrites a real one on disk.
      state.readOnly = true;
      state.error = 'Cannot reach the server. Nothing you type will be saved. Start the server and reload.';
      state.data = migrate(blank());
      emit();
      return;
    }
    // iPhone: IndexedDB itself failed. This used to open a blank WRITABLE
    // document, which a later save or sync could then treat as the truth
    // (audit A12). Now it is read-only, exactly like the Mac with the server
    // down: nothing is written and nothing is synced until a reload reads the
    // store properly.
    state.readOnly = true;
    state.error = 'Could not open the workout log saved on this device. Nothing will be saved or synced. Close the app completely and open it again.';
    state.data = migrate(blank());
    emit();
    return;
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
  hydratePlan(incoming);

  state.data = migrate(hadContent ? incoming : blank());
  hydrateCase(state.data);
  hydratePlan(state.data);

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
  // LATER version: caseFile was one, get stamped and pushed rather than
  // sitting invisible to sync forever.
  if (seedSupplements(state.data)) queueSave();
  if (seedPrnMeds(state.data)) queueSave();
  if (seedProgramDays(state.data)) queueSave();

  if (hadContent) {
    stampAll(state.data, DEVICE_ID);
    // Keep today's plan on record for the plan streak. A change of code (a
    // new program item, a clinic list) shows up here too. Stamped, so the
    // version travels; a new phone with no content yet records nothing and
    // receives the versions by sync instead.
    repair(() => recordScheduleVersion(state.data, todayIso()));
  }

  // A fresh device with no local content (a new iPhone) is deliberately left
  // UNSTAMPED and unseeded: its records default to time 0, so the first sync
  // pulls the real data down wholesale instead of a blank default winning.

  emit();

  // Mac only: the PT history layer. Never blocks startup.
  loadHistory();

  // The ring layer, on every device. Read only, outside the document, and never
  // blocks startup: the view is drawn first and drawn again once it arrives.
  loadRing().then((got) => { if (got) { emit(); remoteChangeCb?.(); } });

  // Pull anything new the moment we open, if this device is connected. Never
  // blocks startup: the app is already usable from local data above.
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
  out.program = { stage: {}, band: {}, weeklyTarget: {}, days: {}, clinicDays: {}, mins: {}, timer: {}, schedule: {}, ownSteps: {}, ...(d.program || {}) };
  out.program.stage = out.program.stage || {};
  out.program.band = out.program.band || {};
  out.program.weeklyTarget = out.program.weeklyTarget || {};
  out.program.days = out.program.days || {};
  out.program.clinicDays = out.program.clinicDays || {};
  out.program.mins = out.program.mins || {};
  out.program.timer = out.program.timer || {};
  out.program.schedule = out.program.schedule || {};
  out.program.ownSteps = out.program.ownSteps || {};
  out.pk = { drugs: {}, shots: {}, feel: {}, plans: {}, pens: {}, ...(d.pk || {}) };
  for (const k of ['drugs', 'shots', 'feel', 'plans', 'pens']) out.pk[k] = out.pk[k] || {};
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
// seeds nothing: its history arrives over sync instead, and seeding here too
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
let savePending = false;

/** True while a change is waiting for, or in the middle of, its local save. */
export function saveOutstanding() { return savePending || state.saving || staged.size > 0; }

async function persist() {
  savePending = false;
  state.saving = true;
  emit();
  let ok = false;
  // The journal as it stands when this copy is taken (the write serialises
  // the document immediately), so only what it covers is released after.
  const gen = journalGen;
  try {
    if (carriesHistory(state.data)) throw new RefusedWrite('the Mac-only PT history must never be saved into the synced document');
    if (carriesRing(state.data)) throw new RefusedWrite('the ring layer must never be saved into the synced document');
    state.lastSaved = await writeDurable();   // Mac: server. iPhone: IDB.
    state.error = null;
    ok = true;
    journalLanded(gen);
  } catch (err) {
    savePending = true;   // still owed
    state.error = err instanceof RefusedWrite
      ? (/history|ring layer/.test(err.message)
        ? 'Not saved: a Mac-only layer got into your record, so it was refused. Your data is still on screen.'
        : 'Not saved: this would have emptied your saved log, so it was refused. Your data is still on screen.')
      : SERVER_MODE
        ? 'Save failed. The server may have stopped. Your data is still on screen.'
        : 'Could not save locally. Your data is still on screen.';
  } finally {
    state.saving = false;
    emit();
  }
  return ok;
}

/**
 * Write the document, merging first if another window (or a PhysiApp import on
 * the Mac) saved since this one read (audit A13, A15). The merge is the sync
 * merge, so nothing either side holds is dropped; after it the view repaints.
 */
async function writeDurable(doc = null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await writeLocalDoc(doc || state.data);
    } catch (err) {
      if (!(err instanceof StaleWrite)) throw err;
      const merged = mergeDocs(doc || state.data, err.doc || {});
      if (doc) doc = merged.doc;
      else state.data = merged.doc;
      adoptRevision(err.rev);
      if (merged.changed && remoteChangeCb) setTimeout(() => remoteChangeCb(), 0);
    }
  }
  throw new Error('the saved log kept changing in another window');
}

/**
 * Adopt a document an import produced (Codex audit B15). It is already the
 * sync merge of this device's document and the backup, with the backup's own
 * stamps, so it is NOT stamped again: re-stamping would make an old backup's
 * records newer than work on the other devices. Returns whether it saved.
 */
export async function adoptImport(doc) {
  if (state.readOnly) return false;
  state.data = doc;
  emit();
  const ok = await flushSave();
  if (remoteChangeCb) remoteChangeCb();
  return ok;
}

/**
 * Save now and say whether it worked. For anything that must not report
 * "saved" or throw away a recovery copy before the write is durable (the
 * player's Save). The debounced save may still run afterwards; writing the
 * same document twice is harmless.
 */
export async function flushSave() {
  if (state.readOnly) return false;
  if (staged.size) flushEdits();
  const ok = await persist();
  if (ok) scheduleSync();
  return ok;
}

const doSave = debounce(async () => {
  await persist();
  // A local save is durable on its own; the cloud is a follow-on. Nudge a sync
  // shortly after edits settle, so the other device sees them soon, but never
  // block the save on it.
  scheduleSync();
}, 450);

/**
 * Mark one path of a day as a GUESS in the sync stamps (review, 2026-09-16).
 *
 * The collagen is inferred from the tendon loading when he has not marked it.
 * Written inside update(), that inference got a fresh stamp from the save time,
 * and supplement ticks merge path by path with the newest stamp winning. So if
 * he had really ticked his collagen on the iPad and this phone had not pulled
 * it yet, the phone's guess outranked his real time and replaced it on every
 * device. His rule zero: a recorded time is his and a guess never beats it.
 *
 * Stamping the path at 1, the lowest live stamp, makes the guess lose to any
 * real value anywhere, while it still reaches a device that holds nothing, and
 * a later edit he makes to it wins as normal. Proved against the real merge.js
 * in both sync orders before it was written.
 *
 * Call AFTER update() returns: stampChanges runs at the end of update and would
 * otherwise overwrite this.
 */
export function weakenDayPath(iso, path) {
  const s = ensureSync(state.data);
  const key = `d|${String(iso).replace(/\|/g, '%7C')}`;
  (s.dp[key] ||= {})[path] = 1;
  queueSave();
}

export function queueSave() {
  if (state.readOnly) return;   // a failed load must never write
  savePending = true;
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
  const c = getConfig();
  return pendingCount(state.data, c.ack || c.lastPushedAt || 0);
}

/** Which ones, so a chip that will not clear can be read on the device itself. */
export function pendingSyncKeys() {
  const c = getConfig();
  return pendingKeys(state.data, c.ack || c.lastPushedAt || 0);
}

let syncing = false;
let lastAutoSyncAt = 0;

// How long to leave it between AUTOMATIC syncs that have nothing to send.
// Opening the app used to fetch the whole document every time, which is real
// mobile data spent to confirm nothing changed.
const IDLE_SYNC_GAP_MS = 5 * 60 * 1000;

// Reasons that must never be throttled. An edit has something to upload, a
// reconnect may have a backlog, and the button is you asking directly.
const ALWAYS_SYNC = new Set(['manual', 'edit', 'online']);

// A sync asked for while one runs is remembered, not dropped: an edit whose
// debounced sync landed mid-sync used to wait for some later trigger, which on
// the Mac could be hours, while the reminder sender read a stale relay.
let syncAgain = false;

export async function runSync(reason = 'manual') {
  if (!isConfigured() || state.readOnly) return { ok: false, reason: 'unconfigured' };
  if (syncing) { syncAgain = true; return { ok: false, reason: 'busy' }; }

  // Anything waiting to upload always goes, whatever the reason. Only an
  // already-clean device is asked to wait, so a change you made can never sit
  // unsent because of a timer.
  if (!ALWAYS_SYNC.has(reason) && pendingSyncCount() === 0
      && Date.now() - lastAutoSyncAt < IDLE_SYNC_GAP_MS) {
    return { ok: true, skipped: 'recent' };
  }
  lastAutoSyncAt = Date.now();
  syncing = true;
  syncState.running = true;
  emit();
  let pulledSomething = false;
  try {
    const res = await syncNow(
      // The same guard as persist(): the Mac-only history and the ring layer
      // never go up to the relay either (2026-09-22 audit, upload had none).
      () => {
        if (carriesHistory(state.data) || carriesRing(state.data)) throw new RefusedWrite('a Mac-only layer is in the document; not uploaded');
        return state.data;
      },
      async (merged) => {
        // A pull produced a newer document: adopt it, persist it, note that
        // the view needs a repaint.
        state.data = merged;
        pulledSomething = true;
        await writeDurable();
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
    if (syncAgain) { syncAgain = false; if (pendingSyncCount() > 0) scheduleSync(); }
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

// ------------------------------------------------------------ typed edits --
// 2026-09-14 revision 3 (F18). Typing used to call update() on every character,
// and update() fingerprints and stamps the whole record collection. Now a typed
// value is STAGED: kept on this device at once (localStorage, so a crash or a
// reload loses nothing), and committed through update() when he pauses, leaves
// the field, changes view, or the page hides, and before any other change.
// Descriptors, not closures, so a recovery copy can be replayed after a reload.
//
// 2026-09-15 (audit A07): the recovery copy stays until a save that includes
// the commit has actually landed. Committing used to delete it at once, so a
// close in the half second before the debounced save lost the edit. Each entry
// carries when it was typed; a replay skips any the document already holds
// with a newer stamp, so a copy left over from a save that did land never
// overwrites a later change.
const EDIT_KEY = 'rehab.editdraft';
const staged = new Map();
let stageTimer = null;
let journal = [];          // committed, not yet known to be on disk
let journalGen = 0;        // bumps whenever the journal changes

function writeJournal() {
  journalGen++;
  const all = [...journal, ...staged.values()];
  try {
    if (all.length) localStorage.setItem(EDIT_KEY, JSON.stringify(all));
    else localStorage.removeItem(EDIT_KEY);
  } catch { /* the in-memory copy still commits */ }
}

export function stageEdit(key, desc) {
  staged.set(key, { ...desc, at: Date.now() });
  writeJournal();
  clearTimeout(stageTimer);
  stageTimer = setTimeout(flushEdits, 700);
}

export function hasStagedEdits() { return staged.size > 0; }

function recordKeyOf(e) {
  const iso = String(e.iso).replace(/\|/g, '%7C');
  if (e.kind === 'entry') return `e|${iso}|${String(e.id).replace(/\|/g, '%7C')}`;
  return `d|${iso}`;
}

function applyEdit(d, e) {
  if (!e || !e.iso) return;
  const day = (d.days[e.iso] ||= { checkin: {}, checklist: {}, notes: '', entries: [] });
  if (e.kind === 'note') { day.notes = e.value; return; }
  if (e.kind === 'checkin') { (day.checkin ||= {})[e.key] = e.value; return; }
  if (e.kind === 'entry') {
    const row = (day.entries || []).find((x) => x.id === e.id);
    if (!row) return;
    row[e.f] = e.value;
    if (e.f === 'load' && row.load != null && !row.loadUnit) row.loadUnit = d.settings?.weightUnit || 'kg';
  }
}

/** Commit every staged edit now. Returns true when something was committed. */
export function flushEdits() {
  clearTimeout(stageTimer);
  stageTimer = null;
  if (!staged.size) return false;
  const list = [...staged.values()];
  staged.clear();
  journal.push(...list);
  writeJournal();
  update((d) => { for (const e of list) applyEdit(d, e); });
  return true;
}

/** After a load: replay edits a reload or crash interrupted. */
export function recoverEdits() {
  let list = null;
  try { list = JSON.parse(localStorage.getItem(EDIT_KEY) || 'null'); } catch { list = null; }
  if (!Array.isArray(list) || !list.length || state.readOnly) return 0;
  const todo = editsToReplay(list, state.data._sync?.rec || {});
  journal = todo.slice();
  writeJournal();
  if (todo.length) update((d) => { for (const e of todo) applyEdit(d, e); });
  return todo.length;
}

/**
 * Which recovered edits still need replaying. One the document already holds
 * with a stamp at or after when it was typed landed before the close;
 * replaying it could only undo something later. Older copies without a time
 * are replayed, as before.
 */
export function editsToReplay(list, rec) {
  return (list || []).filter((e) => !(e && e.at && (rec[recordKeyOf(e)] ?? 0) >= e.at));
}

/** Called after a save lands: drop the recovery copy it made durable. */
function journalLanded(gen) {
  if (gen !== journalGen || staged.size) return;
  journal = [];
  try { localStorage.removeItem(EDIT_KEY); } catch { /* nothing to clear */ }
}

// Leaving the app saves NOW, not after the 450 ms debounce: iOS suspends a
// hidden page at once and may kill it, and a tap (a tick, a band) has no
// journal to recover from, so it was lost (2026-09-22 audit).
function saveOnLeave() {
  flushEdits();
  if (savePending && !state.readOnly) persist();
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveOnLeave(); });
  window.addEventListener('pagehide', saveOnLeave);
  document.addEventListener('focusout', (e) => { if (staged.size && e.target?.matches?.('input, textarea')) flushEdits(); }, true);
}

/** Mutate then persist then re-render. */
export function update(fn) {
  // Anything typed and not yet committed goes first, so changes land in order.
  if (staged.size) flushEdits();
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
    if (rec.measure === 'bodyweight') syncBodyweightSetting(d);
  });
}

/** The newest recorded bodyweight, in the unit Settings is set to, or null. */
export function loggedBodyweight(d) {
  const rows = (d.measurements || []).filter((m) => m.measure === 'bodyweight' && typeof m.value === 'number');
  if (!rows.length) return null;
  const newest = rows.reduce((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? a : b;
    return (a.at || '') >= (b.at || '') ? a : b;
  });
  const unit = d.settings.weightUnit || 'lb';
  const kg = toKg(newest.value, newest.unit || unit);
  if (!(kg > 0)) return null;
  return Math.round((unit === 'lb' ? kg * 2.2046226218 : kg) * 10) / 10;
}

/**
 * Settings holds one bodyweight, typed once. Weighing yourself in the app is
 * the same fact, so the setting follows the newest weight recorded (his ask,
 * 2026-09-19) in whichever unit Settings is set to. An older weight entered
 * after the fact never overwrites a newer one.
 */
export function syncBodyweightSetting(d) {
  const shown = loggedBodyweight(d);
  if (shown != null && d.settings.bodyweight !== shown) d.settings.bodyweight = shown;
}

/**
 * The same, on opening the app: weights logged before this existed, or on
 * another device, or by a sync that arrived since, still set the field. It
 * writes only when the number actually differs, so an opened app that is
 * already in step saves nothing.
 */
export function reconcileBodyweight() {
  if (state.readOnly) return;
  const shown = loggedBodyweight(state.data);
  if (shown == null || state.data.settings.bodyweight === shown) return;
  update((d) => { d.settings.bodyweight = shown; });
}

export function measurementsFor(measureId, leg) {
  return allMeasurements()
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
  const rows = measurementsFor(measureId, leg).filter((r) => typeof r.value === 'number' && Number.isFinite(r.value));
  if (!rows.length) return null;
  // Weights are compared in one unit (audit A23): 210 lb is less than 100 kg.
  // The record comes back as stored, with its own unit, for display.
  const kg = (r) => (r.unit === 'lb' ? r.value / 2.2046226218 : r.value);
  const cmp = (r) => (r.unit === 'lb' || r.unit === 'kg' ? kg(r) : r.value);
  return rows.reduce((a, b) => {
    if (lower) return cmp(b) < cmp(a) ? b : a;
    return cmp(b) > cmp(a) ? b : a;
  });
}

export function deleteMeasurement(id) {
  update((d) => {
    d.measurements = d.measurements.filter((m) => m.id !== id);
  });
}

// ------------------------------------------------------ weekly cadence ------
/** Used only when a date sits outside the six-month plan window. */
/**
 * Surgery date for a side. Settings win, but a device whose settings were
 * seeded before the case file arrived has nulls there, so fall back to the
 * synced case file rather than render an empty post-op strip.
 */
export function surgeryDate(side) {
  const s = state.data.settings || {};
  const set = side === 'left' ? s.surgeryLeft : s.surgeryRight;
  if (set) return set;
  return state.data.caseFile?.case?.legs?.[side]?.date || null;
}

export const DEFAULT_WEEKLY_TARGET = 5;

/** Exercise id -> the program item that prescribes it, for its `freq`. */
const PROGRAM_FOR_EXERCISE = Object.fromEntries(
  REHAB_PROGRAM.concat(GYM_PROGRAM).map((p) => [p.ex, p]),
);

function exerciseFor(exId) {
  return EXERCISE_BY_ID[exId] || customExercise(exId);
}

/**
 * How often to do an exercise in a given week.
 *
 * The 6-month plan sets weekly *session* counts per category. Month 1 asks for
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

  // The PROGRAM's own number comes before the category's. A banded calf raise
  // and a loaded step up are both 'strength', so inheriting the category count
  // gave both of them "3 a week" and made the everyday work look optional.
  const item = PROGRAM_FOR_EXERCISE[exId];
  if (item && typeof item.freq === 'number') {
    // Count the days THIS week that actually ask for it, rather than the raw
    // frequency. A clinic day drops everything but the tendon loading and
    // balance, so a flat "7 a week" would be a target he cannot reach in a week
    // with two clinic days, and an unreachable target reads as failure.
    const planned = iso
      ? weekDays(weekStart(iso)).filter((d) => plannedOn(state.data, item.id, d)).length
      : item.freq;
    return {
      target: planned || null,
      src: 'program',
      from: planned
        ? `${item.title || exId}: ${planned} day${planned === 1 ? '' : 's'} this week`
          + (planned !== item.freq
            ? ` (${item.freq} a week normally; clinic days are left for the session itself)` : '')
        : `${item.title || exId} is not planned this week`,
    };
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
// 2026-09-15 (Codex audit B04): every function here reads LOGGED rows only. A
// row opened and never ticked is a copy of last time, not a session, and it
// used to win "heaviest ever", fill in "last time" and set a cardio target.
// Loads are compared in one unit; each row comes back as stored, its own unit.

const kgOf = (e, field) => (field === 'load' ? toKgUnit(Number(e[field]), e.loadUnit || state.data.settings.weightUnit || 'kg') : Number(e[field]));
function toKgUnit(v, unit) { return unit === 'lb' ? v / 2.2046226218 : v; }

/** Every logged entry for an exercise/side, oldest first. */
export function entriesFor(exId, side) {
  const out = [];
  for (const [date, day] of Object.entries(state.data.days)) {
    for (const e of day.entries || []) {
      if (e.ex !== exId || !e.logged) continue;
      if (side && e.side !== side && e.side !== 'B') continue;
      out.push({ ...e, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.doneAt || '').localeCompare(String(b.doneAt || ''))));
}

/**
 * Highest value ever recorded for an exercise/side. `field` is 'load' for
 * weights or 'resistance' for a cardio machine level.
 */
export function maxLoad(exId, side, field = 'load') {
  const rows = entriesFor(exId, side).filter((e) => Number(e[field]) > 0);
  if (!rows.length) return null;
  const top = rows.reduce((a, b) => (kgOf(b, field) > kgOf(a, field) ? b : a));
  return { ...top, load: Number(top[field]) };
}

/** One point per session: the highest value used that day, in its own unit. */
export function loadSeries(exId, side, limit = 12, field = 'load') {
  const byDate = {};
  for (const e of entriesFor(exId, side)) {
    const l = Number(e[field]);
    if (!(l > 0)) continue;
    if (!byDate[e.date] || kgOf(e, field) > byDate[e.date].kg) {
      byDate[e.date] = {
        date: e.date, load: l, kg: kgOf(e, field),
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

/**
 * Last time's cardio minutes, for the target: the newest logged bout that was
 * done in full. A bout stopped early is a record of that day, not the new plan.
 */
export function lastCardioMinutes(exId) {
  const rows = entriesFor(exId, 'B').filter((e) => (e.side || 'B') === 'B' && !e.partial && Number(e.time) > 0);
  return rows.length ? Number(rows[rows.length - 1].time) : null;
}
