// The Home Screen icon badge (item 3, 2026-09-15).
//
// His ask: a count of what is due, with control over what it counts, and the
// option to turn it off. Off by default.
//
// Two things to know about it on iOS. The Badging API only works for an
// installed Home Screen app, and it needs notification permission before it
// will show anything, which is why turning it on asks. Nothing else in the app
// depends on it: if permission is refused or the API is missing, the switch
// says so and everything else carries on.

const ON_KEY = 'rehab.badge.on';
const WHAT_KEY = 'rehab.badge.what';

/** What it may count. His to choose, any combination. */
export const BADGE_PARTS = [
  ['exercises', "Today's exercises still to do"],
  ['supplements', 'Supplements still to take'],
];

const readOn = () => { try { return localStorage.getItem(ON_KEY) === 'on'; } catch { return false; } };

export const badgeOn = () => readOn();
export function badgeParts() {
  try {
    const raw = localStorage.getItem(WHAT_KEY);
    if (!raw) return ['exercises', 'supplements'];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : ['exercises', 'supplements'];
  } catch { return ['exercises', 'supplements']; }
}
export function setBadgeParts(list) {
  try { localStorage.setItem(WHAT_KEY, JSON.stringify(list)); } catch { /* per device */ }
}

export function badgeAvailable() {
  return typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function';
}

/** Turn it on, asking for the permission iOS requires first. Returns why not. */
export async function enableBadge() {
  if (!badgeAvailable()) return { ok: false, why: 'This device does not support the icon badge.' };
  try {
    if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') return { ok: false, why: 'iOS only shows a badge once notifications are allowed for the installed app.' };
    }
  } catch {
    return { ok: false, why: 'This device would not show the permission request. Open the app from the Home Screen and try again.' };
  }
  try { localStorage.setItem(ON_KEY, 'on'); } catch { /* per device */ }
  return { ok: true };
}

export function disableBadge() {
  try { localStorage.setItem(ON_KEY, 'off'); } catch { /* per device */ }
  try { navigator.clearAppBadge?.(); } catch { /* ignore */ }
}

/**
 * Paint the count. `counts` is { exercises, supplements }, whatever the caller
 * already worked out for the screen, so this never recomputes his day and can
 * never disagree with what Today shows.
 */
export function paintBadge(counts) {
  if (!badgeAvailable()) return;
  try {
    if (!badgeOn()) { navigator.clearAppBadge?.(); return; }
    const want = badgeParts();
    const n = want.reduce((sum, k) => sum + (Number(counts?.[k]) || 0), 0);
    if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge?.();
  } catch { /* a badge is never worth an error */ }
}
