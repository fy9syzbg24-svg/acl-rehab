// What he wants reminding about, and when he does not want to be disturbed.
//
// His ask, 2026-09-15: "allow me to toggle on and off specific notification
// situations on whether or not I want to use them. So I have flexibility within
// the app."
//
// These live in the SYNCED document rather than on one device, because the
// thing that reads them is the sender on his Mac, not the phone showing the
// switch. `settings` is already a synced map where each key is one record, so
// `settings.remind` is one record holding the lot: turning a kind off on the
// phone reaches the sender the same way every other change does.
//
// Everything defaults to ON except quiet hours, which are off until he sets
// them. A kind that does not exist yet is treated as on, so adding one later
// does not silently arrive switched off.

import { state, update } from './store.js';

// id, label, hint, and for the ones that happen at a time he chooses rather than
// a time his own logging decides: the key that holds it and its default.
export const KINDS = [
  ['tendon', 'Tendon loading is due', 'Thirty minutes after you mark your collagen.'],
  ['six', 'The six hour line', 'Six hours after you log the first session.'],
  ['dose', 'A twice a day dose', 'When the next one is due, twelve hours after the last.'],
  ['idle', 'Nothing logged yet', 'One nudge if the day is still empty.', 'idleAt', '17:00'],
  ['clinic', 'Clinic day', 'On the morning of a clinic day.', 'clinicAt', '08:00'],
  ['supps', 'Supplements still to take', 'Counted, never named.', 'suppsAt', '20:00'],
];

export function remindPrefs() {
  const r = (state.data.settings && state.data.settings.remind) || {};
  const out = {
    quietOn: !!r.quietOn,
    quietFrom: r.quietFrom || '22:00',
    quietTo: r.quietTo || '07:00',
  };
  // Every kind defaults to on, and every time to its own default, so a kind
  // added later can never arrive silently switched off or at midnight.
  for (const [id, , , timeKey, timeDefault] of KINDS) {
    out[id] = r[id] !== false;
    if (timeKey) out[timeKey] = r[timeKey] || timeDefault;
  }
  return out;
}

export function setRemind(patch) {
  update(() => {
    const s = state.data.settings;
    s.remind = { ...remindPrefs(), ...patch };
  });
}

/**
 * Is `hhmm` inside his quiet hours? Written so a window that crosses midnight
 * (22:00 to 07:00, which is the normal case) works without special casing at
 * the call site.
 */
export function inQuietHours(prefs, hhmm) {
  if (!prefs.quietOn) return false;
  const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  const from = mins(prefs.quietFrom), to = mins(prefs.quietTo), now = mins(hhmm);
  return from <= to ? (now >= from && now < to) : (now >= from || now < to);
}
