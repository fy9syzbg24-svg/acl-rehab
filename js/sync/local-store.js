// The per-device local persistence layer — the one seam between the two
// environments the app runs in.
//
//   Mac    → the existing Python server at /api/data (UNCHANGED behaviour)
//   iPhone → IndexedDB
//
// Everything above this file (store, views, sync engine) is identical on both.
// Only read/write of the local document differs, and it differs only here.
//
// Detection is by hostname: the Mac app is always opened on localhost; the PWA
// is served from github.io. A Mac reached over the LAN by IP would be misread
// as a PWA — but the phone now uses the installed PWA, not the Mac's LAN
// server, so that path is retired.

import { idbGetDoc, idbPutDoc, requestPersistence } from './idb.js';

const host = (typeof location !== 'undefined' && location.hostname) || 'localhost';
export const SERVER_MODE = host === 'localhost' || host === '127.0.0.1';

/**
 * Read this device's local document.
 * Returns {} when there is nothing yet (fresh device). Throws only when the
 * store should have answered but could not — on the Mac that means the server
 * is down, which the caller turns into read-only mode.
 */
export async function readLocalDoc() {
  if (SERVER_MODE) {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error(`server read ${res.status}`);
    return await res.json();
  }
  requestPersistence();               // fire-and-forget, first read is a fine moment
  return (await idbGetDoc()) || {};
}

/**
 * Persist this device's local document. Returns an ISO timestamp of the save.
 * On the Mac this is the same atomic-write-to-disk the app has always done.
 */
export async function writeLocalDoc(doc) {
  if (SERVER_MODE) {
    const res = await fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (!res.ok) throw new Error(await res.text());
    const body = await res.json();
    return body.savedAt || new Date().toISOString();
  }
  await idbPutDoc(doc);
  return new Date().toISOString();
}
