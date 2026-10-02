import { esc, todayIso, num } from '../util.js';
import { state, update, load, flushSave, adoptImport, syncBodyweightSetting } from '../store.js';
import { CASE } from '../../data/history.js';
import { toast, openModal, closeModal, exerciseById } from '../components.js';
import { validateBackup, previewImport, csvReport } from '../backup.js';
import { runSync, syncState, pendingSyncCount, pendingSyncKeys, DEVICE_ID } from '../store.js';
import { getConfig, setConfig, clearConfig, isConfigured } from '../sync/config.js';
import { ghCheckAccess } from '../sync/github.js';
import { SERVER_MODE, snapshotLocal } from '../sync/local-store.js';
import { fmtDateShort } from '../util.js';
import { soundCheck, sessionKind, cueVolume, setCueVolume, unlockAudio, loadVoice, audioAvailable, stereoOn, setStereo, stereoAvailable,
  voiceVolume, setVoiceVolume, preferVoice, whenVoiceReady, playVoice, coachDemo, COACH_HITS, COACH_LINES,
  sampleSounds, soundSetChanged, loadSounds, releaseSession, sessionLog } from '../player/audio.js';
import { voiceDir, sfxFiles, sfxId, loadSfx, CLASSIC } from '../player/packs.js';
import { pop } from '../player/choreo.js';
import { hapticsOn, speakOn, setHaptics, setSpeak, hapticsAvailable, speechAvailable, say, switchSupported } from '../feedback.js';
import { pushSupported, installed, remindersOn, enableReminders, disableReminders, VAPID_PUBLIC } from '../push.js';
import { KINDS as REMIND_KINDS, remindPrefs, setRemind } from '../remind.js';
import { lastNight, ringBuiltAt, ringSource, ringSettled, syncRing, syncWords, waitForMac } from '../ring.js';
import { badgeOn, badgeParts, setBadgeParts, badgeAvailable, enableBadge, disableBadge, BADGE_PARTS, paintBadge } from '../badge.js';
import { isNative, call as nativeCall, notifyPermission, PREF_ROUTINE_REMINDERS, PREF_REST_END, PREF_LIVE } from '../native-bridge.js';
import { enhanceSelects } from '../components.js';
import { vtStart, vtSupported } from '../vt.js';
import { NOTIFY_KINDS, notifyOn, setNotify, quietHours, voice, sfx, setPref, VOICE_KEY, SFX_KEY, WIDGET_NAMES_KEY, voicesManifest, sfxManifest } from '../rtprefs.js';

const THIS = SERVER_MODE ? 'this Mac' : 'this device';

// B6-2 (2026-09-23): every on and off choice here is a real switch. Safari
// draws its own iOS switch and gives its tap; where <input switch> is unknown
// (Chrome, Firefox) the same shape is drawn by CSS (.sw-knob). Only the look
// changes: each keeps its label, its line and its meaning.
const sw = () => (switchSupported() ? 'switch' : 'switch class="sw-knob"');

// Hear the coach's small dial (B6-4): it pops on each moment of the demo.
const DIAL_ICON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/><path d="M12 12l3.2-3.2"/></svg>';

function syncCard() {
  const c = getConfig();
  const pending = isConfigured() ? pendingSyncCount() : 0;
  const last = c.lastSyncedAt ? when12(c.lastSyncedAt) : 'never';
  if (!isConfigured()) {
    return `
      <div class="grid3">
        <label class="fld">GitHub user<input id="sy-owner" value="${esc(c.owner || '')}" autocomplete="off" spellcheck="false"></label>
        <label class="fld">Repository<input id="sy-repo" value="${esc(c.repo || 'acl-rehab-data')}" autocomplete="off" spellcheck="false"></label>
        <label class="fld">Access token<input id="sy-token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
      </div>
      <div class="row" style="margin-top:.7rem"><button class="btn primary" data-sy-connect>Connect ${THIS}</button></div>
      <p class="rset-foot">The token stays on ${THIS}.</p>`;
  }
  return `
    <div class="callout good small" style="margin-bottom:.6rem">
      <strong>Connected</strong> to ${esc(c.owner)}/${esc(c.repo)} · last synced ${esc(last)}.
      ${pending ? `<strong>${pending}</strong> change${pending === 1 ? '' : 's'} waiting to upload.` : 'Everything is uploaded.'}
    </div>
    ${pending ? `<div class="tiny muted" style="margin:-.3rem 0 .6rem">Waiting: <span class="mono">${esc(pendingSyncKeys().slice(0, 4).join(', '))}</span>${pendingSyncKeys().length > 4 ? ` and ${pendingSyncKeys().length - 4} more` : ''}</div>` : ''}
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
    return '';
  }
  const k = sessionKind();
  // Facts only (4.6 check 2): nothing before a sound has played.
  if (!k) return '';
  if (k === 'playback') return 'Your song has the sound';
  return 'Cues duck under your music';
}

// ------------------------------------------------------------ v3 layout ---
// Rehab Test v3 (2026-09-30): Apple's Settings shape. One grouped list; each row is an
// icon tile, a name, a one word value and a chevron, and pushes its own page (Back in
// the bar says Settings; a swipe from the left edge goes back too). The switches of the
// test app itself sit right in the list (Rehab Test). Every control, every behaviour and
// every data write of the old folds is unchanged: the same markup and data attributes
// now live on the pushed page, so bindSettings binds them exactly as before.

const TILE = {
  surgeries: '<path d="M8 3v7a4 4 0 0 0 8 0V3"/><path d="M12 14v7M9 21h6"/>',
  units: '<path d="M5 7h14l-2 12H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  appearance: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  sound: '<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  reminders: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  badge: '<rect x="4" y="6" width="13" height="13" rx="3"/><circle cx="18" cy="6" r="3" fill="currentColor"/>',
  oura: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/>',
  physiapp: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  sync: '<path d="M19 8A7.5 7.5 0 0 0 5.5 9"/><path d="M5 16a7.5 7.5 0 0 0 13.5-1"/><path d="M19 4v4h-4"/><path d="M5 20v-4h4"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  sources: '<path d="M5 4h9l5 5v11H5z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 17h6"/>',
  live: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="16.5" cy="12" r="1.8" fill="currentColor"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.2"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M10 3h4"/>',
  voice: '<path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3z"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20"/>',
  sfx: '<path d="M3 12h2.5l2-5 3 10 3-12 2.5 9 1.5-2H21"/>',
  widget: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/>',
};
const tile = (k, tone = '') => `<span class="rset-ico ${tone}" aria-hidden="true"><svg viewBox="0 0 24 24">${TILE[k]}</svg></span>`;
const CHEV = '<svg class="rset-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

const PANES = {
  surgeries: 'Your surgeries', units: 'Units and body', appearance: 'Appearance', sound: 'Workout sound',
  reminders: 'Reminders', badge: 'Home Screen badge', oura: 'Oura Ring', physiapp: 'PhysiApp', sync: 'Device sync',
  data: 'Your data', sources: 'Sources',
  // Round 3 consistency (2026-09-30): the picker is "Voice", so it never shares a name with the
  // Workout sound page's "Coach voice" switch (whether the coach speaks at all).
  voice: 'Voice', sounds: 'Sounds', notify: 'Notifications',
};

// The test app's own switches (per device; CONTRACT.md). Live Activities are on unless
// 'rt.live.off' is '1'; supplement names on Home Screen widgets are off unless he turns them
// on (his call at noon, 2026-09-30: "Show names on widgets"); never on the Lock Screen.
// The notification kinds moved to their own page (Notifications), each its own switch.
const RT_SWITCHES = [
  [PREF_LIVE, 'Live Activities', 'Workouts and rests on the Lock Screen', 'live', true],
  [WIDGET_NAMES_KEY, 'Show names on widgets', 'Supplements on the Home Screen', 'widget', false],
];
const rtOn = (key, inverted) => {
  let v = null;
  try { v = localStorage.getItem(key); } catch { /* private window: defaults */ }
  return inverted ? v !== '1' : v === '1';
};

// The iPad (round 3, ipad-global): Settings is a split view. The list stands on the left, the
// chosen page on the right, no push and no Back. Same gate as the CSS in rt.css: the test app on
// a screen at least 700 pt wide and 560 tall (never an iPhone, portrait or on its side).
// `ctx.setSplit` is the page on the right; `ctx.setPane` stays null so the header never shows
// a Back. Rotating from a pushed page to a wide window keeps that page (it becomes setSplit);
// narrowing again lands on the list (the phone's home for Settings).
// 2026-09-30 sweep: on the web iPad and Mac too (it was the native app only), since his iPad runs
// the web app. A phone is never 700 wide upright, so it keeps the list.
export const settingsSplit = () => document.body.classList.contains('mobile')
  && matchMedia('(min-width: 700px) and (min-height: 560px)').matches;

export function renderSettings(ctx = {}) {
  const asked = ctx.setPane && PANES[ctx.setPane] && paneShown(ctx.setPane) ? ctx.setPane : null;
  if (settingsSplit()) {
    if (asked) { ctx.setSplit = asked; ctx.setPane = null; }
    let k = ctx.setSplit;
    if (!k || !PANES[k] || !paneShown(k)) k = Object.keys(PANES).find(paneShown);
    ctx.setSplit = k;
    return renderList(ctx, k);
  }
  return asked ? renderPane(asked, ctx) : renderList(ctx);
}

// A row whose feature can never work here is hidden, never a pane with a disabled switch
// (C15, audit B6). Web push reminders stay while they are on, so they can be turned off.
function paneShown(k) {
  if (k === 'reminders') return pushSupported() || remindersOn();
  if (k === 'badge') return badgeAvailable() || badgeOn();
  if (k === 'notify') return isNative();
  return true;
}

function renderList(ctx = {}, split = null) {
  const s = state.data.settings;
  const pa = s.physiapp || {};
  const c = getConfig();
  const pending = isConfigured() ? pendingSyncCount() : 0;
  const ringNewest = lastNight()?.day || null;
  const short = (iso) => (iso ? fmtDateShort(iso) : '');
  // One short value per row (Apple Settings; audit X1). The detail is one push away.
  const val = {
    surgeries: [short(s.surgeryLeft), short(s.surgeryRight)].filter(Boolean).join(', ') || 'Not set',
    units: `${s.weightUnit}, ${s.lengthUnit}`,
    appearance: { auto: 'Automatic', light: 'Light', dark: 'Dark' }[s.theme || 'light'],
    sound: speakOn() ? 'Coach' : 'Tones',
    reminders: remindersOn() ? 'On' : 'Off',
    badge: badgeOn() ? 'On' : 'Off',
    oura: ringNewest ? fmtDateShort(ringNewest) : ringSettled() ? 'None' : '',
    physiapp: pa.code && pa.birthYear ? 'Mac' : 'Off',
    sync: !isConfigured() ? 'Off' : syncState.lastError ? 'Failed' : pending ? `${pending} waiting` : 'Synced',
    data: '',
    sources: String(CASE.sources.length),
    voice: '',
    sounds: sfx() === 'classic' ? 'Classic' : '',
    notify: (() => { const n = NOTIFY_KINDS.filter((k) => notifyOn(k.key)).length; return n ? `${n} on` : 'Off'; })(),
  };
  const bad = { sync: isConfigured() && !!syncState.lastError };
  const tone = { oura: 'dusk', sync: isConfigured() && !syncState.lastError && !pending ? 'good' : '' };
  const ICON = { voice: 'voice', sounds: 'sfx', notify: 'bell' };
  const row = (k) => `
    <button type="button" class="rset-row ${split === k ? 'sel' : ''}" data-pane="${k}" ${split === k ? 'aria-current="page"' : ''} ${k === 'voice' ? 'data-voice-row hidden' : ''}>
      ${tile(ICON[k] || k, tone[k] || '')}
      <span class="rset-t">${esc(PANES[k])}</span>
      <span class="rset-v ${bad[k] ? 'bad' : ''}" ${k === 'voice' || k === 'sounds' ? `data-${k}-value` : ''}>${esc(val[k] || '')}</span>${CHEV}
    </button>`;
  const group = (keys) => `<div class="rset-group">${keys.filter(paneShown).map(row).join('')}</div>`;
  return `
  <div class="stack settings-page rt-settings ${split ? 'rset-split' : ''}">
    ${split ? '<div class="rset-side">' : ''}
    <header class="pagehead"><h1>Settings</h1></header>
    ${group(['surgeries', 'units'])}
    ${group(['appearance', 'sound', 'voice', 'sounds', 'reminders', 'badge'])}
    ${/* The native app's own switches (Live Activities, widgets, its notifications). The web app
         has none of them, so on the web the section is not drawn (2026-09-30 sweep: a switch
         that does nothing is hidden, never shown). The web's reminders are Reminders above. */ ''}
    ${isNative() ? `<section class="rset-sec" aria-labelledby="rset-rt">
      <h2 class="rset-h" id="rset-rt">Rehab Test</h2>
      <div class="rset-group">
        ${/* Voice and Sounds sit with Workout sound above: every sound choice in one group. */ ''}
        ${['notify'].map(row).join('')}
        ${RT_SWITCHES.map(([key, title, sub, icon, inverted]) => `
          <label class="rset-row rset-switch">
            ${tile(icon)}
            <span class="rset-tt"><span class="rset-t">${esc(title)}</span><span class="rset-s">${esc(sub)}</span></span>
            <input type="checkbox" ${sw()} data-rtpref="${esc(key)}" ${inverted ? 'data-inverted' : ''} ${rtOn(key, inverted) ? 'checked' : ''}>
          </label>`).join('')}
      </div>
    </section>` : ''}
    ${group(['oura', 'physiapp', 'sync', 'data'])}
    <div class="rset-group">
      ${row('sources')}
      <div class="rset-row rset-static">${tile('info')}<span class="rset-t">Version</span><span class="rset-v" data-version>${esc(c.lastSyncedAt ? '' : '')}</span></div>
    </div>
    ${split ? `</div>
    <div class="rset-detail rset-pane" data-pane-page="${split}" data-split-pane="${split}">${paneInner(split, ctx)}</div>` : ''}
  </div>`;
}

/** A pushed page: its large title and the controls that used to sit in its fold. */
function renderPane(k, ctx) {
  return `
  <div class="stack settings-page rt-settings rset-pane" data-pane-page="${k}">
    ${paneInner(k, ctx)}
  </div>`;
}
function paneInner(k, ctx) {
  return `<header class="pagehead"><h1>${esc(PANES[k])}</h1></header>
    <div class="card setgroup rset-body" data-setg="${k}">${PANE_BODY[k](ctx)}</div>`;
}

const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const TICK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.5"/></svg>';
/** One choice in a pick list: the tick when chosen, the name, a line, a sample button. */
function pickRow(id, name, desc, on, kind) {
  return `<div class="rset-prow ${on ? 'on' : ''}" data-${kind}-row="${esc(id)}">
      <button type="button" class="rset-pbtn" role="radio" aria-checked="${on}" data-${kind}-pick="${esc(id)}">
        <span class="rset-ptick">${on ? TICK_SVG : ''}</span>
        <span class="rset-ptt"><b>${esc(name)}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</span>
      </button>
      <button type="button" class="rset-play" data-${kind}-sample="${esc(id)}" aria-label="Hear ${esc(name)}">${PLAY_SVG}</button>
    </div>`;
}

/** Move the tick to the chosen row, in place (no repaint under his finger). */
function markPick(list, kind, id) {
  list.querySelectorAll(`[data-${kind}-row]`).forEach((r) => {
    const on = r.getAttribute(`data-${kind}-row`) === id;
    r.classList.toggle('on', on);
    r.querySelector('.rset-pbtn')?.setAttribute('aria-checked', String(on));
    const t = r.querySelector('.rset-ptick');
    if (t) t.innerHTML = on ? TICK_SVG : '';
  });
}
/**
 * A voice's sample line, from the folder the player uses for it (packs.js voiceDir), so
 * "Alice (classic)" plays the original top level recordings (r3 audit TS-02, PS-08); the
 * default voice may still fall back to the top level.
 */
function voiceUrl(v, def) {
  if (!v) return null;
  const key = v.sample || 'ready';
  const url = `${voiceDir(v.id)}${key}.mp3`;
  const top = `./audio/voice/${key}.mp3`;
  return { url, fallback: v.id === def && url !== top ? top : null };
}
/**
 * Samples go through the player's audio session (unlockAudio asks for the mixing one, so
 * his music keeps playing), inside his tap; when they are done the session is handed back,
 * unless a workout is holding it.
 */
let sampleEl = null;
let seqTimers = [];
let handBack = null;
function takeSession() {
  clearTimeout(handBack);
  unlockAudio();
}
function giveBackLater(ms) {
  clearTimeout(handBack);
  handBack = setTimeout(() => { if (!sessionLog[sessionLog.length - 1]?.hold) releaseSession(); }, ms);
}
function stopSamples() {
  try { sampleEl?.pause(); } catch { /* ignore */ }
  seqTimers.forEach(clearTimeout);
  seqTimers = [];
}
function playSample(src) {
  if (!src) return;
  const { url, fallback } = typeof src === 'string' ? { url: src, fallback: null } : src;
  stopSamples();
  takeSession();
  const vol = Math.max(0.2, Math.min(1, voiceVolume()));
  const go = (u, next) => {
    const a = new Audio(u);
    a.volume = vol;
    sampleEl = a;
    a.addEventListener('ended', () => giveBackLater(600), { once: true });
    a.addEventListener('error', () => { if (next) go(next, null); else giveBackLater(600); }, { once: true });
    a.play().catch(() => {});
  };
  go(url, fallback);
}
/**
 * A sound set's sample: three pips and the "now", the way a step ends (audio.js
 * sampleSounds), for the set that is chosen. For another set (the play button on a row he
 * has not picked) the same four sounds from its own files, or the classic tones drawn here.
 */
function classicSampleUrl() {
  const rate = 22050;
  const n = Math.round(rate * 2);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  const pcm = new Float32Array(n);
  const tone = (at, f, dur, g) => {
    const a = Math.round(at * rate);
    const len = Math.round((dur + 0.08) * rate);
    for (let i = 0; i < len && a + i < n; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.005) * Math.exp(-Math.max(0, t - dur * 0.4) * 18);
      pcm[a + i] += Math.sin(2 * Math.PI * f * t) * g * env;
    }
  };
  for (const k of [0, 1, 2]) tone(0.05 + k * 0.5, 880, 0.08, 0.5);
  tone(1.55, 523, 0.32, 0.6);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let classicUrl = null;
async function sampleSet(id, picked) {
  stopSamples();
  takeSession();   // inside the tap: the context resumes and the mixing session is taken
  await loadSfx();
  if (picked || id === sfxId()) {
    await soundSetChanged();
    await loadSounds();
    sampleSounds();
    giveBackLater(3000);
    return;
  }
  if (id === CLASSIC) { playSample(classicUrl ||= classicSampleUrl()); return; }
  const f = sfxFiles(id);
  const seq = [[0, f.pip], [500, f.pip], [1000, f.pip], [1500, f.now]].filter(([, u]) => u);
  if (!seq.length) return;
  const vol = Math.max(0.2, Math.min(1, cueVolume()));
  seqTimers = seq.map(([ms, u]) => setTimeout(() => { const a = new Audio(u); a.volume = vol; a.play().catch(() => {}); }, ms));
  giveBackLater(3000);
}

const PANE_BODY = {
  surgeries() {
    const s = state.data.settings;
    return `<div class="card-body">
        <div class="rset-fields">
          <label class="fld">Injury<input type="date" data-set="injuryDate" value="${esc(s.injuryDate || '')}"></label>
          <label class="fld">Left ACL reconstruction<input type="date" data-set="surgeryLeft" value="${esc(s.surgeryLeft || '')}"></label>
          <label class="fld">Right ACL reconstruction<input type="date" data-set="surgeryRight" value="${esc(s.surgeryRight || '')}"></label>
        </div>
        <div class="rset-facts">
          <p><b class="rset-left">Left</b> ${esc(CASE.legs.left.procedure)}. ${esc(CASE.legs.left.weightBearing)}. ${esc(CASE.legs.left.complication)}</p>
          <p><b class="rset-right">Right</b> ${esc(CASE.legs.right.procedure)}. ${esc(CASE.legs.right.weightBearing)}. ${esc(CASE.legs.right.complication)}</p>
          <p>${esc(CASE.protocolNote)}</p>
        </div>
        <p class="rset-foot">From your clinical notes.</p>
      </div>`;
  },
  appearance() {
    const s = state.data.settings;
    return `<div class="card-body">
        <div class="themepick">
          ${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, label]) => `
            <button class="themeopt ${(s.theme || 'light') === k ? 'on' : ''}" data-theme-set="${k}" aria-pressed="${(s.theme || 'light') === k}">
              <span class="themeswatch ${k}"></span>
              <span class="themelabel">${label}</span>
            </button>`).join('')}
        </div>
      </div>`;
  },
  sound() {
    return `<div class="card-body">
        <div class="rset-list">
          ${speechAvailable() || audioAvailable() ? `<label class="check-row"><input type="checkbox" ${sw()} data-speak ${speakOn() ? 'checked' : ''} >
            <span><b>Coach voice</b><br><span class="muted">Calls each step</span></span></label>` : ''}
          ${stereoAvailable() ? `<label class="check-row"><input type="checkbox" ${sw()} data-stereo ${stereoOn() ? 'checked' : ''}>
            <span><b>Stereo sides</b><br><span class="muted">Left ear for left, right for right</span></span></label>` : ''}
          ${hapticsAvailable() ? `<label class="check-row"><input type="checkbox" ${sw()} data-haptics ${hapticsOn() ? 'checked' : ''}>
            <span><b>Touch feedback</b><br><span class="muted">A tap on a tick and a step change</span></span></label>` : ''}
        </div>
        <div class="rset-sliders">
          <label class="fld">Cue volume<input type="range" min="0.2" max="1" step="0.1" data-cuevol value="${cueVolume()}"></label>
          <label class="fld">Voice volume<input type="range" min="0.2" max="1" step="0.05" data-voicevol value="${voiceVolume()}"></label>
        </div>
        <div class="row rset-btns"><button class="btn" data-soundtest>Test sound</button><button class="btn" data-coachdemo><span class="cd-dial" aria-hidden="true">${DIAL_ICON}</span><span>Hear the Coach</span></button></div>
        <p class="rset-foot" data-soundtest-out>${esc(audioModeLine())}</p>
      </div>`;
  },
  reminders() {
    return `<div class="card-body">
        <div class="rset-list">
          <label class="check-row"><input type="checkbox" ${sw()} data-reminders ${remindersOn() ? 'checked' : ''}>
            <span><b>Remind me on this device</b><br><span class="muted">Sent by your Mac; they clear when you open the app</span></span></label>
        </div>
        <p class="rset-foot" data-reminders-out></p>
        <div ${remindersOn() ? '' : 'hidden'} data-remind-what>
          <div class="rset-list">
          ${REMIND_KINDS.map(([k, label, hint, timeKey]) => `
            <label class="check-row"><input type="checkbox" ${sw()} data-remindkind="${k}" ${remindPrefs()[k] ? 'checked' : ''}>
              <span><b>${esc(label)}</b><br><span class="muted">${esc(hint.split('. ')[0].replace(/\.$/, ''))}</span></span></label>
            ${timeKey ? `<div class="row remind-at" ${remindPrefs()[k] ? '' : 'hidden'}><label class="fld">At<input type="time" data-remindat="${timeKey}" value="${esc(remindPrefs()[timeKey])}"></label></div>` : ''}`).join('')}
          <label class="check-row"><input type="checkbox" ${sw()} data-quiet ${remindPrefs().quietOn ? 'checked' : ''}>
            <span><b>Quiet hours</b><br><span class="muted">Anything due then is skipped</span></span></label>
          <div class="row" ${remindPrefs().quietOn ? '' : 'hidden'} data-quiet-times>
            <label class="fld">From<input type="time" data-quietfrom value="${esc(remindPrefs().quietFrom)}"></label>
            <label class="fld">Until<input type="time" data-quietto value="${esc(remindPrefs().quietTo)}"></label>
          </div>
          </div>
        </div>
      </div>`;
  },
  badge() {
    return `<div class="card-body">
        <div class="rset-list">
          <label class="check-row"><input type="checkbox" ${sw()} data-badge ${badgeOn() ? 'checked' : ''}>
            <span><b>A number on the app icon</b><br><span class="muted">What is still due today</span></span></label>
        </div>
        <p class="rset-foot" data-badge-out></p>
        <div ${badgeOn() ? '' : 'hidden'} data-badge-what>
          <div class="rset-list">
          ${BADGE_PARTS.map(([k, label]) => `<label class="check-row"><input type="checkbox" ${sw()} data-badgepart="${k}" ${badgeParts().includes(k) ? 'checked' : ''}><span><b>${esc(label)}</b></span></label>`).join('')}
          </div>
        </div>
      </div>`;
  },
  units() {
    const s = state.data.settings;
    return `<div class="card-body">
        <div class="rset-fields">
          <label class="fld">Weight
            <select data-set="weightUnit">
              <option value="kg" ${s.weightUnit === 'kg' ? 'selected' : ''}>kg</option>
              <option value="lb" ${s.weightUnit === 'lb' ? 'selected' : ''}>lb</option>
            </select></label>
          <label class="fld">Length
            <select data-set="lengthUnit">
              <option value="cm" ${s.lengthUnit === 'cm' ? 'selected' : ''}>cm</option>
              <option value="in" ${s.lengthUnit === 'in' ? 'selected' : ''}>in</option>
            </select></label>
          <label class="fld">Dominant leg
            <select data-set="dominantLeg">
              <option value="right" ${s.dominantLeg === 'right' ? 'selected' : ''}>Right</option>
              <option value="left" ${s.dominantLeg === 'left' ? 'selected' : ''}>Left</option>
            </select></label>
          <label class="fld">Sex
            <select data-set="sex">
              <option value="" ${!s.sex ? 'selected' : ''}>Not set</option>
              <option value="M" ${s.sex === 'M' ? 'selected' : ''}>Male</option>
              <option value="F" ${s.sex === 'F' ? 'selected' : ''}>Female</option>
            </select></label>
          <label class="fld">Date of birth<input type="date" data-set="dob" value="${esc(s.dob || '')}"></label>
          <label class="fld">Bodyweight (${esc(s.weightUnit)})
            <input type="number" inputmode="decimal" step="any" data-set="bodyweight" value="${s.bodyweight ?? ''}" placeholder="for bodyweight goals"></label>
        </div>
      </div>`;
  },
  data() {
    return `<div class="card-body">
        <div class="rset-list rset-actions">
          <button class="btn" data-export>Download backup (JSON)</button>
          <button class="btn" data-export-csv>Export training report (CSV)</button>
          <label class="btn" style="cursor:pointer">Import backup<input type="file" accept="application/json,.json" data-import hidden></label>
        </div>
        <p class="rset-foot">An import merges. Nothing is deleted.</p>
        ${SERVER_MODE ? '<p class="rset-foot">The Mac keeps every save in data/backups/.</p>' : ''}
        <div class="rset-list rset-actions" style="margin-top:14px">
          <button class="btn" data-reseed>Re-add seeded clinic sessions</button>
        </div>
      </div>`;
  },
  sync() {
    return `<div class="card-body">
        ${syncCard()}
        ${isNative() ? '' : `<div class="row" style="margin-top:.9rem;gap:.5rem;flex-wrap:wrap">
          <button class="btn" data-app-refresh>Force update the app</button>
          <span class="tiny muted" data-refresh-status></span>
        </div>`}
      </div>`;
  },
  oura() {
    const ringNewest = lastNight()?.day || null;
    return `<div class="card-body">
        <div class="row rset-btns">
          <button class="btn primary" data-oura-refresh>${SERVER_MODE ? 'Fetch from Oura' : 'Sync ring data'}</button>
        </div>
        <p class="rset-foot" data-oura-status>${ringNewest
          ? `Newest night ${esc(fmtDateShort(ringNewest))}${ringBuiltAt() ? `, built ${esc(when12(ringBuiltAt()))}` : ''}`
          : ringSettled() ? 'No ring data on this device yet' : ''}</p>
        <p class="rset-foot">${SERVER_MODE ? 'Daily at noon' : 'From the Mac'}. Read only.</p>
        ${ringSource() === 'cache' ? '<p class="rset-foot">This device’s last copy</p>' : ''}
      </div>`;
  },
  physiapp() {
    const s = state.data.settings;
    const pa = s.physiapp || {};
    const connected = !!(pa.code && pa.birthYear);
    const auto = s.physiappAuto !== false;
    return `<div class="card-body">
        <p class="rset-lead">${connected
          ? `${s.physiappLastSync ? `Checked ${esc(when12(s.physiappLastSync))}` : 'Not checked yet'}${s.physiappLastImport ? `. New results ${esc(when12(s.physiappLastImport))}` : ''}.`
          : 'Not set up.'} Read only.${SERVER_MODE ? ' <span data-pa-live></span>' : ''}</p>
        <div class="rset-fields">
          <label class="fld">Program code
            <span class="secret-field"><input data-pa="code" type="password" value="${esc(pa.code || '')}" placeholder="From your clinician" autocomplete="off" spellcheck="false">
              <button type="button" class="btn sm ghost" data-reveal aria-pressed="false">Show</button></span>
          </label>
          <label class="fld">Year of birth
            <input data-pa="birthYear" type="number" inputmode="numeric" min="1900" max="2100" value="${esc(String(pa.birthYear || ''))}" autocomplete="off" placeholder="1993">
          </label>
        </div>
        <div class="rset-list">
          <label class="check-row"><input type="checkbox" ${sw()} data-pa-auto ${auto ? 'checked' : ''}>
            <span><b>Sync when I open the app</b><br><span class="muted">On the Mac</span></span></label>
        </div>
        ${SERVER_MODE ? `
        <div class="row rset-btns">
          <button class="btn primary" data-pa-sync="1">Sync today</button>
          <button class="btn" data-pa-sync="7">Last 7 days</button>
          <button class="btn" data-pa-sync="30">Last 30 days</button>
        </div>
        <p class="rset-foot" data-pa-status></p>` : ''}
        <details class="disc" data-key="set:pawhat">
          <summary>What it brings across</summary>
          <div class="rset-facts">
            <p><b>Only what you ticked off.</b> A prefilled form with no real result behind it is ignored.</p>
            <p><b>One row for both legs.</b> PhysiApp has no side split.</p>
            <p><b>Yours wins.</b> A row you logged or changed here is never overwritten.</p>
            <p><b>Names must match.</b> A renamed exercise is listed for you, never guessed.</p>
          </div>
        </details>
      </div>`;
  },
  // Round 3: the coach's voice (web-src/audio/voice/voices.json). Each row: the name, one
  // line about it, a play button for a sample line; the chosen one carries the check.
  // Filled once the list has loaded (bindSettings); nothing is drawn when there is no list.
  voice() {
    return `<div class="card-body"><div class="rset-list rset-pick" data-voice-list role="radiogroup" aria-label="Coach voice"></div></div>`;
  },
  // Round 3: the workout sounds (web-src/audio/sfx/sfx.json). Classic, the synthesized
  // sounds, is always there and always the fallback; the new sets are listed after it.
  sounds() {
    return `<div class="card-body"><div class="rset-list rset-pick" data-sfx-list role="radiogroup" aria-label="Sounds">${pickRow('classic', 'Classic', 'The tones you know', sfx() === 'classic', 'sfx')}</div></div>`;
  },
  // Round 3: what this app may send. A kind his web app already sends stays off until he
  // turns it on here (so never two of one); a kind only this app sends is on by default.
  notify() {
    const q = quietHours();
    const t12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
    return `<div class="card-body">
        <div class="rset-list">
          ${NOTIFY_KINDS.map((k) => `<label class="check-row"><input type="checkbox" ${sw()} data-notifykind="${esc(k.key)}" ${notifyOn(k.key) ? 'checked' : ''}>
            <span><b>${esc(k.title)}</b><br><span class="muted">${esc(k.sub)}${k.dup ? '. Your web app sends it too' : ''}</span></span></label>`).join('')}
        </div>
        <p class="rset-foot">Quiet from ${esc(t12(q.from))} to ${esc(t12(q.to))}. Nothing names a medicine.</p>
      </div>`;
  },
  sources() {
    return `<div class="card-body">
        <div class="rset-facts">
          ${CASE.sources.map((s2) => `<p><b>${esc(s2.label)}</b> ${esc(s2.note)}</p>`).join('')}
        </div>
        <p class="rset-foot">Not medical advice. Thresholds come from your documents; defaults of this app are labelled.</p>
      </div>`;
  },
};

let wideRerender = null;
try {
  matchMedia('(min-width: 700px) and (min-height: 560px)').addEventListener('change', () => { if (wideRerender) wideRerender(); });
} catch { /* older engines: the layout follows the next paint */ }

export function bindSettings(root, ctx, rerender) {
  // v3: a row pushes its page; Back (the bar, or a swipe from the left edge) comes home.
  // Where WebKit has View Transitions the page slides as one (vt.js); otherwise the
  // web push under the header (ctx.pushDir) plays.
  const go = (pane, dir) => {
    const run = () => { ctx.setPane = pane; rerender(); };
    if (vtSupported()) vtStart(run, {}, { dir });
    else { ctx.pushDir = dir; run(); }
  };
  ctx.settingsBack = () => go(null, -1);
  const split = !!root.querySelector('.rset-split');
  // Turning the iPad, or Split View resizing the window across 700 pt, swaps split for list.
  wideRerender = () => { if (document.querySelector('#view .rt-settings')) rerender(); };
  if (split) {
    // Split view: choosing a row swaps the page on the right where it stands. The list keeps
    // its place (it scrolls on its own); the new page settles in with a small spring, no fade.
    root.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.pane === ctx.setSplit) return;
      const side = root.querySelector('.rset-side');
      const y = side ? side.scrollTop : 0;
      ctx.setSplit = b.dataset.pane;
      rerender();
      const again = document.querySelector('#view .rset-side');
      if (again) again.scrollTop = y;
    }));
  } else {
    root.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => go(b.dataset.pane, 1)));
  }
  if (ctx.setPane) {
    let x0 = null;
    root.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t && t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (x0 && t && t.clientX - x0.x > 80 && Math.abs(t.clientY - x0.y) < 60) go(null, -1);
      x0 = null;
    }, { passive: true });
  }
  // Every select is a menu button (07 4.4); the select keeps the value and its listener.
  enhanceSelects(root);
  // iOS sliders fill their track up to the thumb (audit T29).
  root.querySelectorAll('.rset-sliders input[type=range]').forEach((r) => {
    const fill = () => r.style.setProperty('--v', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
    fill();
    r.addEventListener('input', fill);
  });

  // The test app's own switches: per device, in localStorage (CONTRACT.md). Turning a
  // notification on asks iOS once; a no puts the switch back and says where to change it.
  root.querySelectorAll('[data-rtpref]').forEach((cb) => cb.addEventListener('change', async () => {
    const key = cb.dataset.rtpref;
    const inverted = cb.hasAttribute('data-inverted');
    const want = cb.checked;
    const store = (on) => { try { if (inverted) { if (on) localStorage.removeItem(key); else localStorage.setItem(key, '1'); } else if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* private window */ } };
    store(want);
    window.dispatchEvent(new CustomEvent('rt-prefs', { detail: { key, on: inverted ? !want : want } }));
  }));

  // Notifications (round 3): one switch per kind. Turning one on asks iOS once; a no puts
  // the switch back and says where to change it.
  root.querySelectorAll('[data-notifykind]').forEach((cb) => cb.addEventListener('change', async () => {
    const key = cb.dataset.notifykind;
    setNotify(key, cb.checked);
    if (cb.checked && isNative()) {
      const got = await notifyPermission(false);
      if (got === 'denied') {
        setNotify(key, false);
        cb.checked = false;
        toast('<b>Notifications are off</b> <span>for Rehab Test in iOS Settings</span>', 'warn', { key: 'rt-notify' });
      }
    }
  }));

  // Coach voice and Sounds (round 3): the lists come from the manifests the audio work
  // writes; a row he cannot use is never shown. A pick is kept on this device ('rt.voice',
  // 'rt.sfx'); the play button plays a sample line or sound, only on his tap.
  voicesManifest().then((m) => {
    const voices = Array.isArray(m?.voices) ? m.voices : [];
    const cur = voice() || m?.default || voices[0]?.id;
    const chosen = voices.find((v) => v.id === cur) || voices[0];
    const row = root.querySelector('[data-voice-row]');
    if (row && voices.length) { row.hidden = false; const v = row.querySelector('[data-voice-value]'); if (v) v.textContent = chosen?.name || ''; }
    const list = root.querySelector('[data-voice-list]');
    if (!list) return;
    if (!voices.length) { list.innerHTML = '<p class="rset-foot">No voices on this device yet</p>'; return; }
    list.innerHTML = voices.map((v) => pickRow(v.id, v.name, v.desc || '', v.id === chosen?.id, 'voice')).join('');
    list.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-voice-pick]');
      const hear = e.target.closest('[data-voice-sample]');
      if (pick) {
        const id = pick.dataset.voicePick;
        setPref(VOICE_KEY, id === m.default ? null : id);
        markPick(list, 'voice', id);
        playSample(voiceUrl(voices.find((v) => v.id === id), m.default));
      } else if (hear) {
        playSample(voiceUrl(voices.find((v) => v.id === hear.dataset.voiceSample), m.default));
      }
    });
  });
  sfxManifest().then((m) => {
    const sets = (Array.isArray(m?.sets) ? m.sets : []).filter((x) => x && x.id && x.id !== 'classic');
    const cur = sfx();
    const val = root.querySelector('[data-sounds-value]');
    if (val) val.textContent = cur === 'classic' ? 'Classic' : (sets.find((x) => x.id === cur)?.name || 'Classic');
    const list = root.querySelector('[data-sfx-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', sets.map((x) => pickRow(x.id, x.name, x.desc || '', x.id === cur, 'sfx')).join(''));
    list.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-sfx-pick]');
      const hear = e.target.closest('[data-sfx-sample]');
      const id = pick?.dataset.sfxPick || hear?.dataset.sfxSample;
      if (!id) return;
      // Kept as its id, Classic too: an empty pref means sfx.json's default (Glass), so
      // storing nothing for Classic silently kept Glass.
      if (pick) { setPref(SFX_KEY, id); markPick(list, 'sfx', id); }
      // Every set plays the same representative moment: three pips and the "now" (PS-08).
      sampleSet(id, !!pick);
    });
  });

  // Which build this is (09 2a: no update control in the app, the version in Settings).
  const ver = root.querySelector('[data-version]');
  if (ver) {
    nativeCall('info').then((info) => {
      // The app version only; the web build hash is code-looking text (C25, audit T29).
      if (info?.version) { ver.textContent = String(info.version); return; }
      // The web app: the build the service worker runs (2026-09-30 sweep: "Web" alone gave him
      // no way to see that a Force update had landed).
      const w = navigator.serviceWorker?.controller;
      if (!w) { ver.textContent = 'Web'; return; }
      const ch = new MessageChannel();
      const t = setTimeout(() => { ver.textContent = 'Web'; }, 3000);
      ch.port1.onmessage = (e) => { clearTimeout(t); ver.textContent = e.data?.version ? `Web, build ${e.data.version}` : 'Web'; };
      try { w.postMessage({ kind: 'version' }, [ch.port2]); } catch { clearTimeout(t); ver.textContent = 'Web'; }
    });
  }

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
  // The ring, on demand. The same action as the button on the ring page itself
  // (syncRing): on the Mac it runs the pull the noon job runs, everywhere else
  // it picks up what the Mac last put in the relay. Nothing here touches the
  // log: the ring is a derived layer that lives outside the record.
  root.querySelector('[data-oura-refresh]')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const status = root.querySelector('[data-oura-status]');
    const say = (t) => { if (status) status.textContent = t; };
    const back = status ? status.textContent : '';
    btn.disabled = true;
    say(SERVER_MODE ? 'Asking Oura...' : 'Checking...');
    try {
      const out = await syncRing();
      if (!out.ok) {
        say(back);
        toast(`<b>Could not fetch</b><br><span>${esc(out.message)}</span>`, 'warn');
        return;
      }
      if (out.message) toast(`<b>Some of it did not come back</b><br><span>${esc(out.message)}</span>`, 'warn');
      else {
        const w = syncWords(out);
        toast(`<b>${esc(w.title)}</b><br><span>${esc(w.body)}</span>`);
      }
      if (out.asked && !out.changed) {
        waitForMac((day) => {
          toast(`<b>Ring updated</b><br><span>Newest night ${esc(fmtDateShort(day))}.</span>`);
          rerender();
        });
      }
      rerender();
    } finally {
      btn.disabled = false;
    }
  });

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

  // A switch's change patches the page in place (B6-2): a full repaint replaced
  // the switch under his finger, so neither Safari's own switch nor the CSS knob
  // ever slid, it simply appeared on. A patch keeps the node; anything the patch
  // cannot do still repaints in full.
  const flipped = () => rerender({ soft: true });
  root.querySelector('[data-speak]')?.addEventListener('change', (e) => {
    setSpeak(e.target.checked);
    // Say one line immediately, so turning it on proves itself rather than
    // leaving him to start a workout to find out.
    // In the recorded voice when it loads in time; the tap unlocks the sound.
    if (e.target.checked) { unlockAudio(); loadVoice().then(() => say('Spoken cues are on', { force: true })); }
    flipped();
  });
  // Per device, on unless he turns it off (B6-3). Heard from the next side line on.
  root.querySelector('[data-stereo]')?.addEventListener('change', (e) => {
    setStereo(e.target.checked);
    flipped();
  });
  root.querySelector('[data-haptics]')?.addEventListener('change', (e) => {
    setHaptics(e.target.checked);
    if (e.target.checked) import('../feedback.js').then((m) => m.haptic('phase'));
    flipped();
  });
  root.querySelector('[data-reminders]')?.addEventListener('change', async (e) => {
    const out = root.querySelector('[data-reminders-out]');
    if (!e.target.checked) { await disableReminders(); flipped(); return; }
    if (out) out.textContent = 'asking this device…';
    const r = await enableReminders();
    if (!r.ok) { e.target.checked = false; if (out) out.textContent = r.why; return; }
    flipped();
  });
  root.querySelectorAll('[data-remindkind]').forEach((cb) => cb.addEventListener('change', () => {
    setRemind({ [cb.dataset.remindkind]: cb.checked });
    flipped();   // the time field under it appears or goes
  }));
  root.querySelectorAll('[data-remindat]').forEach((inp) => inp.addEventListener('change', () => {
    if (inp.value) setRemind({ [inp.dataset.remindat]: inp.value });
  }));
  root.querySelector('[data-quiet]')?.addEventListener('change', (e) => {
    setRemind({ quietOn: e.target.checked });
    flipped();
  });
  root.querySelector('[data-quietfrom]')?.addEventListener('change', (e) => setRemind({ quietFrom: e.target.value }));
  root.querySelector('[data-quietto]')?.addEventListener('change', (e) => setRemind({ quietTo: e.target.value }));
  root.querySelector('[data-badge]')?.addEventListener('change', async (e) => {
    const out = root.querySelector('[data-badge-out]');
    if (!e.target.checked) { disableBadge(); flipped(); return; }
    // iOS needs notification permission before a badge shows, and the ask has
    // to come from this tap.
    const r = await enableBadge();
    if (!r.ok) {
      e.target.checked = false;
      if (out) out.textContent = r.why;
      return;
    }
    flipped();
  });
  root.querySelectorAll('[data-badgepart]').forEach((cb) => cb.addEventListener('change', () => {
    const want = [...root.querySelectorAll('[data-badgepart]')].filter((x) => x.checked).map((x) => x.dataset.badgepart);
    setBadgeParts(want);
    // Repaint from Today's own numbers on the next render; clear now so a part
    // he just switched off cannot linger on the icon.
    paintBadge({ exercises: 0, supplements: 0 });
    flipped();
  }));
  root.querySelector('[data-cuevol]')?.addEventListener('input', (e) => {
    // Set it by ear: every move plays the test tones at the new level, so he is
    // never guessing what a number means.
    setCueVolume(Number(e.target.value));
    soundCheck();
  });
  // The coach's own level against the cues (B6-4). Set by ear: letting go says
  // "Get ready!" at the new level, like the cue volume's test tones.
  root.querySelector('[data-voicevol]')?.addEventListener('input', (e) => setVoiceVolume(Number(e.target.value)));
  root.querySelector('[data-voicevol]')?.addEventListener('change', () => {
    unlockAudio();
    loadVoice();
    whenVoiceReady('ready', 1500).then((ok) => { if (ok) playVoice('ready'); });
  });
  // Hear the coach (B6-4): every moment of a workout once, only on this tap.
  // The dial pops with each one, on timers set to the audio clock's times.
  root.querySelector('[data-coachdemo]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const out = root.querySelector('[data-soundtest-out]');
    if (!unlockAudio()) { if (out) out.textContent = 'No sound here'; return; }
    preferVoice(COACH_LINES);
    loadVoice();
    await whenVoiceReady('ready', 1500);
    const lead = coachDemo();
    if (lead == null) return;   // one is still playing
    for (const t of COACH_HITS) {
      setTimeout(() => {
        const icon = b.isConnected ? b.querySelector('.cd-dial') : document.querySelector('[data-coachdemo] .cd-dial');
        if (icon) pop(icon);
      }, (lead + t) * 1000);
    }
  });
  root.querySelector('[data-soundtest]')?.addEventListener('click', () => {
    const out = root.querySelector('[data-soundtest-out]');
    const ok = soundCheck();
    // Two tones were sent; whether they were heard is his to say, not ours.
    if (out) out.textContent = ok ? 'Two tones sent' : 'No sound here';
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
        // A new weight unit re-expresses the bodyweight at once, not on the
        // next launch (2026-09-22 audit).
        if (k === 'weightUnit') syncBodyweightSetting(d);
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
