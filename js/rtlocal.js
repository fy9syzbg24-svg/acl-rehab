// The store for the records the Rehab Test design brought in (2026-09-30): show days, questions
// for the clinic, the Morning set choices, supplements folded under "Now and then", reference
// points (the weight he compares to) and what has been seen once.
//
// In the test app these lived on one device (localStorage 'rt.local.v1'), because that app is a
// read only copy of his record. In the web app they SYNC across his devices (his call,
// 2026-09-30: "all of them"): they live in the synced document under `extras`, registered in
// sync/records.js as 'y' (the wipe trap), and every write goes through store.update(), so each
// record is stamped and travels like any other.
//
// Shape in the document: extras.shows[iso], extras.asks[id], extras.morningSet.add / .drop,
// extras.quiet[supplementId], extras.refs[name], extras.seen[name]. Callers see the old shape
// (asks as a list, oldest first), so no screen changed.
//
// Rule zero, as before: nothing is deleted (removal is `hide(path)`, which sets hidden: true;
// Undo restores with `set`), and a write that would remove a record is refused and logged to
// window.__rtErrors. Records saved on this device before the change (the old localStorage key)
// are brought across once, only where the document has nothing under that key; the old key is
// left in place.
//
// API (import { local } from './rtlocal.js'):
//   local.get(path, fallback)      path 'shows.2026-10-01' or ['shows', '2026-10-01']
//   local.set(path, value)         -> true when written, false when refused or not loaded yet
//   local.update(path, fn)         fn(current copy) returns the new value
//   local.hide(path)               merges { hidden: true, hiddenMs } into the record
//   local.list(name)               the records of a list or map, hidden ones left out
//                                  (arrays as they are; maps as [{ key, ...value }])
//   local.subscribe(fn)            fn(store) after every change, a sync included
//   rtLocalDump()                  the whole store as JSON text (nothing is sent anywhere)
import { state, update, subscribe as onStore } from './store.js';

const SUBS = ['shows', 'asks', 'morningSet', 'quiet', 'refs', 'seen'];
const LEGACY = 'rt.local.v1';
const LEGACY_DONE = `${LEGACY}.synced`;

const subs = new Set();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const parts = (path) => (Array.isArray(path) ? path.map(String) : String(path || '').split('.').filter(Boolean));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function logError(msg) {
  try { (window.__rtErrors ||= []).push(`[rtlocal] ${msg}`); } catch { /* no window */ }
}

const loaded = () => state.loaded === true && !state.readOnly && isObj(state.data);

/** The document's extras as the callers know them: asks a list (oldest first), the rest maps. */
function view(src = loaded() ? state.data.extras : null) {
  const x = isObj(src) ? src : {};
  const asks = Object.values(isObj(x.asks) ? x.asks : {})
    .filter(isObj)
    .sort((a, b) => (a.createdMs || 0) - (b.createdMs || 0) || String(a.id).localeCompare(String(b.id)));
  const ms = isObj(x.morningSet) ? x.morningSet : {};
  return clone({
    v: 1,
    shows: isObj(x.shows) ? x.shows : {},
    asks,
    morningSet: { add: Array.isArray(ms.add) ? ms.add : [], drop: Array.isArray(ms.drop) ? ms.drop : [] },
    quiet: isObj(x.quiet) ? x.quiet : {},
    refs: isObj(x.refs) ? x.refs : {},
    seen: isObj(x.seen) ? x.seen : {},
  });
}

/** The callers' shape back to the document's: asks keyed by id. */
function docForm(v) {
  const out = {};
  for (const k of SUBS) out[k] = {};
  for (const k of ['shows', 'quiet', 'refs', 'seen']) if (isObj(v[k])) out[k] = v[k];
  for (const a of Array.isArray(v.asks) ? v.asks : []) if (isObj(a) && a.id) out.asks[a.id] = a;
  const ms = isObj(v.morningSet) ? v.morningSet : {};
  out.morningSet = { add: Array.isArray(ms.add) ? ms.add : [], drop: Array.isArray(ms.drop) ? ms.drop : [] };
  return out;
}

function write(next) {
  if (!loaded()) { logError('write refused: his record has not loaded yet'); return false; }
  migrateLegacy();
  const cur = docForm(view());
  const want = docForm(next);
  // Nothing is deleted here: a record that would disappear is refused (hide it instead).
  for (const k of SUBS) {
    for (const id of Object.keys(cur[k])) {
      if (!(id in want[k])) { logError(`write refused: it would remove ${k}.${id}`); return false; }
    }
  }
  update((d) => {
    d.extras = isObj(d.extras) ? d.extras : {};
    for (const k of SUBS) d.extras[k] = clone(want[k]);
  });
  // store.update() emits, which reaches every subscriber through onStore below.
  return true;
}

function get(path, fallback = undefined) {
  let node = view();
  for (const p of parts(path)) {
    if (node == null || typeof node !== 'object') return fallback;
    node = node[p];
  }
  return node === undefined ? fallback : clone(node);
}

function set(path, value) {
  const ps = parts(path);
  if (!ps.length) return false;
  const next = view();
  let node = next;
  for (const p of ps.slice(0, -1)) {
    if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
    node = node[p];
  }
  node[ps[ps.length - 1]] = clone(value);
  return write(next);
}

function updateAt(path, fn) {
  return set(path, fn(get(path)));
}

function hide(path) {
  const cur = get(path);
  if (!cur || typeof cur !== 'object') return false;
  return set(path, { ...cur, hidden: true, hiddenMs: Date.now() });
}

function list(name) {
  const v = get(name);
  if (Array.isArray(v)) return v.filter((x) => !(x && x.hidden));
  if (v && typeof v === 'object') return Object.entries(v).filter(([, x]) => !(x && x.hidden)).map(([key, x]) => (x && typeof x === 'object' ? { key, ...x } : { key, value: x }));
  return [];
}

function subscribe(fn) { hook(); subs.add(fn); return () => subs.delete(fn); }

// Records saved on this device before they synced (the Rehab Test build ran here for a while on
// 2026-09-30): bring each across once, only where the document holds nothing under that key.
// The old key stays where it is (never deleted); a flag stops a second import.
let migrating = false;
function migrateLegacy() {
  if (migrating || !loaded()) return;
  let raw = null;
  try { if (localStorage.getItem(LEGACY_DONE)) return; raw = localStorage.getItem(LEGACY); } catch { return; }
  if (!raw) { try { localStorage.setItem(LEGACY_DONE, new Date().toISOString()); } catch { /* blocked */ } return; }
  let old;
  try { old = JSON.parse(raw); } catch { logError('the old device store could not be read; left untouched'); return; }
  if (!isObj(old)) return;
  const have = docForm(view());
  const add = docForm({ ...old, asks: Array.isArray(old.asks) ? old.asks : [] });
  let n = 0;
  for (const k of ['shows', 'asks', 'quiet', 'refs', 'seen']) {
    for (const [id, rec] of Object.entries(add[k])) if (!(id in have[k])) { have[k][id] = rec; n++; }
  }
  if (!have.morningSet.add.length && !have.morningSet.drop.length && (add.morningSet.add.length || add.morningSet.drop.length)) {
    have.morningSet = add.morningSet; n++;
  }
  migrating = true;
  try {
    if (n) update((d) => { d.extras = isObj(d.extras) ? d.extras : {}; for (const k of SUBS) d.extras[k] = clone(have[k]); });
    localStorage.setItem(LEGACY_DONE, new Date().toISOString());
  } catch (err) {
    logError(`bringing the old device store across failed: ${String(err.message || err)}`);
  } finally { migrating = false; }
}

// Every change to his record (a write here, a tick elsewhere, a sync) reaches the subscribers.
// The legacy import waits for a microtask: never write from inside another write's emit.
// Hooked up after the module graph has loaded: store.js imports modules that import this one,
// so at this file's own load time the store's listener list does not exist yet.
let queued = false;
let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  onStore(() => {
    for (const fn of subs) { try { fn(view()); } catch { /* a subscriber's problem */ } }
    try { window.dispatchEvent(new CustomEvent('rt-local', { detail: { path: null } })); } catch { /* no window */ }
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; migrateLegacy(); }); }
  });
  if (loaded()) queueMicrotask(migrateLegacy);
}
queueMicrotask(hook);

export const local = { get, set, update: updateAt, hide, list, subscribe, get readable() { return loaded(); } };

/** The whole store as text (nothing is sent anywhere). */
export function rtLocalDump() { return JSON.stringify(view(), null, 2); }

if (typeof window !== 'undefined') window.rtLocalDump = rtLocalDump;
