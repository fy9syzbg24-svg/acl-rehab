// Rehab Test round 3 (2026-09-30): the page's half of the Home and Lock Screen widgets.
// CONTRACT.md "Round 3 additions"; his yes, 2026-09-30: "also build home screen widgets for
// workout or logging sups".
//
// 1. The snapshot. On startup and after every save (and when a Settings choice or the device
//    store changes, or the app comes back) the page sends widgets.snapshot with what the
//    widgets draw: today's workout (done, total, left, minutes, the day's name, Begin or
//    Resume), the supplement bands (taken of total), the Morning set, the tendon loading
//    hour. Supplement NAMES go only when Settings > "Show names on widgets" is on
//    ('rt.widgetNames' = '1', off by default); the Lock Screen versions never show a name.
//    No medicine dose, level or weight is ever in it. Nothing leaves the device.
// 2. The buttons. A widget or Control tap arrives as window 'rt-widget' { cmd, args }
//    (native-bridge.js; queued natively while the app is not running, replayed on wake):
//      'supps.group'   { group, atMs? }  Mark all taken for that band, through the page's own
//                      save path, at the TAP's own moment. The day is the supplement day of
//                      that moment (5 am rule). No moment given: now. Never a made up time.
//      'supps.morning' { atMs? }        the Morning set at that moment.
//      'weight.log'                      opens the weight logging (the Log button's own path).
//    'workout.start' is owned by mobile.js (window.__rtWidgetCmds): the player opens on the Next exercise, ready screen waiting.

import { state, subscribe, getDay } from './store.js';
import { todayIso, currentDayIso } from './util.js';
import { dayRingItems, dayCounts } from './dayring.js';
import { itemStatus } from './logging.js';
import { minutesFor } from './timing.js';
import { exerciseById, pictureFor } from './components.js';
import { dayPlanFor } from '../data/program.js';
import { suppBands, morningSetFor, markBand, takeMorningSet, listFor } from './views/supplements.js';
import { tendonDue } from './routines.js';
import { draftInfo } from './player/player.js';
import { widgetsSnapshot } from './native-bridge.js';
import { widgetNames } from './rtprefs.js';
import { local } from './rtlocal.js';

const ticksOnDay = (iso) => getDay(iso)?.supps || {};

/** What the widgets draw, from the record as it stands. */
export function widgetSnapshot() {
  const doc = state.data;
  const iso = todayIso();
  // The same day count as Today's ring, the player and the Live Activity (dayring.js dayCounts, PS-14): done and
  // total include what he logged beyond the plan; left and the minutes are the planned exercises still to do.
  const { planned, entries } = dayRingItems(doc, iso);
  const counts = dayCounts(doc, iso);
  const done = planned.filter((p) => itemStatus(p, entries).state === 'done');
  const leftItems = counts.plannedLeft;
  const mins = leftItems.reduce((n, p) => n + (minutesFor(p, exerciseById(p.ex), doc).mins || 0), 0);
  const plan = dayPlanFor(doc, iso);
  let dr = null;
  try { dr = draftInfo(); } catch { dr = null; }
  const sIso = currentDayIso();
  const groups = suppBands(sIso);
  const mset = morningSetFor(sIso).ids;
  const showNames = widgetNames();
  const snap = {
    today: {
      done: counts.done, total: counts.total, left: counts.left, mins,
      label: plan.clinic ? 'Clinic day' : (plan.name || ''),
      startLabel: dr && dr.phase !== 'done' ? 'Resume' : 'Begin',
    },
    // morningLeft: the set's items not yet taken today, so the native overlay adds exact counts for a waiting
    // Morning press (round 3 leftovers, NW-02). groups[].ids: each band's items (NW-08).
    supps: { groups, morningSet: mset, morningLeft: mset.filter((id) => !ticksOnDay(sIso)[id]), showNames, ...currentBand(groups) },
    tendon: { dueAtMs: tendonDue()?.dueAt?.getTime() || null },
    // Round 3 consistency (2026-09-30): the two optional fields the native widgets already draw
    // (r3-native-notes "For the other builders"). dayIso is the checklist day, so after the 5 am
    // rollover a widget says "Open Rehab Test" instead of passing yesterday's numbers off as
    // today's; items lets the medium Workout widget show the next exercise with its picture and
    // full title (the picture beats the name, M1). Frame names follow player.js frameAssetOf.
    dayIso: sIso,
  };
  snap.today.items = planned.slice(0, 8).map((p) => {
    const src = p.img || pictureFor(p.ex)?.img || '';
    const m = /([^/]+)\.(png|jpe?g|webp)$/i.exec(src);
    const item = { title: p.title || exerciseById(p.ex)?.name || String(p.ex || ''), done: done.includes(p) };
    if (m) item.frameAsset = `frame-${m[1]}`;
    if (p.side === 'L' || p.side === 'R') item.leg = p.side;
    return item;
  }).filter((x) => x.title);
  if (showNames) {
    const ids = new Set(mset);
    // Names only for what the Home Screen widget can show: the bands' items and the set.
    for (const s of listFor(sIso)) ids.add(s.id);
    snap.supps.names = Object.fromEntries([...ids].map((id) => [id, (doc.supplements || []).find((s) => s.id === id)?.name]).filter(([, n]) => n));
  }
  return snap;
}

/**
 * The band for this part of the day, for the Supplements widget's one button (r3-native
 * "supps.current"). Round 3 consistency (2026-09-30): without it the widget offered "Morning,
 * Mark all taken" at 3 am. Evening from 5 pm until the 5 am rollover (the checklist day's own
 * line), Morning from 5 am to noon; in between the widget keeps its own rule (first unfinished).
 */
function currentBand(groups, now = new Date()) {
  const h = now.getHours();
  const want = h >= 17 || h < 5 ? 'evening' : h < 12 ? 'morning' : null;
  return want && groups.some((g) => g.id === want) ? { current: want } : {};
}

let last = '';
let timer = 0;
function send() {
  timer = 0;
  if (!state.data || !state.data.days) return;
  let snap;
  try { snap = widgetSnapshot(); } catch (err) {
    try { (window.__rtErrors ||= []).push(`[widgets] ${String(err.message || err)}`); } catch { /* ignore */ }
    return;
  }
  const json = JSON.stringify(snap);
  if (json === last) return;
  last = json;
  widgetsSnapshot(snap);
}
export function sendSoon(ms = 400) {
  clearTimeout(timer);
  timer = setTimeout(send, ms);
}

function atOf(args) {
  const ms = Number(args?.atMs ?? args?.wallMs ?? args?.at);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : new Date();
}

if (typeof window !== 'undefined' && !window.__rtWidgets) {
  window.__rtWidgets = true;
  subscribe(() => sendSoon());
  local.subscribe(() => sendSoon());
  window.addEventListener('rt-prefs', () => { last = ''; sendSoon(); });
  window.addEventListener('rt-wake', () => { last = ''; sendSoon(100); });
  // The supplement day turns at 5 am and the tendon hour runs out on its own: a slow check.
  setInterval(() => sendSoon(0), 5 * 60000);
  window.addEventListener('rt-widget', (e) => {
    const { cmd, args } = e.detail || {};
    if (cmd === 'supps.group' && args?.group) {
      const at = atOf(args);
      markBand(currentDayIso(at), String(args.group), at);
    } else if (cmd === 'supps.morning') {
      const at = atOf(args);
      takeMorningSet(currentDayIso(at), at);
    } else if (cmd === 'weight.log') {
      window.__rehabLog?.('weight');
    }
  });
}
