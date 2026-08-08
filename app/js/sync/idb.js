// The iPhone's persistent local database.
//
// One document under one key — the whole rehab document, exactly the shape the
// Mac keeps in its JSON file. IndexedDB (not localStorage) because it is the
// store iOS treats as durable for an installed PWA, and because the pending
// sync queue lives INSIDE this document (any record stamped newer than the
// last push), so persisting the document persists the queue for free. That is
// what lets offline edits survive force-quit, restart and Airplane Mode.

const DB_NAME = 'rehab';
const STORE = 'doc';
const KEY = 'main';
const VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  return dbPromise;
}

export async function idbGetDoc() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutDoc(doc) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(doc, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

/** Best-effort: ask the browser to keep this origin's storage from eviction. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
