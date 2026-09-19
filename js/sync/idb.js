// The iPhone's persistent local database.
//
// One document under one key, the whole rehab document, exactly the shape the
// Mac keeps in its JSON file. IndexedDB (not localStorage) because it is the
// store iOS treats as durable for an installed PWA, and because the pending
// sync queue lives INSIDE this document (any record stamped newer than the
// last push), so persisting the document persists the queue for free. That is
// what lets offline edits survive force-quit, restart and Airplane Mode.
//
// 2026-09-15, the follow-up audit (A12, A15). Every write now happens in one
// transaction that:
//   - checks the revision it read (`rev`), so a second window of the app that
//     saved in between is merged, not overwritten (StaleWrite)
//   - refuses to replace a document that holds records with one that holds none
//   - keeps a restore point that is never deleted: the first save of each day,
//     and the document as it was before any save that holds fewer records
// A failed open is reset so the next attempt can succeed, and never reads as
// an empty store.

import { collectRecords } from './records.js';

const DB_NAME = 'rehab';
const STORE = 'doc';
const SNAPS = 'snapshots';
const KEY = 'main';
const REV = 'rev';
const VERSION = 2;

let dbPromise = null;

export class StaleWrite extends Error {
  constructor(doc, rev) { super('the saved document changed in another window'); this.doc = doc; this.rev = rev; }
}
export class RefusedWrite extends Error {}

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(SNAPS)) db.createObjectStore(SNAPS);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another window upgrading the database: let it, and reopen next time.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** The document and its revision: { doc, rev }. doc is null on a fresh device. */
export async function idbGetDoc() {
  const db = await open();
  const tx = db.transaction(STORE, 'readonly');
  const st = tx.objectStore(STORE);
  const [doc, rev] = await Promise.all([reqP(st.get(KEY)), reqP(st.get(REV))]);
  return { doc: doc || null, rev: rev || 0 };
}

// A whole collection missing from a document is the sync wipe trap, never an
// edit: deleting records leaves the key there, empty (Codex audit, partial
// bucket reductions). Same list as server.py's BUCKETS.
const BUCKETS = ['measurements', 'mrss', 'customExercises', 'supplements', 'prnMeds', 'doses',
  'planGoals', 'planFocus', 'days', 'caseFile', 'settings', 'program', 'melbourne'];
const holds = (v) => !!v && typeof v === 'object' && Object.keys(v).length > 0;
export function missingBuckets(current, doc) {
  if (!current || typeof current !== 'object' || !doc || typeof doc !== 'object') return [];
  return BUCKETS.filter((k) => holds(current[k]) && !(k in doc));
}

const countOf = (doc) => (doc && typeof doc === 'object' ? collectRecords(doc).size : 0);
const dayStamp = () => new Date().toISOString().slice(0, 10);

/**
 * Write the document if the store is still at `expectedRev` (pass null to
 * skip the check). Resolves to the new revision.
 */
export async function idbPutDoc(doc, expectedRev = null) {
  const db = await open();
  const want = countOf(doc);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, SNAPS], 'readwrite');
    const st = tx.objectStore(STORE);
    const snaps = tx.objectStore(SNAPS);
    let failure = null;
    let newRev = 0;
    const fail = (err) => { failure = err; try { tx.abort(); } catch { /* already finished */ } };
    // Plain request callbacks, one after another, so the transaction stays
    // active on every engine (promise hops inside IndexedDB were unreliable
    // on older Safari).
    const getDoc = st.get(KEY);
    getDoc.onsuccess = () => {
      const current = getDoc.result || null;
      const getRev = st.get(REV);
      getRev.onsuccess = () => {
        const rev = getRev.result || 0;
        if (expectedRev !== null && rev !== expectedRev) { fail(new StaleWrite(current, rev)); return; }
        const have = countOf(current);
        if (have > 0 && want === 0) { fail(new RefusedWrite(`refusing to replace ${have} records with an empty document`)); return; }
        const gone = missingBuckets(current, doc);
        if (gone.length) { fail(new RefusedWrite(`refusing a document without ${gone.join(', ')}, which this device holds`)); return; }
        const write = () => {
          newRev = rev + 1;
          st.put(doc, KEY);
          st.put(newRev, REV);
        };
        if (!current) { write(); return; }
        const now = new Date().toISOString();
        if (want < have) snaps.put(current, `before-reduce-${now}`);
        const dayKey = `day-${dayStamp()}`;
        const c = snaps.count(IDBKeyRange.bound(dayKey, `${dayKey}\uffff`));
        c.onsuccess = () => {
          if (!c.result) snaps.put(current, `${dayKey}-${now}`);
          write();
        };
      };
    };
    tx.oncomplete = () => resolve(newRev);
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error('IndexedDB write aborted'));
  });
}

/**
 * A named restore point of the stored document, never deleted, read back and
 * compared before it counts (Codex audit B15: before an import). Resolves to
 * { ok, key, empty }.
 */
export async function idbSnapshot(reason) {
  const db = await open();
  const key = `${reason}-${new Date().toISOString()}`;
  const current = await new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, SNAPS], 'readwrite');
    const get = tx.objectStore(STORE).get(KEY);
    let doc = null;
    get.onsuccess = () => {
      doc = get.result || null;
      if (doc) tx.objectStore(SNAPS).put(doc, key);
    };
    tx.oncomplete = () => resolve(doc);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('snapshot aborted'));
  });
  if (!current) return { ok: true, empty: true, key: null };
  const back = await reqP(db.transaction(SNAPS, 'readonly').objectStore(SNAPS).get(key));
  return { ok: !!back && JSON.stringify(back) === JSON.stringify(current), key };
}

/** Best-effort: ask the browser to keep this origin's storage from eviction. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
