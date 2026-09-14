import { load, state, update, subscribe, runSync, syncState, pendingSyncCount, onRemoteChange, surgeryDate, flushSave, saveOutstanding } from './store.js';
import { guardPaint, whenIdle } from './editguard.js';
import { chipState } from './status.js';
import { esc, todayIso, postOp, applyStoredTheme } from './util.js';
import { isConfigured } from './sync/config.js';
import { needsSeed, markSeen } from './milestones.js';
import { renderToday, bindToday } from './views/today.js';
import { renderProgram, bindProgram } from './views/program.js';
import { renderPlan, bindPlan } from './views/planview.js';
import { renderSupplements, bindSupplements } from './views/supplements.js';
import { renderProgress, bindProgress } from './views/progress.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { renderPlayer, bindPlayer, playerLeaving, playerBusy } from './player/player.js';
import { toast } from './components.js';

applyStoredTheme();   // before first paint, so there is no flash

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

const ctx = {
  view: location.hash.slice(1) || 'today',
  date: todayIso(),
  go(v) {
    if (ctx.view === 'player' && v !== 'player') playerLeaving();
    ctx.view = v; history.replaceState(null, '', '#' + v); paint();
  },
};

const viewEl = document.getElementById('view');

let lastView = null;

// Repaints wait while a field is in use (editguard.js); a change of tab does not.
const paint = guardPaint(viewEl, rawPaint, () => ctx.view !== lastView);

function rawPaint() {
  const y = window.scrollY;
  const [render, bind] = VIEWS[ctx.view] || VIEWS.today;
  document.body.classList.toggle('in-player', ctx.view === 'player');
  viewEl.innerHTML = render(ctx);
  bind?.(viewEl, ctx, paint);
  // The player belongs to the tab it was opened from.
  const tabView = ctx.view === 'player' ? (ctx.playerFrom || 'today') : ctx.view;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === tabView));
  paintChrome();
  // Changing tab starts at the top; re-rendering in place keeps your position.
  window.scrollTo({ top: ctx.view === lastView ? y : 0 });
  lastView = ctx.view;
}

// A sync with nothing to send finishes within a couple of frames; hold the
// busy state on screen long enough to be seen. Same treatment as the phone.
const BUSY_MIN_MS = 750;
let busyUntil = 0;
let busyTimer = null;
function holdBusy() {
  busyUntil = Date.now() + BUSY_MIN_MS;
  paintChrome();
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => { busyTimer = null; paintChrome(); }, BUSY_MIN_MS + 30);
}

function paintChrome() {
  const s = state.data.settings;
  // The app's name is yours, so it travels in your synced settings rather than
  // sitting in a public HTML file.
  const title = s.appTitle || 'Rehab tracker';
  const h1 = document.getElementById('app-title');
  if (h1 && h1.textContent !== title) h1.textContent = title;
  if (document.title !== title) document.title = title;
  const today = todayIso();
  const L = postOp(surgeryDate('left'), today);
  const R = postOp(surgeryDate('right'), today);
  const bits = [];
  if (L && !L.future) bits.push(`<b>L</b> ${L.weeks}w${L.rem ? ' ' + L.rem + 'd' : ''}`);
  if (R && !R.future) bits.push(`<b>R</b> ${R.weeks}w${R.rem ? ' ' + R.rem + 'd' : ''}`);
  document.getElementById('postop-strip').innerHTML = bits.length ? bits.join(' &nbsp;·&nbsp; ') + ' post-op' : '';

  const el = document.getElementById('save-state');
  document.body.classList.toggle('readonly', !!state.readOnly);
  // Saving and syncing now share the chip. This line is kept only for an error
  // long enough to need its full sentence.
  el.textContent = state.error || '';
  el.className = state.error ? 'save-state err' : 'save-state';

  // The same sync chip the phone shows. save-state is the LOCAL save (the
  // JSON file on this Mac); the chip is the cloud relay, different facts.
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
}

document.getElementById('sync-btn').addEventListener('click', async () => {
  if (!isConfigured()) return ctx.go('settings');
  holdBusy();
  await runSync('manual');
  paint();
});

document.getElementById('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) ctx.go(b.dataset.view);
});
document.getElementById('nav-settings').addEventListener('click', () => ctx.go('settings'));
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
// A pull that changed the document must repaint the visible view, the phone
// has always done this; the Mac was quietly showing stale data until a click.
onRemoteChange(() => paint());

// Opening the app pulls anything new from PhysiApp. Silent unless it actually
// finds something: the server skips the call outright when the credentials
// are missing, auto-sync is off, or it already ran in the last few minutes.
async function autoSync() {
  if (state.readOnly) return;
  const pa = state.data.settings.physiapp || {};
  if (!pa.code || !pa.birthYear) return;
  try {
    const res = await fetch('/api/physiapp/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: 2, auto: true }),
    });
    const out = await res.json();
    if (!out.ok) {
      // Offline or their server hiccuping is not worth a nag on every open.
      // A rejected code is, otherwise syncing dies quietly and the log goes
      // stale without you ever being told.
      if (out.kind && out.kind !== 'network') {
        toast(`<b>PhysiApp sync stopped</b><br><span>${esc(out.message)}</span>`, 'warn');
      }
      return;
    }
    if (out.skipped) return;
    if (!(out.added || out.updated)) return;
    // The server wrote the file; reading it back replaces what is in memory.
    // Wait until he is not typing, and save anything outstanding first, or a
    // change he just made would be overwritten by the older copy.
    await whenIdle(viewEl);
    await flushSave();
    await load();
    paint();
    toast(`<b>${esc(out.message)}</b><br><span>from PhysiApp, just now</span>`);
  } catch (err) {
    /* offline, or the Mac woke without Wi-Fi, never block the app for it */
  }
}

load().then(() => { seedCelebrations(); paint(); autoSync(); });
