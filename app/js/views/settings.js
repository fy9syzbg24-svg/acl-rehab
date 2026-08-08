import { esc, todayIso, uid, num } from '../util.js';
import { state, update, load } from '../store.js';
import { CASE } from '../../data/history.js';
import { toast } from '../components.js';

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
