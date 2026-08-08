// GitHub Contents API transport — the shared cloud store.
//
// One file, state.json, in a private repo. GET reads it and its blob SHA; PUT
// writes it back quoting that SHA, so GitHub itself rejects (409) a write made
// against a stale version. That SHA is the whole concurrency-control story:
// the sync engine re-reads and retries on 409, which is what makes two devices
// pushing near-simultaneously safe.
//
// This is the ONLY module that knows the backend is GitHub. Swapping it for a
// different store means rewriting this file and nothing else.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, body) {
    super(`GitHub ${status}: ${String(body).slice(0, 200)}`);
    this.name = 'GitHubError';
    this.status = status;
  }
}
export class ConflictError extends Error {
  constructor() { super('remote changed under us'); this.name = 'ConflictError'; }
}

// Base64 <-> UTF-8. The notes carry em-dashes and accents, so a naive
// btoa(unescape(...)) would corrupt them; go through the byte layer instead.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob((b64 || '').replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

const fileUrl = ({ owner, repo, path }) =>
  `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;

/**
 * Read state.json.
 * Returns { doc, sha }. On an empty repo (file not yet created) returns
 * { doc: null, sha: null } — a normal first-run state, not an error.
 */
export async function ghGetFile(conn) {
  const res = await fetch(fileUrl(conn), { headers: headers(conn.token), cache: 'no-store' });
  if (res.status === 404) return { doc: null, sha: null };
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const json = await res.json();
  let doc = null;
  try {
    doc = JSON.parse(fromBase64(json.content));
  } catch (e) {
    throw new GitHubError(200, `state.json is not valid JSON: ${e}`);
  }
  return { doc, sha: json.sha };
}

/**
 * Write state.json. Pass the sha from the last read; omit it only to create
 * the file for the first time. Throws ConflictError on a 409 so the engine can
 * re-read and retry.
 */
export async function ghPutFile(conn, doc, sha, message) {
  const body = {
    message: message || `rehab sync ${new Date().toISOString()}`,
    content: toBase64(JSON.stringify(doc)),
  };
  if (sha) body.sha = sha;
  const res = await fetch(fileUrl(conn), {
    method: 'PUT',
    headers: { ...headers(conn.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new ConflictError();
  // A stale sha can also surface as 422 ("does not match") on some paths.
  if (res.status === 422 && sha) throw new ConflictError();
  if (!res.ok) throw new GitHubError(res.status, await res.text());
  const json = await res.json();
  return { sha: json.content && json.content.sha };
}

/** Cheap credential + repo check for the connect screen. */
export async function ghCheckAccess(conn) {
  const res = await fetch(`${API}/repos/${conn.owner}/${conn.repo}`, {
    headers: headers(conn.token), cache: 'no-store',
  });
  if (res.status === 401) return { ok: false, reason: 'bad-token' };
  if (res.status === 404) return { ok: false, reason: 'no-repo' };
  if (!res.ok) return { ok: false, reason: `http-${res.status}` };
  const json = await res.json();
  return { ok: true, private: !!json.private, permissions: json.permissions || {} };
}
