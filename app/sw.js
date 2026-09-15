// Service worker: the thing that makes the installed PWA launch with no
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
// 2026-09-15 (audit A18): named for this app. The Fringe Planner lives on the
// same github.io origin, and cache storage is per origin, so a bare "shell-"
// name was one clean-up away from deleting another app's offline copy (or
// having ours deleted). Only caches with our prefix, or our own old names,
// are ever touched.
const PREFIX = 'acl-rehab-';
const SHELL = `${PREFIX}shell-${SHELL_VERSION}`;
const MEDIA = `${PREFIX}media-v1`;
const LEGACY_MEDIA = 'media-v1';
const ours = (k) => k.startsWith(PREFIX) || k.startsWith('shell-') || k === LEGACY_MEDIA;

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
  './img/dial/dial-bezel-dark.svg',
  './img/dial/dial-bezel-light.svg',
  './img/dial/dial-surface-dark.svg',
  './img/dial/dial-surface-light.svg',
  './img/dial/dial-texture-dark@2x.png',
  './img/dial/dial-texture-light@2x.png',
  './img/dial/journey-spectrum-dark.svg',
  './img/dial/journey-spectrum-light.svg',
  './data/exercises.js',
  './data/history.js',
  './data/icons.js',
  './data/measurements.js',
  './data/melbourne.js',
  './data/plan.js',
  './data/program.js',
  './data/questionnaires.js',
  './js/app.js',
  './js/components.js',
  './js/dayring.js',
  './js/editguard.js',
  './js/goals.js',
  './js/insights.js',
  './js/logging.js',
  './js/milestones.js',
  './js/mobile.js',
  './js/paintkeep.js',
  './js/planstreak.js',
  './js/player/audio.js',
  './js/player/engine.js',
  './js/player/player.js',
  './js/player/songs.js',
  './js/status.js',
  './js/store.js',
  './js/sync/config.js',
  './js/sync/engine.js',
  './js/sync/github.js',
  './js/sync/idb.js',
  './js/sync/local-store.js',
  './js/sync/merge.js',
  './js/sync/records.js',
  './js/timing.js',
  './js/trend.js',
  './js/util.js',
  './js/views/exhistory.js',
  './js/views/journey.js',
  './js/views/measures.js',
  './js/views/melbourneview.js',
  './js/views/monthboard.js',
  './js/views/overview.js',
  './js/views/planview.js',
  './js/views/program.js',
  './js/views/progress.js',
  './js/views/sessions.js',
  './js/views/settings.js',
  './js/views/supplements.js',
  './js/views/today.js',
  './js/views/week.js',
];

// 2026-09-15 (audit A10): a generation is installed whole or not at all. If
// any file fails to download, the install fails and the working worker and
// its cache stay exactly as they were; the next update check tries again.
async function precache(cache, only = SHELL_ASSETS) {
  const failed = [];
  await Promise.all(only.map(async (url) => {
    try {
      // Each fetch carries the deploy id, so an edge still serving the
      // previous deploy under the clean URL cannot seal a mixed generation.
      const busted = url + (url.includes('?') ? '&' : '?') + 'sv=' + SHELL_VERSION;
      const res = await fetch(new Request(busted, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${res.status}`);
      await cache.put(url, res);
    } catch {
      failed.push(url);
    }
  }));
  return failed;
}

async function missing() {
  const cache = await caches.open(SHELL);
  const out = [];
  for (const url of SHELL_ASSETS) if (!(await cache.match(url))) out.push(url);
  return out;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const failed = await precache(cache);
    if (failed.length) {
      // Leave nothing half built under this generation's name.
      await caches.delete(SHELL);
      throw new Error(`precache failed: ${failed.join(', ')}`);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Photos cached under the old name move across once, rather than being
    // downloaded again.
    if (keys.includes(LEGACY_MEDIA)) {
      try {
        const from = await caches.open(LEGACY_MEDIA);
        const to = await caches.open(MEDIA);
        for (const req of await from.keys()) {
          if (!(await to.match(req))) { const res = await from.match(req); if (res) await to.put(req, res); }
        }
      } catch { /* photos are fetched again on demand */ }
    }
    await Promise.all(keys.map((k) => (ours(k) && k !== SHELL && k !== MEDIA ? caches.delete(k) : null)));
    await self.clients.claim();
  })());
});

// Force update asks which generation is running and whether it is complete,
// and can ask for missing files to be fetched again (audit A16).
self.addEventListener('message', (event) => {
  const port = event.ports && event.ports[0];
  const reply = (msg) => { if (port) port.postMessage(msg); };
  const kind = event.data && event.data.kind;
  if (kind === 'version') {
    event.waitUntil(missing().then((m) => reply({ version: SHELL_VERSION, complete: m.length === 0, missing: m.length })));
  } else if (kind === 'repair') {
    event.waitUntil((async () => {
      const m = await missing();
      const failed = m.length ? await precache(await caches.open(SHELL), m) : [];
      reply({ version: SHELL_VERSION, complete: failed.length === 0, missing: failed.length });
    })());
  }
});

const isMedia = (url) => /\/img\//.test(url.pathname) || /\.(png|jpe?g|webp|svg)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Live data: never cache, never intercept.
  if (url.origin !== self.location.origin) return;           // api.github.com etc.
  if (url.pathname.startsWith('/api/')) return;
  // The worker script and version probes always go to the network (A17), so
  // a cached copy can never answer "which version is deployed".
  if (/\/sw\.js$/.test(url.pathname) || url.searchParams.has('probe')) return;

  // Navigations: serve the app shell from cache so launching offline works,
  // whatever the URL/hash was.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      // Prefer the page actually asked for; only fall back to the mobile
      // shell. Answering every navigation with m.html would mean any other
      // page on this origin could never be reached.
      const exact = await cache.match(req, { ignoreSearch: true });
      // No background refresh of the page on its own (A17): a new page with
      // an old generation's CSS and code is a mixed shell. Updates arrive as
      // a whole new generation through the worker's version check.
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

  // Photos: cache on first view, then serve from cache forever. Images that
  // are part of the shell (the dial and ribbon art, the icons) come from this
  // generation's shell first (A11), so they work offline and update with it.
  if (isMedia(url)) {
    event.respondWith((async () => {
      const shellHit = await (await caches.open(SHELL)).match(req, { ignoreSearch: true });
      if (shellHit) return shellHit;
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

  // Everything else (code, styles, data modules): cache-first, and NO
  // background refetch.
  //
  // The cache name carries the deploy id, so an entry inside a generation can
  // never be stale, a new deploy builds a new cache from scratch. Revalidating
  // each file anyway meant every launch quietly re-downloaded the entire app
  // over mobile data to confirm nothing had changed. Updates arrive through the
  // worker's own version check instead.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    // Not part of this generation: straight from the network, never written
    // into the generation's cache, so a generation cannot pick up files from a
    // later deploy (A17).
    try {
      return await fetch(req);
    } catch {
      return new Response('Offline', { status: 503 });
    }
  })());
});
