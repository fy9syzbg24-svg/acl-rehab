import { esc, todayIso, num } from '../util.js';
import { state, update, load, flushSave, adoptImport } from '../store.js';
import { CASE } from '../../data/history.js';
import { toast, openModal, closeModal, exerciseById } from '../components.js';
import { validateBackup, previewImport, csvReport } from '../backup.js';
import { runSync, syncState, pendingSyncCount, DEVICE_ID } from '../store.js';
import { getConfig, setConfig, clearConfig, isConfigured } from '../sync/config.js';
import { ghCheckAccess } from '../sync/github.js';
import { SERVER_MODE, snapshotLocal } from '../sync/local-store.js';
import { fmtDateNum } from '../util.js';
import { soundCheck, sessionKind, cueVolume, setCueVolume } from '../player/audio.js';
import { hapticsOn, speakOn, setHaptics, setSpeak, hapticsAvailable, speechAvailable, say } from '../feedback.js';
import { pushSupported, installed, remindersOn, enableReminders, disableReminders, VAPID_PUBLIC } from '../push.js';
import { KINDS as REMIND_KINDS, remindPrefs, setRemind } from '../remind.js';
import { badgeOn, badgeParts, setBadgeParts, badgeAvailable, enableBadge, disableBadge, BADGE_PARTS, paintBadge } from '../badge.js';

const THIS = SERVER_MODE ? 'this Mac' : 'this device';

function syncCard() {
  const c = getConfig();
  const pending = isConfigured() ? pendingSyncCount() : 0;
  const last = c.lastSyncedAt ? when12(c.lastSyncedAt) : 'never';
  if (!isConfigured()) {
    return `
      <div class="callout small" style="margin-bottom:.8rem">
        Your log lives on ${THIS} and works offline. Connecting adds a private GitHub
        repo as a relay so the iPhone and iPad stay in step.
      </div>
      <div class="grid3">
        <label class="fld">GitHub user<input id="sy-owner" value="${esc(c.owner || '')}" autocomplete="off" spellcheck="false"></label>
        <label class="fld">Repository<input id="sy-repo" value="${esc(c.repo || 'acl-rehab-data')}" autocomplete="off" spellcheck="false"></label>
        <label class="fld">Access token<input id="sy-token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
      </div>
      <div class="row" style="margin-top:.7rem"><button class="btn primary" data-sy-connect>Connect ${THIS}</button></div>
      <div class="tiny muted" style="margin-top:.5rem">
        The token is stored on ${THIS} only, outside your synced data, and is sent
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
      <button class="btn" data-sy-disconnect>Disconnect ${THIS}</button>
      <span class="tiny muted">device <span class="mono">${esc(DEVICE_ID)}</span> · build <span class="mono" id="build-id">…</span></span>
    </div>
    <details class="disc" data-key="set:diag" style="margin-top:.7rem">
      <summary>Screen diagnostics</summary>
      <pre class="tiny mono" id="geo-report" style="white-space:pre-wrap;line-height:1.5;margin:.4rem 0 0">measuring…</pre>
    </details>
    ${syncState.lastError?.reason === 'auth' ? `<div class="callout warn small" style="margin-top:.6rem">
      <strong>This device's access token is no longer accepted.</strong> GitHub returned 401,
      which means the token has expired, been revoked, or was mistyped. Nothing is wrong with
      your log or the repo, and nothing here is lost: everything is on this device and uploads
      as soon as a working token is in.
      <div class="row" style="margin-top:.6rem;align-items:flex-end;gap:.5rem">
        <label class="fld" style="flex:1;max-width:360px">New access token
          <input id="sy-newtoken" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
        <button class="btn primary" data-sy-retoken>Save and sync</button>
      </div>
      <div class="tiny muted" style="margin-top:.4rem">
        Needs read and write on <span class="mono">Contents</span> for
        ${esc(c.owner)}/${esc(c.repo)}, and nothing else. Stored on this device only.
      </div>
    </div>` : syncState.lastError?.reason === 'public-repo' ? `<div class="callout warn small" style="margin-top:.6rem">
      <strong>Nothing was uploaded: ${esc(c.owner)}/${esc(c.repo)} is public.</strong> Your log would be
      readable by anyone. Make the repository private on GitHub and sync again. Everything is kept on ${THIS}.</div>`
    : syncState.lastError?.reason === 'privacy-unknown' ? `<div class="callout warn small" style="margin-top:.6rem">
      <strong>Nothing was uploaded:</strong> GitHub did not confirm the repository is private. Everything is
      kept on ${THIS} and uploads once it can check.</div>`
    : syncState.lastError ? `<div class="callout warn small" style="margin-top:.6rem">
      Last sync failed (${esc(syncState.lastError.reason || 'error')}). Your data is safe here and
      will upload on the next attempt.</div>` : ''}
    <div class="tiny muted" style="margin-top:.5rem">
      Disconnecting only forgets the token. Nothing is deleted from ${THIS}.
    </div>`;
}

/** "Sep 14, 3:30 PM": a moment, in 12-hour time. */
function when12(isoish) {
  const d = new Date(isoish);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * What the sound is doing right now, in words rather than the API's own names.
 * Worth showing because the two modes behave very differently and which one is
 * in force depends on whether he has played one of his songs.
 */
function audioModeLine() {
  if (typeof navigator === 'undefined' || !navigator.audioSession) {
    return 'This browser chooses how to share the speaker on its own.';
  }
  const k = sessionKind();
  if (!k) return 'No sound yet this session.';
  if (k === 'playback') return 'Your song owns the sound, so other music is paused and cues keep going with the screen off.';
  return 'Cues duck under your music, which is never paused. No cues in the background or on Silent.';
}

export function renderSettings(ctx = {}) {
  const s = state.data.settings;
  const pa = s.physiapp || {};
  const connected = !!(pa.code && pa.birthYear);
  const auto = s.physiappAuto !== false;
  const open = (k) => ((ctx.setOpen || {})[k] ? 'open' : '');
  const c = getConfig();
  const pending = isConfigured() ? pendingSyncCount() : 0;
  // One line per group, so the whole page reads at a glance and the detail
  // is one tap away. Each says which device it is about where that matters.
  const sum = {
    surgeries: [s.surgeryLeft && `L ${fmtDateNum(s.surgeryLeft)}`, s.surgeryRight && `R ${fmtDateNum(s.surgeryRight)}`].filter(Boolean).join(' · ') || 'not set',
    appearance: { auto: 'Automatic', light: 'Light', dark: 'Dark' }[s.theme || 'light'],
    sound: 'Your music keeps playing · cues duck under it',
    units: `${s.weightUnit} · ${s.lengthUnit} · ${s.bodyweight ? `bodyweight ${s.bodyweight} ${s.weightUnit}` : 'bodyweight not set'}`,
    data: SERVER_MODE ? 'on this Mac, every save backed up' : 'on this device',
    sync: !isConfigured() ? `Not connected on ${THIS}`
      : syncState.lastError ? `Last sync failed (${syncState.lastError.reason || 'error'})`
      : pending ? `${pending} change${pending === 1 ? '' : 's'} waiting` : `Synced${c.lastSyncedAt ? ` ${when12(c.lastSyncedAt)}` : ''}`,
    physiapp: connected ? `Connected${s.physiappLastSync ? `, checked ${when12(s.physiappLastSync)}` : ''} · runs on the Mac` : 'Not set up · runs on the Mac',
    sources: `${CASE.sources.length} source${CASE.sources.length === 1 ? '' : 's'}`,
  };
  const warnSync = isConfigured() && syncState.lastError;
  const group = (key, title) => `<details class="card setgroup" data-setg="${key}" data-key="setg:${key}" ${open(key)}>
      <summary class="setsum"><span class="setsum-t">${title}</span><span class="setsum-s ${key === 'sync' && warnSync ? 'bad' : ''}">${esc(sum[key])}</span></summary>`;
  return `
  <div class="stack settings-page">
    <header class="pagehead"><h1>Settings</h1></header>
    ${group('surgeries', 'Your surgeries')}
      <div class="card-body">
        <div class="grid3">
          <label class="fld">Injury date<input type="date" data-set="injuryDate" value="${esc(s.injuryDate || '')}"></label>
          <label class="fld">Left ACL reconstruction<input type="date" data-set="surgeryLeft" value="${esc(s.surgeryLeft || '')}"></label>
          <label class="fld">Right ACL reconstruction<input type="date" data-set="surgeryRight" value="${esc(s.surgeryRight || '')}"></label>
        </div>
        <div class="callout small" style="margin-top:.8rem">
          <strong>Left</strong>, ${esc(CASE.legs.left.procedure)}. ${esc(CASE.legs.left.weightBearing)}. ${esc(CASE.legs.left.complication)}<br>
          <strong>Right</strong>, ${esc(CASE.legs.right.procedure)}. ${esc(CASE.legs.right.weightBearing)}. ${esc(CASE.legs.right.complication)}<br>
          ${esc(CASE.protocolNote)}
        </div>
        <div class="callout warn small" style="margin-top:.6rem">
          Dates come from your clinical notes. Change them above if anything is wrong.
        </div>
      </div>
    </details>

    ${group('appearance', 'Appearance')}
      <div class="card-body">
        <div class="themepick">
          ${[['auto', 'Automatic', 'follows your device'],
             ['light', 'Light', ''],
             ['dark', 'Dark', '']].map(([k, label, sub]) => `
            <button class="themeopt ${(s.theme || 'light') === k ? 'on' : ''}" data-theme-set="${k}">
              <span class="themeswatch ${k}"></span>
              <span class="themelabel">${label}</span>
              ${sub ? `<span class="tiny muted">${sub}</span>` : ''}
            </button>`).join('')}
        </div>
      </div>
    </details>

    ${group('sound', 'Workout sound')}
      <div class="card-body">
        <p class="muted" style="margin:.1rem 0 .6rem">This app never pauses your music. Countdown cues
          duck under Spotify and it comes straight back. Two things follow from that, both measured on
          your phone: cues do not sound while the app is in the background, and a phone on Silent gets
          no cues.</p>
        <p class="muted" style="margin:0 0 .6rem">Playing one of your own songs is the exception. The app
          owns the sound then, so other music pauses and the cues keep going with the screen off.</p>
        <label class="fld" style="max-width:280px;margin:.2rem 0 .6rem">Cue volume
          <input type="range" min="0.2" max="1" step="0.1" data-cuevol value="${cueVolume()}">
        </label>
        <div class="row"><button class="btn" data-soundtest>Test sound</button><span class="tiny muted" data-soundtest-out></span></div>
        <div class="tiny muted" style="margin-top:.4rem">${esc(audioModeLine())}</div>

        <label class="check-row" style="margin-top:.9rem"><input type="checkbox" data-speak ${speakOn() ? 'checked' : ''} ${speechAvailable() ? '' : 'disabled'}>
          <span><b>Say the step out loud</b><br>
          <span class="muted">"Get ready", "Rest", "Switch sides" spoken as each step starts${speechAvailable() ? '' : '. This device has no speech'}.</span></span></label>

        <label class="check-row"><input type="checkbox" data-haptics ${hapticsOn() ? 'checked' : ''} ${hapticsAvailable() ? '' : 'disabled'}>
          <span><b>Buzz on a tick and a step change</b><br>
          <span class="muted">A short tap you can feel${hapticsAvailable() ? '' : '. This device has no touch feedback'}.</span></span></label>
      </div>
    </details>

    ${group('reminders', 'Reminders')}
      <div class="card-body">
        <label class="check-row"><input type="checkbox" data-reminders ${remindersOn() ? 'checked' : ''} ${pushSupported() ? '' : 'disabled'}>
          <span><b>Remind me on this device</b><br>
          <span class="muted">The tendon loading thirty minutes after your collagen, the six hour line after the first session, and a twice a day dose. Tapping one opens the app, and they clear themselves when you do.</span></span></label>
        <div class="tiny muted" data-reminders-out style="margin:.2rem 0 .5rem"></div>

        <div ${remindersOn() ? '' : 'hidden'} data-remind-what>
          <div class="tiny muted" style="margin:.6rem 0 .1rem">Remind me about:</div>
          ${REMIND_KINDS.map(([k, label, hint, timeKey]) => `
            <label class="check-row"><input type="checkbox" data-remindkind="${k}" ${remindPrefs()[k] ? 'checked' : ''}>
              <span><b>${esc(label)}</b><br><span class="muted">${esc(hint)}</span></span></label>
            ${timeKey ? `<div class="row remind-at" ${remindPrefs()[k] ? '' : 'hidden'}><label class="fld">At<input type="time" data-remindat="${timeKey}" value="${esc(remindPrefs()[timeKey])}"></label></div>` : ''}`).join('')}

          <label class="check-row" style="margin-top:.4rem"><input type="checkbox" data-quiet ${remindPrefs().quietOn ? 'checked' : ''}>
            <span><b>Quiet hours</b><br>
            <span class="muted">Nothing arrives between these times. Anything due is simply skipped, not saved up for later.</span></span></label>
          <div class="row" ${remindPrefs().quietOn ? '' : 'hidden'} data-quiet-times style="gap:.5rem;max-width:280px">
            <label class="fld">From<input type="time" data-quietfrom value="${esc(remindPrefs().quietFrom)}"></label>
            <label class="fld">Until<input type="time" data-quietto value="${esc(remindPrefs().quietTo)}"></label>
          </div>
        </div>

        <p class="tiny muted" style="margin:.6rem 0 0">Not the rest timer. A rest ending while you are in another app cannot be a sound without stopping your music, and a push is not an exact alarm, so nothing here pretends to cover sixty seconds.</p>
        <p class="tiny muted" style="margin:.4rem 0 0">Sent by your Mac, so they arrive while it is on and you are logged in.</p>
      </div>
    </details>

    ${group('badge', 'Home Screen badge')}
      <div class="card-body">
        <label class="check-row"><input type="checkbox" data-badge ${badgeOn() ? 'checked' : ''} ${badgeAvailable() ? '' : 'disabled'}>
          <span><b>Show a number on the app icon</b><br>
          <span class="muted">${badgeAvailable()
            ? 'Counts what is still due today. iOS only shows it on the installed app, and only once notifications are allowed.'
            : 'This device does not support the icon badge.'}</span></span></label>
        <div class="tiny muted" data-badge-out style="margin:.1rem 0 .5rem"></div>
        <div ${badgeOn() ? '' : 'hidden'} data-badge-what>
          <div class="tiny muted" style="margin-bottom:.3rem">Count:</div>
          ${BADGE_PARTS.map(([k, label]) => `<label class="check-row"><input type="checkbox" data-badgepart="${k}" ${badgeParts().includes(k) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
        </div>
      </div>
    </details>

    ${group('units', 'Units &amp; body')}
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
        <div class="grid3" style="margin-top:.6rem">
          <label class="fld">Sex
            <select data-set="sex">
              <option value="" ${!s.sex ? 'selected' : ''}>Not set</option>
              <option value="M" ${s.sex === 'M' ? 'selected' : ''}>Male</option>
              <option value="F" ${s.sex === 'F' ? 'selected' : ''}>Female</option>
            </select></label>
          <label class="fld">Date of birth<input type="date" data-set="dob" value="${esc(s.dob || '')}"></label>
          <label class="fld">Bodyweight (${esc(s.weightUnit)})
            <input type="number" step="any" data-set="bodyweight" value="${s.bodyweight ?? ''}" placeholder="for bodyweight goals">
          </label>
        </div>
        <div class="tiny muted" style="margin-top:.3rem">
          Sex and date of birth pick the reference band on Progress > Tests > Where you stand.
          The plan's 1.5x and 1.8x bodyweight squat and leg-press targets cannot be scored without the bodyweight.
          Recording a "Bodyweight" measurement on the Measures tab takes priority over this field.
        </div>
      </div>
    </details>

    ${group('data', 'Your data')}
      <div class="card-body">
        <div class="row">
          <button class="btn" data-export>Download a full backup (JSON)</button>
          <button class="btn" data-export-csv>Export a training report (CSV)</button>
          <label class="btn" style="cursor:pointer">Import a backup<input type="file" accept="application/json,.json" data-import hidden></label>
        </div>
        <div class="tiny muted" style="margin-top:.5rem">
          The backup holds everything exactly as stored, and is the file to restore from. The report is the
          exercise you logged, per set, for reading or sharing; it is not a backup. Importing merges a backup
          into what is here: newer work stays, nothing is deleted, and you see what it will change first.
        </div>
        ${SERVER_MODE ? `<div class="tiny muted" style="margin-top:.35rem">
          The server keeps a backup of every save in <span class="mono">data/backups/</span> and never deletes one.
        </div>` : ''}
        <div class="row" style="margin-top:.9rem">
          <button class="btn danger" data-reseed>Re-add the seeded clinic sessions</button>
        </div>
        <div class="tiny muted" style="margin-top:.3rem">Use this if you deleted the seeded clinic entries and want them back.</div>
      </div>
    </details>

    ${group('sync', 'Device sync')}
      <div class="card-body">
        ${syncCard()}
        <div class="row" style="margin-top:.9rem;gap:.5rem;flex-wrap:wrap;border-top:1px solid var(--line-2);padding-top:.8rem">
          <button class="btn" data-app-refresh>Force update the app</button>
          <span class="tiny muted" data-refresh-status></span>
        </div>
        <div class="tiny muted" style="margin-top:.35rem">
          Re-downloads the app's files and reloads. Your data is not touched.
        </div>
      </div>
    </details>

    ${group('physiapp', 'PhysiApp import')}
      <div class="card-body">
        <div class="callout small" style="margin-bottom:.8rem">
          Reads what you ticked off in PhysiApp, with the numbers you entered. Read only; it
          never marks anything on their side.
        </div>

        ${connected ? `
        <div class="callout good small" style="margin-bottom:.6rem">
          <strong>Connected.</strong>
          ${s.physiappLastSync ? `Last checked ${esc(when12(s.physiappLastSync))}.` : 'Not checked yet.'}
          ${s.physiappLastImport ? `Last new results ${esc(when12(s.physiappLastImport))}.` : ''}
          ${auto ? 'It checks again on its own when you open the app on the Mac.' : 'Automatic checking is off.'}
          ${SERVER_MODE ? '<span data-pa-live></span>' : ''}
        </div>` : ''}

        <details class="disc" data-key="set:signin" style="margin-bottom:.6rem" ${connected ? '' : 'open'}>
          <summary>${connected ? 'Change the sign-in details' : 'Sign in: enter these once'}</summary>
          <div class="grid2" style="padding:.4rem 0 .2rem">
            <label class="fld">Program code
              <span class="secret-field"><input data-pa="code" type="password" value="${esc(pa.code || '')}" placeholder="from your clinician" autocomplete="off" spellcheck="false">
                <button type="button" class="btn sm ghost" data-reveal aria-pressed="false">Show</button></span>
            </label>
            <label class="fld">Year of birth
              <input data-pa="birthYear" type="number" min="1900" max="2100" value="${esc(String(pa.birthYear || ''))}" autocomplete="off" placeholder="e.g. 1993">
            </label>
          </div>
          <div class="tiny muted">Kept on this Mac only. It re-signs in on its own.</div>
        </details>

        <label class="row" style="gap:.5rem;align-items:center;margin-bottom:.6rem;cursor:pointer">
          <input type="checkbox" data-pa-auto ${auto ? 'checked' : ''}>
          <span class="tiny">Sync automatically whenever I open the app</span>
        </label>

        ${SERVER_MODE ? `
        <div class="row">
          <button class="btn primary" data-pa-sync="1">Sync today</button>
          <button class="btn" data-pa-sync="7">Sync the last 7 days</button>
          <button class="btn" data-pa-sync="30">Sync the last 30 days</button>
          <span class="tiny muted" data-pa-status></span>
        </div>` : `
        <div class="callout small">
          Runs on the Mac only. What it finds reaches this device by the normal sync.
        </div>`}
        ${SERVER_MODE ? `
        <div class="tiny muted" style="margin-top:.4rem">30 days takes a few minutes; you can leave the tab.</div>` : ''}

        <details class="disc" data-key="set:pawhat" style="margin-top:.7rem">
          <summary>What it will and won't bring across</summary>
          <div class="tiny" style="padding:.2rem 0 .1rem;line-height:1.55">
            <strong>Only exercises you genuinely ticked off.</strong> PhysiApp shows a filled-in
            results form for untouched exercises too, prefilled with the prescription, and
            reading those would invent a session you never did. The sync ignores anything without a
            real recorded result behind it, whatever the form says.
            <br><br>
            <strong>Results come in as one row for both legs.</strong> PhysiApp records one figure per
            exercise with no side split. The exercise counts as done, and nothing reads it as a
            separate left and right result. Rows you opened here are left exactly as they were.
            <br><br>
            <strong>Anything you logged or changed here is never overwritten.</strong> A row you
            ticked by hand wins. An imported row you untick, or whose numbers, load or note you
            change, is yours from then on.
            <br><br>
            <strong>Names must match exactly.</strong> If your clinician renames an exercise, it is
            listed for you to look at instead of being filed under a guess.
          </div>
        </details>
      </div>
    </details>

    ${group('sources', 'Where this came from')}
      <div class="card-body">
        <ul class="plain">
          ${CASE.sources.map((s2) => `<li><strong>${esc(s2.label)}</strong>, ${esc(s2.note)}</li>`).join('')}
        </ul>
        <div class="tiny muted" style="margin-top:.7rem">
          Not medical advice. Thresholds come from your documents; my own defaults are labelled.
        </div>
      </div>
    </details>
  </div>`;
}

export function bindSettings(root, ctx, rerender) {
  // The access code is a credential (F38): hidden unless he asks to see it.
  root.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => {
    const inp = b.parentElement.querySelector('input');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.textContent = show ? 'Hide' : 'Show';
    b.setAttribute('aria-pressed', String(show));
  }));
  // Which groups are open survives a re-render (a save repaints the page).
  root.querySelectorAll('details[data-setg]').forEach((d) => d.addEventListener('toggle', () => {
    ctx.setOpen = { ...(ctx.setOpen || {}), [d.dataset.setg]: d.open };
  }));
  // Which build is this device actually running? The installed app caches its
  // shell, so "did my change land?" is otherwise guesswork.
  // Report the real viewport geometry. If the installed app is letterboxed by
  // iOS, innerHeight will be visibly SHORTER than screen.height and the insets
  // will read 0, which is the difference between "my CSS is wrong" and "iOS
  // never gave us the space".
  root.querySelector('[data-app-refresh]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const status = root.querySelector('[data-refresh-status]');
    const say = (t) => { if (status) status.textContent = t; };
    btn.disabled = true;
    try {
      await forceUpdate(say);
    } catch (err) {
      btn.disabled = false;
      say('');
      toast(`<b>Could not update</b><br><span>${esc(String(err.message || err))}</span>`, 'warn');
    }
  });

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
        // 2026-09-15: audit A18 renamed the cache from "shell-<sha>" to
        // "acl-rehab-shell-<sha>" so this app could never delete the Fringe
        // Planner's copy on the shared github.io origin. This lookup was not
        // updated, so the installed app reported "live (no cache)" and there was
        // no way to tell which build a phone was running. Both names are read.
        const keys = await caches.keys();
        const shell = keys.find((k) => k.includes('shell-'));
        buildEl.textContent = shell ? shell.slice(shell.indexOf('shell-') + 6) : 'live (no cache)';
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
    if (!owner || !repo || !token) return toast('<b>Fill in all three</b>', 'warn');
    toast('Checking access…');
    const check = await ghCheckAccess({ owner, repo, token });
    if (!check.ok) {
      return toast(check.reason === 'bad-token' ? '<b>Token rejected</b>'
        : check.reason === 'no-repo' ? '<b>Repo not found</b><br><span>check the name, and that the token can see it</span>'
        : `<b>${esc(check.reason)}</b>`, 'warn');
    }
    // A public repository is refused outright (Codex audit B01): nothing is
    // stored and nothing is sent. It used to warn and then connect anyway.
    if (check.private !== true) {
      return toast('<b>Not connected: that repository is public</b><br><span>Your log would be readable by anyone. Make it private on GitHub, or use a private one, then connect again.</span>', 'warn', { key: 'sync-public' });
    }
    setConfig({ owner, repo, token, path: 'state.json' });
    const res = await runSync('connect');
    toast(res.ok ? '<b>Connected and synced</b>' : `<b>Connected, but sync failed</b><br><span>${esc(res.reason || '')}</span>`, res.ok ? '' : 'warn');
    rerender();
  });

  root.querySelector('[data-sy-sync]')?.addEventListener('click', async () => {
    const res = await runSync('manual');
    toast(res.ok
      ? `<b>Synced</b><br><span>${res.pulled || 0} in · ${res.pushed || 0} out</span>`
      : `<b>Sync failed</b><br><span>${esc(res.reason || '')}</span>`, res.ok ? '' : 'warn');
    rerender();
  });

  root.querySelector('[data-sy-retoken]')?.addEventListener('click', async () => {
    const token = root.querySelector('#sy-newtoken').value.trim();
    if (!token) return toast('<b>Paste the new token first</b>', 'warn');
    const { owner, repo } = getConfig();
    toast('Checking access…');
    // Verify BEFORE storing: a bad paste must not replace a token that might
    // still be the good one, and must not leave the device unable to explain why.
    const check = await ghCheckAccess({ owner, repo, token });
    if (!check.ok) {
      return toast(check.reason === 'bad-token'
        ? '<b>That token was rejected too</b><br><span>check it has Contents read and write on this repo, and has not expired</span>'
        : check.reason === 'no-repo' ? '<b>The token cannot see that repo</b>'
        : `<b>${esc(check.reason)}</b>`, 'warn');
    }
    if (check.private !== true) {
      return toast('<b>Not saved: that repository is public</b><br><span>Make it private on GitHub first. Nothing was uploaded.</span>', 'warn', { key: 'sync-public' });
    }
    setConfig({ token });
    const res = await runSync('retoken');
    toast(res.ok
      ? `<b>Reconnected</b><br><span>${res.pulled || 0} in · ${res.pushed || 0} out</span>`
      : `<b>Still failing</b><br><span>${esc(res.reason || '')}</span>`, res.ok ? '' : 'warn');
    rerender();
  });

  root.querySelector('[data-sy-disconnect]')?.addEventListener('click', () => {
    clearConfig();
    toast(`Disconnected: your data is still on ${THIS}`);
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
      ? '<b>Automatic sync on</b><br><span>runs each time you open the app</span>'
      : '<b>Automatic sync off</b><br><span>use the buttons below instead</span>');
    rerender();
  });

  // The Mac's last attempt lives in the server's memory, not the synced
  // document, so an attempt that failed is still reported honestly.
  const live = root.querySelector('[data-pa-live]');
  if (live) {
    fetch('/api/physiapp/status').then((r) => r.json()).then((st) => {
      if (st.off) { live.textContent = 'PhysiApp is switched off on this server.'; return; }
      if (st.lastError && st.lastAttempt) {
        live.textContent = `The last attempt, ${when12(st.lastAttempt)}, failed: ${st.lastError}`;
      }
    }).catch(() => {});
  }

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
          toast(`<b>${esc(out.message || out.error || 'Sync failed')}</b>`, 'warn');
          return;
        }
        const bits = [];
        if (out.added) bits.push(`${out.added} added`);
        if (out.updated) bits.push(`${out.updated} updated`);
        if (out.unchanged) bits.push(`${out.unchanged} unchanged`);
        if (out.keptYours) bits.push(`${out.keptYours} of yours kept`);
        toast(`<b>${esc(out.message)}</b>${bits.length ? `<br><span>${esc(bits.join(' · '))}</span>` : ''}`);
        if (out.review?.length) {
          toast(`<b>Needs a look: not in your program by that name</b><br><span>${esc(out.review.map((r) => `${r.name || 'unnamed'} (${r.date})`).join(', '))}</span>`, 'warn');
        }
        // The server wrote straight to the file, so this tab's copy is stale.
        await load();
        rerender();
      } catch (err) {
        if (status) status.textContent = '';
        toast(`<b>Could not reach the server</b><br><span>${esc(String(err.message || err))}</span>`, 'warn');
      } finally {
        clearInterval(ticker);
        if (status) status.textContent = '';
        buttons.forEach((b) => { b.disabled = false; });
      }
    });
  });

  root.querySelector('[data-speak]')?.addEventListener('change', (e) => {
    setSpeak(e.target.checked);
    // Say one line immediately, so turning it on proves itself rather than
    // leaving him to start a workout to find out.
    if (e.target.checked) say('Spoken cues are on', { force: true });
    rerender();
  });
  root.querySelector('[data-haptics]')?.addEventListener('change', (e) => {
    setHaptics(e.target.checked);
    if (e.target.checked) import('../feedback.js').then((m) => m.haptic('phase'));
    rerender();
  });
  root.querySelector('[data-reminders]')?.addEventListener('change', async (e) => {
    const out = root.querySelector('[data-reminders-out]');
    if (!e.target.checked) { await disableReminders(); rerender(); return; }
    if (out) out.textContent = 'asking this device…';
    const r = await enableReminders();
    if (!r.ok) { e.target.checked = false; if (out) out.textContent = r.why; return; }
    rerender();
  });
  root.querySelectorAll('[data-remindkind]').forEach((cb) => cb.addEventListener('change', () => {
    setRemind({ [cb.dataset.remindkind]: cb.checked });
    rerender();   // the time field under it appears or goes
  }));
  root.querySelectorAll('[data-remindat]').forEach((inp) => inp.addEventListener('change', () => {
    if (inp.value) setRemind({ [inp.dataset.remindat]: inp.value });
  }));
  root.querySelector('[data-quiet]')?.addEventListener('change', (e) => {
    setRemind({ quietOn: e.target.checked });
    rerender();
  });
  root.querySelector('[data-quietfrom]')?.addEventListener('change', (e) => setRemind({ quietFrom: e.target.value }));
  root.querySelector('[data-quietto]')?.addEventListener('change', (e) => setRemind({ quietTo: e.target.value }));
  root.querySelector('[data-badge]')?.addEventListener('change', async (e) => {
    const out = root.querySelector('[data-badge-out]');
    if (!e.target.checked) { disableBadge(); rerender(); return; }
    // iOS needs notification permission before a badge shows, and the ask has
    // to come from this tap.
    const r = await enableBadge();
    if (!r.ok) {
      e.target.checked = false;
      if (out) out.textContent = r.why;
      return;
    }
    rerender();
  });
  root.querySelectorAll('[data-badgepart]').forEach((cb) => cb.addEventListener('change', () => {
    const want = [...root.querySelectorAll('[data-badgepart]')].filter((x) => x.checked).map((x) => x.dataset.badgepart);
    setBadgeParts(want);
    // Repaint from Today's own numbers on the next render; clear now so a part
    // he just switched off cannot linger on the icon.
    paintBadge({ exercises: 0, supplements: 0 });
    rerender();
  }));
  root.querySelector('[data-cuevol]')?.addEventListener('input', (e) => {
    // Set it by ear: every move plays the test tones at the new level, so he is
    // never guessing what a number means.
    setCueVolume(Number(e.target.value));
    soundCheck();
  });
  root.querySelector('[data-soundtest]')?.addEventListener('click', () => {
    const out = root.querySelector('[data-soundtest-out]');
    const ok = soundCheck();
    // Two tones were sent; whether they were heard is his to say, not ours.
    if (out) out.textContent = ok ? 'Two tones sent. If you heard nothing, check the volume.' : 'Sound is not available in this browser.';
  });

  root.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => {
    update((d) => { d.settings.theme = b.dataset.themeSet; });
    rerender();
  }));

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

  // A report, not a backup (Codex audit B16): logged rows only, per set, every field escaped.
  root.querySelector('[data-export-csv]')?.addEventListener('click', () => {
    const csv = csvReport(state.data, { nameOf: (id) => exerciseById(id)?.name || id });
    download(`acl-training-report-${todayIso()}.csv`, csv, 'text/csv;charset=utf-8');
  });

  // Import (Codex audit B15): check the file, show what it would change, take a
  // verified restore point, then merge. Never a straight replacement.
  root.querySelector('[data-import]')?.addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';   // the same file can be chosen again
    if (!file) return;
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      toast('<b>Nothing imported</b><br><span>That file is not a JSON backup.</span>', 'warn', { key: 'import' });
      return;
    }
    const check = validateBackup(obj);
    if (!check.ok) {
      openModal({
        title: 'This file cannot be imported',
        body: `<p class="tiny">Nothing was changed. What is wrong with it:</p>
          <ul class="plain tiny">${check.errors.map((x) => `<li>${esc(x)}</li>`).join('')}${check.more ? `<li>and ${check.more} more</li>` : ''}</ul>
          <div class="row" style="margin-top:.8rem"><button class="btn primary" data-close>Close</button></div>`,
      });
      return;
    }
    const p = previewImport(state.data, obj);
    const kinds = Object.entries(p.byKind).map(([k, n]) => `${n} ${k}`).join(', ');
    openModal({
      title: 'Import this backup?',
      body: `<div class="import-preview tiny">
          <p><b>${esc(file.name)}</b></p>
          <ul class="plain">
            <li><b class="mono">${p.added}</b> new record${p.added === 1 ? '' : 's'} added${kinds ? `: ${esc(kinds)}` : ''}</li>
            <li><b class="mono">${p.changed}</b> updated, where the backup holds a newer version</li>
            <li><b class="mono">${p.keptYours}</b> kept as they are here, because yours are newer</li>
            <li><b class="mono">${p.same}</b> already the same</li>
            <li><b class="mono">0</b> deleted: an import never removes anything</li>
            ${p.ignored.length ? `<li>Left out, not part of this app: ${esc(p.ignored.join(', '))}</li>` : ''}
          </ul>
          <p class="muted">A restore point of what is here now is saved first.</p>
        </div>
        <div class="row" style="margin-top:.8rem;gap:.5rem">
          <button class="btn" data-close>Cancel</button>
          <button class="btn primary" data-import-go ${p.added + p.changed === 0 ? 'disabled' : ''}>${p.added + p.changed === 0 ? 'Nothing to add' : 'Merge into my log'}</button>
        </div>`,
      onMount(m) {
        m.querySelector('[data-import-go]')?.addEventListener('click', async (ev) => {
          ev.currentTarget.disabled = true;
          const result = await applyImport(obj);
          closeModal();
          toast(result.html, result.ok ? 'good' : 'warn', { key: 'import', ms: 7000 });
          rerender();
        });
      },
    });
  });

  root.querySelector('[data-reseed]')?.addEventListener('click', () => {
    update((d) => { d.settings.seeded = false; });
    location.reload();
  });
}

/** Save what is on screen, take a verified restore point, merge, save again. */
async function applyImport(obj) {
  if (state.readOnly) return { ok: false, html: '<b>Nothing imported</b><br><span>This device is read only right now.</span>' };
  if (!(await flushSave())) return { ok: false, html: '<b>Nothing imported</b><br><span>Your latest change is not saved yet. Try again in a moment.</span>' };
  const snap = await snapshotLocal('before-import');
  if (!snap.ok) return { ok: false, html: '<b>Nothing imported</b><br><span>A restore point could not be saved first, so nothing was changed.</span>' };
  // Worked out again against what is saved now, in case a sync landed meanwhile.
  const p = previewImport(state.data, obj);
  if (p.removed) return { ok: false, html: '<b>Nothing imported</b><br><span>The merge would have removed records, so it was stopped.</span>' };
  const ok = await adoptImport(p.doc);
  return ok
    ? { ok: true, html: `<b>Imported</b><br><span>${p.added} added, ${p.changed} updated, ${p.keptYours} of yours kept. Restore point saved.</span>` }
    : { ok: false, html: '<b>Not saved yet</b><br><span>The import is on screen but could not be saved. Your restore point is kept.</span>' };
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Force update, rebuilt 2026-09-14 after he saw it bring back the OLD design
 * until the next launch, and again 2026-09-15 for the follow-up audit
 * (A09, A16 to A18).
 *
 * The rules now:
 *   - nothing happens unless his latest change is saved on this device first
 *   - nothing is unregistered or deleted up front: the running generation
 *     keeps working until a complete new one is installed (the worker installs
 *     a generation whole or not at all, and removes the old one itself)
 *   - "ready" means the worker says it runs the deployed version AND holds
 *     every file of it, not that a cache with the right name exists
 *   - only this app's worker is touched; the Fringe Planner shares the origin
 *   - the suppression flag for the automatic reload is always cleared
 * Local data (IndexedDB) and sync sign-in (localStorage) are never touched.
 */
async function forceUpdate(say) {
  const reloadFresh = () => {
    const u = new URL(location.href);
    u.searchParams.set('u', Date.now().toString(36));
    location.replace(u.toString());
  };
  say('saving…');
  if (!(await flushSave())) throw new Error('your latest change is not saved yet, so nothing was updated. Try again in a moment');
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    // The Mac serves files itself with no worker; a reload is enough.
    say('reloading…');
    reloadFresh();
    return;
  }
  say('checking the latest version…');
  const src = await fetch(`./sw.js?probe=${Date.now()}`, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`could not reach the app (${r.status})`);
    return r.text();
  });
  const deployed = (src.match(/const SHELL_VERSION = '([^']+)'/) || [])[1];
  if (!deployed) throw new Error('could not read the deployed version');

  const scope = new URL('./', location.href).href;
  let reg = (await navigator.serviceWorker.getRegistration(scope)) || await navigator.serviceWorker.register('./sw.js', { scope: './' });
  window.__rehabForceUpdate = true;   // mobile.js leaves the reload to us
  try {
    const deadline = Date.now() + 120000;
    let lastUpdate = 0;
    for (;;) {
      const worker = reg.active;
      const v = worker ? await askWorker(worker, 'version') : null;
      if (v && v.version === deployed) {
        if (v.complete) break;
        say('fetching missing files…');
        const r = await askWorker(worker, 'repair');
        if (r && r.complete) break;
      }
      if (Date.now() > deadline) {
        throw new Error('the new version did not finish downloading. The app you have still works; try again in a few minutes');
      }
      if (Date.now() - lastUpdate > 5000 && !reg.installing) {
        lastUpdate = Date.now();
        say('downloading the new version…');
        try { await reg.update(); } catch { /* offline for a moment */ }
      }
      await new Promise((r) => setTimeout(r, 800));
      reg = (await navigator.serviceWorker.getRegistration(scope)) || reg;
    }
    say('reloading…');
    reloadFresh();
  } finally {
    window.__rehabForceUpdate = false;
  }
}

/** Ask a worker something over a private channel; null if it does not answer. */
function askWorker(worker, kind, ms = 4000) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), ms);
    ch.port1.onmessage = (e) => { clearTimeout(timer); resolve(e.data || null); };
    try { worker.postMessage({ kind }, [ch.port2]); } catch { clearTimeout(timer); resolve(null); }
  });
}
