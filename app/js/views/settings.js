import { esc, todayIso, uid, num } from '../util.js';
import { state, update, load } from '../store.js';
import { CASE } from '../../data/history.js';
import { toast } from '../components.js';
import { runSync, syncState, pendingSyncCount, DEVICE_ID } from '../store.js';
import { getConfig, setConfig, clearConfig, isConfigured } from '../sync/config.js';
import { ghCheckAccess } from '../sync/github.js';

function syncCard() {
  const c = getConfig();
  const pending = isConfigured() ? pendingSyncCount() : 0;
  const last = c.lastSyncedAt ? new Date(c.lastSyncedAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  if (!isConfigured()) {
    return `
      <div class="callout small" style="margin-bottom:.8rem">
        This Mac keeps its own complete copy of your log on disk and works with no
        internet at all. Connecting adds a private GitHub repo as a relay, so your
        iPhone can pick up changes when either device is online — neither needs the
        other to be switched on.
      </div>
      <div class="grid3">
        <label class="fld">GitHub user<input id="sy-owner" value="${esc(c.owner || '')}" autocomplete="off" spellcheck="false"></label>
        <label class="fld">Repository<input id="sy-repo" value="${esc(c.repo || 'acl-rehab-data')}" autocomplete="off" spellcheck="false"></label>
        <label class="fld">Access token<input id="sy-token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
      </div>
      <div class="row" style="margin-top:.7rem"><button class="btn primary" data-sy-connect>Connect this Mac</button></div>
      <div class="tiny muted" style="margin-top:.5rem">
        The token is stored on this Mac only, outside your synced data, and is sent
        nowhere except GitHub.
      </div>`;
  }
  return `
    <div class="callout good small" style="margin-bottom:.6rem">
      <strong>Connected</strong> to ${esc(c.owner)}/${esc(c.repo)} · last synced ${esc(last)}.
      ${pending ? `<strong>${pending}</strong> change${pending === 1 ? '' : 's'} waiting to upload.` : 'Everything is uploaded.'}
    </div>
    <div class="row">
      <button class="btn primary" data-sy-sync>${syncState.running ? 'Syncing…' : 'Sync now'}</button>
      <button class="btn" data-sy-disconnect>Disconnect this Mac</button>
      <span class="tiny muted">device <span class="mono">${esc(DEVICE_ID)}</span> · build <span class="mono" id="build-id">…</span></span>
    </div>
    <details class="disc" style="margin-top:.7rem">
      <summary>Screen diagnostics</summary>
      <pre class="tiny mono" id="geo-report" style="white-space:pre-wrap;line-height:1.5;margin:.4rem 0 0">measuring…</pre>
    </details>
    ${syncState.lastError ? `<div class="callout warn small" style="margin-top:.6rem">
      Last sync failed (${esc(syncState.lastError.reason || 'error')}). Your data is safe here and
      will upload on the next attempt.</div>` : ''}
    <div class="tiny muted" style="margin-top:.5rem">
      Disconnecting only forgets the token — nothing is deleted from this Mac.
    </div>`;
}

export function renderSettings() {
  const s = state.data.settings;
  const pa = s.physiapp || {};
  const connected = !!(pa.code && pa.birthYear);
  const auto = s.physiappAuto !== false;
  return `
  <div class="stack">
    <section class="card">
      <header><h2>Your surgeries</h2></header>
      <div class="card-body">
        <div class="grid3">
          <label class="fld">Injury date<input type="date" data-set="injuryDate" value="${esc(s.injuryDate || '')}"></label>
          <label class="fld">Left ACL reconstruction<input type="date" data-set="surgeryLeft" value="${esc(s.surgeryLeft || '')}"></label>
          <label class="fld">Right ACL reconstruction<input type="date" data-set="surgeryRight" value="${esc(s.surgeryRight || '')}"></label>
        </div>
        <div class="callout small" style="margin-top:.8rem">
          <strong>Left</strong> — ${esc(CASE.legs.left.procedure)}. ${esc(CASE.legs.left.weightBearing)}. ${esc(CASE.legs.left.complication)}<br>
          <strong>Right</strong> — ${esc(CASE.legs.right.procedure)}. ${esc(CASE.legs.right.weightBearing)}. ${esc(CASE.legs.right.complication)}<br>
          ${esc(CASE.protocolNote)}
        </div>
        <div class="callout warn small" style="margin-top:.6rem">
          Dates come from your clinical notes. Change them above if anything is wrong.
        </div>
      </div>
    </section>

    <section class="card">
      <header><h2>Units &amp; body</h2></header>
      <div class="card-body">
        <div class="grid3">
          <label class="fld">Weight unit
            <select data-set="weightUnit">
              <option value="kg" ${s.weightUnit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="lb" ${s.weightUnit === 'lb' ? 'selected' : ''}>lb</option>
            </select></label>
          <label class="fld">Length unit
            <select data-set="lengthUnit">
              <option value="cm" ${s.lengthUnit === 'cm' ? 'selected' : ''}>cm</option>
              <option value="in" ${s.lengthUnit === 'in' ? 'selected' : ''}>in</option>
            </select></label>
          <label class="fld">Dominant leg
            <select data-set="dominantLeg">
              <option value="right" ${s.dominantLeg === 'right' ? 'selected' : ''}>Right</option>
              <option value="left" ${s.dominantLeg === 'left' ? 'selected' : ''}>Left</option>
            </select></label>
        </div>
        <label class="fld" style="margin-top:.6rem;max-width:220px">Bodyweight (${esc(s.weightUnit)})
          <input type="number" step="any" data-set="bodyweight" value="${s.bodyweight ?? ''}" placeholder="needed for 1.5x / 1.8x BW goals">
        </label>
        <div class="tiny muted" style="margin-top:.3rem">
          The plan's 1.5x and 1.8x bodyweight squat and leg-press targets cannot be scored without this.
          Recording a "Bodyweight" measurement on the Measures tab takes priority over this field.
        </div>
      </div>
    </section>

    <section class="card">
      <header><h2>Your data</h2><span class="sub">stored in acl-rehab/data/rehab-data.json</span></header>
      <div class="card-body">
        <div class="row">
          <button class="btn" data-export>Download a backup (JSON)</button>
          <button class="btn" data-export-csv>Export training log (CSV)</button>
          <label class="btn" style="cursor:pointer">Import a backup<input type="file" accept="application/json" data-import hidden></label>
        </div>
        <div class="tiny muted" style="margin-top:.5rem">
          The server also keeps the last 40 auto-backups in <span class="mono">data/backups/</span> — one per save.
        </div>
        <div class="row" style="margin-top:.9rem">
          <button class="btn danger" data-reseed>Re-add the seeded clinic sessions</button>
        </div>
        <div class="tiny muted" style="margin-top:.3rem">Use this if you deleted the seeded clinic entries and want them back.</div>
      </div>
    </section>

    <section class="card">
      <header><h2>Device sync</h2><span class="sub">share this log with your iPhone</span></header>
      <div class="card-body">
        ${syncCard()}
      </div>
    </section>

    <section class="card">
      <header><h2>PhysiApp sync</h2><span class="sub">pulls what you actually ticked off</span></header>
      <div class="card-body">
        <div class="callout small" style="margin-bottom:.8rem">
          Signs in to au.physiapp.com the way the website does and reads your real numbers —
          the reps, sets and hold you entered when you tapped an exercise done. It reads only;
          it never marks anything complete on their side.
        </div>

        ${connected ? `
        <div class="callout good small" style="margin-bottom:.6rem">
          <strong>Connected.</strong> ${s.physiappLastSync
            ? `Last synced ${esc(new Date(s.physiappLastSync).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }))}.`
            : 'Not synced yet.'}
          ${auto ? 'It checks again on its own every time you open the app.' : 'Automatic syncing is off.'}
        </div>` : ''}

        <details class="disc" style="margin-bottom:.6rem" ${connected ? '' : 'open'}>
          <summary>${connected ? 'Change the sign-in details' : 'Sign in — enter these once'}</summary>
          <div class="grid2" style="padding:.4rem 0 .2rem">
            <label class="fld">Program code
              <input data-pa="code" value="${esc(pa.code || '')}" placeholder="from your clinician" autocomplete="off" spellcheck="false">
            </label>
            <label class="fld">Year of birth
              <input data-pa="birthYear" type="number" min="1900" max="2100" value="${esc(String(pa.birthYear || ''))}" autocomplete="off" placeholder="e.g. 1993">
            </label>
          </div>
          <div class="tiny muted">
            Typed once and kept in <span class="mono">data/rehab-data.json</span> on this Mac, nowhere
            else. Their session lasts 14 days and it re-signs in on its own, so you should not need
            to come back here.
          </div>
        </details>

        <label class="row" style="gap:.5rem;align-items:center;margin-bottom:.6rem;cursor:pointer">
          <input type="checkbox" data-pa-auto ${auto ? 'checked' : ''}>
          <span class="tiny">Sync automatically whenever I open the app</span>
        </label>

        <div class="row">
          <button class="btn primary" data-pa-sync="1">Sync today</button>
          <button class="btn" data-pa-sync="7">Sync the last 7 days</button>
          <button class="btn" data-pa-sync="30">Sync the last 30 days</button>
          <span class="tiny muted" data-pa-status></span>
        </div>
        <div class="tiny muted" style="margin-top:.4rem">
          30 days reads every completed exercise on every day one at a time — a few
          minutes if the month is full. Nothing else stops working while it runs, and you
          can leave the tab.
        </div>

        <details class="disc" style="margin-top:.7rem">
          <summary>What it will and won't bring across</summary>
          <div class="tiny" style="padding:.2rem 0 .1rem;line-height:1.55">
            <strong>Only exercises you genuinely ticked off.</strong> PhysiApp shows a filled-in
            results form for untouched exercises too — prefilled with the prescription — and
            reading those would invent a session you never did. The sync ignores anything without a
            real recorded result behind it, whatever the form says.
            <br><br>
            <strong>Rows come in as "both", not left/right.</strong> PhysiApp records one figure per
            exercise with no side split, so splitting it across two rows would be a guess. Add the
            side breakdown yourself on Today if it matters for an exercise.
            <br><br>
            <strong>Anything you logged here by hand is never overwritten.</strong> If a row already
            exists for an exercise and it didn't come from PhysiApp, your numbers win and the sync
            reports it as kept.
            <br><br>
            <strong>Load, band colour, cardio and seconds stay yours.</strong> PhysiApp has no field
            for most of them, so it can neither fill them in nor clear them.
          </div>
        </details>
      </div>
    </section>

    <section class="card">
      <header><h2>Where this came from</h2></header>
      <div class="card-body">
        <ul class="plain">
          ${CASE.sources.map((s2) => `<li><strong>${esc(s2.label)}</strong> — ${esc(s2.note)}</li>`).join('')}
        </ul>
        <div class="callout small" style="margin-top:.7rem">
          This is a tracker, not medical advice. Every threshold in it is copied from your own documents;
          anything I filled in myself is labelled <span class="pill">my default</span>.
        </div>
      </div>
    </section>
  </div>`;
}

export function bindSettings(root, ctx, rerender) {
  // Which build is this device actually running? The installed app caches its
  // shell, so "did my change land?" is otherwise guesswork.
  // Report the real viewport geometry. If the installed app is letterboxed by
  // iOS, innerHeight will be visibly SHORTER than screen.height and the insets
  // will read 0 — which is the difference between "my CSS is wrong" and "iOS
  // never gave us the space".
  const geo = root.querySelector('#geo-report');
  if (geo) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;'
      + 'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const insetTop = cs.paddingTop, insetBottom = cs.paddingBottom;
    probe.remove();
    const vv = window.visualViewport;
    const standalone = window.navigator.standalone === true
      || window.matchMedia('(display-mode: standalone)').matches;
    const lost = window.screen.height - window.innerHeight;
    geo.textContent = [
      `screen.height      ${window.screen.height}`,
      `window.innerHeight ${window.innerHeight}`,
      `visualViewport     ${vv ? Math.round(vv.height) : 'n/a'}`,
      `UNUSED at bottom   ${lost}px   <- the band`,
      `safe-area top      ${insetTop}`,
      `safe-area bottom   ${insetBottom}`,
      `standalone         ${standalone}`,
      `--safe-b applied   ${getComputedStyle(document.documentElement).getPropertyValue('--safe-b').trim() || '(desktop)'}`,
      `devicePixelRatio   ${window.devicePixelRatio}`,
    ].join('\n');
  }

  const buildEl = root.querySelector('#build-id');
  if (buildEl) {
    (async () => {
      try {
        const keys = await caches.keys();
        const shell = keys.find((k) => k.startsWith('shell-'));
        buildEl.textContent = shell ? shell.replace('shell-', '') : 'live (no cache)';
      } catch {
        buildEl.textContent = 'live';
      }
    })();
  }

  // ---- device sync ---------------------------------------------------
  root.querySelector('[data-sy-connect]')?.addEventListener('click', async () => {
    const owner = root.querySelector('#sy-owner').value.trim();
    const repo = root.querySelector('#sy-repo').value.trim();
    const token = root.querySelector('#sy-token').value.trim();
    if (!owner || !repo || !token) return toast('⚠️ <b>Fill in all three</b>', 'warn');
    toast('Checking access…');
    const check = await ghCheckAccess({ owner, repo, token });
    if (!check.ok) {
      return toast(check.reason === 'bad-token' ? '⚠️ <b>Token rejected</b>'
        : check.reason === 'no-repo' ? '⚠️ <b>Repo not found</b><br><span>check the name, and that the token can see it</span>'
        : `⚠️ <b>${esc(check.reason)}</b>`, 'warn');
    }
    if (!check.private) toast('⚠️ <b>That repo is public</b><br><span>your log would be readable — use a private one</span>', 'warn');
    setConfig({ owner, repo, token, path: 'state.json' });
    const res = await runSync('connect');
    toast(res.ok ? '✅ <b>Connected and synced</b>' : `⚠️ <b>Connected, but sync failed</b><br><span>${esc(res.reason || '')}</span>`, res.ok ? '' : 'warn');
    rerender();
  });

  root.querySelector('[data-sy-sync]')?.addEventListener('click', async () => {
    const res = await runSync('manual');
    toast(res.ok
      ? `✅ <b>Synced</b><br><span>${res.pulled || 0} in · ${res.pushed || 0} out</span>`
      : `⚠️ <b>Sync failed</b><br><span>${esc(res.reason || '')}</span>`, res.ok ? '' : 'warn');
    rerender();
  });

  root.querySelector('[data-sy-disconnect]')?.addEventListener('click', () => {
    clearConfig();
    toast('Disconnected — your data is still on this Mac');
    rerender();
  });

  // ---- PhysiApp sync -------------------------------------------------
  root.querySelectorAll('[data-pa]').forEach((inp) => {
    inp.addEventListener('change', () => {
      update((d) => {
        d.settings.physiapp = d.settings.physiapp || {};
        d.settings.physiapp[inp.dataset.pa] = inp.value.trim();
      });
      const now = state.data.settings.physiapp || {};
      if (now.code && now.birthYear) rerender();
    });
  });

  root.querySelector('[data-pa-auto]')?.addEventListener('change', (e) => {
    update((d) => { d.settings.physiappAuto = e.target.checked; });
    toast(e.target.checked
      ? '✅ <b>Automatic sync on</b><br><span>runs each time you open the app</span>'
      : '<b>Automatic sync off</b><br><span>use the buttons below instead</span>');
    rerender();
  });

  const status = root.querySelector('[data-pa-status]');
  root.querySelectorAll('[data-pa-sync]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const days = Number(btn.dataset.paSync);
      const buttons = [...root.querySelectorAll('[data-pa-sync]')];
      buttons.forEach((b) => { b.disabled = true; });
      // A 30-day run is minutes long, so count up rather than sit there
      // looking frozen.
      const started = Date.now();
      const label = days === 1 ? 'today' : `${days} days`;
      const tick = () => {
        if (!status) return;
        const secs = Math.round((Date.now() - started) / 1000);
        status.textContent = secs < 3 ? `Reading ${label}…` : `Reading ${label}… ${secs}s`;
      };
      tick();
      const ticker = setInterval(tick, 1000);
      try {
        const res = await fetch('/api/physiapp/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days }),
        });
        const out = await res.json();
        if (!out.ok) {
          if (status) status.textContent = '';
          toast(`⚠️ <b>${esc(out.message || out.error || 'Sync failed')}</b>`, 'warn');
          return;
        }
        const bits = [];
        if (out.added) bits.push(`${out.added} added`);
        if (out.updated) bits.push(`${out.updated} updated`);
        if (out.keptYours) bits.push(`${out.keptYours} of yours kept`);
        toast(`✅ <b>${esc(out.message)}</b>${bits.length ? `<br><span>${esc(bits.join(' · '))}</span>` : ''}`);
        if (out.unmapped?.length) {
          toast(`⚠️ <b>Not recognised</b><br><span>${esc(out.unmapped.join(', '))}</span>`, 'warn');
        }
        // The server wrote straight to the file, so this tab's copy is stale.
        await load();
        rerender();
      } catch (err) {
        if (status) status.textContent = '';
        toast(`⚠️ <b>Could not reach the server</b><br><span>${esc(String(err.message || err))}</span>`, 'warn');
      } finally {
        clearInterval(ticker);
        if (status) status.textContent = '';
        buttons.forEach((b) => { b.disabled = false; });
      }
    });
  });

  root.querySelectorAll('[data-set]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.set;
      update((d) => {
        d.settings[k] = inp.type === 'number' ? num(inp.value) : inp.value;
      });
      rerender();
    });
  });

  root.querySelector('[data-export]')?.addEventListener('click', () => {
    download(`acl-rehab-${todayIso()}.json`, JSON.stringify(state.data, null, 2), 'application/json');
  });

  root.querySelector('[data-export-csv]')?.addEventListener('click', () => {
    const rows = [['date', 'exercise', 'side', 'sets', 'reps', 'load', 'unit', 'minutes', 'rpe', 'notes']];
    for (const [date, day] of Object.entries(state.data.days).sort()) {
      for (const e of day.entries || []) {
        rows.push([date, e.ex, e.side || '', e.sets ?? '', e.reps ?? '', e.load ?? '', e.loadUnit ?? '', e.time ?? '', e.rpe ?? '', (e.notes || '').replace(/"/g, '""')]);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c)}"`).join(',')).join('\n');
    download(`acl-training-log-${todayIso()}.csv`, csv, 'text/csv');
  });

  root.querySelector('[data-import]')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('This replaces everything currently in the app. Continue?')) return;
    try {
      const obj = JSON.parse(await file.text());
      update((d) => { Object.assign(d, obj); });
      rerender();
    } catch (err) {
      alert('That file did not parse as JSON.');
    }
  });

  root.querySelector('[data-reseed]')?.addEventListener('click', () => {
    update((d) => { d.settings.seeded = false; });
    location.reload();
  });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
