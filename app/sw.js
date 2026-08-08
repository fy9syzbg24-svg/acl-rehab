// Service worker — the thing that makes the installed PWA launch with no
// network at all.
//
// Two caches, on purpose:
//
//   SHELL  every file needed to BOOT. Precached at install, served
//          cache-first. Nothing in here may ever be fetched from the network
//          at startup, or Airplane Mode would show a blank screen.
//   MEDIA  exercise photos. Cached lazily the first time each is displayed,
//          because precaching 9MB of images would make install slow and is
//          not needed to launch.
//
// Deliberately NOT cached: /api/* (the Mac's local server) and api.github.com
// (sync). Those are live data and must never be served stale.
//
// Bump SHELL_VERSION on deploy; the new worker precaches the new shell, then
// deletes old caches on activate. Local data lives in IndexedDB and is never
// touched by any of this, so an app update cannot lose your log.

const SHELL_VERSION = 'v1';
const SHELL = `shell-${SHELL_VERSION}`;
const MEDIA = 'media-v1';

// Every module the app imports, listed explicitly. A missing entry here is the
// classic cause of "works online, blank offline", so this is exhaustive.
const SHELL_ASSETS = [
  './',
  './m.html',
  './index.html',
  './manifest.webmanifest',
  './styles.css',
  './mobile.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',

  './js/mobile.js',
  './js/app.js',
  './js/store.js',
  './js/util.js',
  './js/components.js',
  './js/insights.js',
  './js/views/today.js',
  './js/views/program.js',
  './js/views/planview.js',
  './js/views/melbourneview.js',
  './js/views/progress.js',
  './js/views/settings.js',
  './js/views/measures.js',
  './js/views/week.js',
  './js/views/monthboard.js',
  './js/views/journey.js',
  './js/sync/records.js',
  './js/sync/merge.js',
  './js/sync/config.js',
  './js/sync/idb.js',
  './js/sync/local-store.js',
  './js/sync/github.js',
  './js/sync/engine.js',

  './data/history.js',
  './data/plan.js',
  './data/exercises.js',
  './data/measurements.js',
  './data/program.js',
  './data/melbourne.js',
  './data/questionnaires.js',
  './data/icons.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll is atomic-ish but fails the whole install on one bad URL; add
    // individually so a single missing optional asset cannot block install.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch { /* logged by the caller's install failure if it matters */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === SHELL || k === MEDIA ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

const isMedia = (url) => /\/img\//.test(url.pathname) || /\.(png|jpe?g|webp|svg)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Live data: never cache, never intercept.
  if (url.origin !== self.location.origin) return;           // api.github.com etc.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: serve the app shell from cache so launching offline works,
  // whatever the URL/hash was.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      // Prefer the page actually asked for; only fall back to the mobile
      // shell. Answering every navigation with m.html would mean any other
      // page on this origin could never be reached.
      const exact = await cache.match(req, { ignoreSearch: true });
      if (exact) return exact;
      try {
        return await fetch(req);
      } catch {
        const shell = (await cache.match('./m.html')) || (await cache.match('./'));
        return shell || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Photos: cache on first view, then serve from cache forever.
  if (isMedia(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(MEDIA);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Everything else (code, styles, data modules): cache-first — this is what
  // guarantees a cold offline launch — with a background refresh when online.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) await cache.put(req, fresh);
        } catch { /* offline: keep the cached copy */ }
      })());
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return new Response('Offline', { status: 503 });
    }
  })());
});
