// Reminders: subscribing this device, and clearing what is showing.
//
// What this is FOR, and what it is not. It covers the things that are not
// second critical: the tendon loading an hour after his collagen, the
// six hour line after the first session, and a twice a day medicine. It is NOT
// the rest timer. That was settled on 2026-09-15 by measurement: a rest ending
// while he is in another app cannot be a sound (the only session type that
// survives backgrounding is the one that stops his music, and his rule is that
// this app never stops his music), and web push is not an exact alarm, so
// nothing here pretends to cover a sixty second rest.
//
// His three rules for them, in his words:
//   "I don't want a whole bunch of reminders backlogged for every single time I
//    do anything related to this app."
//   "I want to make sure that those notifications go away if I tap on them or
//    go back into the app."
//   "It would also be nice if I could tap on the notification and it would open
//    up the web app."
//
// The first is handled by tagging (sw.js), the second here and in sw.js, the
// third in sw.js.
//
// The sender is this Mac, not a cloud service (his choice, 2026-09-15: "we can
// do the Mac one first... eventually I'm going to switch it over to the cloud
// one"). Nothing here knows or cares which: the device publishes where it can
// be reached, through the same private repo everything else syncs through, and
// whatever sends reads it from there.

import { state, update, DEVICE_ID } from './store.js';

// Public half of the VAPID pair. A public key is not a credential; the private
// half lives only on the Mac, in tools/push/vapid.local.json, gitignored.
export const VAPID_PUBLIC = 'BK9uqLOtYif6YqrZM75euLIqv3LQ5IYPp-1kT064hnXGLODCsnyx_CzaT3OM3JzApKCcE3p39gkDeVyc3ojO6EI';

const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const bytesToB64 = (buf) => {
  const b = String.fromCharCode(...new Uint8Array(buf));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function pushSupported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

/** Installed as a Home Screen app? iOS only allows push there. */
export function installed() {
  return window.navigator.standalone === true
    || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
}

export function remindersOn() {
  return !!(state.data.pushSubs && state.data.pushSubs[DEVICE_ID]);
}

/**
 * Subscribe this device and publish where it can be reached. Returns
 * { ok } or { ok: false, why } with something true to show him.
 */
export async function enableReminders() {
  if (!pushSupported()) return { ok: false, why: 'This browser cannot receive reminders.' };
  if (!installed()) {
    return { ok: false, why: 'iOS only allows reminders in the installed app. Add it to your Home Screen, open it from there, and try again.' };
  }
  let perm;
  try { perm = await Notification.requestPermission(); }
  catch { return { ok: false, why: 'The permission request did not appear. Try again from the Home Screen app.' }; }
  if (perm !== 'granted') return { ok: false, why: 'Notifications are turned off for this app. Settings, Notifications, then allow them.' };

  const reg = await navigator.serviceWorker.ready;
  let sub;
  try {
    sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
  } catch (err) {
    return { ok: false, why: `This device would not subscribe: ${err && err.message ? err.message : err}` };
  }

  const p256dh = sub.getKey && sub.getKey('p256dh');
  const auth = sub.getKey && sub.getKey('auth');
  if (!p256dh || !auth) return { ok: false, why: 'The subscription came back without its keys, so nothing could be sent to it.' };

  update(() => {
    state.data.pushSubs = { ...(state.data.pushSubs || {}) };
    state.data.pushSubs[DEVICE_ID] = {
      endpoint: sub.endpoint,
      p256dh: bytesToB64(p256dh),
      auth: bytesToB64(auth),
      // So a sender can tell a stale row from a live one without guessing.
      at: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 120),
    };
  });
  return { ok: true };
}

/** Stop reminders for THIS device only; the others keep theirs. */
export async function disableReminders() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* the record going is what stops them being sent */ }
  update(() => {
    if (!state.data.pushSubs) return;
    state.data.pushSubs = { ...state.data.pushSubs };
    delete state.data.pushSubs[DEVICE_ID];
  });
}

/**
 * He is looking at the app, so nothing is waiting for him. Called on every
 * open and every return to the foreground.
 */
export function clearShowing() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => {
    try { reg.active?.postMessage({ kind: 'clear-reminders' }); } catch { /* fine */ }
  }).catch(() => { /* no worker, nothing showing */ });
}

export function watchForeground() {
  if (typeof document === 'undefined') return;
  clearShowing();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clearShowing();
  });
}
