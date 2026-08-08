// Turning the rehab document into addressable records, and back.
//
// The app stores everything in one object and PUTs the whole thing. That is
// fine for one machine but fatal for two: whichever device syncs second would
// overwrite the other's entire day. So sync happens at RECORD level, and this
// file is the only place that knows how the document decomposes.
//
// Nothing here mutates the app's shape. The document keeps exactly the form
// the existing UI expects; sync metadata lives in a sidecar (`_sync`), so none
// of the view code had to change.
//
// Key grammar — a flat string per record, stable across devices:
//
//   s|<settingKey>            settings
//   k|<caseFileKey>           clinical history (case, timeline, hep, sources)
//   d|<iso>                   a day's own fields (check-in, notes…), not entries
//   e|<iso>|<entryId>         one logged exercise row
//   m|<id>                    a measurement / test result
//   r|<id>                    an MRSS score
//   c|<id>                    a custom exercise
//   u|<id>                    a supplement in the list
//   n|<id>  o|<id>            an as-needed medication / one logged dose
//   g|<key>  f|<key>          plan goals / plan focus ticks
//   b|<sub>|<key>             melbourne.phases / .measures
//   p|<sub>|<key>             program.stage / .band / .weeklyTarget

export const SYNC_VERSION = 1;

// A day's own fields. Entries are separate records so two devices can add
// exercises to the same day without fighting over the whole day.
const DAY_FIELDS = ['checkin', 'checklist', 'notes', 'source', 'seeded', 'supps'];

// name -> the array in the doc, for the id-keyed collections
const ID_LISTS = { m: 'measurements', r: 'mrss', c: 'customExercises',
                   u: 'supplements', n: 'prnMeds', o: 'doses' };
// name -> the plain key/value map in the doc
// caseFile is HERE for a reason: it is data, not code. Leaving it out meant
// the merge engine did not carry it, so a device without a clinical history
// (any phone) pushed a document lacking it and silently wiped the server copy.
// Any new top-level key must be registered here or it will not survive a sync.
const KEY_MAPS = { s: 'settings', g: 'planGoals', f: 'planFocus', k: 'caseFile' };
// name -> [parent, allowed sub-maps]
const SUB_MAPS = { b: ['melbourne', ['phases', 'measures']], p: ['program', ['stage', 'band', 'weeklyTarget']] };

const enc = (s) => String(s).replace(/\|/g, '%7C');
const dec = (s) => String(s).replace(/%7C/g, '|');

/** Every syncable record in the document, as key -> value. */
export function collectRecords(doc) {
  const out = new Map();
  if (!doc || typeof doc !== 'object') return out;

  for (const [tag, name] of Object.entries(KEY_MAPS)) {
    for (const [k, v] of Object.entries(doc[name] || {})) out.set(`${tag}|${enc(k)}`, v);
  }
  for (const [tag, [parent, subs]] of Object.entries(SUB_MAPS)) {
    for (const sub of subs) {
      for (const [k, v] of Object.entries((doc[parent] || {})[sub] || {})) {
        out.set(`${tag}|${sub}|${enc(k)}`, v);
      }
    }
  }
  for (const [tag, name] of Object.entries(ID_LISTS)) {
    for (const row of doc[name] || []) {
      if (row && row.id) out.set(`${tag}|${enc(row.id)}`, row);
    }
  }
  for (const [iso, day] of Object.entries(doc.days || {})) {
    const own = {};
    let has = false;
    for (const f of DAY_FIELDS) {
      if (day && day[f] !== undefined) { own[f] = day[f]; has = true; }
    }
    // A day with only entries still needs its record, or re-adding an entry to
    // an emptied day would have nowhere to hang.
    if (has || (day && day.entries)) out.set(`d|${enc(iso)}`, own);
    for (const e of (day && day.entries) || []) {
      if (e && e.id) out.set(`e|${enc(iso)}|${enc(e.id)}`, e);
    }
  }
  return out;
}

function emptyDay() {
  return { checkin: {}, checklist: {}, notes: '', entries: [] };
}

/** Write one record into a document, creating containers as needed. */
export function putRecord(doc, key, value) {
  const p = key.split('|');
  const tag = p[0];

  if (KEY_MAPS[tag]) {
    (doc[KEY_MAPS[tag]] ||= {})[dec(p[1])] = value;
    return;
  }
  if (SUB_MAPS[tag]) {
    const [parent, subs] = SUB_MAPS[tag];
    if (!subs.includes(p[1])) return;
    ((doc[parent] ||= {})[p[1]] ||= {})[dec(p[2])] = value;
    return;
  }
  if (ID_LISTS[tag]) {
    const list = (doc[ID_LISTS[tag]] ||= []);
    const id = dec(p[1]);
    const i = list.findIndex((x) => x && x.id === id);
    if (i >= 0) list[i] = value; else list.push(value);
    return;
  }
  if (tag === 'd') {
    const day = ((doc.days ||= {})[dec(p[1])] ||= emptyDay());
    for (const f of DAY_FIELDS) {
      if (value && value[f] !== undefined) day[f] = value[f];
      else delete day[f];
    }
    day.entries ||= [];
    return;
  }
  if (tag === 'e') {
    const day = ((doc.days ||= {})[dec(p[1])] ||= emptyDay());
    day.entries ||= [];
    const id = dec(p[2]);
    const i = day.entries.findIndex((x) => x && x.id === id);
    if (i >= 0) day.entries[i] = value; else day.entries.push(value);
  }
}

/** Remove one record from a document. */
export function dropRecord(doc, key) {
  const p = key.split('|');
  const tag = p[0];

  if (KEY_MAPS[tag]) { delete (doc[KEY_MAPS[tag]] || {})[dec(p[1])]; return; }
  if (SUB_MAPS[tag]) {
    const [parent, subs] = SUB_MAPS[tag];
    if (!subs.includes(p[1])) return;
    delete (((doc[parent] || {})[p[1]]) || {})[dec(p[2])];
    return;
  }
  if (ID_LISTS[tag]) {
    const list = doc[ID_LISTS[tag]];
    if (!Array.isArray(list)) return;
    const id = dec(p[1]);
    const i = list.findIndex((x) => x && x.id === id);
    if (i >= 0) list.splice(i, 1);
    return;
  }
  if (tag === 'd') {
    // Dropping a day's own fields does not remove entries that still live
    // there; the day disappears only once nothing is left in it.
    const iso = dec(p[1]);
    const day = (doc.days || {})[iso];
    if (!day) return;
    for (const f of DAY_FIELDS) delete day[f];
    if (!day.entries || !day.entries.length) delete doc.days[iso];
    return;
  }
  if (tag === 'e') {
    const iso = dec(p[1]);
    const day = (doc.days || {})[iso];
    if (!day || !Array.isArray(day.entries)) return;
    const id = dec(p[2]);
    const i = day.entries.findIndex((x) => x && x.id === id);
    if (i >= 0) day.entries.splice(i, 1);
  }
}

/**
 * Drop days left hollow by a merge.
 *
 * Records are applied in map order, so a day's own tombstone can land before
 * the tombstones for the entries inside it. `dropRecord` will not remove a day
 * that still holds entries, which left `{entries: []}` behind once those
 * entries were dropped a moment later. This sweeps afterwards — but only for
 * days that were genuinely tombstoned, so a day you just opened and have not
 * filled in yet is never swept out from under you.
 */
export function pruneHollowDays(doc, del = {}) {
  for (const iso of Object.keys(doc.days || {})) {
    const day = doc.days[iso] || {};
    const noOwnFields = DAY_FIELDS.every((f) => day[f] === undefined);
    const noEntries = !day.entries || day.entries.length === 0;
    if (noOwnFields && noEntries && del[`d|${enc(iso)}`] !== undefined) delete doc.days[iso];
  }
}

/** Cheap value fingerprint, for spotting what a mutation actually changed. */
export function fingerprint(v) {
  return v === undefined ? '\0undef' : JSON.stringify(v);
}

export function ensureSync(doc, deviceId) {
  const s = (doc._sync ||= { v: SYNC_VERSION, rec: {}, del: {} });
  s.v ||= SYNC_VERSION;
  s.rec ||= {};
  s.del ||= {};
  if (deviceId) s.device = deviceId;
  return s;
}
