// Rehab Test v3 (2026-09-30): the routine hour, collagen to tendon loading.
//
// His rule: the tendon loading is always one gap after the collagen (an hour since
// 2026-09-20, COLLAGEN_GAP_MIN in logging.js, one number for the whole app). Once the
// collagen is ticked and today's tendon loading is not, the hour is a routine:
//   - Today draws it as a live countdown line on the tendon loading row (tendonDue).
//   - The native app shows it as a quiet Live Activity (routine.start), ended the moment
//     the tendon loading is done or the collagen tick goes away (routine.cancel).
//   - A local notification at the end of the hour ONLY when Settings has switched this
//     app's own reminders on (localStorage 'rt.notify.routines' = '1'): his web app's push
//     already sends the tendon reminder, so a second one stays off until he says (CONTRACT,
//     ruling K14). Never inside his quiet hours, 01:00 to 09:00.
// Nothing here writes his record. Nothing on the Lock Screen names a supplement or a medicine.
// Imported by views/today.js, so it runs from startup; every native call resolves to null
// without the app, and the page keeps working the same.

import { state, subscribe } from './store.js';
import { todayIso, toIso, currentDayIso } from './util.js';
import { COLLAGEN_GAP_MIN, itemStatus } from './logging.js';
import { FIRST_ITEMS, anchorFirst } from './firstup.js';
import { plannedOn } from '../data/program.js';
import * as N from './native-bridge.js';

const ROUTINE_ID = 'tendon';
const NOTE_ID = 'rt.routine.tendon';
// The countdown stays up this long after the hour is over, then leaves on its own:
// a collagen ticked in the morning must not keep a Live Activity alive all day.
const LINGER_MS = 3 * 3600e3;
const QUIET_FROM = 1;   // 01:00
const QUIET_TO = 9;     // 09:00

const collagenOf = (doc) => (doc?.supplements || []).find((s) => /collagen/i.test(s?.name || '')) || null;

/**
 * The routine for `iso`, or null: { collagenAt, dueAt, item } where item is the tendon
 * loading the hour leads to (the first one planned). Null once a tendon loading is done,
 * when none is planned, when the collagen is not ticked, and on any day but today.
 */
const tendonDoneOn = (doc, day) => {
  if (anchorFirst(doc, day)) return true;
  const rows = doc?.days?.[day]?.entries || [];
  return FIRST_ITEMS.some((p) => plannedOn(doc, p.id, day) && itemStatus(p, rows).state === 'done');
};

export function tendonDue(doc = state.data, iso = todayIso(), now = Date.now()) {
  if (iso !== toIso(new Date(now))) return null;
  const planned = FIRST_ITEMS.filter((p) => plannedOn(doc, p.id, iso));
  if (!planned.length) return null;
  if (tendonDoneOn(doc, iso)) return null;
  const c = collagenOf(doc);
  if (!c) return null;
  // The collagen's own supplement day, which runs to 5 am (supplements.js does the same).
  const sIso = currentDayIso(new Date(now));
  const v = doc?.days?.[sIso]?.supps?.[c.id];
  const at = typeof v === 'string' ? new Date(v) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const dueAt = new Date(at.getTime() + COLLAGEN_GAP_MIN * 60000);
  // Between midnight and 5 am the collagen still belongs to yesterday's supplement day,
  // while Today already shows the new calendar day (audit T18, B1). That collagen's hour
  // only carries over when its tendon loading was not done yesterday AND the hour is not
  // long over; otherwise the new day starts clean (no row line, no Live Activity).
  if (sIso !== iso) {
    if (tendonDoneOn(doc, sIso)) return null;
    if (now >= dueAt.getTime() + LINGER_MS) return null;
  }
  return { collagenAt: at, dueAt, item: planned[0], gapMin: COLLAGEN_GAP_MIN };
}

const inQuiet = (ms) => { const h = new Date(ms).getHours(); return h >= QUIET_FROM && h < QUIET_TO; };

// What this device last asked the app for, so a save that changes nothing sends nothing.
let sent = { live: 0, note: 0 };
let cleaned = false;
let timer = 0;

export async function refreshRoutines() {
  clearTimeout(timer);
  timer = 0;
  const due = tendonDue();
  const now = Date.now();
  const end = due ? due.dueAt.getTime() : 0;
  const active = !!due && now < end + LINGER_MS;

  // The Live Activity (silent), unless Settings turned Live Activities off.
  const liveOk = !N.pref(N.PREF_LIVE);
  if (active && liveOk) {
    if (sent.live !== end) {
      sent.live = end;
      await N.routineStart({ id: ROUTINE_ID, title: 'Tendon loading', endsAtMs: end });
    }
  } else if (sent.live || !cleaned) {
    // Once at startup too: an activity left from a session that ended before the tick.
    sent.live = 0;
    await N.routineCancel(ROUTINE_ID);
  }

  // The optional reminder, off by default (CONTRACT: the web push already sends it).
  const want = active && N.pref(N.PREF_ROUTINE_REMINDERS) && end > now + 5000 && !inQuiet(end);
  if (want) {
    if (sent.note !== end) {
      sent.note = end;
      await N.notifySchedule({ id: NOTE_ID, title: 'Tendon loading', body: 'Your hour is up.', atMs: end, sound: true });
    }
  } else if (sent.note || !cleaned) {
    sent.note = 0;
    await N.notifyCancel([NOTE_ID]);
  }
  cleaned = true;

  // Wake once when the linger runs out, so the activity leaves without a save.
  if (active) timer = setTimeout(refreshRoutines, Math.max(1000, end + LINGER_MS - now + 500));
}

let queued = 0;
function soon() {
  if (queued) return;
  queued = setTimeout(() => { queued = 0; refreshRoutines().catch(() => {}); }, 250);
}

if (typeof window !== 'undefined' && !window.__rtRoutines) {
  window.__rtRoutines = true;
  subscribe(soon);
  window.addEventListener('rt-wake', soon);
  // A Settings switch (Live Activities, this app's reminders) takes effect at once:
  // switching one off cancels what it already started (audit N1).
  window.addEventListener('rt-prefs', soon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(); });
  soon();
}
