// Touch feedback and spoken cues (items 5 and 7, 2026-09-15).
//
// Both are ON unless he turns them off, and both are per device, like every
// other sound choice: what he wants on the phone in a gym is not what he wants
// on the Mac (his call, 2026-09-23: the voice and every new feature arrive on).
// They read through featureOn() in defaults.js, so a stored 'off' he chose
// stays off and nothing else does. Neither is ever required. Where a device
// cannot do one, its switch is hidden (his rule: hide dead controls) and the
// workout is unchanged, because the countdown, the ring and the labels already
// carry every step.

import { hasVoice, playVoice, playVoiceAt, stopVoice, cancelPendingVoice, audioPending, whenVoiceReady } from './player/audio.js';
import { featureOn } from './defaults.js';

const HAPTIC_KEY = 'rehab.feedback.haptics';
const SPEAK_KEY = 'rehab.feedback.speak';

const write = (k, on) => { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch { /* per device */ } };

// On unless he has turned it off (his call, 2026-09-23: the recorded voice and
// every new feature default ON, so a force update brings them in by itself).
export const hapticsOn = () => featureOn(HAPTIC_KEY);
export const speakOn = () => featureOn(SPEAK_KEY);
export const setHaptics = (on) => write(HAPTIC_KEY, on);
export const setSpeak = (on) => write(SPEAK_KEY, on);

// ------------------------------------------------------------- haptics ----
//
// Safari on iOS does not implement navigator.vibrate, so the only route is the
// switch control's own feedback: toggling a checkbox with the `switch`
// attribute inside a label fires the system haptic (iOS 17.4 and later). It is
// a real control doing a real thing, not a private API, but it IS a trick, so
// it is kept to one hidden element, it is never spoken by a screen reader, and
// every call is wrapped: a device that does nothing here simply does nothing.

let tapEl = null;
function switchEl() {
  if (tapEl || typeof document === 'undefined') return tapEl;
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    tapEl = input;
  } catch { tapEl = null; }
  return tapEl;
}

/**
 * True where there is something to feel a tap with: a phone. navigator.vibrate
 * exists in desktop Chrome, where nothing moves, so it counts only with a touch
 * screen as the main pointer (Android). On iOS the switch's haptic needs a
 * Taptic Engine, which only the iPhone has: Safari on his iPad and his Mac knows
 * the switch too and does nothing with it. Before this the Mac said "touch
 * feedback is on" (review, 2026-09-23).
 */
let hapticsCan = null;
export function hapticsAvailable() {
  if (hapticsCan != null) return hapticsCan;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  try {
    if (typeof navigator.vibrate === 'function') hapticsCan = !!window.matchMedia?.('(pointer: coarse)').matches;
    else hapticsCan = 'switch' in document.createElement('input') && /iPhone|iPod/.test(navigator.userAgent || '');
  } catch { hapticsCan = false; }
  return hapticsCan;
}

// ------------------------------------------------ taps you can feel ----
//
// B6-1 (2026-09-23). A script toggling a switch may be blocked on his iOS
// (the unlinked haptic probe page asks his phone), but a FINGER toggling one
// never is.
// So the controls that count a tap (the dock's Set done and Pause, minus and
// plus, Today's Start and tick circles) render, where there is a switch to
// feel and touch feedback is on, as a <label> around a hidden switch: his tap
// on the label toggles the switch, and iOS gives its own tap. Everywhere else
// they stay <button>s, exactly as before.
//
// The label's click is forwarded to the switch as a second click, whose target
// is input.hap: every handler ignores that one, so a tap counts once.

let canSwitch = null;
export function switchSupported() {
  if (canSwitch != null) return canSwitch;
  try { canSwitch = typeof document !== 'undefined' && 'switch' in document.createElement('input'); } catch { canSwitch = false; }
  return canSwitch;
}

/** True when the tap controls render as labels around a hidden switch. */
export const hapTaps = () => hapticsOn() && switchSupported();

/** The hidden switch inside such a label. */
export const hapInput = (disabled = false) => `<input type="checkbox" switch class="hap" tabindex="-1" aria-hidden="true"${disabled ? ' disabled' : ''}>`;

/** The second click a label forwards to its switch: never a tap of its own. */
export const forwarded = (ev) => !!ev?.target?.matches?.('input.hap');

/** A label control (or a button) that is switched off. */
export const isOff = (el) => !!el && (el.disabled || el.getAttribute('aria-disabled') === 'true');

// The tap that a switch felt by itself: the script's own buzz for the same tap
// would be a second one, so haptic() skips it (tapFelt). Marked in the capture
// phase, before any handler of that click runs.
let nativeAt = -1e9;
export const tapFelt = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) - nativeAt < 150;

function bindTaps() {
  if (typeof document === 'undefined' || bindTaps.done) return;
  bindTaps.done = true;
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t?.closest) return;
    const sw = t.matches?.('input[type=checkbox][switch]') ? t : t.closest('label')?.control;
    if (switchSupported() && sw?.matches?.('input[type=checkbox][switch]') && !sw.disabled && ev.isTrusted) nativeAt = performance.now();
  }, true);
  // A label click hands focus to its switch in some browsers; the label keeps
  // it, so the next Enter or Space still reaches the control he is on.
  document.addEventListener('focusin', (ev) => {
    const host = ev.target?.matches?.('input.hap') ? ev.target.parentElement : null;
    if (host && host.tabIndex >= 0) host.focus({ preventScroll: true });
  }, true);
  // Enter and Space on a label control, as on a button. A held key counts once.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const el = ev.target;
    if (el?.tagName !== 'LABEL' || !el.querySelector(':scope > input.hap')) return;
    ev.preventDefault();
    if (!ev.repeat) el.click();
  });
}
bindTaps();

/** The one line after the defaults migration: touch feedback only where it is real and on. */
export function defaultsNotice() {
  return hapticsAvailable() && hapticsOn() ? 'Coach voice and touch feedback are on' : 'Coach voice is on';
}

/**
 * A short tap. `kind` is 'tick' for a checkbox and 'phase' for a step change,
 * which is a little longer where the platform lets us say so.
 */
export function haptic(kind = 'tick') {
  if (!hapticsOn() || tapFelt()) return;
  buzz(kind);
}

/** The buzz itself, with no switch check, for callers that checked already. */
export function buzz(kind = 'tick') {
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(kind === 'end' ? 40 : kind === 'phase' ? 18 : 8);
      return;
    }
    const el = switchEl();
    if (!el) return;
    el.checked = !el.checked;
    // The switch trick gives one tap of a fixed strength, so a bigger moment is
    // said with two taps close together rather than a stronger one.
    if (kind === 'end') setTimeout(() => { try { el.checked = !el.checked; } catch { /* ignore */ } }, 90);
  } catch { /* never let feedback break the thing it was reporting */ }
}

// ------------------------------------------------- felt countdown cues ----
//
// His ask, 2026-09-15, after starting an exercise on Silent and hearing nothing:
// "Can we have it so that my phone vibrates for those countdown tones and
// moments that there would normally be sounds?"
//
// It cannot be conditional on Silent, because no web API reports that switch,
// so these fire at the same moments as the tones whenever he has chosen 'buzz'.
// On Silent they ARE the countdown; off Silent they sit under a sound he can
// also hear.
//
// Unlike the tones, which are scheduled on the audio clock and survive a busy
// page, these are ordinary timers. That is the honest limit: they need the page
// awake, which it is while he is watching a running workout.

let buzzTimers = [];

export function cancelBuzzes() {
  for (const t of buzzTimers) clearTimeout(t);
  buzzTimers = [];
}

/** Buzz at 3, 2 and 1 seconds to go, and once more, longer, at the end. */
export function scheduleBuzzes(remaining) {
  cancelBuzzes();
  if (!(remaining > 0)) return;
  for (const k of [3, 2, 1]) {
    const at = remaining - k;
    if (at > 0.05) buzzTimers.push(setTimeout(() => buzz('tick'), at * 1000));
  }
  buzzTimers.push(setTimeout(() => buzz('end'), remaining * 1000));
}

// -------------------------------------------------------- spoken cues -----
//
// "Switch sides", "Rest", "Last set". Speech is queued by the platform, so a
// backlog would arrive late and wrong: anything still pending is cancelled
// before a new line, and only the current one is ever said.

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

// The recorded voice (2026-09-23): the device's speech sounded robotic, so the
// app says its lines in a recorded voice (player/audio.js, app/audio/voice/).
// Old callers still pass words; these are the words that have a recording.
const LINE_FOR = {
  'Get ready': 'ready', 'Hold': 'hold', 'Rest': 'rest', 'Switch sides': 'switch', 'Work': 'go',
  'Sets complete': 'setsdone', 'Spoken cues are on': 'cueson',
  'Right, tap to start': 'right-tap', 'Left, tap to start': 'left-tap', 'Work, tap to start': 'tapstart',
};
// Variety for the lines said most, so a session does not repeat one clip forty times.
const TURNS = { go: ['go', 'go2', 'go3'], hold: ['hold', 'hold2'], rest: ['rest', 'rest2'] };
const turn = {};
function variant(key) {
  const list = TURNS[key];
  if (!list) return key;
  turn[key] = ((turn[key] ?? -1) + 1) % list.length;
  const pick = list[turn[key]];
  return hasVoice(pick) ? pick : key;
}

// Which line is current (B1-2): every sayLine and every hush() moves it on, so
// a line still waiting for its clip is dropped the moment anything newer is
// said, or the player stops.
let lineToken = 0;
// A line held for later whose clip was not there (sayLineAt): said as words at its time.
let fallbackTimer = null;

const asList = (keyOrKeys) => [].concat(keyOrKeys).filter(Boolean);
const asWords = (words) => (Array.isArray(words) ? words.filter(Boolean).join('. ') : words || '');

/**
 * Say a recorded line by its key (lines.json), falling back to the device's
 * speech with `words` when the recording is not loaded. Gated like every
 * spoken cue on his Spoken cues setting. An array of keys is a phrase, said
 * one clip after the other ("Left leg." then "Balance!"); a member with no
 * clip is skipped.
 *
 * The first line of a workout comes straight after the tap that unlocks the
 * sound, while the context is still resuming or the voice is still decoding.
 * Rather than say it in the robotic device voice (the first thing he heard),
 * it waits up to 1.2 s for its clip, and falls back to speech only if the clip
 * never comes and nothing newer has been said meanwhile.
 */
export function sayLine(keyOrKeys, words = '', { force = false } = {}) {
  const list = asList(keyOrKeys);
  if (!speakOn() || !list.length) return;
  const id = list.join('+');
  if (!force && id === lastSaid) return;
  const token = ++lineToken;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  const keys = list.map(variant);
  if (keys.some(hasVoice) && playVoice(keys)) { lastSaid = id; return; }
  if (audioPending()) {
    lastSaid = id;
    whenVoiceReady(keys[0], 1200).then((ok) => {
      if (token !== lineToken || !speakOn()) return;
      if (ok && playVoice(keys)) return;
      if (words) say(asWords(words), { force: true });
    });
    return;
  }
  if (words) say(asWords(words), { force });
}

/**
 * Say a line `delay` seconds from now on the audio clock (B1-4): a step's line
 * after a natural end follows the end tone instead of landing on it, and
 * "Exercise done!" follows the saved chime. A line, not a cue: a step change
 * does not cancel it, a newer line or hush() does, and so does a tap
 * (cancelPendingLine). Without its clip it is said as words at the same time.
 * `force: false` keeps sayLine's rule that the same line twice running is said
 * once (a tap's line held for the set's bell, B2-7).
 */
export function sayLineAt(keyOrKeys, words, delay = 0, { force = true } = {}) {
  const list = asList(keyOrKeys);
  if (!speakOn() || !list.length) return;
  if (!force && list.join('+') === lastSaid) return;
  const token = ++lineToken;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  const keys = list.map(variant);
  if (keys.some(hasVoice) && playVoiceAt(keys, delay)) { lastSaid = list.join('+'); return; }
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null;
    if (token === lineToken) sayLine(list, words, { force: true });
  }, Math.max(0, delay) * 1000);
}

/** A tap came first: drop the line still waiting to be said after the end tone. */
export function cancelPendingLine() {
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  cancelPendingVoice();
}

let lastSaid = '';
export function say(text, { force = false } = {}) {
  if (!speakOn() || !text) return;
  const line = LINE_FOR[text];
  if (line && line !== lastSaid) {
    const k = variant(line);
    if (hasVoice(k) && playVoice(k)) { lastSaid = line; return; }
  }
  if (!speechAvailable()) return;
  if (!force && text === lastSaid) return;
  lastSaid = text;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.volume = 1;
    window.speechSynthesis.speak(u);
  } catch { /* silence is the fallback, and the screen already says it */ }
}

/**
 * Stop anything queued: closing the player, pausing, leaving the page. With
 * keepCompletion a completion line still sounding plays out ("Exercise done!"
 * as the tendon loading goes straight back to Today).
 */
export function hush({ keepCompletion = false } = {}) {
  lineToken++;
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  stopVoice({ keepCompletion });
  try { if (speechAvailable()) window.speechSynthesis.cancel(); } catch { /* ignore */ }
  lastSaid = '';
}
