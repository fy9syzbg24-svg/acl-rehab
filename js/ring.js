// The ring layer: one row per night, read only, never part of the record.
//
// Where it comes from: a small summary file built on the Mac from the local
// cache and put in the private sync repo. Three routes are tried in order, so
// every device has one that works: the Mac's own server, the relay (the phone
// and iPad), then this device's last copy for offline.
//
// Why it is not in the synced document: it is derived data the owner never
// edits. Keeping it out means no sync registration, no merge, no stamps, and
// nothing a device running older code can wipe. `store.js` refuses to persist a
// document that carries any of it.
//
// Everything below the loader is plain arithmetic over the nights, so a number
// on screen can always be traced to the rows it came from. No thresholds are
// baked in beyond the ones named here.

import { getConfig, isConfigured } from './sync/config.js';
import { ghGetPath, ghPutFile } from './sync/github.js';
import { SERVER_MODE } from './sync/local-store.js';
import { fmtDateShort, toIso } from './util.js';

// 1: the nightly fields. 2: adds the stage string for every night and the
// movement string for recent ones. An older cache still loads; the night
// detail simply has nothing to draw.
const SHAPE = 2;
const LS_KEY = 'rehab.ring.cache';
const REMOTE = 'oura.json';

// A night this far from his own recent pattern, or this short, is the thing the
// two markers measure. Both come from his own history, not from a guideline:
// bedtime steadiness and sleep debt were the two relationships that held in
// both halves of his year.
export const SLEEP_TARGET_H = 7;
export const STEADY_WINDOW = 14;   // nights the rolling bedtime median reads
export const DEBT_NIGHTS = 3;      // nights sleep debt accumulates over
export const HOME_OFFSETS = [-5, -4];

let ring = null;
let loading = null;
let settled = false;
let source = null;

/** Nights, oldest first. Empty when nothing has loaded. */
export function ringNights() {
  return ring?.nights || [];
}

export function ringReady() {
  return !!(ring && ring.nights && ring.nights.length);
}

/**
 * Has the load finished, either way? Every route is async, including this
 * device's own cache, so the first paint of the app always sees no ring. A
 * surface that would otherwise say "nothing here" waits for this instead of
 * flashing that sentence and correcting itself a moment later.
 */
export function ringSettled() {
  return settled;
}

export function ringBuiltAt() {
  return ring?.builtAt || null;
}

/** Which of the three routes the rows on screen came from, or null. */
export function ringSource() {
  return source;
}

/**
 * Load it again from scratch, for the button in Settings. On the Mac that is
 * the copy its own server serves, which the pull rewrites; everywhere else it
 * is the relay, which is how a phone picks up what the Mac last uploaded.
 */
export function refreshRing() {
  loading = null;
  settled = false;
  return loadRing();
}

function accept(payload) {
  if (!payload || !(payload.v >= 1 && payload.v <= SHAPE) || !Array.isArray(payload.nights)) return false;
  ring = { ...payload, nights: payload.nights.slice().sort((a, b) => a.day.localeCompare(b.day)) };
  byDay = null;
  return true;
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {
    return null;   // private mode, cleared data, or a quota error: no ring data is fine
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* the summary is always re-fetchable, so a failed cache is not an error */
  }
}

/**
 * Load the ring layer. Never throws and never blocks startup: on any failure
 * the app simply has no ring data and every surface that uses it stays hidden.
 * Returns true if something loaded.
 */
export function loadRing() {
  if (loading) return loading;
  loading = (async () => {
    // 1. This Mac's own server. Instant, needs no token, 404 everywhere else.
    try {
      const r = await fetch('/api/oura', { cache: 'no-store' });
      if (r.ok && accept(await r.json())) { source = 'server'; writeCache(ring); return true; }
    } catch { /* not the Mac, or the server is not running */ }
    // 2. The relay, which is how the phone and iPad get it.
    if (isConfigured()) {
      try {
        const c = getConfig();
        const got = await ghGetPath({ owner: c.owner, repo: c.repo, token: c.token, path: REMOTE });
        if (got.doc && accept(got.doc)) { source = 'relay'; writeCache(ring); return true; }
      } catch { /* offline, or the summary has not been built yet */ }
    }
    // 3. Whatever this device saw last, so it works with no network.
    if (accept(readCache())) { source = 'cache'; return true; }
    return false;
  })().finally(() => { settled = true; });
  return loading;
}


const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The weekday of a plain date, read at midday so no time zone can shift it. */
export function weekdayOf(iso, short = false) {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return short ? WD[d.getDay()].slice(0, 3) : WD[d.getDay()];
}

/**
 * Which night a row is, in words. Oura dates a night by the morning it ends,
 * so "Sep 21" is the night he woke up on the 21st, and the evening it started
 * was usually the day before. He asked for that said out loud rather than
 * worked out (2026-09-22): "Sat night into Sun morning".
 *
 * The evening comes from the bedtime itself, kept in its own time zone, so a
 * night he went to bed before midnight reads correctly too.
 */
export function nightSpan(n, short = false) {
  if (!n) return '';
  const bed = typeof n === 'string' ? null : n.bed;
  const wake = typeof n === 'string' ? n : (n.bedEnd || n.day);
  const wakeDay = String(wake).slice(0, 10);
  let evening = wakeDay;
  if (bed) {
    const hour = Number(/T(\d{2})/.exec(bed)?.[1]);
    const bedDay = bed.slice(0, 10);
    // Before 5am is still the night before, the same line the rest of the app
    // draws its day at. A sleep that starts later in the morning is its own
    // morning and reads as one.
    if (hour >= 5 && hour < 12) evening = wakeDay;
    else evening = hour < 5 ? shiftIso(bedDay, -1) : bedDay;
  } else {
    evening = shiftIso(wakeDay, -1);
  }
  const a = weekdayOf(evening, short);
  const b = weekdayOf(wakeDay, short);
  if (!a || !b) return '';
  return a === b ? `${b} morning` : `${a} night into ${b} morning`;
}

function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

const REQUEST = 'oura-request.json';
// How long the Mac can take to notice a request: the job that answers it runs
// every 300 s (com.reuben.acl-rehab-reminders, which calls tools/oura/request.py).
export const MAC_FETCH_MINUTES = 5;

/**
 * Ask the Mac to fetch from Oura, from a device that cannot.
 *
 * Only the Mac holds the Oura tokens, so a phone can do nothing with Oura
 * itself. It leaves a request in the private repo instead; the Mac answers it
 * within about five minutes and uploads the new summary the ordinary way. His
 * words on the day the button misled him: "that sync button should be
 * requesting the data from oura again?"
 *
 * Best effort, and never fatal: if it cannot be written, the sync still returns
 * whatever the relay holds.
 */
async function askMacToFetch() {
  if (!isConfigured()) return false;
  const c = getConfig();
  const conn = { owner: c.owner, repo: c.repo, token: c.token, path: REQUEST };
  let sha = null;
  try {
    sha = (await ghGetPath(conn)).sha;
  } catch { /* not there yet, which is the normal first time */ }
  try {
    await ghPutFile(conn, { at: new Date().toISOString(), by: deviceLabel() },
      sha, 'ring: fetch requested');
    return true;
  } catch {
    return false;
  }
}

function deviceLabel() {
  try {
    return localStorage.getItem('rehab.deviceId') || 'a device';
  } catch {
    return 'a device';
  }
}

/**
 * The one action behind every "sync the ring" button, so the header and
 * Settings cannot drift apart.
 *
 * On the Mac it runs the same pull the noon job runs and then rereads the file
 * its own server holds. Anywhere else it asks the Mac to fetch (above) and
 * rereads the relay, which is where the Mac puts what it fetched.
 *
 * Returns { ok, newest, changed, asked, message, server }. It never throws.
 */
export async function syncRing() {
  const was = lastNight()?.day || null;
  let message = '';
  let asked = false;
  if (SERVER_MODE) {
    let out = {};
    try {
      const r = await fetch('/api/oura/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      out = await r.json();
    } catch {
      out = { ok: false, message: 'The Mac server did not answer.' };
    }
    if (!out.ok) return { ok: false, server: true, asked: false, newest: was, changed: false, message: out.message || 'Oura did not answer.' };
    if ((out.trouble || []).length) message = out.trouble.join(' · ');
  } else {
    asked = await askMacToFetch();
  }
  await refreshRing();
  const newest = lastNight()?.day || null;
  return { ok: true, server: SERVER_MODE, asked, newest, changed: newest !== was, message };
}

/**
 * What to say after a sync, in one place so the page and Settings never differ.
 * The phone must never say "up to date": it did not ask Oura anything, and
 * saying so once cost him a morning wondering where last night went.
 */
export function syncWords(out) {
  const night = out.newest ? `Newest night ${fmtDateShort(out.newest)}` : 'No nights yet';
  if (out.server) {
    return out.changed
      ? { title: 'Ring updated', body: night }
      : { title: 'Nothing new from Oura', body: `${night}. Your ring uploads when you open the Oura app.` };
  }
  if (out.changed) return { title: 'Ring updated', body: night };
  if (out.asked) {
    return { title: 'Asked the Mac to fetch',
      body: `Only the Mac can talk to Oura. New nights land here within about ${MAC_FETCH_MINUTES} minutes, and this page updates itself. ${night}.` };
  }
  return { title: 'Got what the Mac has',
    body: `${night}. Connect device sync so this can ask the Mac to fetch.` };
}

/**
 * Watch the relay for the answer to a request, without holding a button down.
 * Rereads every WAIT_EVERY until the newest night moves or the Mac's window
 * has passed. `onArrive` is called once, with the new newest night.
 */
const WAIT_EVERY = 45000;
let waiting = null;
export function waitForMac(onArrive) {
  const was = lastNight()?.day || null;
  const until = Date.now() + (MAC_FETCH_MINUTES + 2) * 60000;
  clearTimeout(waiting);
  const look = async () => {
    if (Date.now() > until) { waiting = null; return; }
    await refreshRing();
    const now = lastNight()?.day || null;
    if (now && now !== was) { waiting = null; onArrive(now); return; }
    waiting = setTimeout(look, WAIT_EVERY);
  };
  waiting = setTimeout(look, WAIT_EVERY);
}

let byDay = null;
function index() {
  if (!byDay) byDay = Object.fromEntries(ringNights().map((n) => [n.day, n]));
  return byDay;
}

export function nightFor(iso) {
  return index()[iso] || null;
}

export function lastNight() {
  const ns = ringNights();
  return ns.length ? ns[ns.length - 1] : null;
}

/**
 * Bedtime as a clock hour, with after-midnight read as a continuation of the
 * evening (01:30 is 25.5), because that is how the distance between two of his
 * bedtimes should read. Null when the night has no bedtime.
 */
export function bedHour(n) {
  if (!n || !n.bed) return null;
  const m = /T(\d{2}):(\d{2})/.exec(n.bed);
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  return h < 12 ? h + 24 : h;
}

/** The time zone offset the ring recorded, in hours, or null. */
export function bedOffset(n) {
  const m = n && n.bed && /([+-])(\d{2}):(\d{2})$/.exec(n.bed);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
}

/** True when that night was slept in another time zone. */
export function awayNight(n) {
  const o = bedOffset(n);
  return o != null && !HOME_OFFSETS.includes(o);
}

export function ringMedian(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
}

/**
 * How far a night's bedtime sat from his own recent pattern, in hours. The
 * pattern is the median of the previous STEADY_WINDOW nights, so it follows him
 * rather than holding him to a fixed hour. Null until there are enough nights.
 */
export function bedSwing(iso) {
  const ns = ringNights();
  const i = ns.findIndex((n) => n.day === iso);
  if (i < 0) return null;
  const here = bedHour(ns[i]);
  if (here == null) return null;
  const prior = ns.slice(Math.max(0, i - STEADY_WINDOW), i).map(bedHour).filter((h) => h != null);
  if (prior.length < 5) return null;
  return Math.abs(here - ringMedian(prior));
}

/** Hours of sleep owed over the previous DEBT_NIGHTS nights, against the target. */
export function sleepDebt(iso) {
  const idx = index();
  let debt = 0;
  let seen = 0;
  const d = new Date(`${iso}T12:00:00`);
  for (let k = 1; k <= DEBT_NIGHTS; k++) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - k);
    const n = idx[toIso(prev)];
    if (n && Number.isFinite(n.sleepH)) { debt += Math.max(0, SLEEP_TARGET_H - n.sleepH); seen++; }
  }
  return seen >= 2 ? debt : null;
}

/** The last `days` nights, newest last. */
export function recentNights(days = 14, endIso = null) {
  const ns = ringNights();
  if (!ns.length) return [];
  const end = endIso || ns[ns.length - 1].day;
  const from = new Date(`${end}T12:00:00`);
  from.setDate(from.getDate() - (days - 1));
  const fromIso = toIso(from);
  return ns.filter((n) => n.day >= fromIso && n.day <= end);
}

/**
 * Bedtime steadiness over a window: the median swing off his own pattern. A
 * smaller number is steadier. Returns null until the window has enough nights.
 */
export function steadiness(days = STEADY_WINDOW) {
  const xs = recentNights(days).map((n) => bedSwing(n.day)).filter((x) => x != null);
  return xs.length >= 5 ? { hours: ringMedian(xs), n: xs.length } : null;
}

/** Nights at or above the sleep target inside a window. */
export function sleepAbove(hours = SLEEP_TARGET_H, days = STEADY_WINDOW, endIso = null) {
  const xs = recentNights(days, endIso).filter((n) => Number.isFinite(n.sleepH));
  if (!xs.length) return null;
  return { hit: xs.filter((n) => n.sleepH >= hours).length, n: xs.length };
}

/** Median of one field over a window, ignoring missing values. */
export function windowMedian(key, days = 30, endIso = null) {
  return ringMedian(recentNights(days, endIso).map((n) => n[key]));
}

/** Medians by calendar month, oldest first: [{ month, n, ...keys }]. */
export function monthly(keys) {
  const by = {};
  for (const n of ringNights()) {
    const m = n.day.slice(0, 7);
    (by[m] ||= []).push(n);
  }
  return Object.keys(by).sort().map((m) => {
    const out = { month: m, n: by[m].length, away: by[m].filter(awayNight).length };
    for (const k of keys) out[k] = ringMedian(by[m].map((x) => x[k]));
    return out;
  });
}

/** Everything the layer holds for one field, as [{ day, value }], for a chart. */
export function series(key, { from = null, to = null } = {}) {
  return ringNights()
    .filter((n) => Number.isFinite(n[key]) && (!from || n.day >= from) && (!to || n.day <= to))
    .map((n) => ({ day: n.day, value: n[key], away: awayNight(n), rest: !!n.restMode }));
}

/**
 * The night of an injection against the rest of its own cycle.
 *
 * Measured on his own data rather than stated as a fact, so it stays current as
 * he logs more. Nights 0 to 2 of a cycle are compared with night 3 onward, one
 * pair per cycle, and the interval is the ordinary one for a mean of paired
 * differences. Returns null until there are enough cycles to say anything.
 *
 * What it is for: answering whether the shot night itself changes anything.
 * Two measures moved and sleep did not, which is worth stating plainly.
 */
export function shotNightEffect(shots, keys = ['tempDev', 'breath', 'sleepH', 'sleepScore']) {
  const ts = (shots || [])
    .filter((s) => s && s.at && s.mg > 0 && !s.removed)   // a removed shot is not a dose (2026-09-22)
    .map((s) => ({ t: Date.parse(s.at), known: !!s.timeKnown }))
    .filter((s) => Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
  if (ts.length < 4) return null;
  const ns = ringNights().filter((n) => n.bed);
  const pairs = Object.fromEntries(keys.map((k) => [k, []]));
  let cycles = 0;
  for (let i = 0; i < ts.length; i++) {
    const from = ts[i].t;
    const to = i + 1 < ts.length ? ts[i + 1].t : from + 30 * 864e5;
    const seq = ns.filter((n) => { const b = Date.parse(n.bed); return b > from && b < to; });
    if (seq.length < 4) continue;
    const head = seq.slice(0, 1);
    const tail = seq.slice(3);
    if (!tail.length) continue;
    cycles++;
    for (const k of keys) {
      const a = ringMedian(head.map((n) => n[k]));
      const b = ringMedian(tail.map((n) => n[k]));
      if (a != null && b != null) pairs[k].push(a - b);
    }
  }
  if (cycles < 4) return null;
  const out = { cycles, keys: {} };
  for (const k of keys) {
    const d = pairs[k];
    if (d.length < 4) continue;
    const mean = d.reduce((s, x) => s + x, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (d.length - 1));
    const se = sd / Math.sqrt(d.length);
    out.keys[k] = { diff: mean, lo: mean - 1.645 * se, hi: mean + 1.645 * se, n: d.length,
      clears: (mean - 1.645 * se > 0) || (mean + 1.645 * se < 0) };
  }
  return out;
}

/** True if a document carries anything from this layer (it must never). */
export function carriesRing(doc) {
  return !!(doc && (doc.ring || doc.oura));
}

// --------------------------------------------------------- a night in detail --

/** Oura's own stage codes, in the order a hypnogram stacks them. */
export const STAGES = [
  { code: '4', id: 'awake', label: 'Awake' },
  { code: '3', id: 'rem', label: 'REM' },
  { code: '2', id: 'light', label: 'Light' },
  { code: '1', id: 'deep', label: 'Deep' },
];
const STAGE_BY_CODE = Object.fromEntries(STAGES.map((s, i) => [s.code, { ...s, lane: i }]));

/**
 * A night's stage string as runs: [{ id, lane, from, to }] in minutes from
 * bedtime. Each character is five minutes, which is what Oura publishes.
 * Returns null when that night has no stage string.
 */
export function phaseRuns(n) {
  const str = n && n.phases;
  if (!str) return null;
  const out = [];
  let i = 0;
  while (i < str.length) {
    const c = str[i];
    let j = i;
    while (j < str.length && str[j] === c) j++;
    const s = STAGE_BY_CODE[c];
    if (s) out.push({ id: s.id, label: s.label, lane: s.lane, from: i * 5, to: j * 5 });
    i = j;
  }
  return out.length ? out : null;
}

/** Minutes the night ran, from the stage string if there is one, else the clock. */
export function nightMinutes(n) {
  if (n && n.phases) return n.phases.length * 5;
  if (n && n.bed && n.bedEnd) return Math.max(0, (Date.parse(n.bedEnd) - Date.parse(n.bed)) / 60000);
  return 0;
}

/** Movement as levels 1 to 4, one per 30 seconds, or null. */
export function movementLevels(n) {
  const str = n && n.movement;
  if (!str) return null;
  return [...str].map((c) => Number(c) || 0);
}

/** Minutes in each stage for one night, from its own stage string. */
export function stageMinutes(n) {
  const runs = phaseRuns(n);
  if (!runs) return null;
  const out = { awake: 0, rem: 0, light: 0, deep: 0 };
  for (const r of runs) out[r.id] += r.to - r.from;
  return out;
}

/** The night before or after a given day that has a reading. */
export function stepNight(iso, dir) {
  const ns = ringNights();
  const i = ns.findIndex((n) => n.day === iso);
  if (i < 0) return null;
  const j = i + (dir < 0 ? -1 : 1);
  return j >= 0 && j < ns.length ? ns[j] : null;
}

/** "Your temperature and breathing move. How long and how well you sleep do not.", from the data. */
export function shotSentence(moved, same) {
  const phrase = (rs) => {
    const yours = rs.filter((r) => r.word).map((r) => r.word);
    const how = rs.filter((r) => r.how).map((r) => r.how);
    const parts = [];
    if (yours.length) parts.push(`your ${yours.join(' and ')}`);
    if (how.length) parts.push(`how ${how.join(' and how ')} you sleep`);
    const text = parts.join(', and ');
    return { text: text.charAt(0).toUpperCase() + text.slice(1), many: yours.length + how.length > 1 };
  };
  const out = [];
  if (moved.length) { const p = phrase(moved); out.push(`${p.text} ${p.many ? 'move' : 'moves'}.`); }
  if (same.length) { const p = phrase(same); out.push(`${p.text} ${p.many ? 'do' : 'does'} not.`); }
  return out.join(' ');
}
