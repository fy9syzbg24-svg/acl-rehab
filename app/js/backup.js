// Importing a backup and exporting a training report (Codex audit B15, B16,
// 2026-09-15). Pure: no DOM, no store, so the tests run on fixtures.
//
// An import used to confirm once and then copy every key of the file over the
// document, so an old backup replaced newer work and a malformed one broke it.
// Now a file is checked first, shown as what it would change, and MERGED with
// the sync merge: a record the device holds a newer version of stays, nothing
// the device holds is ever deleted, and keys the app does not know are listed
// and left out. A verified restore point is taken before anything is applied
// (settings.js).
//
// The CSV is a report for reading or sharing, never a backup: logged exercise
// only, what was actually done per set and hold, with where it came from.

import { collectRecords, fingerprint } from './sync/records.js';
import { mergeDocs } from './sync/merge.js';

const KNOWN = new Set(['schema', '_sync', 'settings', 'planGoals', 'planFocus', 'caseFile', 'program', 'melbourne',
  'measurements', 'mrss', 'customExercises', 'supplements', 'prnMeds', 'doses', 'days']);
const MAPS = ['settings', 'planGoals', 'planFocus', 'caseFile'];
const LISTS = ['measurements', 'mrss', 'customExercises', 'supplements', 'prnMeds', 'doses'];
const FUTURE_SLACK_MS = 24 * 3600e3;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Is this file a backup of this app? Returns { ok, errors, ignored, records }.
 * Every problem is listed; nothing is repaired.
 */
export function validateBackup(obj, { now = Date.now() } = {}) {
  const errors = [];
  const ignored = [];
  if (!isObj(obj)) return { ok: false, errors: ['The file is not a backup of this app (it is not an object).'], ignored, records: 0 };
  for (const k of Object.keys(obj)) if (!KNOWN.has(k)) ignored.push(k);
  if (obj.schema !== undefined && !(Number.isInteger(obj.schema) && obj.schema > 0)) errors.push('schema is not a version number');
  for (const k of MAPS) if (obj[k] !== undefined && !isObj(obj[k])) errors.push(`${k} is not a set of values`);
  for (const k of LISTS) {
    if (obj[k] === undefined) continue;
    if (!Array.isArray(obj[k])) { errors.push(`${k} is not a list`); continue; }
    obj[k].forEach((row, i) => {
      if (!isObj(row) || typeof row.id !== 'string' || !row.id) errors.push(`${k} item ${i + 1} has no id`);
    });
  }
  for (const [parent, subs] of [['program', ['stage', 'band', 'weeklyTarget', 'days', 'clinicDays', 'mins', 'timer', 'schedule', 'seen']], ['melbourne', ['phases', 'measures']]]) {
    if (obj[parent] === undefined) continue;
    if (!isObj(obj[parent])) { errors.push(`${parent} is not a set of values`); continue; }
    for (const sub of subs) if (obj[parent][sub] !== undefined && !isObj(obj[parent][sub])) errors.push(`${parent}.${sub} is not a set of values`);
  }
  if (obj.days !== undefined) {
    if (!isObj(obj.days)) errors.push('days is not a set of dates');
    else {
      for (const [iso, day] of Object.entries(obj.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { errors.push(`"${String(iso).slice(0, 20)}" is not a date`); continue; }
        if (!isObj(day)) { errors.push(`${iso} is not a day`); continue; }
        if (day.entries !== undefined) {
          if (!Array.isArray(day.entries)) errors.push(`${iso} entries is not a list`);
          else day.entries.forEach((e, i) => { if (!isObj(e) || typeof e.id !== 'string' || !e.id) errors.push(`${iso} entry ${i + 1} has no id`); });
        }
      }
    }
  }
  if (obj._sync !== undefined) {
    const s = obj._sync;
    if (!isObj(s)) errors.push('the sync record is damaged');
    else {
      for (const part of ['rec', 'del']) {
        if (s[part] === undefined) continue;
        if (!isObj(s[part])) { errors.push(`the sync record's ${part} is damaged`); continue; }
        for (const [k, t] of Object.entries(s[part])) {
          if (typeof t !== 'number' || !Number.isFinite(t)) { errors.push(`the sync time for ${k.slice(0, 40)} is not a number`); break; }
          if (t > now + FUTURE_SLACK_MS) { errors.push('it carries change times in the future, so it would beat newer work'); break; }
        }
      }
    }
  }
  const records = errors.length ? 0 : collectRecords(obj).size;
  if (!errors.length && records === 0) errors.push('There is nothing in it to import.');
  return { ok: errors.length === 0, errors: errors.slice(0, 12), more: Math.max(0, errors.length - 12), ignored, records };
}

/**
 * What importing would do, and the document it would produce.
 * { doc, added, changed, keptYours, same, removed, ignored, byKind }
 * `removed` is always 0: the backup's deletions are not applied, and a result
 * that would still drop a record is refused by the caller.
 */
export function previewImport(current, obj, { now = Date.now() } = {}) {
  const incoming = {};
  const ignored = [];
  for (const [k, v] of Object.entries(obj)) {
    if (KNOWN.has(k)) incoming[k] = JSON.parse(JSON.stringify(v)); else ignored.push(k);
  }
  // Never delete on import: the backup's tombstones stay behind.
  if (isObj(incoming._sync)) incoming._sync = { ...incoming._sync, del: {} };
  const merged = mergeDocs(current, incoming, { now });
  const before = collectRecords(current);
  const after = collectRecords(merged.doc);
  const inc = collectRecords(incoming);
  const fp = (m, k) => fingerprint(m.get(k));
  const out = { doc: merged.doc, added: 0, changed: 0, keptYours: 0, same: 0, removed: 0, ignored, byKind: {} };
  const KIND = { e: 'exercise rows', d: 'days', m: 'test results', u: 'supplements', o: 'doses', n: 'as-needed medicines', s: 'settings', p: 'program choices', b: 'Melbourne marks', r: 'MRSS scores', c: 'custom exercises', g: 'plan goals', f: 'plan focus ticks', k: 'clinical history' };
  for (const k of after.keys()) {
    if (!before.has(k)) { out.added++; const kind = KIND[k[0]] || 'other'; out.byKind[kind] = (out.byKind[kind] || 0) + 1; }
    else if (fp(before, k) !== fp(after, k)) out.changed++;
  }
  for (const k of before.keys()) if (!after.has(k)) out.removed++;
  for (const k of inc.keys()) {
    if (!before.has(k)) continue;
    if (fp(before, k) === fp(inc, k)) out.same++;
    else if (fp(after, k) === fp(before, k)) out.keptYours++;
  }
  return out;
}

// ------------------------------------------------------------------ CSV ---
export const CSV_COLUMNS = ['date', 'done_at', 'exercise', 'exercise_id', 'program_item', 'side', 'sets', 'reps_by_set', 'reps',
  'seconds_by_hold', 'seconds', 'minutes', 'load', 'load_unit', 'band', 'effort', 'discomfort', 'partial', 'source', 'run_id', 'notes'];

/** One cell: always quoted, quotes doubled, and text that a spreadsheet would run as a formula made inert. */
export function csvCell(v) {
  if (v === null || v === undefined) return '""';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const list = (a) => (Array.isArray(a) ? a.filter((x) => x !== null && x !== undefined && x !== '').join(' + ') : '');

/**
 * The training report: every LOGGED exercise row, as recorded. Unlogged rows
 * (a row opened, numbers typed, never ticked) are not a session and are left
 * out. Nothing is multiplied or guessed: reps and holds per set as stored.
 */
export function csvReport(doc, { nameOf = (id) => id } = {}) {
  const rows = [CSV_COLUMNS];
  for (const [date, day] of Object.entries(doc?.days || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const entries = (day?.entries || []).filter((e) => e && e.logged)
      .slice().sort((a, b) => String(a.doneAt || '').localeCompare(String(b.doneAt || '')));
    for (const e of entries) {
      const source = e.via === 'physiapp' ? 'PhysiApp' : e.runId ? 'Workout player' : e.seeded ? 'Clinical notes' : 'Recorded in app';
      rows.push([
        date, e.doneAt || '', nameOf(e.ex) || e.ex || '', e.ex || '', e.pid || '', e.side || 'B',
        e.sets ?? '', list(e.repsBySet), e.reps ?? '', list(e.secsList), e.secs ?? e.hold ?? '', e.time ?? '',
        e.load ?? '', e.load != null && e.load !== '' ? (e.loadUnit || '') : '', e.band || '', e.rpe ?? '', e.discomfort ?? '',
        e.partial ? 'yes' : '', source, e.runId || '', e.notes || '',
      ]);
    }
  }
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
