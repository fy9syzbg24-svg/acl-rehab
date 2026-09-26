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

const SHELL_VERSION = 'ac7bed1';
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
  './desktop.html',
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
  './img/silhouette-front.svg',
  './audio/voice/lines.json',
  './audio/voice/alldone.mp3',
  './audio/voice/backin.mp3',
  './audio/voice/both.mp3',
  './audio/voice/cue-balance.mp3',
  './audio/voice/cue-brace.mp3',
  './audio/voice/cue-bridge.mp3',
  './audio/voice/cue-curl.mp3',
  './audio/voice/cue-dance.mp3',
  './audio/voice/cue-extend.mp3',
  './audio/voice/cue-hinge.mp3',
  './audio/voice/cue-hop.mp3',
  './audio/voice/cue-jump.mp3',
  './audio/voice/cue-kneel.mp3',
  './audio/voice/cue-land.mp3',
  './audio/voice/cue-lift.mp3',
  './audio/voice/cue-lunge.mp3',
  './audio/voice/cue-move.mp3',
  './audio/voice/cue-perform.mp3',
  './audio/voice/cue-pulse.mp3',
  './audio/voice/cue-raise.mp3',
  './audio/voice/cue-ride.mp3',
  './audio/voice/cue-roll.mp3',
  './audio/voice/cue-row.mp3',
  './audio/voice/cue-run.mp3',
  './audio/voice/cue-squat.mp3',
  './audio/voice/cue-squeeze.mp3',
  './audio/voice/cue-stand.mp3',
  './audio/voice/cue-step.mp3',
  './audio/voice/cue-stretch.mp3',
  './audio/voice/cue-swim.mp3',
  './audio/voice/cue-walk.mp3',
  './audio/voice/cueson.mp3',
  './audio/voice/exdone.mp3',
  './audio/voice/five.mp3',
  './audio/voice/go.mp3',
  './audio/voice/go2.mp3',
  './audio/voice/go3.mp3',
  './audio/voice/goal.mp3',
  './audio/voice/halfway.mp3',
  './audio/voice/hold.mp3',
  './audio/voice/hold2.mp3',
  './audio/voice/lastround.mp3',
  './audio/voice/lastset-next.mp3',
  './audio/voice/lastset.mp3',
  './audio/voice/left-first.mp3',
  './audio/voice/left-next.mp3',
  './audio/voice/left-tap.mp3',
  './audio/voice/left.mp3',
  './audio/voice/next-cl20.mp3',
  './audio/voice/next-cl21.mp3',
  './audio/voice/next-cl22.mp3',
  './audio/voice/next-cl23.mp3',
  './audio/voice/next-cl24.mp3',
  './audio/voice/next-custom.mp3',
  './audio/voice/next-g_elliptical.mp3',
  './audio/voice/next-ms30.mp3',
  './audio/voice/next-pa01.mp3',
  './audio/voice/next-pa02.mp3',
  './audio/voice/next-pa03.mp3',
  './audio/voice/next-pa04.mp3',
  './audio/voice/next-pa05.mp3',
  './audio/voice/next-pa06.mp3',
  './audio/voice/next-pa07.mp3',
  './audio/voice/next-pa08.mp3',
  './audio/voice/next-pa09.mp3',
  './audio/voice/next-pa10.mp3',
  './audio/voice/next-pa11.mp3',
  './audio/voice/next-pa12.mp3',
  './audio/voice/next-pa13.mp3',
  './audio/voice/next-pa14.mp3',
  './audio/voice/next-pa15.mp3',
  './audio/voice/next-pa16.mp3',
  './audio/voice/next-pa25.mp3',
  './audio/voice/next-pa26.mp3',
  './audio/voice/next-pa27.mp3',
  './audio/voice/next-pa28.mp3',
  './audio/voice/next-pa29.mp3',
  './audio/voice/next-tl18.mp3',
  './audio/voice/next-tl19.mp3',
  './audio/voice/next-tp17.mp3',
  './audio/voice/paused.mp3',
  './audio/voice/ready.mp3',
  './audio/voice/rest.mp3',
  './audio/voice/rest2.mp3',
  './audio/voice/right-first.mp3',
  './audio/voice/right-next.mp3',
  './audio/voice/right-tap.mp3',
  './audio/voice/right.mp3',
  './audio/voice/setsdone.mp3',
  './audio/voice/switch.mp3',
  './audio/voice/tapstart.mp3',
  './audio/voice/ten.mp3',
  './audio/voice/workout-done.mp3',
  './data/exercises.js',
  './data/history.js',
  './data/icons.js',
  './data/measurements.js',
  './data/melbourne.js',
  './data/norms.js',
  './data/plan.js',
  './data/program.js',
  './data/questionnaires.js',
  './js/app.js',
  './js/backup.js',
  './js/badge.js',
  './js/clinicgoals.js',
  './js/components.js',
  './js/customworkout.js',
  './js/dayring.js',
  './js/defaults.js',
  './js/editguard.js',
  './js/feedback.js',
  './js/firstup.js',
  './js/fold.js',
  './js/glide.js',
  './js/goals.js',
  './js/insights.js',
  './js/logging.js',
  './js/milestones.js',
  './js/mobile.js',
  './js/morph.js',
  './js/motion.js',
  './js/paintkeep.js',
  './js/pk.js',
  './js/planstreak.js',
  './js/player/audio.js',
  './js/player/celebrate.js',
  './js/player/choreo.js',
  './js/player/cues.js',
  './js/player/engine.js',
  './js/player/player.js',
  './js/player/songs.js',
  './js/progressions.js',
  './js/ptmark.js',
  './js/push.js',
  './js/railpages.js',
  './js/remind.js',
  './js/ring.js',
  './js/status.js',
  './js/stopwatch.js',
  './js/store.js',
  './js/swipe.js',
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
  './js/videos.js',
  './js/views/exhistory.js',
  './js/views/journey.js',
  './js/views/measures.js',
  './js/views/medlevel.js',
  './js/views/melbourneview.js',
  './js/views/monthboard.js',
  './js/views/overview.js',
  './js/views/planview.js',
  './js/views/program.js',
  './js/views/progress.js',
  './js/views/recovery.js',
  './js/views/sessions.js',
  './js/views/settings.js',
  './js/views/standboard.js',
  './js/views/supplements.js',
  './js/views/today.js',
  './js/views/trends.js',
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
  } else if (kind === 'clear-reminders') {
    // He opened the app, so nothing is waiting for him any more (his rule).
    event.waitUntil((async () => {
      const ns = await self.registration.getNotifications();
      for (const n of ns) n.close();
      reply({ cleared: ns.length });
    })());
  } else if (kind === 'repair') {
    event.waitUntil((async () => {
      const m = await missing();
      const failed = m.length ? await precache(await caches.open(SHELL), m) : [];
      reply({ version: SHELL_VERSION, complete: failed.length === 0, missing: failed.length });
    })());
  }
});

const isMedia = (url) => /\/img\//.test(url.pathname) || /\.(png|jpe?g|webp|svg)$/i.test(url.pathname);

// ------------------------------------------------------------- reminders ---
//
// His rules for these, 2026-09-15:
//   "I want to make sure that those notifications go away if I tap on them or
//    go back into the app. I don't want a whole bunch of reminders backlogged
//    for every single time I do anything related to this app."
//   "It would also be nice if I could tap on the notification and it would open
//    up the web app."
//
// So: every reminder of a kind carries the same tag, which makes a new one
// REPLACE the last rather than stack; tapping one focuses the app it belongs to
// instead of opening a second copy; and opening the app clears whatever is
// still showing (the page asks for that through the 'clear-reminders' message).
//
// iOS enforces userVisibleOnly, so a push that arrives must show something. A
// push with no usable payload still shows one honest line rather than the
// browser's own "This site has been updated in the background".

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  const title = d.title || 'Rehab tracker';
  const opts = {
    body: d.body || 'Something is due.',
    tag: d.tag || 'rehab',          // same tag replaces, never stacks
    renotify: true,
    data: { url: d.url || './', sent: d.sent || Date.now() },
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const want = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const url = new URL(want, self.registration.scope).href;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Focus the copy he already has rather than opening a second one.
    for (const c of clients) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        try { c.postMessage({ type: 'reminder-opened', url }); } catch { /* fine */ }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

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
