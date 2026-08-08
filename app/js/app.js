import { load, state, subscribe, runSync, syncState, pendingSyncCount, onRemoteChange } from './store.js';
import { esc, todayIso, postOp, applyStoredTheme } from './util.js';
import { isConfigured } from './sync/config.js';
import { renderToday, bindToday } from './views/today.js';
import { renderProgram, bindProgram } from './views/program.js';
import { renderPlan, bindPlan } from './views/planview.js';
import { renderSupplements, bindSupplements } from './views/supplements.js';
import { renderProgress, bindProgress } from './views/progress.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { toast } from './components.js';

applyStoredTheme();   // before first paint, so there is no flash

const VIEWS = {
  today: [renderToday, bindToday],
  program: [renderProgram, bindProgram],
  plan: [renderPlan, bindPlan],
  supplements: [renderSupplements, bindSupplements],
  progress: [renderProgress, bindProgress],
  settings: [renderSettings, bindSettings],
};

const ctx = {
  view: location.hash.slice(1) || 'today',
  date: todayIso(),
  go(v) { ctx.view = v; history.replaceState(null, '', '#' + v); paint(); },
};

const viewEl = document.getElementById('view');

let lastView = null;

function paint() {
  const y = window.scrollY;
  const [render, bind] = VIEWS[ctx.view] || VIEWS.today;
  viewEl.innerHTML = render(ctx);
  bind?.(viewEl, ctx, paint);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === ctx.view));
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
  const L = postOp(s.surgeryLeft, today);
  const R = postOp(s.surgeryRight, today);
  const bits = [];
  if (L && !L.future) bits.push(`<b>L</b> ${L.weeks}w${L.rem ? ' ' + L.rem + 'd' : ''}`);
  if (R && !R.future) bits.push(`<b>R</b> ${R.weeks}w${R.rem ? ' ' + R.rem + 'd' : ''}`);
  document.getElementById('postop-strip').innerHTML = bits.length ? bits.join(' &nbsp;·&nbsp; ') + ' post-op' : '';

  const el = document.getElementById('save-state');
  document.body.classList.toggle('readonly', !!state.readOnly);
  if (state.error) { el.textContent = state.error; el.className = 'save-state err'; }
  else if (state.saving) { el.textContent = 'saving…'; el.className = 'save-state'; }
  else if (state.lastSaved) { el.textContent = 'saved'; el.className = 'save-state'; }
  else { el.textContent = ''; el.className = 'save-state'; }

  // The same sync chip the phone shows. save-state is the LOCAL save (the
  // JSON file on this Mac); the chip is the cloud relay — different facts.
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
  if (VIEWS[v] && v !== ctx.view) { ctx.view = v; paint(); }
});

subscribe(paintChrome);
// A pull that changed the document must repaint the visible view — the phone
// has always done this; the Mac was quietly showing stale data until a click.
onRemoteChange(() => paint());

// Opening the app pulls anything new from PhysiApp. Silent unless it actually
// finds something — the server skips the call outright when the credentials
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
      // A rejected code is — otherwise syncing dies quietly and the log goes
      // stale without you ever being told.
      if (out.kind && out.kind !== 'network') {
        toast(`⚠️ <b>PhysiApp sync stopped</b><br><span>${esc(out.message)}</span>`, 'warn');
      }
      return;
    }
    if (out.skipped) return;
    if (!(out.added || out.updated)) return;
    await load();
    paint();
    toast(`✅ <b>${esc(out.message)}</b><br><span>from PhysiApp, just now</span>`);
  } catch (err) {
    /* offline, or the Mac woke without Wi-Fi — never block the app for it */
  }
}

load().then(() => { paint(); autoSync(); });
