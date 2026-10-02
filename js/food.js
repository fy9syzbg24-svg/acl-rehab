// His Lose It food log, one row per day, read only, never part of the record
// (his ask, 2026-09-28: a sync button on Cravings that fetches Lose It, and on
// the iPhone has the Mac do it).
//
// The same shape as the ring layer (ring.js): tools/loseit/loseit.py builds a
// summary on the Mac, this Mac's server serves it at /api/loseit, and the relay
// holds loseit.json for the phone and iPad. Three routes, in that order, then
// this device's last copy for offline.

import { getConfig, isConfigured } from './sync/config.js';
import { ghGetPath, ghPutFile } from './sync/github.js';
import { SERVER_MODE } from './sync/local-store.js';

const SHAPE = 1;
const LS_KEY = 'rehab.food.cache';
const REMOTE = 'loseit.json';
const REQUEST = 'loseit-request.json';
const STATUS = 'loseit-status.json';
let askedAt = null;      // this device's last request, to match the Mac's answer
let waitingNow = false;
export const foodWaiting = () => waitingNow;
export const FOOD_MAC_MINUTES = 5;

let food = null;
let byDay = null;
let loading = null;

export const foodReady = () => !!food;
export const foodBuiltAt = () => food?.builtAt || null;
export function foodFor(iso) {
  if (!food) return null;
  if (!byDay) byDay = new Map(food.days.map((d) => [d.day, d]));
  return byDay.get(iso) || null;
}
export const newestFoodDay = () => (food?.days.length ? food.days[food.days.length - 1].day : null);

function accept(p) {
  if (!p || !(p.v >= 1 && p.v <= SHAPE) || !Array.isArray(p.days)) return false;
  food = { ...p, days: p.days.slice().sort((a, b) => a.day.localeCompare(b.day)) };
  byDay = null;
  return true;
}
function readCache() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } }
function writeCache(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* re-fetchable */ } }

/** Load the layer. Never throws; on failure there is simply no food shown. */
export function loadFood() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const r = await fetch('/api/loseit', { cache: 'no-store' });
      if (r.ok && accept(await r.json())) { writeCache(food); return true; }
    } catch { /* not the Mac */ }
    if (isConfigured()) {
      try {
        const c = getConfig();
        const got = await ghGetPath({ owner: c.owner, repo: c.repo, token: c.token, path: REMOTE });
        if (got.doc && accept(got.doc)) { writeCache(food); return true; }
      } catch { /* offline, or not built yet */ }
    }
    return accept(readCache());
  })();
  return loading;
}
function reload() { loading = null; return loadFood(); }

async function askMac() {
  if (!isConfigured()) return false;
  const c = getConfig();
  const conn = { owner: c.owner, repo: c.repo, token: c.token, path: REQUEST };
  let sha = null;
  try { sha = (await ghGetPath(conn)).sha; } catch { /* first time */ }
  let by = 'a device';
  try { by = localStorage.getItem('rehab.deviceId') || by; } catch { /* ignore */ }
  const at = new Date().toISOString();
  try { await ghPutFile(conn, { at, by }, sha, 'lose it: fetch requested'); askedAt = at; return true; } catch { return false; }
}

/**
 * The one action behind the sync button. On the Mac: fetch Lose It now. Anywhere
 * else: ask the Mac (answered within about five minutes) and reread the relay.
 * Returns { ok, server, asked, changed, message, signin }. Never throws.
 */
export async function syncFood() {
  const was = foodBuiltAt();
  let asked = false;
  if (SERVER_MODE) {
    let out = {};
    try {
      const r = await fetch('/api/loseit/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      out = await r.json();
    } catch { out = { ok: false, message: 'The Mac server did not answer.' }; }
    if (!out.ok) return { ok: false, server: true, signin: !!out.signin, message: out.message || 'Lose It did not answer.' };
  } else {
    asked = await askMac();
  }
  await reload();
  return { ok: true, server: SERVER_MODE, asked, changed: foodBuiltAt() !== was };
}

async function readStatus() {
  if (!isConfigured()) return null;
  try {
    const c = getConfig();
    return (await ghGetPath({ owner: c.owner, repo: c.repo, token: c.token, path: STATUS })).doc || null;
  } catch { return null; }
}

/**
 * Wait for the Mac's answer to this device's request, without holding a button
 * down: rereads every 30 s. Calls onDone({ ok, message }) exactly once: when new
 * food lands, when the Mac reports a failure, or when the Mac's window passes
 * with no answer (his ask, 2026-09-28: confirmation on the iPhone either way).
 */
let waiting = null;
export function waitForFood(onDone) {
  const was = foodBuiltAt();
  const mine = askedAt;
  const until = Date.now() + (FOOD_MAC_MINUTES + 2) * 60000;
  clearTimeout(waiting);
  waitingNow = true;
  const finish = (out) => { waiting = null; waitingNow = false; onDone(out); };
  const look = async () => {
    await reload();
    if (foodBuiltAt() !== was) { finish({ ok: true, message: 'Lose It updated' }); return; }
    const st = await readStatus();
    if (st && mine && st.at === mine) { finish({ ok: !!st.ok, message: st.message || '' }); return; }
    if (Date.now() > until) { finish({ ok: false, message: 'No answer from the Mac. Is it asleep or off?' }); return; }
    waiting = setTimeout(look, 30000);
  };
  waiting = setTimeout(look, 30000);
}
