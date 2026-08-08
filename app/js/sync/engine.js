// The sync orchestration: pull, merge, push, retry. Backend-agnostic — it is
// handed a local getter/setter and talks to whatever github.js provides.
//
// The shape of one sync:
//   1. GET remote state.json (+ its sha)
//   2. merge remote INTO local; if local changed, persist it
//   3. if local now holds anything remote lacks, PUT it back quoting the sha
//   4. on 409 (someone else wrote between our GET and PUT): re-GET, re-merge,
//      retry — bounded, because each retry strictly incorporates more
//
// Every step is idempotent. A sync interrupted anywhere loses nothing: the
// local document already holds the change (stamped, queued), so the next sync
// simply tries again. Nothing is marked "sent" until GitHub confirms the PUT.

import { getConfig, setConfig } from './config.js';
import { ghGetFile, ghPutFile, ConflictError, GitHubError } from './github.js';
import { mergeDocs } from './merge.js';

const MAX_CONFLICT_RETRIES = 5;

function classifyFailure(err) {
  if (err instanceof GitHubError && err.status === 401) return { ok: false, reason: 'auth', error: String(err) };
  if (err instanceof GitHubError && err.status === 404) return { ok: false, reason: 'no-repo', error: String(err) };
  if (err instanceof GitHubError && err.status === 403) return { ok: false, reason: 'forbidden', error: String(err) };
  return { ok: false, reason: 'network', error: String(err) };
}

/**
 * Run one full sync.
 *
 * @param getLocal  () => the current in-memory document
 * @param setLocal  async (doc) => persist + adopt a merged document
 * @param opts.deviceId  stamped into the commit message
 * @param opts.recordCount () => number, for the "created" result
 */
export async function syncNow(getLocal, setLocal, opts = {}) {
  const cfg = getConfig();
  if (!cfg.token || !cfg.owner || !cfg.repo) return { ok: false, reason: 'unconfigured' };
  const conn = { token: cfg.token, owner: cfg.owner, repo: cfg.repo, path: cfg.path || 'state.json' };
  const msg = `rehab sync from ${opts.deviceId || 'device'}`;

  // ---- 1. pull ------------------------------------------------------
  let pulled;
  try {
    pulled = await ghGetFile(conn);
  } catch (err) {
    return classifyFailure(err);
  }

  // ---- empty repo: create the file from what we have ----------------
  if (!pulled.doc) {
    try {
      const put = await ghPutFile(conn, getLocal(), null, `rehab sync (init) from ${opts.deviceId || 'device'}`);
      setConfig({ remoteSha: put.sha, lastSyncedAt: Date.now(), lastPushedAt: Date.now() });
      return { ok: true, created: true, pulled: 0, pushed: 'all', deleted: 0 };
    } catch (err) {
      // Lost a race to create it — fall through to the normal path next time.
      if (err instanceof ConflictError) return { ok: false, reason: 'retry' };
      return classifyFailure(err);
    }
  }

  // ---- 2. merge remote into local -----------------------------------
  let local = getLocal();
  const merge = mergeDocs(local, pulled.doc);
  if (merge.changed) {
    local = merge.doc;
    await setLocal(local);
  }

  // ---- 3. push, only if we hold something remote does not -----------
  if (merge.pushed === 0) {
    setConfig({ remoteSha: pulled.sha, lastSyncedAt: Date.now(), lastPushedAt: Date.now() });
    return { ok: true, pulled: merge.pulled, pushed: 0, deleted: merge.deleted };
  }

  let sha = pulled.sha;
  let toPush = local;
  for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
    try {
      const put = await ghPutFile(conn, toPush, sha, msg);
      setConfig({ remoteSha: put.sha, lastSyncedAt: Date.now(), lastPushedAt: Date.now() });
      return { ok: true, pulled: merge.pulled, pushed: merge.pushed, deleted: merge.deleted };
    } catch (err) {
      if (!(err instanceof ConflictError)) return classifyFailure(err);
      // Someone wrote between our read and write. Re-read, fold their change
      // in, and try again against the newer sha.
      let re;
      try {
        re = await ghGetFile(conn);
      } catch (e2) {
        return classifyFailure(e2);
      }
      const m2 = mergeDocs(toPush, re.doc);
      toPush = m2.doc;
      sha = re.sha;
      if (m2.changed) await setLocal(toPush);
    }
  }
  return { ok: false, reason: 'conflict', error: 'too many concurrent writes' };
}
