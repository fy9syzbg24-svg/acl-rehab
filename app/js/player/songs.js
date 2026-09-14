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

/** The songs this device can play. Cached after the first answer. */
export function loadSongs() {
  if (index) return Promise.resolve(index);
  if (loading) return loading;
  loading = (async () => {
    try {
      if (SERVER_MODE) {
        const res = await fetch('/api/media', { cache: 'no-store' });
        index = res.ok ? ((await res.json()).songs || []) : [];
      } else {
        // The index from the last time this device was online, then a fresh
        // one if it can reach the private repo.
        index = (await idb('readonly', (s) => s.get('index')).catch(() => null)) || [];
        if (isConfigured() && navigator.onLine !== false) {
          const c = getConfig();
          const res = await fetch(ghUrl(c, 'media/index.json'), { headers: ghHeaders(c.token, true), cache: 'no-store' });
          if (res.ok) {
            index = (await res.json()).songs || [];
            idb('readwrite', (s) => s.put(index, 'index')).catch(() => {});
          }
        }
      }
    } catch {
      index = index || [];
    }
    loading = null;
    return index;
  })();
  return loading;
}

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
let el = null;
let current = null;

function audioEl() {
  if (!el) {
    el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
  }
  return el;
}

/**
 * Call from a tap. iOS only lets a page start media from a gesture, so the
 * first tap plays and immediately pauses the element; later starts from the
 * timer are then allowed.
 */
export function primeSong() {
  const a = audioEl();
  if (!a.src || !a.paused) return;
  // Muted for the instant it takes, so priming never makes a sound.
  a.muted = true;
  const p = a.play();
  const done = () => { if (!wantPlaying) a.pause(); a.muted = false; };
  if (p && p.then) p.then(done).catch(() => { a.muted = false; });
  else done();
}

let wantPlaying = false;

/** Load a song (no playback yet). Resolves true when it is ready to play. */
export async function prepareSong(song, position = 0) {
  if (!song) return false;
  const a = audioEl();
  if (current !== song.sha) {
    const url = await songUrl(song);
    if (!url) return false;
    a.src = url;
    current = song.sha;
    try { a.currentTime = position || 0; } catch { /* set once metadata loads */ }
    a.addEventListener('loadedmetadata', () => { try { if (position) a.currentTime = position; } catch { /* ignore */ } }, { once: true });
  }
  return true;
}

export function playSong() {
  wantPlaying = true;
  const a = audioEl();
  if (!a.src || !a.paused) return;
  a.play().catch(() => {});
}

export function pauseSong() {
  wantPlaying = false;
  if (el && !el.paused) el.pause();
}

export function songPosition() { return el ? el.currentTime : 0; }

export function stopSong() {
  pauseSong();
  if (el) { try { el.currentTime = 0; } catch { /* ignore */ } }
}
