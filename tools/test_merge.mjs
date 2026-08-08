// Merge-engine tests. Run: node tools/test_merge.mjs
//
// Covers the cross-device scenarios from the spec: independent offline edits
// on both devices, same-record conflicts, deletions propagating, and an old
// offline device failing to resurrect something deleted elsewhere.

import { collectRecords, fingerprint } from '../app/js/sync/records.js';
import { mergeDocs, stampChanges, stampAll, pendingCount } from '../app/js/sync/merge.js';

// Real epoch milliseconds. Toy values like t(0) made the tombstone TTL treat
// every deletion as ancient, which is not how the app ever runs.
const T = Date.now() - 60_000;
const t = (n) => T + n;

let fails = [];
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + label + `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) fails.push(label);
}
function section(t) { console.log('\n' + t); }

const base = () => ({
  schema: 6,
  settings: { weightUnit: 'lb', bodyweight: 290 },
  days: {
    '2026-08-07': {
      checkin: {}, checklist: {}, notes: '',
      entries: [
        { id: 'e1', ex: 'sl_calf', side: 'L', reps: 8, logged: true },
        { id: 'e2', ex: 'bike', side: 'B', time: 20, logged: true },
      ],
    },
  },
  measurements: [{ id: 'm1', date: '2026-08-07', measure: 'sl_calf_raise', leg: 'L', value: 8 }],
  planGoals: {}, planFocus: {}, melbourne: { phases: {}, measures: {} },
  mrss: [], customExercises: [], program: { stage: {}, band: {}, weeklyTarget: {} },
});

/** Simulate a device: mutate, and stamp exactly the way store.update() does. */
function edit(doc, device, at, fn) {
  const before = new Map([...collectRecords(doc)].map(([k, v]) => [k, fingerprint(v)]));
  fn(doc);
  stampChanges(doc, before, device, at);
  return doc;
}
const clone = (d) => JSON.parse(JSON.stringify(d));
const entriesOf = (d, iso) => (d.days[iso]?.entries || []).map((e) => e.id).sort();

section('records decompose and reassemble');
{
  const d = stampAll(base(), 'mac', t(0));
  const keys = [...collectRecords(d).keys()].sort();
  check('entry records exist', keys.filter((k) => k.startsWith('e|')), ['e|2026-08-07|e1', 'e|2026-08-07|e2']);
  check('day record exists', keys.includes('d|2026-08-07'), true);
  check('measurement record', keys.includes('m|m1'), true);
  check('settings are per key', keys.filter((k) => k.startsWith('s|')).length, 2);
}

section('SCENARIO 5 — both devices edit DIFFERENT records offline');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(1000), (d) => {
    d.days['2026-08-07'].entries.push({ id: 'e3', ex: 'sl_squat', side: 'L', reps: 5, logged: true });
  });
  const iph = edit(clone(start), 'iphone', t(1100), (d) => {
    d.measurements.push({ id: 'm2', date: '2026-08-07', measure: 'sl_foam_task', leg: 'R', value: 19 });
  });
  const a = mergeDocs(mac, iph).doc;      // mac pulls iphone
  const b = mergeDocs(iph, mac).doc;      // iphone pulls mac
  check('mac has both changes', entriesOf(a, '2026-08-07').includes('e3') && a.measurements.some((m) => m.id === 'm2'), true);
  check('iphone has both changes', entriesOf(b, '2026-08-07').includes('e3') && b.measurements.some((m) => m.id === 'm2'), true);
  check('neither lost the original', [entriesOf(a, '2026-08-07').length, entriesOf(b, '2026-08-07').length], [3, 3]);
  check('converged', JSON.stringify(collectRecords(a).size), JSON.stringify(collectRecords(b).size));
}

section('SCENARIO 6 — both devices edit the SAME record offline');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(1000), (d) => { d.days['2026-08-07'].entries[0].reps = 11; });
  const iph = edit(clone(start), 'iphone', t(2000), (d) => { d.days['2026-08-07'].entries[0].reps = 14; });
  const a = mergeDocs(mac, iph).doc;
  const b = mergeDocs(iph, mac).doc;
  check('later edit wins on mac', a.days['2026-08-07'].entries[0].reps, 14);
  check('later edit wins on iphone', b.days['2026-08-07'].entries[0].reps, 14);
  check('the other record is untouched', a.days['2026-08-07'].entries[1].time, 20);
}

section('  …and a dead tie resolves the same way on both devices');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(4000), (d) => { d.days['2026-08-07'].entries[0].reps = 11; });
  const iph = edit(clone(start), 'iphone', t(4000), (d) => { d.days['2026-08-07'].entries[0].reps = 14; });
  const a = mergeDocs(mac, iph).doc;
  const b = mergeDocs(iph, mac).doc;
  check('both sides agree', a.days['2026-08-07'].entries[0].reps, b.days['2026-08-07'].entries[0].reps);
}

section('SCENARIO 7 — a deletion propagates');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(1000), (d) => {
    d.days['2026-08-07'].entries = d.days['2026-08-07'].entries.filter((e) => e.id !== 'e2');
  });
  check('tombstone recorded', !!mac._sync.del['e|2026-08-07|e2'], true);
  const iph = mergeDocs(clone(start), mac).doc;
  check('iphone dropped it', entriesOf(iph, '2026-08-07'), ['e1']);
  check('iphone kept the tombstone', !!iph._sync.del['e|2026-08-07|e2'], true);
  check('unrelated entry survived', entriesOf(iph, '2026-08-07').includes('e1'), true);
}

section('SCENARIO 8 — a stale device does NOT resurrect a deleted record');
{
  const start = stampAll(base(), 'mac', t(0));
  // Mac deletes at t=t(4000) and syncs.
  const mac = edit(clone(start), 'mac', t(4000), (d) => {
    d.days['2026-08-07'].entries = d.days['2026-08-07'].entries.filter((e) => e.id !== 'e2');
  });
  // The iPhone was offline the whole time and still holds the old live copy.
  const stale = clone(start);
  const after = mergeDocs(stale, mac).doc;
  check('deletion wins over the stale copy', entriesOf(after, '2026-08-07'), ['e1']);

  // And pushing the stale device back up must not revive it either.
  const backOnServer = mergeDocs(clone(mac), stale).doc;
  check('server stays deleted', entriesOf(backOnServer, '2026-08-07'), ['e1']);
}

section('  …but a genuine re-creation after the delete DOES survive');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(4000), (d) => {
    d.days['2026-08-07'].entries = d.days['2026-08-07'].entries.filter((e) => e.id !== 'e2');
  });
  const iph = edit(mergeDocs(clone(start), mac).doc, 'iphone', t(5000), (d) => {
    d.days['2026-08-07'].entries.push({ id: 'e2', ex: 'bike', side: 'B', time: 30, logged: true });
  });
  const back = mergeDocs(clone(mac), iph).doc;
  check('re-created record returns', entriesOf(back, '2026-08-07'), ['e1', 'e2']);
  check('with the new value', back.days['2026-08-07'].entries.find((e) => e.id === 'e2').time, 30);
}

section('merge is idempotent and symmetric (safe to retry)');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(1000), (d) => { d.settings.bodyweight = 285; });
  const iph = edit(clone(start), 'iphone', t(1500), (d) => { d.settings.weightUnit = 'kg'; });
  const once = mergeDocs(mac, iph).doc;
  const twice = mergeDocs(once, iph).doc;
  check('running it again changes nothing', JSON.stringify(collectRecords(twice)), JSON.stringify(collectRecords(once)));
  check('both field edits survived', [once.settings.bodyweight, once.settings.weightUnit], [285, 'kg']);
  const other = mergeDocs(iph, mac).doc;
  check('same result from the other side', [other.settings.bodyweight, other.settings.weightUnit], [285, 'kg']);
}

section('a day deleted entirely, and days never invented');
{
  const start = stampAll(base(), 'mac', t(0));
  const mac = edit(clone(start), 'mac', t(1000), (d) => { delete d.days['2026-08-07']; });
  const iph = mergeDocs(clone(start), mac).doc;
  check('day is gone', Object.keys(iph.days), []);
  const back = mergeDocs(clone(mac), clone(start)).doc;
  check('stale copy does not restore the day', Object.keys(back.days), []);
}

section('pending count tracks unsynced work');
{
  const d = stampAll(base(), 'mac', t(0));
  check('nothing pending after a full push', pendingCount(d, t(0)), 0);
  edit(d, 'mac', t(1000), (x) => { x.settings.bodyweight = 280; });
  check('one record pending', pendingCount(d, t(0)), 1);
  edit(d, 'mac', t(1100), (x) => { x.days['2026-08-07'].entries.pop(); });
  check('deletion counts as pending too', pendingCount(d, t(0)), 2);
}

section('a first sync against an empty server keeps everything');
{
  const mac = stampAll(base(), 'mac', t(0));
  const res = mergeDocs(mac, { _sync: { v: 1, rec: {}, del: {} } });
  check('nothing pulled', res.pulled, 0);
  check('nothing deleted', res.deleted, 0);
  check('everything still here', collectRecords(res.doc).size, collectRecords(mac).size);
}

section('a fresh device against a populated server pulls it all');
{
  const server = stampAll(base(), 'mac', t(0));
  const fresh = { schema: 6, settings: {}, days: {}, measurements: [], _sync: { v: 1, rec: {}, del: {} } };
  const res = mergeDocs(fresh, server);
  check('pulled everything', collectRecords(res.doc).size, collectRecords(server).size);
  check('entries arrived', entriesOf(res.doc, '2026-08-07'), ['e1', 'e2']);
}

section('REGRESSION: every top-level data key must be syncable');
{
  // caseFile was absent from the record maps, so a phone that had never seen
  // it pushed a document without it and wiped the server's copy.
  const withCase = stampAll({
    ...base(),
    caseFile: { case: { legs: { left: { procedure: 'ACLR' } } }, timeline: [1, 2], hep: { label: 'x' } },
  }, 'mac', t(0));
  const keys = [...collectRecords(withCase).keys()];
  check('caseFile decomposes into records', keys.filter((k) => k.startsWith('k|')).sort(),
    ['k|case', 'k|hep', 'k|timeline']);

  // A phone with no clinical history must RECEIVE it, not erase it.
  const phone = { schema: 6, settings: {}, days: {}, measurements: [], _sync: { v: 1, rec: {}, del: {} } };
  const pulled = mergeDocs(phone, withCase).doc;
  check('phone receives the case file', !!pulled.caseFile?.case?.legs?.left, true);

  // …and pushing back from the phone must not remove it from the server.
  const server = mergeDocs(clone(withCase), pulled).doc;
  check('server keeps it after the phone pushes', !!server.caseFile?.case?.legs?.left, true);
  check('timeline survives too', server.caseFile.timeline, [1, 2]);
}

// Guard against the next one: anything at the top level of a real document
// that is neither metadata nor a registered collection is invisible to sync.
section('no unregistered top-level keys');
{
  const KNOWN = new Set([
    'schema', '_sync',                                   // metadata
    'settings', 'planGoals', 'planFocus', 'caseFile',    // key maps
    'melbourne', 'program',                              // sub maps
    'measurements', 'mrss', 'customExercises',           // id lists
    'days',                                              // days + entries
  ]);
  const doc = { ...base(), caseFile: {} };
  check('all top-level keys are registered', Object.keys(doc).filter((k) => !KNOWN.has(k)), []);
}

console.log('\n' + (fails.length ? `FAILURES: ${fails.join(', ')}` : 'ALL PASS'));
process.exit(fails.length ? 1 : 0);
