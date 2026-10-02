// The medication level tab (2026-09-19), a section of Progress beside Clinical.
//
// Three parts: Level (how much of the drug is in the body now and over time,
// with every logged shot), Cravings (one tap a day, set against the level) and
// Schedules (steady state peak and trough of any dosing pattern, with the pen
// and cost arithmetic kept apart from the model).
//
// Everything specific (the drug, its published model and sources, his shots,
// pens, prices and schedules) is synced data under `pk`. This file only draws
// it; the arithmetic is js/pk.js. With no drug in the data the tab is absent.

import { esc, todayIso, addDays, fromIso, toIso, uid, toKg, round } from '../util.js';
import { state, update, addMeasurement, latest, allMeasurements, syncBodyweightSetting } from '../store.js';
import { ringReady, shotNightEffect, shotSentence, ringNights, windowMedian } from '../ring.js';
import { FIRST_ITEMS, anchorFirst } from '../firstup.js';
import { plannedOn } from '../../data/program.js';
import { holdScrub, userX } from '../glp1/scrub.js';
import { localGet, localSet } from '../glp1/local.js';
import { kitChart, bindKitCharts } from './pkit.js';
import { openModal, closeModal, toast, actionToast } from '../components.js';
import { bodyweightKg } from '../goals.js';
import { liteMotion } from '../motion.js';
import { reducedMotion } from '../fold.js';
import { personParams, simulate, at, steadyState, spread, penMath, bestCut, terminalHalfLife, MS } from '../pk.js';
import { nativeFirst, pickFrom, tick, cssColour } from '../glp1/ask.js';
// sfx('logsaved'): the sound map's row for a log saved (weight, craving, event, shot), from his tap; silent in Classic
import { sfx } from '../feedback.js';
import { G } from '../glp1/glyphs.js';
import { loadFood, foodFor, foodReady, foodBuiltAt, syncFood, waitForFood, foodWaiting, FOOD_MAC_MINUTES } from '../food.js';

const { HOUR, DAY } = MS;
const PARTS = [['level', 'Level'], ['cravings', 'Cravings'], ['schedules', 'What If']];
const RANGES = [['2w', '2W'], ['1m', '1M'], ['3m', '3M'], ['all', 'All']];
// Five steps, his call 2026-09-20: three was too coarse to choose between.
// The old three-step values were doubled in his data at the same time, so
// None, Some and Strong kept their meaning as 0, 2 and 4.
const CRAVE = [[0, 'None'], [1, 'Slight'], [2, 'Some'], [3, 'Strong'], [4, 'Severe']];
const CRAVE_TOP = CRAVE.length - 1;
// His day notes (2026-09-24) kept recording the same things in free text; each is
// a tag now. A tap adds one, so Nausea tapped three times reads as three bouts and
// the note says what set each off. Stored as counts in `feel[iso].tags`.
const TAGS = [['nausea', 'Nausea'], ['energy', 'Low energy'], ['fullfast', 'Full fast'], ['pastfull', 'Ate past full'],
  ['gap', 'Long gap without food'], ['big', 'Big meal'], ['easy', 'Settled easily'], ['stuck', 'Stuck'],
  ['travel', 'Travel'], ['fasting', 'Fasting']];
// When the craving hit, roughly: he logs from memory at the end of the day.
const WHEN = [['am', 'Morning'], ['pm', 'Afternoon'], ['eve', 'Evening'], ['night', 'Night']];
// The day timeline (his ask, 2026-09-28, after reading his notes: nearly every
// note was "this happened at this time, after that"). Each symptom is an event
// with its own time; the rarer ones sit in a More menu. `tags` and `when` from
// before this are kept as they were and shown read only (his rule: keep the
// legacy entries intact).
const EVENTS = [['crave', 'Craving'], ['nausea', 'Nausea'], ['headache', 'Headache'], ['tired', 'Tired or nap'], ['ate', 'Ate']];
const EV_NAME = Object.fromEntries(EVENTS);
const EV_SYMBOL = { headache: 'bolt', tired: 'bed.double', ate: 'fork.knife' };   // SF Symbols for the native More menu
const QUICK = ['crave', 'nausea'];
const FLAGS = [['gap', 'Long gap before food'], ['ordered', 'Ordered in'], ['impulse', 'Impulse order'], ['late', 'Ate after 11pm'],
  ['pastfull', 'Ate past full']];   // Full fast, Fasting and Travel dropped (his call, 2026-09-28)
const FLAG_NAME = Object.fromEntries(FLAGS);
const DAYPART = [['wake', 'On waking'], ['am', 'Morning'], ['pm', 'Afternoon'], ['eve', 'Evening'], ['night', 'Night']];
const PART_NAME = Object.fromEntries(DAYPART);
const PART_MIN = { wake: 360, am: 540, pm: 840, eve: 1140, night: 1410 };
const SETTLED = [['water', 'Water'], ['drink', 'Tea or coffee'], ['shake', 'Shake'], ['food', 'Food'], ['passed', 'Passed by itself'], ['none', 'Did not settle']];
const STRENGTH = [['mild', 'Mild'], ['strong', 'Strong']];
const AFTER_GAP = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours+']];
const partOfTime = (t) => { const h = Number(String(t).slice(0, 2)); return h < 5 ? 'night' : h < 12 ? 'am' : h < 17 ? 'pm' : h < 22 ? 'eve' : 'night'; };
const evMinutes = (e) => { if (e.t) { const [h, m] = e.t.split(':').map(Number); return (h < 5 ? h + 24 : h) * 60 + m; } return PART_MIN[e.part] ?? 720; };
// The day runs 5 am to 5 am (the band). Between midnight and 5 am the band still
// running is yesterday's, so an event logged "now" then belongs to yesterday's date
// (evMinutes draws 00:00 to 05:00 at the END of a band). 2026-09-30 audit B2.
const bandDay = () => (new Date().getHours() < 5 ? addDays(todayIso(), -1) : todayIso());
/** Is this the day a "now" log lands on (the running band, or the calendar today)? */
const isLiveDay = (iso) => iso === todayIso() || iso === bandDay();
/** The date an event is stored under: a time before 5 am on the calendar today is yesterday's band. */
const eventDay = (iso, t) => (iso === todayIso() && typeof t === 'string' && Number(t.slice(0, 2)) < 5 ? addDays(iso, -1) : iso);
let pendingDay = null;   // a log that landed on another date shows that date on the next paint
const clock = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? '\u00a0AM' : '\u00a0PM'}`; };
/** A feel record with nothing left in it is removed, never kept empty. */
const feelEmpty = (f) => f.c == null && !f.note && !Object.keys(f.tags || {}).length && !(f.when || []).length
  && !(f.ev || []).length && !(f.flags || []).length;
// Injection sites, per the pen's Instructions for Use: the stomach at
// least 2 inches from the belly button, the thigh, or the back of the upper arm
// (given by someone else). The stomach is eight spots around the navel, which
// is drawn but never offered. His left is always on the left (his rule).
const ROWS3 = [['u', 'Upper'], ['m', 'Middle'], ['l', 'Lower']];
const COLS3 = [['l', 'Left'], ['m', 'Middle'], ['r', 'Right']];
const stomachKey = (r, c) => (r === 'm' && c === 'm' ? 'stomach-c' : `stomach-${r}${c}`);
const SITES = [
  ...ROWS3.flatMap(([r, rl]) => COLS3.filter(([c]) => !(r === 'm' && c === 'm')).map(([c, cl]) => [stomachKey(r, c), 'Stomach', `${rl} ${cl.toLowerCase()}`])),
  ['thigh-l', 'Thigh', 'Left'], ['thigh-r', 'Thigh', 'Right'],
  ['arm-l', 'Arm', 'Left'], ['arm-r', 'Arm', 'Right'],
];
const SITE_NAME = Object.fromEntries(SITES.map(([k, a, b]) => [k, a === 'Stomach' ? `Stomach ${b.toLowerCase()}` : `${b} ${a.toLowerCase()}`]));

// Per device conveniences, never synced.
const LS = 'rehab.pk.';
const lsGet = (k, d) => { try { const v = localStorage.getItem(LS + k); return v === null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(LS + k, v); } catch { /* ignore */ } };

// update() stamps, saves and repaints the header only; views repaint
// themselves after a write (review 2026-09-19: a tap that does not show
// invites a second tap, which toggles a craving back off).
let repaint = () => {};
function save(fn) { update(fn); repaint(); }
/** A later time, stepping whole calendar days in local time, so a projected
 * shot keeps its clock time across a daylight saving change. */
function later(t, days) {
  const whole = Math.floor(days);
  const d = new Date(t);
  d.setDate(d.getDate() + whole);
  return d.getTime() + (days - whole) * DAY;
}

// ------------------------------------------------------------------ data --
const pkDoc = () => state.data.pk || { drugs: {}, shots: {}, feel: {}, plans: {}, pens: {} };
function prefs() {
  return { rangeMin: 75, rangeMax: 155, everyDays: 7, windowDays: 30, primeClicks: 2, freePrimes: 5, ...(state.data.settings.pk || {}) };
}
function activeDrug() {
  const drugs = pkDoc().drugs || {};
  const id = prefs().drug && drugs[prefs().drug] ? prefs().drug : Object.keys(drugs)[0];
  return id ? { id, ...drugs[id] } : null;
}
/** The tab's label, or null when there is nothing to show (no tab at all). */
export function medTabLabel() {
  const d = activeDrug();
  return d && d.model ? (d.tab || d.name || 'Medication') : null;
}
function body() {
  return { wtKg: bodyweightKg() || null, htCm: Number(prefs().heightCm) || null, sex: state.data.settings.sex === 'F' ? 'F' : 'M' };
}
function shotsOf(drugId, { removed = false } = {}) {
  return Object.entries(pkDoc().shots || {})
    .map(([id, s]) => ({ id, ...s, t: Date.parse(s.at) }))
    .filter((s) => Number.isFinite(s.t) && (s.drug || drugId) === drugId && !!s.removed === removed)
    .sort((a, b) => a.t - b.t);
}
const plans = () => Object.entries(pkDoc().plans || {}).map(([id, p]) => ({ id, ...p }))
  .filter((p) => p.mg > 0 && p.everyDays > 0 && !p.hidden && !p.route)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.everyDays - b.everyDays || a.mg - b.mg);
// Routes (his ask, 2026-09-28): a dated run of shots, then a steady schedule
// from the last of them, drawn on Compare > From today beside his switch.
// Stored in pk.plans with `route: [{ at, mg }]`, so they sync like schedules.
const routes = () => Object.entries(pkDoc().plans || {}).map(([id, p]) => ({ id, ...p }))
  .filter((p) => Array.isArray(p.route) && p.route.length && !p.hidden)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
const pens = () => Object.entries(pkDoc().pens || {}).map(([id, p]) => ({ id, ...p }))
  .filter((p) => p.mg > 0 && p.price > 0).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

// --------------------------------------------------------------- formats --
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mgStr = (v) => `${+Number(v).toFixed(3)}`;
const r0 = (v) => Math.round(v);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mon = (d) => MON[d.getMonth()];
const dayName = (ms) => { const d = new Date(ms); return `${WD[d.getDay()]} ${mon(d)} ${d.getDate()}`; };
/** today, tomorrow or yesterday in lower case; a weekday keeps its capital. */
// Six or more days away the weekday alone reads as this week ("Next shot, Tue"
// on a Tuesday), so it carries its date (2026-09-22 audit).
const farOff = (ms) => Math.abs(ms - Date.now()) >= 6 * 864e5;
const dayLc = (ms) => { const r = relDays(ms); return ['today', 'tomorrow', 'yesterday'].includes(r) ? r : farOff(ms) ? dayName(ms) : WD[new Date(ms).getDay()]; };
/** Today, Tomorrow, or the weekday, for a time within the coming week. */
const dayWord = (ms) => { const r = relDays(ms); return r === 'today' || r === 'tomorrow' || r === 'yesterday' ? cap(r) : WD[new Date(ms).getDay()]; };
// One clock style on every GLP-1 screen (audit d-glp1-27), and since the round 3 consistency
// pass (2026-09-30) the same one as the rest of the app (Today, Supplements, the player):
// "9 PM", "11:52 PM", with a no break space so the AM or PM never wraps alone.
const clockOf = (ms, withMin = true) => { const d = new Date(ms); const h = d.getHours(), mi = d.getMinutes(); return `${((h + 11) % 12) + 1}${withMin && mi ? `:${String(mi).padStart(2, '0')}` : ''}${h < 12 ? '\u00a0AM' : '\u00a0PM'}`; };
const timeName = (ms) => clockOf(ms, true);
const hourName = (ms) => clockOf(ms, false);
const money = (v) => (v == null ? '·' : `$${v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(2)}`);
const isoOf = (ms) => toIso(new Date(ms));
const midnight = (iso) => fromIso(iso).getTime();
function relDays(ms, now = Date.now()) {
  const d = Math.round((midnight(isoOf(ms)) - midnight(isoOf(now))) / DAY);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

// ----------------------------------------------------------------- model --
let cache = { key: '', val: null };
function model() {
  const drug = activeDrug();
  if (!drug || !drug.model) return null;
  const p = prefs();
  const b = body();
  const shots = shotsOf(drug.id);
  const now = Date.now();
  const key = JSON.stringify([drug.model, drug.ref, b, p.everyDays, p.sw || null, routeRec(p), plans().map((x) => [x.id, x.mg, x.everyDays]), shots.map((s) => [s.id, s.t, s.mg, s.site, s.timeKnown, s.note]), Math.floor(now / (5 * 60e3))]);   // every shown field, so an edited site shows at once
  if (cache.key === key) return cache.val;

  const params = personParams(drug.model, b);
  const ref = drug.ref || { mg: 5, everyDays: 7 };
  const refSS = steadyState(params, ref.mg, ref.everyDays);
  const last = shots[shots.length - 1] || null;
  const every = Number(p.everyDays) || 7;
  const t0 = shots.length ? shots[0].t - 2 * DAY : now - 30 * DAY;
  const t1 = Math.max(now, last ? last.t : now) + 84 * DAY;
  const proj = [];
  if (last) {
    // The projection draws only doses still ahead (round 3 leftovers, 2026-09-30). A planned dose
    // that has passed with no shot logged is NOT drawn as taken at Now: the level stays what his
    // logged shots make it, and the shot day card names the missed dose (shotDue / plannedMissed).
    let t = later(last.t, every);
    while (t < now) t = later(t, every);
    while (t < t1) { proj.push({ t, mg: last.mg, proj: true }); t = later(t, every); }
  }
  const logged = simulate(params, shots, t0, t1);
  const withNext = simulate(params, [...shots, ...proj], t0, t1);
  const band = shots.length ? spread(drug.model, b, [...shots, ...proj], t0, t1) : null;
  // When the projected shots have settled: the low before each shot is within
  // 2% of the settled low of this dose and interval, and stays there.
  let settledAt = null;
  if (last && proj.length) {
    const target = steadyState(params, last.mg, every).trough;
    const lows = proj.map((x) => ({ t: x.t, v: at(withNext, x.t - 60e3) }));
    for (let k = lows.length - 1; k >= 0; k--) {
      if (Math.abs(lows[k].v - target) / target > 0.02) { settledAt = lows[k + 1]?.t ?? null; break; }
      if (k === 0) settledAt = lows[0].t;
    }
  }
  const val = { drug, params, ref, refAvg: refSS.avg, shots, proj, last, every, now, t0, t1, logged, withNext, band, body: b, settledAt };
  // His planned switch (settings.pk.sw) is the future when one is set: the
  // projection follows it, not the current dose forever (his report,
  // 2026-09-28: "the future part is not reflecting my plan").
  const sw = last ? switchLine(val, plans(), p) : null;
  if (sw) {
    const sproj = [...sw.cur.map((x) => ({ t: x.t, mg: x.mg, proj: true, ...(x.due != null ? { due: x.due } : {}) })),
      ...sw.after.map((x, i) => ({ t: x, mg: sw.afterMg ? sw.afterMg[i] : i === 0 ? sw.first : sw.target.mg, proj: true, ...(sw.afterDue && sw.afterDue[i] != null ? { due: sw.afterDue[i] } : {}) }))];
    const st1 = Math.max(t1, sw.land + 8 * 7 * DAY);
    const sp = sproj.filter((x) => x.t < st1);
    const sNext = simulate(params, [...shots, ...sp], t0, st1);
    const target = steadyState(params, sw.target.mg, sw.target.everyDays).trough;
    const lows = sp.filter((x) => x.t >= sw.land).map((x) => ({ t: x.t, v: at(sNext, x.t - 60e3) }));
    let sAt = null;
    for (let k = lows.length - 1; k >= 0; k--) {
      if (Math.abs(lows[k].v - target) / target > 0.02) { sAt = lows[k + 1]?.t ?? null; break; }
      if (k === 0) sAt = lows[0].t;
    }
    Object.assign(val, {
      proj: sp, t1: st1, withNext: sNext, logged: simulate(params, shots, t0, st1),
      band: shots.length ? spread(drug.model, b, [...shots, ...sp], t0, st1) : null,
      settledAt: sAt, plan: { mg: sw.target.mg, every: sw.target.everyDays, land: sw.land },
    });
  }
  cache = { key, val };
  return val;
}
const pctAt = (M, sim, t) => (at(sim, t) / M.refAvg) * 100;

/** His logged weights, in pounds, oldest first (the app's bodyweight records). */
function weightPoints() {
  return allMeasurements()
    .filter((m) => m.measure === 'bodyweight' && Number(m.value) > 0 && m.date)
    .map((m) => ({ iso: m.date, t: midnight(m.date) + 12 * HOUR, lb: toKg(Number(m.value), m.unit || state.data.settings.weightUnit || 'kg') * 2.2046226218 }))
    .sort((a, b) => a.t - b.t);
}

/** Mean level (% of reference) over one calendar day, from logged shots only. */
function dayLevel(M, iso) {
  if (!M.shots.length) return null;   // no shot logged: no level, not 0% (2026-09-22)
  const a = midnight(iso), b = midnight(addDays(iso, 1));
  if (b <= M.t0 || a >= M.t1) return null;
  let s = 0, n = 0;
  for (let t = a; t < b; t += HOUR) { s += pctAt(M, M.logged, t); n++; }
  return s / n;
}
/** Calendar days since the most recent shot on or before that day. */
function cycleDay(M, iso) {
  const end = midnight(addDays(iso, 1));
  const prior = M.shots.filter((s) => s.t < end && !s.removed);
  if (!prior.length) return null;
  const s = prior[prior.length - 1];
  return Math.round((midnight(iso) - midnight(isoOf(s.t))) / DAY);
}

// His own markers (2026-09-24): what his log says about levels, drawn on What If.
/** The lowest level he spent a day awake (8am to 10pm), from logged shots. */
function dayLow(M, iso) {
  if (!M.shots.length) return null;
  const a = midnight(iso) + 8 * HOUR, b = midnight(iso) + 22 * HOUR;
  if (b <= M.t0 || a >= M.t1) return null;
  let lo = Infinity;
  for (let t = a; t <= b; t += HOUR) lo = Math.min(lo, pctAt(M, M.logged, t));
  return lo;
}
/** The highest level his logged shots have reached, up to now. */
function highestSoFar(M) {
  if (!M.shots.length) return null;
  let best = null;
  for (let t = M.shots[0].t; t <= M.now; t += HOUR) {
    const v = pctAt(M, M.logged, t);
    if (!best || v > best.v) best = { v, t };
  }
  return best;
}
/** A day the craving got the better of him: Strong or worse, or tagged Stuck. */
const hardDay = (f) => !!f && ((f.c != null && f.c >= 3) || ((f.tags || {}).stuck > 0)
  || (f.ev || []).some((e) => e.k === 'crave' && (e.by === 'none' || e.c >= 3)));
/** A calm day: None or Slight, or settled easily, and never Stuck. */
const calmDay = (f) => !!f && !hardDay(f) && ((f.c != null && f.c <= 1) || ((f.tags || {}).easy > 0)
  || (f.ev || []).some((e) => e.k === 'crave' && e.by && e.by !== 'none'));
/** Logged days with their lowest waking level, marked hard or calm. */
function feelLows(M) {
  return Object.entries(pkDoc().feel || {})
    .map(([iso, f]) => ({ iso, f, low: dayLow(M, iso), hard: hardDay(f), calm: calmDay(f) }))
    .filter((r) => r.low != null && (r.hard || r.calm) && r.iso <= todayIso());
}

// ---------------------------------------------------------------- render --
export function renderMedLevel(ctx) {
  if (pendingDay) { ctx.pkDay = pendingDay; if (ctx.pkWeekEnd && ctx.pkWeekEnd < pendingDay) ctx.pkWeekEnd = pendingDay; pendingDay = null; }
  chartState = null;
  compareState = null;
  bandState = null;
  const M = model();
  if (!M) return '<div class="empty">No medication set up.</div>';
  const part = ctx.pkPart || 'level';
  const T = tier();
  paintedInner = viewBox().inner;
  return `<div class="stack pk${T ? ` wide${T > 1 ? ' xwide' : ''}` : ''}" data-g1-tier="${T}">
    ${shotDayCard(M)}
    <div class="tabrow subtabs" role="tablist" aria-label="${esc(M.drug.tab || M.drug.name)}">
      ${PARTS.map(([k, l]) => `<button class="btn sm ${part === k ? 'primary' : ''}" data-pkpart="${k}" role="tab" aria-selected="${part === k}">${l}</button>`).join('')}
    </div>
    ${part === 'level' ? renderLevel(M, ctx) : ''}
    ${part === 'cravings' ? renderCravings(M, ctx) : ''}
    ${part === 'schedules' ? renderSchedules(M, ctx) : ''}
  </div>`;
}

// ................................................................ Level ..
// Rehab Test v3 (2026-09-30): the level curve is the page. His words that night:
// the chart has good content but "does not use horizontal or vertical space", and
// the zoom screen and slider "was all a workaround interface for a web app". So:
// the hero number, then the curve edge to edge (at least 360 by 300 pt, fully on
// screen when the tab opens), one glass range capsule, press and drag to read any
// hour, and a tap opens the native full screen chart where the app has one.
// His chart rules (RUBRIC section 10, 2026-09-28) are kept line for line below.

/** The width inside #view's padding, and whether the chart runs to the screen's edges. */
function viewBox() {
  try {
    const v = document.getElementById('view');
    const cs = getComputedStyle(v);
    const inner = v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const bleed = document.body.classList.contains('mobile') && window.innerWidth <= 560;
    return { inner: Math.max(260, Math.round(inner)), bleed, pad: parseFloat(cs.paddingLeft) || 16 };
  } catch { return { inner: 361, bleed: true, pad: 16 }; }
}

// ---- The iPad (2026-09-30, his words: the iPad layout "should probably be a bit more robust and
// capable than the iPhone one, or at least show things at a lot easier flow because it's such a
// big screen"; his device rule: iPad and Mac get the FULL app, the iPhone is for logging).
// Regular width is decided HERE, from the width of #view, and written to the page as a class
// (`.pk.wide`, `.pk.xwide`) so the script that sizes the charts and the CSS that places them can
// never disagree. Phone widths (under 700, or a window 560 wide or less) get tier 0: the markup and
// every size below are then exactly what the phone always had. Tier 1 is 700 to 959 wide (an 11
// inch iPad upright, Split View), tier 2 is 960 and up (landscape, the Mac). Every column width is
// computed by these functions AND set on its grid as a custom property, so a chart is drawn at
// the width of the column that holds it. A resize across a tier, or a change over 12 pt, repaints.
const WIDE_MIN = 700, XWIDE_MIN = 960, COL_GAP = 24;
/** The facts column beside the Level chart: 272 upright, 304 on its side. */
const levelSide = () => (tier() === 2 ? 304 : 272);
function tier() {
  const vb = viewBox();
  return vb.bleed ? 0 : vb.inner >= XWIDE_MIN ? 2 : vb.inner >= WIDE_MIN ? 1 : 0;
}
/** The width a chart may use in its column, per layout role; on a phone it is the whole width. */
function colW(role) {
  const vb = viewBox();
  if (!tier()) return vb.inner;
  const gap = COL_GAP;
  if (role === 'level') return vb.inner - levelSide() - gap;
  if (role === 'half') return Math.floor((vb.inner - gap) / 2);
  if (role === 'crave') return Math.floor((vb.inner - gap) * (tier() === 2 ? 0.56 : 0.58));
  if (role === 'whatif') return Math.floor((vb.inner - gap) * (tier() === 2 ? 0.6 : 0.58));
  return vb.inner;
}
let paintedInner = 0, resizeFrame = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (!document.querySelector('#view .pk')) return;
      const inner = viewBox().inner;
      if (Math.abs(inner - paintedInner) > 12 && (inner >= WIDE_MIN || paintedInner >= WIDE_MIN)) repaint();
    });
  });
}

function renderLevel(M, ctx) {
  const p = prefs();
  const now = M.now;
  const pct = pctAt(M, M.logged, now);
  const next = M.last ? (M.plan && M.proj.length ? M.proj[0].t : later(M.last.t, M.every)) : null;
  const late = next != null && next < now - HOUR;

  // When the level drops under his floor, on the shots logged so far.
  let floorT = null;
  if (M.last && pct >= p.rangeMin) {
    let t = now;
    while (t < M.t1 && pctAt(M, M.logged, t) >= p.rangeMin) t += HOUR;
    floorT = t;
  }
  // This shot's peak.
  let peak = 0, peakAt = null;
  if (M.last) {
    for (let t = M.last.t; t <= M.last.t + M.every * DAY; t += HOUR) {
      const v = pctAt(M, M.logged, t);
      if (v > peak) { peak = v; peakAt = t; }
    }
  }
  const b = M.body;
  const lb = b.wtKg ? Math.round(b.wtKg * 2.2046226218) : null;
  const nextWord = !next ? '' : late ? 'Due now' : dayWord(next);
  const nextTime = !next || late ? '' : timeName(next).replace(':00', '');
  const about = `100% is the average on ${mgStr(M.ref.mg)} mg every ${M.ref.everyDays} days, at ${lb ? `${lb} lb` : `a typical ${M.drug.model.refWt || 70} kg`}${b.htCm ? ` and ${b.htCm} cm` : ''}.`;

  // Two facts of this cycle, one line, no boxes (the three look alike tiles went,
  // design language Never 3). The model's own facts stay in the fold at the end.
  const facts = [];
  if (peakAt) facts.push(['up', peakAt > now ? 'Peak' : 'Peaked', `${r0(peak)}%`, `${dayWord(peakAt)} ${hourName(peakAt)}`]);
  if (M.last) facts.push(['down', `Under ${p.rangeMin}%`, pct < p.rangeMin ? 'Now' : dayWord(floorT), pct < p.rangeMin ? '' : hourName(floorT)]);

  const factHtml = facts.length ? `<div class="g1-facts">${facts.map(([g, k, v, s]) => `<div class="g1-fact"><i class="g1-fg ${g}">${G[g]}</i><span><small>${esc(k)}</small><b>${esc(v)}${s ? ` <em>${esc(s)}</em>` : ''}</b></span></div>`).join('')}</div>` : '';
  // Regular width (iPad, Mac): the chart beside a column of facts, the two logs side by side, the
  // model's reference folded at the end. Same pieces as the phone, placed differently; the
  // phone below is byte for byte what it was.
  if (tier()) {
    return `
  <section class="g1-level${shotDayOpen(M) ? ' sdopen' : ''}" data-g1-level>
    <div class="g1-head">
      <div class="g1-hero">
        <b class="g1-num" data-g1-num>${r0(pct)}<small>%</small></b>
        <span class="g1-sub"><span data-g1-sub>${M.last ? heroSub(M, now) : 'No shot logged yet'}</span>
          <button type="button" class="g1-info" data-g1-about aria-label="What 100% means" aria-expanded="false">${G.info}</button></span>
      </div>
      ${next && !shotDayOpen(M) ? `<div class="g1-next${late ? ' late' : ''}"><small>Next shot</small><b>${esc(nextWord)}</b>${nextTime ? `<span>${esc(nextTime)}</span>` : ''}</div>` : ''}
    </div>
    <p class="g1-about" data-g1-abouttext hidden>${esc(about)}</p>
    <div class="g1-lvgrid" style="--side:${levelSide()}px;--gap:${COL_GAP}px">
      <div class="g1-lvmain" data-g1-col="level">${levelChart(M, ctx)}</div>
      <aside class="g1-lvside">${factHtml}${runwayLine(M)}${shotNightTile(M)}</aside>
    </div>
  </section>
  <div class="g1-logs" style="--gap:${COL_GAP}px">${shotList(M)}${weightList()}</div>
  ${modelTiles(M)}`;
  }
  return `
  <section class="g1-level${shotDayOpen(M) ? ' sdopen' : ''}" data-g1-level>
    <div class="g1-head">
      <div class="g1-hero">
        <b class="g1-num" data-g1-num>${r0(pct)}<small>%</small></b>
        <span class="g1-sub"><span data-g1-sub>${M.last ? heroSub(M, now) : 'No shot logged yet'}</span>
          <button type="button" class="g1-info" data-g1-about aria-label="What 100% means" aria-expanded="false">${G.info}</button></span>
      </div>
      ${next && !shotDayOpen(M) ? `<div class="g1-next${late ? ' late' : ''}"><small>Next shot</small><b>${esc(nextWord)}</b>${nextTime ? `<span>${esc(nextTime)}</span>` : ''}</div>` : ''}
    </div>
    ${runwayLine(M)}
    <p class="g1-about" data-g1-abouttext hidden>${esc(about)}</p>
    ${levelChart(M, ctx)}
    ${factHtml}
  </section>
  ${shotList(M)}
  ${weightList()}
  ${shotNightTile(M)}
  ${modelTiles(M)}`;
}

/**
 * Under the hero number: which way the level is going, and where that moment sits in the
 * cycle. Percent only (audit d-glp1-40: he reads percent; mg and ng/mL went from the hero,
 * the model's own units stay in the fold at the end).
 */
function heroSub(M, t) {
  // Up to now only what he logged counts: a planned dose that is due (moved to now) is not
  // a shot he took, so it never turns the level "Rising" or starts a new day count.
  const past = t <= M.now + 60e3;
  const sim = past ? M.logged : M.withNext;
  const dir = pctAt(M, sim, t + HOUR) > pctAt(M, sim, t) ? 'Rising' : 'Falling';
  const prev = (past ? M.shots : [...M.shots, ...M.proj]).filter((s) => s.t <= t).pop();
  if (!prev) return dir;
  return `${dir} · ${afterShot(prev, t)}`;
}
/** "day 1.1 after a planned shot": the hero and the chart callout say it the same way. */
function afterShot(prev, t) {
  const d = (t - prev.t) / DAY;
  return `${d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `day ${d.toFixed(1)}`} after ${prev.proj ? 'a planned shot' : 'a shot'}`;
}

// ....................................... Shot day card and pen runway (A10) ..
// Round 3 feature A10 (research 11, section A), for his Sunday plan: "So that I can take my
// weekly injection on Sundays." (2026-09-24). Only on this tab: never on Today, the Lock
// Screen or a notification (his medicine words rule). Everything is his record or arithmetic
// on it; a line that cannot be computed is hidden, never guessed.

/** Clicks one dose takes on a pen (a bigger dose than the dial holds is a second stick). */
function doseClicksOf(mg, pen) {
  if (!pen || !pen.clicks || !pen.mg || !pen.doses || !(mg > 0)) return null;
  return Math.round((mg * pen.clicks) / (pen.mg / pen.doses));
}
const sticksText = (c, pen) => (c > pen.clicks ? `${pen.clicks} + ${c - pen.clicks}` : `${c}`);

/**
 * The pen he is on now, from the shot that opened it (marked new pen) to now: the label's
 * clicks, the clicks every logged dose took, and the priming (his logged clicks, else his
 * usual, counted as assumed). The pen's extra fill covers his first N primes (his setting,
 * the same rule penMath uses). Null when no open pen can be found (no line is guessed).
 */
function penNow(M) {
  const p = prefs();
  const list = pens();
  let run = null;
  for (const s of M.shots) {
    if (s.newPen || /new pen/i.test(s.note || '')) run = { start: s, shots: [] };
    if (!run) continue;
    run.shots.push(s);
    if (s.left != null) run = { ended: true, pen: run.start.pen };
  }
  if (!run || run.ended) return null;
  const pen = list.find((x) => x.id === (run.start.pen || p.penId));
  if (!pen || !pen.clicks || !pen.doses) return null;
  const usual = Number(p.primeClicks) || 0;
  const free = Number.isFinite(Number(p.freePrimes)) ? Number(p.freePrimes) : 0;
  let used = 0, assumed = 0;
  run.shots.forEach((s, i) => {
    used += doseClicksOf(s.mg, pen) || 0;
    const pr = s.prime != null ? Number(s.prime) : (assumed++, usual);
    if (i >= free) used += pr;
  });
  const label = pen.clicks * pen.doses;
  return { pen, label, left: label - used, primes: run.shots.length, usual, free, assumed, opened: run.start.t };
}

/** Take one planned dose out of a pen state: { fits, need, next }. */
function takeDose(st, mg) {
  const need = (doseClicksOf(mg, st.pen) || 0) + (st.primes >= st.free ? st.usual : 0);
  return { fits: need <= st.left, need, next: { ...st, left: st.left - need, primes: st.primes + 1 } };
}

/**
 * The pen runway: this pen, the last planned shot it covers, and when the next pen starts.
 * With his dated plan (or a planned switch) the next pen is the plan's; with no plan it is
 * the first planned shot the pen cannot cover, on the same kind of pen.
 */
function penRunway(M) {
  const now = penNow(M);
  if (!now || !M.last) return null;
  const sw = switchLine(M, plans(), prefs());
  let doses, nextPen = null, nextT = null;
  if (sw && sw.land) {
    doses = sw.cur.map((x) => ({ t: x.t, mg: x.mg }));
    nextPen = sw.route ? pens().find((x) => x.id === sw.route.penTo) || null : planFacts(M, sw.target, prefs(), pens(), 'best').best?.pen || null;
    nextT = sw.land;
  } else doses = M.proj.slice(0, 12).map((x) => ({ t: x.t, mg: x.mg }));
  let st = now, last = null, short = null;
  for (const d of doses) {
    const r = takeDose(st, d.mg);
    if (!r.fits) { short = { t: d.t, by: r.need - st.left }; break; }
    st = r.next; last = d;
  }
  if (!sw || !sw.land) { if (!short) return null; nextPen = now.pen; nextT = short.t; short = null; }
  return { now, last, short, nextPen, nextT, same: nextPen && nextPen.id === now.pen.id, soon: nextT != null && nextT - M.now <= 7 * DAY };
}

function runwayLine(M) {
  const r = penRunway(M);
  if (!r) return '';
  const bits = [esc(r.now.pen.name)];
  if (r.last) bits[0] += ` to ${esc(dayName(r.last.t))}`;
  else bits.push(`${r.now.left} clicks left`);
  if (r.short) bits.push(`${r.short.by} clicks short on ${esc(dayName(r.short.t))}`);
  if (r.nextPen && r.nextT) bits.push(`${r.same ? 'new ' : ''}${esc(r.nextPen.name)} from ${esc(dayName(r.nextT))}`);
  return `<p class="g1-runway${r.soon ? ' soon' : ''}"><i>${G.pen}</i><span>${bits.join(' · ')}</span></p>`;
}

/** Hours and minutes: "6h 48m". */
const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };

/** The week since the last shot, in numbers from his record (never a verdict, no colour). */
function weekSince(M, fromIso) {
  const doc = state.data;
  const today = todayIso();
  const out = [];
  // Tendon loading days: days it was planned, and the days it was done.
  let plannedN = 0, doneN = 0;
  for (let d = fromIso; d <= today; d = addDays(d, 1)) {
    const done = !!anchorFirst(doc, d);
    const planned = FIRST_ITEMS.some((p) => plannedOn(doc, p.id, d));
    if (d === today && !done) continue;   // today counts once it is done
    if (planned || done) plannedN++;
    if (done) doneN++;
  }
  if (plannedN) out.push({ g: 'load', v: `${doneN} of ${plannedN}`, k: 'Tendon loading' });
  const clinic = Object.entries(doc.program?.clinicDays || {}).filter(([d, on]) => on && d >= fromIso && d <= today).length;
  out.push({ g: 'clinic', v: String(clinic), k: clinic === 1 ? 'Clinic visit' : 'Clinic visits' });
  // Weight now and on the shot day, both in lb, the plain difference (no colour, no arrow).
  const ws = weightPoints();
  const onShot = ws.filter((w) => w.iso === fromIso).pop();
  const lastW = ws[ws.length - 1];
  if (onShot && lastW && lastW.iso > fromIso) {
    const dlt = Math.round((lastW.lb - onShot.lb) * 10) / 10;
    const d = new Date(midnight(fromIso));
    out.push({ g: 'scale', wide: true, v: `${lastW.lb.toFixed(1)} lb`, k: `${onShot.lb.toFixed(1)} lb on ${mon(d)} ${d.getDate()} · ${dlt === 0 ? 'the same' : `${Math.abs(dlt).toFixed(1)} lb ${dlt < 0 ? 'less' : 'more'}`}` });
  }
  // Time asleep, the nights since the shot (a night is filed under the day he woke).
  const ns = ringNights().filter((n) => n.day > fromIso && n.day <= today && Number.isFinite(n.sleepH));
  if (ns.length) {
    const est = ns.filter((n) => n.est).length;
    out.push({ g: 'sleep', v: hm(ns.reduce((a, n) => a + n.sleepH, 0) / ns.length), k: 'Asleep, average', k2: est ? `${est} estimated` : '' });
  }
  return out;
}

/**
 * The dose the shot day card is about, or null. Today's own planned dose; else a planned
 * dose that is due and not logged (the model moves a missed dose to now and keeps its
 * planned time as `due`), so a missed Thursday reads "Shot due since Thu Oct 1" on Friday,
 * and on Sunday the card shows Sunday's dose with Thursday's named as not logged. Never
 * up once a shot is logged today (the card folds to one line instead).
 */
function shotDue(M) {
  if (!M.last) return null;
  const today = todayIso();
  if (M.shots.some((s) => isoOf(s.t) === today)) return null;
  // ONE RULE (round 3 leftovers, 2026-09-30): the card is about the NEWEST planned dose that is
  // due today or already passed with no shot logged near it; every older unlogged dose is named
  // as not logged and never chosen. So a dose never changes from one day to the next: after
  // two missed doses Sunday and Monday both name Sunday's dose and list Thursday's. The model
  // moves only its first missed dose to now (proj[].due), so the list is built from the plan
  // itself (plannedMissed) plus today's own dose still ahead in the projection.
  const planned = new Map();
  for (const x of plannedMissed(M)) planned.set(x.t, { planned: x.t, mg: x.mg });
  for (const x of M.proj) {
    const pt = x.due != null ? x.due : x.t;
    if (isoOf(pt) === today && !planned.has(pt)) planned.set(pt, { planned: pt, mg: x.mg });
    else if (x.due != null && isoOf(x.due) < today && !planned.has(x.due)) planned.set(x.due, { planned: x.due, mg: x.mg });
  }
  const all = [...planned.values()].filter((x) => isoOf(x.planned) <= today).sort((a, b) => a.planned - b.planned);
  if (!all.length) return null;
  const newest = all[all.length - 1];
  // `t` is the model's time for a dose: its own time while ahead, now once it has passed.
  const dose = { t: Math.max(newest.planned, M.now), mg: newest.mg, proj: true, ...(newest.planned < M.now ? { due: newest.planned } : {}) };
  const missed = all.slice(0, -1).filter((x) => isoOf(x.planned) < today).map((x) => ({ t: x.planned, mg: x.mg }));
  return { dose, missed, late: dose.due != null ? dose.due : null };
}
/** Planned doses since the last shot that have passed with no shot logged near them. */
function plannedMissed(M) {
  if (!M.last) return [];
  const r = routeRec(prefs());
  const logged = M.shots.map((s) => s.t);
  const out = [];
  if (r) {
    for (const x of r.route) {
      const t = Date.parse(x.at);
      if (Number.isFinite(t) && t > M.last.t && t < M.now && !logged.some((u) => Math.abs(u - t) < 2.5 * DAY)) out.push({ t, mg: x.mg });
    }
  } else {
    for (let t = later(M.last.t, M.every), k = 0; t < M.now && k < 60; t = later(t, M.every), k++) out.push({ t, mg: M.last.mg });
  }
  return out;
}
/** True while the shot day card is up (the Next shot corner would say it twice, Never 8). */
function shotDayOpen(M) { return !!shotDue(M); }

/** The pen a planned dose comes from: the plan's new pen from the landing, else the open one. */
function penFor(M, dose) {
  const p = prefs();
  const sw = switchLine(M, plans(), p);
  const onNew = !!(sw && sw.land && dose.t >= sw.land);
  const now = penNow(M);
  const pen = onNew ? (sw.route ? pens().find((x) => x.id === sw.route.penTo) : planFacts(M, sw.target, p, pens(), 'best').best?.pen) : now?.pen;
  return { pen: pen || null, onNew, now };
}

let sdMore = false;   // the card's details (pen, site, the week since), open this session only
/**
 * The shot day card, at the top of the tab on a day that holds a planned shot (his dated
 * plan, or his interval), or while one is due. One row so the Level chart still opens
 * whole under it (DESIGN-LANGUAGE: 360 x 300 on open): when, the dose and its clicks, and
 * Log shot, which opens the sheet on this dose and this pen. The pen gauge, the rested
 * site and the week since the last shot open under it. After a shot is logged that day
 * it folds to one line.
 */
function shotDayCard(M) {
  const today = todayIso();
  const logged = [...M.shots].reverse().find((s) => isoOf(s.t) === today);
  if (logged) {
    return `<div class="g1-shotday done" data-g1-shotday><i class="g1-sdok">${G.check}</i><span><b>Logged ${esc(logged.timeKnown === false ? 'today' : timeName(logged.t))}</b> · ${mgStr(logged.mg)} mg${logged.site ? ` · ${esc(SITE_NAME[logged.site] || logged.site)}` : ''}</span></div>`;
  }
  const due = shotDue(M);
  if (!due) return '';
  const next = due.dose;
  const p = prefs();
  const { pen, onNew, now } = penFor(M, next);
  const clicks = doseClicksOf(next.mg, pen);
  const usual = Number(p.primeClicks) || 0;
  const label = pen && pen.clicks && pen.doses ? pen.clicks * pen.doses : null;
  const left = onNew ? label : now?.left ?? null;
  const rest = siteRest(M);
  const ld = new Date(M.last.t);
  // When: the planned time still ahead, "due since" once it has passed, or the day it was due.
  const lateOther = due.late != null && isoOf(due.late) !== today;
  const tag = lateOther ? 'Shot due' : 'Shot day';
  const when = lateOther ? `since ${dayName(due.late)}`
    : due.late != null ? `due since ${hourName(due.late)}`
      : next.t > M.now + 5 * 60e3 ? timeName(next.t) : '';
  // The pen as a small gauge (03 P14): what is left, and the part this shot takes, darker.
  const gauge = left != null && label && clicks != null ? (() => {
    const use = Math.min(left, clicks + (onNew || (now && now.primes >= now.free) ? usual : 0));
    return `<span class="g1-gauge" role="img" aria-label="${left} of ${label} clicks left, this shot takes ${use}"><i style="--w:${(left / label).toFixed(4)}"></i><i class="take" style="--x:${((left - use) / label).toFixed(4)};--w:${(use / label).toFixed(4)}"></i></span>`;
  })() : '';
  const clickLine = clicks != null ? ` · ${esc(sticksText(clicks, pen))} clicks` : '';
  const hasMore = !!(pen || rest.next || due.missed.length);
  return `<section class="g1-shotday" data-g1-shotday aria-label="${esc(tag)}">
    <div class="g1-sdtop">
      <${hasMore ? `button type="button" class="g1-sdhead" data-g1-sdmore aria-expanded="${sdMore}"` : 'div class="g1-sdhead"'}>
        <span class="g1-sdtext"><small><i class="g1-sdglyph">${G.shot}</i>${esc(tag)}${when ? ` · ${esc(when)}` : ''}</small><span><b>${mgStr(next.mg)} mg</b>${clickLine}${due.missed.length ? `<em class="g1-sdmissn">${due.missed.length} missed</em>` : ''}</span></span>
        ${hasMore ? `<i class="g1-sdchev">${G.chevron}</i>` : ''}
      </${hasMore ? 'button' : 'div'}>
      <button type="button" class="g1-pill primary" data-pk-log>${G.plus}<span>Log shot</span></button>
    </div>
    ${hasMore ? `<div class="g1-sdmore" data-g1-sdbody ${sdMore ? '' : 'hidden'}>
      ${due.missed.length ? `<p class="g1-sdmiss">${due.missed.slice(-3).map((x) => `${esc(dayName(x.t))}, ${mgStr(x.mg)} mg, not logged`).join('<br>')}${due.missed.length > 3 ? `<br>and ${due.missed.length - 3} more before` : ''}</p>` : ''}
      ${pen ? `<div class="g1-sdpen">${gauge}<small><b>${esc(pen.name)}</b>${onNew ? ' · new pen' : ''}${left != null && label ? ` · ${left} of ${label} clicks left` : ''}${clicks != null && usual ? ` · prime ${usual}` : ''}</small></div>` : ''}
      ${rest.next ? `<div class="g1-sdsite"><i>${G.site}</i><span>${esc(SITE_NAME[rest.next])}</span><small>Rested longest</small></div>` : ''}
      ${sinceBlock(M, ld)}
    </div>` : ''}
  </section>`;
}
/** The week since the last shot, in numbers (tendon loading, clinic, weight, sleep). */
function sinceBlock(M, ld) {
  const week = weekSince(M, isoOf(M.last.t));
  return week.length ? `<div class="g1-sdweek"><h3>Since ${esc(WD[ld.getDay()])} ${mon(ld)} ${ld.getDate()}</h3><div class="g1-sdgrid">${week.map((w) => `<div class="g1-sdfact${w.wide ? ' wide' : ''}"><i>${G[w.g]}</i><span><b>${esc(w.v)}</b><small>${esc(w.k)}</small>${w.k2 ? `<small>${esc(w.k2)}</small>` : ''}</span></div>`).join('')}</div></div>` : '';
}

/**
 * What the night of a dose actually does, measured on his own ring nights.
 * Only shown once there are enough cycles, and it prints what did NOT move as
 * plainly as what did. Nothing here comes from the level, only the calendar of
 * shots. v3: four rows with an arrow each; only a row that moves gets colour;
 * the explanation sits behind (i) (audit G8).
 */
function shotNightTile(M) {
  if (!ringReady()) return '';
  const eff = shotNightEffect(Object.values(state.data.pk?.shots || {}));
  if (!eff) return '';
  const rows = [
    { k: 'tempDev', lab: 'Body temperature', unit: '°F', nd: 2, mult: 1.8 },
    { k: 'breath', lab: 'Breath rate', unit: '/min', nd: 2 },
    { k: 'sleepH', lab: 'Time asleep', unit: ' min', nd: 0, mult: 60 },
    { k: 'sleepScore', lab: 'Sleep score', unit: '', nd: 1 },
  ].map((r) => ({ ...r, v: eff.keys[r.k] })).filter((r) => r.v);
  if (rows.length < 2) return '';
  return `<section class="g1-sec">
    <div class="g1-sechead"><h2>The night of a shot</h2><button type="button" class="g1-info" data-g1-infotoggle aria-label="How this is measured" aria-expanded="false">${G.info}</button></div>
    <p class="g1-about" hidden>The first night of each cycle against the rest of that cycle, on your own ring nights (${eff.cycles} cycles). ${esc(shotSentence(rows.filter((r) => r.v.clears), rows.filter((r) => !r.v.clears)))}</p>
    <div class="g1-nights" role="list">
      ${rows.map((r) => {
        // One row a measure (research 04 F3, audit d-glp1-35): the centre tick is "the rest
        // of the cycle", the bar the 90% range of the difference, the dot the average. A row
        // whose range clears the centre is drawn in ink; the rest stay grey. No red, no green.
        const k = r.mult || 1;
        const d = r.v.diff * k, lo = r.v.lo * k, hi = r.v.hi * k;
        const span = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(d)) * 1.15 || 1;
        const px = (v) => `${(50 + (v / span) * 50).toFixed(2)}%`;
        const txt = r.v.clears ? `${d >= 0 ? '+' : '\u2212'}${round(Math.abs(d), r.nd)}${r.unit}` : 'No change';
        return `<div class="g1-night ${r.v.clears ? 'on' : ''}" role="listitem" aria-label="${esc(r.lab)}: ${esc(txt)}">
          <small>${esc(r.lab)}</small>
          <span class="g1-db" aria-hidden="true"><i class="z"></i><i class="bar" style="left:${px(Math.min(lo, hi))};right:calc(100% - ${px(Math.max(lo, hi))})"></i><i class="dot" style="left:${px(d)}"></i></span>
          <b>${esc(txt)}</b></div>`;
      }).join('')}
    </div>
  </section>`;
}

// --------------------------------------------------------- the time span --
// The span in DAYS is the one thing stored (per device); the four capsule
// segments are four places on it. v3 took the slider away (his words 2026-09-30:
// the slider was "a workaround interface for a web app"); a span he set with it
// before still opens, with no segment lit until he taps one.
const SPAN_MIN = 14;
const spanFwd = (span) => Math.round(Math.min(21, Math.max(7, 7 + (span - SPAN_MIN) * 0.065)));

/** The longest span worth offering: his whole record, plus the days ahead. */
function spanMax(M) {
  return Math.max(SPAN_MIN + 1, Math.round((M.t1 - M.t0) / DAY));
}

/** The four segments, as spans. */
function presetSpan(M, key) {
  if (key === '2w') return SPAN_MIN;
  if (key === '1m') return 30;
  if (key === '3m') return 90;
  return spanMax(M);
}

/** The span on screen now: his own if he has set one, else the 1M view. */
function spanOf(M) {
  const raw = lsGet('span', null);
  const n = raw == null ? null : Number(raw);
  if (Number.isFinite(n) && n >= SPAN_MIN) return Math.min(n, spanMax(M));
  // Before the span was stored the setting was one of four names; carry it over.
  return presetSpan(M, lsGet('range', '1m'));
}

function levelWindow(M, span) {
  const now = M.now;
  const fwd = spanFwd(span);
  // All is the whole record and his plan until it settles, on one screen, no scroll (audit d-glp1-12).
  if (span >= spanMax(M)) {
    const far = M.settledAt ? M.settledAt + 7 * DAY : M.plan ? M.plan.land + 7 * DAY : 0;
    return [M.t0 - DAY, Math.min(M.t1, Math.max(now + fwd * DAY, far))];
  }
  // With a planned switch, the long views run on until it has settled, so the
  // plan is on screen (his report, 2026-09-28).
  const far = M.plan && span >= 60 ? (M.settledAt || M.plan.land) + 7 * DAY : 0;
  const x1 = Math.min(M.t1, Math.max(now + fwd * DAY, far));
  return [Math.max(M.t0 - DAY, x1 - span * DAY), x1];
}

/** The box a chart label takes up, near enough to keep two off each other. */
function labBox(x, y, text, anchor = 'middle') {
  const w = String(text).length * 6.6 + 6;
  const left = anchor === 'end' ? x - w : anchor === 'start' ? x : x - w / 2;
  return { x0: left, x1: left + w, y0: y - 11, y1: y + 3 };
}
const hitsAny = (b, list) => list.some((o) => b.x0 < o.x1 + 3 && b.x1 + 3 > o.x0 && b.y0 < o.y1 + 2 && b.y1 + 2 > o.y0);

function niceStep(span, target = 5) {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

// Per device layers (a toggle adds a layer and never moves the frame, RUBRIC 10).
const layerOn = (k) => (k === 'weight' ? lsGet('wline', '0') === '1' : lsGet(`layer.${k}`, '1') === '1');

function levelChart(M) {
  const p = prefs();
  const span = spanOf(M);
  // The window he looks through, and the whole run he can scroll along (his
  // ask, 2026-09-28: 2W and 1M scroll sideways to any time period).
  const [vx0, vx1] = levelWindow(M, span);
  const isAll = span >= spanMax(M);
  const fx0 = isAll ? vx0 : Math.min(vx0, M.t0 - DAY), fx1 = isAll ? vx1 : Math.max(vx1, M.t1);
  const scroll = fx1 - fx0 > (vx1 - vx0) * 1.02;
  const x0 = scroll ? fx0 : vx0, x1 = scroll ? fx1 : vx1;
  const vb = viewBox();
  // Edge to edge on a phone; inside the column on iPad and Mac.
  const T = tier();
  const Wv = vb.bleed ? vb.inner + 2 * vb.pad : colW('level');
  // Regular width: the chart is the page, so it is taller than the phone's, in step with the
  // window (an 11 inch iPad upright gets 500, on its side the height left under the hero).
  const H = vb.bleed ? 364 : T ? Math.round(Math.max(420, Math.min(560, Wv * 1.05, window.innerHeight - 330))) : Math.round(Math.max(380, Math.min(560, Wv * 0.5)));
  const showBand = !!M.band && layerOn('band');
  // His weights on the level's own axis, through two points he set (2026-09-28):
  // his heaviest weigh in on his range top ("295 sits where 180") and 200 lb on
  // 50 ("scale it so 200 would sit at 50"). The line comes in from the left edge
  // when the last weigh in is before the window.
  const wAll = weightPoints();
  const inWin = wAll.filter((w) => w.t >= x0 && w.t <= x1);
  const beforeW = [...wAll].reverse().find((w) => w.t < x0);
  const afterW = wAll.find((w) => w.t > x1);
  const wDraw = [...(beforeW ? [beforeW] : []), ...inWin, ...(afterW ? [afterW] : [])];
  const showW = wDraw.length > 0 && layerOn('weight');
  // Gutters, not margins: flags above (Now, Steady), shots and dates below, the
  // value labels in a trailing strip of solid page colour. Nothing on the left:
  // the curve starts at the screen's edge.
  const m = { l: 0, r: 32, t: 24, b: 38 };   // 32: the plot keeps 361 of 393 pt (07 4.8 wants 360)
  // W and pw are the whole drawing: wider than the screen when it scrolls.
  const W = scroll ? Math.round(m.l + m.r + (Wv - m.l - m.r) * ((x1 - x0) / (vx1 - vx0))) : Wv;
  const pw = W - m.l - m.r;
  const X = (t) => m.l + ((t - x0) / (x1 - x0)) * pw;
  // Flags in the top gutter: Now, and Steady on the long views. Each sits over its own
  // line; when two cannot, the second takes a row of its own and the gutter grows by
  // it (audit r3 glp1-04: on All, Steady's box sat over the Now line).
  const nowX = X(M.now);
  const flags = [];
  if (M.now > x0 && M.now < x1) flags.push({ x: nowX, text: 'Now', cls: 'now' });
  const setX = M.settledAt && span >= 60 && M.settledAt > M.now && M.settledAt < x1 ? X(M.settledAt) : null;
  if (setX != null) flags.push({ x: setX, text: `Steady ${mon(new Date(M.settledAt))} ${new Date(M.settledAt).getDate()}`, cls: 'set' });
  // Kept inside the window he sees on open (a scrolling chart's drawing runs on under the gutter).
  const flagHi = (flags.every((f) => f.x <= X(vx1)) ? Math.min(W - m.r, X(vx1)) : W - m.r) - 2;
  const flagFit = flagPlace(flags, m.l + 2, flagHi, 2);
  m.t += FLAG_ROW * (flagFit.rows - 1);
  const ph = H - m.t - m.b;

  const val = (sim, t) => pctAt(M, sim, t);
  const bandAt = (t, lo) => {
    if (!M.band) return null;
    const v = at({ ...M.band, conc: lo ? M.band.lo : M.band.hi }, t);
    return (v / M.refAvg) * 100;
  };
  const N = Math.min(4000, Math.max(60, Math.round(pw / 1.5)));
  const ts = Array.from({ length: N + 1 }, (_, i) => x0 + ((x1 - x0) * i) / N);
  // The vertical scale fits what is on screen (his ask, 2026-09-28): the floor
  // 30% under the lowest level in view, the top on his range top ("top out just
  // at that highest level"), or on the highest level in view if that is above
  // it. The 180 line is part of the frame for good ("i don't see the 180% line
  // anymore"). With his weight showing, the bounds widen only if a visible weigh
  // in would fall outside them ("it doesn't need to [adjust]").
  const lineV = ts.map((t) => val(M.withNext, t));
  // The 90% band is a layer: when it is on and would fall outside, the bounds widen
  // to hold it, never shear it flat at the top or floor (RUBRIC 10, audit d-glp1-09).
  const bandHiV = showBand ? ts.map((t) => bandAt(t, false)) : null;
  const bandLoV = showBand ? ts.map((t) => bandAt(t, true)) : null;
  const wMax = wAll.length ? Math.max(...wAll.map((w) => w.lb)) : 295;
  const wK = (p.rangeMax - 50) / Math.max(1, wMax - 200);
  const wV = (lb) => p.rangeMax + (lb - wMax) * wK;
  const capTop = p.rangeMax * 1.2;
  const scaleAt = (a, b2) => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ts.length; i++) if (ts[i] >= a && ts[i] <= b2) { lo = Math.min(lo, lineV[i]); hi = Math.max(hi, lineV[i]); }
    if (!Number.isFinite(lo)) { lo = 0; hi = capTop; }
    let yMin = Math.max(0, lo * 0.7);
    let yMax = Math.max(yMin + 10, Math.min(capTop, Math.max(hi, p.rangeMax) * 1.02));
    if (showBand) {
      let bl = Infinity, bh = -Infinity;
      for (let i = 0; i < ts.length; i++) if (ts[i] >= a && ts[i] <= b2) { bl = Math.min(bl, bandLoV[i]); bh = Math.max(bh, bandHiV[i]); }
      if (Number.isFinite(bh) && bh + 2 > yMax) yMax = bh + 2;
      if (Number.isFinite(bl) && bl - 2 < yMin) yMin = Math.max(0, bl - 2);
    }
    if (showW) {
      let vis = wAll.filter((w) => w.t >= a && w.t <= b2);
      if (!vis.length) vis = [[...wAll].reverse().find((w) => w.t < a), wAll.find((w) => w.t > b2)].filter(Boolean);
      if (!vis.length) vis = wAll;
      const wHi = wV(Math.max(...vis.map((w) => w.lb))), wLo = wV(Math.min(...vis.map((w) => w.lb)));
      if (wHi + 4 > yMax) yMax = wHi + 4;
      if (wLo - 4 < yMin) yMin = Math.max(0, wLo - 4);
    }
    return { yMin, yMax };
  };
  const winW = vx1 - vx0;
  const b0 = scroll ? Math.min(x1, Math.max(x0 + winW, levelEndT ?? vx1)) : vx1;
  const base = scaleAt(b0 - winW, b0);
  const Ys = (sc) => (v) => m.t + ph - ((v - sc.yMin) / (sc.yMax - sc.yMin)) * ph;
  const Y = Ys(base);

  const past = ts.filter((t) => t <= M.now);
  const fut = ts.filter((t) => t >= M.now);
  if (M.now > x0 && M.now < x1) { past.push(M.now); fut.unshift(M.now); }
  const path = (list) => list.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(val(M.withNext, t)).toFixed(1)}`).join('');
  const bandPath = showBand ? `${ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(bandAt(t, false)).toFixed(1)}`).join('')}${[...ts].reverse().map((t) => `L${X(t).toFixed(1)},${Y(bandAt(t, true)).toFixed(1)}`).join('')}Z` : '';
  // The area under his own line, in a soft wash of the level colour: the curve
  // reads as a shape, not a wire.
  // Closed at the 0 line, not at this frame's floor: a refit while scrolling lowers the
  // floor, and a wash closed at the old floor ended in a flat edge (audit d-glp1-08).
  // The clip keeps it inside the plot.
  const zeroY = Y(0).toFixed(1);
  const areaPath = past.length > 1 ? `${path(past)}L${X(past[past.length - 1]).toFixed(1)},${zeroY}L${X(past[0]).toFixed(1)},${zeroY}Z` : '';

  // About four gridlines (Apple: fewer when people inspect points), his two range
  // lines always labelled. Labels live in the trailing gutter, on solid ground.
  const gridOf = (sc) => {
    const Yq = Ys(sc);
    const step = niceStep(sc.yMax - sc.yMin, 4);
    let lines = '', labs = '';
    const rules = [p.rangeMin, p.rangeMax].filter((r) => r <= sc.yMax + 1e-9 && r >= sc.yMin);
    for (let v = Math.ceil(sc.yMin / step - 1e-9) * step; v <= sc.yMax + 1e-9; v += step) {
      if (rules.some((r) => Math.abs(Yq(r) - Yq(v)) < 16)) continue;
      lines += `<line class="g1-grid" x1="${m.l}" x2="${W - m.r}" y1="${Yq(v).toFixed(1)}" y2="${Yq(v).toFixed(1)}"/>`;
      labs += `<span class="g1-ylab" style="top:${Yq(v).toFixed(1)}px">${+v.toFixed(0)}</span>`;
    }
    for (const v of rules) {
      lines += `<line class="g1-rule" x1="${m.l}" x2="${W - m.r}" y1="${Yq(v).toFixed(1)}" y2="${Yq(v).toFixed(1)}"/>`;
      labs += `<span class="g1-ylab rule" style="top:${Yq(v).toFixed(1)}px">${v}%</span>`;
    }
    // The weight's two anchors, printed where they sit (his scale, not a hidden one).
    if (showW) for (const [lb, v] of [[r0(wMax), p.rangeMax], [200, 50]]) {
      if (v < sc.yMin || v > sc.yMax) continue;
      labs += `<span class="g1-wanchor" style="top:${Yq(v).toFixed(1)}px">${lb} lb</span>`;
    }
    return { lines, labs };
  };
  const g0 = gridOf(base);

  // Dates along the bottom row, on midnights.
  const spanD = (vx1 - vx0) / DAY;
  const every = spanD <= 16 ? 2 : spanD <= 45 ? 7 : spanD <= 120 ? 14 : 30;
  const xl = [];
  let iso = isoOf(x0);
  let lastX = -99;
  for (let t = midnight(iso); t <= x1; t = midnight(iso = addDays(iso, 1))) {
    if (t < x0) continue;
    const d = new Date(t);
    const pick = every === 30 ? d.getDate() === 1 : every === 2 ? d.getDate() % 2 === 0 : d.getDay() === 1 && (every === 7 || Math.round(t / (7 * DAY)) % 2 === 0);
    if (!pick) continue;
    const x = X(t);
    const hw = (`${mon(d)} ${d.getDate()}`.length * 6.4) / 2 + 2;
    if (x - lastX < 46 || x - hw < m.l + 2 || x + hw > W - m.r - 2) continue;
    lastX = x;
    xl.push(`<text class="g1-xlab" data-hw="${hw.toFixed(1)}" x="${x.toFixed(1)}" y="${H - 5}">${mon(d)} ${d.getDate()}</text>`);
  }

  // Cravings as colour, a strip hugging the plot's floor, one cell per logged day.
  const feel = pkDoc().feel || {};
  const cells = Object.entries(feel).filter(([, f]) => f && f.c != null).map(([d, f]) => {
    const a = midnight(d), b2 = midnight(addDays(d, 1));
    if (b2 <= x0 || a >= x1) return '';
    const xa = Math.max(X(a), m.l), xb = Math.min(X(b2), W - m.r);
    return `<rect class="g1-cell c${f.c}" x="${(xa + 0.5).toFixed(1)}" y="${m.t + ph - 7}" width="${Math.max(1, xb - xa - 1).toFixed(1)}" height="7" rx="2"/>`;
  }).join('');

  // Shots: a dot on the curve itself; below the plot a tick on the axis. The row
  // under the ticks says the dose where it changes ("2.5 mg", in the level colour)
  // and the days between two shots; nothing is written over the curve (RUBRIC 3,
  // audit d-glp1-11), and nothing that would be cut at an edge is drawn (d-glp1-25).
  const rowY = m.t + ph + 20;   // under the shot ticks (they end at +8), over the dates
  const edgeOk = (x, hw) => x - hw >= m.l + 2 && x + hw <= W - m.r - 2;
  const rowTaken = [];
  const taken = [];   // label boxes over the plot (the weight line's two numbers)
  let prevMg = null;
  const all = [...M.shots, ...M.proj];
  const doseLabs = [];
  const marks = all.map((s) => {
    const changed = s.mg !== prevMg;
    prevMg = s.mg;
    if (s.t < x0 || s.t > x1) return '';
    const x = X(s.t), v = val(M.withNext, s.t);
    if (changed && !s.proj) {
      const text = `${+s.mg.toFixed(2)} mg`;
      const hw = (text.length * 6.2) / 2 + 3;
      if (edgeOk(x, hw) && !rowTaken.some((o) => Math.abs(o.x - x) < o.hw + hw + 4)) {
        rowTaken.push({ x, hw });
        doseLabs.push(`<text class="g1-doselab" data-hw="${hw.toFixed(1)}" x="${x.toFixed(1)}" y="${rowY.toFixed(1)}">${text}</text>`);
      }
    }
    return `<circle class="g1-shot${s.proj ? ' proj' : ''}" data-v="${v.toFixed(3)}" cx="${x.toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${s.proj ? 3.5 : 4.5}"/>
      <line class="g1-shottick${s.proj ? ' proj' : ''}" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t + ph + 2}" y2="${m.t + ph + 8}"/>`;
  }).join('') + doseLabs.join('');
  const gaps = all.slice(1).map((s, i) => {
    const a = all[i];
    if (a.t < x0 || s.t > x1) return '';
    const xa = X(a.t), xb = X(s.t);
    if (xb - xa < 30) return '';
    const x = (xa + xb) / 2, text = `${((s.t - a.t) / DAY).toFixed(1)}d`, hw = (text.length * 6.2) / 2 + 2;   // the unit, as the shot list prints it (audit d-glp1-26)
    if (!edgeOk(x, hw) || rowTaken.some((o) => Math.abs(o.x - x) < o.hw + hw + 4)) return '';
    return `<text class="g1-gaplab${s.proj ? ' proj' : ''}" data-hw="${hw.toFixed(1)}" x="${x.toFixed(1)}" y="${rowY.toFixed(1)}">${text}</text>`;
  }).join('');

  const flagSvg = flagDraw(flagFit, m, ph);

  // The weight line: its own colour, its own dots, the real pounds at each end.
  const wY = (sc) => (lb) => Ys(sc)(wV(lb));
  const wLine = !showW ? '' : (() => {
    const wq = wY(base);
    const pts = wDraw.map((w) => `${X(w.t).toFixed(1)},${wq(w.lb).toFixed(1)}`);
    const dots = inWin.map((w) => `<circle class="g1-wdot" data-lb="${w.lb}" cx="${X(w.t).toFixed(1)}" cy="${wq(w.lb).toFixed(1)}" r="3.2"/>`).join('');
    // The first and the latest weigh in on screen say their pounds (his report,
    // 2026-09-19: numbers piled on each other when every dot had one).
    const labs = [inWin[0], inWin.length > 1 ? inWin[inWin.length - 1] : null].filter(Boolean).map((w, i) => {
      const x = X(w.t);
      const anchor = i === 1 && x > W - m.r - 40 ? 'end' : i === 0 && x < m.l + 40 ? 'start' : 'middle';
      const dx = anchor === 'end' ? -6 : anchor === 'start' ? 6 : 0;
      let dy = -9;
      if (hitsAny(labBox(x + dx, wq(w.lb) + dy, '000', anchor), taken)) dy = 16;
      taken.push(labBox(x + dx, wq(w.lb) + dy, '000', anchor));
      return `<text class="g1-wlab" data-lb="${w.lb}" data-dy="${dy}" x="${(x + dx).toFixed(1)}" y="${(wq(w.lb) + dy).toFixed(1)}" style="text-anchor:${anchor}">${Math.round(w.lb)}</text>`;
    }).join('');
    return `<g clip-path="url(#g1clip)"><path class="g1-wpath" data-g1-wpath d="M${pts.join('L')}"/>${dots}</g>${labs}`;
  })();

  // Refit the scale in place while he scrolls: the level paths move by one
  // transform (strokes do not scale), the rest is re-placed from its value.
  let st = null;   // this chart's own state: a refit still pending after a repaint never touches the next chart's
  const refit = (root, sc) => {
    if (!st || chartState !== st) return;
    const A = (base.yMax - base.yMin) / (sc.yMax - sc.yMin);
    const B = m.t + ph - A * Y(sc.yMin);
    root.querySelector('[data-g1-lv]')?.setAttribute('transform', `matrix(1,0,0,${A.toFixed(5)},0,${B.toFixed(2)})`);
    const g = gridOf(sc);
    const gl = root.querySelector('[data-g1-grid]'); if (gl) gl.innerHTML = g.lines;
    const ax = root.querySelector('[data-g1-axis]'); if (ax) ax.innerHTML = g.labs;
    const Yn = Ys(sc);
    root.querySelectorAll('.g1-shot').forEach((el) => {
      const y = Yn(+el.dataset.v) + (+el.dataset.dy || 0);
      el.setAttribute(el.tagName === 'circle' ? 'cy' : 'y', y.toFixed(1));
    });
    if (showW) {
      const wq = wY(sc);
      root.querySelector('[data-g1-wpath]')?.setAttribute('d', `M${wDraw.map((w) => `${X(w.t).toFixed(1)},${wq(w.lb).toFixed(1)}`).join('L')}`);
      root.querySelectorAll('.g1-wdot').forEach((d) => d.setAttribute('cy', wq(+d.dataset.lb).toFixed(1)));
      root.querySelectorAll('.g1-wlab').forEach((t) => t.setAttribute('y', (wq(+t.dataset.lb) + +t.dataset.dy).toFixed(1)));
    }
    st.Y = Yn;
    st.sc = sc;
  };
  chartState = st = { M, p, x0, x1, vx0, vx1, winW, X, Y, m, W, Wv, pw, H, ph, val, bandAt, scroll, scaleAt, refit, showBand, showW, wV, wMax, sc: base, span, weights: wAll };

  const presets = RANGES.map(([k, l]) => {
    const on = presetSpan(M, k) === span;
    return `<button type="button" class="${on ? 'on' : ''}" data-pk-range="${k}" aria-pressed="${on}">${l}</button>`;
  }).join('');
  // One legend (audit d-glp1-28): each entry says what a mark is, and the two
  // layers (90% of people, Weight) are the entries themselves, tapped to show or hide.
  // Round 3 audit (glp1-17): the marks on one row, the two switchable layers on their own
  // row, each with a check when on and an open ring when off (not by fill alone).
  const kstate = `<b class="g1-kstate" aria-hidden="true">${G.check}</b>`;
  const keys = [
    '<span><i class="k-line"></i>You</span>',
    `<span><i class="k-proj"></i>${M.plan ? 'Your plan' : 'On time'}</span>`,
    cells ? '<span><i class="k-cell"></i>Cravings</span>' : '',
  ].join('');
  const layers = [
    M.band ? `<button type="button" class="g1-kbtn ${showBand ? 'on' : ''}" data-g1-layer="band" aria-pressed="${showBand}"><span>${kstate}<i class="k-band"></i>90% of people</span></button>` : '',
    wDraw.length ? `<button type="button" class="g1-kbtn ${showW ? 'on' : ''}" data-pk-wline aria-pressed="${showW}"><span>${kstate}<i class="k-weight"></i>Weight</span></button>` : '',
  ].join('');
  const legend = `<div class="g1-keys">${keys}</div>${layers ? `<div class="g1-layers">${layers}</div>` : ''}`;
  return `<div class="g1-chart${vb.bleed ? ' bleed' : ''}" data-g1-chart style="--ph:${ph}px;--pt:${m.t}px;--gr:${m.r}px">
    <div class="g1-plot${scroll ? ' scrolls' : ''}" tabindex="0" role="group" aria-label="Level over time. Tap for the full chart; press and hold, then drag, to read any hour. Arrow keys move the cursor.">
      ${scroll ? '<div class="g1-scroll">' : ''}
      <svg class="g1-draw" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
        <defs><clipPath id="g1clip"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath>
          <linearGradient id="g1wash" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"><stop offset="0" class="g1-wash0"/><stop offset="1" class="g1-wash1"/></linearGradient></defs>
        <g data-g1-grid>${g0.lines}</g>
        <g clip-path="url(#g1clip)"><g data-g1-lv>
          ${bandPath ? `<path class="g1-bandpath" d="${bandPath}"/>` : ''}
          ${areaPath ? `<path class="g1-area" d="${areaPath}"/>` : ''}
          <path class="g1-line" vector-effect="non-scaling-stroke" d="${path(past)}"/>
          <path class="g1-line proj" vector-effect="non-scaling-stroke" d="${path(fut)}"/></g></g>
        ${cells}${flagSvg}${wLine}${marks}${gaps}${xl.join('')}
        <g class="g1-guide" style="opacity:0"><line x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/><circle r="6" cx="0" cy="0"/></g>
      </svg>
      ${scroll ? '</div>' : ''}
      <div class="g1-gutter" aria-hidden="true"></div>
      <div class="g1-axis" data-g1-axis aria-hidden="true">${g0.labs}</div>
      <div class="g1-callout" data-g1-callout aria-hidden="true"></div>
    </div>
    <div class="g1-ctrl g1-lctrl">
      <div class="g1-range" role="group" aria-label="Range">${presets}</div>
    </div>
    <div class="g1-key g1-lkey" role="group" aria-label="Legend">${legend}</div>
  </div>`;
}
/**
 * Flags in a top gutter (Now, Steady, Switch), kept apart AND inside [lo, hi], each box
 * over its own line. With maxRows 2, a flag that cannot sit over its own line in the
 * first row without covering another flag's line takes a second row (the fewest moved,
 * Now on top when it can be). Only when no layout works are they pushed apart in one row, never
 * under the value gutter or off the screen (audit d-glp1-10).
 */
const FLAG_ROW = 20;
function flagPlace(flags, lo, hi, maxRows = 1) {
  const fs = flags.map((f) => ({ ...f, w: f.text.length * 6.4 + 14, row: 0 })).sort((a, b) => a.x - b.x);
  fs.forEach((f) => { f.cx = Math.min(hi - f.w / 2, Math.max(lo + f.w / 2, f.x)); });
  const n = fs.length;
  const okRows = (rows) => {
    for (let i = 0; i < n; i++) {
      const a0 = fs[i].cx - fs[i].w / 2, a1 = fs[i].cx + fs[i].w / 2;
      if (fs[i].x < a0 + 4 || fs[i].x > a1 - 4) return false;   // its own line runs out of its box
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const b0 = fs[j].cx - fs[j].w / 2, b1 = fs[j].cx + fs[j].w / 2;
        if (rows[i] === rows[j] && a0 < b1 + 4 && b0 < a1 + 4) return false;   // two boxes touch
        if (rows[j] <= rows[i] && fs[j].x > a0 - 4 && fs[j].x < a1 + 4) return false;   // a box on another flag's line
      }
    }
    return true;
  };
  if (n > 1 && maxRows > 1) {
    let best = null;
    for (let mask = 0; mask < 1 << n; mask++) {
      const rows = fs.map((_, i) => (mask >> i) & 1);
      if (!okRows(rows)) continue;
      const cost = rows.reduce((a, r, i) => a + r * (fs[i].cls === 'now' ? 3 : 2), 0);
      if (!best || cost < best.cost) best = { rows, cost };
    }
    if (best) { fs.forEach((f, i) => { f.row = best.rows[i]; }); return { fs, rows: Math.max(...best.rows) + 1 }; }
  }
  for (let i = 1; i < n; i++) { const a = fs[i - 1], b = fs[i]; b.cx = Math.max(b.cx, a.cx + a.w / 2 + 4 + b.w / 2); }
  for (let i = n - 1; i >= 0; i--) {
    const f = fs[i];
    const max = i === n - 1 ? hi - f.w / 2 : fs[i + 1].cx - fs[i + 1].w / 2 - 4 - f.w / 2;
    if (f.cx > max) f.cx = max;
  }
  return { fs, rows: 1 };
}
function flagDraw({ fs, rows }, m, ph) {
  return fs.map((f) => {
    const y = 3 + FLAG_ROW * f.row;
    const y1 = m.t - 4 - FLAG_ROW * (rows - 1 - f.row);
    return `<line class="g1-flagline ${f.cls}" x1="${f.x.toFixed(1)}" x2="${f.x.toFixed(1)}" y1="${y1}" y2="${m.t + ph}"/>
      <rect class="g1-flagbox ${f.cls}" x="${(f.cx - f.w / 2).toFixed(1)}" y="${y}" width="${f.w.toFixed(1)}" height="17" rx="8.5"/>
      <text class="g1-flagtext ${f.cls}" x="${f.cx.toFixed(1)}" y="${y + 12.5}">${esc(f.text)}</text>`;
  }).join('');
}
const flagRow = (flags, lo, hi, m, ph) => flagDraw(flagPlace(flags, lo, hi, 1), m, ph);
let chartState = null;
let levelEndT = null;   // the time at the level chart's right edge, while he scrolls it

/** The callout's words for one moment: when, and what the finger is on. */
function calloutAt(t) {
  const c = chartState;
  if (!c) return '';
  const M = c.M;
  const when = Math.abs(t - M.now) < 30 * 60e3 ? 'Now' : `${dayName(t)}, ${hourName(t)}`;
  const bits = [];
  const all = [...M.shots, ...M.proj];
  const near = all.find((s) => Math.abs(s.t - t) < ((c.x1 - c.x0) / c.pw) * 10);
  if (near) bits.push(`${near.proj ? 'Planned' : 'Shot'} ${mgStr(near.mg)} mg`);
  else {
    const prev = (t <= M.now + 60e3 ? M.shots : all).filter((s) => s.t <= t).pop();
    if (prev) bits.push(cap(afterShot(prev, t)));
  }
  if (c.showBand) { const lo = c.bandAt(t, true), hi = c.bandAt(t, false); if (lo != null) bits.push(`90% of people ${r0(lo)} to ${r0(hi)}%`); }
  if (c.showW) {
    const w = c.weights.reduce((a, x) => (!a || Math.abs(x.t - t) < Math.abs(a.t - t) ? x : a), null);
    if (w && Math.abs(w.t - t) < DAY) bits.push(`${Math.round(w.lb)} lb`);
  }
  return `<b>${esc(when)}</b>${bits.map((x) => `<span>${esc(x)}</span>`).join('')}`;
}

/**
 * The same picture for the native full screen chart (CONTRACT chart.show). The
 * page does the maths; Swift only draws. Colours are resolved here because Swift
 * cannot read CSS. Weight is sent already placed on his anchors, in percent.
 */
function nativeChartSpec() {
  const c = chartState;
  if (!c) return null;
  const M = c.M, p = c.p;
  const med = cssColour('--med', '#5B3FD6');
  const n = 720;
  const a = M.t0, b2 = M.t1;
  const pts = (fn, from, to) => {
    const out = [];
    for (let i = 0; i <= n; i++) { const t = from + ((to - from) * i) / n; if (t >= from && t <= to) out.push([Math.round(t), +fn(t).toFixed(2)]); }
    return out;
  };
  // What Swift's ChartScreen draws (CStyle: solid, dashed, points, linepoints,
  // area; bands are y ranges; `nowMs`). Only the layers on in the page are sent,
  // and the names are short, so the legend stays one or two rows (audit d-glp1-06).
  const series = [
    { name: 'You', colour: med, style: 'solid', points: pts((t) => pctAt(M, M.withNext, t), a, M.now) },
    { name: M.plan ? 'Your plan' : 'On time', colour: med, style: 'dashed', points: pts((t) => pctAt(M, M.withNext, t), M.now, b2) },
  ];
  // The 90% range as ONE filled band (round 3 leftovers, NW-04): style 'band' carries both edges,
  // points [ms, low, high], and ChartScreen.swift shades between them in the level colour (one legend chip,
  // one toggle). It replaces the two pale edge lines the page sent before the band style existed.
  if (M.band && c.showBand) {
    const edge = [];
    for (let i = 0; i <= n; i++) { const t = a + ((b2 - a) * i) / n; edge.push([Math.round(t), +c.bandAt(t, true).toFixed(2), +c.bandAt(t, false).toFixed(2)]); }
    series.push({ name: '90% range', colour: med, style: 'band', points: edge });
  }
  if (c.weights.length && c.showW) series.push({ name: 'Weight', colour: cssColour('--ink-2', '#5C5C63'), style: 'points',
    points: c.weights.map((w) => [w.t, +c.wV(w.lb).toFixed(2), Math.round(w.lb)]), unit: 'lb' });
  // Craving days (audit d-glp1-05): Swift's bands are y ranges, so a day of craving
  // travels as a mark on the curve at midday, in its own colour, named on scrub.
  const cr = ['--crave-0', '--crave-1', '--crave-2', '--crave-3', '--crave-4'].map((k) => cssColour(k));
  const cravings = Object.entries(pkDoc().feel || {}).filter(([, f]) => f && f.c > 0)
    .map(([d, f]) => ({ ms: midnight(d) + 12 * HOUR, label: `${CRAVE[f.c][1]} craving`, colour: cr[f.c] }));
  return {
    kind: 'glp1', title: 'Level', unit: '%',
    // The headline already says the level; the line under it names the dashed lines.
    takeaway: `Your range ${p.rangeMin} to ${p.rangeMax}%`,
    series,
    // No words on the rule lines: Swift draws their chips over the curve at the left edge.
    rules: [{ value: p.rangeMin, label: '' }, { value: p.rangeMax, label: '' }],
    marks: [...M.shots.map((s) => ({ ms: s.t, label: `${mgStr(s.mg)} mg`, colour: med })),
      ...M.proj.map((s) => ({ ms: s.t, label: `${mgStr(s.mg)} mg planned`, colour: med })),
      ...cravings].sort((x, y) => x.ms - y.ms),
    marksName: cravings.length ? 'Shots and cravings' : 'Shots',
    range: [Math.round(c.vx0), Math.round(c.vx1)],
    nowMs: M.now,
    yDomain: [+c.sc.yMin.toFixed(2), +c.sc.yMax.toFixed(2)],
  };
}

/**
 * What each pen really held (his ask, 2026-09-28): from the first shot of a pen
 * to the one that logs the clicks left, every dose in clicks plus its priming.
 * A shot with no priming logged counts his usual priming and says so.
 */
function penRuns(M) {
  const p = prefs();
  const list = pens();
  const runs = [];
  let cur = null;
  for (const s of M.shots) {
    if (s.newPen || /new pen/i.test(s.note || '')) { cur = { start: s, shots: [] }; runs.push(cur); }
    if (!cur) continue;
    cur.shots.push(s);
    if (s.left != null) { cur.end = s; cur = null; }
  }
  const out = runs.map((r) => {
    const pen = list.find((x) => x.id === (r.start.pen || p.penId));
    if (!pen || !pen.clicks || !pen.mg || !pen.doses) return '';
    const cpm = pen.clicks / (pen.mg / pen.doses);
    let used = 0, assumed = 0;
    for (const s of r.shots) {
      used += Math.round(s.mg * cpm);
      if (s.prime != null) used += s.prime; else { used += Number(p.primeClicks) || 0; assumed++; }
    }
    const label = pen.clicks * pen.doses;
    const d = new Date(r.start.t);
    const head = `<b>${esc(pen.name)}</b><small>Opened ${mon(d)} ${d.getDate()}${assumed ? `, priming assumed on ${assumed}` : ''}</small>`;
    if (!r.end) return `<div class="pk-penrun">${head}<span><b>${used}</b><small>clicks used so far, of ${label} on the label</small></span></div>`;
    const total = used + r.end.left, extra = total - label;
    return `<div class="pk-penrun">${head}<span><b>${total}</b><small>clicks in all</small></span><span><b>${extra >= 0 ? '+' : ''}${extra}</b><small>extra over ${label}</small></span></div>`;
  }).filter(Boolean);
  return out.length ? `<div class="pk-penruns">${out.join('')}</div>` : '';
}

// The two logs under the chart (v3): a Title 3 head with its one Log button, the
// three newest rows, and the rest one tap away (his ask 2026-09-20 "this log can
// collapse": shut by default, the choice remembered on this device).
const LIST_SHUT = 3;
function logSection({ key, title, count, button, rows, extra = '' }) {
  const open = lsGet(key, '0') === '1';
  // Regular width has the room: five rows before "Show all", not three.
  const shut = tier() ? LIST_SHUT + 2 : LIST_SHUT;
  const more = rows.length - shut;
  return `<section class="g1-sec g1-log" data-g1-log="${key}">
    <div class="g1-sechead"><h2>${title}</h2>${count != null ? `<span class="g1-count">${count}</span>` : ''}${button}</div>
    ${extra}
    <div class="g1-rows">${rows.slice(0, open ? rows.length : shut).join('')}</div>
    ${more > 0 ? `<button type="button" class="g1-more" data-g1-logmore="${key}" aria-expanded="${open}">${open ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''}
  </section>`;
}

function shotList(M) {
  const shots = [...M.shots].reverse();
  const removed = shotsOf(M.drug.id, { removed: true });
  const rows = shots.map((s, i) => {
    const prev = shots[i + 1];
    const gap = prev ? (s.t - prev.t) / DAY : null;
    const d = new Date(s.t);
    return `<button type="button" class="g1-row" data-pk-shot="${esc(s.id)}">
      <span class="g1-cal"><b>${d.getDate()}</b><small>${mon(d)}</small></span>
      <span class="g1-rmain"><b>${mgStr(s.mg)} mg</b><small>${esc(WD[d.getDay()])}${s.timeKnown === false ? '' : ` ${esc(timeName(s.t))}`}${s.site ? ` · ${esc(SITE_NAME[s.site] || s.site)}` : ''}${s.left != null ? ` · ${s.left} left` : ''}</small></span>
      <span class="g1-rend">${gap != null ? `${gap.toFixed(1)}<small>d</small>` : '<small>First</small>'}</span>
    </button>`;
  });
  const extra = `${lsGet('logopen', '0') === '1' ? penRuns(M) : ''}`;
  const removedHtml = removed.length ? `<details class="g1-removed"><summary>Removed (${removed.length})</summary>
      ${removed.map((s) => `<div class="g1-rrow"><span>${dayName(s.t)} · ${mgStr(s.mg)} mg</span><button type="button" class="g1-link" data-pk-restore="${esc(s.id)}">Restore</button></div>`).join('')}</details>` : '';
  return logSection({
    key: 'logopen', title: 'Shots', count: shots.length || null,
    button: `<button type="button" class="g1-pill primary" data-pk-log>${G.plus}<span>Log shot</span></button>`,
    rows, extra,
  }).replace(/<\/section>$/, `${removedHtml}</section>`);
}

/**
 * His weights (his ask, 2026-09-21: "add a weight log under this log as well so
 * i can edit the log if need be. separate from the Injection Log"). Tapping a row
 * opens the weight sheet on that date, so one place edits them and the one-a-day
 * rule holds. Clinic weights are shown and named but never edited here.
 */
function weightList() {
  const rows = allMeasurements()
    .filter((m) => m.measure === 'bodyweight' && typeof m.value === 'number')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const unit = state.data.settings.weightUnit || 'kg';
  const mine = new Set((state.data.measurements || []).map((m) => m.id));
  const show = (m) => {
    const v = m.unit === unit ? m.value : toKg(m.value, m.unit || state.data.settings.weightUnit || 'kg') * (unit === 'lb' ? 2.2046226218 : 1);
    return Math.round(v * 10) / 10;
  };
  const list = rows.map((m, i) => {
    const prev = rows[i + 1];
    const dt = new Date(midnight(m.date));
    const own = mine.has(m.id);
    const delta = prev ? Math.round((show(m) - show(prev)) * 10) / 10 : null;
    // A clinic weight is his record too, but read only here: no button, no tap.
    const tag = own ? 'button type="button"' : 'div';
    return `<${tag} class="g1-row${own ? '' : ' ro'}" ${own ? `data-pk-weight-edit="${esc(m.date)}"` : ''}>
      <span class="g1-cal"><b>${dt.getDate()}</b><small>${mon(dt)}</small></span>
      <span class="g1-rmain"><b>${show(m).toFixed(1)} ${esc(unit)}</b><small>${esc(WD[dt.getDay()])}${own ? '' : ` · ${esc((m.src || 'clinic').split(',')[0])}`}</small></span>
      <span class="g1-rend">${delta == null ? '' : `${delta > 0 ? '+' : delta < 0 ? '\u2212' : ''}${Math.abs(delta).toFixed(1)}`}</span>
    </${own ? 'button' : 'div'}>`;
  });
  return logSection({
    key: 'wlogopen', title: 'Weight', count: rows.length || null,
    button: `<button type="button" class="g1-pill" data-pk-weight>${G.plus}<span>Log weight</span></button>`,
    rows: list, extra: weightChart(),
  });
}

// ............................................. the weight chart (A10.3) ..
// Round 3 (features 11, A10.3): his weights as the app's shared kit chart (the same chart,
// scrub and tap as Progress), so the curve reads before the list. "Compare to a date": he
// picks one of his logged weights; the chart draws a dashed rule at it, labelled with its
// date, and the latest weight shows the plain difference. Stored on this device only
// (rt.local refs.weight = { iso }); never prefilled, never suggested, no dose text near it.
const refWeightIso = () => { const r = localGet('refs.weight'); return r && typeof r.iso === 'string' ? r.iso : null; };
const lbDay = (w) => { const d = new Date(w.t); return `${WD[d.getDay()]} ${mon(d)} ${d.getDate()}`; };
const lbDiff = (a, b) => { const d = Math.round((a - b) * 10) / 10; return d === 0 ? 'the same as' : `${Math.abs(d).toFixed(1)} lb ${d < 0 ? 'less than' : 'more than'}`; };
function weightSub(w, ref) {
  if (!w) return '';
  const refW = ref && ref.iso !== w.iso ? ref : null;
  const d = new Date(ref ? ref.t : 0);
  return `${lbDay(w)}${refW ? ` · ${lbDiff(w.lb, refW.lb)} ${mon(d)} ${d.getDate()}` : ''}`;
}
let weightView = null;   // { ws, ref } for the scrub headline
function weightChart() {
  const ws = weightPoints();
  if (ws.length < 2) return '';
  const iso = refWeightIso();
  const ref = iso ? ws.find((w) => w.iso === iso) || null : null;
  const last = ws[ws.length - 1];
  weightView = { ws, ref };
  const d = ref ? new Date(ref.t) : null;
  const html = kitChart({
    series: [{ key: 'B', name: 'Weight', points: ws.map((w) => ({ t: w.t, v: Math.round(w.lb * 10) / 10, iso: w.iso })) }],
    rules: ref ? [{ v: Math.round(ref.lb * 10) / 10, label: `${mon(d)} ${d.getDate()}`, kind: 'ref' }] : [],
    width: colW('half'), height: tier() ? 220 : 170, unit: 'lb', label: 'Weight',
    native: {
      // One decimal, as the card prints it (his be exact rule), and the difference is the
      // line under the headline (audit r3 glp1-06).
      kind: 'weight', title: 'Weight', unit: 'lb', decimals: 1,
      takeaway: ref && ref.iso !== last.iso ? `${lbDiff(last.lb, ref.lb)} ${mon(d)} ${d.getDate()} (${ref.lb.toFixed(1)} lb)` : lbDay(last),
      series: [{ name: 'Weight', colour: cssColour('--ink-2', '#5C5C63'), style: 'linepoints', points: ws.map((w) => [w.t, Math.round(w.lb * 10) / 10]) }],
      rules: ref ? [{ value: Math.round(ref.lb * 10) / 10, label: `${mon(d)} ${d.getDate()}` }] : [],
    },
  });
  return `<div class="g1-wchart" data-g1-wchart>
    <div class="g1-whead">
      <span class="g1-wnow"><b data-g1-wnum>${last.lb.toFixed(1)}<small> lb</small></b></span>
      <button type="button" class="g1-menubtn" data-g1-wref aria-label="Compare to a date"><span>${ref ? 'vs' : 'Compare'}</span>${ref ? `<b>${mon(d)} ${d.getDate()}</b>` : ''}${G.chevron}</button>
    </div>
    <small class="g1-wsub" data-g1-wsub>${esc(weightSub(last, ref))}</small>
    ${html}
  </div>`;
}
function bindWeightChart(root, rerender) {
  const box = root.querySelector('[data-g1-wchart]');
  if (!box || !weightView) return;
  const num = box.querySelector('[data-g1-wnum]');
  const sub = box.querySelector('[data-g1-wsub]');
  const keep = { num: num.innerHTML, sub: sub.textContent };
  bindKitCharts(box, {
    onScrub(t) {
      if (t == null) { num.innerHTML = keep.num; sub.textContent = keep.sub; num.classList.remove('scrub'); return; }
      const w = weightView.ws.find((x) => x.t === t);
      if (!w) return;
      num.innerHTML = `${w.lb.toFixed(1)}<small> lb</small>`;
      num.classList.add('scrub');
      sub.textContent = weightSub(w, weightView.ref);
    },
  });
  box.querySelector('[data-g1-wref]')?.addEventListener('click', async (e) => {
    const cur = refWeightIso();
    const pick = await pickFrom(e.currentTarget, {
      title: 'Compare to a date',
      items: [{ id: 'off', title: 'No comparison', checked: !cur },
        // Never the newest weigh in: it is the one being compared (audit r3 glp1-12).
        ...[...weightView.ws].reverse().filter((w, i) => i > 0 || cur === w.iso).map((w, i) => ({ id: w.iso, title: `${lbDay(w)}, ${w.lb.toFixed(1)} lb`, checked: cur === w.iso, sep: i === 0 }))],
    });
    if (pick == null) return;
    await localSet('refs.weight', pick === 'off' ? null : { iso: pick });
    tick();
    rerender();
  });
}

function modelTiles(M) {
  const d = M.drug;
  // His call: reference material, folded on iPad and Mac, not on the phone.
  return `<details class="pk-about"><summary><span>The model and sources</span><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><section class="pm-sec">
    <div class="sc-notes pk-notes">
      <div class="sc-note"><b>How it works</b><span>${esc(d.modelNote || 'Two compartment model, first order absorption, typical values scaled to your size.')}</span></div>
      <div class="sc-note"><b>Not a Blood Test</b><span>Your own curve can sit anywhere in the shaded band.</span></div>
      ${(d.sources || []).map((s) => `<div class="sc-note"><b>${esc(s.short || 'Source')}</b><span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</span></div>`).join('')}
    </div>
  </section></details>`;
}

// ............................................................. Cravings ..
// v3 (2026-09-30), his words that night: the cravings logger "looks very much like
// AI"; "You can just use the colors as the elements." So colour IS the element:
// filled day tiles, the day as a band with each event a bubble at its time over
// the level line, meals from Lose It as chips, and two big buttons that log now.
// His rules kept: legacy entries are never changed (shown read only); every event
// keeps its time; the day's worst craving is derived from the events (a timed
// craving lifts it, never lowers what he set); common actions are buttons and the
// rest sit under More (2026-09-28).
let foodAsked = false;
let mealOpen = null;   // the Lose It meal he opened, this session only

/** One event, in words: "Strong, settled by water", "15 min after PB&J". */
function evDetail(e) {
  const bits = [];
  if (e.k === 'crave' && e.c != null) bits.push(CRAVE[e.c]?.[1]);
  if (e.s) bits.push(STRENGTH.find(([k]) => k === e.s)?.[1]);
  if (e.k === 'crave' && e.by) bits.push(e.by === 'none' ? 'did not settle' : e.by === 'passed' ? 'passed by itself' : `settled by ${SETTLED.find(([k]) => k === e.by)?.[1].toLowerCase()}`);
  if (e.k === 'nausea' && e.after) bits.push(`${e.gap ? `${AFTER_GAP.find(([g]) => g === e.gap)?.[1]} ` : ''}after ${e.after}`);
  if (e.k === 'ate' && e.after) bits.push(e.after);
  if (e.all) bits.push('all day');
  if (e.nap) bits.push(e.until ? `nap until ${clock(e.until)}` : 'nap');
  if (e.note) bits.push(e.note);
  return bits.filter(Boolean).join(' · ');
}
/** An event in a few words for the scrub plate: "Craving, some", "Nausea, strong". */
function evShort(e) {
  const k = EV_NAME[e.k] || e.k;
  const w = e.k === 'crave' && e.c != null ? CRAVE[e.c]?.[1] : e.s ? STRENGTH.find(([x]) => x === e.s)?.[1] : '';
  return w ? `${k}, ${w.toLowerCase()}` : k;
}
/** The strength of an event on its own kind's scale: 0 to 1. */
const evWeight = (e) => (e.k === 'crave' ? Math.max(1, e.c || 1) / CRAVE_TOP : e.k === 'nausea' ? (e.s === 'strong' ? 1 : 0.55) : 0.5);

function renderCravings(M, ctx) {
  const today = todayIso();
  const end = ctx.pkWeekEnd || today;
  const sel = ctx.pkDay || bandDay();
  const feel = pkDoc().feel || {};
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const f = feel[sel] || {};
  const lvl = dayLevel(M, sel);
  const cd = cycleDay(M, sel);
  if (!foodReady() && !foodAsked) { foodAsked = true; loadFood().then((ok) => { if (ok) repaint(); }); }
  const food = foodFor(sel);
  const tiles = days.map((d) => {
    const v = feel[d]?.c;
    const L = dayLevel(M, d);
    const dt = fromIso(d);
    const n = Math.min(4, (feel[d]?.ev || []).length);
    const future = d > today;
    return `<button type="button" class="g1-day ${v != null ? `c${v} filled` : 'hollow'} ${d === sel ? 'on' : ''}" data-pk-day="${d}" aria-pressed="${d === sel}" ${future ? 'disabled' : ''}
      aria-label="${esc(dayName(midnight(d)))}${v != null ? `, ${CRAVE[v][1]}` : ''}">
      <small>${WD[dt.getDay()]}</small><b>${dt.getDate()}</b><em>${L != null ? `${r0(L)}%` : ''}</em><i class="g1-pips">${'<span></span>'.repeat(n)}</i></button>`;
  }).join('');
  const evs = (f.ev || []).slice().sort((x, y) => evMinutes(x) - evMinutes(y));
  const legacyBits = [...(f.when || []).map((k) => WHEN.find(([w]) => w === k)?.[1]),
    ...Object.entries(f.tags || {}).map(([k, n]) => `${TAGS.find(([t]) => t === k)?.[1] || k}${n > 1 ? ` x${n}` : ''}`)].filter(Boolean);
  const flags = f.flags || [];
  const rows = evs.map((e) => {
    const [h, mi] = e.t ? e.t.split(':').map(Number) : [null, null];
    const time = e.t ? `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')}<small>${h < 12 ? '\u00a0AM' : '\u00a0PM'}</small>` : `<small class="part">${esc(PART_NAME[e.part] || '')}</small>`;
    return `<button type="button" class="g1-ev k-${e.k}${e.k === 'crave' && e.c != null ? ` c${e.c}` : ''}${e.s ? ` s-${e.s}` : ''}" data-pk-ev="${esc(e.id)}">
      <span class="g1-evtime">${time}</span><i class="g1-evg">${G[e.k] || ''}</i><span class="g1-evmain"><b>${esc(EV_NAME[e.k] || e.k)}</b>${evDetail(e) ? `<small>${esc(evDetail(e))}</small>` : ''}</span></button>`;
  }).join('');
  const worst = f.c != null ? CRAVE[f.c][1] : null;
  const built = foodBuiltAt();
  const foodChips = food ? `<div class="g1-food">
      <div class="g1-meals">${Object.entries(food.meals).map(([m, k]) => `<button type="button" class="g1-meal ${mealOpen === `${sel}|${m}` ? 'on' : ''}" data-g1-meal="${esc(m)}" aria-expanded="${mealOpen === `${sel}|${m}`}"><i>${G.ate}</i><span>${esc(m)}</span><b>${k.toLocaleString('en-US')}</b></button>`).join('')}</div>
      ${mealOpen && mealOpen.startsWith(`${sel}|`) ? `<div class="g1-mealitems">${food.items.filter((x) => x.m === mealOpen.split('|')[1]).map((x) => `<div><span>${esc(x.n)}</span><b>${x.k}</b></div>`).join('')}</div>` : ''}
      <p class="g1-foot">${food.kcal.toLocaleString('en-US')} kcal · ${food.protein} g protein · Lose It${built ? ` ${esc(relDays(Date.parse(built)) === 'today' ? timeName(Date.parse(built)) : dayName(Date.parse(built)))}` : ''}${foodWaiting() ? ' · waiting for the Mac' : ''}</p>
    </div>` : (foodWaiting() ? '<p class="g1-foot">Lose It: waiting for the Mac</p>' : '');
  const showNote = !!f.note || noteOpen === sel;
  // Regular width: the week, the day band and the log in the leading column, the patterns beside them.
  const cvOpen = tier() ? `<div class="g1-cvgrid" style="--c1:${colW('crave')}px;--gap:${COL_GAP}px">` : '';
  const cvClose = tier() ? '</div>' : '';
  return `${cvOpen}
  <section class="g1-crave" data-pk-dayiso="${sel}">
    <div class="g1-weekbar">
      <button type="button" class="g1-wkbtn" data-g1-wk="-1" aria-label="Week before">${G.left}</button>
      <span>${esc(weekLabel(days))}</span>
      ${end < today ? `<button type="button" class="g1-wkbtn" data-g1-wk="1" aria-label="Week after">${G.right}</button>` : '<span class="g1-wkbtn" aria-hidden="true"></span>'}
    </div>
    <div class="g1-week" data-g1-week role="group" aria-label="Week, swipe for another">${tiles}</div>
    <div class="g1-dayline">
      <b>${cd != null ? (cd === 0 ? 'Shot day' : `Day ${cd} after shot`) : esc(dayName(midnight(sel)))}</b>
      ${lvl != null && !days.includes(sel) ? `<span class="lvl">${r0(lvl)}%</span>` : ''}
      <button type="button" class="g1-worst ${f.c != null ? `c${f.c}` : 'unset'}" data-g1-worst aria-expanded="${worstOpen === sel}" aria-label="Worst craving of the day${worst ? `: ${worst}` : ''}">${worst ? esc(worst) : 'Worst'}${G.chevron}</button>
    </div>
    ${worstOpen === sel ? `<div class="g1-worstpick" role="group" aria-label="Worst craving of the day">${CRAVE.map(([v, l]) => `<button type="button" class="g1-wp c${v} ${f.c === v ? 'on' : ''}" data-g1-wp="${v}" aria-pressed="${f.c === v}">${esc(l)}</button>`).join('')}</div>` : ''}
    ${dayBand(M, sel, evs)}
    <div class="g1-logrow">
      <div class="g1-quick" data-pk-evadd="crave" role="group" aria-label="Craving${isLiveDay(sel) ? ', tap a strength to log it now' : ''}">
        ${CRAVE.slice(1).map(([v, l]) => `<button type="button" class="g1-qs c${v}" data-g1-qc="${v}" style="--h:${46 + v * 8}px" aria-label="${l} craving${isLiveDay(sel) ? ', now' : ''}"><span>${l}</span></button>`).join('')}
      </div>
      <button type="button" class="g1-big k-nausea" data-pk-evadd="nausea"><i>${G.nausea}</i><span>${EV_NAME.nausea}</span></button>
      <button type="button" class="g1-big k-more" data-g1-more aria-label="More to log"><i>${G.more}</i><span>More</span></button>
    </div>
    ${rows ? `<div class="g1-evs">${rows}</div>` : ''}
    ${flags.length ? `<div class="g1-flags">${flags.map((k) => `<button type="button" class="g1-flag" data-pk-flag="${k}" aria-label="Remove ${esc(FLAG_NAME[k] || k)}">${esc(FLAG_NAME[k] || k)}<span aria-hidden="true">${G.none}</span></button>`).join('')}</div>` : ''}
    ${foodChips}
    ${showNote ? `<textarea class="g1-note" data-pk-note rows="2" placeholder="Notes and comments" maxlength="4000" aria-label="Note for this day">${esc(f.note || '')}</textarea>` : ''}
    ${legacyBits.length ? `<p class="g1-foot">Before the timeline: ${legacyBits.map(esc).join(' · ')}</p>` : ''}
  </section>
  ${patterns(M)}${cvClose}`;
}
/** "This week", or "Sep 21 to 27" (the week tiles' own dates, audit d-glp1-34: a swipe needs a sign). */
function weekLabel(days) {
  if (days[days.length - 1] === todayIso()) return 'This week';
  const a = fromIso(days[0]), b = fromIso(days[days.length - 1]);
  return a.getMonth() === b.getMonth() ? `${mon(a)} ${a.getDate()} to ${b.getDate()}` : `${mon(a)} ${a.getDate()} to ${mon(b)} ${b.getDate()}`;
}
let noteOpen = null;
let worstOpen = null;   // the day whose worst craving row is open, this session only

/**
 * The day as a band (03 section 3.2): 5 am to 5 am, the level across it in the
 * medication colour, each event a bubble at its time. A craving's bubble takes
 * its size, height and colour from its strength; the other kinds are smaller
 * discs with their glyph. An event logged by part of the day only sits at that
 * part, drawn as a ring (its time is approximate). No words on the band; hours
 * and part of day glyphs sit under it.
 */
function dayBand(M, iso, evs) {
  const vb = viewBox();
  const W = colW('crave'), H = tier() ? 232 : 156;
  const pad = { l: 10, r: 10, t: 14, b: 40 };
  const ph = H - pad.t - pad.b;
  const A = 300, B = 1740;   // minutes from midnight: 5 am to 5 am
  const X = (min) => pad.l + ((min - A) / (B - A)) * (W - pad.l - pad.r);
  const day0 = midnight(iso);
  // The level through the day, from logged shots (none logged: no line).
  let levelSvg = '';
  if (M.shots.length) {
    const pts = [];
    for (let min = A; min <= B; min += 20) pts.push([min, pctAt(M, M.logged, day0 + min * 60e3)]);
    // The band's own scale: the day's swing fills the lower two thirds.
    const vmax = Math.max(...pts.map((q) => q[1])), vmin = Math.min(...pts.map((q) => q[1]));
    const hi = vmax + Math.max(8, (vmax - vmin)) * 0.9;
    const lo = Math.max(0, vmin - Math.max(8, (vmax - vmin)) * 0.6);
    const Y = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
    const d = pts.map(([min, v], i) => `${i ? 'L' : 'M'}${X(min).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const nowMin = (Date.now() - day0) / 60e3;
    const cut = nowMin > A && nowMin < B ? nowMin : null;
    levelSvg = `<path class="g1-blevel-area" d="${d}L${X(B).toFixed(1)},${pad.t + ph}L${X(A).toFixed(1)},${pad.t + ph}Z"/>
      <path class="g1-blevel" d="${d}"/>
      ${cut != null ? `<line class="g1-bnow" x1="${X(cut).toFixed(1)}" x2="${X(cut).toFixed(1)}" y1="${pad.t - 6}" y2="${pad.t + ph}"/><circle class="g1-bnowdot" cx="${X(cut).toFixed(1)}" cy="${Y(pctAt(M, M.logged, Date.now())).toFixed(1)}" r="3.5"/>` : ''}
      ${M.shots.filter((s) => s.t >= day0 + A * 60e3 && s.t < day0 + B * 60e3).map((s) => {
        const min = (s.t - day0) / 60e3;
        return `<g class="g1-bshot" transform="translate(${X(min).toFixed(1)},${(pad.t + ph).toFixed(1)})"><rect x="-5" y="-5" width="10" height="10" rx="2.5" transform="rotate(45)"/></g>`;
      }).join('')}`;
  }
  // Bubbles: cravings float by strength (stronger is higher), the rest ride a
  // lane near the floor. Two at nearly the same time step apart.
  const placed = [];
  const bubbles = evs.map((e) => {
    const min = evMinutes(e);
    const x = X(Math.min(B - 5, Math.max(A + 5, min)));
    const w = evWeight(e);
    const r = e.k === 'crave' ? 12 + w * 8 : e.k === 'nausea' ? 12 + w * 4 : 12;
    let y = e.k === 'crave' ? pad.t + ph * (0.78 - w * 0.62) : pad.t + ph * 0.8;
    for (const o of placed) if (Math.abs(o.x - x) < o.r + r && Math.abs(o.y - y) < o.r + r) y = Math.max(pad.t + r, o.y - o.r - r - 2);
    placed.push({ x, y, r });
    const approx = !e.t;
    const glyph = e.k === 'crave' ? '' : `<g class="g1-bg" transform="translate(${(x - 7).toFixed(1)},${(y - 7).toFixed(1)}) scale(.5833)">${(G[e.k] || '').replace(/<svg[^>]*>|<\/svg>/g, '')}</g>`;
    return `<g class="g1-bub k-${e.k}${e.k === 'crave' && e.c != null ? ` c${e.c}` : ''}${e.s ? ` s-${e.s}` : ''}${approx ? ' approx' : ''}" data-pk-ev="${esc(e.id)}" role="button" tabindex="0"
      aria-label="${esc(EV_NAME[e.k] || e.k)}, ${e.t ? clock(e.t) : esc(PART_NAME[e.part] || '')}${evDetail(e) ? `, ${esc(evDetail(e))}` : ''}">
      <circle class="g1-bhit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22"/><circle class="g1-bdot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>${glyph}</g>`;
  }).join('');
  // Under the band: each part of the day's glyph at the time an event logged by
  // that part sits (PART_MIN), and two clock times with am or pm (audit d-glp1-39).
  const hours = [[PART_MIN.wake, 'wake'], [PART_MIN.am, 'am'], [720, '12\u00a0PM'], [PART_MIN.pm, 'pm'], [PART_MIN.eve, 'eve'], [PART_MIN.night, 'night'], [1620, '3\u00a0AM']];
  const axis = hours.map(([min, k]) => {
    const x = X(min);
    const g = G[k];
    return `<line class="g1-btick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${pad.t + ph + 2}" y2="${pad.t + ph + 6}"/>${g
      ? `<g class="g1-bpart" transform="translate(${(x - 8).toFixed(1)},${(pad.t + ph + 12).toFixed(1)}) scale(.6667)">${g.replace(/<svg[^>]*>|<\/svg>/g, '')}</g>`
      : `<text class="g1-bhour" x="${x.toFixed(1)}" y="${(pad.t + ph + 24).toFixed(1)}">${k}</text>`}`;
  }).join('');
  bandState = { M, iso, evs, W, pad, ph, A, B, day0, X, placed };
  return `<div class="g1-band" data-g1-band>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="The day from 5 am to 5 am, ${evs.length} logged. Press and hold, then drag, to read any time.">
      <rect class="g1-bfloor" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${ph}" rx="14"/>
      ${levelSvg}${axis}
      <g class="g1-bguide" style="opacity:0"><line x1="0" x2="0" y1="${pad.t - 4}" y2="${pad.t + ph}"/></g>
      ${bubbles}
    </svg>
    <div class="g1-bread" data-g1-bread aria-hidden="true"></div>
  </div>`;
}
let bandState = null;

/**
 * The day band under his finger (round 3, one scrub grammar): press and hold, then drag
 * along the day; a plate above the band reads the time, the level then, and the event the
 * finger is on. A tick at every hour and every event. Release clears; a tap on a bubble
 * still opens it.
 */
function bindBand(root) {
  const band = root.querySelector('[data-g1-band]');
  const b = bandState;
  if (!band || !b) return;
  const svg = band.querySelector('svg');
  const guide = svg.querySelector('.g1-bguide');
  const read = band.querySelector('[data-g1-bread]');
  const minOf = (clientX) => {
    const x = userX(svg, clientX, b.W);
    return Math.min(b.B, Math.max(b.A, b.A + ((x - b.pad.l) / (b.W - b.pad.l - b.pad.r)) * (b.B - b.A)));
  };
  holdScrub(band, {
    at: (clientX) => {
      const min = minOf(clientX);
      const tol = ((b.B - b.A) / (b.W - b.pad.l - b.pad.r)) * 14;   // 14 pt either side
      const ev = b.evs.filter((e) => Math.abs(evMinutes(e) - min) <= tol).sort((x, y) => Math.abs(evMinutes(x) - min) - Math.abs(evMinutes(y) - min))[0] || null;
      return { key: ev ? `e${ev.id}` : `h${Math.floor(min / 60)}`, min, ev };
    },
    show: (r) => {
      const x = b.X(r.ev ? Math.min(b.B - 5, Math.max(b.A + 5, evMinutes(r.ev))) : r.min);
      guide.style.opacity = '1';
      guide.querySelector('line').setAttribute('x1', x.toFixed(1)); guide.querySelector('line').setAttribute('x2', x.toFixed(1));
      const t = b.day0 + r.min * 60e3;
      const bits = [r.ev && r.ev.t ? clock(r.ev.t) : r.ev ? PART_NAME[r.ev.part] || '' : clockOf(t)];
      if (b.M.shots.length) bits.push(`${r0(pctAt(b.M, b.M.logged, t))}%`);
      // One line (audit r3 glp1-05): the event and its strength, never its note; the plate
      // must leave the bubble and the level line under the finger in view. The whole
      // record is one tap away on the bubble.
      if (r.ev) bits.push(evShort(r.ev));
      read.innerHTML = `<b>${esc(bits[0])}</b>${bits.slice(1).map((x) => `<span>${esc(x)}</span>`).join('')}`;
      const rb = svg.getBoundingClientRect(), wb = band.getBoundingClientRect();
      const cx = rb.left - wb.left + (x / b.W) * rb.width;
      const w = read.offsetWidth || 160;
      read.style.transform = `translateX(${Math.max(0, Math.min(wb.width - w, cx - w / 2)).toFixed(1)}px)`;
      read.classList.add('on');
      band.querySelectorAll('.g1-bub').forEach((g) => g.classList.toggle('hot', !!r.ev && g.dataset.pkEv === r.ev.id));
    },
    hide: () => { guide.style.opacity = '0'; read.classList.remove('on'); band.querySelectorAll('.g1-bub.hot').forEach((g) => g.classList.remove('hot')); },
  });
}

// ..................................................... logging an event ..
/**
 * Write one event (or one per part of the day he picked) through the page's own
 * save path. The same record the timeline has always written: { id, k, t, part,
 * c, s, by, after, gap, all, nap, until, note }. The day's scale is the worst
 * craving of the day: a timed craving lifts it, never lowers what he set (his
 * call, 2026-09-28). Returns the records written.
 */
function writeEvents(iso, st, was, baseC) {
  const order = DAYPART.map(([k]) => k);
  const parts = st.t ? [st.part || partOfTime(st.t)] : [...(st.parts || [])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const recs = (parts.length ? parts : [null]).map((part, i) => {
    const rec = { id: i === 0 && (was || st.id) ? (was ? was.id : st.id) : `e${uid()}` };
    if (part) rec.part = part;
    for (const k of ['k', 't', 'c', 's', 'by', 'after', 'gap', 'all', 'nap', 'until', 'note']) if (st[k] != null && st[k] !== '') rec[k] = st[k];
    return rec;
  });
  save((d) => {
    const cur = { ...(d.pk.feel[iso] || {}) };
    const ids = new Set(recs.map((r) => r.id));
    cur.ev = [...(cur.ev || []).filter((e) => !ids.has(e.id)), ...recs];
    // A quick log being corrected (Strong, then Slight) starts again from the
    // day's value before it, so a slip never leaves the day too high.
    if (baseC !== undefined) cur.c = baseC;
    const rec = recs[0];
    if (rec.k === 'crave' && rec.c != null && (cur.c == null || cur.c < rec.c)) cur.c = rec.c;
    cur.c = cur.c ?? null;
    d.pk.feel[iso] = cur;
  });
  return recs;
}
/** Take events back out (the Undo after a quick log). */
function unwriteEvents(iso, ids, priorC) {
  save((d) => {
    const cur = { ...(d.pk.feel[iso] || {}) };
    cur.ev = (cur.ev || []).filter((e) => !ids.includes(e.id));
    if (!cur.ev.length) delete cur.ev;
    cur.c = priorC === undefined ? (cur.c ?? null) : priorC;
    if (feelEmpty(cur)) delete d.pk.feel[iso]; else d.pk.feel[iso] = cur;
  });
}

/** The foods of a day as After choices: a meal each, snacks one by one. */
function foodChoices(iso) {
  const items = foodFor(iso)?.items || [];
  const out = [];
  for (const meal of ['Breakfast', 'Lunch', 'Dinner']) {
    const inMeal = items.filter((x) => x.m === meal);
    if (inMeal.length) out.push({ v: meal, title: meal, sub: inMeal.map((x) => x.n).join(', '), kcal: inMeal.reduce((a, x) => a + (x.k || 0), 0) });
  }
  for (const n of new Set(items.filter((x) => !['Breakfast', 'Lunch', 'Dinner'].includes(x.m)).map((x) => x.n))) out.push({ v: n, title: n, sub: 'Snack' });
  return out;
}

/**
 * Log an event: the native sheet where the app has one (it returns what he
 * entered; this page writes it), else the page's own sheet. An edit always uses
 * the page's sheet, which holds Remove.
 */
async function logEvent(iso, kind) {
  const foods = foodChoices(iso);
  const nowT = localParts(Date.now()).time;
  const live = isLiveDay(iso);
  const res = await nativeFirst('sheet.event', {
    kind, dateIso: live ? todayIso() : iso, nowMs: Date.now(), defaultTime: live ? nowT : null,
    parts: DAYPART.map(([id, title]) => ({ id, title })),
    strengths: kind === 'crave' ? CRAVE.slice(1).map(([id, title]) => ({ id, title, colour: cssColour(`--crave-${id}`) })) : kind === 'nausea' ? STRENGTH.map(([id, title]) => ({ id, title })) : [],
    settlers: kind === 'crave' ? SETTLED.map(([id, title]) => ({ id, title })) : [],
    afters: kind === 'nausea' || kind === 'ate' ? [...foods.map((x) => ({ id: x.v, title: x.title, detail: x.sub })), ...(kind === 'nausea' ? [{ id: 'the shot', title: 'The shot' }, { id: 'nothing', title: 'Nothing in particular' }] : [])] : [],
    gaps: kind === 'nausea' ? AFTER_GAP.map(([id, title]) => ({ id, title })) : [],
  });
  if (res.web) { openEvent(iso, null, kind); return; }
  const ev = res.value;
  if (!ev || typeof ev !== 'object') return;   // he closed it
  const st = { k: kind };
  for (const k of ['c', 's', 'by', 'after', 'gap', 'all', 'nap', 'until', 'note']) if (ev[k] != null && ev[k] !== '') st[k] = ev[k];
  if (st.c != null) st.c = Math.max(1, Math.min(CRAVE_TOP, Number(st.c)));
  if (st.gap != null) st.gap = Number(st.gap);
  if (typeof ev.t === 'string' && /^\d\d:\d\d$/.test(ev.t)) st.t = ev.t;
  else if (Number.isFinite(ev.atMs)) st.t = localParts(ev.atMs).time;
  // The native sheet replies { ...first event, events: [every event] }: Earlier with
  // Morning and Evening picked is two events, so read every part (audit d-glp1-02).
  const evList = Array.isArray(ev.events) && ev.events.length ? ev.events : null;
  const parts = evList ? evList.map((x) => x && x.part).filter(Boolean) : Array.isArray(ev.parts) ? ev.parts : ev.part ? [ev.part] : [];
  st.parts = new Set(parts.filter((x) => PART_NAME[x]));
  if (st.t) st.part = st.parts.has('wake') ? 'wake' : partOfTime(st.t);
  if (!st.t && !st.parts.size) return;   // every event keeps its time (his rule)
  const asked = typeof ev.dateIso === 'string' && /^\d{4}-\d\d-\d\d$/.test(ev.dateIso) ? ev.dateIso : live ? todayIso() : iso;
  const day = eventDay(asked, st.t);
  if (day !== iso) pendingDay = day;
  const priorC = (pkDoc().feel || {})[day]?.c ?? null;
  const recs = writeEvents(day, st, null);
  sfx('logsaved');
  actionToast(`${esc(EV_NAME[kind] || 'Event')} logged`, 'Undo', () => unwriteEvents(day, recs.map((r) => r.id), priorC));
}

/**
 * The page's own event sheet (v3). Colour first: for a craving, four bars that
 * rise with strength in his ramp; a tap logs it now (when the day is today) and
 * the sheet stays open for the optional details, each of which updates the same
 * event. Nausea has two bars. When: "Now" as a capsule with the exact time, or
 * Earlier to pick parts of the day, each part its own event (as before).
 */
function openEvent(iso, id, kind) {
  const f = (pkDoc().feel || {})[iso] || {};
  const was = id ? (f.ev || []).find((e) => e.id === id) : null;
  const isToday = isLiveDay(iso);
  const st = was ? { ...was } : { k: kind, t: isToday ? localParts(Date.now()).time : '' };
  // Where a new event is stored: a time before 5 am today belongs to yesterday's band.
  let wIso = iso;
  const whereTo = () => { if (!was) wIso = eventDay(isToday ? todayIso() : iso, st.t); if (wIso !== iso) pendingDay = wIso; return wIso; };
  st.parts = new Set(was ? (was.part ? [was.part] : []) : []);
  if (!was && st.t) st.part = partOfTime(st.t);
  let savedIds = was ? [was.id] : null;   // a quick log writes once, then edits the same event
  let priorC = f.c ?? null;
  const foods = foodChoices(iso);
  const k = st.k;
  const tile = (key, v, label, glyph = '', sub = '') => `<button type="button" class="g1-tile ${String(st[key]) === String(v) ? 'on' : ''}" data-f="${key}" data-v="${esc(String(v))}" aria-pressed="${String(st[key]) === String(v)}">${glyph ? `<i>${glyph}</i>` : ''}<span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  const stair = k === 'crave' ? `<div class="g1-stair" role="group" aria-label="How strong">${CRAVE.slice(1).map(([v, l]) => `<button type="button" class="g1-step c${v} ${st.c === v ? 'on' : ''}" data-f="c" data-v="${v}" aria-pressed="${st.c === v}" style="--h:${40 + v * 22}px"><span>${l}</span></button>`).join('')}</div>`
    : k === 'nausea' ? `<div class="g1-stair two" role="group" aria-label="How strong">${STRENGTH.map(([v, l], i) => `<button type="button" class="g1-step n${i} ${st.s === v ? 'on' : ''}" data-f="s" data-v="${v}" aria-pressed="${st.s === v}" style="--h:${70 + i * 40}px"><span>${l}</span></button>`).join('')}</div>` : '';
  let tray = '';
  if (k === 'crave') tray = `<h3>What settled it</h3><div class="g1-tiles three">${SETTLED.map(([v, l]) => tile('by', v, l, G[v])).join('')}</div>`;
  if (k === 'nausea') tray = `<h3>After</h3><div class="g1-tiles">${[...foods.map((x) => tile('after', x.v, x.title, '', x.kcal ? `${x.kcal.toLocaleString('en-US')} kcal` : x.sub)), tile('after', 'the shot', 'The shot', G.shot), tile('after', 'nothing', 'Nothing in particular')].join('')}</div>
      <div class="g1-gaps" data-g1-gaps ${st.after && st.after !== 'nothing' ? '' : 'hidden'}><h3>How long after</h3><div class="g1-seg">${AFTER_GAP.map(([v, l]) => `<button type="button" class="${st.gap === v ? 'on' : ''}" data-f="gap" data-v="${v}" aria-pressed="${st.gap === v}">${l}</button>`).join('')}</div></div>`;
  if (k === 'headache') tray = `<div class="g1-tiles">${tile('all', 1, 'All day', G.headache)}</div>`;
  if (k === 'tired') tray = `<div class="g1-tiles">${tile('nap', 1, 'Took a nap', G.tired)}</div><label class="g1-inline" data-g1-until ${st.nap ? '' : 'hidden'}><span>Nap until</span><input type="time" data-f-until value="${esc(st.until || '')}"></label>`;
  if (k === 'ate') tray = foods.length ? `<div class="g1-tiles">${foods.map((x) => tile('after', x.v, x.title, '', x.kcal ? `${x.kcal.toLocaleString('en-US')} kcal` : x.sub)).join('')}</div>` : '';
  const quick = !was && isToday && (k === 'crave' || k === 'nausea');
  const body = `<div class="g1-evsheet k-${k}">
    <div class="g1-when">
      <label class="g1-capsule" data-g1-now ${st.parts.size > 1 || (!st.t && st.parts.size) ? 'hidden' : ''}>${G.calendar}<span data-g1-whenlab>${st.t ? `${isToday ? 'Today' : esc(dayName(midnight(iso)))}, ${clock(st.t)}` : 'Pick a time'}</span><input type="time" data-f-t value="${esc(st.t || '')}" aria-label="Time"></label>
      <button type="button" class="g1-capsule alt ${st.parts.size && !st.t ? 'on' : ''}" data-g1-earlier aria-pressed="${!!(st.parts.size && !st.t)}">Part of the day</button>
    </div>
    <div class="g1-parts" data-g1-parts ${!st.t ? '' : 'hidden'}>${DAYPART.map(([v, l]) => `<button type="button" class="g1-part ${st.parts.has(v) && !st.t ? 'on' : ''}" data-part="${v}" aria-pressed="${st.parts.has(v) && !st.t}"><i>${G[v]}</i><span>${l}</span></button>`).join('')}</div>
    ${stair}
    <div class="g1-tray" data-g1-tray ${quick && st.c == null && st.s == null ? 'hidden' : ''}>${tray}
      <input class="g1-comment" data-f-note type="text" maxlength="300" placeholder="Comment" value="${esc(st.note || '')}" aria-label="Comment"></div>
    ${was ? '<button type="button" class="g1-remove" data-ev-del>Remove</button>' : ''}
  </div>`;
  const footer = `<button type="button" class="btn primary" data-ev-save>${was ? 'Save' : quick ? 'Done' : 'Add'}</button>`;
  openModal({
    title: `${EV_NAME[k] || 'Event'}${isToday ? '' : `, ${dayName(midnight(iso))}`}`, body, footer,
    onMount(back) {
      const sheet = back.querySelector('.g1-evsheet');
      const tInput = sheet.querySelector('[data-f-t]');
      const saveBtn = back.querySelector('[data-ev-save]');
      const mark = (key) => sheet.querySelectorAll(`[data-f="${key}"]`).forEach((x) => { const on = String(st[key]) === x.dataset.v; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      const whenLab = () => { const l = sheet.querySelector('[data-g1-whenlab]'); if (l) l.textContent = st.t ? `${isToday ? 'Today' : dayName(midnight(iso))}, ${clock(st.t)}` : 'Pick a time'; };
      const collect = () => { st.note = sheet.querySelector('[data-f-note]').value.trim(); };
      // A quick log whose time was changed across 5 am moves to the right date.
      const relocate = () => {
        if (was || !savedIds) return;
        const to = eventDay(isToday ? todayIso() : iso, st.t);
        if (to === wIso) return;
        unwriteEvents(wIso, savedIds, priorC);
        wIso = to; priorC = (pkDoc().feel || {})[wIso]?.c ?? null; savedIds = null;
        if (wIso !== iso) pendingDay = wIso;
      };
      // A quick log writes at once, then every later pick edits the same event.
      const commit = () => {
        collect();
        if (!st.t) return false;
        st.part = st.parts.has('wake') ? 'wake' : partOfTime(st.t);
        relocate();
        if (!savedIds) { whereTo(); priorC = (pkDoc().feel || {})[wIso]?.c ?? null; }
        const recs = writeEvents(wIso, { ...st, id: savedIds ? savedIds[0] : null }, was, priorC);
        if (!savedIds) {
          savedIds = recs.map((r) => r.id);
          tick('light'); sfx('logsaved');
          const at = wIso;
          actionToast(`${esc(EV_NAME[k])} logged`, 'Undo', () => { unwriteEvents(at, savedIds, priorC); closeModal(); });
        }
        return true;
      };
      sheet.addEventListener('click', (e) => {
        const b = e.target.closest('[data-f]');
        if (b) {
          const key = b.dataset.f;
          const v = ['gap', 'all', 'nap', 'c'].includes(key) ? Number(b.dataset.v) : b.dataset.v;
          const strength = key === 'c' || key === 's';
          st[key] = strength ? v : String(st[key]) === String(v) ? null : v;
          mark(key);
          tick();
          if (strength) {
            sheet.style.setProperty('--wash', `var(--${key === 'c' ? `crave-${v}` : 'g1-nausea'})`);
            sheet.classList.add('washed');
            sheet.querySelector('[data-g1-tray]').hidden = false;
          }
          if (key === 'after') sheet.querySelector('[data-g1-gaps]')?.toggleAttribute('hidden', !st.after || st.after === 'nothing');
          if (key === 'nap') sheet.querySelector('[data-g1-until]')?.toggleAttribute('hidden', !st.nap);
          if (quick && (st.c != null || st.s != null)) commit();
          return;
        }
        const part = e.target.closest('[data-part]');
        if (part) {
          const v = part.dataset.part;
          if (st.parts.has(v)) st.parts.delete(v); else st.parts.add(v);
          st.t = ''; tInput.value = '';
          sheet.querySelectorAll('[data-part]').forEach((x) => { const on = st.parts.has(x.dataset.part); x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
          tick();
          return;
        }
        if (e.target.closest('[data-g1-earlier]')) {
          const eb = sheet.querySelector('[data-g1-earlier]');
          const on = eb.getAttribute('aria-pressed') !== 'true';
          eb.setAttribute('aria-pressed', String(on)); eb.classList.toggle('on', on);
          sheet.querySelector('[data-g1-parts]').hidden = !on;
          if (on) { st.t = ''; tInput.value = ''; st.parts = new Set(); whenLab(); }
          else if (!st.t) { st.t = isToday ? localParts(Date.now()).time : ''; tInput.value = st.t; st.parts = new Set(); whenLab(); }
        }
      });
      tInput.addEventListener('change', () => {
        st.t = tInput.value;
        if (st.t) {
          st.part = st.parts.has('wake') ? 'wake' : partOfTime(st.t);
          st.parts = new Set([st.part]);
          sheet.querySelector('[data-g1-parts]').hidden = true;
          const eb = sheet.querySelector('[data-g1-earlier]'); eb.classList.remove('on'); eb.setAttribute('aria-pressed', 'false');
        }
        whenLab();
        if (savedIds && !was) commit();
      });
      sheet.querySelector('[data-f-until]')?.addEventListener('change', (e) => { st.until = e.target.value; });
      saveBtn.addEventListener('click', () => {
        collect();
        // Done on a quick sheet where nothing was picked: nothing to log, just close.
        if (quick && !savedIds && st.c == null && st.s == null && !st.parts.size && !st.note) { closeModal(); return; }
        if (!st.t && !st.parts.size) { toast('Pick when it happened', 'bad'); return; }
        if (st.t) st.part = st.parts.has('wake') && st.parts.size === 1 ? 'wake' : partOfTime(st.t);
        relocate();
        if (!was && !savedIds) { whereTo(); priorC = (pkDoc().feel || {})[wIso]?.c ?? null; }
        writeEvents(wIso, { ...st, id: savedIds && !was ? savedIds[0] : null }, was, savedIds && !was ? priorC : undefined);
        closeModal();
      });
      back.querySelector('[data-ev-del]')?.addEventListener('click', () => {
        save((d) => {
          const cur = { ...(d.pk.feel[iso] || {}) };
          cur.ev = (cur.ev || []).filter((e) => e.id !== was.id);
          if (!cur.ev.length) delete cur.ev;
          cur.c = cur.c ?? null;
          if (feelEmpty(cur)) delete d.pk.feel[iso]; else d.pk.feel[iso] = cur;
        });
        closeModal();
        actionToast(`Removed ${esc(EV_NAME[was.k] || 'it')}`, 'Undo', () => save((d) => {
          const cur = { ...(d.pk.feel[iso] || {}) };
          cur.ev = [...(cur.ev || []), was];
          cur.c = cur.c ?? null;
          d.pk.feel[iso] = cur;
        }));
      });
    },
  });
}

// .............................................................. Patterns ..
// v3 (03 section 3.7, ruling 07 K7): the cycle grid as the hero (a row per shot,
// a column per day after it, each cell his worst craving that day), two big
// numbers instead of six tiles, when things happen with glyphs for the parts of
// the day, and what nausea came after. No scatter of dots (he said he could not
// read it); a tile with no data is hidden, never a bare dot.
function patterns(M) {
  const p = prefs();
  const feel = pkDoc().feel || {};
  const rows = Object.entries(feel).filter(([, f]) => f && f.c != null)
    .map(([d, f]) => ({ d, c: f.c, level: dayLevel(M, d), cd: cycleDay(M, d) }))
    .filter((r) => r.level != null);
  if (!rows.length) return '';
  const yes = rows.filter((r) => r.c > 0);
  const cut = bestCut(rows.map((r) => ({ level: r.level, craving: r.c > 0 })));
  const big = [
    `<div class="g1-bignum"><b>${yes.length}<small> of ${rows.length}</small></b><span>Days with a craving</span></div>`,
    cut ? `<div class="g1-bignum" aria-label="Cravings come below ${r0(cut.cut)}%, right on ${cut.right} of ${cut.total} days"><b>${r0(cut.cut)}<small>%</small></b><span>Cravings come below this level</span></div>` : '',
  ].join('');
  return `<section class="g1-sec g1-patterns">
    <div class="g1-sechead"><h2>Patterns</h2></div>
    <div class="g1-bignums">${big}</div>
    ${cycleGrid(M, feel)}
    ${whenGrid(feel)}
  </section>`;
}

function cycleGrid(M, feel) {
  const shots = M.shots;
  if (!shots.length) return '';
  const today = todayIso();
  const cycles = shots.map((s, i) => {
    const from = isoOf(s.t);
    const next = shots[i + 1] ? isoOf(shots[i + 1].t) : null;
    const cells = Array.from({ length: 8 }, (_, d) => {
      const iso = addDays(from, d);
      if ((next && iso >= next) || iso > today) return { iso: null };
      return { iso, c: feel[iso]?.c ?? null };
    });
    return { s, cells };
  }).filter((cy) => cy.cells.some((x) => x.c != null)).slice(-10);
  if (!cycles.length) return '';
  const head = ['Shot', '1', '2', '3', '4', '5', '6', '7'].map((l) => `<span class="h">${l}</span>`).join('');
  return `<div class="g1-cycles">
    <h3>Each shot, day by day</h3>
    <div class="g1-cgrid"><span class="h"></span>${head}
    ${cycles.map((cy) => {
      const d = new Date(cy.s.t);
      return `<span class="r">${mon(d)} ${d.getDate()}</span>${cy.cells.map((x) => (x.iso
        ? `<button type="button" class="g1-cc ${x.c != null ? `c${x.c}` : 'hollow'}" data-g1-cday="${x.iso}" aria-label="${esc(dayName(midnight(x.iso)))}${x.c != null ? `, ${CRAVE[x.c][1]}` : ', not logged'}"></button>`
        : '<span class="g1-cc none"></span>')).join('')}`;
    }).join('')}</div>
    <div class="g1-ramp" aria-hidden="true">${CRAVE.map(([v, l]) => `<span><i class="c${v}"></i>${l}</span>`).join('')}</div>
  </div>`;
}

/** When each symptom happens, counted from the timeline (and, for cravings, the
 *  older day-level times), plus what came before nausea. */
function whenGrid(feel) {
  const kinds = ['crave', 'nausea', 'headache', 'tired'];
  const n = Object.fromEntries(kinds.map((k) => [k, Object.fromEntries(DAYPART.map(([d]) => [d, 0]))]));
  const after = {};
  let any = false;
  for (const f of Object.values(feel)) {
    for (const e of f.ev || []) {
      if (!n[e.k] || !e.part) continue;
      n[e.k][e.part]++; any = true;
      if (e.k === 'nausea' && e.after && e.after !== 'nothing') after[e.after] = (after[e.after] || 0) + 1;
    }
    if (!(f.ev || []).some((e) => e.k === 'crave') && f.c > 0) for (const w of f.when || []) if (n.crave[w] != null) { n.crave[w]++; any = true; }
  }
  if (!any) return '';
  const used = kinds.filter((k) => DAYPART.some(([d]) => n[k][d]));
  const max = Math.max(1, ...used.flatMap((k) => DAYPART.map(([d]) => n[k][d])));
  const top = Object.entries(after).sort((a, b) => b[1] - a[1]).slice(0, 4);
  return `<div class="g1-when">
    <h3>When things happen</h3>
    <div class="g1-wgrid" style="--cols:${DAYPART.length}"><span class="h"></span>${DAYPART.map(([d, l]) => `<span class="h" title="${l}" aria-label="${l}">${G[d]}</span>`).join('')}
      ${used.map((k) => `<span class="r k-${k}"><i>${G[k]}</i>${esc(EV_NAME[k])}</span>${DAYPART.map(([d]) => `<span class="v k-${k}" style="--a:${(n[k][d] / max).toFixed(2)}">${n[k][d] || ''}</span>`).join('')}`).join('')}
    </div>
    ${top.length ? `<div class="g1-afters"><small>Nausea came after</small>${top.map(([x, c]) => `<span>${esc(x)}<b>${c}</b></span>`).join('')}</div>` : ''}
  </div>`;
}

// ............................................................ Schedules ..
// ............................................................... What If ..
// His ask (2026-09-19): find the most cost effective schedule that keeps him in
// his range, again and again as his tolerance grows. So the answer comes first
// (best value), then the picture (any schedules, each its own colour, settled
// or from today, 1 to 12 weeks), then one card per schedule, then the full
// numbers folded away. Plain words: low, high, a month.
const SERIES = 10;   // --s0 to --s9 in styles.css; each schedule keeps its own
const WEEKS = [1, 2, 4, 8, 12];
const planName = (pl) => `${mgStr(pl.mg)} mg every ${mgStr(pl.everyDays)} days`;
const planShort = (pl) => `${mgStr(pl.mg)} mg / ${mgStr(pl.everyDays)} d`;
function planColors(list) {
  const out = {};
  const used = new Set(list.map((p) => p.color).filter((c) => Number.isInteger(c)));
  let next = 0;
  for (const p of list) {
    if (Number.isInteger(p.color)) { out[p.id] = p.color % SERIES; continue; }
    while (used.has(next) && next < SERIES) next++;
    out[p.id] = next < SERIES ? next : (list.indexOf(p) % SERIES);
    used.add(out[p.id]);
  }
  return out;
}
function selected(list) {
  const raw = lsGet('plans', null);
  if (raw == null) return null;
  const ids = raw.split(',').filter(Boolean);
  return new Set(ids.filter((id) => list.some((p) => p.id === id)));
}

/** Priming for a pen: his clicks per new needle, the first shots covered. */
function primeFor(pen, p) {
  if (!pen.clicks) return null;
  return { mg: (Number(p.primeClicks) || 0) * (pen.mg / (pen.doses || 4) / pen.clicks), free: Number.isFinite(Number(p.freePrimes)) ? Number(p.freePrimes) : Infinity };
}
/** "39 clicks, plus 2 to prime", or a warning when the dose falls between clicks. */
function clickText(pm) {
  if (pm.clicks == null) return '';
  const pr = Number(prefs().primeClicks) || 0;
  if (!pm.wholeClicks) return `${pm.clicks.toFixed(1)} clicks, not a whole click`;
  if (pm.sticks > 1) return `${pm.stickClicks.map((c) => Math.round(c)).join(' + ')} clicks, ${pm.sticks} shots${pr ? `, each primed ${pr}` : ''}`;
  return `${Math.round(pm.clicks)} clicks${pr ? `, plus ${pr} to prime` : ''}`;
}
/** Clicks as a short fact: "40 clicks", "60 + 12 clicks". */
function clickFact(pm) {
  if (pm.clicks == null) return '';
  if (!pm.wholeClicks) return `${pm.clicks.toFixed(1)} clicks`;
  return pm.sticks > 1 ? `${pm.stickClicks.map((c) => Math.round(c)).join(' + ')} clicks` : `${Math.round(pm.clicks)} clicks`;
}
/** Against the weeks the pen is sold as: "1 week short of 4, lose $100". */
function soldText(pm) {
  const d = pm.vsSoldDays, sold = pm.soldDays / 7;
  if (Math.abs(d) < 0.05) return `Exactly the ${sold} weeks it is sold as`;
  const n = Math.abs(d);
  const span = n % 7 < 0.05 ? `${n / 7} week${n === 7 ? '' : 's'}` : `${+n.toFixed(1)} day${n === 1 ? '' : 's'}`;
  return d < 0 ? `${span} short of ${sold} weeks, lose $${Math.round(-pm.vsSoldValue)}`
    : `${span} over ${sold} weeks, gain $${Math.round(pm.vsSoldValue)}`;
}

/** Everything the page says about one schedule. */
function planFacts(M, pl, p, penList, penPick = 'best') {
  const ss = steadyState(M.params, pl.mg, pl.everyDays);
  const high = (ss.peak / M.refAvg) * 100, low = (ss.trough / M.refAvg) * 100, avg = (ss.avg / M.refAvg) * 100;
  const tooLow = low < p.rangeMin - 1e-9, tooHigh = high > p.rangeMax + 1e-9;
  const byPen = penList.map((pen) => ({ pen, pm: penMath(pl.mg, pl.everyDays, pen, p.windowDays, primeFor(pen, p)) }));
  const best = penPick !== 'best' ? byPen.find((x) => x.pen.id === penPick && x.pm.cost30Real != null) || null
    : byPen.filter((x) => x.pm.cost30Real != null).sort((a, b) => a.pm.cost30Real - b.pm.cost30Real)[0] || null;
  return { pl, ss, high, low, avg, inRange: !tooLow && !tooHigh, tooLow, tooHigh, byPen, best, settle: settleOf(M, pl, ss) };
}
/** Switching at his next shot: when the lows are steady (within 2% of the
 *  settled low, and staying there), and the first and settled low. */
function settleOf(M, pl, ss) {
  if (!M.last) return null;
  const run = fromToday(M, pl);
  const lows = run.doses.filter((d) => d.proj).slice(1).map((d) => ({ t: d.t, v: (at(run.sim, d.t - 60e3) / M.refAvg) * 100 }));
  if (!lows.length) return null;
  const target = (ss.trough / M.refAvg) * 100;
  let k = lows.length;
  while (k > 0 && Math.abs(lows[k - 1].v - target) / target <= 0.02) k--;
  if (k === lows.length) return null;
  return { t: lows[k].t, first: lows[0].v, settled: target };
}
function settleText(st) {
  if (!st) return '';
  return `Steady by ${dayName(st.t)}, lows ${r0(st.first)} to ${r0(st.settled)}%`;
}
/** What goes in the bin with the pen: mg left, and what it cost. */
function wasteText(b) {
  const left = b.pm.left;
  if (!(left > 0.005)) return 'None';
  return `${+left.toFixed(2)} mg ($${Math.round(left * (b.pen.price / b.pen.mg))})`;
}
/** A standard labelled dose, once a week (the label's schedule). */
function onLabel(M, pl) {
  return Number(pl.everyDays) === Number(M.ref.everyDays) && (M.drug.doses || []).includes(Number(pl.mg));
}
function statusText(f, p) {
  if (f.inRange) return 'Stays in your range';
  if (f.tooLow && f.tooHigh) return `Dips under ${p.rangeMin}% and peaks over ${p.rangeMax}%`;
  return f.tooLow ? `Dips under ${p.rangeMin}%` : `Peaks over ${p.rangeMax}%`;
}

const menuBtn = (attr, label, value) => `<button type="button" class="g1-menubtn" ${attr}><span>${esc(label)}</span><b>${esc(value)}</b>${G.chevron}</button>`;
const SORTS = [['order', 'My order'], ['price', 'Price'], ['potency', 'Potency']];
const HSORTS = [['order', 'My order'], ['price', 'Price'], ['level', 'Low to high']];

function renderSchedules(M, ctx) {
  const p = prefs();
  const list = plans();
  const penList = pens();
  const colors = planColors(list);
  const penPick = penList.some((x) => x.id === lsGet('spen', 'best')) ? lsGet('spen', 'best') : 'best';
  const facts = list.map((pl) => planFacts(M, pl, p, penList, penPick));
  // His sort (2026-09-19): his own order, cheapest first, or strongest first.
  const sort = lsGet('ssort', 'order');
  if (sort === 'price') facts.sort((a, b) => (a.best ? a.best.pm.cost30Real : Infinity) - (b.best ? b.best.pm.cost30Real : Infinity) || b.avg - a.avg);
  if (sort === 'potency') facts.sort((a, b) => b.avg - a.avg);
  const good = facts.filter((f) => f.inRange && f.best).sort((a, b) => a.best.pm.cost30Real - b.best.pm.cost30Real || (a.high - a.low) - (b.high - b.low));
  const best = good[0] || null;
  let sel = selected(list);
  if (!sel) sel = new Set((good.length ? good.slice(0, 3) : facts.slice(0, 3)).map((f) => f.pl.id));
  const mode = lsGet('smode', 'settled');
  const weeks = Number(lsGet('sweeks', '4')) || 4;
  const penLabel = penPick === 'best' ? 'Cheapest' : (penList.find((x) => x.id === penPick) || {}).name || 'Cheapest';

  // The answer first (audit W3): the schedule big, its month and its range as
  // two numbers, the pen facts in one line.
  const bestCard = best ? `
    <div class="g1-best" style="--c:var(--s${colors[best.pl.id]})">
      <small>Best value in your range</small>
      <b class="g1-bestname"><i class="g1-sw"></i>${planName(best.pl)}</b>
      <div class="g1-bestnums">
        <span><b>$${Math.round(best.best.pm.cost30Real)}</b><small>a month</small></span>
        <span><b>${r0(best.low)} to ${r0(best.high)}%</b><small>low to high</small></span>
      </div>
      <p class="g1-bestmeta">${[best.best.pen.name, `lasts ${+best.best.pm.realSupplyDays.toFixed(1)} d`, clickFact(best.best.pm), `${wasteText(best.best)} thrown out`].filter(Boolean).map(esc).join(' · ')}</p>
    </div>` : `
    <div class="g1-best none"><small>Best value in your range</small><b class="g1-bestname">${penList.length ? `None stay between ${p.rangeMin}% and ${p.rangeMax}%` : 'Add a pen to compare costs'}</b></div>`;

  const cards = facts.map((f) => {
    const c = colors[f.pl.id];
    const on = sel.has(f.pl.id);
    const scaleMax = Math.max(p.rangeMax * 1.15, ...facts.map((x) => x.high));
    const pos = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100)).toFixed(2)}%`;
    return `<div class="pk-plan ${on ? 'on' : ''} ${f.inRange ? 'ok' : 'out'} ${best && best.pl.id === f.pl.id ? 'best' : ''}" style="--c:var(--s${c})">
      <button type="button" class="pk-ptop" data-pk-toggle="${esc(f.pl.id)}" aria-pressed="${on}">
        <span class="pk-pbox" aria-hidden="true"></span>
        <span class="pk-ptitle"><b>${planName(f.pl)}</b><small>${esc(statusText(f, p))}${best && best.pl.id === f.pl.id ? ' · best value' : ''}${onLabel(M, f.pl) ? ' · label dose' : ''}</small></span>
      </button>
      <div class="pk-pbar" aria-hidden="true">
        <i class="zone" style="left:${pos(p.rangeMin)};width:calc(${pos(p.rangeMax)} - ${pos(p.rangeMin)})"></i>
        <i class="span" style="left:${pos(f.low)};width:calc(${pos(f.high)} - ${pos(f.low)})"></i>
      </div>
      <div class="pk-pfacts">
        <span><b>${r0(f.low)} to ${r0(f.high)}%</b><small>Low to high</small></span>
        <span><b>${f.best ? `$${Math.round(f.best.pm.cost30Real)}` : '·'}</b><small>${f.best ? `A month, ${esc(f.best.pen.name)}` : penList.length ? 'Dose bigger than a pen' : 'Add a pen'}</small></span>
        ${f.best && f.best.pm.clicks != null ? `<span><b>${esc(clickFact(f.best.pm))}</b><small>${Number(p.primeClicks) ? `Plus ${Number(p.primeClicks)} to prime` : 'A dose'}</small></span>` : ''}
        ${f.settle ? `<span><b>${esc(`${mon(new Date(f.settle.t))} ${new Date(f.settle.t).getDate()}`)}</b><small>Steady by</small></span>` : ''}
        <span><b>${f.best ? `${+f.best.pm.realSupplyDays.toFixed(1)} d` : '·'}</b><small>A pen lasts</small></span>
        <span><b>${f.best ? wasteText(f.best) : '·'}</b><small>Thrown out</small></span>
      </div>
      <button type="button" class="pk-phide" data-pk-hide="${esc(f.pl.id)}" aria-label="Hide ${esc(planName(f.pl))}">Hide</button>
    </div>`;
  }).join('');

  const sw = mode === 'today' && M.last ? switchLine(M, list, p) : null;
  const wide = tier() > 0;
  return `
  <div class="g1-wihead">
    ${penList.length > 1 ? menuBtn('data-g1-spen', 'Pen', penLabel) : '<span></span>'}
    <button type="button" class="g1-info" data-g1-infotoggle aria-label="What the percents mean" aria-expanded="false">${G.info}</button>
  </div>
  <p class="g1-about" hidden>Every percent here is against one schedule: 100% is the average on ${mgStr(M.ref.mg)} mg every ${M.ref.everyDays} days, at your size.</p>
  ${wide ? `<div class="g1-wigrid" style="--c1:${colW('whatif')}px;--gap:${COL_GAP}px"><div class="g1-wileft">` : ''}
  ${bestCard}
  <section class="g1-sec g1-compare">
    <div class="g1-sechead"><h2>Compare</h2>${menuBtn('data-g1-smode', '', mode === 'settled' ? 'Once settled' : 'From today')}</div>
    <div class="pk-cbody" data-pk-body="compare">${compareChart(M, facts.filter((f) => sel.has(f.pl.id)), colors, p, mode, weeks)}</div>
    <div class="g1-ctrl">
      <div class="g1-range" role="group" aria-label="Weeks">${WEEKS.map((w) => `<button type="button" class="${weeks === w ? 'on' : ''}" data-pk-sweeks="${w}" aria-pressed="${weeks === w}">${w}W</button>`).join('')}</div>
      <div class="g1-chips"><button type="button" class="g1-link" data-pk-all="1">All</button><button type="button" class="g1-link" data-pk-all="0">None</button></div>
    </div>
    <div class="g1-legchips" role="group" aria-label="Schedules on the chart">
      ${sw ? `<button type="button" class="g1-lchip ${lsGet('swline', '1') === '1' ? 'on' : ''}" style="--c:var(--ink)" data-pk-swline aria-pressed="${lsGet('swline', '1') === '1'}"><i></i>Your switch<small>new pen ${mon(new Date(sw.land))} ${new Date(sw.land).getDate()}</small></button>` : ''}
      ${mode === 'today' && M.last ? routes().map((r) => `<button type="button" class="g1-lchip ${routeOn(r.id) ? 'on' : ''}" style="--c:var(--s${r.color ?? 0})" data-pk-route="${esc(r.id)}" aria-pressed="${routeOn(r.id)}"><i></i>${esc(r.name || 'Route')}${r.pen ? `<small>new pen ${mon(fromIso(r.pen))} ${fromIso(r.pen).getDate()}</small>` : ''}</button>`).join('') : ''}
      ${facts.map((f) => `<button type="button" class="g1-lchip ${sel.has(f.pl.id) ? 'on' : ''}" style="--c:var(--s${colors[f.pl.id]})" data-pk-toggle="${esc(f.pl.id)}" aria-pressed="${sel.has(f.pl.id)}"><i></i>${esc(planShort(f.pl))}</button>`).join('')}
    </div>
  </section>
  ${wide ? '</div><div class="g1-wiright">' : switchPlanner(M, list, penList, p)}
  <section class="g1-sec">
    <div class="g1-sechead"><h2>Your schedules</h2>${menuBtn('data-g1-ssort', 'Sort', (SORTS.find(([k]) => k === sort) || SORTS[0])[1])}</div>
    <p class="pk-hint"><i class="zone"></i>Your range, ${p.rangeMin} to ${p.rangeMax}% <i class="span"></i>Between shots</p>
    <div class="pk-plans">${cards}</div>
    <form class="pk-add pk-try" data-pk-add aria-label="Try another schedule">
      <label><input class="in-num" type="number" inputmode="decimal" step="any" min="0.05" name="mg" placeholder="mg" aria-label="Dose in mg" required></label>
      <span>mg every</span>
      <label><input class="in-num" type="number" inputmode="decimal" step="any" min="0.5" name="every" placeholder="days" aria-label="Every how many days" required></label>
      <span>days</span>
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${finder(penList, p, penPick)}
    ${hiddenPlans(M, p, penList, penPick, colors)}
  </section>
  ${wide ? `</div></div>${switchPlanner(M, list, penList, p)}` : ''}
  <section class="g1-sec g1-rangepens">
    <div class="g1-sechead"><h2>Your range and pens</h2></div>
    <div class="sc-tiles n6 pk-set">
      <label class="sc-tile"><small>Lowest you want</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="decimal" data-pk-pref="rangeMin" value="${p.rangeMin}" min="0" max="400"><b>%</b></span></label>
      <label class="sc-tile"><small>Highest you want</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="decimal" data-pk-pref="rangeMax" value="${p.rangeMax}" min="0" max="400"><b>%</b></span></label>
      <label class="sc-tile"><small>Your shot, every</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="decimal" step="0.5" data-pk-pref="everyDays" value="${p.everyDays}" min="1" max="28"><b>days</b></span></label>
      <label class="sc-tile"><small>Pen use by</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="numeric" data-pk-pref="windowDays" value="${p.windowDays}" min="1" max="90"><b>days</b></span></label>
      <label class="sc-tile"><small>Priming, every shot</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="numeric" data-pk-pref="primeClicks" value="${p.primeClicks}" min="0" max="20"><b>clicks</b></span></label>
      <label class="sc-tile"><small>Pen's extra fill covers</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="numeric" data-pk-pref="freePrimes" value="${p.freePrimes}" min="0" max="12"><b>primes</b></span></label>
    </div>
    ${rangeFromLog(M, p)}
    ${penList.length ? `<div class="pk-pens">${penList.map((x) => `<div class="pk-pen"><b>${esc(x.name)}</b><small>${[`${mgStr(x.mg)} mg`, money(x.price), `${money(x.price / x.mg)} a mg`, x.clicks ? `${x.clicks} clicks a dose` : ''].filter(Boolean).map(esc).join(' · ')}</small></div>`).join('')}</div>` : ''}
  </section>
  ${numbersTable(M, facts, colors, p, penPick)}
  ${labelTiles(M)}`;
}

// ......................................................... Plan a switch ..
// His ask (2026-09-24): what was worked out by hand that day, done by the page.
// Where he is (his last shot and his interval), where he wants to land (a
// schedule, a weekday, the date the new pen is in hand), and the shots between,
// with clicks. If the first new shot would lift him above where the new
// schedule settles, the first shot is made smaller so the level only climbs.
const WDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const switchCache = new Map();
function planSwitch(M, target, penFromIso, weekday) {
  if (!M.last) return null;
  const key = JSON.stringify([target.mg, target.everyDays, penFromIso, weekday, M.every, M.shots.map((s) => [s.t, s.mg]), JSON.stringify(M.params), Math.floor(M.now / 3600e3)]);
  if (switchCache.has(key)) return switchCache.get(key);
  if (switchCache.size > 20) switchCache.clear();
  const penT = Math.max(M.now, midnight(penFromIso));
  const cur = [];
  let t = later(M.last.t, M.every);
  while (t < M.now) t = later(t, M.every);
  while (isoOf(t) < isoOf(penT)) { cur.push({ t, mg: M.last.mg }); t = later(t, M.every); }
  const L = cur.length ? cur[cur.length - 1].t : M.last.t;
  let land = null;
  if (weekday == null) land = later(L, M.every);
  else for (let d = 3; d <= 9 && !land; d++) { const c = later(L, d); if (new Date(c).getDay() === weekday && isoOf(c) >= isoOf(penT)) land = c; }
  if (!land) { const r = { cur, land: null }; switchCache.set(key, r); return r; }
  const weeks = 10;
  const after = [];
  for (let x = land; x <= land + weeks * 7 * DAY; x = later(x, target.everyDays)) after.push(x);
  const ss = steadyState(M.params, target.mg, target.everyDays);
  const settledPeak = (ss.peak / M.refAvg) * 100;
  const run = (firstMg) => {
    const doses = [...M.shots, ...cur, ...after.map((x, i) => ({ t: x, mg: i === 0 ? firstMg : target.mg }))];
    const sim = simulate(M.params, doses, Math.min(M.t0, M.now - DAY), after[after.length - 1] + DAY);
    let peak = 0;
    for (let x = land; x <= after[after.length - 1]; x += 2 * HOUR) peak = Math.max(peak, (at(sim, x) / M.refAvg) * 100);
    return { peak, sim };
  };
  const full = run(target.mg);
  let first = target.mg, peak = full.peak, sim = full.sim;
  if (full.peak > settledPeak * 1.02) {
    const floor = Math.min(M.last.mg, target.mg);
    for (let mg = target.mg - 0.5; mg >= floor - 1e-9; mg -= 0.5) {
      const r = run(mg);
      first = mg; peak = r.peak; sim = r.sim;
      if (r.peak <= settledPeak * 1.01) break;
    }
  }
  const res = { cur, land, first, target, after, sim, fullPeak: full.peak, peak, settledPeak, settledLow: (ss.trough / M.refAvg) * 100 };
  switchCache.set(key, res);
  return res;
}
function switchPicks(M, list, p) {
  const curKey = `${M.last.mg}|${M.every}`;
  const opts = list.filter((pl) => `${pl.mg}|${pl.everyDays}` !== curKey);
  if (!opts.length) return null;
  const sw = p.sw || {};
  const pick = (k, ls) => (sw[k] != null ? String(sw[k]) : lsGet(ls, ''));
  const toId = opts.some((pl) => pl.id === pick('to', 'swto')) ? pick('to', 'swto') : opts[0].id;
  const target = opts.find((pl) => pl.id === toId);
  const penIso = (() => { const v = pick('pen', 'swpen'); return v && v >= todayIso() ? v : todayIso(); })();
  const wdRaw = pick('day', 'swday');
  return { opts, toId, target, penIso, weekday: wdRaw === '' ? null : Number(wdRaw) };
}
// A dated plan (his call, 2026-09-28: "go with tuesday make it my plan"): when
// settings.pk.sw.route names a route record, that route IS his switch. Its
// doses run until the new pen, the one on the pen day is the landing, then
// its mg every everyDays. A route dose is used up by a logged shot within 2.5
// days of it; a missed one moves to now, as the plain projection does.
function routeRec(p) {
  const id = p.sw && p.sw.route;
  const r = id ? (pkDoc().plans || {})[id] : null;
  return r && Array.isArray(r.route) && r.route.length && r.pen && r.mg > 0 && r.everyDays > 0 ? { id, ...r } : null;
}
function routeDoses(M, r) {
  const logged = M.shots.map((s) => s.t);
  return r.route.map((x) => ({ t: Date.parse(x.at), mg: x.mg }))
    .filter((x) => Number.isFinite(x.t) && !logged.some((t) => Math.abs(t - x.t) < 2.5 * DAY) && x.t > (M.last ? M.last.t : 0))
    .filter((x) => x.t >= M.now);   // a passed dose is never drawn at Now (see model()); the card names it
}
const routeSwCache = new Map();
function routePlan(M, p) {
  const r = routeRec(p);
  if (!r || !M.last) return null;
  const key = JSON.stringify([r, M.shots.map((s) => [s.t, s.mg]), JSON.stringify(M.params), Math.floor(M.now / 3600e3)]);
  if (routeSwCache.has(key)) return routeSwCache.get(key);
  if (routeSwCache.size > 10) routeSwCache.clear();
  const ds = routeDoses(M, r);
  const penT = midnight(r.pen);
  const cur = ds.filter((x) => x.t < penT);
  const rest = ds.filter((x) => x.t >= penT);
  const land = rest.length ? rest[0].t : later(cur.length ? cur[cur.length - 1].t : M.last.t, r.everyDays);
  const mgs = rest.length ? rest.map((x) => x.mg) : [r.mg];
  const after = rest.length ? rest.map((x) => x.t) : [land];
  for (let x = later(after[after.length - 1], r.everyDays); x <= land + 10 * 7 * DAY; x = later(x, r.everyDays)) after.push(x);
  const afterMg = after.map((t, i) => mgs[i] ?? r.mg);
  const afterDue = after.map((t, i) => rest[i]?.due ?? null);
  const doses = [...M.shots, ...cur, ...after.map((t, i) => ({ t, mg: afterMg[i] }))];
  const sim = simulate(M.params, doses, Math.min(M.t0, M.now - DAY), after[after.length - 1] + DAY);
  let peak = 0;
  for (let x = M.now; x <= after[after.length - 1]; x += 2 * HOUR) peak = Math.max(peak, (at(sim, x) / M.refAvg) * 100);
  const ss = steadyState(M.params, r.mg, r.everyDays);
  const res = { route: r, cur, land, first: afterMg[0], afterMg, afterDue, target: { mg: r.mg, everyDays: r.everyDays }, after, sim, fullPeak: peak, peak,
    settledPeak: (ss.peak / M.refAvg) * 100, settledLow: (ss.trough / M.refAvg) * 100 };
  routeSwCache.set(key, res);
  return res;
}

/** His planned switch as one timeline (his ask 2026-09-25: "the plan a switch
 *  as a single timeline on this chart"). Null when there is nothing to plan. */
function switchLine(M, list, p) {
  const rp = routePlan(M, p);
  if (rp) return rp;
  if (!M.last || !list.length) return null;
  const k = switchPicks(M, list, p);
  if (!k) return null;
  const r = planSwitch(M, k.target, k.penIso, k.weekday);
  return r && r.land && r.sim ? r : null;
}
function switchPlanner(M, list, penList, p) {
  if (!M.last || !list.length) return '';
  const curKey = `${M.last.mg}|${M.every}`;
  const opts = list.filter((pl) => `${pl.mg}|${pl.everyDays}` !== curKey);
  if (!opts.length) return '';
  // His picks are synced (settings.pk.sw, 2026-09-25: "just look at the Sunday
  // plan"), so every device opens on the same plan. The per device value is
  // only a fallback for a document that has none yet.
  const { toId, target, penIso, weekday } = switchPicks(M, list, p);
  const rp = routePlan(M, p);
  const r = rp || planSwitch(M, target, penIso, weekday);
  const curPen = penList.find((x) => x.id === p.penId) || null;
  const tgtPen = planFacts(M, target, p, penList, 'best').best?.pen || curPen;
  const clicks = (mg, every, pen) => {
    if (!pen) return '';
    const pm = penMath(mg, every, pen, p.windowDays, primeFor(pen, p));
    return pm.clicks == null ? '' : clickText(pm);
  };
  const row = (t, mg, pen, every, note = '') => `<div class="pk-swrow"><b>${esc(dayName(t))}</b><span>${mgStr(mg)} mg${pen ? `, ${esc(pen.name)}` : ''}</span><small>${esc(clicks(mg, every, pen))}${note ? `${clicks(mg, every, pen) ? '. ' : ''}${esc(note)}` : ''}</small></div>`;
  // Clicks for one dose of a dated plan: a dial stops at a full dose, so more
  // is a second stick at the same time (his way, no second prime).
  const doseClicks = (mg, pen) => {
    if (!pen || !pen.clicks || !pen.mg || !pen.doses) return '';
    const c = Math.round((mg * pen.clicks) / (pen.mg / pen.doses));
    const pr = Number(p.primeClicks) || 0;
    return `${c > pen.clicks ? `${pen.clicks} + ${c - pen.clicks}` : c} clicks${pr ? `, plus ${pr} to prime` : ''}`;
  };
  const rrow = (t, mg, pen, note = '') => `<div class="pk-swrow"><b>${esc(dayName(t))}</b><span>${mgStr(mg)} mg${pen ? `, ${esc(pen.name)}` : ''}</span><small>${esc(doseClicks(mg, pen))}${note ? `. ${esc(note)}` : ''}</small></div>`;
  const routePen = rp ? (penList.find((x) => x.id === rp.route.penTo) || tgtPen) : null;
  let out, facts = '';
  if (rp) out = `<div class="pk-swlist">
      ${rp.cur.map((x) => rrow(x.t, x.mg, curPen)).join('')}
      ${rrow(rp.land, rp.first, routePen, 'New pen')}
      <div class="pk-swrow then"><b>Then every ${mgStr(rp.target.everyDays)} days</b><span>${mgStr(rp.target.mg)} mg${routePen ? `, ${esc(routePen.name)}` : ''}</span><small>${esc(doseClicks(rp.target.mg, routePen))}</small></div>
    </div>`;
  if (!r || !r.land) out = out || '<p class="pk-foot">No day fits: pick another weekday or pen date.</p>';
  else {
    const soft = r.first < r.target.mg;
    if (!rp) out = `<div class="pk-swlist">
      ${r.cur.map((x) => row(x.t, x.mg, curPen, M.every)).join('')}
      ${row(r.land, r.first, tgtPen, r.target.everyDays, soft ? `A smaller first shot: at ${mgStr(r.target.mg)} mg you would reach ${r0(r.fullPeak)}%` : 'First on the new schedule')}
      <div class="pk-swrow then"><b>Then every ${mgStr(r.target.everyDays)} days</b><span>${mgStr(r.target.mg)} mg${tgtPen ? `, ${esc(tgtPen.name)}` : ''}</span><small>${esc(clicks(r.target.mg, r.target.everyDays, tgtPen))}</small></div>
    </div>`;
    // His call (2026-09-28): these three stay in sight with the section shut.
    // Numbers and a word each (audit W7); the three are the point of the section.
    // One line, the settled range big and the way there beside it (Never 3, audit d-glp1-19).
    facts = `<div class="g1-swfacts">
      <span><b>${r0(r.settledLow)} to ${r0(r.settledPeak)}%</b><small>Once settled</small></span>
      <span><b>${r0(r.peak)}%</b><small>Highest on the way</small></span>
    </div>`;
  }
  // His ask (2026-09-28): collapsible, like the logs. Shut by default and
  // remembered on this device; the shut line names the switch.
  const open = lsGet('swopen', '0') === '1';
  return `<section class="ov-sec pk-switch">
    <details class="pk-log" data-key="pkswitch" data-pk-swfold ${open ? 'open' : ''}>
    <summary class="ov-head pk-logsum"><h2>Plan a switch</h2><span class="ov-sub pk-logopen">From ${mgStr(M.last.mg)} mg every ${mgStr(M.every)} days</span>
      <span class="pk-logshut">${rp ? esc(rp.route.name || `To ${planName(rp.target)}`) : target ? `To ${esc(planName(target))}` : ''}</span><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary>
    ${rp ? `<p class="pk-foot">Your dated plan. Changing a pick below goes back to planning by schedule.</p>` : ''}
    <div class="pk-swset">
      ${menuBtn('data-g1-swto', 'Switch to', planName(opts.find((pl) => pl.id === toId) || opts[0]))}
      <label class="g1-menubtn g1-datebtn"><span>New pen from</span><b>${esc(dayName(midnight(penIso)))}</b><input type="date" data-pk-swpen value="${penIso}" min="${todayIso()}" aria-label="New pen from"></label>
      ${menuBtn('data-g1-swday', 'Shot day', weekday == null ? 'Any day' : WDAYS[weekday])}
    </div>
    ${out}
    </details>
    ${facts}
  </section>`;
}

// ....................................................... Range from log ..
// The low his own log points to: the cut between the days a craving got the
// better of him (Strong or worse, or Stuck) and the calm days, by each day's
// lowest waking level. Offered, never applied without his tap.
function rangeFromLog(M, p) {
  const rows = feelLows(M);
  const cut = bestCut(rows.map((r) => ({ level: r.low, craving: r.hard })));
  const hi = highestSoFar(M);
  const low = cut ? Math.round(cut.cut) : null;
  // The suggestion shows only once it has a value (audit d-glp1-17: never a bare dot).
  return `<div class="sc-tiles pk-fromlog">
    ${low != null ? `<div class="sc-tile"><small>Low your log points to</small><b>${low}%</b><span>Right on ${cut.right} of ${cut.total} days</span>${low !== p.rangeMin ? `<button class="btn sm" data-pk-uselow="${low}">Use ${low}%</button>` : ''}</div>` : ''}
    <div class="sc-tile"><small>Highest you have been</small><b>${hi ? `${r0(hi.v)}%` : '·'}</b><span>${hi ? dayName(hi.t) : 'No shots logged'}</span></div>
  </div>`;
}

function numbersTable(M, facts, colors, p, penPick) {
  if (!facts.length) return '';
  // One pen control for the whole page (the switch at the top): a chosen pen
  // for every row, or on Cheapest each row's own cheaper pen, named in a column.
  const showPen = penPick === 'best';
  const penHead = !showPen ? (facts.find((f) => f.best)?.best.pen.name || 'Pen') : 'Cheapest pen';
  return `<details class="pk-about pk-numbers"><summary><span>All the Numbers</span><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><section class="pm-sec">
    <div class="pk-tablewrap"><table class="pk-table">
    <thead>
      <tr class="grp"><th></th><th colspan="4">The model, steady</th><th colspan="3">Dose rate</th><th colspan="${showPen ? 9 : 8}">${esc(penHead)}, used within ${p.windowDays} days</th><th colspan="6">Cost</th></tr>
      <tr><th>Schedule</th><th>High</th><th>Low</th><th>Average</th><th>Swing</th>
        <th>mg a day</th><th>mg a week</th><th>mg a month</th>
        ${showPen ? '<th>Pen</th>' : ''}<th>Clicks</th><th>Shots</th><th>Used</th><th>Priming</th><th>Left</th><th>Unused</th><th>Why left</th><th>Lasts</th>
        <th>A shot</th><th>A shot, long run</th><th>A month</th><th>A month, long run</th><th>A year</th><th>Against as sold</th></tr>
    </thead><tbody>
    ${facts.map((f) => {
      const pm = f.best ? f.best.pm : null;
      return `<tr><th><i class="pk-sw" style="--c:var(--s${colors[f.pl.id]})"></i>${planShort(f.pl)}</th>
      <td>${r0(f.high)}%</td><td>${r0(f.low)}%</td><td>${r0(f.avg)}%</td><td>${r0(f.high - f.low)}</td>
      ${pm ? `<td>${pm.perDay.toFixed(3)}</td><td>${pm.perWeek.toFixed(2)}</td><td>${pm.per30.toFixed(1)}</td>
      ${showPen ? `<td>${esc(f.best.pen.name)}</td>` : ''}
      <td>${pm.clicks == null ? '·' : pm.wholeClicks ? Math.round(pm.clicks) : pm.clicks.toFixed(1)}</td><td>${pm.shots}</td><td>${mgStr(pm.used.toFixed(2))}</td><td>${mgStr(pm.primed.toFixed(2))}</td><td>${mgStr(pm.left.toFixed(2))}</td><td>${r0(pm.leftPct * 100)}%</td>
      <td>${{ none: '·', window: 'Pen expires', partial: 'Under one dose' }[pm.waste]}</td><td>${+pm.realSupplyDays.toFixed(1)} d</td>
      <td>${money(pm.realCostPerShot)}</td><td>${money(pm.costPerShot)}</td><td>${money(pm.cost30Real)}</td><td>${money(pm.cost30Long)}</td><td>${money(pm.costYearReal)}</td><td>${esc(soldText(pm))}</td>` : `<td colspan="${showPen ? 18 : 17}">Add a pen to see pen use and cost</td>`}
    </tr>`;
    }).join('')}
    </tbody></table></div>
    <p class="pk-foot">Swing is high minus low, in points. A month is 30 days. Long run treats the pen as never expiring. Priming: your clicks every shot; the pen's extra fill covers the first few, after that they come out of your doses. Clicks and extra fill are your counts, not the label's. The dial stops at one labelled dose, so a bigger dose is two shots, each primed. Against as sold: the pen's price buys the weeks it is sold as; days past that are a gain, days short a loss, at that price per week.</p>
  </section></details>`;
}

// ..................................................... Find schedules ..
// His ask (2026-09-28): pick a pen, and the page works out the schedules that
// fit his range on it and adds them to the list. The model is linear in dose,
// so one steady run per interval gives every dose: the smallest whole-click
// dose whose low clears his lowest, kept only if its high stays under his
// highest. A dose is capped at one labelled dose (the dial stops there).
const FIND_EVERY = [3, 3.5, 4, 5, 6, 7];
function findSchedules(M, pen, p) {
  const perClick = pen.mg / (pen.doses || 4) / (pen.clicks || 60);
  const maxClicks = pen.clicks || 60;
  const out = [];
  for (const every of FIND_EVERY) {
    const ss = steadyState(M.params, 1, every);
    const low1 = (ss.trough / M.refAvg) * 100, high1 = (ss.peak / M.refAvg) * 100;
    const clicks = Math.max(1, Math.ceil((p.rangeMin / low1) / perClick - 1e-9));
    if (clicks > maxClicks) continue;
    const mg = +(clicks * perClick).toFixed(4);
    if (mg * high1 > p.rangeMax + 1e-9) continue;
    const pm = penMath(mg, every, pen, p.windowDays, primeFor(pen, p));
    out.push({ mg, everyDays: every, clicks, low: mg * low1, high: mg * high1, month: pm.cost30Real });
  }
  return out;
}
function finder(penList, p, penPick) {
  if (!penList.length) return '';
  const pick = penList.some((x) => x.id === lsGet('fpen', '')) ? lsGet('fpen', '')
    : penPick !== 'best' ? penPick : penList.some((x) => x.id === p.penId) ? p.penId : penList[0].id;
  return `<div class="pk-add pk-find">
      ${menuBtn('data-g1-fpen', 'Pen', (penList.find((x) => x.id === pick) || {}).name || '')}
      <button type="button" class="btn primary" data-pk-find="${esc(pick)}">Find schedules</button>
    </div>${foundBox(penList)}`;
}
// His call (2026-09-28): Calculate only SHOWS what fits; he taps the ones he
// wants and confirms with Add. Nothing reaches his list before that tap. The
// results live in this module only, never in his data.
let foundState = null;   // { pen, items: [{ key, mg, everyDays, clicks, low, high, month, hiddenId }], listed, pick: Set }
function foundBox(penList) {
  const f = foundState;
  if (!f || !penList.some((x) => x.id === f.pen)) return '';
  const pen = penList.find((x) => x.id === f.pen);
  const note = f.listed ? `<small class="pk-fnote">${f.listed} more already in your list</small>` : '';
  if (!f.items.length) return `<div class="pk-found"><small class="pk-fnote">${f.listed ? 'Everything that fits' : 'Nothing'} on the ${esc(pen.name)} ${f.listed ? 'is already in your list' : 'stays in your range'}</small>
    <div class="pk-fbtns"><button type="button" class="btn sm" data-pk-fclose>Close</button></div></div>`;
  const n = f.pick.size;
  const p = prefs();
  const scaleMax = Math.max(p.rangeMax * 1.15, ...f.items.map((x) => x.high));
  const pos = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100)).toFixed(2)}%`;
  return `<div class="pk-found" role="group" aria-label="Schedules that fit the ${esc(pen.name)}">
    ${f.items.map((x, i) => `<button type="button" class="pk-frow ${f.pick.has(x.key) ? 'on' : ''}" style="--c:var(--s${i % SERIES})" data-pk-fitem="${x.key}" aria-pressed="${f.pick.has(x.key)}">
      <span class="pk-pbox" aria-hidden="true"></span>
      <span class="pk-hname"><b>${mgStr(x.mg)} mg every ${mgStr(x.everyDays)} days</b><small>${x.clicks} clicks${x.hiddenId ? ', in Hidden' : ''}</small></span>
      <span class="pk-pbar" aria-hidden="true"><i class="zone" style="left:${pos(p.rangeMin)};width:calc(${pos(p.rangeMax)} - ${pos(p.rangeMin)})"></i><i class="span" style="left:${pos(x.low)};width:calc(${pos(x.high)} - ${pos(x.low)})"></i></span>
      <span class="pk-hnum"><b>${r0(x.low)} to ${r0(x.high)}%</b><small>Low to high</small></span>
      <span class="pk-hnum"><b>${x.month != null ? money(x.month) : '·'}</b><small>A month, ${esc(pen.name)}</small></span></button>`).join('')}
    ${note}
    <div class="pk-fbtns"><button type="button" class="btn sm" data-pk-fclose>Close</button>${n ? `<button type="button" class="btn primary sm" data-pk-fadd>Add ${n}</button>` : ''}</div>
  </div>`;
}

// His ask (2026-09-28): each hidden schedule shows enough to know what it is:
// the same range bar as the cards, low to high, and a month's cost.
function hiddenPlans(M, p, penList, penPick) {
  const h = Object.entries(pkDoc().plans || {}).filter(([, x]) => x && x.hidden && !x.route && x.mg > 0 && x.everyDays > 0)
    .map(([id, x]) => ({ id, x, f: planFacts(M, { id, ...x }, p, penList, penPick) }));
  if (!h.length) return '';
  // His ask (2026-09-28): sort by price or by low to high, per device.
  const hsort = lsGet('hsort', 'order');
  if (hsort === 'price') h.sort((a, b) => (a.f.best ? a.f.best.pm.cost30Real : Infinity) - (b.f.best ? b.f.best.pm.cost30Real : Infinity) || a.f.low - b.f.low);
  if (hsort === 'level') h.sort((a, b) => a.f.low - b.f.low || a.f.high - b.f.high);
  const cols = planColors(h.map(({ id, x }) => ({ id, ...x })));
  const scaleMax = Math.max(p.rangeMax * 1.15, ...h.map(({ f }) => f.high));
  const pos = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100)).toFixed(2)}%`;
  return `<details class="pk-removed" data-key="pk-hidden"><summary><span>Hidden</span><b>${h.length}</b><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary>
    <div class="pk-hsort">${menuBtn('data-g1-hsort', 'Sort', (HSORTS.find(([k]) => k === hsort) || HSORTS[0])[1])}</div>
    ${h.map(({ id, x, f }) => `<div class="pk-rrow pk-hrow" style="--c:var(--s${cols[id]})">
      <span class="pk-hname"><b>${esc(planName(x))}</b><small>${esc(statusText(f, p))}</small></span>
      <div class="pk-pbar" aria-hidden="true"><i class="zone" style="left:${pos(p.rangeMin)};width:calc(${pos(p.rangeMax)} - ${pos(p.rangeMin)})"></i><i class="span" style="left:${pos(f.low)};width:calc(${pos(f.high)} - ${pos(f.low)})"></i></div>
      <span class="pk-hnum"><b>${r0(f.low)} to ${r0(f.high)}%</b><small>Low to high</small></span>
      <span class="pk-hnum"><b>${f.best ? money(f.best.pm.cost30Real) : '·'}</b><small>${f.best ? `A month, ${esc(f.best.pen.name)}` : 'A month'}</small></span>
      <span class="pk-hbtns"><button class="btn sm" data-pk-del="${esc(id)}">Delete</button><button class="btn sm" data-pk-unhide="${esc(id)}">Show</button></span></div>`).join('')}</details>`;
}

// The from-today runs: his logged shots, then the schedule from his next shot.
const todayCache = new Map();
function fromToday(M, pl) {
  const key = `${pl.mg}|${pl.everyDays}|${M.shots.map((s) => `${s.t}:${s.mg}`).join(',')}|${Math.floor(M.now / 3600e3)}|${JSON.stringify(M.params)}`;
  if (todayCache.has(key)) return todayCache.get(key);
  if (todayCache.size > 40) todayCache.clear();
  const t1 = M.now + 12 * 7 * DAY + DAY;
  const start = M.last ? Math.max(M.now, later(M.last.t, pl.everyDays)) : M.now;
  const doses = [...M.shots];
  for (let t = start; t <= t1; t = later(t, pl.everyDays)) doses.push({ t, mg: pl.mg, proj: true });
  const sim = simulate(M.params, doses, Math.min(M.t0, M.now - DAY), t1);
  const val = { sim, start, doses };
  todayCache.set(key, val);
  return val;
}

const routeCache = new Map();
function routeRun(M, r) {
  const key = `${r.id}|${JSON.stringify(r.route)}|${r.mg}|${r.everyDays}|${M.shots.map((s) => `${s.t}:${s.mg}`).join(',')}|${Math.floor(M.now / 3600e3)}|${JSON.stringify(M.params)}`;
  if (routeCache.has(key)) return routeCache.get(key);
  if (routeCache.size > 20) routeCache.clear();
  const t1 = M.now + 12 * 7 * DAY + DAY;
  const doses = [...M.shots];
  const rd = r.route.map((x) => ({ t: Date.parse(x.at), mg: x.mg, proj: true })).filter((x) => Number.isFinite(x.t) && x.t > (M.last ? M.last.t : 0));
  rd.forEach((x) => doses.push(x));
  if (rd.length && r.mg > 0 && r.everyDays > 0) for (let t = later(rd[rd.length - 1].t, r.everyDays); t <= t1; t = later(t, r.everyDays)) doses.push({ t, mg: r.mg, proj: true });
  const val = { sim: simulate(M.params, doses, Math.min(M.t0, M.now - DAY), t1), doses };
  routeCache.set(key, val);
  return val;
}
const routeOn = (id) => !(lsGet('routesoff', '') || '').split(',').includes(id);

let compareState = null;
let compareArgs = null;
/**
 * The What If compare chart (v3, research 04 section H, ruling 07 4.7): the same
 * kit as the level chart. Edge to edge on a phone; values and his reference lines
 * labelled in a trailing gutter on solid ground, never over the lines (audit W4);
 * Now and the switch as flags in a top gutter; what each dashed line is, in a key
 * under the chart. His Level chart rules hold: his range top is the top edge, the
 * floor sits 30% under his range bottom (or the starting dose's steady low), and
 * ticking a schedule on or off never moves the frame; it only widens when a line
 * drawn would fall outside.
 */
function compareChart(M, chosen, colors, p, mode, weeks) {
  compareArgs = { M, chosen, colors, p, mode, weeks };
  const swr = mode === 'today' && lsGet('swline', '1') === '1' ? switchLine(M, plans(), p) : null;
  const vb = viewBox();
  const W = vb.bleed ? vb.inner + 2 * vb.pad : colW('whatif');
  // Regular width: the chart is the large half of the page, so it is tall (an iPad upright 470 x 470).
  const H = vb.bleed ? 300 : tier() ? Math.round(Math.max(400, Math.min(560, W * 1.0, window.innerHeight - 300))) : Math.round(Math.max(320, Math.min(480, W * 0.45)));
  const m = { l: 0, r: 40, t: 24, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  // From today starts at his two previous doses, so the lines grow out of
  // where he is (his ask, 2026-09-28).
  const prev = mode === 'today' ? M.shots.slice(-2) : [];
  const back = prev.length ? M.now - midnight(isoOf(prev[0].t)) : 0;
  const spanH = weeks * 7 * 24 + back / HOUR;
  const x0 = mode === 'today' ? M.now - back : 0;
  const X = (h) => m.l + (h / spanH) * pw;          // h: hours from the chart's start
  const series = chosen.map((f) => {
    let valAt;
    if (mode === 'today') {
      const run = fromToday(M, f.pl);
      valAt = (h) => (at(run.sim, x0 + h * HOUR) / M.refAvg) * 100;
    } else {
      const iv = f.pl.everyDays * 24;
      valAt = (h) => {
        const k = Math.round((h % iv) / f.ss.stepH);
        return (f.ss.course[Math.min(k, f.ss.course.length - 1)] / M.refAvg) * 100;
      };
    }
    return { f, c: colors[f.pl.id], valAt };
  });
  if (swr) series.push({ sw: swr, valAt: (h) => (at(swr.sim, x0 + h * HOUR) / M.refAvg) * 100 });
  if (mode === 'today' && M.last) for (const r of routes().filter((x) => routeOn(x.id))) {
    const run = routeRun(M, r);
    series.push({ rt: r, c: r.color ?? 0, valAt: (h) => (at(run.sim, x0 + h * HOUR) / M.refAvg) * 100 });
  }
  const N = Math.max(80, Math.round(pw / 1.5));
  const hs = Array.from({ length: N + 1 }, (_, i) => (spanH * i) / N);
  const startMg = (M.drug.doses || [])[0];
  const floorRef = startMg ? { mg: startMg, every: M.ref.everyDays, low: (steadyState(M.params, startMg, M.ref.everyDays).trough / M.refAvg) * 100 } : null;
  // The floor follows the lines (30% under the lowest, his level chart rule), not the
  // starting dose's low: that reference forced it to about 23% and left half the plot
  // empty (audit d-glp1-16). Out of frame it is still named, with its value, in the key.
  const base = { hi: p.rangeMax * 1.02, lo: p.rangeMin * 0.9 };
  let top = -Infinity, bottom = Infinity;
  if (mode === 'today') { const v = (at(M.logged, M.now) / M.refAvg) * 100; top = Math.max(top, v); bottom = Math.min(bottom, v); }
  for (const s of series) for (const h of hs) { const v = s.valAt(h); top = Math.max(top, v); bottom = Math.min(bottom, v); }
  const yMax = Math.max(base.hi, top + 4);
  const yMin = Math.max(0, Math.min(base.lo, Number.isFinite(bottom) ? bottom * 0.7 : base.lo));
  const step = niceStep(yMax - yMin, 4);
  const Y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

  // The trailing gutter: every label placed, then pushed apart so none overlap.
  const gut = [];
  const grid = [];
  for (let v = Math.ceil(yMin / step - 1e-9) * step; v <= yMax + 1e-9; v += step) {
    grid.push(`<line class="g1-grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`);
    gut.push({ y: Y(v), text: `${+v.toFixed(0)}`, cls: 'g1-glab', pri: 0 });
  }
  const zTop = Math.min(p.rangeMax, yMax), zBot = Math.max(p.rangeMin, yMin);
  const zone = `<rect class="g1-zonerect" x="${m.l}" y="${Y(zTop).toFixed(1)}" width="${pw}" height="${Math.max(0, Y(zBot) - Y(zTop)).toFixed(1)}"/>`;
  for (const v of [p.rangeMin, p.rangeMax]) if (v >= yMin && v <= yMax) gut.push({ y: Y(v), text: `${v}%`, cls: 'g1-glab rule', pri: 2 });
  // His own markers: the highest he has been, the level his hardest craving days
  // fell to, and the starting dose's steady low. Named in the key, valued in the gutter.
  const refs = [];
  const hi = highestSoFar(M);
  if (hi) refs.push({ v: hi.v, key: 'Your highest so far' });
  const hard = feelLows(M).filter((r) => r.hard);
  if (hard.length) {
    const up = hard.reduce((a, r) => (r.low > a.low ? r : a));
    refs.push({ v: up.low, key: hard.length === 1 ? `Strong craving, ${mon(fromIso(up.iso))} ${fromIso(up.iso).getDate()}` : 'Strong cravings, up to' });
  }
  if (floorRef) refs.push({ v: floorRef.low, key: `${mgStr(floorRef.mg)} mg every ${floorRef.every} days, steady low`, start: true });
  const shownRefs = refs.filter((r) => r.v >= yMin && r.v <= yMax);
  const refSvg = shownRefs.map((r) => `<line class="${r.start ? 'g1-startline' : 'g1-refline'}" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.v).toFixed(1)}" y2="${Y(r.v).toFixed(1)}"/>`).join('');
  shownRefs.forEach((r) => gut.push({ y: Y(r.v), text: `${r0(r.v)}%`, cls: 'g1-glab ref', pri: 1 }));
  // Series ends: a coloured tick in the gutter at each line's last value.
  const ends = series.map((s) => ({ y: Y(s.valAt(spanH)), c: s.sw ? 'var(--ink)' : `var(--s${s.c})` }));
  gut.sort((a, b) => a.y - b.y);
  // Every named line keeps its value in the gutter (audit d-glp1-37: the 76% line lost its
  // number beside 80%): gridline numbers give way, named values are nudged apart, 13 pt a row.
  const named = gut.filter((g) => g.pri > 0).sort((a, b) => a.y - b.y);
  for (let i = 1; i < named.length; i++) if (named[i].y - named[i - 1].y < 13) named[i].ly = (named[i - 1].ly ?? named[i - 1].y) + 13;
  for (let i = 1; i < named.length; i++) { const pv = named[i - 1].ly ?? named[i - 1].y; if ((named[i].ly ?? named[i].y) - pv < 13) named[i].ly = pv + 13; }
  const kept = [...named];
  for (const g of gut.filter((x) => x.pri === 0)) if (!kept.some((o) => Math.abs((o.ly ?? o.y) - g.y) < 13)) kept.push(g);
  const gutSvg = `<rect class="g1-gutbg" x="${W - m.r}" y="0" width="${m.r}" height="${H}"/>${ends.map((e) => `<rect x="${(W - m.r).toFixed(1)}" y="${(e.y - 1.5).toFixed(1)}" width="6" height="3" rx="1.5" style="fill:${e.c}"/>`).join('')}
    ${kept.map((g) => `${g.ly != null ? `<line class="g1-gutlead" x1="${W - m.r + 1}" x2="${W - m.r + 7}" y1="${g.y.toFixed(1)}" y2="${(g.ly).toFixed(1)}"/>` : ''}<text class="${g.cls}" x="${W - m.r + 9}" y="${((g.ly ?? g.y) + 4).toFixed(1)}">${g.text}</text>`).join('')}`;

  const dayStep = weeks <= 1 ? 1 : weeks <= 2 ? 2 : weeks <= 4 ? 7 : 14;
  const xl = [];
  let lastX = -99;
  for (let d = 0; d <= spanH / 24; d += dayStep) {
    const x = X(d * 24);
    if (x < 16 || x > W - m.r - 16 || x - lastX < 40) continue;
    lastX = x;
    let lab;
    if (mode === 'today') { const t = new Date(x0 + d * DAY); lab = `${mon(t)} ${t.getDate()}`; } else lab = d === 0 ? 'Shot' : `Day ${d}`;
    xl.push(`<text class="g1-xlab" x="${x.toFixed(1)}" y="${H - 6}">${lab}</text>`);
  }
  const flags = [];
  if (back) {
    const nx = X(back / HOUR);
    flags.push({ x: nx, text: 'Now', cls: 'now' });
    for (const sh of prev) xl.push(`<circle class="g1-shot" cx="${X((sh.t - x0) / HOUR).toFixed(1)}" cy="${m.t + ph}" r="4"><title>${esc(dayName(sh.t))}: ${mgStr(sh.mg)} mg</title></circle>`);
  }
  if (swr) {
    const h = (swr.land - x0) / HOUR;
    if (h > 0 && h < spanH) { const t = new Date(swr.land); flags.push({ x: X(h), text: `Switch ${mon(t)} ${t.getDate()}`, cls: 'set' }); }
  }
  // Where each route opens the new pen (his ask, 2026-09-28): a mark on the
  // axis in the route's colour, the switch's in ink.
  const pensAt = [];
  if (swr) pensAt.push({ t: swr.land, c: 'var(--ink)' });
  for (const s of series) if (s.rt && s.rt.pen) pensAt.push({ t: midnight(s.rt.pen) + 12 * HOUR, c: `var(--s${s.c})` });
  const penSvg = pensAt.map((q, i) => {
    const h = (q.t - x0) / HOUR;
    if (h <= 0 || h >= spanH) return '';
    const x = X(h), dup = pensAt.slice(0, i).filter((o) => isoOf(o.t) === isoOf(q.t)).length;
    const y = m.t + ph - 7 - dup * 11;
    return `<g class="pk-penmark" style="--c:${q.c}"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t}" y2="${m.t + ph}"/><rect x="${(x - 4.5).toFixed(1)}" y="${(y - 4.5).toFixed(1)}" width="9" height="9" rx="2"><title>New pen, ${esc(dayName(q.t))}</title></rect></g>`;
  }).join('');
  const flagSvg = flagRow(flags, m.l + 2, W - m.r - 2, m, ph);
  const lines = series.map((s) => `<path class="g1-sline${s.sw ? ' sw' : ''}${s.rt ? ' rt' : ''}" style="stroke:${s.sw ? 'var(--ink)' : `var(--s${s.c})`}" d="${hs.map((h, i) => `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Y(s.valAt(h)).toFixed(1)}`).join('')}"/>`).join('');
  compareState = { series, X, Y, m, W, H, ph, spanH, mode, x0 };
  const empty = !series.length ? `<text class="g1-empty" x="${(W - m.r) / 2}" y="${m.t + ph / 2}">Tap a schedule below to draw it</text>` : '';
  const key = refs.length ? `<div class="g1-key">${refs.map((r) => `<span${shownRefs.includes(r) ? '' : ' class="off"'}><i class="${r.start ? 'k-start' : 'k-ref'}"></i>${esc(r.key)} ${r0(r.v)}%</span>`).join('')}</div>` : '';
  return `
    <div class="g1-chart${vb.bleed ? ' bleed' : ''} g1-cmp">
      <div class="pk-plot g1-cplot" data-pk-cmp tabindex="0" role="group" aria-label="Schedules compared. Drag to read a moment. Arrow keys move the cursor.">
        <svg class="pk-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
          ${zone}${grid.join('')}${refSvg}${penSvg}${flagSvg}${lines}${xl.join('')}${gutSvg}${empty}
          <g class="pk-guide" style="opacity:0"><line x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/></g>
          <rect class="pk-hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/>
        </svg>
      </div>
    </div>
    ${key}
    <div class="pk-cmpread g1-cmpread" data-pk-cmpread>${cmpReadout(null)}</div>`;
}

function cmpReadout(h) {
  const c = compareState;
  if (!c || !c.series.length || h == null) return '';
  const when = h == null ? '' : c.mode === 'today' ? (() => { const t = c.x0 + h * HOUR; return `${dayName(t)}, ${hourName(t)}`; })() : `Day ${(h / 24).toFixed(1)}`;
  const rows = c.series.map((s) => `<span class="pk-cr" style="--c:${s.sw ? 'var(--ink)' : `var(--s${s.c})`}"><i></i>${esc(s.sw ? 'Your switch' : s.rt ? s.rt.name || 'Route' : planShort(s.f.pl))}${h == null ? '' : `<b>${r0(s.valAt(h))}%</b>`}</span>`).join('');
  return `${h == null ? '' : `<b class="pk-crwhen">${esc(when)}</b>`}${rows}`;
}

// Same scrub grammar as every GLP-1 chart (glp1/scrub.js): press and hold, then drag; a
// selection tick at each day (each week on the 8 and 12 week views); release clears.
function bindCompare(root) {
  const plot = root.querySelector('[data-pk-cmp]');
  const c = compareState;
  if (!plot || !c || !c.series.length) return;
  const svg = plot.querySelector('svg');
  const guide = svg.querySelector('.pk-guide');
  const out = root.querySelector('[data-pk-cmpread]');
  let cur = 0;
  const stepH = c.spanH > 24 * 7 * 5 ? 24 * 7 : 24;
  const hOf = (clientX) => Math.min(c.spanH, Math.max(0, ((userX(svg, clientX, c.W) - c.m.l) / (c.W - c.m.l - c.m.r)) * c.spanH));
  const show = (h) => {
    cur = Math.min(c.spanH, Math.max(0, h));
    const x = c.X(cur);
    guide.style.opacity = '1';
    guide.querySelector('line').setAttribute('x1', x); guide.querySelector('line').setAttribute('x2', x);
    out.innerHTML = cmpReadout(cur);
    out.classList.add('on');
  };
  const hide = () => { guide.style.opacity = '0'; out.innerHTML = cmpReadout(null); out.classList.remove('on'); };
  holdScrub(plot, {
    at: (x) => { const h = hOf(x); return { key: Math.floor(h / stepH), h }; },
    show: (r) => show(r.h),
    hide,
    // A tap drops a reading and keeps it (the Level chart's tap without a native chart).
    onTap: (x) => { tick('light'); show(hOf(x)); },
  });
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hide(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(cur + (e.key === 'ArrowLeft' ? -6 : 6));
  });
}

function labelTiles(M) {
  const facts = M.drug.label || [];
  return `<details class="pk-about"><summary><span>Model, Pen Math and Label</span><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><section class="pm-sec">
    <div class="sc-notes pk-notes">
      <div class="sc-note"><b>The model</b><span>Peak, trough and average: pharmacology, from the published model.</span></div>
      <div class="sc-note"><b>Pen math</b><span>Shots, waste and cost: arithmetic on your pens and prices.</span></div>
      <div class="sc-note"><b>The label</b><span>What the prescribing information says. Changes are your prescriber's call.</span></div>
    </div>
    ${facts.length ? `<h2 class="ov-h pk-h2">The label says</h2><div class="sc-tiles ${facts.length === 4 ? 'n4' : ''}">${facts.map((f) => `<div class="sc-tile"><small>${esc(f.k)}</small><b>${esc(f.v)}</b>${f.note ? `<span>${esc(f.note)}</span>` : ''}</div>`).join('')}</div>` : ''}
  </section></details>`;
}

// ------------------------------------------------------------------ bind --
export function bindMedLevel(root, ctx, rerender) {
  repaint = rerender;
  root.querySelectorAll('[data-pkpart]').forEach((b) => b.addEventListener('click', () => { ctx.pkPart = b.dataset.pkpart; rerender(); }));
  // (i): a fact behind a tap, on solid ground under its heading.
  root.querySelectorAll('[data-g1-about], [data-g1-infotoggle]').forEach((b) => b.addEventListener('click', () => {
    const txt = b.hasAttribute('data-g1-about') ? root.querySelector('[data-g1-abouttext]') : (b.closest('.g1-sechead, .g1-wihead')?.nextElementSibling);
    if (!txt || !txt.classList.contains('g1-about')) return;
    txt.hidden = !txt.hidden;
    b.setAttribute('aria-expanded', String(!txt.hidden));
  }));
  root.querySelectorAll('[data-pk-range]').forEach((b) => b.addEventListener('click', () => {
    const M = model();
    if (M) lsSet('span', String(presetSpan(M, b.dataset.pkRange)));
    levelEndT = null;   // a new range opens on the usual window, from today
    tick();
    rerender();
  }));
  // A layer toggle adds a layer and never moves the frame (RUBRIC 10).
  root.querySelector('[data-pk-wline]')?.addEventListener('click', () => { lsSet('wline', lsGet('wline', '0') === '1' ? '0' : '1'); tick(); rerender(); });
  root.querySelectorAll('[data-g1-layer]').forEach((b) => b.addEventListener('click', () => { const k = `layer.${b.dataset.g1Layer}`; lsSet(k, lsGet(k, '1') === '1' ? '0' : '1'); tick(); rerender(); }));
  root.querySelectorAll('[data-pk-log]').forEach((b) => b.addEventListener('click', () => openShot(null)));
  root.querySelector('[data-g1-sdmore]')?.addEventListener('click', (e) => {
    sdMore = !sdMore;
    e.currentTarget.setAttribute('aria-expanded', String(sdMore));
    const body = root.querySelector('[data-g1-sdbody]');
    if (body) body.hidden = !sdMore;
    tick();
  });
  root.querySelectorAll('[data-pk-weight]').forEach((b) => b.addEventListener('click', () => openWeight()));
  root.querySelectorAll('[data-pk-weight-edit]').forEach((b) => b.addEventListener('click', () => openWeight(b.dataset.pkWeightEdit)));
  root.querySelectorAll('[data-g1-logmore]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.g1Logmore; lsSet(k, lsGet(k, '0') === '1' ? '0' : '1'); rerender(); }));
  root.querySelector('[data-pk-swfold]')?.addEventListener('toggle', (e) => {
    lsSet('swopen', e.currentTarget.open ? '1' : '0');
  });
  root.querySelectorAll('[data-pk-shot]').forEach((b) => b.addEventListener('click', () => openShot(b.dataset.pkShot)));
  root.querySelectorAll('[data-pk-restore]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkRestore;
    save((d) => { const s = d.pk.shots[id]; if (s) d.pk.shots[id] = { ...s, removed: false, restoredAt: new Date().toISOString() }; });
  }));
  bindPlot(root);
  bindWeightChart(root, rerender);
  bindBand(root);

  // Cravings.
  const cardIso = root.querySelector('[data-pk-dayiso]')?.dataset.pkDayiso;
  const dayOf = () => cardIso || ctx.pkDay || todayIso();
  const week = root.querySelector('[data-g1-week]');
  const moveWeek = (dir) => {
    const end = addDays(ctx.pkWeekEnd || todayIso(), 7 * dir);
    if (end > todayIso() && (ctx.pkWeekEnd || todayIso()) >= todayIso()) return false;
    ctx.pkWeekEnd = end > todayIso() ? todayIso() : end;
    ctx.pkDay = ctx.pkWeekEnd;
    ctx.g1Slide = dir;
    tick();
    rerender();
    return true;
  };
  if (week) {
    // Swipe for another week (the lone arrow button went, research 03 section 3.2).
    let sx = null, sy = null;
    week.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    week.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) { week.dataset.swiped = '1'; moveWeek(dx > 0 ? -1 : 1); }
    });
    week.addEventListener('keydown', (e) => { if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) moveWeek(-1); if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) moveWeek(1); });
    if (ctx.g1Slide) { week.classList.add(ctx.g1Slide > 0 ? 'from-right' : 'from-left'); ctx.g1Slide = 0; }
  }
  root.querySelectorAll('[data-g1-wk]').forEach((b) => b.addEventListener('click', () => moveWeek(Number(b.dataset.g1Wk))));
  root.querySelectorAll('[data-pk-day]').forEach((b) => b.addEventListener('click', () => {
    if (week?.dataset.swiped) { delete week.dataset.swiped; return; }
    ctx.pkDay = b.dataset.pkDay; tick(); rerender();
  }));
  // The worst craving of the day, by hand: a menu of the five, his current one
  // ticked; choosing it again clears it (the old scale's tap to undo).
  // The worst craving of the day, by hand: the five levels in their own colours
  // (his ask, 09 R12), in a row under the chip; the lit one again clears it.
  root.querySelector('[data-g1-worst]')?.addEventListener('click', () => {
    const iso = dayOf();
    worstOpen = worstOpen === iso ? null : iso;
    tick();
    rerender();
  });
  root.querySelectorAll('[data-g1-wp]').forEach((b) => b.addEventListener('click', () => {
    const iso = dayOf();
    const v = Number(b.dataset.g1Wp);
    worstOpen = null;
    tick();
    save((d) => {
      const f = d.pk.feel[iso] || {};
      if (f.c === v) {
        const next = { ...f, c: null, at: new Date().toISOString() };
        if (feelEmpty(next)) delete d.pk.feel[iso]; else d.pk.feel[iso] = next;
      } else d.pk.feel[iso] = { ...f, c: v, at: new Date().toISOString() };
    });
  }));
  const feelEdit = (change) => {
    const iso = dayOf();
    save((d) => {
      const next = change({ ...(d.pk.feel[iso] || {}) });
      next.c = next.c ?? null;
      if (feelEmpty(next)) delete d.pk.feel[iso]; else d.pk.feel[iso] = next;
    });
  };
  // data-pk-evadd, not data-pk-add: that one is What If's Try another form, and
  // sharing it opened the event sheet from the dose box (his report, 28 Sep).
  // The native Log menu clicks these same buttons (web-overlay/native.js).
  root.querySelectorAll('[data-pk-evadd]').forEach((b) => b.addEventListener('click', (e) => {
    const kind = b.dataset.pkEvadd;
    // The craving stair (07 K9): a swatch logs now. The stair itself is what the
    // native Log > Craving route clicks: on the running day it lights the swatches
    // for the one tap left (Log, Craving, strength: 3 taps); on another day it opens the sheet.
    // The app's Log menu clicks this button from any screen (a script click, not his
    // finger): "Craving now" always means the running day, even after he browsed back
    // to Sunday (audit d-glp1-07).
    if (!e.isTrusted && !isLiveDay(dayOf())) {
      ctx.pkDay = bandDay(); ctx.pkWeekEnd = null; worstOpen = null;
      rerender();
      requestAnimationFrame(() => document.querySelector(`[data-pk-evadd="${kind}"]`)?.click());
      return;
    }
    if (kind === 'crave') {
      if (e.target.closest('[data-g1-qc]')) return;
      if (isLiveDay(dayOf())) {
        b.classList.remove('hint'); void b.offsetWidth; b.classList.add('hint');
        b.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
        tick();
        return;
      }
    }
    tick('light');
    logEvent(dayOf(), kind);
  }));
  root.querySelectorAll('[data-g1-qc]').forEach((b) => b.addEventListener('click', () => {
    const iso = dayOf();
    if (!isLiveDay(iso)) { tick('light'); logEvent(iso, 'crave'); return; }
    const c = Number(b.dataset.g1Qc);
    const t = localParts(Date.now()).time;
    const day = eventDay(todayIso(), t);
    const priorC = (pkDoc().feel || {})[day]?.c ?? null;
    if (day !== iso) pendingDay = day;
    tick('success'); sfx('logsaved');
    const recs = writeEvents(day, { k: 'crave', t, part: partOfTime(t), c }, null);
    actionToast(`${esc(CRAVE[c][1])} craving logged`, 'Undo', () => unwriteEvents(day, recs.map((r) => r.id), priorC));
  }));
  root.querySelectorAll('[data-pk-ev]').forEach((b) => {
    b.addEventListener('click', () => openEvent(dayOf(), b.dataset.pkEv));
    if (b.tagName.toLowerCase() === 'g') b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvent(dayOf(), b.dataset.pkEv); } });
  });
  root.querySelector('[data-g1-more]')?.addEventListener('click', async (e) => {
    const f = (pkDoc().feel || {})[dayOf()] || {};
    const flags = f.flags || [];
    const pick = await pickFrom(e.currentTarget, {
      items: [
        { id: 'ev:crave', title: 'Craving, earlier', symbol: 'clock.arrow.circlepath' },
        ...EVENTS.filter(([k]) => !QUICK.includes(k)).map(([k, l]) => ({ id: `ev:${k}`, title: l, symbol: EV_SYMBOL[k] })),
        ...FLAGS.map(([k, l], i) => ({ id: `fl:${k}`, title: l, checked: flags.includes(k), sep: i === 0, symbol: 'flag' })),
        { id: 'note', title: f.note ? 'Edit note' : 'Add a note', sep: true, symbol: 'note.text' },
        { id: 'sync', title: 'Sync Lose It', symbol: 'arrow.triangle.2.circlepath' },
      ],
    });
    if (!pick) return;
    const [t, k] = pick.split(':');
    if (t === 'ev') logEvent(dayOf(), k);
    if (t === 'fl') feelEdit((x) => { const cur = x.flags || []; const next = cur.includes(k) ? cur.filter((y) => y !== k) : [...cur, k]; if (next.length) x.flags = next; else delete x.flags; return x; });
    if (t === 'note') { noteOpen = dayOf(); rerender(); requestAnimationFrame(() => root.querySelector('[data-pk-note]')?.focus()); }
    if (t === 'sync') syncLoseIt();
  });
  root.querySelectorAll('[data-pk-flag]').forEach((b) => b.addEventListener('click', () => feelEdit((f) => {
    const next = (f.flags || []).filter((x) => x !== b.dataset.pkFlag);
    if (next.length) f.flags = next; else delete f.flags;
    return f;
  })));
  root.querySelectorAll('[data-g1-meal]').forEach((b) => b.addEventListener('click', () => {
    const key = `${dayOf()}|${b.dataset.g1Meal}`;
    mealOpen = mealOpen === key ? null : key;
    rerender();
  }));
  root.querySelectorAll('[data-g1-cday]').forEach((b) => b.addEventListener('click', () => {
    const iso = b.dataset.g1Cday;
    ctx.pkDay = iso;
    ctx.pkWeekEnd = addDays(iso, 3) > todayIso() ? todayIso() : addDays(iso, 3);
    rerender();
    requestAnimationFrame(() => document.querySelector('.g1-week')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }));
  }));
  const syncLoseIt = async () => {
    toast('Syncing Lose It');
    const out = await syncFood();
    if (!out.ok) { toast(`<b>Could not sync Lose It</b><br><span>${esc(out.message)}</span>`, 'warn'); return; }
    if (out.asked && !out.changed) {
      toast(`<b>Asked the Mac to fetch</b><br><span>Only the Mac reads Lose It. It lands here within about ${FOOD_MAC_MINUTES} minutes.</span>`);
      waitForFood((res) => {
        if (res.ok) toast(`<b>${esc(res.message || 'Lose It updated')}</b>`);
        else toast(`<b>Lose It did not update</b><br><span>${esc(res.message)}</span>`, 'warn', { ms: 9000 });
        repaint();
      });
    } else if (!out.asked && !out.server) {
      toast('<b>Could not ask the Mac</b><br><span>Device sync is not connected on this device.</span>', 'warn');
    } else toast(out.changed ? '<b>Lose It updated</b>' : '<b>Nothing new from Lose It</b>');
    repaint();
  };
  const note = root.querySelector('[data-pk-note]');
  if (note) {
    // The box grows with what he writes, so a whole day stays readable.
    const fit = () => { note.style.height = 'auto'; note.style.height = `${note.scrollHeight + 2}px`; };
    fit();
    note.addEventListener('input', fit);
    note.addEventListener('change', () => feelEdit((f) => {
      const text = note.value.trim();
      if (text) f.note = text; else delete f.note;
      return f;
    }));
  }

  // What If.
  root.querySelectorAll('[data-pk-pref]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.pkPref;
    const v = Number(inp.value);
    const cur = prefs();
    const lo = Number(inp.min), hi = Number(inp.max);
    const bad = !Number.isFinite(v) || (inp.min !== '' && v < lo) || (inp.max !== '' && v > hi)
      || (k === 'rangeMin' && v >= cur.rangeMax) || (k === 'rangeMax' && v <= cur.rangeMin);
    if (bad) { inp.value = cur[k]; toast('That number is out of range', 'bad'); return; }
    save((d) => { d.settings.pk = { ...(d.settings.pk || {}), [k]: v }; });
  }));
  const toggle = (id) => {
    const list = plans();
    const cur = selected(list) || new Set([...root.querySelectorAll('.pk-plan.on [data-pk-toggle]')].map((b) => b.dataset.pkToggle));
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    lsSet('plans', [...cur].join(','));
    rerender();
  };
  root.querySelectorAll('[data-pk-toggle]').forEach((b) => b.addEventListener('click', () => { tick(); toggle(b.dataset.pkToggle); }));
  root.querySelectorAll('[data-pk-all]').forEach((b) => b.addEventListener('click', () => {
    lsSet('plans', b.dataset.pkAll === '1' ? plans().map((p) => p.id).join(',') : ',');
    rerender();
  }));
  // Option lists as menus (v3: each select and switch became one menu button).
  const menu = (sel, spec, apply) => root.querySelector(sel)?.addEventListener('click', async (e) => {
    const pick = await pickFrom(e.currentTarget, spec());
    if (pick != null) apply(pick);
  });
  menu('[data-g1-spen]', () => {
    const cur = lsGet('spen', 'best');
    return { title: 'Pen', items: [{ id: 'best', title: 'Cheapest', checked: cur === 'best' }, ...pens().map((x) => ({ id: x.id, title: x.name, checked: cur === x.id }))] };
  }, (v) => { lsSet('spen', v); rerender(); });
  menu('[data-g1-ssort]', () => ({ title: 'Sort', items: SORTS.map(([k, l]) => ({ id: k, title: l, checked: lsGet('ssort', 'order') === k })) }), (v) => { lsSet('ssort', v); rerender(); });
  menu('[data-g1-hsort]', () => ({ title: 'Sort hidden', items: HSORTS.map(([k, l]) => ({ id: k, title: l, checked: lsGet('hsort', 'order') === k })) }), (v) => { lsSet('hsort', v); rerender(); });
  menu('[data-g1-smode]', () => ({ title: 'View', items: [['settled', 'Once settled'], ['today', 'From today']].map(([k, l]) => ({ id: k, title: l, checked: lsGet('smode', 'settled') === k })) }), (v) => { lsSet('smode', v); rerender(); });
  menu('[data-g1-fpen]', () => ({ title: 'Find schedules for', items: pens().map((x) => ({ id: x.id, title: x.name, checked: lsGet('fpen', '') === x.id })) }), (v) => { lsSet('fpen', v); foundState = null; rerender(); });
  // Plan a switch: synced in settings.pk.sw, so every device shows the same plan.
  const setSw = (k, v) => save((d) => { const pk = d.settings.pk || {}; const sw = { ...(pk.sw || {}), [k]: v }; delete sw.route; d.settings.pk = { ...pk, sw }; });
  menu('[data-g1-swto]', () => {
    const M = model();
    const k = M && M.last ? switchPicks(M, plans(), prefs()) : null;
    return { title: 'Switch to', items: (k ? k.opts : []).map((pl) => ({ id: pl.id, title: planName(pl), checked: k && k.toId === pl.id && !routeRec(prefs()) })) };
  }, (v) => setSw('to', v));
  menu('[data-g1-swday]', () => {
    const M = model();
    const k = M && M.last ? switchPicks(M, plans(), prefs()) : null;
    const wd = k ? k.weekday : null;
    return { title: 'Shot day', items: [{ id: 'any', title: 'Any day', checked: wd == null }, ...WDAYS.map((w, i) => ({ id: String(i), title: w, checked: wd === i }))] };
  }, (v) => setSw('day', v === 'any' ? '' : v));
  root.querySelector('[data-pk-swpen]')?.addEventListener('change', (e) => { if (e.target.value) setSw('pen', e.target.value); });
  root.querySelectorAll('[data-pk-uselow]').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.pkUselow);
    if (!(v < prefs().rangeMax)) { toast('That low is above your high', 'bad'); return; }
    save((d) => { d.settings.pk = { ...(d.settings.pk || {}), rangeMin: v }; });
  }));
  root.querySelector('[data-pk-swline]')?.addEventListener('click', () => { lsSet('swline', lsGet('swline', '1') === '1' ? '0' : '1'); rerender(); });
  root.querySelectorAll('[data-pk-route]').forEach((b) => b.addEventListener('click', () => {
    const off = new Set((lsGet('routesoff', '') || '').split(',').filter(Boolean));
    const id = b.dataset.pkRoute;
    if (off.has(id)) off.delete(id); else off.add(id);
    lsSet('routesoff', [...off].join(',')); rerender();
  }));
  root.querySelectorAll('[data-pk-sweeks]').forEach((b) => b.addEventListener('click', () => { lsSet('sweeks', b.dataset.pkSweeks); tick(); rerender(); }));
  bindCompare(root);
  root.querySelectorAll('[data-pk-hide]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkHide;
    save((d) => { const x = d.pk.plans[id]; if (x) d.pk.plans[id] = { ...x, hidden: true }; });
  }));
  root.querySelectorAll('[data-pk-unhide]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkUnhide;
    save((d) => { const x = d.pk.plans[id]; if (x) d.pk.plans[id] = { ...x, hidden: false }; });
  }));
  // Delete takes it out of his data at once; the toast's Undo puts it back.
  root.querySelectorAll('[data-pk-del]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkDel;
    const was = pkDoc().plans?.[id];
    if (!was) return;
    save((d) => { delete d.pk.plans[id]; });
    actionToast(`Deleted ${esc(planName(was))}`, 'Undo', () => save((d) => { d.pk.plans[id] = { ...was }; }));
  }));
  const add = root.querySelector('[data-pk-add]');
  if (add) add.addEventListener('submit', (e) => {
    e.preventDefault();
    const mg = Number(add.mg.value), every = Number(add.every.value);
    if (!(mg > 0) || !(every > 0)) return;
    const id = `p${uid()}`;
    const all = plans();
    const order = Math.max(0, ...all.map((x) => x.order ?? 0)) + 1;
    const taken = new Set(Object.values(planColors(all)));
    let color = 0;
    while (taken.has(color) && color < SERIES - 1) color++;
    const cur = selected(all);
    if (cur) { cur.add(id); lsSet('plans', [...cur].join(',')); }
    save((d) => { d.pk.plans[id] = { mg, everyDays: every, order, color }; });
  });
  const find = root.querySelector('[data-pk-find]');
  if (find) find.addEventListener('click', () => {
    const pen = pens().find((x) => x.id === find.dataset.pkFind);
    const M = model();
    if (!pen || !M) return;
    const same = (x, f) => Math.abs(x.mg - f.mg) < 1e-6 && Math.abs(x.everyDays - f.everyDays) < 1e-6;
    const recs = Object.entries(pkDoc().plans || {}).map(([id, x]) => ({ id, ...x })).filter((x) => !x.route);
    const items = [];
    let listed = 0;
    for (const f of findSchedules(M, pen, prefs())) {
      const had = recs.find((x) => same(x, f));
      if (had && !had.hidden) { listed++; continue; }
      items.push({ ...f, key: `${f.mg}|${f.everyDays}`, hiddenId: had ? had.id : null });
    }
    foundState = { pen: pen.id, items, listed, pick: new Set() };
    rerender();
  });
  root.querySelectorAll('[data-pk-fitem]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.pkFitem;
    if (foundState.pick.has(k)) foundState.pick.delete(k); else foundState.pick.add(k);
    rerender();
  }));
  root.querySelectorAll('[data-pk-fclose]').forEach((b) => b.addEventListener('click', () => { foundState = null; rerender(); }));
  // His call (2026-09-28): Find only SHOWS what fits; nothing reaches his list
  // before he picks and confirms with Add.
  const fadd = root.querySelector('[data-pk-fadd]');
  if (fadd) fadd.addEventListener('click', () => {
    const f = foundState;
    const chosen = f.items.filter((x) => f.pick.has(x.key));
    if (!chosen.length) return;
    const add2 = chosen.filter((x) => !x.hiddenId), unhide = chosen.filter((x) => x.hiddenId).map((x) => x.hiddenId);
    const all = plans();
    let order = Math.max(0, ...all.map((x) => x.order ?? 0));
    const taken = new Set(Object.values(planColors(all)));
    const ids = add2.map(() => `p${uid()}`);
    const cur = selected(all);
    if (cur) { [...ids, ...unhide].forEach((id) => cur.add(id)); lsSet('plans', [...cur].join(',')); }
    foundState = null;
    save((d) => {
      add2.forEach((x, i) => {
        let color = 0;
        while (taken.has(color) && color < SERIES - 1) color++;
        taken.add(color);
        d.pk.plans[ids[i]] = { mg: x.mg, everyDays: x.everyDays, order: ++order, color, found: f.pen };
      });
      unhide.forEach((id) => { d.pk.plans[id] = { ...d.pk.plans[id], hidden: false }; });
    });
    toast(`Added ${chosen.map((x) => `${mgStr(x.mg)} mg every ${mgStr(x.everyDays)} d`).join(', ')}`);
  });
}

// The level chart under his finger (v3). A sideways swipe scrolls through the
// record (native momentum scrolling, the axis refits as it moves); press and hold,
// then drag, reads any hour: the hero number swaps to the value under the finger,
// a callout names the moment, and a tick is felt at each shot and each time the
// line crosses his range lines. A tap opens the native full screen chart; with no
// native chart it drops a reading where he tapped (tap again to clear).
function bindPlot(root) {
  const wrap = root.querySelector('[data-g1-chart]');
  const c = chartState;
  if (!wrap || !c) return;
  const plot = wrap.querySelector('.g1-plot');
  const svg = plot.querySelector('svg.g1-draw');
  const guide = svg.querySelector('.g1-guide');
  const call = wrap.querySelector('[data-g1-callout]');
  const num = root.querySelector('[data-g1-num]');
  const sub = root.querySelector('[data-g1-sub]');
  const sc = c.scroll ? plot.querySelector('.g1-scroll') : null;
  if (sc) {
    // Open where he left it (the right edge's time), else on the usual window.
    const k = () => sc.scrollWidth / c.W;
    const edgeX = c.X(levelEndT ?? c.vx1) + c.m.r;
    sc.scrollLeft = Math.max(0, edgeX * k() - sc.clientWidth);
    const tAt = (px) => c.x0 + ((px - c.m.l) / c.pw) * (c.x1 - c.x0);
    let raf = 0;
    // Axis words that would be cut at the window's edges are hidden until they are
    // whole again (audit d-glp1-25): no half dates, no half numbers.
    const edgeLabs = [...svg.querySelectorAll('text[data-hw]')].map((el) => ({ el, x: +el.getAttribute('x'), hw: +el.dataset.hw }));
    const fit = () => {
      raf = 0;
      if (chartState !== c || !sc.isConnected) return;   // the page moved on (Log > Craving switches part)
      const b = tAt((sc.scrollLeft + sc.clientWidth) / k() - c.m.r);
      const a = tAt(sc.scrollLeft / k() + c.m.l);
      c.refit(plot, c.scaleAt(a, b));
      const vl = sc.scrollLeft / k() + 2, vr = (sc.scrollLeft + sc.clientWidth) / k() - c.m.r - 2;
      for (const q of edgeLabs) q.el.style.visibility = q.x - q.hw < vl || q.x + q.hw > vr ? 'hidden' : '';
    };
    sc.addEventListener('scroll', () => {
      levelEndT = tAt((sc.scrollLeft + sc.clientWidth) / k() - c.m.r);
      if (!raf) raf = requestAnimationFrame(fit);
    }, { passive: true });
    fit();
  }
  const M = c.M;
  const nowHtml = num ? num.innerHTML : '';
  const nowSub = sub ? sub.textContent : '';
  const tOf = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * c.W;
    return Math.min(c.x1, Math.max(c.x0, c.x0 + ((px - c.m.l) / c.pw) * (c.x1 - c.x0)));
  };
  let cur = M.now;
  let pinned = false;
  let lastShot = null, lastZone = null;
  const zoneOf = (v) => (v < c.p.rangeMin ? -1 : v > c.p.rangeMax ? 1 : 0);
  const show = (t, { feel = true } = {}) => {
    cur = t;
    const v = c.val(M.withNext, t);
    const x = c.X(t), y = c.Y(v);
    guide.style.opacity = '1';
    guide.querySelector('line').setAttribute('x1', x); guide.querySelector('line').setAttribute('x2', x);
    guide.querySelector('circle').setAttribute('cx', x); guide.querySelector('circle').setAttribute('cy', y);
    if (num) num.innerHTML = `${r0(v)}<small>%</small>`;
    if (sub) sub.textContent = heroSub(M, t);
    num?.classList.add('scrub');
    root.querySelector('[data-g1-level]')?.classList.add('scrub');
    if (call) {
      call.innerHTML = calloutAt(t);
      const r = svg.getBoundingClientRect(), wr = plot.getBoundingClientRect();
      const cx = r.left - wr.left + (x / c.W) * r.width;
      const w = call.offsetWidth || 140;
      call.style.transform = `translateX(${Math.max(6, Math.min(wr.width - c.m.r - w - 4, cx - w / 2)).toFixed(1)}px)`;
      call.classList.add('on');
    }
    // A tick at each shot the rule passes, and at each crossing of his lines.
    if (feel) {
      const px = (c.x1 - c.x0) / c.pw * 6;
      const shot = [...M.shots, ...M.proj].find((s) => Math.abs(s.t - t) < px);
      const zone = zoneOf(v);
      if ((shot && shot !== lastShot) || (lastZone != null && zone !== lastZone)) tick();
      lastShot = shot || null;
      lastZone = zone;
    }
  };
  const hide = () => {
    pinned = false;
    guide.style.opacity = '0';
    if (num) { num.innerHTML = nowHtml; num.classList.remove('scrub'); }
    if (sub) sub.textContent = nowSub;
    root.querySelector('[data-g1-level]')?.classList.remove('scrub');
    call?.classList.remove('on');
    lastShot = null; lastZone = null;
  };
  const openFull = async (t) => {
    const spec = nativeChartSpec();
    const res = spec ? await nativeFirst('chart.show', spec) : { web: true };
    if (!res.web) return;
    // No native chart: a tap drops a reading and keeps it; tap again to clear.
    if (pinned && Math.abs(t - cur) < (c.x1 - c.x0) / c.pw * 24) hide();
    else { pinned = true; show(t, { feel: false }); tick('light'); }
  };

  // Touch: hold to scrub, swipe to scroll, tap to open.
  let tStart = null, holdT = 0, scrubbing = false, moved = false;
  plot.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { clearTimeout(holdT); return; }
    const tt = e.touches[0];
    tStart = { x: tt.clientX, y: tt.clientY, at: Date.now() };
    moved = false; scrubbing = false;
    clearTimeout(holdT);
    holdT = setTimeout(() => {
      if (moved) return;
      scrubbing = true;
      plot.classList.add('scrubbing');
      tick('light');
      show(tOf(tStart.x));
    }, 240);
  }, { passive: true });
  plot.addEventListener('touchmove', (e) => {
    const tt = e.touches[0];
    if (!tStart || !tt) return;
    if (scrubbing) { e.preventDefault(); show(tOf(tt.clientX)); return; }
    if (Math.abs(tt.clientX - tStart.x) > 8 || Math.abs(tt.clientY - tStart.y) > 8) { moved = true; clearTimeout(holdT); }
  }, { passive: false });
  const end = () => {
    clearTimeout(holdT);
    if (scrubbing) { scrubbing = false; plot.classList.remove('scrubbing'); hide(); }
    else if (tStart && !moved && Date.now() - tStart.at < 400) openFull(tOf(tStart.x));
    tStart = null;
  };
  plot.addEventListener('touchend', end);
  plot.addEventListener('touchcancel', () => { clearTimeout(holdT); scrubbing = false; plot.classList.remove('scrubbing'); tStart = null; if (!pinned) hide(); });
  // A mouse or trackpad (iPad, Mac): hover reads, a click opens.
  plot.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !pinned) show(tOf(e.clientX), { feel: false }); });
  plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned) hide(); });
  plot.addEventListener('click', (e) => { if (e.pointerType === 'mouse' || e.detail === 0) openFull(tOf(e.clientX)); });
  plot.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hide(); return; }
    if (e.key === 'Enter') { e.preventDefault(); openFull(cur); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    pinned = true;
    show(Math.min(c.x1, Math.max(c.x0, cur + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1) * DAY / 4)), { feel: false });
  });
}

// ------------------------------------------------------------ shot sheet --
function localParts(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
function isoWithOffset(date, time) {
  const d = new Date(`${date}T${time || '12:00'}`);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${date}T${time || '12:00'}:00${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

/** "Today", "Yesterday" or the date, for a capsule. */
const dayCap = (iso) => (iso === todayIso() ? 'Today' : iso === addDays(todayIso(), -1) ? 'Yesterday' : dayName(midnight(iso)));

/** A date capsule: the day in words, the system date picker under a tap. Never a future day. */
function dateCapsule(date) {
  return `<label class="g1-capsule">${G.calendar}<span data-dlabel>${esc(dayCap(date))}</span><input type="date" name="date" value="${date}" max="${todayIso()}" aria-label="Date"></label>`;
}
function bindDateCapsule(f, st, onChange) {
  const inp = f.querySelector('[name=date]');
  inp.addEventListener('change', () => {
    if (inp.value && inp.value <= todayIso()) st.date = inp.value;
    inp.value = st.date;
    f.querySelector('[data-dlabel]').textContent = dayCap(st.date);
    onChange?.();
  });
}

/** Open one fold under the summary tiles, close the others (pickers near the field). */
function bindFolds(f) {
  const set = (k, on) => {
    const body = f.querySelector(`[data-body="${k}"]`);
    const head = f.querySelector(`[data-open="${k}"]`);
    if (!body || head.classList.contains('open') === on) return;
    head.setAttribute('aria-expanded', String(on));
    head.classList.toggle('open', on);
    body.inert = !on;
    if (reducedMotion() || liteMotion()) { body.classList.toggle('shut', !on); return; }
    body.classList.add('animating');
    body.classList.toggle('closing', !on);
    requestAnimationFrame(() => body.classList.toggle('shut', !on));
    clearTimeout(body.pkT);
    body.pkT = setTimeout(() => body.classList.remove('animating', 'closing'), 340);
  };
  f.querySelectorAll('[data-open]').forEach((h) => h.addEventListener('click', () => {
    const k = h.dataset.open;
    const opening = !h.classList.contains('open');
    f.querySelectorAll('[data-open]').forEach((o) => set(o.dataset.open, opening && o.dataset.open === k));
  }));
  return { close: (k) => set(k, false) };
}

/**
 * Where each site was last used, and the zone to suggest: the stomach zone that
 * has rested longest, never the one used last (plain rotation, his to override;
 * no medical claim). Belly first because the arm needs someone else.
 */
function siteRest(M, excludeId) {
  const lastUse = {};
  for (const s of M.shots) if (s.site && s.id !== excludeId) lastUse[s.site] = s.t;
  const lastShot = [...M.shots].reverse().find((s) => s.site && s.id !== excludeId) || null;
  const belly = SITES.map(([k]) => k).filter((k) => k.startsWith('stomach-') && k !== 'stomach-c');
  const next = belly.filter((k) => !lastShot || k !== lastShot.site)
    .sort((a, b) => (lastUse[a] ?? -Infinity) - (lastUse[b] ?? -Infinity))[0] || null;
  return { lastUse, last: lastShot ? lastShot.site : null, next };
}

/**
 * Log a shot (v3, research 03 section 3.4): a summary that is already right. Time
 * now, his last dose, his pen, his usual priming and the suggested next site are
 * filled in, so the usual shot is one tap on Log shot. Every choice sits under
 * its own tile. Still the page's own save, field for field as before.
 */
function openShot(id) {
  const M = model();
  if (!M) return;
  const raw = id ? pkDoc().shots[id] : null;
  const shot = raw ? { id, ...raw, t: Date.parse(raw.at) } : null;
  const last = M.last;
  const start = localParts(shot ? shot.t : Date.now());
  const std = M.drug.doses || [];
  const rest = siteRest(M, shot?.id);
  // A new shot on a shot day (or while one is due) starts on the planned dose and its pen,
  // the ones the shot day card shows; otherwise his last dose (audit r3 glp1-01).
  const due = shot ? null : shotDue(M);
  const duePen = due ? penFor(M, due.dose).pen : null;
  const st = {
    date: start.date,
    time: shot && shot.timeKnown === false ? '' : start.time,
    mg: shot ? shot.mg : due ? due.dose.mg : last ? last.mg : std[0] || null,
    site: shot ? shot.site || '' : rest.next || '',
    note: shot?.note || '',
  };
  // Pen facts (his ask, 2026-09-28): priming clicks on every shot and the clicks
  // left on a pen's last scheduled day, so the real extra fill can be counted.
  // The plan's last day on the old pen and first on the new one set the defaults.
  const pp = prefs();
  const penList = pens();
  const plan = switchLine(M, plans(), pp);
  const finalDay = plan && plan.cur && plan.cur.length ? isoOf(plan.cur[plan.cur.length - 1].t) : null;
  const landDay = plan && plan.land ? isoOf(plan.land) : null;
  const near = (day) => !!day && Math.abs(midnight(st.date) - midnight(day)) <= 2 * DAY;
  Object.assign(st, {
    pen: shot ? shot.pen || pp.penId || '' : (duePen && penList.some((x) => x.id === duePen.id) && duePen.id) || (landDay && st.date >= landDay && plan.route?.penTo) || pp.penId || '',
    newPen: shot ? !!shot.newPen || /new pen/i.test(shot.note || '') : near(landDay),
    lastPen: shot ? !!shot.lastPen || shot.left != null : near(finalDay),
    prime: shot ? (shot.prime ?? '') : (pp.primeClicks ?? ''),
    left: shot?.left ?? '',
  });
  // His own doses: the non-standard amounts he has actually taken, newest first.
  const mine = [];
  for (const s of [...M.shots].reverse()) {
    if (!std.includes(s.mg) && !mine.includes(s.mg)) mine.push(s.mg);
    if (mine.length === 4) break;
  }
  const doseVal = () => (st.mg > 0 ? `${mgStr(st.mg)} mg` : 'Choose');
  const penName = () => (penList.find((x) => x.id === st.pen) || {}).name || 'Choose';
  const chip = (v) => `<button type="button" class="g1-dose ${st.mg === v ? 'on' : ''}" data-mg="${v}" aria-pressed="${st.mg === v}">${mgStr(v)}</button>`;
  const other = st.mg != null && !std.includes(st.mg) && !mine.includes(st.mg) ? st.mg : '';
  const fold = (k, html) => `<div class="fold-body shut" data-body="${k}" inert><div class="fold-clip"><div class="g1-foldin">${html}</div></div></div>`;
  const doseBody = `
    <div class="g1-doses">${std.map(chip).join('')}</div>
    ${mine.length ? `<h3>Your doses</h3><div class="g1-doses">${mine.map(chip).join('')}</div>` : ''}
    <label class="g1-inline"><span>Other</span><span class="g1-numin"><input class="in-num" type="number" inputmode="decimal" step="any" min="0.01" name="mg" value="${other}" placeholder="0"><b>mg</b></span></label>`;
  const penBody = `<div class="g1-tiles">${penList.map((x) => `<button type="button" class="g1-tile ${st.pen === x.id ? 'on' : ''}" data-pen="${esc(x.id)}" aria-pressed="${st.pen === x.id}"><span>${esc(x.name)}</span></button>`).join('')}</div>`;
  // The torso, seen the way he looks down at his own belly: his left on the
  // left (his rule). Each zone is shaded by how long it has rested.
  const ageCls = (k) => {
    const t = rest.lastUse[k];
    if (t == null) return 'r3';
    const d = (Date.now() - t) / DAY;
    return d < 8 ? 'r0' : d < 15 ? 'r1' : d < 29 ? 'r2' : 'r3';
  };
  const zone = (k, label = '') => `<button type="button" class="g1-zone ${ageCls(k)} ${st.site === k ? 'on' : ''}" data-site="${k}" aria-pressed="${st.site === k}" aria-label="${esc(SITE_NAME[k])}${rest.last === k ? ', last used' : ''}${rest.next === k ? ', suggested next' : ''}">${rest.last === k ? '<em>Last</em>' : rest.next === k ? '<em>Next</em>' : ''}${label ? `<span>${label}</span>` : ''}</button>`;
  const torso = `<div class="g1-torso" role="group" aria-label="Site">
    <div class="g1-arm l">${zone('arm-l', 'Arm')}</div>
    <div class="g1-belly">${ROWS3.map(([r]) => COLS3.map(([c]) => (r === 'm' && c === 'm' ? '<span class="g1-navel" title="Belly button: stay 2 inches away"><i></i></span>' : zone(stomachKey(r, c)))).join('')).join('')}</div>
    <div class="g1-arm r">${zone('arm-r', 'Arm')}</div>
    <div class="g1-legs">${zone('thigh-l', 'Left thigh')}${zone('thigh-r', 'Right thigh')}</div>
  </div>
  <div class="g1-sitefoot"><span data-val="site">${esc(st.site ? SITE_NAME[st.site] || st.site : 'No site')}</span><span class="g1-restkey"><i class="r0"></i>Used this week<i class="r3"></i>Rested</span></div>`;

  const body = `<div class="g1-shotsheet">
    <div class="g1-when">${dateCapsule(st.date)}<label class="g1-capsule"><input class="g1-time" type="time" name="time" value="${st.time}" aria-label="Time"></label></div>
    <div class="g1-sum">
      <button type="button" class="g1-sumtile" data-open="dose" aria-expanded="false"><small>Dose</small><b data-val="dose">${esc(doseVal())}</b></button>
      ${penList.length ? `<button type="button" class="g1-sumtile" data-open="pen" aria-expanded="false"><small>Pen</small><b data-val="pen">${esc(penName())}</b></button>` : ''}
    </div>
    ${fold('dose', doseBody)}
    ${penList.length ? fold('pen', penBody) : ''}
    ${torso}
    <div class="g1-toggles">
      <button type="button" class="g1-toggle ${st.newPen ? 'on' : ''}" data-pk-newpen aria-pressed="${st.newPen}">First from a new pen</button>
      <button type="button" class="g1-toggle ${st.lastPen ? 'on' : ''}" data-pk-lastpen aria-pressed="${st.lastPen}">Last from this pen</button>
    </div>
    <label class="g1-inline"><span>Priming</span><span class="g1-numin"><input class="in-num" type="number" inputmode="numeric" min="0" max="60" step="1" name="prime" value="${st.prime}" placeholder="0" aria-label="Priming clicks"><b>clicks</b></span></label>
    <label class="g1-inline" data-pk-leftrow ${st.lastPen ? '' : 'hidden'}><span>Left in the pen</span><span class="g1-numin"><input class="in-num" type="number" inputmode="numeric" min="0" max="300" step="1" name="left" value="${st.left}" placeholder="0" aria-label="Clicks left in the pen"><b>clicks</b></span></label>
    <input class="g1-comment" type="text" name="note" maxlength="200" value="${esc(st.note)}" placeholder="Note" aria-label="Note">
    ${shot ? '<button type="button" class="g1-remove" data-pk-remove>Remove</button>' : ''}
  </div>`;
  const footer = `<button class="btn primary" data-pk-save>${shot ? 'Save' : 'Log shot'}</button>`;

  openModal({
    title: shot ? 'Edit shot' : 'Shot',   // the button says Log shot; the title says it once (audit d-glp1-38)
    body, footer,
    onMount(back) {
      const f = back.querySelector('.g1-shotsheet');
      const folds = bindFolds(f);
      bindDateCapsule(f, st);
      const setVal = (k, v) => { const el = f.querySelector(`[data-val="${k}"]`); if (el) el.textContent = v; };
      const mgIn = f.querySelector('[name=mg]');
      const markChips = () => f.querySelectorAll('[data-mg]').forEach((x) => { const on = Number(x.dataset.mg) === st.mg; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      f.querySelectorAll('[data-mg]').forEach((b) => b.addEventListener('click', () => {
        st.mg = Number(b.dataset.mg); mgIn.value = ''; markChips(); setVal('dose', doseVal()); tick();
        setTimeout(() => folds.close('dose'), 160);
      }));
      mgIn.addEventListener('input', () => { const v = Number(mgIn.value); st.mg = v > 0 ? v : null; markChips(); setVal('dose', doseVal()); });
      f.querySelectorAll('[data-site]').forEach((b) => b.addEventListener('click', () => {
        st.site = st.site === b.dataset.site ? '' : b.dataset.site;
        f.querySelectorAll('[data-site]').forEach((x) => { const on = x.dataset.site === st.site; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        setVal('site', st.site ? SITE_NAME[st.site] || st.site : 'No site');
        tick();
      }));
      const noteIn = f.querySelector('[name=note]');
      noteIn.addEventListener('input', () => { st.note = noteIn.value; });
      f.querySelector('[name=time]').addEventListener('change', (e) => { st.time = e.target.value; });
      const leftRow = f.querySelector('[data-pk-leftrow]');
      f.querySelectorAll('[data-pen]').forEach((b) => b.addEventListener('click', () => {
        st.pen = b.dataset.pen;
        f.querySelectorAll('[data-pen]').forEach((x) => { const on = x.dataset.pen === st.pen; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        setVal('pen', penName()); tick();
        setTimeout(() => folds.close('pen'), 160);
      }));
      const flag = (sel, k) => f.querySelector(sel)?.addEventListener('click', (e) => {
        st[k] = !st[k]; e.currentTarget.classList.toggle('on', st[k]); e.currentTarget.setAttribute('aria-pressed', String(st[k]));
        if (k === 'lastPen') leftRow.hidden = !st.lastPen;
        tick();
      });
      flag('[data-pk-newpen]', 'newPen');
      flag('[data-pk-lastpen]', 'lastPen');

      back.querySelector('[data-pk-save]').addEventListener('click', () => {
        st.time = f.querySelector('[name=time]').value;
        if (!st.date || !(st.mg > 0)) { toast('Choose a dose first', 'bad'); return; }
        // With no time it is stored at noon; a shot logged today at 9 with the
        // time left blank is not "in the future" (2026-09-22 audit).
        const future = st.time ? Date.parse(isoWithOffset(st.date, st.time)) > Date.now() + 10 * 60e3 : st.date > todayIso();
        if (future) { toast(st.time ? 'That time has not happened yet' : 'That day has not happened yet', 'bad'); return; }
        const rec = {
          ...(raw || {}),
          at: isoWithOffset(st.date, st.time), mg: st.mg, drug: M.drug.id, site: st.site || null,
          timeKnown: !!st.time, note: st.note.trim(), updatedAt: new Date().toISOString(),
        };
        if (!shot) { rec.createdAt = rec.updatedAt; rec.brand = M.drug.brand || M.drug.name; }
        const num = (name) => { const v = f.querySelector(`[name=${name}]`).value.trim(); return v === '' || !(Number(v) >= 0) ? null : Math.round(Number(v)); };
        const prime = num('prime'), left = st.lastPen ? num('left') : null;
        if (st.pen) rec.pen = st.pen; else delete rec.pen;
        if (prime != null) rec.prime = prime; else delete rec.prime;
        if (st.newPen) rec.newPen = true; else delete rec.newPen;
        if (st.lastPen) rec.lastPen = true; else delete rec.lastPen;
        if (left != null) rec.left = left; else delete rec.left;
        const key = shot ? shot.id : `s${uid()}`;
        save((d) => { d.pk.shots[key] = rec; });
        closeModal();
        tick('success'); sfx('logsaved');
        toast(shot ? 'Shot saved' : `${mgStr(st.mg)} mg logged`);
      });
      back.querySelector('[data-pk-remove]')?.addEventListener('click', () => {
        save((d) => { const s = d.pk.shots[shot.id]; if (s) d.pk.shots[shot.id] = { ...s, removed: true, removedAt: new Date().toISOString() }; });
        closeModal();
        actionToast('Shot removed', 'Undo', () => save((d) => { const s = d.pk.shots[shot.id]; if (s) d.pk.shots[shot.id] = { ...s, removed: false, restoredAt: new Date().toISOString() }; }));
      });
    },
  });
}

// ---------------------------------------------------------- weight sheet --
// A weight is the app's own bodyweight measurement, so the rehab markers that
// read bodyweight and this model both use it.
const LB = 2.2046226218;
const unitNow = () => state.data.settings.weightUnit || 'kg';
/** A measurement in his unit, to one decimal. */
const inUnit = (m, unit = unitNow()) => Math.round((m.unit === unit ? m.value : toKg(m.value, m.unit || unitNow()) * (unit === 'lb' ? LB : 1)) * 10) / 10;

/**
 * Save one weight, the one path every sheet uses. One weight a day: a second on
 * the same date replaces the first, so two devices cannot disagree about which
 * is the latest (audit F34). Clinic weights are never touched. Editing a row onto
 * a date that already has one leaves that date with one.
 */
function saveWeight(v, unit, date, row) {
  const same = allMeasurements().filter((m) => m.measure === 'bodyweight' && m.date === date && !m.src?.startsWith('Clinic'));
  const mine = same.find((m) => (state.data.measurements || []).some((x) => x.id === m.id));
  if (mine) update((d) => {
    const r = d.measurements.find((x) => x.id === mine.id);
    if (r) { r.value = v; r.unit = unit; r.at = new Date().toISOString(); }
    if (row && row.id !== mine.id) d.measurements = d.measurements.filter((x) => x.id !== row.id);
    syncBodyweightSetting(d);
  });
  else if (row) update((d) => {
    // A changed date moves the row he is editing (it used to add a new one and
    // leave the old one where it was, 2026-09-22 audit).
    const r = d.measurements.find((x) => x.id === row.id);
    if (r) { r.value = v; r.unit = unit; r.date = date; r.at = new Date().toISOString(); }
    syncBodyweightSetting(d);
  });
  else addMeasurement({ measure: 'bodyweight', leg: null, value: v, unit, date, at: new Date().toISOString(), src: 'Logged in the app' });
  repaint();
}

/**
 * Log weight: the native weight sheet where the app has one (it returns pounds
 * and a date; this page saves them in his unit), else the page's own sheet. An
 * edit of a row he tapped always uses the page's sheet, which holds Remove.
 */
async function openWeight(onDate) {
  if (!onDate) {
    const prev = latest('bodyweight', null);
    const lastLb = prev ? Math.round(toKg(prev.value, prev.unit || unitNow()) * LB * 10) / 10 : (bodyweightKg() ? Math.round(bodyweightKg() * LB * 10) / 10 : null);
    const res = await nativeFirst('sheet.weight', { lastLb, lastDate: prev ? midnight(prev.date) + 12 * HOUR : null, lastDateIso: prev ? prev.date : null, dateIso: todayIso(), unit: 'lb' });
    if (!res.web) {
      const out = res.value;
      if (!out || !(Number(out.lb) > 0)) return;
      const unit = unitNow();
      const date = typeof out.dateIso === 'string' && out.dateIso <= todayIso() ? out.dateIso : todayIso();
      const v = unit === 'lb' ? Math.round(Number(out.lb) * 10) / 10 : Math.round((Number(out.lb) / LB) * 10) / 10;
      const low = unit === 'lb' ? 44 : 20, high = unit === 'lb' ? 700 : 320;
      if (!(v >= low && v <= high)) { toast(`Enter your weight in ${unit}`, 'bad'); return; }
      saveWeight(v, unit, date, null);
      tick('success'); sfx('logsaved');
      toast(`${v} ${unit} logged`);
      return;
    }
  }
  openWeightSheet(onDate);
}

/**
 * The page's own weight sheet (v3, research 03 section 3.5 and ruling K11): the
 * number big and prefilled with the last reading, selected so one keystroke
 * replaces it, a 0.1 step either side, and the change from the last reading
 * live under it. Pounds or kilograms as his settings say (he reads pounds).
 */
function openWeightSheet(onDate) {
  const unit = unitNow();
  const prev = latest('bodyweight', null);
  const kg = bodyweightKg();
  const row = onDate ? (state.data.measurements || []).find((m) => m.measure === 'bodyweight' && m.date === onDate) : null;
  const shown = row ? inUnit(row, unit) : (kg ? Math.round((unit === 'lb' ? kg * LB : kg) * 10) / 10 : '');
  const st = { date: onDate || todayIso() };
  const prevV = prev ? inUnit(prev, unit) : null;
  const ctxLine = (v) => {
    if (row || prevV == null) return '';
    const dlt = Math.round((v - prevV) * 10) / 10;
    const when = dayCap(prev.date);
    return `${when} ${prevV}${Number.isFinite(dlt) && v > 0 && dlt !== 0 ? ` · ${dlt > 0 ? 'up' : 'down'} ${Math.abs(dlt)}` : ''}`;
  };
  openModal({
    title: row ? 'Edit weight' : 'Weight',
    body: `<div class="g1-wsheet">
      <div class="g1-when">${dateCapsule(st.date)}</div>
      <div class="g1-wbig">
        <button type="button" class="g1-step1" data-wstep="-1" aria-label="Down 0.1">${G.minus}</button>
        <label><input class="g1-wnum" type="number" inputmode="decimal" step="0.1" min="20" max="700" name="w" value="${shown}" placeholder="${shown || '0'}" aria-label="Weight in ${unit}"><b>${unit}</b></label>
        <button type="button" class="g1-step1" data-wstep="1" aria-label="Up 0.1">${G.plus}</button>
      </div>
      <p class="g1-wctx" data-wctx>${esc(ctxLine(Number(shown)))}</p>
      ${row ? '<button type="button" class="g1-remove" data-pk-wdel>Remove</button>' : ''}
    </div>`,
    footer: `<button class="btn primary" data-pk-wsave>Save</button>`,
    onMount(back) {
      const f = back.querySelector('.g1-wsheet');
      bindDateCapsule(f, st);
      const inp = f.querySelector('[name=w]');
      const ctxEl = f.querySelector('[data-wctx]');
      const upd = () => { ctxEl.textContent = ctxLine(Number(inp.value)); };
      inp.addEventListener('input', upd);
      inp.addEventListener('focus', () => { try { inp.select(); } catch { /* ignore */ } });
      let rep = 0;
      f.querySelectorAll('[data-wstep]').forEach((b) => {
        const stepOnce = () => { const v = Number(inp.value) || Number(shown) || 0; inp.value = (Math.round((v + Number(b.dataset.wstep) * 0.1) * 10) / 10).toFixed(1); upd(); tick(); };
        b.addEventListener('pointerdown', () => { stepOnce(); clearInterval(rep); rep = setTimeout(() => { rep = setInterval(stepOnce, 90); }, 420); });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => { clearTimeout(rep); clearInterval(rep); }));
      });
      const doSave = () => {
        const v = Number(inp.value);
        const low = unit === 'lb' ? 44 : 20, high = unit === 'lb' ? 700 : 320;
        if (!(v >= low && v <= high)) { toast(`Enter your weight in ${unit}`, 'bad'); return; }
        saveWeight(v, unit, st.date, row);
        closeModal();
        tick('success'); sfx('logsaved');
        toast(`${v} ${unit} logged`);
      };
      back.querySelector('[data-pk-wsave]').addEventListener('click', doSave);
      back.querySelector('[data-pk-wdel]')?.addEventListener('click', () => {
        // No Undo here: a removed record leaves a tombstone for sync, and putting
        // the same id back would fight it. As before, log the weight again instead.
        update((d) => {
          d.measurements = d.measurements.filter((m) => m.id !== row.id);
          syncBodyweightSetting(d);
        });
        repaint();
        closeModal();
        toast('Weight removed');
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } });
    },
  });
}
