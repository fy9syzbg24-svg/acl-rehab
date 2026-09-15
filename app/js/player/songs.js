// His own music for paced work: a song he owns, played during the work bouts.
//
// Private, never public. The public shell (this repo, the published site)
// holds no audio and no song names. The files and their index live in:
//   Mac          data/media/ beside the data file, served by server.py
//   iPhone/iPad  the PRIVATE sync repo's media/ folder, downloaded once with
//                this device's own token and kept in IndexedDB, so it plays
//                with no connection after the first time
// tools/add_song.py puts a song in both places, byte for byte.
//
// Which song an exercise uses is a synced preference (program.timer[pid].song
// holds its sha256), so turning it on the phone turns it on everywhere.

import { SERVER_MODE } from '../sync/local-store.js';
import { getConfig, isConfigured } from '../sync/config.js';
import { setSession } from './audio.js';

const DB = 'rehab-media';
const STORE = 'files';
let index = null;         // [{ sha, name, bpm, bytes, type, file }]
let loading = null;
const urls = {};          // sha -> object URL or server path

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

function ghHeaders(token, raw = false) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}
const ghUrl = (c, path) => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;

/**
 * The songs this device can play. A successful answer is cached; a failed one
 * is not (F16): the next request tries again, at most every 20 seconds, and
 * the player says the list could not be loaded instead of "no songs".
 */
let indexError = false;
let lastFailAt = 0;
export function songsIndexFailed() { return indexError; }
export function loadSongs({ force = false } = {}) {
  if (index && !indexError && !force) return Promise.resolve(index);
  if (loading) return loading;
  if (indexError && !force && Date.now() - lastFailAt < 20000) return Promise.resolve(index || []);
  loading = (async () => {
    let ok = false;
    try {
      if (SERVER_MODE) {
        const res = await fetch('/api/media', { cache: 'no-store' });
        if (res.ok) { index = (await res.json()).songs || []; ok = true; }
      } else {
        // The index from the last time this device was online, then a fresh
        // one if it can reach the private repo.
        const cached = await idb('readonly', (st) => st.get('index')).catch(() => null);
        if (cached) { index = cached; ok = true; }
        if (isConfigured() && navigator.onLine !== false) {
          const c = getConfig();
          const res = await fetch(ghUrl(c, 'media/index.json'), { headers: ghHeaders(c.token, true), cache: 'no-store' });
          if (res.ok) {
            index = (await res.json()).songs || [];
            ok = true;
            idb('readwrite', (st) => st.put(index, 'index')).catch(() => {});
          }
        } else if (!cached && !isConfigured()) {
          index = []; ok = true;         // no sync on this device: genuinely none
        }
      }
    } catch { /* ok stays false */ }
    indexError = !ok;
    if (!ok) { lastFailAt = Date.now(); index = index || []; }
    loading = null;
    return index;
  })();
  return loading;
}
if (typeof window !== 'undefined') window.addEventListener('online', () => { if (indexError) loadSongs({ force: true }); });

export function songsNow() { return index || []; }
export function songBySha(sha) { return (index || []).find((s) => s.sha === sha) || null; }

/** A playable URL for a song, downloading it once on a phone. */
export async function songUrl(song) {
  if (!song) return null;
  if (urls[song.sha]) return urls[song.sha];
  if (SERVER_MODE) {
    urls[song.sha] = `/media/${encodeURIComponent(song.file)}`;
    return urls[song.sha];
  }
  let blob = await idb('readonly', (s) => s.get(song.sha)).catch(() => null);
  if (!blob) {
    if (!isConfigured()) return null;
    const c = getConfig();
    const res = await fetch(ghUrl(c, `media/${encodeURIComponent(song.file)}`), { headers: ghHeaders(c.token, true) });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    blob = new Blob([bytes], { type: song.type || 'audio/mp4' });
    await idb('readwrite', (s) => s.put(blob, song.sha)).catch(() => {});
  }
  urls[song.sha] = URL.createObjectURL(blob);
  return urls[song.sha];
}

// ------------------------------------------------------------ playback ----
// 2026-09-14 revision 3 (F07, F13, F14, F15):
//   - one audio element for the whole workout
//   - a queue of every song at the pace, played in a shuffled cycle: all of
//     them before any repeats, never the same track twice in a row when there
//     is a choice; one song loops. Skip moves to the next in the cycle.
//   - every preparation carries a generation number; a slower, older one that
//     finishes late can never change the track or start playback
//   - what he asked for (on) is kept apart from what is happening (loading,
//     playing, paused, blocked, error), so the screen never claims music that
//     is not playing
let el = null;
let current = null;
let queue = [];            // the songs at this pace
let cycle = [];            // shas in play order for this pass
let onTrack = null;
let playToken = 0;         // bumped by pause and stop: late starts are ignored
let prepGen = 0;           // bumped by every preparation: late loads are ignored
let wantPlaying = false;
let failures = 0;
let status = 'idle';       // idle | loading | playing | paused | blocked | error
const listeners = new Set();

export function onSongStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(st) {
  if (status === st) return;
  status = st;
  for (const fn of listeners) { try { fn(st); } catch { /* a listener's problem */ } }
}
export function songStatus() { return status; }
export function currentSong() { return (queue.find((x) => x.sha === current) || songBySha(current)) || null; }
export function queueInfo() {
  const i = cycle.indexOf(current);
  return { position: i >= 0 ? i + 1 : null, total: queue.length };
}

function audioEl() {
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.addEventListener('ended', () => { if (wantPlaying && queue.length > 1) advance(); });
    el.addEventListener('playing', () => { failures = 0; setStatus('playing'); });
    el.addEventListener('pause', () => { if (!wantPlaying) setStatus(current ? 'paused' : 'idle'); });
    el.addEventListener('error', () => {
      if (!current) return;
      failures++;
      // A broken file is skipped, but only once round the queue: never a loop.
      if (wantPlaying && queue.length > 1 && failures < queue.length) advance();
      else setStatus('error');
    });
  }
  return el;
}

function shuffle(list, avoidFirst) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.length > 1 && a[0] === avoidFirst) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

/**
 * The songs this exercise may play. Keeps the current cycle when the pool is
 * the same, so moving between exercises at one pace carries on the order.
 */
export function setQueue(pool, trackListener = null) {
  const a = audioEl();
  const next = (pool || []).filter(Boolean);
  const same = next.length === queue.length && next.every((x) => queue.some((q) => q.sha === x.sha));
  queue = next;
  onTrack = trackListener;
  if (!same) cycle = shuffle(queue.map((x) => x.sha), current);
  a.loop = queue.length < 2;
}
// The earlier name, kept for callers that pass null to mean one looping track.
export function setContinuous(pool, trackListener = null) { setQueue(pool || [], trackListener); }

/** The next song in the cycle after the current one, reshuffling at the end. */
export function nextInCycle() {
  if (!queue.length) return null;
  let i = cycle.indexOf(current);
  if (i < 0 || i + 1 >= cycle.length) {
    if (i >= 0) cycle = shuffle(queue.map((x) => x.sha), current);
    i = -1;
  }
  const sha = cycle[i + 1] ?? cycle[0];
  return queue.find((x) => x.sha === sha) || null;
}

async function advance() {
  const song = nextInCycle();
  if (!song) return false;
  const token = playToken;
  const ok = await prepareSong(song, 0);
  if (!ok || token !== playToken || !wantPlaying) return false;
  onTrack?.(song);
  playSong(true);
  return true;
}

/** Skip to the next track now. Plays it if music was playing. */
export async function skipSong() {
  const was = wantPlaying;
  const song = nextInCycle();
  if (!song) return null;
  const ok = await prepareSong(song, 0);
  if (!ok) { setStatus('error'); return null; }
  onTrack?.(song);
  if (was) playSong(true);
  return song;
}

/**
 * Call from a tap. iOS only lets a page start media from a gesture, so the
 * first tap plays and immediately pauses the element; later starts from the
 * timer are then allowed.
 */
export function primeSong() {
  const a = audioEl();
  if (!a.src || !a.paused) return;
  a.muted = true;
  const p = a.play();
  const done = () => { if (!wantPlaying) a.pause(); a.muted = false; };
  if (p && p.then) p.then(done).catch(() => { a.muted = false; });
  else done();
}

export function playTokenNow() { return playToken; }

/** Load a song (no playback yet). Resolves true when it is ready; false if stale or failed. */
export async function prepareSong(song, position = 0) {
  if (!song) return false;
  const a = audioEl();
  const gen = ++prepGen;
  if (current !== song.sha) {
    setStatus('loading');
    let url = null;
    try { url = await songUrl(song); } catch { url = null; }
    // A newer request arrived while this one was downloading: leave it be.
    if (gen !== prepGen) return false;
    if (!url) { setStatus('error'); return false; }
    a.src = url;
    current = song.sha;
    try { a.currentTime = position || 0; } catch { /* set once metadata loads */ }
    a.addEventListener('loadedmetadata', () => {
      if (gen !== prepGen) return;
      try { if (position) a.currentTime = position; } catch { /* ignore */ }
    }, { once: true });
    if (!wantPlaying) setStatus('paused');
  }
  return gen === prepGen;
}

export function playSong(force = false) {
  wantPlaying = true;
  const a = audioEl();
  if (!a.src || (!a.paused && !force)) return;
  setSession('song');
  const p = a.play();
  if (p && p.catch) p.catch(() => { if (wantPlaying) setStatus('blocked'); });
}

export function pauseSong() {
  playToken++;
  wantPlaying = false;
  if (el && !el.paused) el.pause();
  if (current) setStatus('paused');
  setSession('cues');
}

export function songPosition() { return el ? el.currentTime : 0; }
export function songWanted() { return wantPlaying; }

export function stopSong() {
  pauseSong();
  if (el) { try { el.currentTime = 0; } catch { /* ignore */ } }
}
