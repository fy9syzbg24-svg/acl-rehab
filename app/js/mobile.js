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
import { esc, todayIso, postOp } from './util.js';
import { renderToday, bindToday } from './views/today.js';
import { renderProgram, bindProgram } from './views/program.js';
import { renderPlan, bindPlan } from './views/planview.js';
import { renderMelbourne, bindMelbourne } from './views/melbourneview.js';
import { renderProgress, bindProgress } from './views/progress.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { isConfigured } from './sync/config.js';

const VIEWS = {
  today: [renderToday, bindToday],
  program: [renderProgram, bindProgram],
  plan: [renderPlan, bindPlan],
  melbourne: [renderMelbourne, bindMelbourne],
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

const ctx = {
  view: (location.hash.slice(1) || 'today'),
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
  const y = viewEl.scrollTop;
  const [render, bind] = VIEWS[ctx.view] || VIEWS.today;
  viewEl.innerHTML = render(ctx);
  bind?.(viewEl, ctx, paint);
  document.querySelectorAll('#mtabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === ctx.view);
  });
  document.getElementById('nav-settings')?.classList.toggle('on', ctx.view === 'settings');
  // Re-rendering in place keeps your scroll position; changing tab starts at
  // the top. The scrolling element is the middle region, not the document.
  viewEl.scrollTop = ctx.view === lastView ? y : 0;
  lastView = ctx.view;
  paintChrome();
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
  if (syncState.running) { dot.classList.add('busy'); label.textContent = 'Sync'; }
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
    // Check for a new version whenever the app comes back to the foreground,
    // so reopening it is enough to pick one up.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
});
