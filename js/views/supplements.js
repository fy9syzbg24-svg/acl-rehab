// Supplements and as-needed medication.
//
// Two separate things live here:
//
//   supplements[]   a daily checklist, take it or you don't
//   prnMeds[] + doses[]   as-needed drugs where the QUESTION is "when may I
//                         take another?", so each dose is timestamped
//
// THE HISTORY RULE
// Adding or removing a supplement must never rewrite the past. So membership
// is not a boolean, it is a list of date SPANS: {from, until}. A supplement
// shows on date D if any span covers D. Deleting closes the open span at
// today; re-adding opens a new one. Yesterday keeps whatever was true
// yesterday, which is the whole point of keeping a log.
//
// SEEDED IDS ARE DETERMINISTIC
// The first version used uid() for the seeded list. The Mac seeded ten rows
// and the phone seeded ten more with different ids, and sync, correctly,
// kept all twenty. Anything seeded independently on multiple devices must
// derive its id from its content so every device produces the same record.

import { parse, morph } from '../morph.js';
import { growIn, foldAway, insertBody, patchHead } from '../fold.js';
import { esc, todayIso, currentDayIso, uid, fmtDate, onTimePicked, addDays, DAY_ROLLOVER_HOUR } from '../util.js';
import { onSwipe } from '../swipe.js';
import { state, update, ensureDay, getDay } from '../store.js';
import { openModal, closeModal, actionToast } from '../components.js';
import { menu } from '../menu.js';
import { call, rectOf, haptic as nHaptic } from '../native-bridge.js';
// sfx('tick'): the sound map's row for a supplement ticked (his tap; silent in Classic)
import { hapTaps, sfx } from '../feedback.js';
import { local } from '../rtlocal.js';
import { spark, still } from '../rtfx.js';

export const WHENS = [['morning', 'Morning'], ['anytime', 'Anytime'], ['evening', 'Evening']];

// THE RULE: whatever he has arranged in the app IS the default. His list lives
// in his synced data, never in this public code (2026-09-15, audit A28: the
// seed list here used to name his own medications). A fresh device starts
// empty and receives the real list by sync; `settings.suppsSeeded` means this
// never runs twice, so an update can never reorder, regroup or re-add anything
// he has curated.
const DEFAULTS = [];

// Common as-needed drugs, offered in the add sheet and seeded once.
export const PRN_PRESETS = [
  ['Naproxen', '200mg', 12],
  ['Tylenol', '1000mg', 6],
  ['Ibuprofen', '600mg', 6],
  ['Aspirin', '81mg', 12],
];
// Nothing is seeded any more (Codex audit K01): three of these with doses was a
// real person's as-needed list, in public code. A fresh device starts empty and
// receives the real list by sync, exactly like the supplement list (DEFAULTS).
const PRN_SEED = [];

export function seedPrnMeds(d) {
  if (d.settings?.prnSeeded) return false;
  if ((d.prnMeds || []).length) { (d.settings ||= {}).prnSeeded = true; return false; }
  d.prnMeds = d.prnMeds || [];
  const have = new Set(d.prnMeds.map((m) => m.id));
  let added = 0;
  PRN_PRESETS.filter(([n]) => PRN_SEED.includes(n)).forEach(([name, dose, waitHours], i) => {
    const id = 'prn_' + suppId(name).slice(4);
    if (have.has(id)) return;
    d.prnMeds.push({ id, name, dose, waitHours, order: i, spans: [{ from: '1970-01-01', until: null }] });
    added++;
  });
  (d.settings ||= {}).prnSeeded = true;
  return added > 0;
}

/** Stable id from a name, the same on every device, so seeding cannot duplicate. */
export function suppId(name) {
  return 'sup_' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function seedSupplements(d) {
  if (d.settings?.suppsSeeded) return false;      // he may legitimately empty the list
  // Belt and braces: a list that already exists is his, flag or no flag.
  if ((d.supplements || []).length) { (d.settings ||= {}).suppsSeeded = true; return false; }
  d.supplements = d.supplements || [];
  const have = new Set(d.supplements.map((s) => s.id));
  let added = 0;
  DEFAULTS.forEach(([name, when], i) => {
    const id = suppId(name);
    if (have.has(id)) return;
    d.supplements.push({ id, name, when, order: i, spans: [{ from: '1970-01-01', until: null }] });
    added++;
  });
  (d.settings ||= {}).suppsSeeded = true;
  return added > 0;
}

// The old dedupeSupplements() has been REMOVED on purpose. It collapsed rows by
// name, which is now wrong: the same supplement may legitimately appear twice
// (a morning dose and an evening one). The duplicate seeding it existed to
// repair was fixed at the source, seeded ids are deterministic, and the
// shared copy carries tombstones for the old random ids, so any stale device
// converges by pulling those rather than by re-deriving the fix locally.

// A pre-spans row: `active:false` meant removed, otherwise always present.
function normSpans(s) {
  if (Array.isArray(s.spans) && s.spans.length) return s.spans;
  return s.active === false ? [] : [{ from: '1970-01-01', until: null }];
}
function mergeSpans(spans) {
  const open = spans.some((x) => !x.until);
  const from = spans.map((x) => x.from).sort()[0] || '1970-01-01';
  return open ? [{ from, until: null }] : spans;
}

/** Was this item on the list on that date? */
export function activeOn(item, iso) {
  return normSpans(item).some((s) => s.from <= iso && (!s.until || iso < s.until));
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)
  // Records are merged independently, so two devices can land on the same
  // order number. Breaking the tie on id keeps every device showing the same
  // sequence instead of each picking its own.
  || String(a.id).localeCompare(String(b.id));

export function listFor(iso) {
  return (state.data.supplements || [])
    .filter((s) => activeOn(s, iso))
    .sort(byOrder);
}

const ticksOn = (iso) => (getDay(iso)?.supps) || {};

// A tick is `true` (before 2026-09-14, no time known) or the ISO moment it was
// taken. Both are truthy, so every older reader still works. A time is never
// invented for an old tick; he can set one.
export function suppTime(value) {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
// Today registers what else a supplement's time sets: his collagen and the
// tendon loading are one gap apart, always (his rule, 2026-09-14; an hour since 2026-09-20). A
// hook, because today.js already imports this file.
let suppTimeHook = null;
export function onSuppTime(fn) { suppTimeHook = fn; }

const hhmm24 = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const time12 = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * One medicine taken as two doses a set number of hours apart (his ask,
 * 2026-09-15: "one in the evening and one in the morning, separated by 12
 * hours", whichever comes first). Its rows share a name and carry `gapHours`.
 * Once a dose is ticked, the other row suggests the time for the next one:
 * the latest dose logged today or the day before, plus the gap, shown on the
 * row whose supplement day that time falls in. Only ticks with a real time
 * count; a suggestion, never a rule.
 */
const doseKey = (s) => (Number(s.gapHours) > 0 ? String(s.name).trim().toLowerCase() : null);

/**
 * The moment a time on a supplement day means (Codex audit B06). The day runs
 * to 5am, so 1:00 AM on the 15th's list is 1:00 AM on the 16th. Built from the
 * calendar date and the clock, so a daylight saving change lands on the right
 * wall time.
 */
export function suppDoseDate(iso, h, m) {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(y, mo - 1, d + (h < DAY_ROLLOVER_HOUR ? 1 : 0), h, m, 0, 0);
}

export function nextDoseAt(s, iso) {
  const key = doseKey(s);
  if (!key) return null;
  const sibs = (state.data.supplements || []).filter((x) => doseKey(x) === key);
  let last = null;
  for (const day of [addDays(iso, -1), iso]) {
    const t = ticksOn(day);
    for (const x of sibs) {
      const at = suppTime(t[x.id]);
      if (at && (!last || at > last)) last = at;
    }
  }
  if (!last) return null;
  const next = new Date(last.getTime() + Number(s.gapHours) * 3600e3);
  if (currentDayIso(next) !== iso) return null;
  // One row shows it: the dose still to take whose group fits the time (after
  // midnight still counts as the evening), else the first one still to take.
  const ticks = ticksOn(iso);
  const open = sibs.filter((x) => activeOn(x, iso) && !ticks[x.id]);
  const h = next.getHours();
  const want = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'anytime' : 'evening';
  const rank = (x) => WHENS.findIndex(([k]) => k === (x.when || 'anytime'));
  const target = open.find((x) => (x.when || 'anytime') === want)
    || open.slice().sort((a, b) => rank(a) - rank(b) || byOrder(a, b))[0];
  return target?.id === s.id ? next : null;
}

export function suppScore(iso) {
  // Round 3 (A4): what he folded into "Now and then" is not counted, so a normal day can finish.
  const list = counted(iso);
  if (!list.length) return null;
  const t = ticksOn(iso);
  return { taken: list.filter((s) => t[s.id]).length, total: list.length };
}

// ----------------------------------------------------------------- PRN ---
const doses = () => state.data.doses || [];
const dosesFor = (medId) => doses().filter((x) => x.medId === medId)
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));

/**
 * When may the next dose be taken, and how long is left.
 * Computed from the most recent dose regardless of date, so a wait that runs
 * past midnight still reads correctly on the following day.
 */
export function prnStatus(med, now = new Date()) {
  const last = dosesFor(med.id)[0];
  if (!last) return { clear: true, last: null };
  const lastAt = new Date(last.at);
  const nextAt = new Date(lastAt.getTime() + (Number(med.waitHours) || 0) * 3600e3);
  const msLeft = nextAt - now;
  return { clear: msLeft <= 0, last, lastAt, nextAt, msLeft };
}

/** Sum a day's doses when they share a unit, so a split dose reads as one. */
function totalFor(rows) {
  let sum = 0; let unit = null; let ok = true;
  for (const r of rows) {
    const m = /^\s*([\d.]+)\s*([a-zA-Z]*)/.exec(r.dose || '');
    if (!m) { ok = false; break; }
    const u = (m[2] || '').toLowerCase();
    if (unit === null) unit = u; else if (unit !== u) { ok = false; break; }
    sum += Number(m[1]);
  }
  if (!ok || !sum) return '';
  return `= ${Number(sum.toFixed(2))}${unit || ''} today`;
}

function humanLeft(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// --------------------------------------------------------------- render ---
// Round 3 (2026-09-30), his words after v3: the week of date rings was "a little misplaced
// in this page. I don't really keep track of the supplements in that sort of way. Like I
// need to check everything off and see my progress for it." And the big "5 of 12" on the
// far left counting a date on the far right: "I just don't think that that's necessary for
// this specific page." So the checklist IS the page (research 10-round3-plan.md 1A):
//
//   - the title, and the date said once only when it is not the current day, with a
//     turquoise Today capsule that comes back; swipe the title row for a day either way,
//     press and hold the title for the date picker;
//   - one checklist strip under the title: a segment per item in list order, grouped by
//     band, filling green (from a spark off the tile) with the count at its RIGHT end, next
//     to what it counts; gold when everything is taken, then a slim gold line;
//   - bands by time of day: glyph, name, "3 of 5" in words; a menu with "Mark all taken"
//     (Apple Medications' Log All as Taken) and Undo; a finished band folds to one green
//     line with the time of its last tick;
//   - tiles three across with Apple's check circle top trailing; green only after his tap;
//   - A2 Morning set: one tap ticks the set his own mornings show (learned, his add and
//     drop on a long press), at one instant, through the same path as a finger;
//   - A4 Now and then: items he has not taken in two weeks fold away on his say so;
//   - A5 usual time: a late tick offers "With collagen" or "Usual" for 6 seconds.
// Every older rule is unchanged: the 5 am day, twice a day doses, the same name as a second
// row, half doses as separate entries, no time guessed for an older tick. Adherence history
// is in Progress > History (the day sheet lists that day's ticks with their times).

// One glyph per band, drawn like SF Symbols (sunrise, sun, moon). No emoji.
const BAND_GLYPH = {
  morning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 6v3M5.6 10.6l1.8 1.3M18.4 10.6l-1.8 1.3M9.5 3.5L12 6l2.5-2.5"/></svg>',
  anytime: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  evening: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/></svg>',
  // Now and then: a small stack, things set aside, not gone.
  quiet: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="12" width="16" height="7" rx="2.5"/><path d="M6.5 9h11M9 6h6"/></svg>',
};
const MORE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';
const CHEV_SVG = '<svg class="rs-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

// Where his finger landed on a tile, so the green fills out from that point (the next
// render carries it, so an in-place patch keeps it).
const touchAt = new Map();

// ------------------------------------------------ A4: Now and then (folded) ---
/** Ids he chose to fold into "Now and then" (device store; his list is never edited). */
export function foldedIds() {
  const q = local.get('quiet', {}) || {};
  return new Set(Object.entries(q).filter(([, v]) => v && !v.hidden).map(([k]) => k));
}
/** The day's list without what he folded away: what the strip and the bands count. */
function counted(iso) {
  const f = foldedIds();
  return listFor(iso).filter((s) => !f.has(s.id));
}
const bandOf = (s) => s.when || 'anytime';

/** Per band counts for the widgets (and anyone else): [{ id, label, taken, total }]. */
export function suppBands(iso = currentDayIso()) {
  const t = ticksOn(iso);
  const list = counted(iso);
  return WHENS.map(([id, label]) => {
    const rows = list.filter((s) => bandOf(s) === id);
    // `ids`: the band's items, for the widgets' names line when there is no Morning set (round 3 leftovers, NW-08).
    return { id, label, taken: rows.filter((s) => t[s.id]).length, total: rows.length, ids: rows.map((s) => s.id) };
  }).filter((b) => b.total > 0);
}

/** A tick's instant, or null (a `true` tick has no time, and none is invented). */
const tickAt = (v) => suppTime(v);
const minsOfDay = (d) => {
  // Minutes from the supplement day's 5 am start, so an after midnight tick sorts late.
  const m = d.getHours() * 60 + d.getMinutes();
  return (m - DAY_ROLLOVER_HOUR * 60 + 1440) % 1440;
};
const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
const collagenItem = () => (state.data.supplements || []).find((s) => /collagen/i.test(s?.name || '')) || null;

/** The item's usual time over the last 14 days, as minutes after 5 am, or null (under 5 samples). */
function usualMins(id, iso) {
  const xs = [];
  for (let i = 1; i <= 14; i++) {
    const at = tickAt(ticksOn(addDays(iso, -i))[id]);
    if (at) xs.push(minsOfDay(at));
  }
  return xs.length >= 5 ? Math.round(median(xs)) : null;
}

// ----------------------------------------------------- A2: the Morning set ---
/**
 * The set his mornings show: items ticked within 10 minutes of the collagen on at least
 * half of the last 14 days that have a collagen tick with a real time (at least 7 such
 * days), plus his own adds, minus his drops. The collagen leads it (the anchor that starts
 * the tendon loading hour). Fewer than two items: no set. Never as needed medicines.
 */
export function morningSetFor(iso = currentDayIso()) {
  const col = collagenItem();
  const today = listFor(iso);
  if (!col || !today.some((s) => s.id === col.id)) return { ids: [], learned: false };
  const count = new Map();
  let days = 0;
  for (let i = 1; i <= 14; i++) {
    const t = ticksOn(addDays(iso, -i));
    const c = tickAt(t[col.id]);
    if (!c) continue;
    days++;
    for (const s of today) {
      if (s.id === col.id) continue;
      const at = tickAt(t[s.id]);
      if (at && Math.abs(at - c) <= 10 * 60000) count.set(s.id, (count.get(s.id) || 0) + 1);
    }
  }
  const ms = local.get('morningSet', { add: [], drop: [] }) || {};
  const add = new Set(ms.add || []);
  const drop = new Set(ms.drop || []);
  // Nothing learned yet (under 7 usable mornings): only what he chose himself.
  if (days < 7) count.clear();
  if (days < 7 && !add.size) return { ids: [], learned: false };
  const ids = [col.id].concat(today.filter((s) => s.id !== col.id
    && ((count.get(s.id) || 0) >= days / 2 || add.has(s.id))).map((s) => s.id))
    .filter((id) => !drop.has(id) || id === col.id);
  return { ids: ids.length >= 2 ? ids : [], learned: true, candidates: today.map((s) => s.id), learnedIds: new Set([col.id, ...[...count].filter(([, n]) => n >= days / 2).map(([k]) => k)]) };
}

/**
 * One or more ticks at one instant, through the page's one write (update), so the tendon
 * loading hour (routines.js subscribes) and everything else runs as for a finger tick.
 * `at` is a Date (a real moment) or null for "taken, time unknown" on a day that is not the
 * current one. Returns the day's previous ticks, exactly, for Undo.
 */
function tickMany(iso, ids, at) {
  const before = { ...(getDay(iso)?.supps || {}) };
  update(() => {
    const day = ensureDay(iso);
    day.supps = { ...(day.supps || {}) };
    for (const id of ids) if (!day.supps[id]) day.supps[id] = at ? at.toISOString() : true;
  });
  if (at) {
    const col = collagenItem();
    if (col && ids.includes(col.id)) suppTimeHook?.(iso, col.id, at);
  }
  return before;
}
function restoreTicks(iso, before) {
  update(() => {
    const day = ensureDay(iso);
    day.supps = { ...before };
  });
}
/** The moment for a tick made now on `iso`: a real time on the current day, else none. */
const nowFor = (iso) => (iso === currentDayIso() ? new Date() : null);

/**
 * The bands, grouped morning / anytime / evening. `edit` shows the list as rows with
 * drag handles and Remove (Apple's edit mode); otherwise tiles.
 */
export function renderSuppGroups(iso, ctx, { edit = false } = {}) {
  const list = edit ? listFor(iso) : counted(iso);
  const ticks = ticksOn(iso);
  const isCur = iso === currentDayIso();
  const mset = !edit && isCur ? morningSetFor(iso) : { ids: [] };
  const inSet = new Set(mset.ids);
  const group = ([key, label]) => {
    const rows = list.filter((s) => bandOf(s) === key);
    // While editing, keep empty groups on screen so you can drag INTO them.
    if (!rows.length && !edit) return '';
    const taken = rows.filter((s) => ticks[s.id]).length;
    const done = rows.length > 0 && taken === rows.length;
    // 2026-09-15, his pick: finishing a group lets it settle closed after a moment
    // (settleIfDone), unless he is still using it. Folded, it is one green line.
    const open = edit || groupOpen(ctx, key, iso);
    const last = done ? rows.map((s) => tickAt(ticks[s.id])).filter(Boolean).sort((a, b) => b - a)[0] : null;
    const words = done ? `${checkSvg}All ${rows.length}${last ? ` · ${time12(last)}` : ''}` : `${taken} of ${rows.length}`;
    const setLeft = key === 'morning' ? mset.ids.filter((id) => !ticks[id]) : [];
    return `
      <section class="suppgroup rs-band ${done ? 'done' : ''} ${open ? 'open' : 'shut'}" data-band="${key}">
        <div class="rs-bandrow">
          <button class="suppgrouphead rs-bandhead" data-suppgroup="${key}" aria-expanded="${open}" ${edit ? 'disabled' : ''}>
            <span class="rs-bglyph">${BAND_GLYPH[key]}</span>
            <span class="sg-label">${label}</span>
            <span class="sg-count ${done ? 'good' : ''}">${words}</span>
          </button>
          ${setLeft.length ? morningCap(mset.ids, ticks) : ''}
          ${!edit && !done && rows.length > 1 ? `<button type="button" class="rs-bandmore" data-bandmenu="${key}" aria-label="${esc(label)} options">${MORE_SVG}</button>` : ''}
        </div>
        ${open ? `<div class="fold-body"><div class="fold-clip"><div class="supplist ${edit ? 'editing rs-rows' : 'rs-tiles'}" data-dropzone="${key}">
          ${rows.map((s) => (edit ? editRow(s) : suppRow(s, iso, ticks, ctx, inSet))).join('')}
        </div></div></div>` : ''}
      </section>`;
  };
  if (!listFor(iso).length && !edit) return '<p class="rs-empty">Nothing on the list for this day.</p>';
  return WHENS.map(group).join('') + (edit ? '' : quietBand(iso, ctx, ticks));
}

/** A2: the Morning set capsule. Small pill marks, one per item still to take, then the words. */
function morningCap(ids, ticks) {
  const left = ids.filter((id) => !ticks[id]);
  const names = left.map((id) => (state.data.supplements || []).find((s) => s.id === id)?.name).filter(Boolean);
  const marks = left.slice(0, 5).map(() => '<i></i>').join('') + (left.length > 5 ? `<em>+${left.length - 5}</em>` : '');
  return `<button type="button" class="rs-mset" data-mset aria-label="Morning set: take ${esc(names.join(', '))}. Press and hold to choose what is in it">
    <span class="rs-msetmarks" aria-hidden="true">${marks}</span><span class="rs-msetword">Morning set</span></button>`;
}

/** A4: the folded items, one closed row after the bands; opened, they tick as before. */
function quietBand(iso, ctx, ticks) {
  const f = foldedIds();
  const rows = listFor(iso).filter((s) => f.has(s.id));
  if (!rows.length) return '';
  const open = !!ctx.suppQuietOpen;
  const taken = rows.filter((s) => ticks[s.id]).length;
  return `
    <section class="suppgroup rs-band rs-quiet ${open ? 'open' : 'shut'}" data-band="quiet">
      <div class="rs-bandrow">
        <button type="button" class="rs-bandhead rs-quiethead" data-quietrow aria-expanded="${open}" aria-label="Now and then, ${rows.length}${taken ? `, ${taken} taken` : ''}. Press and hold to choose">
          <span class="rs-bglyph">${BAND_GLYPH.quiet}</span>
          <span class="sg-label">Now and then</span>
          ${taken ? '<span class="rs-qdot" aria-hidden="true"></span>' : ''}
          <span class="sg-count">${rows.length}</span>${CHEV_SVG}
        </button>
      </div>
      ${open ? `<div class="fold-body"><div class="fold-clip"><div class="supplist rs-tiles" data-dropzone="quiet">
        ${rows.map((s) => suppRow(s, iso, ticks, ctx, new Set())).join('')}
      </div></div></div>` : ''}
    </section>`;
}

/**
 * A4, asked once: two or more items with 0 or 1 ticks in the last 14 days (and at least 14
 * days of real tick data, each item on the list for 14 days or more). The row IS the
 * question: Fold or Keep. Keep means never asked about those again.
 */
function quietAsk(iso) {
  if (iso !== currentDayIso()) return [];
  const seen = local.get('seen.quietAsk', {}) || {};
  const f = foldedIds();
  let dataDays = 0;
  const n = new Map();
  for (let i = 1; i <= 14; i++) {
    const t = ticksOn(addDays(iso, -i));
    if (Object.values(t).some((v) => tickAt(v))) dataDays++;
    for (const [id, v] of Object.entries(t)) if (v) n.set(id, (n.get(id) || 0) + 1);
  }
  if (dataDays < 14) return [];
  const since = addDays(iso, -14);
  // Never offer to fold an item he has ticked on the current day (r3 audit TS-01).
  const today = ticksOn(iso);
  const ids = listFor(iso).filter((s) => !f.has(s.id) && !seen[s.id] && !today[s.id] && activeOn(s, since) && (n.get(s.id) || 0) <= 1).map((s) => s.id);
  quietAsk.counts = n;
  return ids.length >= 2 ? ids : [];
}
function quietAskRow(iso) {
  const ids = quietAsk(iso);
  if (!ids.length) return '';
  const name = (id) => (state.data.supplements || []).find((s) => s.id === id)?.name || '';
  // A true sentence: "Not taken" only when none of them was taken at all in the 14 days.
  const n = quietAsk.counts || new Map();
  const q = ids.every((id) => !n.get(id)) ? 'Not taken in 2 weeks' : 'Hardly taken in 2 weeks';
  return `<section class="rs-ask" aria-label="${q}">
    <div class="rs-askitems">${ids.map((id) => `<span class="rs-askitem">${esc(name(id))}</span>`).join('')}</div>
    <div class="rs-askfoot"><span class="rs-askq">${q}</span>
      <span class="rs-askbtns"><button type="button" class="rs-askbtn fold" data-quietask="fold">Fold</button><button type="button" class="rs-askbtn" data-quietask="keep">Keep</button></span></div>
  </section>`;
}

// "Next dose about": a small clock, so the time fits the tile on one line.
const NEXT_SVG = '<svg class="rs-next" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const checkSvg = '<svg class="sg-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/**
 * One supplement as a tile: a real checkbox with its name as the label (the whole tile
 * is the target), Apple's check circle at the trailing corner (bottom: a long single word
 * like Multivitamin needs the whole top line), and, once taken, the
 * time as its own control on the tile's lower line, which opens the time wheel. Two
 * independent actions, each at least 44 pt.
 *
 * Where a finger can feel a switch (B6-1, hapTaps) the checkbox gets the `switch`
 * attribute: iOS answers his tap with its own tap. Untaken starts neutral; green only
 * after his tick (his rule, 2026-08-07).
 */
function suppRow(s, iso, ticks, ctx, inSet = new Set()) {
  const on = !!ticks[s.id];
  const hap = hapTaps();
  const t = suppTime(ticks[s.id]);
  // A day that is over has nothing left to take: no next dose time, no due turquoise (audit T31).
  const next = !on && iso >= currentDayIso() ? nextDoseAt(s, iso) : null;
  const due = next && next.getTime() <= Date.now();
  const id = `supp-${s.id}-${iso}`;
  const at = touchAt.get(s.id);
  const lag = ctx.suppStagger?.[s.id];
  const style = [at ? `--tx:${at[0]}%;--ty:${at[1]}%` : '', lag != null ? `--d:${lag}ms` : ''].filter(Boolean).join(';');
  return `
    <div class="supprow rs-tile ${on ? 'on' : ''} ${ctx.suppPop === s.id ? 'pop' : ''} ${inSet.has(s.id) && !on ? 'inset' : ''}" data-row="${esc(s.id)}"${style ? ` style="${style}"` : ''}>
      <label class="supp-check" for="${esc(id)}">
        <input type="checkbox" ${hap ? 'switch ' : ''}id="${esc(id)}" class="supp-input" data-supp="${esc(s.id)}" ${on ? 'checked' : ''} data-focus-key="supp|${esc(s.id)}">
        <span class="rs-tfill" aria-hidden="true"></span>
        <span class="suppname">${esc(s.name)}</span>
        <span class="rs-tsub ${due ? 'due' : ''}"${next && !on ? ` aria-label="Next dose about ${esc(time12(next))}${due ? ', you can take it now' : ''}"` : ''}>${on ? '' : next ? `${NEXT_SVG}${esc(time12(next))}` : ''}</span>
        <span class="supptick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span>
      </label>
      ${on ? `<label class="supptime rs-ttime ${t ? 'set' : ''}" data-supptime-wrap>
          <span>${t ? esc(time12(t)) : 'Set time'}</span>
          <input type="time" data-supptime="${esc(s.id)}" value="${t ? hhmm24(t) : ''}" aria-label="Time you took ${esc(s.name)}">
        </label>` : ''}
    </div>`;
}

/** Edit mode: a row with a drag handle and Remove, the way iOS lists edit. */
function editRow(s) {
  return `
    <div class="supprow rs-erow" data-row="${esc(s.id)}">
      <button type="button" class="suppdel rs-del" data-suppdel="${esc(s.id)}" aria-label="Remove ${esc(s.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10"/></svg></button>
      <span class="suppname">${esc(s.name)}${Number(s.gapHours) > 0 ? ` <span class="rs-every">every ${esc(String(s.gapHours))} h</span>` : ''}</span>
      <span class="supphandle" data-drag aria-label="Drag to reorder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg></span>
    </div>`;
}

const settleTimers = new Map();   // group key -> the pending settle

/**
 * Whether a group is open. A group he folds stays folded; a group that settled
 * closed on its own stays closed for that day only, so the next morning's
 * list is open again.
 */
function groupOpen(ctx, key, iso) {
  const shutOn = ctx.suppShutOn?.[key];
  if (shutOn && shutOn !== iso) return true;
  // v3: a band already finished when the page opens starts folded to its one line
  // (M6: finished groups collapse); one he opens stays open.
  return ctx.suppOpen?.[key] ?? !bandDone(iso, key);
}

function bandDone(iso, key) {
  const rows = counted(iso).filter((s) => bandOf(s) === key);
  const t = ticksOn(iso);
  return rows.length > 0 && rows.every((s) => t[s.id]);
}

/**
 * The checklist strip (plan 1A): a segment per counted item, in list order, grouped by
 * band with a gap between bands; the count at the right end of the same strip, on solid
 * ground. Tap a segment: the page scrolls to its tile and outlines it once, no tick.
 */
function checklistStrip(iso, ctx) {
  const list = counted(iso);
  if (!list.length) return '';
  const t = ticksOn(iso);
  const taken = list.filter((s) => t[s.id]).length;
  const full = taken === list.length;
  // Full when the page opened: the slim gold line. Just finished: gold at full height a moment first.
  const settled = full && !(ctx.suppGoldUntil > Date.now());
  const bands = WHENS.map(([k]) => list.filter((s) => bandOf(s) === k)).filter((r) => r.length);
  return `
    <div class="rs-strip ${full ? 'full' : ''} ${settled ? 'settled' : ''}" role="group" aria-label="${taken} of ${list.length} taken">
      <div class="rs-segs">${bands.map((rows) => `<span class="rs-segband" style="flex:${rows.length} 1 0">${rows.map((s) => `<button type="button" class="rs-seg ${t[s.id] ? 'on' : ''}" data-seg="${esc(s.id)}" aria-label="${esc(s.name)}${t[s.id] ? ', taken' : ''}"><i></i></button>`).join('')}</span>`).join('')}</div>
      <span class="rs-stripcount" aria-hidden="true"><b data-roll="supps">${taken}</b><span> of ${list.length}</span></span>
    </div>`;
}

/** Tick and fold handlers for the shared rows. */
export function bindSuppGroups(root, iso, ctx, rerender) {
  // A group folds and unfolds in place (Fable B5); while reordering, the
  // whole list repaints so the drag handles are bound.
  const setGroup = (b, open, ms = 180) => {
    const k = b.dataset.suppgroup;
    ctx.suppOpen = { ...(ctx.suppOpen || {}) };
    ctx.suppOpen[k] = open;
    ctx.suppShutOn = { ...(ctx.suppShutOn || {}) };
    if (ms > 180) ctx.suppShutOn[k] = iso; else delete ctx.suppShutOn[k];
    const sec = b.closest('.suppgroup');
    const edit = !!sec?.querySelector('.supplist.editing') || !!(ctx.suppEdit && b.closest('.supps-page'));
    if (!sec || edit) { rerender(); return; }
    const tpl = [...parse(`<div>${renderSuppGroups(iso, ctx)}</div>`).firstElementChild.children]
      .find((x) => x.querySelector(`[data-suppgroup="${CSS.escape(k)}"]`));
    if (!tpl) { rerender(); return; }
    sec.classList.toggle('open', open);
    sec.classList.toggle('shut', !open);
    if (open) {
      const body = insertBody(sec, tpl, '.fold-body');
      if (!body) { rerender(); return; }
      bindSuppGroups(body, iso, ctx, rerender);
      growIn(body, 260);
      return;
    }
    const body = sec.querySelector(':scope > .fold-body');
    if (!body || !patchHead(sec, tpl, '.fold-body')) { rerender(); return; }
    if (ms > 180) body.classList.add('settling');
    foldAway(body, ms, () => { if (!groupOpen(ctx, k, iso)) body.remove(); });
  };
  live.setGroup = setGroup;
  root.querySelectorAll('[data-suppgroup]').forEach((b) => b.addEventListener('click', () => {
    clearTimeout(settleTimers.get(b.dataset.suppgroup));
    setGroup(b, !groupOpen(ctx, b.dataset.suppgroup, iso));
  }));

  /**
   * The last supplement in a group ticked (2026-09-15, his pick): the count settles in
   * with a small slide, then after a moment the group folds to its green line. Anything he
   * does in the group before then (the time, another tick) keeps it open, and a tap on its
   * heading opens it again. The whole day done: the strip turns gold (his finish colour).
   */
  const settleIfDone = (k) => {
    const view = document.getElementById('view') || document;
    const head = view.querySelector(`[data-suppgroup="${CSS.escape(k)}"]`);
    const sec = head?.closest('.suppgroup');
    const count = head?.querySelector('.sg-count');
    if (!sec || !count?.classList.contains('good') || sec.querySelector('.supplist.editing')) return;
    if (!still()) {
      count.animate([{ transform: 'translateX(14px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 360, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
    clearTimeout(settleTimers.get(k));
    const cancel = () => clearTimeout(settleTimers.get(k));
    sec.addEventListener('pointerdown', cancel, { once: true, capture: true });
    settleTimers.set(k, setTimeout(() => {
      sec.removeEventListener('pointerdown', cancel, { capture: true });
      if (!sec.isConnected || !head.querySelector('.sg-count.good') || !groupOpen(ctx, k, iso)) return;
      if (sec.contains(document.activeElement) && document.activeElement.matches('input[type=time]')) return;   // the time wheel is open
      if (document.querySelector('.rs-usual')) return;   // A5 chips still offered on a tile of it
      setGroup(head, false, 420);
    }, 1400));
  };
  live.settleIfDone = settleIfDone;

  // Where the finger lands on a tile: the fill grows from there.
  root.querySelectorAll('.rs-tile').forEach((tile) => tile.addEventListener('pointerdown', (e) => {
    const r = tile.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 100);
    const y = Math.round(((e.clientY - r.top) / r.height) * 100);
    touchAt.set(tile.dataset.row, [x, y]);
    tile.style.setProperty('--tx', `${x}%`);
    tile.style.setProperty('--ty', `${y}%`);
  }, { passive: true }));

  // The time wheel on a ticked tile: when he actually took it, for the mornings
  // he logs later.
  root.querySelectorAll('[data-supptime]').forEach((inp) => {
    // iOS opens its wheel on a tap; desktop browsers need to be asked.
    inp.closest('[data-supptime-wrap]')?.addEventListener('click', (ev) => {
      if (inp.disabled) return;
      if (ev.target === inp) return;
      try { inp.showPicker?.(); } catch { /* the native tap still works */ }
    });
    onTimePicked(inp, (v) => {
      if (!/^\d{2}:\d{2}$/.test(v)) return;
      const [h, m] = v.split(':').map(Number);
      setTickTime(iso, inp.dataset.supptime, suppDoseDate(iso, h, m));
      rerender({ soft: true });
    });
  });

  root.querySelectorAll('input[data-supp]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.supp;
    const on = cb.checked;
    if (on) sfx('tick');   // sound map: 'tick' = a supplement ticked, from his tap; Undo and un-ticks stay quiet
    const before = suppScore(iso);
    update(() => {
      const day = ensureDay(iso);
      day.supps = { ...(day.supps || {}) };
      if (!on) delete day.supps[id];
      // F08: a tick on the day in hand records the moment; a tick on another
      // day records "taken, time unknown" (the existing true), never today's
      // clock on yesterday's list. He can set the real time on the tile.
      else day.supps[id] = iso === currentDayIso() ? new Date().toISOString() : true;
    });
    // Patched in place (Fable B2): the tile in the tap, so the fill starts at once;
    // the band count, the strip and the page's totals once that frame is drawn.
    ctx.suppPop = on ? id : null;    // one render's worth of pop
    const row = cb.closest('.supprow');
    // The band he is ticking in stays open until it settles on its own (settleIfDone).
    const band = row?.closest('.suppgroup')?.dataset.band;
    if (band && band !== 'quiet' && ctx.suppOpen?.[band] === undefined) ctx.suppOpen = { ...(ctx.suppOpen || {}), [band]: true };
    if (!on) row?.classList.remove('pop');   // so ticking again replays it
    const edit = !!row?.closest('.supplist.editing');
    const tpl = row && parse(`<div>${renderSuppGroups(iso, ctx, { edit })}</div>`).firstElementChild
      .querySelector(`.supprow[data-row="${CSS.escape(id)}"]`);
    const ok = !!tpl && morph(row, tpl);
    const group = row?.closest('.suppgroup')?.querySelector('[data-suppgroup]')?.dataset.suppgroup;
    if (!ok) rerender({ soft: true });
    ctx.suppPop = null;
    const after = suppScore(iso);
    const dayDone = on && after && after.taken === after.total && before && before.taken < before.total;
    if (dayDone) ctx.suppGoldUntil = Date.now() + 1800;
    const finish = () => {
      if (on) {
        // Idea 4: a green spark from the tile into its segment of the strip.
        const seg = document.querySelector(`#view .rs-seg[data-seg="${CSS.escape(id)}"]`);
        const tile = document.querySelector(`#view .rs-tile[data-row="${CSS.escape(id)}"]`);
        if (seg && tile) spark(tile, seg);
        if (iso === currentDayIso()) offerUsual(iso, id);
      }
      if (on && group) settleIfDone(group);
      if (dayDone) dayFinished(ctx, rerender);
    };
    if (ok) requestAnimationFrame(() => setTimeout(() => { if (cb.isConnected) rerender({ soft: true }); finish(); }, 0));
    else finish();
    if (!on && group) clearTimeout(settleTimers.get(group));
  }));
}

/** A time on a ticked item, through the one path the time wheel uses (onTimePicked). */
function setTickTime(iso, id, at) {
  update(() => {
    const day = ensureDay(iso);
    day.supps = { ...(day.supps || {}) };
    if (day.supps[id]) day.supps[id] = at.toISOString();
    suppTimeHook?.(iso, id, at);
  });
}

// ------------------------------------------------- A5: usual time, one tap ---
/**
 * A tick on the current day more than 90 minutes after the item's usual time offers two
 * chips for 6 seconds: "Now" (what is already saved, selected) and "With collagen 11:37 AM"
 * (when today's collagen has a real time and the item usually goes with it, within 20
 * minutes) or "Usual 11:40 AM". Usual is the most recent past instant at that clock time
 * that is not before the checklist day's 5 am start; never a logical date joined to a clock.
 */
function offerUsual(iso, id) {
  const now = new Date();
  const u = usualMins(id, iso);
  if (u == null) return;
  const [y, mo, d] = iso.split('-').map(Number);
  const start = new Date(y, mo - 1, d, DAY_ROLLOVER_HOUR, 0, 0, 0);
  const usualAt = new Date(start.getTime() + u * 60000);
  if (usualAt > now || now - usualAt <= 90 * 60000) return;
  const col = collagenItem();
  let label = `Usual ${time12(usualAt)}`;
  let at = usualAt;
  if (col && col.id !== id) {
    const colAt = tickAt(ticksOn(iso)[col.id]);
    const cu = usualMins(col.id, iso);
    if (colAt && cu != null && Math.abs(cu - u) <= 20) { label = `With collagen ${time12(colAt)}`; at = colAt; }
  }
  const tile = document.querySelector(`#view .rs-tile[data-row="${CSS.escape(id)}"]`);
  if (!tile) return;
  document.querySelector('.rs-usual')?.dispatchEvent(new Event('rt-close'));
  const bar = document.createElement('div');
  bar.className = 'rs-usual';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'When you took it');
  bar.innerHTML = `<button type="button" class="on" data-u="now" aria-pressed="true">Now</button><button type="button" data-u="usual" aria-pressed="false">${esc(label)}</button>`;
  document.body.appendChild(bar);
  placeUsual(bar, tile);
  requestAnimationFrame(() => bar.classList.add('in'));
  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    removeEventListener('scroll', close, true);
    bar.classList.remove('in');
    setTimeout(() => bar.remove(), 220);
  };
  const timer = setTimeout(close, 6000);
  addEventListener('scroll', close, { capture: true, passive: true });
  bar.addEventListener('rt-close', close);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    if (b.dataset.u === 'usual' && ticksOn(iso)[id]) {
      setTickTime(iso, id, at);
      nHaptic('selection');
      live.rerender?.({ soft: true });
    }
    close();
  });
}

/**
 * Where the usual time chips go (r3 audit TS-03): never on another tile's tick target, the
 * strip or the tab bar, because his next tick is usually the tile beside or below. Tried in
 * order: under the tile, over it, then the same two slid sideways; if every spot would
 * cover a target, it docks just above the tab bar (where the Undo toasts sit).
 */
function placeUsual(bar, tile) {
  const r = tile.getBoundingClientRect();
  const w = bar.offsetWidth;
  const h = bar.offsetHeight;
  const pad = 6;
  const strip = document.querySelector('#view .rs-strip')?.getBoundingClientRect();
  const tabs = document.querySelector('#mtabs')?.getBoundingClientRect();
  const topMin = Math.max(strip ? strip.bottom : 0, 44) + 4;
  const botMax = (tabs && tabs.height ? tabs.top : innerHeight) - 4;
  const targets = [...document.querySelectorAll('#view .rs-tile, #view .rs-mset, #view .rs-prn button, #view .rs-ask button')]
    .filter((el) => el !== tile && !tile.contains(el) && !el.contains(tile))
    .map((el) => el.getBoundingClientRect())
    .filter((b) => b.width && b.height);
  const hits = (x, y) => targets.some((b) => x < b.right - 2 && x + w > b.left + 2 && y < b.bottom - 2 && y + h > b.top + 2);
  const clampX = (x) => Math.max(12, Math.min(innerWidth - 12 - w, x));
  const xs = [clampX(r.left + r.width / 2 - w / 2), clampX(r.left), clampX(r.right - w)];
  const ys = [r.bottom + pad, r.top - h - pad];
  for (const y of ys) {
    if (y < topMin || y + h > botMax) continue;
    for (const x of xs) {
      if (!hits(x, y)) { bar.style.left = `${Math.round(x)}px`; bar.style.top = `${Math.round(y)}px`; return; }
    }
  }
  bar.classList.add('dock');
  bar.style.left = `${Math.round(clampX(innerWidth / 2 - w / 2))}px`;
  bar.style.top = `${Math.round(botMax - h - 8)}px`;
}

/**
 * The whole list taken: the strip turns gold (CSS, from the render) and the moment plays
 * once, native particles and haptic where the app has them (quiet after midnight, A7), the
 * web gold pulse otherwise, never both (DESIGN-LANGUAGE, Motion). Then it settles to a
 * slim gold line.
 */
async function dayFinished(ctx, rerender) {
  const strip = document.querySelector('#view .rs-strip');
  if (!strip) return;
  const native = await call('cel.play', { kind: 'exercise', rect: rectOf(strip), accent: 'gold', quiet: !!window.__rtNight });
  if (native === true) window.__rtCelAt = Date.now();
  if (native !== true && !still()) {
    strip.classList.remove('won');
    void strip.offsetWidth;
    strip.classList.add('won');
  }
  setTimeout(() => { ctx.suppGoldUntil = 0; if (strip.isConnected) rerender({ soft: true }); }, 1900);
}

/**
 * One line for Today: each as-needed medication and whether it is clear.
 * Empty when nothing is on the list.
 */
export function prnSummary(iso) {
  const day = prnDateFor(iso);
  const meds = (state.data.prnMeds || []).filter((m) => activeOn(m, day)).sort(byOrder);
  if (!meds.length) return '';
  return meds.map((m) => {
    const st = prnStatus(m);
    return `${m.name} ${!st.last || st.clear ? 'clear' : humanLeft(st.msLeft)}`;
  }).join(' · ');
}

export function renderSupplements(ctx) {
  const iso = ctx.suppDate || currentDayIso();
  const cur = currentDayIso();
  const edit = !!ctx.suppEdit;
  const other = iso !== cur;
  return `
  <div class="stack supps-page rt-supps ${edit ? 'editing' : ''}">
    <header class="pagehead">
      <div class="rs-titlerow">
        <h1 data-supp-title>Supplements</h1>
        <span class="rs-titlebtns">
          <button type="button" class="rs-glassbtn ${edit ? 'on' : ''}" data-supp-edit>${edit ? 'Done' : 'Edit'}</button>
        </span>
      </div>
      ${/* 2026-09-30, his report ("I don't see an easy way of changing the date"): the day is
           always on screen with arrows either side, and a tap on it opens the calendar. The
           swipe and the long press on the title still work. Next is hidden on the current day. */ ''}
      <div class="rs-dateline">
        <button type="button" class="rs-dnav" data-sday="-1" aria-label="Previous day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button type="button" class="rs-date" data-supp-pick aria-label="Choose a date">${other ? `${esc(fmtDate(iso, 'dow'))}, ` : 'Today, '}${esc(fmtDate(iso, 'short'))}</button>
        <button type="button" class="rs-dnav" data-sday="1" aria-label="Next day" ${other ? '' : 'hidden'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
        ${other ? '<button type="button" class="rs-todaycap" data-nav="today">Today</button>' : ''}
      </div>
      <input type="date" class="rs-jump" data-jump value="${iso}" max="${cur}" aria-label="Go to a date" tabindex="-1">
    </header>
    ${edit ? '' : checklistStrip(iso, ctx)}

    <div class="supp-groups">${renderSuppGroups(iso, ctx, { edit })}</div>

    ${renderPrn(ctx, iso)}
    ${edit ? '' /* the one time question comes last, so the as needed row stays on screen (TS-14) */ : quietAskRow(iso)}
    ${edit ? `<button type="button" class="rs-add" data-supp-add aria-haspopup="menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>Add</button>` : ''}
  </div>`;
}

/**
 * The as-needed row runs on the REAL calendar date, never the checklist's
 * 5am-shifted one. A dose is a timed event: its day is the clock's day, and
 * the countdown to the next one measures from the actual moment.
 *
 * `iso` is the day the CHECKLIST is showing. While that is the current one the
 * two differ only between midnight and 5am, and there the medication follows
 * the clock. Navigate deliberately to an older date and this follows you there,
 * exactly as it always did.
 */
function prnDateFor(iso) {
  return iso === currentDayIso() ? todayIso() : iso;
}

/** "Clear", or the next allowed time ("9:40 PM", "Wed 8:01 AM" when it is not today). */
function prnWords(st) {
  if (!st.last || st.clear) return 'Clear';
  const same = localIso(st.nextAt) === localIso(new Date());
  return `${same ? '' : `${st.nextAt.toLocaleDateString('en-US', { weekday: 'short' })} `}${time12(st.nextAt)}`;
}
const prnPct = (m, st) => ((!st.last || st.clear) ? 0
  : Math.max(0, Math.min(1, 1 - st.msLeft / ((Number(m.waitHours) || 1) * 3600e3))));

/**
 * As needed: one compact capsule per medicine, his "subtle sliding progress bar
 * underlay" (2026-08-08) filling as the wait passes, the next allowed time on it, or
 * Clear. A tap opens its dose sheet with the time set to now (every dose logged, even
 * early). In Edit, Remove and Add live here too.
 */
function renderPrn(ctx, iso) {
  const day = prnDateFor(iso);
  const meds = (state.data.prnMeds || []).filter((m) => activeOn(m, day)).sort(byOrder);
  const edit = !!ctx.suppEdit;
  if (!meds.length) return '';
  // Edit: the same iOS edit rows as the bands (Remove on the left, the name clear of it),
  // never a badge over a capsule's first letter (audit T20).
  if (edit) {
    return `
  <section class="rs-prn" aria-label="As needed">
    <h2 class="rs-h rs-prnh">As needed</h2>
    <div class="rs-rows rs-prnedit">
      ${meds.map((m) => `
      <div class="supprow rs-erow" data-prn-erow="${esc(m.id)}">
        <button type="button" class="suppdel rs-del" data-prndel="${esc(m.id)}" aria-label="Remove ${esc(m.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10"/></svg></button>
        <span class="suppname">${esc(m.name)}${Number(m.waitHours) > 0 ? ` <span class="rs-every">every ${esc(String(m.waitHours))} h</span>` : ''}</span>
      </div>`).join('')}
    </div>
  </section>`;
  }
  return `
  <section class="rs-prn" aria-label="As needed">
    <div class="rs-prnrow">
      ${meds.map((m) => {
        const st = prnStatus(m);
        const today = doses().filter((x) => x.medId === m.id && String(x.at).slice(0, 10) === day).length;
        return `<div class="rs-prnwrap">
          <button type="button" class="rs-prncap prnrow ${!st.last || st.clear ? 'clear' : 'waiting'}" data-prn-row="${esc(m.id)}" ${edit ? 'disabled' : `data-prn-dose="${esc(m.id)}"`}
            aria-label="${esc(m.name)}, ${esc(prnWords(st) === 'Clear' ? 'clear' : `next at ${prnWords(st)}`)}${today ? `, ${today} today` : ''}">
            <i class="prnfill" style="--p:${prnPct(m, st).toFixed(3)}"></i>
            <span class="prnname">${esc(m.name)}</span>
            <span class="prnstatus" data-prn-status="${esc(m.id)}">${esc(prnWords(st))}</span>
            ${today ? `<span class="rs-prncount" aria-hidden="true">${today}</span>` : ''}
          </button>
        </div>`;
      }).join('')}
    </div>
  </section>`;
}

// ----------------------------------------------------------------- bind ---
/**
 * Reordering by drag, built on pointer events.
 *
 * HTML5 drag-and-drop does not work with a finger on iOS, so this tracks the
 * pointer directly: the row under it is found with elementFromPoint and the
 * dragged row is moved before or after it live. Dropping into another group's
 * list also changes `when`, which is what makes "move it to evening" a drag
 * rather than a form field.
 */
function bindDragReorder(root, rerender) {
  let dragging = null;
  let startY = 0;

  const rowUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-row]') : null;
  };
  const zoneUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-dropzone]') : null;
  };

  // Tracked on the document from pointerdown (Fable A2). Moving the row in
  // the DOM releases pointer capture on the handle (capture clears when its
  // element is removed), so pointerup never reached the handle and a reorder
  // was never committed. The row itself moves under the finger; the order is
  // written once, on release.
  root.querySelectorAll('[data-drag]').forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      if (dragging) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = h.closest('[data-row]');
      startY = e.clientY;
      dragging.classList.add('dragging');
      const pointer = e.pointerId;

      const move = (ev) => {
        if (!dragging || ev.pointerId !== pointer) return;
        ev.preventDefault();
        const over = rowUnder(ev.clientX, ev.clientY);
        if (over && over !== dragging) {
          const r = over.getBoundingClientRect();
          const after = ev.clientY > r.top + r.height / 2;
          const ref = after ? over.nextSibling : over;
          if (ref !== dragging && ref !== dragging.nextSibling) over.parentNode.insertBefore(dragging, ref);
        } else if (!over) {
          // Not over a row, maybe over an empty group's list.
          const zone = zoneUnder(ev.clientX, ev.clientY);
          if (zone && !zone.contains(dragging)) zone.appendChild(dragging);
        }
      };
      const finish = (ev) => {
        if (!dragging || ev.pointerId !== pointer) return;
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', finish, true);
        dragging.classList.remove('dragging');
        dragging = null;
        // Commit the DOM order back to the document, in one mutation.
        update((d) => {
          let order = 0;
          root.querySelectorAll('[data-dropzone]').forEach((zone) => {
            const when = zone.dataset.dropzone;
            zone.querySelectorAll('[data-row]').forEach((el) => {
              const row = (d.supplements || []).find((x) => x.id === el.dataset.row);
              if (!row) return;
              row.order = order++;
              row.when = when;
            });
          });
        });
        rerender();
      };
      document.addEventListener('pointermove', move, { capture: true, passive: false });
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', finish, true);
    });
  });
}

let prnTimer = null;
let prnVisHandler = null;

/**
 * Advance the countdowns in place.
 *
 * Deliberately frugal: it runs ONLY while the page is visible and only while
 * something is actually counting down, and it stops itself once everything is
 * clear. A timer ticking behind a closed Safari costs battery and buys nothing,
 * and a full re-render every second would fight anything being typed. It also
 * touches no network, every value here is computed from data already on the
 * device.
 */
function startPrnTicker(root) {
  stopPrnTicker();

  const waiting = () => (state.data.prnMeds || []).some((m) => {
    const st = prnStatus(m);
    return st.last && !st.clear;
  });

  const tick = () => {
    const rows = root.querySelectorAll('[data-prn-row]');
    if (!rows.length) return stopPrnTicker();
    rows.forEach((el) => {
      const med = (state.data.prnMeds || []).find((m) => m.id === el.dataset.prnRow);
      if (!med) return;
      const st = prnStatus(med);
      const fill = el.querySelector('.prnfill');
      const status = el.querySelector('[data-prn-status]');
      if (fill) fill.style.setProperty('--p', prnPct(med, st).toFixed(3));
      el.classList.toggle('clear', st.clear || !st.last);
      el.classList.toggle('waiting', !!st.last && !st.clear);
      if (status && status.textContent !== prnWords(st)) status.textContent = prnWords(st);
    });
    // Everything clear: nothing left to count, so stop until a dose is logged.
    if (!waiting()) stopPrnTicker();
  };

  const resume = () => {
    clearInterval(prnTimer);
    prnTimer = null;
    if (document.visibilityState !== 'visible' || !waiting()) return;
    tick();
    // A minute is plenty: the shortest thing shown is minutes remaining.
    prnTimer = setInterval(tick, 60000);
  };

  prnVisHandler = resume;
  document.addEventListener('visibilitychange', prnVisHandler);
  resume();
}

function stopPrnTicker() {
  clearInterval(prnTimer);
  prnTimer = null;
  if (prnVisHandler) {
    document.removeEventListener('visibilitychange', prnVisHandler);
    prnVisHandler = null;
  }
}

/**
 * Close an item's open span at `iso` (forward only: earlier days keep it), and offer
 * Undo instead of asking first (Apple: no alert for an undoable action; 07 4.4). Undo
 * puts the spans back exactly as they were.
 */
function removeForward(listKey, id, iso, rerender) {
  const item = (state.data[listKey] || []).find((y) => y.id === id);
  if (!item) return;
  const before = normSpans(item).map((sp) => ({ ...sp }));
  update((d) => {
    const row = (d[listKey] || []).find((y) => y.id === id);
    if (row) row.spans = normSpans(row).map((sp) => (sp.until ? sp : { ...sp, until: iso }));
  });
  rerender();
  actionToast(`<b>${esc(item.name)} removed</b> <span>from ${esc(fmtDate(iso, 'short'))} on</span>`, 'Undo', () => {
    update((d) => {
      const row = (d[listKey] || []).find((y) => y.id === id);
      if (row) row.spans = before;
    });
    rerender();
  }, { key: `rm|${id}`, ms: 7000 });
}

// The page's current day, context and repaint, for the delegated handlers below (a patch
// can add a control without binding it, so the round 3 controls listen once, here).
const live = {};

/** "5 taken · Undo" after a bulk tick; Undo puts the day's ticks back exactly. */
function bulkToast(iso, before, n, rerender) {
  actionToast(`<b>${n} taken</b>`, 'Undo', () => {
    restoreTicks(iso, before);
    rerender?.({ soft: true });
  }, { key: `bulk|${iso}`, ms: 7000 });
}

/**
 * Mark all taken for one band (plan 1A, Apple Medications' "Log All as Taken"). On the
 * current day the time is `at` (now, or the widget tap's own moment); on another day the
 * ticks are "taken, time unknown", as a finger tick there is. Returns how many were ticked.
 */
export function markBand(iso, key, at = nowFor(iso), rerender = live.rerender) {
  const t = ticksOn(iso);
  const ids = counted(iso).filter((s) => bandOf(s) === key && !t[s.id]).map((s) => s.id);
  if (!ids.length) return 0;
  const before = tickMany(iso, ids, at);
  if (live.ctx && live.iso === iso) staggerFrom(ids, 'right');
  rerender?.({ soft: true });
  nHaptic('success');
  bulkToast(iso, before, ids.length, rerender);
  afterBulk(iso, key);
  return ids.length;
}

/**
 * A2: the Morning set at one instant (now, or a widget tap's own moment). Every unticked
 * item of the set, through the same write as a finger; the tiles fill one after another,
 * 40 ms apart, from the capsule's side. Returns how many were ticked.
 */
export function takeMorningSet(iso = currentDayIso(), at = nowFor(iso), rerender = live.rerender) {
  const set = morningSetFor(iso).ids;
  const t = ticksOn(iso);
  const ids = set.filter((id) => !t[id]);
  if (!ids.length) return 0;
  const before = tickMany(iso, ids, at);
  if (live.ctx && live.iso === iso) staggerFrom(ids, 'right');
  rerender?.({ soft: true });
  nHaptic('success');
  bulkToast(iso, before, ids.length, rerender);
  afterBulk(iso, 'morning');
  return ids.length;
}

function staggerFrom(ids, side) {
  const ctx = live.ctx;
  ctx.suppStagger = Object.fromEntries(ids.map((id, i) => [id, i * 40]));
  for (const id of ids) touchAt.set(id, side === 'right' ? [100, 0] : [0, 0]);
  setTimeout(() => { if (live.ctx === ctx) ctx.suppStagger = null; }, 60);
}

function afterBulk(iso, key) {
  if (live.iso !== iso) return;
  const s = suppScore(iso);
  if (s && s.taken === s.total && live.ctx) {
    live.ctx.suppGoldUntil = Date.now() + 1800;
    requestAnimationFrame(() => dayFinished(live.ctx, live.rerender));
  }
  requestAnimationFrame(() => live.settleIfDone?.(key));
}

/** Press and hold: a timer that fires once, cancelled by a move or a lift. */
function onHold(el, ms, fn) {
  let t = 0; let x = 0; let y = 0; let fired = false;
  el.addEventListener('pointerdown', (e) => {
    fired = false; x = e.clientX; y = e.clientY;
    clearTimeout(t);
    t = setTimeout(() => { fired = true; fn(e); }, ms);
  });
  const stop = () => clearTimeout(t);
  el.addEventListener('pointermove', (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // A held press is not also a tap.
  el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
}

// One delegated listener for the round 3 controls, set once (the view root survives repaints).
let delegated = false;
function delegate() {
  if (delegated) return;
  delegated = true;
  document.addEventListener('click', async (e) => {
    const page = e.target.closest?.('#view .rt-supps');
    if (!page || !live.ctx) return;
    const { iso, ctx, rerender } = live;
    // A strip segment: scroll to its tile and outline it once, turquoise (selected). No tick.
    let seg = e.target.closest('[data-seg]');
    // A tap in a gap of the strip: the nearest segment (the strip is one target, TS-13).
    const segs = !seg && e.target.closest('.rs-segs');
    if (segs) {
      let best = Infinity;
      for (const b of segs.querySelectorAll('[data-seg]')) {
        const r = b.getBoundingClientRect();
        const d = Math.abs(e.clientX - (r.left + r.width / 2));
        if (d < best) { best = d; seg = b; }
      }
    }
    if (seg) {
      const id = seg.dataset.seg;
      const band = counted(iso).find((s) => s.id === id);
      const k = band ? bandOf(band) : null;
      const go = () => {
        const tile = document.querySelector(`#view .rs-tile[data-row="${CSS.escape(id)}"]`);
        if (!tile) return;
        tile.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
        tile.classList.remove('seek');
        void tile.offsetWidth;
        tile.classList.add('seek');
        setTimeout(() => tile.classList.remove('seek'), 1400);
      };
      if (k && !groupOpen(ctx, k, iso)) {
        const head = document.querySelector(`#view [data-suppgroup="${k}"]`);
        if (head && live.setGroup) live.setGroup(head, true); else { ctx.suppOpen = { ...(ctx.suppOpen || {}), [k]: true }; rerender(); }
        setTimeout(go, 280);
      } else go();
      nHaptic('selection');
      return;
    }
    const more = e.target.closest('[data-bandmenu]');
    if (more) {
      const k = more.dataset.bandmenu;
      const items = [{ id: 'all', title: 'Mark all taken', symbol: 'checkmark.circle' }];
      // The Morning set is learned from his own ticks; when too little is learned yet
      // (fewer than two items), he can still choose it here.
      if (k === 'morning' && iso === currentDayIso() && collagenItem()) items.push({ id: 'mset', title: 'Choose Morning set', symbol: 'sunrise' });
      const pick = await menu({ items }, more);
      if (pick === 'all') { sfx('tick'); markBand(iso, k, nowFor(iso), rerender); }
      else if (pick === 'mset') msetMenu(more);
      return;
    }
    if (e.target.closest('[data-mset]')) { sfx('tick'); takeMorningSet(iso, nowFor(iso), rerender); return; }
    if (e.target.closest('[data-quietrow]')) { ctx.suppQuietOpen = !ctx.suppQuietOpen; rerender(); return; }
    const ask = e.target.closest('[data-quietask]');
    if (ask) {
      const ids = quietAsk(iso);
      if (!ids.length) return;
      if (ask.dataset.quietask === 'fold') {
        const prev = local.get('quiet', {}) || {};
        for (const id of ids) local.set(`quiet.${id}`, { since: iso });
        rerender();
        actionToast(`<b>${ids.length} folded</b> <span>into Now and then</span>`, 'Undo', () => {
          for (const id of ids) {
            if (prev[id]) local.set(`quiet.${id}`, prev[id]);
            else local.hide(`quiet.${id}`);
          }
          rerender();
        }, { key: 'quiet-fold', ms: 7000 });
      } else {
        for (const id of ids) local.set(`seen.quietAsk.${id}`, iso);
        rerender();
      }
    }
  });
}

/** A4, press and hold "Now and then": check or uncheck what is folded, with Undo. */
async function quietMenu(anchor) {
  const { iso, rerender } = live;
  const f = foldedIds();
  const rows = listFor(iso).filter((s) => f.has(s.id));
  const pick = await menu({ title: 'Now and then', items: rows.map((s) => ({ id: s.id, title: s.name, checked: true })) }, anchor);
  if (!pick) return;
  const was = local.get(`quiet.${pick}`);
  local.hide(`quiet.${pick}`);
  rerender();
  const name = rows.find((s) => s.id === pick)?.name || '';
  actionToast(`<b>${esc(name)}</b> <span>back in its band</span>`, 'Undo', () => { local.set(`quiet.${pick}`, { ...was, hidden: false }); rerender(); }, { key: `quiet|${pick}`, ms: 7000 });
}

/**
 * A2, press and hold the Morning set (or "Choose Morning set" in the Morning menu): each
 * candidate with a checkmark; a pick adds or drops it (his add and drop lists, device
 * store) and the menu comes back until he closes it. No Save button.
 */
async function msetMenu(anchor) {
  const { iso, rerender } = live;
  const col = collagenItem();
  for (let guard = 0; guard < 30; guard++) {
    const inSet = new Set(morningSetFor(iso).ids);
    const ms = local.get('morningSet', { add: [], drop: [] }) || { add: [], drop: [] };
    const added = new Set(ms.add || []);
    // Checked = in the set, or chosen by him even while the set is still under two items.
    const on = (id) => inSet.has(id) || added.has(id);
    // Morning and Anytime items only (an evening dose is never part of his morning), plus
    // anything already in the set; a name used twice says its band (r3 audit TS-12).
    const rows = listFor(iso).filter((s) => s.id !== col?.id && (bandOf(s) !== 'evening' || on(s.id)));
    const named = new Map();
    // Counted over the rows this menu SHOWS (round 3 leftovers): an evening dose the menu leaves out no longer
    // makes the morning one read "Name, morning".
    for (const s of rows) named.set(s.name, (named.get(s.name) || 0) + 1);
    const bandWord = (s) => (WHENS.find(([k]) => k === bandOf(s)) || [, ''])[1].toLowerCase();
    const items = rows.map((s) => ({ id: s.id, title: named.get(s.name) > 1 ? `${s.name}, ${bandWord(s)}` : s.name, checked: on(s.id) }));
    const pick = await menu({ title: 'Morning set', items }, anchor?.isConnected ? anchor : document.querySelector('#view [data-bandmenu="morning"], #view [data-mset]'));
    if (!pick) return;
    const add = new Set(ms.add || []);
    const drop = new Set(ms.drop || []);
    if (on(pick)) { add.delete(pick); drop.add(pick); } else { drop.delete(pick); add.add(pick); }
    local.set('morningSet', { add: [...add], drop: [...drop] });
    rerender({ soft: true });
  }
}

export function bindSupplements(root, ctx, rerender) {
  const iso = ctx.suppDate || currentDayIso();
  Object.assign(live, { iso, ctx, rerender });
  delegate();
  startPrnTicker(root);
  // Its own date, not the shared ctx.date: this is the one screen whose day
  // runs to 5am, and Today must stay on the real calendar date.
  // Back on the current supplement day it follows the clock again, so an app
  // left in memory overnight is not pinned to the day he last looked at.
  // A new day pushes in from the side he went (B5-5); a sideways swipe on the
  // title row moves a day.
  const toDay = (next) => {
    if (!next || next === iso) return;
    if (next > currentDayIso()) return;   // nothing to take on a day that has not come
    ctx.pushDir = next > iso ? 1 : -1;
    ctx.suppDate = next === currentDayIso() ? null : next;
    rerender();
  };
  root.querySelector('[data-nav="today"]')?.addEventListener('click', () => toDay(currentDayIso()));
  root.querySelectorAll('[data-sday]').forEach((b) => b.addEventListener('click', () => toDay(addDays(iso, Number(b.dataset.sday)))));
  const jump = root.querySelector('[data-jump]');
  root.querySelector('[data-supp-pick]')?.addEventListener('click', () => {
    if (!jump) return;
    try { jump.showPicker(); } catch { jump.focus(); jump.click(); }
  });
  jump?.addEventListener('change', (e) => { if (e.target.value) toDay(e.target.value); });
  onSwipe(root.querySelector(':scope > .supps-page > header.pagehead'), { left: () => toDay(addDays(iso, 1)), right: () => toDay(addDays(iso, -1)) });
  // Press and hold the title: the date picker (the lift is the gesture iOS needs to open it).
  const title = root.querySelector('[data-supp-title]');
  if (title && jump) {
    let t0 = 0;
    title.addEventListener('pointerdown', () => { t0 = performance.now(); });
    title.addEventListener('pointerup', () => {
      if (!t0 || performance.now() - t0 < 450) return;
      t0 = 0;
      nHaptic('medium');
      try { jump.showPicker(); } catch { jump.focus(); jump.click(); }
    });
    title.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  if (ctx.suppEdit) bindDragReorder(root, rerender);

  bindSuppGroups(root, iso, ctx, rerender);
  root.querySelectorAll('[data-mset]').forEach((b) => onHold(b, 500, () => { nHaptic('medium'); msetMenu(b); }));
  root.querySelectorAll('[data-quietrow]').forEach((b) => onHold(b, 500, () => { nHaptic('medium'); quietMenu(b); }));
  // Hold the Morning set: its tiles light up, so he sees exactly what one tap will tick.
  root.querySelectorAll('[data-mset]').forEach((b) => {
    const band = b.closest('.suppgroup');
    const on = () => root.querySelector('.rt-supps')?.classList.add('mset-peek');
    const off = () => root.querySelector('.rt-supps')?.classList.remove('mset-peek');
    b.addEventListener('pointerdown', on);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, off));
    void band;
  });

  root.querySelectorAll('[data-suppdel]').forEach((x) => x.addEventListener('click', (ev) => {
    ev.stopPropagation();
    removeForward('supplements', x.dataset.suppdel, iso, rerender);
  }));

  root.querySelector('[data-supp-edit]')?.addEventListener('click', () => {
    ctx.suppEdit = !ctx.suppEdit;
    rerender();
  });
  // One Add in Edit (07 4.4): a menu picks what kind.
  root.querySelector('[data-supp-add]')?.addEventListener('click', async (ev) => {
    const pick = await menu({ items: [
      { id: 'supp', title: 'Supplement', symbol: 'pills' },
      { id: 'prn', title: 'As needed medicine', symbol: 'cross.case' },
    ] }, ev.currentTarget);
    if (pick === 'supp') addSupplementSheet(iso, rerender);
    else if (pick === 'prn') addPrnSheet(iso, rerender);
  });

  root.querySelectorAll('[data-prndel]').forEach((x) => x.addEventListener('click', () => {
    removeForward('prnMeds', x.dataset.prndel, prnDateFor(iso), rerender);
  }));

  root.querySelectorAll('[data-prn-dose]').forEach((b) => b.addEventListener('click', () => {
    const med = (state.data.prnMeds || []).find((m) => m.id === b.dataset.prnDose);
    // The real calendar date, not the checklist's: a dose logged at 2am is
    // stamped with the clock's day, so the countdown measures from the moment
    // it actually happened.
    if (med) logDoseSheet(med, prnDateFor(iso), rerender);
  }));
}

// ---------------------------------------------------------------- sheets ---
function addSupplementSheet(iso, rerender) {
  openModal({
    title: 'Add supplement',
    body: `
      <label class="fld">Name<input id="sa-name" placeholder="Vitamin D" autocomplete="off"></label>
      <label class="fld" style="margin-top:.8rem">How often
        <select id="sa-often">
          <option value="once">Once a day</option>
          <option value="twice12">Twice a day, 12 hours apart</option>
        </select>
      </label>
      <label class="fld" style="margin-top:.8rem" data-sa-when>When
        <select id="sa-when">${WHENS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </label>
      <div class="tiny muted" style="margin-top:.8rem" data-sa-twice hidden>One in Morning, one in Evening.</div>
      <div class="tiny muted" style="margin-top:.4rem">From ${esc(fmtDate(iso, 'short'))} on. Earlier days stay as they are.</div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Add</button>',
    onMount(m) {
      const save = () => {
        const name = m.querySelector('#sa-name').value.trim();
        if (!name) return;
        const when = m.querySelector('#sa-when').value;
        const twice = m.querySelector('#sa-often').value === 'twice12';
        update((d) => {
          d.supplements = d.supplements || [];
          // Always a NEW row, even if the name already exists, the same
          // supplement is often taken morning AND evening, and merging them
          // made the second one silently move the first.
          const max = d.supplements.reduce((n, s) => Math.max(n, s.order ?? 0), -1);
          const spans = () => [{ from: iso, until: null }];
          if (twice) {
            d.supplements.push({ id: uid(), name, when: 'morning', gapHours: 12, order: max + 1, spans: spans() });
            d.supplements.push({ id: uid(), name, when: 'evening', gapHours: 12, order: max + 2, spans: spans() });
          } else {
            d.supplements.push({ id: uid(), name, when, order: max + 1, spans: spans() });
          }
        });
        closeModal(); rerender();
      };
      m.querySelector('[data-save]').addEventListener('click', save);
      m.querySelector('#sa-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      m.querySelector('#sa-often').addEventListener('change', (e) => {
        const twice = e.target.value === 'twice12';
        m.querySelector('[data-sa-when]').hidden = twice;
        m.querySelector('[data-sa-twice]').hidden = !twice;
      });
    },
  });
}

function addPrnSheet(iso, rerender) {
  openModal({
    title: 'Add as needed medicine',
    body: `
      <label class="fld">Start from
        <select id="pa-preset">
          <option value="">Type your own</option>
          ${PRN_PRESETS.map(([n, d, h], i) => `<option value="${i}">${esc(n)} ${esc(d)}, every ${h} h</option>`).join('')}
        </select>
      </label>
      <div class="grid2" style="margin-top:.8rem">
        <label class="fld">Name<input id="pa-name" placeholder="Naproxen" autocomplete="off"></label>
        <label class="fld">Usual dose<input id="pa-dose" placeholder="500mg" autocomplete="off"></label>
      </div>
      <label class="fld" style="margin-top:.8rem">Hours between doses
        <input id="pa-wait" type="number" inputmode="decimal" step="0.5" min="0" placeholder="8">
      </label>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Add</button>',
    onMount(m) {
      m.querySelector('#pa-preset').addEventListener('change', (e) => {
        const preset = PRN_PRESETS[Number(e.target.value)];
        if (!preset) return;
        m.querySelector('#pa-name').value = preset[0];
        m.querySelector('#pa-dose').value = preset[1];
        m.querySelector('#pa-wait').value = String(preset[2]);
      });
      m.querySelector('[data-save]').addEventListener('click', () => {
        const name = m.querySelector('#pa-name').value.trim();
        if (!name) return;
        update((d) => {
          d.prnMeds = d.prnMeds || [];
          const row = {
            id: uid(), name,
            dose: m.querySelector('#pa-dose').value.trim(),
            waitHours: Number(m.querySelector('#pa-wait').value) || 0,
            order: d.prnMeds.length,
            spans: [{ from: iso, until: null }],
          };
          d.prnMeds.push(row);
        });
        closeModal(); rerender();
      });
    },
  });
}

/**
 * Log one as-needed dose: the time is now and the dose his usual one, both editable
 * (he often logs after the fact). Early is said in one line, and logged anyway: every
 * dose belongs in the record. Today's doses are listed with Remove, which offers Undo
 * (a split dose is two entries, and stays two).
 */
function logDoseSheet(med, iso, rerender) {
  const st = prnStatus(med);
  const now = new Date();
  const todays = () => doses().filter((x) => x.medId === med.id && String(x.at).slice(0, 10) === iso)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const list = () => {
    const rows = todays();
    if (!rows.length) return '';
    return `<div class="rs-doses"><div class="rs-doses-h">${iso === todayIso() ? 'Today' : esc(fmtDate(iso, 'short'))}${rows.length > 1 && totalFor(rows) ? ` <span>${esc(totalFor(rows).replace(/^= /, ''))}</span>` : ''}</div>
      ${rows.map((x) => `<div class="rs-dose"><b>${esc(time12(new Date(x.at)))}</b><span>${esc(x.dose || '')}</span>
        <button type="button" class="rs-doserm" data-dosedel="${esc(x.id)}" aria-label="Remove the dose at ${esc(time12(new Date(x.at)))}">Remove</button></div>`).join('')}</div>`;
  };
  openModal({
    title: med.name,
    body: `
      ${!st.clear ? `<div class="rs-early">${esc(humanLeft(st.msLeft))} early. Clear at ${esc(time12(st.nextAt))}.</div>` : ''}
      <div class="grid2">
        <label class="fld">Time<input id="pd-time" type="time" value="${esc(hhmm(now))}"></label>
        <label class="fld">Dose<input id="pd-dose" value="${esc(med.dose || '')}" autocomplete="off"></label>
      </div>
      <div data-dose-list>${list()}</div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Log dose</button>',
    onMount(m) {
      const bindList = () => m.querySelectorAll('[data-dosedel]').forEach((c) => c.addEventListener('click', () => {
        const gone = doses().find((x) => x.id === c.dataset.dosedel);
        if (!gone) return;
        update((d) => { d.doses = (d.doses || []).filter((x) => x.id !== gone.id); });
        m.querySelector('[data-dose-list]').innerHTML = list();
        bindList();
        rerender();
        // Undo puts the same dose back under a new id (the old id carries its tombstone).
        actionToast(`<b>Dose removed</b> <span>${esc(time12(new Date(gone.at)))}</span>`, 'Undo', () => {
          update((d) => { d.doses = (d.doses || []).concat({ ...gone, id: uid() }); });
          rerender();
        }, { key: `dose|${gone.id}`, ms: 7000 });
      }));
      bindList();
      m.querySelector('[data-save]').addEventListener('click', () => {
        const [hh, mm] = (m.querySelector('#pd-time').value || hhmm(now)).split(':').map(Number);
        // 23:30 picked at 00:15 means last night, never tonight (2026-09-23
        // audit): a future time on today's date would read as the latest dose.
        const [y, mo, d] = iso.split('-').map(Number);
        const day = iso === todayIso() && new Date(y, mo - 1, d, hh, mm) > new Date(Date.now() + 60000)
          ? addDays(iso, -1) : iso;
        const at = `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
        const id = uid();
        update((dd) => {
          dd.doses = dd.doses || [];
          dd.doses.push({ id, medId: med.id, at, dose: m.querySelector('#pd-dose').value.trim() });
        });
        closeModal();
        const after = prnStatus(med);
        rerender();
        actionToast(after.clear
          ? `<b>${esc(med.name)} logged</b>`
          : `<b>${esc(med.name)} logged</b> <span>clear at ${esc(time12(after.nextAt))}</span>`, 'Undo', () => {
          update((dd) => { dd.doses = (dd.doses || []).filter((x) => x.id !== id); });
          rerender();
        }, { key: `logged|${med.id}`, ms: 6000 });
      });
    },
  });
}
