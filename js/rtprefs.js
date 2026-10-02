// Rehab Test round 3 (2026-09-30): this device's choices for the test app, one place.
// Settings > Rehab Test draws them; any module reads them. All per device, in localStorage
// (CONTRACT.md "Round 3 additions"), every read and write in try/catch.
//
//   voice()           the coach voice id ('rt.voice'), or '' for the default in voices.json
//   sfx()             the sound set id ('rt.sfx'), else sfx.json's default set, else 'classic'
//   widgetNames()     true only when 'rt.widgetNames' is '1' (supplement names on Home Screen
//                     widgets; OFF by default, his call at noon; never on the Lock Screen)
//   notifyOn(key)     is a notification kind switched on here (default per kind, below)
//   inQuiet(ms)       inside his quiet hours (his synced settings, else 01:00 to 09:00)
//   NOTIFY_KINDS      the kinds this app can send, drawn as switches in Settings
//   registerNotifyKind(spec)   another module adds a kind { key, title, sub, dup, defaultOn }
//
// Notification rule (orchestrator brief, CONTRACT line 47): a kind his web app ALREADY sends
// (dup: true) stays off until he switches it on here, so he never gets two; a kind only this
// app can send is on by default. Rest end alerts are the exception, off: a settled no he may
// reopen (CONTRACT). Any change fires window 'rt-prefs' { key, on, value }.

import { remindPrefs, inQuietHours } from './remind.js';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

export const VOICE_KEY = 'rt.voice';
export const SFX_KEY = 'rt.sfx';
export const WIDGET_NAMES_KEY = 'rt.widgetNames';

export const voice = () => get(VOICE_KEY) || '';
// Round 3 consistency (2026-09-30): until he picks, the set is the one sfx.json names as its
// default (the audio builder's "glass"), the way the voice already follows voices.json's
// default (the new Alice). Classic is always one tap away in Settings and stays the fallback
// for any row a set lacks. Before the manifest has loaded, and when it names no set: Classic.
let sfxDefault = 'classic';
export const sfx = () => get(SFX_KEY) || sfxDefault;
export const widgetNames = () => get(WIDGET_NAMES_KEY) === '1';

export function setPref(key, value) {
  put(key, value);
  try { window.dispatchEvent(new CustomEvent('rt-prefs', { detail: { key, value, on: value === '1' } })); } catch { /* no window */ }
}

export const NOTIFY_KINDS = [
  // The web app's push already sends this one: a second copy only when he asks.
  { key: 'rt.notify.routines', title: 'Tendon loading', sub: 'When the hour after the collagen is up', dup: true, defaultOn: false },
  // Only this app can send it, but it is a settled no until he reopens it (CONTRACT).
  { key: 'rt.notify.restEnd', title: 'Rest end', sub: 'While you are in another app', dup: false, defaultOn: false },
];
export function registerNotifyKind(spec) {
  if (!spec?.key || NOTIFY_KINDS.some((k) => k.key === spec.key)) return;
  NOTIFY_KINDS.push({ dup: false, defaultOn: !spec.dup, ...spec });
}

/** On here? '1' on, '0' off, nothing stored: the kind's default. */
export function notifyOn(key) {
  const v = get(key);
  if (v === '1') return true;
  if (v === '0') return false;
  return !!NOTIFY_KINDS.find((k) => k.key === key)?.defaultOn;
}
export function setNotify(key, on) {
  const kind = NOTIFY_KINDS.find((k) => k.key === key);
  // Stored only when it differs from the default, so native-bridge pref() ('1' = on) keeps
  // agreeing for the kinds that default off.
  setPref(key, on === !!kind?.defaultOn && !kind?.defaultOn ? null : on ? '1' : '0');
}

/** His quiet hours: the synced ones he set for the web app's reminders, else 01:00 to 09:00. */
export function quietHours() {
  try {
    const p = remindPrefs();
    if (p.quietOn) return { from: p.quietFrom, to: p.quietTo, prefs: p };
  } catch { /* data not loaded yet */ }
  return { from: '01:00', to: '09:00', prefs: { quietOn: true, quietFrom: '01:00', quietTo: '09:00' } };
}
export function inQuiet(ms = Date.now()) {
  const d = new Date(ms);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return inQuietHours(quietHours().prefs, hhmm);
}

// ------------------------------------------------------------ the manifests ---
// web-src/audio/voice/voices.json { default, voices: [{ id, name, desc, sample? }] } and
// web-src/audio/sfx/sfx.json { default, sets: [{ id, name, files: { <soundMapKey>: file } }] }.
// Either may not exist yet: null, and Settings shows only what is there.
const cache = {};
async function manifest(path) {
  if (path in cache) return cache[path];
  cache[path] = fetch(path, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache[path];
}
export const voicesManifest = () => manifest('./audio/voice/voices.json');
export const sfxManifest = () => manifest('./audio/sfx/sfx.json');

// The sound set's default, once sfx.json is read. Anything reading sfx() before this lands
// hears Classic; the 'rt-prefs' event lets the player and Settings follow when it changes.
sfxManifest().then((m) => {
  const d = m && typeof m.default === 'string' ? m.default : '';
  const ok = d && d !== 'classic' && Array.isArray(m.sets) && m.sets.some((x) => x && x.id === d && x.files && typeof x.files === 'object');
  if (!ok || d === sfxDefault) return;
  sfxDefault = d;
  if (!get(SFX_KEY)) {
    try { window.dispatchEvent(new CustomEvent('rt-prefs', { detail: { key: SFX_KEY, value: d, on: false } })); } catch { /* no window */ }
  }
}).catch(() => { /* no manifest: Classic */ });
