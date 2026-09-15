// Record-level merge. Pure functions, no I/O, every rule here is unit-tested
// in tools/test_merge.mjs, because this is the one file where a bug silently
// eats data rather than throwing.
//
// Conflict rule: last write wins, per record, by wall-clock `updatedAt`.
// Ties break on device id (string compare) so both devices independently reach
// the SAME answer without talking to each other. Deletions are tombstones and
// compete on the same timeline, so an old offline device cannot resurrect a
// record that was deleted elsewhere, its live copy is simply older.
//
// Why per record and not per document: the app PUTs one big object, so a
// document-level merge would mean whichever device synced second wiped the
// other's whole day.
//
// Why not per FIELD: two devices editing different fields of the same exercise
// row within the same session is vanishingly rare for one person, and field
// merge triples the metadata for a case that does not happen. Per record keeps
// each row internally consistent, which matters more here.

import { collectRecords, putRecord, dropRecord, fingerprint, ensureSync, pruneHollowDays, dayPaths, getPath, setPath } from './records.js';

// 2026-09-15, the follow-up audit (A02 to A06), five changes to the rules above:
//
//   A02  a stamp is never reused for a key: a new edit is stamped at least one
//        millisecond after that key's previous stamp, so an edit in the same
//        millisecond as the last one, or after the clock went backwards, is
//        still newer than the version it replaces
//   A03  a tie decided in our favour is still pushed when the values differ,
//        so both devices publish the same winner instead of each keeping its own
//   A04  a tie is broken by the VALUE (its fingerprint), not by which device
//        last wrote the whole document, so relaying a document through a third
//        device can never flip a result; at a tie a live record beats a deletion
//   A05  tombstones are kept for good. Pruning them against the newest stamp
//        let one device with a clock in the future expire everyone's deletions,
//        and any expiry lets a long-offline device bring a deleted record back.
//        They are a key and a number each
//   A06  a day's own fields merge field by field, and the supplement ticks,
//        checklist and check-in item by item (`_sync.dp`), so a note written on
//        one device can no longer wipe a supplement ticked on the other. A
//        document from an older build has no per-field stamps and falls back to
//        the whole-record rule, exactly as before

/** Record what a mutation changed. Called from store.update() with the record
 *  snapshot taken immediately before the mutation ran. */
export function stampChanges(doc, before, deviceId, now = Date.now()) {
  const s = ensureSync(doc, deviceId);
  const after = collectRecords(doc);
  let touched = 0;
  // Never reuse a stamp for a key (A02): strictly after its previous one.
  const next = (key) => Math.max(now, (s.rec[key] ?? 0) + 1, (s.del[key] ?? 0) + 1);

  for (const [key, val] of after) {
    const prev = before.get(key);
    if (prev === undefined || prev !== fingerprint(val)) {
      const t = next(key);
      if (key.startsWith('d|')) stampDayPaths(s, key, prev, val, t);
      s.rec[key] = t;
      delete s.del[key];          // re-created after a delete
      touched++;
    }
  }
  for (const key of before.keys()) {
    if (!after.has(key)) {
      s.del[key] = next(key);     // tombstone, so the delete can travel
      delete s.rec[key];
      delete s.dp[key];
      touched++;
    }
  }
  return touched;
}

/** Per-field stamps for a day record: only the paths whose value changed. */
function stampDayPaths(s, key, prevFp, val, t) {
  let prev;
  try { prev = prevFp === undefined || prevFp === '\0undef' ? undefined : JSON.parse(prevFp); } catch { prev = undefined; }
  const dp = (s.dp[key] ||= {});
  const paths = new Set([...dayPaths(prev), ...dayPaths(val)]);
  for (const path of paths) {
    if (fingerprint(getPath(prev, path)) !== fingerprint(getPath(val, path))) {
      dp[path] = Math.max(t, (dp[path] ?? 0) + 1);
    }
  }
}

/** Baseline stamp for a document that predates sync, or a fresh remote. */
export function stampAll(doc, deviceId, now = Date.now()) {
  const s = ensureSync(doc, deviceId);
  for (const key of collectRecords(doc).keys()) {
    if (s.rec[key] === undefined) s.rec[key] = now;
  }
  return doc;
}

/**
 * Which side wins one record. Newer stamp first; at a tie a live value beats a
 * deletion, then the larger fingerprint wins, so every device picks the same
 * one whoever relayed the document (A04).
 */
function winner(aT, aLive, aVal, bT, bLive, bVal) {
  if (aT !== bT) return aT > bT ? 'a' : 'b';
  if (aLive !== bLive) return aLive ? 'a' : 'b';
  if (!aLive) return 'a';
  const fa = fingerprint(aVal);
  const fb = fingerprint(bVal);
  return fa >= fb ? 'a' : 'b';
}

/**
 * Merge one day's own fields path by path (A06). Each side's stamp for a path
 * is its per-field stamp when it has one, else its whole-record stamp.
 * Returns { value, dp, stamp }.
 */
function mergeDay(lVal, lT, lDp, rVal, rT, rDp) {
  const paths = new Set([...dayPaths(lVal), ...dayPaths(rVal), ...Object.keys(lDp || {}), ...Object.keys(rDp || {})]);
  const value = {};
  const dp = {};
  // Keep the containers the views expect (an empty check-in stays {}).
  for (const f of ['checkin', 'checklist', 'supps']) {
    const lf = lVal?.[f];
    const rf = rVal?.[f];
    if ((lf && typeof lf === 'object') || (rf && typeof rf === 'object')) value[f] = {};
  }
  for (const path of paths) {
    const lv = getPath(lVal, path);
    const rv = getPath(rVal, path);
    // No per-field stamp: a value held is as old as its record; a value not
    // held is unknown rather than deleted, so an older build's copy (or a day
    // the Mac created empty) never erases an item the other side has.
    const lp = lDp?.[path] ?? (lv !== undefined ? lT : -1);
    const rp = rDp?.[path] ?? (rv !== undefined ? rT : -1);
    let take = lv;
    if (fingerprint(lv) !== fingerprint(rv)) {
      take = winner(lp, lv !== undefined, lv, rp, rv !== undefined, rv) === 'a' ? lv : rv;
    }
    if (take !== undefined) setPath(value, path, JSON.parse(JSON.stringify(take)));
    const t = Math.max(lp, rp);
    if (t >= 0) dp[path] = t;
  }
  const same = (x) => fingerprint(normalDay(x)) === fingerprint(normalDay(value));
  const stamp = same(rVal) ? rT : same(lVal) ? lT : Math.max(lT, rT) + 1;
  return { value, dp, stamp };
}

/** A day value with empty containers dropped, for comparing merge results. */
function normalDay(v) {
  const out = {};
  for (const path of dayPaths(v)) setPath(out, path, getPath(v, path));
  return out;
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
  const rs = ensureSync(JSON.parse(JSON.stringify(remote)));

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
      if (rLive) {
        putRecord(out, key, rRec.get(key)); ls.rec[key] = rs.rec[key] ?? now;
        if (rs.dp[key]) ls.dp[key] = rs.dp[key];
        pulled++; changed = true;
      } else if (rDel !== undefined) { ls.del[key] = rDel; changed = true; }
      continue;
    }
    if (!rLive && rDel === undefined) continue;   // local already holds the truth

    // Both hold the same value: nothing to decide, keep the newer stamps.
    if (lLive && rLive && fingerprint(lRec.get(key)) === fingerprint(rRec.get(key))) {
      if (rT > lT) { ls.rec[key] = rT; changed = true; }
      if (key.startsWith('d|') && rs.dp[key]) {
        const dp = (ls.dp[key] ||= {});
        for (const [p, t] of Object.entries(rs.dp[key])) if (!(dp[p] >= t)) { dp[p] = t; changed = true; }
      }
      continue;
    }

    // A day both sides changed: field by field (A06).
    if (lLive && rLive && key.startsWith('d|') && (ls.dp[key] || rs.dp[key])) {
      const m = mergeDay(lRec.get(key), lT, ls.dp[key], rRec.get(key), rT, rs.dp[key]);
      if (fingerprint(normalDay(m.value)) !== fingerprint(normalDay(lRec.get(key)))) { putRecord(out, key, m.value); pulled++; changed = true; }
      if (ls.rec[key] !== m.stamp) { ls.rec[key] = m.stamp; changed = true; }
      ls.dp[key] = m.dp;
      continue;
    }

    const win = winner(lT, lLive, lRec.get(key), rT, rLive, rRec.get(key));
    if (win === 'a') continue;                    // local wins, nothing to do

    // Remote wins.
    if (rLive) {
      putRecord(out, key, rRec.get(key));
      ls.rec[key] = rs.rec[key] ?? now;
      if (rs.dp[key]) ls.dp[key] = rs.dp[key]; else delete ls.dp[key];
      delete ls.del[key];
      pulled++;
    } else {
      dropRecord(out, key);
      ls.del[key] = rDel;
      delete ls.rec[key];
      delete ls.dp[key];
      deleted++;
    }
    changed = true;
  }

  // Carry the union of tombstones so a third device (or a later pull) still
  // learns about the deletion. Nothing is pruned (A05).
  for (const [k, t] of Object.entries(rs.del || {})) {
    if (ls.del[k] === undefined && !lRec.has(k)) ls.del[k] = t;
  }
  // Sweep days emptied by the deletions above, which is what tells us the day
  // was deleted rather than merely blank.
  pruneHollowDays(out, ls.del);

  // Anything the remote has not seen yet is what we owe it, including a tie we
  // won with a different value (A03).
  let pushed = 0;
  for (const [key, val] of collectRecords(out)) {
    const mine = ls.rec[key] ?? 0;
    const theirs = rRec.has(key) ? (rs.rec[key] ?? 0) : undefined;
    if (theirs === undefined || mine > theirs) pushed++;
    else if (mine === theirs && fingerprint(val) !== fingerprint(rRec.get(key))) pushed++;
  }
  for (const [k] of Object.entries(ls.del)) {
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

/**
 * The stamps a remote copy holds, for acknowledging exactly what reached it
 * (A01). Kept on the device, never in the synced document.
 */
export function ackOf(doc) {
  const s = doc?._sync || {};
  return { rec: { ...(s.rec || {}) }, del: { ...(s.del || {}) } };
}

function isAck(x) { return x && typeof x === 'object' && x.rec; }

/** Keys whose stamp differs from what the remote was last known to hold. */
function pendingKeys(doc, since) {
  const s = doc?._sync;
  const out = [];
  if (!s) return out;
  if (isAck(since)) {
    for (const [k, t] of Object.entries(s.rec || {})) if (since.rec[k] !== t) out.push(k);
    for (const [k, t] of Object.entries(s.del || {})) if (since.del[k] !== t) out.push(k);
    return out;
  }
  const cursor = Number(since) || 0;   // older builds: a single time cursor
  for (const [k, t] of Object.entries(s.rec || {})) if (t > cursor) out.push(k);
  for (const [k, t] of Object.entries(s.del || {})) if (t > cursor) out.push(k);
  return out;
}

/** Does this document hold anything the given remote state has not got? */
export function hasPending(doc, since = 0) {
  return pendingKeys(doc, since).length > 0;
}

/** Count of records still waiting to reach the server, shown in the UI. */
export function pendingCount(doc, since = 0) {
  return pendingKeys(doc, since).length;
}
