// Device-local sync configuration and bookkeeping.
//
// This is the ONE place the GitHub token lives, and it is deliberately kept
// OUT of the synced document: it is a credential for this device, not data to
// share. localStorage because it must survive reloads, force-quit and restart
// on both the Mac browser and the iPhone PWA, and because it is small.
//
// Nothing here is ever pushed to the repo.

const KEY = 'rehab.sync.config';

/** Whole config object: { token, owner, repo, path, remoteSha, lastSyncedAt, lastPushedAt }. */
export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or full disk — sync just stays this-session-only */
  }
  return next;
}

/** Forget this device's connection. Leaves the local document untouched. */
export function clearConfig() {
  const { lastSyncedAt } = getConfig();
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  return { lastSyncedAt };
}

/** True once a repo and token are set — sync is a no-op until then. */
export function isConfigured() {
  const c = getConfig();
  return !!(c.token && c.owner && c.repo);
}

export function repoPath() {
  return getConfig().path || 'state.json';
}
