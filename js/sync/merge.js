// Record-level merge. Pure functions, no I/O — every rule here is unit-tested
// in tools/test_merge.mjs, because this is the one file where a bug silently
// eats data rather than throwing.
//
// Conflict rule: last write wins, per record, by wall-clock `updatedAt`.
// Ties break on device id (string compare) so both devices independently reach
// the SAME answer without talking to each other. Deletions are tombstones and
// compete on the same timeline, so an old offline device cannot resurrect a
// record that was deleted elsewhere — its live copy is simply older.
//
// Why per record and not per document: the app PUTs one big object, so a
// document-level merge would mean whichever device synced second wiped the
// other's whole day.
//
// Why not per FIELD: two devices editing different fields of the same exercise
// row within the same session is vanishingly rare for one person, and field
// merge triples the metadata for a case that does not happen. Per record keeps
// each row internally consistent, which matters more here.

import { collectRecords, putRecord, dropRecord, fingerprint, ensureSync, pruneHollowDays } from './records.js';

// Tombstones are pruned after this long. Any device offline longer than this
// could resurrect a deleted record — see README's limitations.
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Record what a mutation changed. Called from store.update() with the record
 *  snapshot taken immediately before the mutation ran. */
export function stampChanges(doc, before, deviceId, now = Date.now()) {
  const s = ensureSync(doc, deviceId);
  const after = collectRecords(doc);
  let touched = 0;

  for (const [key, val] of after) {
    const prev = before.get(key);
    if (prev === undefined || prev !== fingerprint(val)) {
      s.rec[key] = now;
      delete s.del[key];          // re-created after a delete
      touched++;
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      s.del[key] = now;           // tombstone, so the delete can travel
      delete s.rec[key];
      touched++;
    }
  }
  return touched;
}

/** Baseline stamp for a document that predates sync, or a fresh remote. */
export function stampAll(doc, deviceId, now = Date.now()) {
  const s = ensureSync(doc, deviceId);
  for (const key of collectRecords(doc).keys()) {
    if (s.rec[key] === undefined) s.rec[key] = now;
  }
  return doc;
}

function winner(aT, aDev, bT, bDev) {
  if (aT !== bT) return aT > bT ? 'a' : 'b';
  if (aDev === bDev) return 'a';
  return String(aDev) > String(bDev) ? 'a' : 'b';   // deterministic on both sides
}

/**
 * Merge `remote` into `local`, returning a new document.
 *
 * Symmetric: running it on either device with the sides swapped produces the
 * same result, which is what makes eventual convergence hold without either
 * device being authoritative.
 */
export function mergeDocs(local, remote, { now = Date.now() } = {}) {
  if (!remote || typeof remote !== 'object') {
    return { doc: local, pulled: 0, pushed: 0, deleted: 0, changed: false };
  }
  const out = JSON.parse(JSON.stringify(local));
  const ls = ensureSync(out);
  const rs = ensureSync(remote);
  const lDev = ls.device || '';
  const rDev = rs.device || '';

  const lRec = collectRecords(out);
  const rRec = collectRecords(remote);

  const keys = new Set([
    ...lRec.keys(), ...rRec.keys(),
    ...Object.keys(ls.del || {}), ...Object.keys(rs.del || {}),
  ]);

  let pulled = 0, deleted = 0, changed = false;

  for (const key of keys) {
    const lLive = lRec.has(key);
    const rLive = rRec.has(key);
    const lDel = ls.del[key];
    const rDel = rs.del[key];
    // A live record's time; a tombstone's time; whichever this side asserts.
    const lT = lLive ? (ls.rec[key] ?? 0) : (lDel ?? -1);
    const rT = rLive ? (rs.rec[key] ?? 0) : (rDel ?? -1);

    if (!lLive && !lDel && !rLive && !rDel) continue;

    // One side has never heard of this record at all: take the other side's
    // word for it, whatever that word is.
    if (!lLive && lDel === undefined) {
      if (rLive) { putRecord(out, key, rRec.get(key)); ls.rec[key] = rs.rec[key] ?? now; pulled++; changed = true; }
      else if (rDel !== undefined) { ls.del[key] = rDel; changed = true; }
      continue;
    }
    if (!rLive && rDel === undefined) continue;   // local already holds the truth

    const win = winner(lT, lDev, rT, rDev);
    if (win === 'a') continue;                    // local wins, nothing to do

    // Remote wins.
    if (rLive) {
      putRecord(out, key, rRec.get(key));
      ls.rec[key] = rs.rec[key] ?? now;
      delete ls.del[key];
      pulled++;
    } else {
      dropRecord(out, key);
      ls.del[key] = rDel;
      delete ls.rec[key];
      deleted++;
    }
    changed = true;
  }

  // Carry the union of tombstones so a third device (or a later pull) still
  // learns about the deletion, then drop ones old enough to be irrelevant.
  for (const [k, t] of Object.entries(rs.del || {})) {
    if (ls.del[k] === undefined && !lRec.has(k)) ls.del[k] = t;
  }
  // Sweep days emptied by the deletions above before pruning tombstones,
  // which is what tells us the day was deleted rather than merely blank.
  pruneHollowDays(out, ls.del);

  // Prune against the newest timestamp anyone has asserted, not the local
  // clock: a device with a wrong clock must not bin everyone's tombstones.
  let newest = now;
  for (const t of Object.values(ls.rec)) if (t > newest) newest = t;
  for (const t of Object.values(ls.del)) if (t > newest) newest = t;
  for (const [k, t] of Object.entries(ls.del)) {
    if (newest - t > TOMBSTONE_TTL_MS) delete ls.del[k];
  }

  // Anything the remote has not seen yet is what we owe it.
  let pushed = 0;
  for (const key of collectRecords(out).keys()) {
    const mine = ls.rec[key] ?? 0;
    const theirs = rRec.has(key) ? (rs.rec[key] ?? 0) : undefined;
    if (theirs === undefined || mine > theirs) pushed++;
  }
  for (const [k, t] of Object.entries(ls.del)) {
    if (rs.del?.[k] === undefined && (rRec.has(k) || rs.rec[k] !== undefined)) pushed++;
  }

  return { doc: out, pulled, pushed, deleted, changed };
}

/**
 * The newest stamp anywhere in a document.
 *
 * Used as the "everything up to here is uploaded" cursor. Derived from the
 * data rather than read off the clock at push time, so it cannot drift if the
 * two happen at slightly different moments.
 */
export function maxStamp(doc) {
  const s = doc?._sync;
  if (!s) return 0;
  let n = 0;
  for (const t of Object.values(s.rec || {})) if (t > n) n = t;
  for (const t of Object.values(s.del || {})) if (t > n) n = t;
  return n;
}

/** Does this document hold anything the given remote state has not got? */
export function hasPending(doc, lastPushedAt = 0) {
  const s = doc?._sync;
  if (!s) return false;
  for (const t of Object.values(s.rec || {})) if (t > lastPushedAt) return true;
  for (const t of Object.values(s.del || {})) if (t > lastPushedAt) return true;
  return false;
}

/** Count of records still waiting to reach the server — shown in the UI. */
export function pendingCount(doc, lastPushedAt = 0) {
  const s = doc?._sync;
  if (!s) return 0;
  let n = 0;
  for (const t of Object.values(s.rec || {})) if (t > lastPushedAt) n++;
  for (const t of Object.values(s.del || {})) if (t > lastPushedAt) n++;
  return n;
}
