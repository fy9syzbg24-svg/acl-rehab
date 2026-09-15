// The per-device local persistence layer, the one seam between the two
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
// as a PWA, but the phone now uses the installed PWA, not the Mac's LAN
// server, so that path is retired.

import { idbGetDoc, idbPutDoc, requestPersistence, StaleWrite, RefusedWrite } from './idb.js';

export { StaleWrite, RefusedWrite };

const host = (typeof location !== 'undefined' && location.hostname) || 'localhost';
export const SERVER_MODE = host === 'localhost' || host === '127.0.0.1';

// The revision of the saved document this window last read or wrote
// (2026-09-15, audit A13 and A15). A write quotes it; if another window, or a
// PhysiApp import on the Mac, saved in between, the write is refused with the
// newer document so the caller can merge and try again.
let rev = null;

/**
 * Read this device's local document.
 * Returns {} when there is nothing yet (fresh device). Throws only when the
 * store should have answered but could not: on the Mac the server is down, on
 * the phone IndexedDB failed. The caller turns either into read-only mode.
 */
export async function readLocalDoc() {
  if (SERVER_MODE) {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error(`server read ${res.status}`);
    rev = res.headers.get('X-Data-Rev');
    return await res.json();
  }
  requestPersistence();               // fire-and-forget, first read is a fine moment
  const got = await idbGetDoc();
  rev = got.rev;
  return got.doc || {};
}

/**
 * Persist this device's local document. Returns an ISO timestamp of the save.
 * Throws StaleWrite (with .doc) when the stored document changed since this
 * window read it, RefusedWrite when it would empty a store holding records.
 */
export async function writeLocalDoc(doc) {
  if (SERVER_MODE) {
    const headers = { 'Content-Type': 'application/json' };
    if (rev) headers['If-Match'] = rev;
    const res = await fetch('/api/data', { method: 'PUT', headers, body: JSON.stringify(doc) });
    if (res.status === 409) {
      const body = await res.json();
      throw new StaleWrite(body.doc, body.rev);
    }
    if (res.status === 422) throw new RefusedWrite((await res.json()).error);
    if (!res.ok) throw new Error(await res.text());
    const body = await res.json();
    rev = res.headers.get('X-Data-Rev') || body.rev || rev;
    return body.savedAt || new Date().toISOString();
  }
  rev = await idbPutDoc(doc, rev);
  return new Date().toISOString();
}

/** After a StaleWrite has been merged: the revision to quote next. */
export function adoptRevision(r) { rev = r; }
