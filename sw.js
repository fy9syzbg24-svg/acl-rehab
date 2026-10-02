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

const SHELL_VERSION = 'c35b8d1';
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
  './rt.css',
  './rt-today.css',
  './rt-player.css',
  './rt-glp1.css',
  './rt-progress.css',
  './rt-sleep.css',
  './rt-plan.css',
  './rt-consistency.css',
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
  './audio/sfx/glass/check.wav',
  './audio/sfx/glass/countin.wav',
  './audio/sfx/glass/day.wav',
  './audio/sfx/glass/goal.wav',
  './audio/sfx/glass/halfway.wav',
  './audio/sfx/glass/logsaved.wav',
  './audio/sfx/glass/metro.wav',
  './audio/sfx/glass/now-tuned.wav',
  './audio/sfx/glass/paused-tuned.wav',
  './audio/sfx/glass/pip-tuned.wav',
  './audio/sfx/glass/rest.wav',
  './audio/sfx/glass/restend-tuned.wav',
  './audio/sfx/glass/saved.wav',
  './audio/sfx/glass/set-tuned.wav',
  './audio/sfx/glass/tick.wav',
  './audio/sfx/sfx.json',
  './audio/voice/alice/alldone.mp3',
  './audio/voice/alice/backin.mp3',
  './audio/voice/alice/both.mp3',
  './audio/voice/alice/cue-balance.mp3',
  './audio/voice/alice/cue-brace.mp3',
  './audio/voice/alice/cue-bridge.mp3',
  './audio/voice/alice/cue-curl.mp3',
  './audio/voice/alice/cue-dance.mp3',
  './audio/voice/alice/cue-extend.mp3',
  './audio/voice/alice/cue-hinge.mp3',
  './audio/voice/alice/cue-hop.mp3',
  './audio/voice/alice/cue-jump.mp3',
  './audio/voice/alice/cue-kneel.mp3',
  './audio/voice/alice/cue-land.mp3',
  './audio/voice/alice/cue-lift.mp3',
  './audio/voice/alice/cue-lunge.mp3',
  './audio/voice/alice/cue-move.mp3',
  './audio/voice/alice/cue-perform.mp3',
  './audio/voice/alice/cue-pulse.mp3',
  './audio/voice/alice/cue-raise.mp3',
  './audio/voice/alice/cue-ride.mp3',
  './audio/voice/alice/cue-roll.mp3',
  './audio/voice/alice/cue-row.mp3',
  './audio/voice/alice/cue-run.mp3',
  './audio/voice/alice/cue-squat.mp3',
  './audio/voice/alice/cue-squeeze.mp3',
  './audio/voice/alice/cue-stand.mp3',
  './audio/voice/alice/cue-step.mp3',
  './audio/voice/alice/cue-stretch.mp3',
  './audio/voice/alice/cue-swim.mp3',
  './audio/voice/alice/cue-walk.mp3',
  './audio/voice/alice/cueson.mp3',
  './audio/voice/alice/exdone.mp3',
  './audio/voice/alice/five.mp3',
  './audio/voice/alice/go.mp3',
  './audio/voice/alice/go2.mp3',
  './audio/voice/alice/go3.mp3',
  './audio/voice/alice/go4.mp3',
  './audio/voice/alice/goal.mp3',
  './audio/voice/alice/halfway.mp3',
  './audio/voice/alice/hold.mp3',
  './audio/voice/alice/hold2.mp3',
  './audio/voice/alice/hold3.mp3',
  './audio/voice/alice/lastround.mp3',
  './audio/voice/alice/lastset-next.mp3',
  './audio/voice/alice/lastset.mp3',
  './audio/voice/alice/left-first.mp3',
  './audio/voice/alice/left-next.mp3',
  './audio/voice/alice/left-tap.mp3',
  './audio/voice/alice/left.mp3',
  './audio/voice/alice/lines.json',
  './audio/voice/alice/next-cl20.mp3',
  './audio/voice/alice/next-cl21.mp3',
  './audio/voice/alice/next-cl22.mp3',
  './audio/voice/alice/next-cl23.mp3',
  './audio/voice/alice/next-cl24.mp3',
  './audio/voice/alice/next-custom.mp3',
  './audio/voice/alice/next-g_elliptical.mp3',
  './audio/voice/alice/next-ms30.mp3',
  './audio/voice/alice/next-pa01.mp3',
  './audio/voice/alice/next-pa02.mp3',
  './audio/voice/alice/next-pa03.mp3',
  './audio/voice/alice/next-pa04.mp3',
  './audio/voice/alice/next-pa05.mp3',
  './audio/voice/alice/next-pa06.mp3',
  './audio/voice/alice/next-pa07.mp3',
  './audio/voice/alice/next-pa08.mp3',
  './audio/voice/alice/next-pa09.mp3',
  './audio/voice/alice/next-pa10.mp3',
  './audio/voice/alice/next-pa11.mp3',
  './audio/voice/alice/next-pa12.mp3',
  './audio/voice/alice/next-pa13.mp3',
  './audio/voice/alice/next-pa14.mp3',
  './audio/voice/alice/next-pa15.mp3',
  './audio/voice/alice/next-pa16.mp3',
  './audio/voice/alice/next-pa25.mp3',
  './audio/voice/alice/next-pa26.mp3',
  './audio/voice/alice/next-pa27.mp3',
  './audio/voice/alice/next-pa28.mp3',
  './audio/voice/alice/next-pa29.mp3',
  './audio/voice/alice/next-tl18.mp3',
  './audio/voice/alice/next-tl19.mp3',
  './audio/voice/alice/next-tp17.mp3',
  './audio/voice/alice/paused.mp3',
  './audio/voice/alice/ready.mp3',
  './audio/voice/alice/ready2.mp3',
  './audio/voice/alice/rest.mp3',
  './audio/voice/alice/rest2.mp3',
  './audio/voice/alice/rest3.mp3',
  './audio/voice/alice/right-first.mp3',
  './audio/voice/alice/right-next.mp3',
  './audio/voice/alice/right-tap.mp3',
  './audio/voice/alice/right.mp3',
  './audio/voice/alice/setsdone.mp3',
  './audio/voice/alice/stage-places.mp3',
  './audio/voice/alice/stage-standby.mp3',
  './audio/voice/alice/stage-wrap.mp3',
  './audio/voice/alice/switch.mp3',
  './audio/voice/alice/switch2.mp3',
  './audio/voice/alice/tapstart.mp3',
  './audio/voice/alice/ten.mp3',
  './audio/voice/alice/workout-done.mp3',
  './audio/voice/brian/lines.json',
  './audio/voice/charlie/lines.json',
  './audio/voice/lines.json',
  './audio/voice/voices.json',
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
  './js/clinic.js',
  './js/clinicgoals.js',
  './js/components.js',
  './js/customworkout.js',
  './js/dayring.js',
  './js/defaults.js',
  './js/editguard.js',
  './js/feedback.js',
  './js/firstup.js',
  './js/fold.js',
  './js/food.js',
  './js/frames.js',
  './js/glide.js',
  './js/glp1/ask.js',
  './js/glp1/glyphs.js',
  './js/glp1/local.js',
  './js/glp1/scrub.js',
  './js/glyphs.js',
  './js/goals.js',
  './js/insights.js',
  './js/logging.js',
  './js/menu.js',
  './js/milestones.js',
  './js/mobile.js',
  './js/morph.js',
  './js/motion.js',
  './js/native-bridge.js',
  './js/paintkeep.js',
  './js/peek.js',
  './js/pk.js',
  './js/planseg.js',
  './js/planstreak.js',
  './js/player/audio.js',
  './js/player/celebrate.js',
  './js/player/choreo.js',
  './js/player/cues.js',
  './js/player/engine.js',
  './js/player/live.js',
  './js/player/packs.js',
  './js/player/player.js',
  './js/player/songs.js',
  './js/progressions.js',
  './js/ptmark.js',
  './js/push.js',
  './js/railpages.js',
  './js/remind.js',
  './js/ring.js',
  './js/routines.js',
  './js/rt.js',
  './js/rtfx.js',
  './js/rtlocal.js',
  './js/rtprefs.js',
  './js/show.js',
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
  './js/undash.js',
  './js/util.js',
  './js/videos.js',
  './js/views/exhistory.js',
  './js/views/exsheet.js',
  './js/views/figure.js',
  './js/views/history3.js',
  './js/views/journey.js',
  './js/views/measures.js',
  './js/views/medlevel.js',
  './js/views/melbourneview.js',
  './js/views/monthboard.js',
  './js/views/overview.js',
  './js/views/pkit.js',
  './js/views/planview.js',
  './js/views/program.js',
  './js/views/progress.js',
  './js/views/recovery.js',
  './js/views/sessions.js',
  './js/views/settings.js',
  './js/views/sleep.js',
  './js/views/standboard.js',
  './js/views/supplements.js',
  './js/views/today.js',
  './js/views/trends.js',
  './js/views/week.js',
  './js/vt.js',
  './js/widgets.js',
];

// 2026-09-15 (audit A10): a generation is installed whole or not at all. If
// any file fails to download, the install fails and the working worker and
// its cache stay exactly as they were; the next update check tries again.
// 2026-09-30: six downloads at a time, each tried three times, so a phone on a weak signal
// can finish (hundreds of fetches at once, any one failing, sank the whole install).
async function precache(cache, only = SHELL_ASSETS) {
  const failed = [];
  const queue = [...only];
  const one = async (url) => {
    // Each fetch carries the deploy id, so an edge still serving the
    // previous deploy under the clean URL cannot seal a mixed generation.
    const busted = url + (url.includes('?') ? '&' : '?') + 'sv=' + SHELL_VERSION;
    for (let tries = 0; tries < 3; tries++) {
      try {
        const res = await fetch(new Request(busted, { cache: 'reload' }));
        if (!res.ok) throw new Error(`${res.status}`);
        await cache.put(url, res);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * (tries + 1)));
      }
    }
    failed.push(url);
  };
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) await one(queue.shift());
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

// Audio too (2026-09-30): only the default voice and sound set are installed with the app; the
// other voices are kept the first time they play.
const isMedia = (url) => /\/img\//.test(url.pathname) || /\.(png|jpe?g|webp|svg|mp3|wav|m4a)$/i.test(url.pathname);

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
