// The iPhone app.
//
// It renders the REAL desktop views — the same renderToday, renderProgram,
// renderPlan, renderMelbourne, renderProgress and renderSettings the Mac uses,
// with the same ctx contract and the same bind functions. So the phone has
// every feature the desktop has: the journey road, the month board and its
// markers, weekly cadence, the goal filters, Melbourne phases and MRSS, the
// questionnaires, measurements, charts, PhysiApp sync, everything.
//
// What is mobile-specific is the CHROME and the styling, not the content:
// a fixed header that clears the Dynamic Island, a bottom tab bar that clears
// the home indicator, a single scrolling region between them, and touch-sized
// controls (mobile.css). That is the right split — a phone-only reimplementation
// of the views would inevitably drift from the desktop and be missing things.

import {
  state, subscribe, load, runSync, syncState, pendingSyncCount, onRemoteChange,
} from './store.js';
import { todayIso, postOp, applyStoredTheme } from './util.js';
import { renderToday, bindToday } from './views/today.js';
import { renderProgram, bindProgram } from './views/program.js';
import { renderPlan, bindPlan } from './views/planview.js';
import { renderSupplements, bindSupplements } from './views/supplements.js';
import { renderProgress, bindProgress } from './views/progress.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { isConfigured } from './sync/config.js';

applyStoredTheme();   // before first paint, so there is no flash

const VIEWS = {
  today: [renderToday, bindToday],
  program: [renderProgram, bindProgram],
  plan: [renderPlan, bindPlan],
  supplements: [renderSupplements, bindSupplements],
  progress: [renderProgress, bindProgress],
  settings: [renderSettings, bindSettings],
};

// Only an installed app owns the space over the home indicator; in Safari the
// browser's toolbar is already there. Getting this wrong leaves a dead strip
// under the tab bar, so detect it both ways and let CSS key off the class.
const STANDALONE = window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches;
document.body.classList.toggle('standalone', STANDALONE);

const viewEl = document.getElementById('view');

// A phone opens on Supplements — it is the thing checked several times a day
// and the first thing wanted in the morning. An iPad has room to browse and
// opens on Today, as the Mac does.
const IS_PHONE = window.matchMedia('(max-width: 700px)').matches;

const ctx = {
  view: (location.hash.slice(1) || (IS_PHONE ? 'supplements' : 'today')),
  date: todayIso(),
  go(v) {
    ctx.view = v;
    history.replaceState(null, '', '#' + v);
    paint();
  },
};
if (!VIEWS[ctx.view]) ctx.view = 'today';

let lastView = null;

function paint() {
  const y = window.scrollY;      // the document scrolls now, not an inner box
  const [render, bind] = VIEWS[ctx.view] || VIEWS.today;
  viewEl.innerHTML = render(ctx);
  bind?.(viewEl, ctx, paint);
  document.querySelectorAll('#mtabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === ctx.view);
  });
  document.getElementById('nav-settings')?.classList.toggle('on', ctx.view === 'settings');
  // Re-rendering in place keeps your scroll position; changing tab starts at
  // the top. The scrolling element is the middle region, not the document.
  window.scrollTo({ top: ctx.view === lastView ? y : 0 });
  lastView = ctx.view;
  paintChrome();
}

// A sync with nothing to send can finish within a couple of frames, and a blue
// dot shown that briefly reads as nothing having happened at all. Tapping the
// button gets away with it because you are looking straight at it; a pull does
// not, because your eye is on the content springing back. So the busy state is
// held on screen for a beat regardless of how fast the sync actually was.
const BUSY_MIN_MS = 750;
let busyUntil = 0;
let busyTimer = null;

/** Show the chip as syncing now, and keep it that way long enough to be seen. */
function holdBusy() {
  busyUntil = Date.now() + BUSY_MIN_MS;
  paintChrome();
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => { busyTimer = null; paintChrome(); }, BUSY_MIN_MS + 30);
}

function paintChrome() {
  const s = state.data.settings || {};
  const title = s.appTitle || 'Rehab';
  const h1 = document.getElementById('app-title');
  if (h1 && h1.textContent !== title) h1.textContent = title;
  if (document.title !== title) document.title = title;

  const today = todayIso();
  const L = postOp(s.surgeryLeft, today);
  const R = postOp(s.surgeryRight, today);
  const bits = [];
  if (L && !L.future) bits.push(`<b>L</b> ${L.weeks}w`);
  if (R && !R.future) bits.push(`<b>R</b> ${R.weeks}w`);
  const strip = document.getElementById('postop-strip');
  if (strip) strip.innerHTML = bits.length ? `${bits.join(' · ')} post-op` : '';

  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;
  dot.className = 'msync-dot';
  if (!isConfigured()) { label.textContent = 'Local'; return; }
  const pending = pendingSyncCount();
  if (syncState.running || Date.now() < busyUntil) { dot.classList.add('busy'); label.textContent = 'Sync'; }
  else if (syncState.lastError) { dot.classList.add('err'); label.textContent = 'Retry'; }
  else if (pending) { dot.classList.add('pending'); label.textContent = String(pending); }
  else { dot.classList.add('ok'); label.textContent = 'Synced'; }
}

// -------------------------------------------------------------------- wiring
document.getElementById('mtabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) ctx.go(b.dataset.view);
});
document.getElementById('nav-settings').addEventListener('click', () => ctx.go('settings'));

document.getElementById('sync-btn').addEventListener('click', async () => {
  if (!isConfigured()) return ctx.go('settings');
  await runSync('manual');
  paint();
});

// ----------------------------------------------------- pull down to sync ---
// At the top of any page, pull down and let go: exactly what the sync button
// does, without having to aim at it.
//
// Nothing new appears on screen. The header's sync chip already reports
// running, pending and failed, so the gesture drives the control that is
// already there rather than adding a second one beside it.
//
// The gesture is taken over outright rather than ridden on top of iOS's own.
// An installed web app has its own pull-to-refresh and it RELOADS the page,
// which would throw away the tab you were on and where you had scrolled to.
// mobile.css contains the overscroll so iOS never acts on it, and the pull and
// the spring back are drawn here instead.
//
// It costs nothing while you are not pulling. The non-passive touchmove
// listener — the one that stops the browser scrolling on its fast path, and so
// the one that would cost smoothness everywhere — is attached only for the
// length of a touch that began at the very top, and only when sync is set up
// at all.
const PULL_TRIGGER = 72;    // finger travel that counts as "sync"
const PULL_MAX = 110;       // furthest the content moves, however hard you pull

let pullY0 = 0;
let pullX0 = 0;
let pullDy = 0;
let pullWatching = false;   // the touchmove listener is attached
let pulling = false;        // committed: this gesture is a pull, not a scroll

const syncBtn = document.getElementById('sync-btn');

const modalOpen = () => !!document.getElementById('modal-root')?.childElementCount;

function pullTo(px) {
  // Transform only: no layout and no repaint, so the pull is compositor work.
  viewEl.style.transform = px > 0 ? `translate3d(0,${px.toFixed(1)}px,0)` : '';
}

function pullStop(fire) {
  if (pullWatching) window.removeEventListener('touchmove', onPullMove);
  pullWatching = false;
  if (pulling) {
    viewEl.classList.add('mspring');
    pullTo(0);
    viewEl.style.willChange = '';
    setTimeout(() => viewEl.classList.remove('mspring'), 320);
  }
  pulling = false;
  syncBtn.classList.remove('armed');
  if (fire) {
    holdBusy();                       // blue immediately, before the network answers
    runSync('manual').then(() => paint());
  }
}

function onPullMove(e) {
  const t = e.touches[0];
  if (!t) return;
  pullDy = t.clientY - pullY0;
  if (!pulling) {
    // Decided once, early, and never revisited: a downward, mostly vertical
    // move is a pull; anything else is an ordinary scroll and is handed back
    // to the browser untouched.
    if (pullDy < 0) { pullStop(false); return; }
    if (pullDy < 4 || pullDy < Math.abs(t.clientX - pullX0)) return;
    pulling = true;
    viewEl.classList.remove('mspring');
    viewEl.style.willChange = 'transform';
  }
  e.preventDefault();
  // Damped: it gives less the further you pull, which is what makes it feel
  // attached to your finger rather than sliding.
  pullTo(PULL_MAX * (1 - Math.exp(-pullDy / (PULL_MAX * 1.1))));
  // The chip lights up while your finger is still down, the moment you have
  // pulled far enough — so you know letting go will sync BEFORE you commit,
  // rather than having to catch a flash afterwards. Pull back up and it goes out.
  syncBtn.classList.toggle('armed', pullDy >= PULL_TRIGGER);
}

window.addEventListener('touchstart', (e) => {
  if (pullWatching || e.touches.length !== 1) return;
  if (window.scrollY > 0 || !isConfigured() || modalOpen()) return;
  // Gestures that belong to something else stay theirs: reordering a
  // supplement, dragging a pain slider, swiping a wide table sideways.
  if (e.target.closest?.('[data-drag], input[type=range], .scroll-x, table')) return;
  pullY0 = e.touches[0].clientY;
  pullX0 = e.touches[0].clientX;
  pullDy = 0;
  pullWatching = true;
  window.addEventListener('touchmove', onPullMove, { passive: false });
}, { passive: true });

const pullRelease = () => { if (pullWatching) pullStop(pulling && pullDy >= PULL_TRIGGER); };
window.addEventListener('touchend', pullRelease, { passive: true });
// touchcancel honours the pull exactly as touchend does. iOS cancels a touch
// when the system takes it over — a notification arriving, an edge gesture —
// and treating that as "never happened" meant a pull you had completed could
// silently do nothing. Syncing is idempotent, so acting on a committed pull is
// always the safer of the two.
window.addEventListener('touchcancel', pullRelease, { passive: true });

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== ctx.view) { ctx.view = v; paint(); }
});

subscribe(paintChrome);
onRemoteChange(() => paint());

// Sync when the app returns to the foreground or regains a connection — this
// is what uploads the queue after Airplane Mode without you doing anything.
window.addEventListener('online', () => { if (isConfigured()) runSync('online'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isConfigured()) runSync('foreground');
});

load().then(() => {
  paint();
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // NEVER on the Mac: the worker claims every navigation in its scope and
    // would answer them with this shell, hijacking the desktop app served
    // from the same origin. Clean up if one was ever registered here.
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }
  // Adopt a new deploy automatically.
  //
  // The worker serves the shell cache-first, which is what makes a cold
  // offline launch work — but it also means a fresh deploy would otherwise sit
  // unused until the SECOND launch, with the page still running the previous
  // CSS and code. Reloading once when a new worker takes control closes that
  // gap. Local data lives in IndexedDB and is untouched by any of this, so an
  // update can never cost you anything.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;   // not the very first install
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    // Check for a new version on foreground, but at most every 30 minutes —
    // it is a network request, and a deploy is not something that happens
    // between glances at the app.
    const CHECK_GAP_MS = 30 * 60 * 1000;
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheck < CHECK_GAP_MS) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    });
  }).catch(() => {});
});
