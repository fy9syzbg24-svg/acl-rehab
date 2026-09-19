// Touch feedback and spoken cues (items 5 and 7, 2026-09-15).
//
// Both are OFF by default and both are per device, like every other sound
// choice: what he wants on the phone in a gym is not what he wants on the Mac.
// Neither is ever required. If a device cannot do one, the switch says so and
// the workout is unchanged, because the countdown, the ring and the labels
// already carry every step.

const HAPTIC_KEY = 'rehab.feedback.haptics';
const SPEAK_KEY = 'rehab.feedback.speak';

const read = (k) => { try { return localStorage.getItem(k) === 'on'; } catch { return false; } };
const write = (k, on) => { try { localStorage.setItem(k, on ? 'on' : 'off'); } catch { /* per device */ } };

export const hapticsOn = () => read(HAPTIC_KEY);
export const speakOn = () => read(SPEAK_KEY);
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

/** True where some form of touch feedback exists at all. */
export function hapticsAvailable() {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.vibrate === 'function') return true;
  try { return 'switch' in document.createElement('input'); } catch { return false; }
}

/**
 * A short tap. `kind` is 'tick' for a checkbox and 'phase' for a step change,
 * which is a little longer where the platform lets us say so.
 */
export function haptic(kind = 'tick') {
  if (!hapticsOn()) return;
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

let lastSaid = '';
export function say(text, { force = false } = {}) {
  if (!speakOn() || !text || !speechAvailable()) return;
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

/** Stop anything queued: closing the player, pausing, leaving the page. */
export function hush() {
  try { if (speechAvailable()) window.speechSynthesis.cancel(); } catch { /* ignore */ }
  lastSaid = '';
}
