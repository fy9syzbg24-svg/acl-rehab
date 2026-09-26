// The clinician's exercise videos, for reference (his call, 22 Sep 2026).
//
// Reference only: a video never plays on its own and the workout player never
// starts one. A small, see-through play button sits over the step pictures;
// a tap swaps the picture for the video, and the picture comes back when it
// ends. Muted, so his music is never paused; the controls can unmute it.
//
// Private, like his songs (player/songs.js): the public shell holds no video,
// no picture of them and no names. The files and their index live in
//   Mac          data/media/video/, served by server.py (/api/videos, /media/video/)
//   iPhone/iPad  the PRIVATE sync repo's media/video/, downloaded the first time
//                one is played and kept in IndexedDB, so it plays offline after
// tools/add_videos.py puts them in both places, byte for byte.

import { SERVER_MODE } from './sync/local-store.js';
import { getConfig, isConfigured } from './sync/config.js';

const DB = 'rehab-media';
const STORE = 'files';
let index = null;          // [{ pid, name, file, bytes, sha, type, poster, posterType }]
let loading = null;
const urls = {};

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
const ghUrl = (c, path) => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${path}`;
const ghHeaders = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' });

/** Which program items have a video. Cached on a phone; a failure is retried next time. */
export function loadVideos() {
  if (index) return Promise.resolve(index);
  if (loading) return loading;
  loading = (async () => {
    try {
      if (SERVER_MODE) {
        const res = await fetch('/api/videos', { cache: 'no-store' });
        if (res.ok) index = (await res.json()).videos || [];
      } else {
        const cached = await idb('readonly', (st) => st.get('video-index')).catch(() => null);
        if (cached) index = cached;
        if (isConfigured() && navigator.onLine !== false) {
          const c = getConfig();
          const res = await fetch(ghUrl(c, 'media/video/index.json'), { headers: ghHeaders(c.token), cache: 'no-store' });
          if (res.ok) {
            index = (await res.json()).videos || [];
            idb('readwrite', (st) => st.put(index, 'video-index')).catch(() => {});
          }
        }
      }
    } catch { /* stays null: asked again next time */ }
    loading = null;
    return index || [];
  })();
  return loading;
}

export function videoFor(pid) { return (index || []).find((v) => v.pid === pid) || null; }

async function fileUrl(file, type, key) {
  if (urls[key]) return urls[key];
  if (SERVER_MODE) { urls[key] = `/media/video/${encodeURIComponent(file)}`; return urls[key]; }
  let blob = await idb('readonly', (s) => s.get(key)).catch(() => null);
  if (!blob) {
    if (!isConfigured()) return null;
    const c = getConfig();
    const res = await fetch(ghUrl(c, `media/video/${encodeURIComponent(file)}`), { headers: ghHeaders(c.token) });
    if (!res.ok) return null;
    blob = new Blob([await res.arrayBuffer()], { type });
    await idb('readwrite', (s) => s.put(blob, key)).catch(() => {});
  }
  urls[key] = URL.createObjectURL(blob);
  return urls[key];
}
export const videoUrl = (v) => fileUrl(v.file, v.type || 'video/mp4', `video:${v.sha}`);
export const posterUrl = (v) => (v.poster ? fileUrl(v.poster, v.posterType || 'image/jpeg', `poster:${v.sha}`) : Promise.resolve(null));

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

/**
 * The mark on a picture that has a video behind it (his call, 22 Sep): a small
 * see-through play circle in the centre, where the four frames meet, so it
 * covers none of them (a corner tag did). A mark only: a tap opens the pictures
 * like any other, and the video starts only from the play button there.
 */
export const VIDEO_TAG = `<span class="vid-tag" aria-hidden="true">${PLAY}</span>`;

/**
 * Put the play button over a picture. `box` holds `img`; the video takes the
 * picture's place while it plays and hands it back when it ends. `onPlaying`
 * lets a caller hide what does not apply to a video (the zoom).
 */
export function mountVideo(box, img, pid, { onPlaying = null, onDone = null } = {}) {
  const v = videoFor(pid);
  if (!v || !box || !img || box.querySelector('.vid-play')) return;
  box.classList.add('vid-box');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'vid-play';
  btn.setAttribute('aria-label', 'Play the video');
  btn.innerHTML = PLAY;
  box.appendChild(btn);
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (btn.classList.contains('loading')) return;
    btn.classList.add('loading');
    let src = null;
    try { src = await videoUrl(v); } catch { src = null; }
    btn.classList.remove('loading');
    if (!box.isConnected) return;
    if (!src) {
      btn.classList.add('failed');
      btn.setAttribute('aria-label', 'The video needs a connection the first time');
      btn.title = 'The video needs a connection the first time';
      return;
    }
    const vid = document.createElement('video');
    vid.className = 'vid-el';
    vid.muted = true;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    vid.controls = true;
    vid.preload = 'auto';
    vid.src = src;
    const shown = img.style.display;
    const back = () => {
      vid.pause();
      vid.remove();
      img.style.display = shown;
      btn.style.display = '';
      onDone?.();
    };
    vid.addEventListener('ended', back);
    vid.addEventListener('error', back);
    img.style.display = 'none';
    btn.style.display = 'none';
    img.after(vid);
    onPlaying?.();
    vid.play().catch(() => { /* the controls are there to start it */ });
  });
}

/** A picture box for an item whose only picture is the private one (clinic recordings). */
export async function fillPoster(img, pid) {
  const v = videoFor(pid);
  if (!v || !img) return;
  const src = await posterUrl(v).catch(() => null);
  if (src && img.isConnected) img.src = src;
}
