// The iPhone interface.
//
// Shares ALL business logic with the desktop app — same store, same merge, same
// records, same program/plan/measure definitions. Only the presentation differs,
// and it differs completely: a bottom tab bar, a big daily hero, full-width
// touch rows, and a bottom sheet for entry instead of an inline expander.
//
// Nothing here depends on hover, and every control is at least 44px.

import {
  state, subscribe, load, update, ensureDay, runSync, syncState,
  pendingSyncCount, onRemoteChange, DEVICE_ID,
} from './store.js';
import { esc, todayIso, fmtDate, uid, num, postOp } from './util.js';
import { REHAB_PROGRAM, PROGRAM_SOURCE, THERABAND } from '../data/program.js';
import { MEASURE_BY_ID, UNIT_LABEL } from '../data/measurements.js';
import { monthForDate } from '../data/plan.js';
import { getConfig, setConfig, clearConfig, isConfigured } from './sync/config.js';
import { ghCheckAccess } from './sync/github.js';

const viewEl = document.getElementById('view');
const ctx = { view: 'today', date: todayIso(), sheet: null };

// ----------------------------------------------------------------- utils ---
const exName = (item) => item.title || item.ex;
const dayOf = () => state.data.days[ctx.date] || null;
const entriesFor = (pid) => (dayOf()?.entries || []).filter((e) => e.pid === pid);
const isDone = (pid) => {
  const mine = entriesFor(pid);
  return mine.length > 0 && mine.every((e) => e.logged);
};

function toast(msg) {
  document.querySelector('.mtoast')?.remove();
  const el = document.createElement('div');
  el.className = 'mtoast';
  el.innerHTML = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ------------------------------------------------------------------ views ---
function todayView() {
  const iso = ctx.date;
  const day = state.data.days[iso];
  const items = REHAB_PROGRAM.filter((p) => !p.notYet);
  const done = items.filter((p) => isDone(p.id)).length;
  const month = monthForDate(iso);
  const logged = (day?.entries || []).filter((e) => e.logged).length;
  const measures = (state.data.measurements || []).filter((m) => m.date === iso).length;

  return `
  ${connectBanner()}
  <div class="mhero">
    <div class="date">${esc(fmtDate(iso))}</div>
    <div class="big">${done} of ${items.length} done</div>
    <div class="sub">${month ? esc(`${month.name} · ${month.title}`) : 'Rehab program'}</div>
    <div class="mhero-row">
      <div class="mhero-stat"><b>${logged}</b><span>exercises logged</span></div>
      <div class="mhero-stat"><b>${measures}</b><span>tests recorded</span></div>
    </div>
  </div>

  <div class="msection">
    <div class="msection-h"><h2>Program</h2><span class="sub">tap a row to log it</span></div>
    ${items.map(programRow).join('')}
  </div>

  ${REHAB_PROGRAM.some((p) => p.notYet) ? `
  <div class="msection">
    <div class="msection-h"><h2>Not yet</h2></div>
    ${REHAB_PROGRAM.filter((p) => p.notYet).map(programRow).join('')}
  </div>` : ''}`;
}

function programRow(item) {
  const mine = entriesFor(item.id);
  const done = isDone(item.id);
  const bits = [];
  if (item.sets) bits.push(`${item.sets} × ${item.reps ?? '?'}`);
  if (item.hold) bits.push(`hold ${item.hold}`);
  if (item.sides === 'each') bits.push('each side');
  if (item.sides === 'left') bits.push('left only');
  const logged = mine.filter((e) => e.logged);
  const summary = logged.length
    ? logged.map((e) => {
      const p = [];
      if (e.sets && e.reps) p.push(`${e.sets}×${e.reps}`);
      if (num(e.secsL) != null || num(e.secsR) != null) p.push(`L ${e.secsL ?? '–'} · R ${e.secsR ?? '–'}s`);
      else if (num(e.secs) != null) p.push(`${e.secs}s`);
      if (num(e.testL) != null || num(e.testR) != null) p.push(`best ${e.testL ?? '–'}/${e.testR ?? '–'}`);
      return p.join(' · ');
    }).filter(Boolean).join(' · ')
    : '';

  return `
  <div class="mrow ${done ? 'done' : ''}" data-pid="${esc(item.id)}">
    <button class="mrow-tick" data-tick="${esc(item.id)}" aria-label="${done ? 'Mark not done' : 'Mark done'}"><i>✓</i></button>
    <div class="mrow-main" data-open="${esc(item.id)}">
      <div class="mrow-name">${esc(exName(item))}</div>
      <div class="mrow-meta">${esc(summary || bits.join(' · '))}</div>
    </div>
    <div class="mrow-go" data-open="${esc(item.id)}">›</div>
  </div>`;
}

function programView() {
  const src = PROGRAM_SOURCE;
  return `
  <div class="msection">
    <div class="msection-h"><h2>${esc(src.title || 'Program')}</h2>
      <span class="sub">${esc(src.clinician || '')}</span></div>
    ${REHAB_PROGRAM.map((item) => `
      <div class="mcard">
        <div class="mrow-name">${esc(exName(item))}</div>
        <div class="mrow-meta" style="margin-top:.25rem">
          ${item.sets ? `<span class="mchip">${item.sets} × ${item.reps ?? '?'}</span>` : ''}
          ${item.hold ? `<span class="mchip">hold ${esc(item.hold)}</span>` : ''}
          ${item.sides === 'each' ? '<span class="mchip">each side</span>' : ''}
          ${item.notYet ? '<span class="mchip">not yet</span>' : ''}
        </div>
        ${item.cue ? `<div class="mnote" style="margin-top:.4rem">${esc(item.cue)}</div>` : ''}
      </div>`).join('')}
  </div>`;
}

function progressView() {
  const days = Object.keys(state.data.days || {}).sort().reverse().slice(0, 21);
  const ms = (state.data.measurements || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);
  return `
  <div class="msection">
    <div class="msection-h"><h2>Recent days</h2></div>
    ${days.length ? days.map((iso) => {
      const d = state.data.days[iso];
      const n = (d.entries || []).filter((e) => e.logged).length;
      return `<div class="mrow" data-goto="${esc(iso)}">
        <div class="mrow-main">
          <div class="mrow-name">${esc(fmtDate(iso))}</div>
          <div class="mrow-meta">${n} logged${d.notes ? ' · has notes' : ''}</div>
        </div><div class="mrow-go">›</div></div>`;
    }).join('') : '<div class="mempty">Nothing logged yet.</div>'}
  </div>
  <div class="msection">
    <div class="msection-h"><h2>Latest tests</h2></div>
    ${ms.length ? ms.map((m) => {
      const def = MEASURE_BY_ID[m.measure];
      return `<div class="mcard">
        <div class="mrow-name">${esc(def?.label || m.measure)}</div>
        <div class="mrow-meta">${esc(fmtDate(m.date))} ·
          ${m.leg ? `<span class="mchip ${m.leg}">${m.leg}</span>` : ''}
          <b>${esc(String(m.value))}${esc(UNIT_LABEL[def?.unit] || '')}</b></div>
      </div>`;
    }).join('') : '<div class="mempty">No tests recorded yet.</div>'}
  </div>`;
}

function settingsView() {
  const c = getConfig();
  const connected = isConfigured();
  const pending = pendingSyncCount();
  const last = c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString() : 'never';
  return `
  <div class="msection">
    <div class="msection-h"><h2>Sync</h2><span class="sub">this device</span></div>
    ${connected ? `
      <div class="mbanner good">
        <b>Connected</b> to ${esc(c.owner)}/${esc(c.repo)}.<br>
        Last synced ${esc(last)}.${pending ? ` <b>${pending}</b> change${pending === 1 ? '' : 's'} waiting to upload.` : ' Everything is uploaded.'}
      </div>
      <button class="mbtn" data-act="sync">Sync now</button>
      <button class="mbtn ghost" data-act="disconnect">Disconnect this device</button>
      <div class="mnote" style="margin-top:.7rem">
        Your data stays on this device either way. Disconnecting only forgets the token.
      </div>
    ` : `
      <div class="mbanner">
        <b>Not connected.</b> This device works fully offline on its own.
        Connect it to share data with your Mac.
      </div>
      <div class="mfields">
        <div class="mfield"><span>GitHub user</span><input id="cf-owner" value="${esc(c.owner || '')}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="mfield"><span>Repo</span><input id="cf-repo" value="${esc(c.repo || 'acl-rehab-data')}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
        <div class="mfield wide"><span>Access token</span><input id="cf-token" type="password" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      </div>
      <button class="mbtn" data-act="connect">Connect</button>
      <div class="mnote" style="margin-top:.7rem">
        The token is stored on this device only. It is never sent anywhere except GitHub.
      </div>
    `}
  </div>

  <div class="msection">
    <div class="msection-h"><h2>This device</h2></div>
    <div class="mcard">
      <div class="mnote">
        Device id <b>${esc(DEVICE_ID)}</b><br>
        Records held locally: <b>${Object.keys(state.data._sync?.rec || {}).length}</b><br>
        Storage: <b>${location.hostname === 'localhost' ? 'local server' : 'on-device database'}</b>
      </div>
    </div>
  </div>`;
}

function connectBanner() {
  if (isConfigured()) return '';
  return `<div class="mbanner warn">
    Working offline on this device only — open <b>Settings</b> to sync with your Mac.
  </div>`;
}

// ------------------------------------------------------------------ sheet ---
function openSheet(pid) {
  const item = REHAB_PROGRAM.find((p) => p.id === pid);
  if (!item) return;
  const day = ensureDayLocal();
  let mine = day.entries.filter((e) => e.pid === pid);
  if (!mine.length) {
    update(() => {
      const d = ensureDay(ctx.date);
      const sides = { each: ['L', 'R'], left: ['L'], right: ['R'] }[item.sides] || ['B'];
      for (const s of sides) {
        d.entries.push({
          id: uid(), pid: item.id, ex: item.ex, side: s, logged: false,
          sets: item.sets, reps: item.reps,
        });
      }
    });
    mine = (state.data.days[ctx.date].entries || []).filter((e) => e.pid === pid);
  }
  ctx.sheet = pid;
  renderSheet(item, mine);
}

function ensureDayLocal() {
  if (!state.data.days[ctx.date]) update(() => { ensureDay(ctx.date); });
  return state.data.days[ctx.date];
}

function renderSheet(item, mine) {
  const back = document.createElement('div');
  back.className = 'msheet-back';
  back.innerHTML = `
    <div class="msheet" role="dialog" aria-label="${esc(exName(item))}">
      <div class="msheet-grip"></div>
      <h3>${esc(exName(item))}</h3>
      <div class="sub">${item.sets ? `${item.sets} × ${item.reps ?? '?'}` : ''}${item.hold ? ` · hold ${esc(item.hold)}` : ''}</div>
      ${mine.map((e) => sheetFields(e, item)).join('')}
      <button class="mbtn" data-sheet-log>Log it</button>
      <button class="mbtn ghost" data-sheet-close>Close</button>
    </div>`;
  document.body.appendChild(back);

  back.addEventListener('click', (ev) => { if (ev.target === back) closeSheet(); });
  back.querySelector('[data-sheet-close]').addEventListener('click', closeSheet);

  back.querySelectorAll('[data-f]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const id = inp.closest('[data-entry]').dataset.entry;
      update(() => {
        const e = state.data.days[ctx.date].entries.find((x) => x.id === id);
        if (e) e[inp.dataset.f] = inp.type === 'number' ? num(inp.value) : inp.value;
      });
    });
  });

  back.querySelector('[data-sheet-log]').addEventListener('click', () => {
    update(() => {
      for (const e of state.data.days[ctx.date].entries) {
        if (e.pid === item.id) e.logged = true;
      }
    });
    closeSheet();
    toast('✅ Logged');
  });
}

function sheetFields(e, item) {
  const sideLabel = e.side === 'L' ? 'Left' : e.side === 'R' ? 'Right' : 'Both sides';
  const usesSecs = !!item.hold;
  return `
  <div data-entry="${esc(e.id)}" style="margin-top:.9rem">
    <div class="mchip ${e.side}">${esc(sideLabel)}</div>
    <div class="mfields" style="margin-top:.4rem">
      <div class="mfield"><span>Sets</span>
        <input type="number" inputmode="numeric" data-f="sets" value="${e.sets ?? ''}"></div>
      <div class="mfield"><span>Reps</span>
        <input type="number" inputmode="numeric" data-f="reps" value="${e.reps ?? ''}"></div>
      ${usesSecs ? `<div class="mfield"><span>Seconds</span>
        <input type="number" inputmode="numeric" data-f="secs" value="${e.secs ?? ''}"></div>` : ''}
      <div class="mfield"><span>Load</span>
        <input type="number" inputmode="decimal" data-f="load" value="${e.load ?? ''}"></div>
      <div class="mfield wide"><span>Note</span>
        <input type="text" data-f="notes" value="${esc(e.notes || '')}"></div>
    </div>
  </div>`;
}

function closeSheet() {
  ctx.sheet = null;
  document.querySelector('.msheet-back')?.remove();
}

// ------------------------------------------------------------------ paint ---
const VIEWS = { today: todayView, program: programView, progress: progressView, settings: settingsView };

function paint() {
  const y = viewEl.scrollTop;
  viewEl.innerHTML = (VIEWS[ctx.view] || todayView)();
  bind();
  document.querySelectorAll('#mtabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === ctx.view));
  viewEl.scrollTop = ctx.view === paint._last ? y : 0;
  paint._last = ctx.view;
  paintChrome();
}

function paintChrome() {
  const s = state.data.settings || {};
  const title = s.appTitle || 'Rehab';
  const h1 = document.getElementById('app-title');
  if (h1 && h1.textContent !== title) h1.textContent = title;

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
  const pending = isConfigured() ? pendingSyncCount() : 0;
  dot.className = 'msync-dot';
  if (!isConfigured()) { label.textContent = 'Offline'; }
  else if (syncState.running) { dot.classList.add('busy'); label.textContent = 'Syncing'; }
  else if (syncState.lastError) { dot.classList.add('err'); label.textContent = 'Retry'; }
  else if (pending) { dot.classList.add('pending'); label.textContent = String(pending); }
  else { dot.classList.add('ok'); label.textContent = 'Synced'; }
}

function bind() {
  viewEl.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openSheet(el.dataset.open));
  });
  viewEl.querySelectorAll('[data-tick]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const pid = el.dataset.tick;
      const item = REHAB_PROGRAM.find((p) => p.id === pid);
      const on = !isDone(pid);
      update(() => {
        const d = ensureDay(ctx.date);
        const mine = d.entries.filter((e) => e.pid === pid);
        if (!mine.length) {
          const sides = { each: ['L', 'R'], left: ['L'], right: ['R'] }[item.sides] || ['B'];
          for (const s of sides) {
            d.entries.push({ id: uid(), pid, ex: item.ex, side: s, logged: true, sets: item.sets, reps: item.reps });
          }
        } else {
          for (const e of mine) e.logged = on;
        }
      });
      paint();
    });
  });
  viewEl.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => { ctx.date = el.dataset.goto; ctx.view = 'today'; paint(); });
  });

  viewEl.querySelector('[data-act="sync"]')?.addEventListener('click', async () => {
    toast('Syncing…');
    const res = await runSync('manual');
    toast(res.ok
      ? `✅ Synced${res.pulled ? ` · ${res.pulled} in` : ''}${res.pushed ? ` · ${res.pushed} out` : ''}`
      : `⚠️ ${esc(res.reason || 'failed')}`);
    paint();
  });

  viewEl.querySelector('[data-act="disconnect"]')?.addEventListener('click', () => {
    clearConfig();
    toast('Disconnected — your data is still here');
    paint();
  });

  viewEl.querySelector('[data-act="connect"]')?.addEventListener('click', async () => {
    const owner = viewEl.querySelector('#cf-owner').value.trim();
    const repo = viewEl.querySelector('#cf-repo').value.trim();
    const token = viewEl.querySelector('#cf-token').value.trim();
    if (!owner || !repo || !token) return toast('⚠️ Fill in all three');
    toast('Checking…');
    const check = await ghCheckAccess({ owner, repo, token });
    if (!check.ok) {
      return toast(check.reason === 'bad-token' ? '⚠️ Token rejected'
        : check.reason === 'no-repo' ? '⚠️ Repo not found for that token'
        : `⚠️ ${esc(check.reason)}`);
    }
    setConfig({ owner, repo, token, path: 'state.json' });
    toast('Connected — syncing…');
    const res = await runSync('connect');
    toast(res.ok ? '✅ Synced' : `⚠️ ${esc(res.reason || 'sync failed')}`);
    paint();
  });
}

// ------------------------------------------------------------------- boot ---
document.getElementById('mtabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) { ctx.view = b.dataset.view; closeSheet(); paint(); }
});
document.getElementById('sync-btn').addEventListener('click', async () => {
  if (!isConfigured()) { ctx.view = 'settings'; return paint(); }
  const res = await runSync('manual');
  toast(res.ok ? '✅ Synced' : `⚠️ ${esc(res.reason || 'failed')}`);
  paint();
});

subscribe(paintChrome);
onRemoteChange(() => paint());

// Sync when the app comes back to the foreground or regains a connection —
// this is what makes "reopen after Airplane Mode" upload the queue.
window.addEventListener('online', () => { if (isConfigured()) runSync('online'); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isConfigured()) runSync('foreground');
});

load().then(() => {
  paint();
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // NEVER on the Mac. The worker claims every navigation in its scope and
    // answers them with the mobile shell, which would hijack the desktop app
    // (and this repo's test page) served from the same origin. Registering it
    // here once already did exactly that, so also clean up after ourselves.
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => r.unregister()))
      .catch(() => {});
    return;
  }
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
});
