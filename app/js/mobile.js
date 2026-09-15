// The iPhone app.
//
// It renders the REAL desktop views, the same renderToday, renderProgram,
// renderPlan, renderMelbourne, renderProgress and renderSettings the Mac uses,
// with the same ctx contract and the same bind functions. So the phone has
// every feature the desktop has: the journey road, the month board and its
// markers, weekly cadence, the goal filters, Melbourne phases and MRSS, the
// questionnaires, measurements, charts, PhysiApp sync, everything.
//
// What is mobile-specific is the CHROME and the styling, not the content:
// a fixed header that clears the Dynamic Island, a bottom tab bar that clears
// the home indicator, a single scrolling region between them, and touch-sized
// controls (mobile.css). That is the right split, a phone-only reimplementation
// of the views would inevitably drift from the desktop and be missing things.

import {
  state, update, subscribe, load, flushEdits, recoverEdits, runSync, syncState, pendingSyncCount, onRemoteChange,
  surgeryDate, saveOutstanding,
} from './store.js';
import { guardPaint, whenIdle } from './editguard.js';
import { capture, restore, scrollTop } from './paintkeep.js';
import { chipState } from './status.js';
import { todayIso, postOp, applyStoredTheme, applyTheme, THEME_KEY } from './util.js';
import { renderToday, bindToday } from './views/today.js';
import { renderProgram, bindProgram } from './views/program.js';
import { renderPlan, bindPlan } from './views/planview.js';
import { renderSupplements, bindSupplements } from './views/supplements.js';
import { renderProgress, bindProgress } from './views/progress.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { renderPlayer, bindPlayer, playerLeaving, playerBusy, playerBack } from './player/player.js';
import { isConfigured } from './sync/config.js';
import { needsSeed, markSeen } from './milestones.js';

applyStoredTheme();   // before first paint, so there is no flash
// Automatic follows the device while the app stays open, browser chrome too (F50).
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    let pref = 'light';
    try { pref = localStorage.getItem(THEME_KEY) || 'light'; } catch { /* per device */ }
    if (pref === 'auto') applyTheme('auto');
  });
} catch { /* older engines */ }

const VIEWS = {
  today: [renderToday, bindToday],
  program: [renderProgram, bindProgram],
  plan: [renderPlan, bindPlan],
  supplements: [renderSupplements, bindSupplements],
  progress: [renderProgress, bindProgress],
  settings: [renderSettings, bindSettings],
  // The workout player: a view of its own, opened from Today or My Program.
  player: [renderPlayer, bindPlayer],
};

// Only an installed app owns the space over the home indicator; in Safari the
// browser's toolbar is already there. Getting this wrong leaves a dead strip
// under the tab bar, so detect it both ways and let CSS key off the class.
const STANDALONE = window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches;
document.body.classList.toggle('standalone', STANDALONE);

const viewEl = document.getElementById('view');

// Every device opens on Today. It used to be Supplements on a phone, because
// that was the list checked several times a day; the day's supplements are on
// Today now, so Today serves both and the app always opens on the same screen.
const ctx = {
  view: (location.hash.slice(1) || 'today'),
  date: todayIso(),
  go(v) {
    if (ctx.view === 'player' && v !== 'player') playerLeaving();
    if (ctx.view === 'today' && v !== 'today') delete ctx.todayNotice;   // said for one visit
    rememberScroll();
    ctx.view = v;
    history.replaceState(null, '', '#' + v);
    paint();
  },
};
if (!VIEWS[ctx.view]) ctx.view = 'today';

let lastView = null;

const scrollMemo = {};
const scrollKey = () => `${ctx.view}|${ctx.view === 'today' ? ctx.date : ''}|${ctx.gtab || ''}`;
function rememberScroll() {
  if (lastView && lastView !== 'player') scrollMemo[`${lastView}|${lastView === 'today' ? ctx.date : ''}|${ctx.gtab || ''}`] = window.scrollY;
}

// A new day begins with that day's plan: an app left open on today's date
// moves to the new date when it comes back after midnight.
let openedOn = todayIso();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = todayIso();
  if (now !== openedOn) {
    if (ctx.date === openedOn) { ctx.date = now; ctx.editing = null; }
    openedOn = now;
    paint();
  }
});

// Every repaint goes through the edit guard: a redraw asked for while a field
// or a native picker is in use waits until he leaves it (editguard.js). A
// change of tab is never held back.
const paint = guardPaint(viewEl, rawPaint, () => ctx.view !== lastView);

function rawPaint() {
  const y = window.scrollY;      // the document scrolls now, not an inner box
  const [render, bind] = VIEWS[ctx.view] || VIEWS.today;
  document.body.classList.toggle('in-player', ctx.view === 'player');
  const keep = ctx.view === lastView ? capture(viewEl) : null;
  flushEdits();   // a typed value is committed before its field is replaced
  viewEl.innerHTML = render(ctx);
  bind?.(viewEl, ctx, paint);
  restore(viewEl, keep);
  // The player belongs to the tab it was opened from.
  const tabView = ctx.view === 'player' ? (ctx.playerFrom || 'today') : ctx.view;
  document.querySelectorAll('#mtabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === tabView);
  });
  document.getElementById('nav-settings')?.classList.toggle('on', ctx.view === 'settings');
  // In the player the header's own row holds Back, beside the save chip and
  // Settings, in the layout rather than laid over it (F11, F36).
  const inPlayer = ctx.view === 'player';
  const backBtn = document.getElementById('nav-back');
  if (backBtn) {
    backBtn.hidden = !inPlayer;
    const to = ctx.playerFrom === 'program' ? 'My Program' : 'Today';
    const lab = document.getElementById('nav-back-label');
    if (lab && lab.textContent !== to) lab.textContent = to;
    backBtn.setAttribute('aria-label', `Back to ${to}`);
  }
  // Re-rendering in place keeps your scroll position; changing tab starts at
  // the top. The scrolling element is the middle region, not the document.
  // Coming back to a view (from the player, a chart or an editor) puts it back
  // where it was, for the same date; a new view starts at the top.
  const back = scrollMemo[scrollKey()];
  window.scrollTo({ top: ctx.view === lastView ? y : (ctx.view !== 'player' && back != null ? back : 0) });
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
  const L = postOp(surgeryDate('left'), today);
  const R = postOp(surgeryDate('right'), today);
  const bits = [];
  if (L && !L.future) bits.push(`<b>L</b> ${L.weeks}w`);
  if (R && !R.future) bits.push(`<b>R</b> ${R.weeks}w`);
  const strip = document.getElementById('postop-strip');
  if (strip) strip.innerHTML = bits.length ? `${bits.join(' · ')} post-op` : '';

  const dot = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (!dot || !label) return;
  const configured = isConfigured();
  const c = chipState({
    state, configured, syncing: syncState.running || Date.now() < busyUntil,
    pending: configured ? pendingSyncCount() : 0, syncError: syncState.lastError, saveOutstanding: saveOutstanding(),
  });
  dot.className = `msync-dot ${c.dot}`;
  if (label.textContent !== c.label) label.textContent = c.label;
  document.getElementById('sync-btn')?.setAttribute('title', c.title);
  document.getElementById('sync-btn')?.setAttribute('aria-label', `${c.label}. ${c.title}`);
  fitHeader();
}

/**
 * Two header rows when one cannot hold everything (audit L02, L05): the app
 * name or the player's Back label is never cut off or run into the save chip.
 * Measured, not guessed from a breakpoint, because it depends on the text size
 * and the label, and the real header height is published for sticky offsets.
 */
function fitHeader() {
  const top = document.querySelector('.mtop');
  if (!top) return;
  top.classList.remove('stack');
  const shown = (el) => el && !el.hidden && el.offsetParent !== null;
  const clipped = (el) => shown(el) && el.scrollWidth > el.clientWidth + 1;
  const chip = document.getElementById('sync-btn');
  const back = document.getElementById('nav-back');
  const hits = shown(back) && chip && back.getBoundingClientRect().right > chip.getBoundingClientRect().left - 4;
  if (clipped(document.getElementById('app-title')) || clipped(document.getElementById('postop-strip')) || clipped(back) || hits) {
    top.classList.add('stack');
  }
  document.documentElement.style.setProperty('--mtop-real', `${top.offsetHeight}px`);
}
window.addEventListener('resize', () => fitHeader());
// A change of text size changes the header's own boxes without resizing the
// window, so watch the pieces themselves.
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => fitHeader());
  for (const id of ['app-title', 'sync-btn', 'nav-back']) {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  }
}

// -------------------------------------------------------------------- wiring
document.getElementById('mtabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  // Tapping the tab you are already on scrolls that page back to the top, the
  // way iPhone apps do (his ask, 2026-09-14). From the player, Today still
  // leaves the player as before.
  if (b.dataset.view === ctx.view) { scrollTop(); return; }
  ctx.go(b.dataset.view);
});
document.getElementById('nav-settings').addEventListener('click', () => ctx.go('settings'));
document.getElementById('nav-back')?.addEventListener('click', () => playerBack(ctx));

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
// listener: the one that stops the browser scrolling on its fast path, and so
// the one that would cost smoothness everywhere, is attached only for the
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
  // pulled far enough, so you know letting go will sync BEFORE you commit,
  // rather than having to catch a flash afterwards. Pull back up and it goes out.
  syncBtn.classList.toggle('armed', pullDy >= PULL_TRIGGER);
}

window.addEventListener('touchstart', (e) => {
  if (pullWatching || e.touches.length !== 1) return;
  if (window.scrollY > 0 || !isConfigured() || modalOpen()) return;
  // Gestures that belong to something else stay theirs: reordering a
  // supplement, dragging a pain slider, swiping a wide table sideways.
  // The workout player too: its picture, zoom and controls are not a pull.
  if (e.target.closest?.('[data-drag], input[type=range], .scroll-x, table, [data-player]')) return;
  pullY0 = e.touches[0].clientY;
  pullX0 = e.touches[0].clientX;
  pullDy = 0;
  pullWatching = true;
  window.addEventListener('touchmove', onPullMove, { passive: false });
}, { passive: true });

const pullRelease = () => { if (pullWatching) pullStop(pulling && pullDy >= PULL_TRIGGER); };
window.addEventListener('touchend', pullRelease, { passive: true });
// touchcancel honours the pull exactly as touchend does. iOS cancels a touch
// when the system takes it over, a notification arriving, an edge gesture,
// and treating that as "never happened" meant a pull you had completed could
// silently do nothing. Syncing is idempotent, so acting on a committed pull is
// always the safer of the two.
window.addEventListener('touchcancel', pullRelease, { passive: true });

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS[v] && v !== ctx.view) { if (ctx.view === 'player') playerLeaving(); ctx.view = v; paint(); }
});

// The first time this build opens, milestones already earned are recorded as
// celebrated without a moment, so nothing old replays as a burst.
function seedCelebrations() {
  if (state.readOnly || !needsSeed(state.data)) return;
  update((d) => { markSeen(d, todayIso()); });
}

subscribe(paintChrome);
onRemoteChange(() => paint());

// Sync when the app returns to the foreground or regains a connection, this
// is what uploads the queue after Airplane Mode without you doing anything.
window.addEventListener('online', () => { if (isConfigured()) runSync('online'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isConfigured()) runSync('foreground');
});

load().then(() => {
  recoverEdits();
  seedCelebrations();
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
  // offline launch work, but it also means a fresh deploy would otherwise sit
  // unused until the SECOND launch, with the page still running the previous
  // CSS and code. Reloading once when a new worker takes control closes that
  // gap. Local data lives in IndexedDB and is untouched by any of this, so an
  // update can never cost you anything.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;   // not the very first install
    if (window.__rehabForceUpdate) return;       // Force update reloads when its cache is ready
    reloading = true;
    // Never mid-workout: the draft is safe either way, but a reload would
    // throw him out of the set he is doing. Wait for the player to close.
    // After the player closes, the same barrier as below still applies (A19):
    // a field in use or a save still landing waits.
    if (playerBusy()) {
      window.addEventListener('rehab-player-idle', () => {
        whenIdle(viewEl, saveOutstanding).then(() => location.reload());
      }, { once: true });
      return;
    }
    // Nor while he is typing, or before his last change has been saved on this
    // device: a reload then would lose it.
    whenIdle(viewEl, saveOutstanding).then(() => location.reload());
  });

  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    // Check for a new version on foreground, but at most every 30 minutes:
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
