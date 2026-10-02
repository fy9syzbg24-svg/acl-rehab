// Rehab Test (2026-09-30): one door from the page to the native app. Every call is safe
// without the app (a browser, a test page): it resolves to null and the page carries on
// with its own web behaviour. The contract is design-pass/v3/CONTRACT.md; the Swift side is
// ios/RehabTest/Bridge.swift. Never call window.rehabNative directly from a view.

export const isNative = () => typeof window !== 'undefined' && !!window.rehabNative;

export async function call(name, args = {}) {
  if (!isNative()) return null;
  try { return await window.rehabNative.call(name, args); } catch (err) {
    // An older native build that does not know the call yet: behave as if there were no app.
    if (typeof console !== 'undefined') console.warn('[native]', name, String(err));
    return null;
  }
}

/** The element's box in viewport points, for anchoring native menus and celebrations. */
export function rectOf(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

// Live Activities (Lock Screen and Dynamic Island). design-pass/v3/CONTRACT.md.
export const liveAvailable = () => call('live.available');
export const liveStart = (spec) => call('live.start', spec);
export const liveUpdate = (id, state) => call('live.update', { id, state });
export const liveEnd = (id, state, dismissAfterSec) => call('live.end', { id, state, dismissAfterSec });
export const livePlan = (id, steps, fromWallMs) => call('live.plan', { id, steps, fromWallMs });
export const livePending = () => call('live.pending');
export const liveAck = (upTo) => call('live.ack', { upTo });
export const routineStart = (spec) => call('routine.start', spec);
export const routineCancel = (id) => call('routine.cancel', { id });

// Local notifications (same id replaces).
export const notifyPermission = (provisional = true) => call('notify.permission', { provisional });
export const notifySchedule = (n) => call('notify.schedule', n);
export const notifyCancel = (ids, delivered = false) => call('notify.cancel', { ids, delivered });

// A native action sheet springing from an element. Resolves to the chosen id or null.
export const actions = (spec, anchorEl) => call('actions.show', { ...spec, rect: rectOf(anchorEl) });

// A native celebration (particles, starburst, Core Haptics) placed over an element.
// When the app played an exercise or day finish (its own haptic score), the time is kept
// on window.__rtCelAt so the overlay's success tap stays out: one haptic per moment (N7).
export const celebrate = (kind, el, accent) => call('cel.play', { kind, rect: rectOf(el), accent }).then((ok) => {
  if (ok === true && (kind === 'exercise' || kind === 'day')) window.__rtCelAt = Date.now();
  return ok;
});

// Native sheets: each resolves to what he entered, or null if he closed it. The PAGE writes.
export const sheet = (kind, spec) => call(`sheet.${kind}`, spec);

// A native Swift Charts screen with data the page computed. Nothing is written.
export const chart = (spec) => call('chart.show', spec);

// Haptics in Apple's vocabulary.
export const haptic = (kind) => call('haptic.play', { kind });
export const hapticScore = (events) => call('haptic.score', { events });

// Swift -> page hooks (CONTRACT.md). Defined once, here, so every module can listen:
//   window 'rt-wake'   the app became active: drain live.pending, refresh routines.
//   window 'rt-open'   { detail: route } a tap on a Live Activity, widget or notification.
//   window 'rt-live'   { detail: { cmd, wallMs } } a Live Activity button (Pause or Next).
// A tab route ('today', 'supplements', 'meds', 'plan', 'progress', 'recovery', 'settings')
// is opened here; 'player' is left to the player module (it listens for rt-open).
if (typeof window !== 'undefined' && !window.__rtHooks) {
  window.__rtHooks = true;
  window.__rehabWake = () => window.dispatchEvent(new Event('rt-wake'));
  window.__rehabOpen = (route) => {
    const r = String(route || '');
    window.dispatchEvent(new CustomEvent('rt-open', { detail: r }));
    const tab = document.querySelector(`#mtabs button[data-view="${r.replace(/[^a-z]/g, '')}"]`);
    if (tab && r !== 'player') tab.click();
  };
  window.__rehabLive = (cmd, wallMs) => window.dispatchEvent(new CustomEvent('rt-live', { detail: { cmd, wallMs } }));
}

// Test app switches (per device, Settings > Rehab Test): off until he says (CONTRACT.md).
export const pref = (key) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
export const PREF_ROUTINE_REMINDERS = 'rt.notify.routines';   // tendon loading, shot day reminders from this app
export const PREF_REST_END = 'rt.notify.restEnd';             // rest end alert while in another app
export const PREF_LIVE = 'rt.live.off';                       // '1' turns Live Activities off (default on)

// Round 3 (2026-09-30) additions, CONTRACT.md "Round 3".
// Audio session: 'songs' lets his own 120 bpm songs interrupt Spotify; 'mix' plays cues over
// his music and hands the audio back (Spotify resumes). Background audio keeps cues going.
export const audioSession = (mode) => call('audio.session', { mode });
// Widgets: the page sends a small snapshot; the widget extension draws it.
export const widgetsSnapshot = (snap) => call('widgets.snapshot', snap);
if (typeof window !== 'undefined' && !window.__rehabWidget) {
  // A widget or Control button ran: 'supps.group' { group }, 'supps.morning', 'workout.start', 'weight.log'.
  window.__rehabWidget = (cmd, args) => window.dispatchEvent(new CustomEvent('rt-widget', { detail: { cmd, args: args || {} } }));
}
