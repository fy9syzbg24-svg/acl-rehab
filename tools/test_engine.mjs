// Sync-engine tests: the round trip between two devices and a fake server.
//
// Covers the spec's scenarios 1-4 and 11-12 — the ones about the NETWORK
// rather than the merge rules (those are in test_merge.mjs).

import { collectRecords, fingerprint } from '../app/js/sync/records.js';
import { stampChanges, stampAll, pendingCount } from '../app/js/sync/merge.js';
import { syncNow } from '../app/js/sync/engine.js';
import { ConflictError, GitHubError } from '../app/js/sync/github.js';

const T = Date.now() - 600_000;
const t = (n) => T + n;

let fails = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) fails.push(label);
}
function section(s) { console.log('\n' + s); }

const clone = (d) => JSON.parse(JSON.stringify(d));
const entryIds = (d, iso) => (d.days?.[iso]?.entries || []).map((e) => e.id).sort();

const baseDoc = () => ({
  schema: 6, settings: { weightUnit: 'lb' },
  days: { '2026-08-07': { checkin: {}, checklist: {}, notes: '', entries: [{ id: 'e1', ex: 'sl_calf', side: 'L', reps: 8, logged: true }] } },
  measurements: [], planGoals: {}, planFocus: {}, melbourne: { phases: {}, measures: {} },
  mrss: [], customExercises: [], program: { stage: {}, band: {}, weeklyTarget: {} },
});

/** A fake GitHub: one file, one sha, optional fault injection. */
function makeServer() {
  const srv = { doc: null, sha: null, n: 0, fail: null, onPut: null };
  const bump = () => { srv.n += 1; srv.sha = `sha${srv.n}`; };
  return {
    srv,
    getFile: async () => {
      if (srv.fail === 'get') throw new GitHubError(500, 'boom');
      if (srv.fail === 'offline') throw new TypeError('Failed to fetch');
      if (srv.fail === 'auth') throw new GitHubError(401, 'bad creds');
      return { doc: srv.doc ? clone(srv.doc) : null, sha: srv.sha };
    },
    putFile: async (_conn, doc, sha) => {
      if (srv.fail === 'put') throw new GitHubError(500, 'boom');
      if (srv.fail === 'offline') throw new TypeError('Failed to fetch');
      if (srv.onPut) { const hook = srv.onPut; srv.onPut = null; await hook(); }
      if (srv.doc && sha !== srv.sha) throw new ConflictError();
      srv.doc = clone(doc); bump();
      return { sha: srv.sha };
    },
  };
}

/** A device: its own local doc, its own sync cursor. */
function makeDevice(id, doc) {
  const dev = { id, doc: clone(doc), cfg: { token: 'x', owner: 'o', repo: 'r' }, writes: 0 };
  dev.edit = (at, fn) => {
    const before = new Map([...collectRecords(dev.doc)].map(([k, v]) => [k, fingerprint(v)]));
    fn(dev.doc);
    stampChanges(dev.doc, before, id, at);
  };
  dev.sync = (server) => syncNow(
    () => dev.doc,
    async (merged) => { dev.doc = merged; dev.writes += 1; },
    {
      deviceId: id,
      getFile: server.getFile, putFile: server.putFile,
      config: dev.cfg, setConfig: (patch) => Object.assign(dev.cfg, patch),
    },
  );
  return dev;
}

// ---------------------------------------------------------------------------
section('SCENARIO 1 & 2 — an edit on one device reaches the other');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  const iphone = makeDevice('iphone', { schema: 6, days: {}, measurements: [], settings: {} });

  let r = await mac.sync(server);
  check('mac created the file', r.created, true);

  r = await iphone.sync(server);
  check('iphone pulled the mac data', entryIds(iphone.doc, '2026-08-07'), ['e1']);

  iphone.edit(t(1000), (d) => {
    d.days['2026-08-07'].entries.push({ id: 'e2', ex: 'bike', side: 'B', time: 20, logged: true });
  });
  r = await iphone.sync(server);
  check('iphone pushed', r.ok, true);

  r = await mac.sync(server);
  check('mac received the iphone edit', entryIds(mac.doc, '2026-08-07'), ['e1', 'e2']);
  check('nothing was lost either way', entryIds(iphone.doc, '2026-08-07'), ['e1', 'e2']);
}

section('SCENARIO 3 & 4 — offline edits queue, survive, then upload');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  await mac.sync(server);

  server.srv.fail = 'offline';
  mac.edit(t(1000), (d) => { d.days['2026-08-07'].entries.push({ id: 'x1', ex: 'a', side: 'B', logged: true }); });
  mac.edit(t(1100), (d) => { d.days['2026-08-07'].entries.push({ id: 'x2', ex: 'b', side: 'B', logged: true }); });
  mac.edit(t(1200), (d) => { d.settings.bodyweight = 285; });

  const r1 = await mac.sync(server);
  check('sync fails while offline', r1.ok, false);
  check('classified as network, so it will retry', r1.reason, 'network');
  check('the edits are still here', entryIds(mac.doc, '2026-08-07'), ['e1', 'x1', 'x2']);

  // "close the app and reopen": the document IS the queue, so simulate a
  // reload by rebuilding the device from its persisted doc.
  const reopened = makeDevice('mac', mac.doc);
  reopened.cfg = mac.cfg;
  check('still pending after a reopen', pendingCount(reopened.doc, reopened.cfg.lastPushedAt || 0) >= 3, true);

  server.srv.fail = null;
  const r2 = await reopened.sync(server);
  check('uploads once back online', r2.ok, true);
  check('server now has them', entryIds(server.srv.doc, '2026-08-07'), ['e1', 'x1', 'x2']);
  check('nothing left pending', pendingCount(reopened.doc, reopened.cfg.lastPushedAt), 0);
}

section('SCENARIO 11 — backend outage: keep working, retry later');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  await mac.sync(server);

  server.srv.fail = 'get';
  const r = await mac.sync(server);
  check('reports failure', r.ok, false);
  check('local data untouched by the outage', entryIds(mac.doc, '2026-08-07'), ['e1']);

  mac.edit(t(2000), (d) => { d.settings.note = 'kept working'; });
  check('edits still work during the outage', mac.doc.settings.note, 'kept working');

  server.srv.fail = null;
  const r2 = await mac.sync(server);
  check('recovers on the next attempt', r2.ok, true);
  check('the edit made it up', server.srv.doc.settings.note, 'kept working');
}

section('SCENARIO 12 — a sync interrupted mid-write loses nothing');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  await mac.sync(server);

  mac.edit(t(3000), (d) => { d.days['2026-08-07'].entries.push({ id: 'mid', ex: 'z', side: 'B', logged: true }); });

  // Die during the PUT — the classic "did it land or not?" case.
  server.srv.fail = 'put';
  const r = await mac.sync(server);
  check('the attempt reports failure', r.ok, false);
  check('cursor NOT advanced, so it is still queued', pendingCount(mac.doc, mac.cfg.lastPushedAt || 0) > 0, true);

  server.srv.fail = null;
  const r2 = await mac.sync(server);
  check('retry succeeds', r2.ok, true);
  check('exactly one copy on the server', entryIds(server.srv.doc, '2026-08-07'), ['e1', 'mid']);

  // Retrying a THIRD time must not duplicate anything either.
  await mac.sync(server);
  check('still exactly one copy (idempotent)', entryIds(server.srv.doc, '2026-08-07'), ['e1', 'mid']);
}

section('a concurrent writer forces a 409, and the retry folds both in');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  await mac.sync(server);
  const iphone = makeDevice('iphone', mac.doc);
  iphone.cfg = { ...mac.cfg };

  mac.edit(t(4000), (d) => { d.days['2026-08-07'].entries.push({ id: 'fromMac', ex: 'm', side: 'B', logged: true }); });

  // The iPhone slips a write in between the Mac's GET and its PUT.
  server.srv.onPut = async () => {
    iphone.edit(t(4100), (d) => { d.days['2026-08-07'].entries.push({ id: 'fromPhone', ex: 'p', side: 'B', logged: true }); });
    await iphone.sync(server);
  };

  const r = await mac.sync(server);
  check('mac still succeeds after the conflict', r.ok, true);
  check('BOTH edits survived on the server', entryIds(server.srv.doc, '2026-08-07'), ['e1', 'fromMac', 'fromPhone']);
  check('and the mac holds both locally', entryIds(mac.doc, '2026-08-07'), ['e1', 'fromMac', 'fromPhone']);
}

section('a deletion travels through the server to the other device');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  mac.edit(t(100), (d) => { d.days['2026-08-07'].entries.push({ id: 'doomed', ex: 'q', side: 'B', logged: true }); });
  await mac.sync(server);
  const iphone = makeDevice('iphone', { schema: 6, days: {}, measurements: [], settings: {} });
  await iphone.sync(server);
  check('iphone has it first', entryIds(iphone.doc, '2026-08-07'), ['doomed', 'e1']);

  mac.edit(t(5000), (d) => { d.days['2026-08-07'].entries = d.days['2026-08-07'].entries.filter((e) => e.id !== 'doomed'); });
  await mac.sync(server);
  await iphone.sync(server);
  check('deletion reached the iphone', entryIds(iphone.doc, '2026-08-07'), ['e1']);

  // The iPhone syncing again must not push the old record back up.
  await iphone.sync(server);
  check('and it stays deleted on the server', entryIds(server.srv.doc, '2026-08-07'), ['e1']);
}

section('bad credentials are reported distinctly, not as a network blip');
{
  const server = makeServer();
  const mac = makeDevice('mac', stampAll(baseDoc(), 'mac', t(0)));
  server.srv.fail = 'auth';
  const r = await mac.sync(server);
  check('reason is auth', r.reason, 'auth');
}

console.log('\n' + (fails.length ? `FAILURES: ${fails.join(', ')}` : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
