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
import { ringReady, shotNightEffect, shotSentence } from '../ring.js';
import { openModal, closeModal, toast } from '../components.js';
import { bodyweightKg } from '../goals.js';
import { contentWidth } from './overview.js';
import { liteMotion } from '../motion.js';
import { reducedMotion } from '../fold.js';
import { personParams, simulate, at, steadyState, spread, penMath, bestCut, terminalHalfLife, MS } from '../pk.js';
import { glide } from '../glide.js';

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
/** A feel record with nothing left in it is removed, never kept empty. */
const feelEmpty = (f) => f.c == null && !f.note && !Object.keys(f.tags || {}).length && !(f.when || []).length;
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
let craveTap = false;   // a tap on the cravings scale, read by the paint it asks for (B5-4)
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
  .filter((p) => p.mg > 0 && p.everyDays > 0 && !p.hidden)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.everyDays - b.everyDays || a.mg - b.mg);
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
const timeName = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hourName = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric' });
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
  const key = JSON.stringify([drug.model, drug.ref, b, p.everyDays, shots.map((s) => [s.id, s.t, s.mg, s.site, s.timeKnown, s.note]), Math.floor(now / (5 * 60e3))]);   // every shown field, so an edited site shows at once
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
    let t = Math.max(later(last.t, every), now);
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
const hardDay = (f) => !!f && ((f.c != null && f.c >= 3) || ((f.tags || {}).stuck > 0));
/** A calm day: None or Slight, or settled easily, and never Stuck. */
const calmDay = (f) => !!f && !hardDay(f) && ((f.c != null && f.c <= 1) || ((f.tags || {}).easy > 0));
/** Logged days with their lowest waking level, marked hard or calm. */
function feelLows(M) {
  return Object.entries(pkDoc().feel || {})
    .map(([iso, f]) => ({ iso, f, low: dayLow(M, iso), hard: hardDay(f), calm: calmDay(f) }))
    .filter((r) => r.low != null && (r.hard || r.calm) && r.iso <= todayIso());
}

// ---------------------------------------------------------------- render --
export function renderMedLevel(ctx) {
  chartState = null;
  compareState = null;
  const M = model();
  if (!M) return '<div class="empty">No medication set up.</div>';
  const part = ctx.pkPart || 'level';
  return `<div class="stack pk">
    <div class="tabrow subtabs" role="tablist" aria-label="${esc(M.drug.tab || M.drug.name)}">
      ${PARTS.map(([k, l]) => `<button class="btn sm ${part === k ? 'primary' : ''}" data-pkpart="${k}" role="tab" aria-selected="${part === k}">${l}</button>`).join('')}
    </div>
    ${part === 'level' ? renderLevel(M, ctx) : ''}
    ${part === 'cravings' ? renderCravings(M, ctx) : ''}
    ${part === 'schedules' ? renderSchedules(M, ctx) : ''}
  </div>`;
}

// ................................................................ Level ..
function renderLevel(M, ctx) {
  const p = prefs();
  const now = M.now;
  const pct = pctAt(M, M.logged, now);
  const mg = at(M.logged, now, 'amt');
  const rising = pctAt(M, M.logged, now + HOUR) > pct;
  const next = M.last ? later(M.last.t, M.every) : null;
  const late = next != null && next < now;

  // When the level drops under his floor, on the shots logged so far.
  let floorVal = '·', floorDay = '';
  if (M.last) {
    if (pct < p.rangeMin) floorVal = 'Now';
    else {
      let t = now;
      while (t < M.t1 && pctAt(M, M.logged, t) >= p.rangeMin) t += HOUR;
      floorVal = hourName(t);
      floorDay = `, ${dayLc(t)}`;
    }
  }
  // This shot's peak.
  let peak = 0, peakAt = null;
  if (M.last) {
    for (let t = M.last.t; t <= M.last.t + M.every * DAY; t += HOUR) {
      const v = pctAt(M, M.logged, t);
      if (v > peak) { peak = v; peakAt = t; }
    }
  }
  const hl = terminalHalfLife(M.params) / 24;
  const ss = steadyState(M.params, M.ref.mg, M.ref.everyDays);
  const b = M.body;
  const lb = b.wtKg ? Math.round(b.wtKg * 2.2046226218) : null;
  const nextVal = !next ? '·' : late ? 'Due now' : timeName(next);
  const nextDay = next && !late ? `, ${dayLc(next)}` : '';
  // One compact block (his ask): the level as the headline, six small facts
  // beside it, the scale in one line under them.
  const cellsHtml = [
    [`Next shot${nextDay}`, nextVal],
    [`Under ${p.rangeMin}%${floorDay}`, floorVal],
    [`Peak${peakAt ? `, ${dayLc(peakAt)}` : ''}`, peakAt ? `${r0(peak)}%` : '·'],
    // The label prints one half-life for everyone; the model works yours out
    // from your size, so the two are shown together and never look like a
    // disagreement (Fable's idea 7, 2026-09-19).
    ['Half-life, your size', `${hl.toFixed(1)} days`, M.drug.labelHalfLifeDays ? `label says ${M.drug.labelHalfLifeDays}` : ''],
    ['Peak after, model', `${Math.round(ss.peakAtH)} h`],
    ['Absorbed, model', `${Math.round(M.params.F * 100)}%`],
  ].map(([k, v, note]) => `<div class="pk-cell2"><small>${esc(k)}</small><b>${esc(v)}</b>${note ? `<i>${esc(note)}</i>` : ''}</div>`).join('');

  return `
  <section class="ov-sec pk-sum">
    <div class="pk-actions"><button class="btn primary big" data-pk-log>Log shot</button><button class="btn big" data-pk-weight>Log weight</button></div>
    <div class="pk-sumgrid">
      <div class="pk-big"><small>Right now</small><b>${r0(pct)}%</b><span>${M.last ? `${mg.toFixed(2)} mg, ${rising ? 'rising' : 'falling'}` : 'No shot logged yet'}</span></div>
      <div class="pk-cells">${cellsHtml}</div>
    </div>
    <div class="pk-foot">100% is the average on ${mgStr(M.ref.mg)} mg every ${M.ref.everyDays} days, at ${lb ? `${lb} lb` : `a typical ${M.drug.model.refWt || 70} kg`}${b.htCm ? ` and ${b.htCm} cm` : ''}.</div>
  </section>
  <section class="ov-sec pk-cmpsec ${zoomWide('lexpand') ? 'wide' : ''}">
    ${levelChart(M, ctx)}
  </section>
  ${shotNightTile(M)}
  ${shotList(M)}
  ${weightList()}
  ${modelTiles(M)}`;
}

/**
 * What the night of a dose actually does, measured on his own ring nights.
 *
 * It is here because it answers a question the level chart invites and cannot
 * answer. Only shown once there are enough cycles, and it prints what did NOT
 * move as plainly as what did: the interesting result is that his sleep is
 * unchanged. Nothing here is computed from the level, only from the calendar of
 * shots, so it says nothing about dose response.
 */
function shotNightTile(M) {
  if (!ringReady()) return '';
  const eff = shotNightEffect(Object.values(state.data.pk?.shots || {}));
  if (!eff) return '';
  const rows = [
    { k: 'tempDev', lab: 'Body temperature', unit: ' C', nd: 2, word: 'temperature' },
    { k: 'breath', lab: 'Breath rate', unit: '/min', nd: 2, word: 'breathing' },
    { k: 'sleepH', lab: 'Time asleep', unit: ' min', nd: 0, mult: 60, how: 'long' },
    { k: 'sleepScore', lab: 'Sleep score', unit: '', nd: 1, how: 'well' },
  ].map((r) => ({ ...r, v: eff.keys[r.k] })).filter((r) => r.v);
  if (rows.length < 2) return '';
  return `<section class="ov-sec">
    <div class="ov-head"><h2>The Night of a Shot</h2><span class="pk-count">${eff.cycles}</span></div>
    <div class="pk-shotnight">
      ${rows.map((r) => {
        const d = r.v.diff * (r.mult || 1);
        return `<div class="pk-snrow ${r.v.clears ? 'on' : ''}">
          <span class="pk-snlab">${esc(r.lab)}</span>
          <b>${d >= 0 ? '+' : ''}${esc(String(round(d, r.nd)))}${esc(r.unit)}</b>
          <span class="pk-snsub">${r.v.clears ? 'moves' : 'no measurable change'}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="pk-foot">The first night of each cycle against the rest of that cycle, on your own ring nights.
      ${esc(shotSentence(rows.filter((r) => r.v.clears), rows.filter((r) => !r.v.clears)))}</div>
  </section>`;
}

// --------------------------------------------------------- vertical zoom --
// Expand used to be a switch: small, or as tall as the screen with the scale
// fitted. His ask, 2026-09-20: "maybe a slider so i can fine tune and control
// the vertical zoom". On a screen with room for one it is a slider and every
// step between the two ends is reachable; a phone keeps the two position
// button, because a 100px slider is not a fine control.
//
// 0 is exactly the chart as it was: card padding, short, the scale from zero.
// 100 is exactly the old expanded chart. In between the height grows and the
// scale closes in on the line together, so one number means one thing.
const ZOOM_WIDE_AT = 700;
const zoomSlider = () => (typeof innerWidth === 'number' ? innerWidth : 0) >= ZOOM_WIDE_AT;

/**
 * Does the card lose its padding and run wider? Only where the control is the
 * two position button: there the jump IS the press, and on a phone the width
 * it buys is worth having. Where the control is a slider the frame never
 * moves (his report, 2026-09-20: "the slider glitches the width of the panel.
 * make it consistent"), so only the height and the scale follow the slider.
 */
const zoomWide = (key) => !zoomSlider() && zoomOf(key) > 0;

/** The stored zoom, 0 to 100, reading the old true/false setting as 0 or 100. */
function zoomOf(key) {
  const raw = lsGet(key, '0');
  if (raw === '1') return 100;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

/** Interpolate a measure between its zoomed out and zoomed in values. */
const atZoom = (z, from, to) => from + (to - from) * (z / 100);

/** The zoom control for a chart; key is the per device setting. */
function zoomControl(key) {
  const z = zoomOf(key);
  if (!zoomSlider()) {
    const on = z > 0;
    return `<button type="button" class="icon-btn pk-expand" data-pk-expand="${key}" aria-pressed="${on}" aria-label="${on ? 'Shrink the chart' : 'Expand the chart'}">${on
      ? '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>'}</button>`;
  }
  return `<label class="pk-zoom" title="Vertical zoom">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/></svg>
    <input type="range" min="0" max="100" step="5" value="${z}" data-pk-zoom="${key}" aria-label="Vertical zoom">
  </label>`;
}

// --------------------------------------------------------- the time span --
// His ask, 2026-09-20: "can you put a tiny slider under this too for the x
// axis sliding? if you click on 2w 1m etc, it automatically moves the slider
// to the correct position though."
//
// So the span in DAYS is the one thing stored, and the four buttons are four
// places on that slider. Whatever sets it, the window is worked out the same
// way, so the buttons and the slider can never disagree.
//
// Days ahead of now grow with the span the way his four views always did (a
// week on the shortest, three on the longest), and never past the end of the
// model's own run.
const SPAN_MIN = 14;
const spanFwd = (span) => Math.round(Math.min(21, Math.max(7, 7 + (span - SPAN_MIN) * 0.065)));

/** The span in words, for the slider's own label. */
function spanText(span) {
  if (span < 60) return `${span} days shown`;
  const mo = span / 30.44;
  return `${mo < 10 ? +mo.toFixed(1) : Math.round(mo)} months shown`;
}

/** The longest span worth offering: his whole record, plus the days ahead. */
function spanMax(M) {
  return Math.max(SPAN_MIN + 1, Math.round((M.t1 - M.t0) / DAY));
}

/** The four buttons, as spans. */
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
  // Before this build the setting was one of four names; carry it over.
  return presetSpan(M, lsGet('range', '1m'));
}

function levelWindow(M, span) {
  const now = M.now;
  const fwd = spanFwd(span);
  const x1 = Math.min(M.t1, now + fwd * DAY);
  return [Math.max(M.t0 - DAY, x1 - span * DAY), x1];
}

/**
 * The width a chart wins back on a phone by running to the card's own edges.
 * The rule that removes that padding is in styles.css (.pk-cmpsec, PK_BLEED);
 * the two are one change.
 */
const PK_BLEED = 35;
function phoneBleed() {
  try {
    return document.body.classList.contains('mobile') && window.innerWidth <= 560 ? PK_BLEED : 0;
  } catch { return 0; }
}

/** The box a chart label takes up, near enough to keep two off each other. */
function labBox(x, y, text, anchor = 'middle') {
  const w = String(text).length * 7.2 + 6;
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

function levelChart(M, ctx, bodyOnly = false) {
  const p = prefs();
  const span = spanOf(M);
  const sMax = spanMax(M);
  const unit = lsGet('unit', '%');
  const [x0, x1] = levelWindow(M, span);
  // Vertical zoom (his ask, 2026-09-20): 0 is the chart as it was, 100 the old
  // expanded one, and every step between is reachable on a slider.
  const z = zoomOf('lexpand');
  const wide = zoomWide('lexpand');
  const W = Math.max(280, Math.min(1100, Math.round(contentWidth()) + (wide ? 30 : phoneBleed())));
  const tallH = Math.min(720, Math.max(380, (typeof innerHeight === 'number' ? innerHeight : 800) * 0.66));
  const H = Math.round(atZoom(z, W < 520 ? 230 : 280, tallH));
  const pctMode = unit === '%';
  // His weights on the same picture (his ask, second pass): a pound is a point,
  // shifted down by 100, so 295 lb sits where 195 is. The swing shows at full
  // size and the real pounds are written on the line.
  // His weights (his ask, third pass): their own stretched scale, so a few
  // pounds fill the picture instead of hiding in the level's scale. The line
  // also comes in from the left edge when the last weigh in is before the
  // window, so a quiet month still shows the trend arriving.
  const wAll = weightPoints();
  const inWin = wAll.filter((w) => w.t >= x0 && w.t <= x1);
  const beforeW = [...wAll].reverse().find((w) => w.t < x0);
  const afterW = wAll.find((w) => w.t > x1);
  const wDraw = [...(beforeW ? [beforeW] : []), ...inWin, ...(afterW ? [afterW] : [])];
  // His weights belong on the picture in either unit: the line has its own
  // scale and never touches the level's, so switching to mg used to make it
  // vanish for no reason (his report, 2026-09-20).
  const showW = wDraw.length > 0 && lsGet('wline', '0') === '1';
  const wLo = showW ? Math.min(...wDraw.map((w) => w.lb)) : 0;
  const wHi = showW ? Math.max(...wDraw.map((w) => w.lb)) : 0;
  const wPad = Math.max(1.5, (wHi - wLo) * 0.25);
  // The long views carry a second header row for the Steady label.
  const twoRows = span >= 60 && !!M.settledAt;
  // A narrow screen gives the axis only the room its numbers need.
  const m = { l: W < 520 ? 33 : 40, r: pctMode ? 42 : 14, t: twoRows ? 40 : 22, b: 46 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = (t) => m.l + ((t - x0) / (x1 - x0)) * pw;

  const val = (sim, t) => (pctMode ? pctAt(M, sim, t) : at(sim, t, 'amt'));
  const bandAt = (t, lo) => {
    if (!M.band) return null;
    const arr = pctMode ? (lo ? M.band.lo : M.band.hi) : (lo ? M.band.loA : M.band.hiA);
    const v = at({ ...M.band, conc: arr }, t);
    return pctMode ? (v / M.refAvg) * 100 : v;
  };
  const N = Math.max(60, Math.round(pw / 1.5));
  const ts = Array.from({ length: N + 1 }, (_, i) => x0 + ((x1 - x0) * i) / N);
  let top = pctMode ? p.rangeMax : 0, bottom = pctMode ? p.rangeMin : Infinity;
  for (const t of ts) {
    const v = val(M.withNext, t);
    top = Math.max(top, v, bandAt(t, false) || 0);
    bottom = Math.min(bottom, v, bandAt(t, true) ?? v);
  }
  // The scale does NOT move with the zoom (his call, 2026-09-20: "the max
  // should stay at 200 always. the point of the slider is to stretch it").
  // Same zero, same top, same grid lines at every zoom; only the height grows,
  // so the line is stretched upward and a small swing becomes readable.
  const step = niceStep(top * 1.05, 4);
  const yMin = 0;
  const yMax = Math.ceil((top * 1.05) / step) * step || 1;
  const Y = (v) => m.t + ph - ((Math.max(yMin, v) - yMin) / (yMax - yMin)) * ph;

  const past = ts.filter((t) => t <= M.now);
  const fut = ts.filter((t) => t >= M.now);
  if (M.now > x0 && M.now < x1) { past.push(M.now); fut.unshift(M.now); }
  const path = (list) => list.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(val(M.withNext, t)).toFixed(1)}`).join('');
  const bandPath = M.band ? `${ts.map((t, i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(bandAt(t, false)).toFixed(1)}`).join('')}${[...ts].reverse().map((t) => `L${X(t).toFixed(1)},${Y(bandAt(t, true)).toFixed(1)}`).join('')}Z` : '';

  const grid = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    grid.push(`<line class="pk-grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>
      <text class="pk-ylab" x="${m.l - 7}" y="${(Y(v) + 4).toFixed(1)}">${+v.toFixed(2)}</text>`);
  }
  const rangeLines = pctMode ? [p.rangeMin, p.rangeMax].filter((v) => v <= yMax && v >= yMin).map((v) =>
    `<line class="pk-rule" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>
     <text class="pk-rlab" x="${W - m.r + 6}" y="${(Y(v) + 4).toFixed(1)}">${v}%</text>`).join('') : '';

  // Day ticks on midnights.
  const spanD = (x1 - x0) / DAY;
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
    if (x - lastX < 46) continue;
    lastX = x;
    xl.push(`<line class="pk-tick" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 4}"/>
      <text class="pk-xlab" x="${x.toFixed(1)}" y="${H - 6}">${mon(d)} ${d.getDate()}</text>`);
  }

  // Cravings strip, one cell per logged day.
  const feel = pkDoc().feel || {};
  const cells = Object.entries(feel).filter(([, f]) => f && f.c != null).map(([d, f]) => {
    const a = midnight(d), b = midnight(addDays(d, 1));
    if (b <= x0 || a >= x1) return '';
    const xa = Math.max(X(a), m.l), xb = Math.min(X(b), W - m.r);
    return `<rect class="pk-cell c${f.c}" x="${(xa + 0.5).toFixed(1)}" y="${m.t + ph + 8}" width="${Math.max(1, xb - xa - 1).toFixed(1)}" height="8" rx="2"><title>${esc(d)}: ${CRAVE[f.c][1]}</title></rect>`;
  }).join('');

  // Shots on the baseline; the dose is written where it changes.
  // A label that would touch the one before it is left off (the dose is
  // still on the Shots list and in the readout).
  let prevMg = null, lastLabX = -1e9;
  const taken = [];   // label boxes already on the chart, so nothing lands on another
  const marks = [...M.shots, ...M.proj].map((s) => {
    const changed = s.mg !== prevMg;
    prevMg = s.mg;
    if (s.t < x0 || s.t > x1) return '';
    const x = X(s.t);
    const text = `${+s.mg.toFixed(2)}`;
    const room = x - lastLabX > text.length * 7 + 8;
    const lab = changed && !s.proj && room;
    if (lab) { lastLabX = x; taken.push(labBox(x, m.t + ph - 9, text)); }
    return `<circle class="pk-shot ${s.proj ? 'proj' : ''}" cx="${x.toFixed(1)}" cy="${m.t + ph}" r="4.5"/>
      ${lab ? `<text class="pk-shotlab" x="${x.toFixed(1)}" y="${m.t + ph - 9}">${text}</text>` : ''}`;
  }).join('');
  // Days between shots, written on the line between each pair (his ask).
  const all = [...M.shots, ...M.proj];
  const gaps = all.slice(1).map((s, i) => {
    const a = all[i];
    if (a.t < x0 || s.t > x1) return '';
    const xa = X(a.t), xb = X(s.t);
    if (xb - xa < 30) return '';
    return `<text class="pk-gaplab ${s.proj ? 'proj' : ''}" x="${((xa + xb) / 2).toFixed(1)}" y="${(m.t + ph + 3.5).toFixed(1)}">${((s.t - a.t) / DAY).toFixed(1)}</text>`;
  }).join('');
  const setX = M.settledAt && span >= 60 && M.settledAt > M.now && M.settledAt < x1 ? X(M.settledAt) : null;
  // Steady sits on its own row above Now, centred on its dotted line (which
  // runs up to meet it), pulled in at the edges so it is never cut off.
  const setLabel = `Steady on ${mgStr(M.last?.mg || 0)} mg / ${mgStr(M.every)} d`;
  const setHalf = setLabel.length * 3.3;
  const setLabX = setX == null ? 0 : Math.min(W - m.r - setHalf, Math.max(m.l + setHalf, setX));
  const setMark = setX ? `<line class="pk-setline" x1="${setX.toFixed(1)}" x2="${setX.toFixed(1)}" y1="${m.t - 28}" y2="${m.t + ph}"/>
    <text class="pk-setlab" x="${setLabX.toFixed(1)}" y="${m.t - 26}" style="text-anchor:middle">${setLabel}</text>` : '';
  // The weight line: its own colour, its own dots, the real pounds at each end.
  // Weight has its own vertical scale: the drawn span padded a quarter, laid
  // over the middle four fifths of the plot. Nothing of the level's scale moves.
  const wY = (lb) => {
    const lo = wLo - wPad, hi = wHi + wPad;
    const f = hi === lo ? 0.5 : (hi - lb) / (hi - lo);
    return m.t + ph * 0.1 + f * ph * 0.8;
  };
  const wLine = !showW ? '' : (() => {
    const pts = wDraw.map((w) => `${X(w.t).toFixed(1)},${wY(w.lb).toFixed(1)}`);
    const dots = inWin.map((w) => `<circle class="pk-wdot" cx="${X(w.t).toFixed(1)}" cy="${wY(w.lb).toFixed(1)}" r="3.5"><title>${esc(w.iso)}: ${Math.round(w.lb)} lb</title></circle>`).join('');
    // Every weigh in on screen keeps its dot; the number goes on where there is
    // room for it. The first and the latest are placed first and always show,
    // then the rest left to right, above the line or below it, and a number
    // with nowhere to sit is left to the dot's own title (his report,
    // 2026-09-19: they piled on top of each other and on the doses).
    const out = new Array(inWin.length).fill('');
    const order = inWin.length ? [0, ...(inWin.length > 1 ? [inWin.length - 1] : []),
      ...inWin.map((_, i) => i).filter((i) => i !== 0 && i !== inWin.length - 1)] : [];
    for (const i of order) {
      const w = inWin[i];
      const x = X(w.t);
      const must = i === 0 || i === inWin.length - 1;
      const anchor = i === inWin.length - 1 && x > W - m.r - 40 ? 'end' : i === 0 && x < m.l + 40 ? 'start' : 'middle';
      const dx = anchor === 'end' ? -6 : anchor === 'start' ? 6 : 0;
      const text = String(Math.round(w.lb));
      let y = null;
      for (const cand of [wY(w.lb) - 9, wY(w.lb) + 16]) {
        const b = labBox(x + dx, cand, text, anchor);
        if (b.y0 > m.t - 2 && b.y1 < m.t + ph - 14 && !hitsAny(b, taken)) { y = cand; break; }
      }
      if (y == null) { if (!must) continue; y = wY(w.lb) - 9; }
      taken.push(labBox(x + dx, y, text, anchor));
      out[i] = `<text class="pk-wlab" x="${(x + dx).toFixed(1)}" y="${y.toFixed(1)}" style="text-anchor:${anchor}">${text}</text>`;
    }
    const labs = out.join('');
    return `<g clip-path="url(#pkclip)"><path class="pk-wpath" d="M${pts.join('L')}"/>${dots}</g>${labs}`;
  })();
  const nowX = X(M.now);
  const nowMark = M.now > x0 && M.now < x1 ? `<line class="pk-nowline" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${m.t - 4}" y2="${m.t + ph}"/>
    <text class="pk-nowlab" x="${nowX.toFixed(1)}" y="${m.t - 8}">Now</text>` : '';

  chartState = { M, x0, x1, X, Y, m, W, H, ph, pctMode, val, bandAt };
  const head = `
    <div class="pk-chead">
      <div class="pk-cspan">
        <div class="seg pk-crange" role="group" aria-label="Range">${RANGES.map(([k, l]) => {
          const on = presetSpan(M, k) === span;
          return `<button class="${on ? 'on' : ''}" data-pk-range="${k}" aria-pressed="${on}">${l}</button>`;
        }).join('')}</div>
        <input type="range" class="pk-spanslider" min="${SPAN_MIN}" max="${sMax}" step="1" value="${span}"
          data-pk-span aria-label="Days shown" title="${spanText(span)}">
      </div>
      <div class="pk-cright"><div class="seg" role="group" aria-label="Unit"><button class="${pctMode ? 'on' : ''}" data-pk-unit="%" aria-pressed="${pctMode}">%</button><button class="${!pctMode ? 'on' : ''}" data-pk-unit="mg" aria-pressed="${!pctMode}">mg</button></div>
      ${wDraw.length ? `<button type="button" class="pk-wbtn ${showW ? 'on' : ''}" data-pk-wline aria-pressed="${showW}">Weight</button>` : ''}
      ${zoomControl('lexpand')}</div>
    </div>`;
  const body = `
    <div class="pk-plot" tabindex="0" role="group" aria-label="Level over time. Arrow keys move the cursor.">
      <svg class="pk-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
        <defs><clipPath id="pkclip"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath></defs>
        ${grid.join('')}${rangeLines}
        ${bandPath ? `<path class="pk-band" d="${bandPath}"/>` : ''}
        <path class="pk-line" d="${path(past)}"/>
        <path class="pk-line proj" d="${path(fut)}"/>
        ${wLine}${nowMark}${setMark}${gaps}${marks}${cells}${xl.join('')}
        <g class="pk-guide" style="opacity:0"><line x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/><circle r="5" cx="0" cy="0"/></g>
        <rect class="pk-hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph + 20}"/>
      </svg>
    </div>
    <div class="pk-readout" aria-live="polite" data-pk-readout>${readout(M.now)}</div>
    ${span >= 60 && M.last && M.settledAt ? `<div class="pk-settle">${M.settledAt > M.now + M.every * DAY
      ? `At ${mgStr(M.last.mg)} mg every ${M.every} days you are steady by <b>${dayName(M.settledAt)}</b>`
      : `At ${mgStr(M.last.mg)} mg every ${M.every} days you are already steady`}</div>` : ''}
    <div class="pk-legend">
      <span><i class="k-line"></i>You</span>
      ${M.band ? '<span><i class="k-band"></i>90% of people</span>' : ''}
      <span><i class="k-proj"></i>Next shots, if on time</span>
      <span><i class="k-shot"></i>Shot</span>
      ${showW ? `<span><i class="k-weight"></i>Weight, own scale, ${Math.round(wLo)} to ${Math.round(wHi)} lb</span>` : ''}
      ${cells ? '<span><i class="k-cell"></i>Cravings</span>' : ''}
    </div>`;
  return bodyOnly ? body : `${head}<div class="pk-cbody" data-pk-body="level">${body}</div>`;
}
let chartState = null;

function readout(t) {
  const c = chartState;
  if (!c) return '';
  const M = c.M;
  const sim = M.withNext;
  const pct = pctAt(M, sim, t);
  const mg = at(sim, t, 'amt');
  const ng = at(sim, t) * 1000;
  const lo = c.bandAt(t, true), hi = c.bandAt(t, false);
  const when = Math.abs(t - M.now) < 30 * 60e3 ? 'Now' : `${dayName(t)}, ${hourName(t)}${t > M.now ? ' (ahead)' : ''}`;
  const spread = lo != null ? `<span class="pk-ro-mute">90% of people ${c.pctMode ? `${r0(lo)} to ${r0(hi)}%` : `${lo.toFixed(1)} to ${hi.toFixed(1)} mg`}</span>` : '';
  return `<b>${esc(when)}</b><span class="pk-ro-big">${r0(pct)}%</span><span>${mg.toFixed(2)} mg</span><span>${r0(ng)} ng/mL</span>${spread}`;
}

function shotList(M) {
  const shots = [...M.shots].reverse();
  const removed = shotsOf(M.drug.id, { removed: true });
  if (!shots.length && !removed.length) return '';
  const rows = shots.map((s, i) => {
    const prev = shots[i + 1];
    const gap = prev ? (s.t - prev.t) / DAY : null;
    const d = new Date(s.t);
    return `<button class="pk-shotrow" data-pk-shot="${esc(s.id)}">
      <span class="sc-cal"><b>${d.getDate()}</b><small>${mon(d)}</small></span>
      <span class="pk-sr-main"><b>${mgStr(s.mg)} mg</b><small>${esc(d.toLocaleDateString('en-GB', { weekday: 'long' }))}${s.timeKnown === false ? '' : `, ${timeName(s.t)}`}${s.site ? ` · ${esc(SITE_NAME[s.site] || s.site)}` : ''}</small></span>
      ${gap != null ? `<span class="pill">${gap.toFixed(1)} d</span>` : '<span class="pill">First</span>'}
    </button>`;
  }).join('');
  // His ask, 2026-09-20: "this log can collapse". Shut by default and the
  // choice remembered on this device; the newest entry is named on the shut
  // line so the section still says something useful closed.
  const open = lsGet('logopen', '0') === '1';
  const newest = shots[0];   // reversed above: newest first
  return `<section class="ov-sec">
    <details class="pk-log" data-key="pklog" data-pk-logfold ${open ? 'open' : ''}>
      <summary class="ov-head pk-logsum">
        <h2>Log</h2>
        <span class="pk-count pk-logopen">${shots.length}</span>
        <span class="pk-logshut">${shots.length} logged${newest ? ` · last ${dayName(newest.t)}` : ''}</span>
        <svg class="pk-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </summary>
    <div class="pk-shots">${rows}</div>
    ${removed.length ? `<details class="pk-removed"><summary>Removed (${removed.length})</summary>
      ${removed.map((s) => `<div class="pk-rrow"><span>${dayName(s.t)} · ${mgStr(s.mg)} mg</span><button class="btn sm" data-pk-restore="${esc(s.id)}">Restore</button></div>`).join('')}</details>` : ''}
    </details>
  </section>`;
}

/**
 * His weights, as their own log under the shot log (his ask, 2026-09-21: "add
 * a weight log under this log as well so i can edit the log if need be.
 * separate from the Injection Log"). Tapping a row opens the same Log weight
 * sheet on that date, so one place edits them and the one-a-day rule holds.
 * Clinic weights are shown and named but never edited here.
 */
function weightList() {
  const rows = allMeasurements()
    .filter((m) => m.measure === 'bodyweight' && typeof m.value === 'number')
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (!rows.length) return '';
  const unit = state.data.settings.weightUnit || 'kg';
  const mine = new Set((state.data.measurements || []).map((m) => m.id));
  const open = lsGet('wlogopen', '0') === '1';
  const newest = rows[0];
  const show = (m) => {
    const v = m.unit === unit ? m.value : toKg(m.value, m.unit || state.data.settings.weightUnit || 'kg') * (unit === 'lb' ? 2.2046226218 : 1);
    return Math.round(v * 10) / 10;
  };
  const list = rows.map((m, i) => {
    const prev = rows[i + 1];
    const d = midnight(m.date);
    const dt = new Date(d);
    const own = mine.has(m.id);
    const delta = prev ? show(m) - show(prev) : null;
    return `<button class="pk-shotrow" data-pk-weight-edit="${esc(m.date)}" ${own ? '' : 'disabled'}>
      <span class="sc-cal"><b>${dt.getDate()}</b><small>${mon(dt)}</small></span>
      <span class="pk-sr-main"><b>${show(m)} ${esc(unit)}</b><small>${esc(dt.toLocaleDateString('en-GB', { weekday: 'long' }))}${own ? '' : ` · ${esc((m.src || 'clinic').split(',')[0])}`}</small></span>
      ${delta == null ? '' : `<span class="pill">${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10}</span>`}
    </button>`;
  }).join('');
  return `<section class="ov-sec">
    <details class="pk-log" data-key="pkwlog" data-pk-wlogfold ${open ? 'open' : ''}>
      <summary class="ov-head pk-logsum">
        <h2>Weight log</h2>
        <span class="pk-count pk-logopen">${rows.length}</span>
        <span class="pk-logshut">${rows.length} logged · last ${esc(String(show(newest)))} ${esc(unit)}, ${dayName(midnight(newest.date))}</span>
        <svg class="pk-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </summary>
      <div class="pk-shots">${list}</div>
      <div class="pk-legall"><button type="button" class="btn sm" data-pk-weight>Log a weight</button></div>
    </details>
  </section>`;
}

function modelTiles(M) {
  const d = M.drug;
  // His call: reference material, folded on iPad and Mac, not on the phone.
  return `<details class="pk-about"><summary><span>The Model and Sources</span><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><section class="pm-sec">
    <div class="sc-notes pk-notes">
      <div class="sc-note"><b>How It Works</b><span>${esc(d.modelNote || 'Two compartment model, first order absorption, typical values scaled to your size.')}</span></div>
      <div class="sc-note"><b>Not a Blood Test</b><span>Your own curve can sit anywhere in the shaded band.</span></div>
      ${(d.sources || []).map((s) => `<div class="sc-note"><b>${esc(s.short || 'Source')}</b><span>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>` : esc(s.label)}</span></div>`).join('')}
    </div>
  </section></details>`;
}

// ............................................................. Cravings ..
function renderCravings(M, ctx) {
  const today = todayIso();
  const end = ctx.pkWeekEnd || today;
  const sel = ctx.pkDay || today;
  const feel = pkDoc().feel || {};
  const days = Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const f = feel[sel] || {};
  const lvl = dayLevel(M, sel);
  const cd = cycleDay(M, sel);
  const strip = days.map((d) => {
    const v = feel[d]?.c;
    const L = dayLevel(M, d);
    const dt = fromIso(d);
    return `<button class="pk-day ${d === sel ? 'on' : ''} ${v != null ? `c${v}` : ''} " data-pk-day="${d}" aria-pressed="${d === sel}">
      <small>${dt.toLocaleDateString('en-GB', { weekday: 'short' })}</small><b>${dt.getDate()}</b>
      <i class="pk-dot"></i><em>${L != null ? `${r0(L)}%` : ''}</em></button>`;
  }).join('');
  return `
  <section class="ov-sec">
    <div class="ov-head"><h2>Cravings</h2>
      <div class="pk-weeknav">
        <button class="icon-btn" data-pk-week="-7" aria-label="Earlier week"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
        ${end < today ? '<button class="icon-btn" data-pk-week="7" aria-label="Later week"><svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg></button>' : ''}
      </div></div>
    <div class="pk-week">${strip}</div>
    <div class="pk-daycard" data-pk-dayiso="${sel}">
      <div class="pk-dayhead"><b>${dayName(midnight(sel))}</b>
        <span class="pk-daychips">${cd != null ? `<span class="pill">${cd === 0 ? 'Shot day' : `Day ${cd} after shot`}</span>` : ''}${lvl != null ? `<span class="pill">Level ${r0(lvl)}%</span>` : ''}</span></div>
      <div class="pk-crave" role="group" aria-label="Cravings on ${esc(sel)}">
        ${CRAVE.map(([v, l]) => `<button class="pk-cbtn c${v} ${f.c === v ? 'on' : ''}" data-pk-crave="${v}" aria-pressed="${f.c === v}"><span>${l}</span></button>`).join('')}
      </div>
      <div class="pk-when" role="group" aria-label="When the craving hit">
        <small>When the craving hit</small>
        ${WHEN.map(([k, l]) => { const on = (f.when || []).includes(k); return `<button class="pk-chip ${on ? 'on' : ''}" data-pk-when="${k}" aria-pressed="${on}">${l}</button>`; }).join('')}
      </div>
      <div class="pk-tags" role="group" aria-label="What happened">
        ${TAGS.map(([k, l]) => { const n = (f.tags || {})[k] || 0; return `<span class="pk-tag ${n ? 'on' : ''}"><button class="pk-chip ${n ? 'on' : ''}" data-pk-tag="${k}" aria-label="${l}${n ? `, ${n}` : ''}, add one">${l}${n > 1 ? `<b>${n}</b>` : ''}</button>${n ? `<button class="pk-less" data-pk-untag="${k}" aria-label="One less ${l}">\u2212</button>` : ''}</span>`; }).join('')}
      </div>
      <textarea class="pk-note" data-pk-note rows="3" placeholder="What happened, and when" maxlength="4000" aria-label="Note for this day">${esc(f.note || '')}</textarea>
    </div>
  </section>
  ${patterns(M)}`;
}

function patterns(M) {
  const p = prefs();
  const feel = pkDoc().feel || {};
  const rows = Object.entries(feel).filter(([, f]) => f && f.c != null)
    .map(([d, f]) => ({ d, c: f.c, level: dayLevel(M, d), cd: cycleDay(M, d) }))
    .filter((r) => r.level != null);
  if (!rows.length) {
    return `<section class="pm-sec"><h2 class="ov-h">Patterns</h2>
      <div class="sc-notes pk-one"><div class="sc-note"><b>Log a Few Days</b><span>Patterns against your level appear here.</span></div></div></section>`;
  }
  const yes = rows.filter((r) => r.c > 0);
  const no = rows.filter((r) => r.c === 0);
  const avg = (a) => (a.length ? a.reduce((s, r) => s + r.level, 0) / a.length : null);
  const under = rows.filter((r) => r.level < p.rangeMin), over = rows.filter((r) => r.level >= p.rangeMin);
  const rate = (a) => (a.length ? `${a.filter((r) => r.c > 0).length} of ${a.length}` : '·');
  const cut = bestCut(rows.map((r) => ({ level: r.level, craving: r.c > 0 })));

  // By day after the shot.
  const cols = Array.from({ length: 8 }, (_, i) => ({ i, all: 0, some: 0, strong: 0 }));
  for (const r of rows) {
    if (r.cd == null) continue;
    const c = cols[Math.min(7, r.cd)];
    // The bar splits the five steps in two: the lighter half and the heavier.
    c.all++; if (r.c > 0 && r.c <= CRAVE_TOP / 2) c.some++; if (r.c > CRAVE_TOP / 2) c.strong++;
  }
  const showCols = cols.filter((c, i) => i < 7 || c.all);
  const bars = showCols.map((c) => {
    const s = c.all ? (c.strong / c.all) * 100 : 0, o = c.all ? (c.some / c.all) * 100 : 0;
    return `<div class="pk-col"><div class="pk-colbar">${c.all ? `<i class="c2" style="height:${s}%"></i><i class="c1" style="height:${o}%"></i>` : ''}</div>
      <b>${c.all ? `${c.some + c.strong}/${c.all}` : '·'}</b><small>${c.i === 0 ? 'Shot' : c.i === 7 ? '7+' : `Day ${c.i}`}</small></div>`;
  }).join('');

  return `<section class="pm-sec">
    <h2 class="ov-h">Patterns</h2>
    <div class="sc-tiles n4">
      <div class="sc-tile"><small>Days logged</small><b>${rows.length}</b><span>${yes.length} with cravings</span></div>
      <div class="sc-tile"><small>Under ${p.rangeMin}%</small><b>${rate(under)}</b><span>Days with cravings</span></div>
      <div class="sc-tile"><small>At ${p.rangeMin}% or more</small><b>${rate(over)}</b><span>Days with cravings</span></div>
      <div class="sc-tile"><small>Cravings start under</small><b>${cut ? `${r0(cut.cut)}%` : '·'}</b><span>${cut ? `Right on ${cut.right} of ${cut.total} days` : 'Needs 6 days, both kinds'}</span></div>
    </div>
    <div class="sc-tiles">
      <div class="sc-tile"><small>Average level, craving days</small><b>${avg(yes) != null ? `${r0(avg(yes))}%` : '·'}</b></div>
      <div class="sc-tile"><small>Average level, clear days</small><b>${avg(no) != null ? `${r0(avg(no))}%` : '·'}</b></div>
    </div>
    <div class="ov-sec pk-cols-sec"><div class="ov-head"><h2>By Day After a Shot</h2><span class="ov-sub">Share of days with cravings</span></div>
      <div class="pk-cols">${bars}</div>
      <div class="pk-legend"><span><i class="k-c1"></i>${esc(CRAVE[1][1])} or ${esc(CRAVE[2][1].toLowerCase())}</span><span><i class="k-c2"></i>${esc(CRAVE[3][1])} or ${esc(CRAVE[4][1].toLowerCase())}</span></div></div>
    <div class="ov-sec"><div class="ov-head"><h2>By Level</h2><span class="ov-sub">Each dot is a day, placed at its average level</span></div>
      ${dotStrip(rows, cut, p)}</div>
  </section>`;
}

function dotStrip(rows, cut, p) {
  const W = Math.max(280, Math.min(1000, Math.round(contentWidth()) - 20));
  const m = { l: 62, r: 14, t: 10, b: 26 };
  const H = m.t + CRAVE.length * 26 + m.b;
  const vals = rows.map((r) => r.level);
  const lo = Math.max(0, Math.floor(Math.min(...vals, p.rangeMin) / 25) * 25 - 5);
  const hi = Math.ceil(Math.max(...vals, p.rangeMin) / 25) * 25 + 5;
  const X = (v) => m.l + ((v - lo) / (hi - lo)) * (W - m.l - m.r);
  const rowY = (c) => m.t + (CRAVE_TOP - c) * 26 + 13;
  const ticks = [];
  for (let v = Math.ceil(lo / 25) * 25; v <= hi; v += 25) ticks.push(`<line class="pk-grid" x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="${m.t}" y2="${H - m.b}"/><text class="pk-xlab" x="${X(v).toFixed(1)}" y="${H - 8}">${v}%</text>`);
  const labs = CRAVE.map(([c, l]) => `<text class="pk-ylab" x="${m.l - 10}" y="${rowY(c) + 4}">${l}</text>`).join('');
  const seen = {};
  const dots = rows.map((r) => {
    const k = `${r.c}:${Math.round(r.level / 3)}`;
    const j = (seen[k] = (seen[k] || 0) + 1) - 1;
    const dy = j === 0 ? 0 : (j % 2 ? -1 : 1) * Math.ceil(j / 2) * 6;
    return `<circle class="pk-ddot c${r.c}" cx="${X(r.level).toFixed(1)}" cy="${(rowY(r.c) + dy).toFixed(1)}" r="5"><title>${esc(r.d)}: ${r0(r.level)}%</title></circle>`;
  }).join('');
  const floor = `<line class="pk-rule" x1="${X(p.rangeMin).toFixed(1)}" x2="${X(p.rangeMin).toFixed(1)}" y1="${m.t}" y2="${H - m.b}"/>`;
  const cutLine = cut ? `<line class="pk-cut" x1="${X(cut.cut).toFixed(1)}" x2="${X(cut.cut).toFixed(1)}" y1="${m.t}" y2="${H - m.b}"/>` : '';
  return `<svg class="pk-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Days by level and cravings">${ticks.join('')}${floor}${cutLine}${labs}${dots}</svg>`;
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

  const bestCard = best ? `
    <div class="pk-best" style="--c:var(--s${colors[best.pl.id]})">
      <small>Best value in your range${penPick !== 'best' && best.best ? `, ${esc(best.best.pen.name)}` : ''}</small>
      <b>${planName(best.pl)}</b>
      <div class="pk-best-facts">
        <span><b>$${Math.round(best.best.pm.cost30Real)}</b> a month</span>
        <span><b>${r0(best.low)} to ${r0(best.high)}%</b> low to high</span>
        <span><b>${esc(best.best.pen.name)}</b>, lasts ${+best.best.pm.realSupplyDays.toFixed(1)} days${best.best.pm.clicks != null ? `, ${esc(clickText(best.best.pm))}` : ''}</span>
        <span><b>${esc(soldText(best.best.pm))}</b> against as sold</span>
        <span><b>${wasteText(best.best)}</b> thrown out</span>
      </div>
    </div>` : `
    <div class="pk-best none"><small>Best value in your range</small><b>${penList.length ? `None of these stay between ${p.rangeMin}% and ${p.rangeMax}%` : 'Add a pen to compare costs'}</b>
      <div class="pk-best-facts"><span>${penList.length ? 'Add a schedule below, or change your range' : 'Pens and prices live with your data'}</span></div></div>`;

  const cards = facts.map((f) => {
    const c = colors[f.pl.id];
    const on = sel.has(f.pl.id);
    const scaleMax = Math.max(p.rangeMax * 1.15, ...facts.map((x) => x.high)) ;
    const pos = (v) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100)).toFixed(2)}%`;
    return `<div class="pk-plan ${on ? 'on' : ''} ${f.inRange ? 'ok' : 'out'} ${best && best.pl.id === f.pl.id ? 'best' : ''}" style="--c:var(--s${c})">
      <button type="button" class="pk-ptop" data-pk-toggle="${esc(f.pl.id)}" aria-pressed="${on}">
        <span class="pk-pbox" aria-hidden="true"></span>
        <span class="pk-ptitle"><b>${planName(f.pl)}</b><small>${esc(statusText(f, p))}${best && best.pl.id === f.pl.id ? ' · best value' : ''}${onLabel(M, f.pl) ? ' · label dose' : ''}</small>${f.settle ? `<small class="pk-settle">${esc(settleText(f.settle))}</small>` : ''}${f.best && f.best.pm.clicks != null ? `<small class="pk-clicks">${esc(clickText(f.best.pm))} on the ${esc(f.best.pen.name)}</small>` : ''}</span>
      </button>
      <div class="pk-pbar" aria-hidden="true">
        <i class="zone" style="left:${pos(p.rangeMin)};width:calc(${pos(p.rangeMax)} - ${pos(p.rangeMin)})"></i>
        <i class="span" style="left:${pos(f.low)};width:calc(${pos(f.high)} - ${pos(f.low)})"></i>
      </div>
      <div class="pk-pfacts">
        <span><b>${r0(f.low)} to ${r0(f.high)}%</b><small>Low to high</small></span>
        <span><b>${f.best ? `$${Math.round(f.best.pm.cost30Real)}` : '·'}</b><small>${f.best ? `A month, ${esc(f.best.pen.name)}` : penList.length ? 'Dose bigger than a pen' : 'Add a pen'}</small></span>
        <span><b>${f.best ? `${+f.best.pm.realSupplyDays.toFixed(1)} d` : '·'}</b><small>${f.best ? `A pen lasts, ${esc(soldText(f.best.pm).replace(/^\S/, (x) => x.toLowerCase()))}` : 'A pen lasts'}</small></span>
        <span><b>${f.best ? wasteText(f.best) : '·'}</b><small>${f.best && f.best.pm.left > 0.005 ? (f.best.pm.waste === 'window' ? `Thrown out on day ${p.windowDays + 1}` : 'Thrown out, under one dose') : 'Thrown out'}</small></span>
      </div>
      <button type="button" class="pk-phide" data-pk-hide="${esc(f.pl.id)}" aria-label="Hide ${esc(planName(f.pl))}">Hide</button>
    </div>`;
  }).join('');

  const penSeg = penList.length > 1 ? `<div class="pk-pensw"><span>Pen</span><div class="seg" role="group" aria-label="Which pen">
      <button class="${penPick === 'best' ? 'on' : ''}" data-pk-spen="best" aria-pressed="${penPick === 'best'}">Cheapest</button>
      ${penList.map((x) => `<button class="${penPick === x.id ? 'on' : ''}" data-pk-spen="${esc(x.id)}" aria-pressed="${penPick === x.id}">${esc(x.name)}</button>`).join('')}</div></div>` : '';
  return `
  <p class="pk-foot pk-scaletop">Every percent here is against one schedule: 100% is the average on ${mgStr(M.ref.mg)} mg every ${M.ref.everyDays} days, at your size.</p>
  ${penSeg}
  <section class="ov-sec pk-whatif">
    ${bestCard}
  </section>
  <section class="ov-sec pk-cmpsec ${zoomWide('sexpand') ? 'wide' : ''}">
    <div class="ov-head"><h2>Compare</h2><span class="ov-sub">${mode === 'settled' ? 'Each schedule once it is steady' : 'Your real level now, switching at your next shot'}</span></div>
    <div class="pk-chead">
      <div class="seg" role="group" aria-label="View"><button class="${mode === 'settled' ? 'on' : ''}" data-pk-smode="settled" aria-pressed="${mode === 'settled'}">Once settled</button><button class="${mode === 'today' ? 'on' : ''}" data-pk-smode="today" aria-pressed="${mode === 'today'}">From today</button></div>
      <div class="pk-cright"><div class="seg" role="group" aria-label="Weeks">${WEEKS.map((w) => `<button class="${weeks === w ? 'on' : ''}" data-pk-sweeks="${w}" aria-pressed="${weeks === w}">${w}W</button>`).join('')}</div>
      ${zoomControl('sexpand')}</div>
    </div>
    <div class="pk-cbody" data-pk-body="compare">${compareChart(M, facts.filter((f) => sel.has(f.pl.id)), colors, p, mode, weeks)}</div>
    <div class="pk-legchips" role="group" aria-label="Schedules on the chart">
      ${mode === 'today' && M.last && switchLine(M, list, p) ? `<button type="button" class="pk-lchip pk-swchip ${lsGet('swline', '1') === '1' ? 'on' : ''}" style="--c:var(--ink)" data-pk-swline aria-pressed="${lsGet('swline', '1') === '1'}"><i></i>Your switch</button>` : ''}
      ${facts.map((f) => `<button type="button" class="pk-lchip ${sel.has(f.pl.id) ? 'on' : ''}" style="--c:var(--s${colors[f.pl.id]})" data-pk-toggle="${esc(f.pl.id)}" aria-pressed="${sel.has(f.pl.id)}"><i></i>${esc(planShort(f.pl))}</button>`).join('')}
    </div>
    <div class="pk-legall"><button type="button" class="btn sm" data-pk-all="1">Show all</button><button type="button" class="btn sm" data-pk-all="0">Clear</button></div>
  </section>
  ${switchPlanner(M, list, penList, p)}
  <section class="pm-sec">
    <div class="pk-sorthead"><h2 class="ov-h">Your Schedules</h2>
      <div class="seg" role="group" aria-label="Sort">${[['order', 'My order'], ['price', 'Price'], ['potency', 'Potency']].map(([k, l]) =>
        `<button class="${sort === k ? 'on' : ''}" data-pk-sort="${k}" aria-pressed="${sort === k}">${l}</button>`).join('')}</div></div>
    <p class="pk-hint"><i class="zone"></i>Your range, ${p.rangeMin} to ${p.rangeMax}% <i class="span"></i>Where each schedule moves between shots</p>
    <div class="pk-plans">${cards}</div>
    <form class="pk-add" data-pk-add>
      <span class="pk-addlab">Try another</span>
      <label><input class="in-num" type="number" inputmode="decimal" step="any" min="0.05" name="mg" placeholder="mg" aria-label="Dose in mg" required></label>
      <span>mg every</span>
      <label><input class="in-num" type="number" inputmode="decimal" step="any" min="0.5" name="every" placeholder="days" aria-label="Every how many days" required></label>
      <span>days</span>
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${hiddenPlans()}
  </section>
  <section class="ov-sec">
    <div class="ov-head"><h2>Your Range and Pens</h2><span class="ov-sub">Change these as your tolerance grows; everything above follows</span></div>
    <div class="sc-tiles n6 pk-set">
      <label class="sc-tile"><small>Lowest you want</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="decimal" data-pk-pref="rangeMin" value="${p.rangeMin}" min="0" max="400"><b>%</b></span></label>
      <label class="sc-tile"><small>Highest you want</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="decimal" data-pk-pref="rangeMax" value="${p.rangeMax}" min="0" max="400"><b>%</b></span></label>
      <label class="sc-tile"><small>Your shot, every</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="decimal" step="0.5" data-pk-pref="everyDays" value="${p.everyDays}" min="1" max="28"><b>days</b></span></label>
      <label class="sc-tile"><small>Pen use by</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="numeric" data-pk-pref="windowDays" value="${p.windowDays}" min="1" max="90"><b>days</b></span></label>
      <label class="sc-tile"><small>Priming, every shot</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="numeric" data-pk-pref="primeClicks" value="${p.primeClicks}" min="0" max="20"><b>clicks</b></span></label>
      <label class="sc-tile"><small>Pen's extra fill covers</small><span class="pk-inrow"><input class="in-num" type="number" inputmode="numeric" data-pk-pref="freePrimes" value="${p.freePrimes}" min="0" max="12"><b>primes</b></span></label>
    </div>
    ${rangeFromLog(M, p)}
    ${penList.length ? `<div class="pk-pens">${penList.map((x) => `<div class="pk-pen"><b>${esc(x.name)}</b><small>${mgStr(x.mg)} mg for ${money(x.price)}, ${money(x.price / x.mg)} a mg${x.clicks ? `, ${x.clicks} clicks a full dose (your count)` : ''}</small></div>`).join('')}</div>` : ''}
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
/** His planned switch as one timeline (his ask 2026-09-25: "the plan a switch
 *  as a single timeline on this chart"). Null when there is nothing to plan. */
function switchLine(M, list, p) {
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
  const r = planSwitch(M, target, penIso, weekday);
  const curPen = penList.find((x) => x.id === p.penId) || null;
  const tgtPen = planFacts(M, target, p, penList, 'best').best?.pen || curPen;
  const clicks = (mg, every, pen) => {
    if (!pen) return '';
    const pm = penMath(mg, every, pen, p.windowDays, primeFor(pen, p));
    return pm.clicks == null ? '' : clickText(pm);
  };
  const row = (t, mg, pen, every, note = '') => `<div class="pk-swrow"><b>${esc(dayName(t))}</b><span>${mgStr(mg)} mg${pen ? `, ${esc(pen.name)}` : ''}</span><small>${esc(clicks(mg, every, pen))}${note ? `${clicks(mg, every, pen) ? '. ' : ''}${esc(note)}` : ''}</small></div>`;
  let out;
  if (!r || !r.land) out = '<p class="pk-foot">No day fits: pick another weekday or pen date.</p>';
  else {
    const soft = r.first < r.target.mg;
    out = `<div class="pk-swlist">
      ${r.cur.map((x) => row(x.t, x.mg, curPen, M.every)).join('')}
      ${row(r.land, r.first, tgtPen, r.target.everyDays, soft ? `A smaller first shot: at ${mgStr(r.target.mg)} mg you would reach ${r0(r.fullPeak)}%` : 'First on the new schedule')}
      <div class="pk-swrow then"><b>Then every ${mgStr(r.target.everyDays)} days</b><span>${mgStr(r.target.mg)} mg${tgtPen ? `, ${esc(tgtPen.name)}` : ''}</span><small>${esc(clicks(r.target.mg, r.target.everyDays, tgtPen))}</small></div>
    </div>
    <div class="sc-tiles n3 pk-swfacts">
      <div class="sc-tile"><small>Highest on the way</small><b>${r0(r.peak)}%</b><span>${r.peak <= r.settledPeak * 1.01 ? 'Never above where it settles' : `Settles at ${r0(r.settledPeak)}%`}</span></div>
      <div class="sc-tile"><small>Settled high</small><b>${r0(r.settledPeak)}%</b><span>After the first few weeks</span></div>
      <div class="sc-tile"><small>Settled low</small><b>${r0(r.settledLow)}%</b><span>Just before each shot</span></div>
    </div>`;
  }
  return `<section class="ov-sec pk-switch">
    <div class="ov-head"><h2>Plan a Switch</h2><span class="ov-sub">From ${mgStr(M.last.mg)} mg every ${mgStr(M.every)} days</span></div>
    <div class="pk-swset">
      <label class="sc-tile"><small>Switch to</small><select data-pk-swto>${opts.map((pl) => `<option value="${esc(pl.id)}" ${pl.id === toId ? 'selected' : ''}>${esc(planName(pl))}</option>`).join('')}</select></label>
      <label class="sc-tile"><small>New pen from</small><input type="date" data-pk-swpen value="${penIso}" min="${todayIso()}"></label>
      <label class="sc-tile"><small>Shot day</small><select data-pk-swday><option value="" ${weekday == null ? 'selected' : ''}>Any day</option>${WDAYS.map((w, i) => `<option value="${i}" ${weekday === i ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
    </div>
    ${out}
  </section>`;
}

// ....................................................... Range from log ..
// The low his own log points to: the cut between the days a craving got the
// better of him (Strong or worse, or Stuck) and the calm days, by each day's
// lowest waking level. Offered, never applied without his tap.
function rangeFromLog(M, p) {
  const rows = feelLows(M);
  const hard = rows.filter((r) => r.hard).length, calm = rows.filter((r) => r.calm).length;
  const cut = bestCut(rows.map((r) => ({ level: r.low, craving: r.hard })));
  const hi = highestSoFar(M);
  const need = [];
  if (hard < 2) need.push(`${2 - hard} more strong or stuck day${2 - hard === 1 ? '' : 's'}`);
  if (calm < 2) need.push(`${2 - calm} more calm day${2 - calm === 1 ? '' : 's'}`);
  if (rows.length < 6 && !need.length) need.push(`${6 - rows.length} more logged day${6 - rows.length === 1 ? '' : 's'}`);
  const low = cut ? Math.round(cut.cut) : null;
  return `<div class="sc-tiles pk-fromlog">
    <div class="sc-tile"><small>Your log suggests a low of</small><b>${low != null ? `${low}%` : '·'}</b><span>${low != null ? `Right on ${cut.right} of ${cut.total} days` : `Needs ${need.join(' and ') || 'more days'}`}</span>${low != null && low !== p.rangeMin ? `<button class="btn sm" data-pk-uselow="${low}">Use ${low}%</button>` : ''}</div>
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

function hiddenPlans() {
  const h = Object.entries(pkDoc().plans || {}).filter(([, x]) => x && x.hidden);
  if (!h.length) return '';
  return `<details class="pk-removed"><summary>Hidden (${h.length})</summary>
    ${h.map(([id, x]) => `<div class="pk-rrow"><span>${esc(planName(x))}</span><button class="btn sm" data-pk-unhide="${esc(id)}">Show</button></div>`).join('')}</details>`;
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

let compareState = null;
let compareArgs = null;
function compareChart(M, chosen, colors, p, mode, weeks) {
  compareArgs = { M, chosen, colors, p, mode, weeks };
  const swr = mode === 'today' && lsGet('swline', '1') === '1' ? switchLine(M, plans(), p) : null;
  // Same vertical zoom as the level chart. This one is always fitted, so the
  // zoom is height and how many grid lines the height can carry.
  const z = zoomOf('sexpand');
  const wide = zoomWide('sexpand');
  const W = Math.max(280, Math.min(1100, Math.round(contentWidth()) + (wide ? 30 : phoneBleed())));
  const tallH = Math.min(720, Math.max(380, (typeof innerHeight === 'number' ? innerHeight : 800) * 0.66));
  const H = Math.round(atZoom(z, W < 520 ? 240 : 290, tallH));
  const m = { l: W < 520 ? 33 : 40, r: 44, t: 16, b: 32 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const spanH = weeks * 7 * 24;
  const x0 = mode === 'today' ? M.now : 0;
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
  const N = Math.max(80, Math.round(pw / 1.5));
  const hs = Array.from({ length: N + 1 }, (_, i) => (spanH * i) / N);
  // Fit the lines (his ask): the top just above the highest peak, the bottom
  // at the settled low of his starting dose (the first dose on the label, at
  // the reference interval), drawn as a line to compare against.
  const startMg = (M.drug.doses || [])[0];
  const floorRef = startMg ? { mg: startMg, every: M.ref.everyDays, low: (steadyState(M.params, startMg, M.ref.everyDays).trough / M.refAvg) * 100 } : null;
  let top = p.rangeMax, bottom = floorRef ? floorRef.low : p.rangeMin;
  if (mode === 'today') { const v = (at(M.logged, M.now) / M.refAvg) * 100; top = Math.max(top, v); bottom = Math.min(bottom, v); }
  for (const s of series) for (const h of hs) { const v = s.valAt(h); top = Math.max(top, v); bottom = Math.min(bottom, v); }
  const step = niceStep(top - bottom, 6);   // fixed: the zoom stretches, it does not rescale
  const yMin = Math.max(0, Math.floor((bottom - step * 0.2) / step) * step);
  const yMax = Math.ceil((top + step * 0.2) / step) * step;
  const Y = (v) => m.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

  const grid = [];
  for (let v = yMin; v <= yMax + 1e-9; v += step) grid.push(`<line class="pk-grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="pk-ylab" x="${m.l - 7}" y="${(Y(v) + 4).toFixed(1)}">${+v.toFixed(1)}</text>`);
  const zTop = Math.min(p.rangeMax, yMax), zBot = Math.max(p.rangeMin, yMin);
  const zone = `<rect class="pk-zone" x="${m.l}" y="${Y(zTop).toFixed(1)}" width="${pw}" height="${Math.max(0, Y(zBot) - Y(zTop)).toFixed(1)}"/>
    ${p.rangeMin >= yMin ? `<text class="pk-rlab" x="${W - m.r + 6}" y="${(Y(p.rangeMin) + 4).toFixed(1)}">${p.rangeMin}%</text>` : ''}
    ${p.rangeMax <= yMax ? `<text class="pk-rlab" x="${W - m.r + 6}" y="${(Y(p.rangeMax) + 4).toFixed(1)}">${p.rangeMax}%</text>` : ''}
    ${floorRef && floorRef.low >= yMin ? `<line class="pk-startline" x1="${m.l}" x2="${W - m.r}" y1="${Y(floorRef.low).toFixed(1)}" y2="${Y(floorRef.low).toFixed(1)}"/>
      <text class="pk-startlab" x="${m.l + 6}" y="${(Y(floorRef.low) - 6).toFixed(1)}">${mgStr(floorRef.mg)} mg every ${floorRef.every} days, steady low</text>
      <text class="pk-rlab" x="${W - m.r + 6}" y="${(Y(floorRef.low) + 4).toFixed(1)}">${r0(floorRef.low)}%</text>` : ''}`;
  const dayStep = weeks <= 1 ? 1 : weeks <= 2 ? 2 : weeks <= 4 ? 7 : 14;
  const xl = [];
  for (let d = 0; d <= weeks * 7; d += dayStep) {
    const x = X(d * 24);
    let lab;
    if (mode === 'today') { const t = new Date(M.now + d * DAY); lab = d === 0 ? 'Today' : `${mon(t)} ${t.getDate()}`; } else lab = d === 0 ? 'Shot' : `Day ${d}`;
    xl.push(`<text class="pk-xlab" x="${x.toFixed(1)}" y="${H - 8}">${lab}</text>`);
  }
  const lines = series.map((s) => `<path class="pk-sline${s.sw ? ' pk-swline' : ''}" style="stroke:${s.sw ? 'var(--ink)' : `var(--s${s.c})`}" d="${hs.map((h, i) => `${i ? 'L' : 'M'}${X(h).toFixed(1)},${Y(s.valAt(h)).toFixed(1)}`).join('')}"/>`).join('');
  // His own markers: the highest he has been, and the level his hardest craving
  // days fell to. Drawn only when they sit on the chart; never stretch it.
  const refs = [];
  const hi = highestSoFar(M);
  if (hi) refs.push({ v: hi.v, text: `Your highest so far, ${r0(hi.v)}%` });
  const hard = feelLows(M).filter((r) => r.hard);
  if (hard.length) {
    const up = hard.reduce((a, r) => (r.low > a.low ? r : a));
    refs.push({ v: up.low, text: hard.length === 1 ? `Strong craving, ${mon(fromIso(up.iso))} ${fromIso(up.iso).getDate()}, ${r0(up.low)}%` : `Strong cravings, up to ${r0(up.low)}%` });
  }
  const refSvg = refs.filter((r) => r.v >= yMin && r.v <= yMax).map((r) => `<line class="pk-refline" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.v).toFixed(1)}" y2="${Y(r.v).toFixed(1)}"/>
      <text class="pk-startlab" x="${W - m.r - 6}" y="${(Y(r.v) - 6).toFixed(1)}" text-anchor="end">${esc(r.text)}</text>`).join('');

  // Where the switch happens: a mark on the day of the first new shot.
  let swMark = '';
  if (swr) {
    const h = (swr.land - x0) / HOUR;
    if (h > 0 && h < spanH) {
      const x = X(h).toFixed(1);
      const t = new Date(swr.land);
      swMark = `<line class="pk-swmark" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}"/>
        <text class="pk-startlab" x="${(+x + 5).toFixed(1)}" y="${m.t + 12}">Switch, ${mon(t)} ${t.getDate()}</text>`;
    }
  }
  compareState = { series, X, Y, m, W, H, ph, spanH, mode, x0 };
  const empty = !series.length ? '<text class="pk-empty" x="50%" y="45%">Tap a schedule below to draw it</text>' : '';
  return `
    <div class="pk-plot" data-pk-cmp tabindex="0" role="group" aria-label="Schedules compared. Arrow keys move the cursor.">
      <svg class="pk-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
        ${zone}${grid.join('')}${refSvg}${swMark}${lines}${xl.join('')}${empty}
        <g class="pk-guide" style="opacity:0"><line x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/></g>
        <rect class="pk-hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/>
      </svg>
    </div>
    <div class="pk-cmpread" data-pk-cmpread>${cmpReadout(null)}</div>`;
}

function cmpReadout(h) {
  const c = compareState;
  if (!c || !c.series.length || h == null) return '';
  const when = h == null ? '' : c.mode === 'today' ? (() => { const t = c.x0 + h * HOUR; return `${dayName(t)}, ${hourName(t)}`; })() : `Day ${(h / 24).toFixed(1)}`;
  const rows = c.series.map((s) => `<span class="pk-cr" style="--c:${s.sw ? 'var(--ink)' : `var(--s${s.c})`}"><i></i>${esc(s.sw ? 'Your switch' : planShort(s.f.pl))}${h == null ? '' : `<b>${r0(s.valAt(h))}%</b>`}</span>`).join('');
  return `${h == null ? '' : `<b class="pk-crwhen">${esc(when)}</b>`}${rows}`;
}

function bindCompare(root) {
  const plot = root.querySelector('[data-pk-cmp]');
  const c = compareState;
  if (!plot || !c || !c.series.length) return;
  const svg = plot.querySelector('svg');
  const guide = svg.querySelector('.pk-guide');
  const out = root.querySelector('[data-pk-cmpread]');
  let cur = 0;
  const show = (h) => {
    cur = Math.min(c.spanH, Math.max(0, h));
    const x = c.X(cur);
    guide.style.opacity = '1';
    guide.querySelector('line').setAttribute('x1', x); guide.querySelector('line').setAttribute('x2', x);
    out.innerHTML = cmpReadout(cur);
  };
  const fromEvent = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * c.W;
    return ((px - c.m.l) / (c.W - c.m.l - c.m.r)) * c.spanH;
  };
  svg.addEventListener('pointermove', (e) => show(fromEvent(e)));
  svg.addEventListener('pointerdown', (e) => show(fromEvent(e)));
  svg.addEventListener('pointerleave', () => { guide.style.opacity = '0'; out.innerHTML = cmpReadout(null); });
  plot.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(cur + (e.key === 'ArrowLeft' ? -6 : 6));
  });
}

function labelTiles(M) {
  const facts = M.drug.label || [];
  return `<details class="pk-about"><summary><span>Model, Pen Math and Label</span><svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></summary><section class="pm-sec">
    <div class="sc-notes pk-notes">
      <div class="sc-note"><b>The Model</b><span>Peak, trough and average: pharmacology, from the published model.</span></div>
      <div class="sc-note"><b>Pen Math</b><span>Shots, waste and cost: arithmetic on your pens and prices.</span></div>
      <div class="sc-note"><b>The Label</b><span>What the prescribing information says. Changes are your prescriber's call.</span></div>
    </div>
    ${facts.length ? `<h2 class="ov-h pk-h2">The Label Says</h2><div class="sc-tiles ${facts.length === 4 ? 'n4' : ''}">${facts.map((f) => `<div class="sc-tile"><small>${esc(f.k)}</small><b>${esc(f.v)}</b>${f.note ? `<span>${esc(f.note)}</span>` : ''}</div>`).join('')}</div>` : ''}
  </section></details>`;
}

// ------------------------------------------------------------------ bind --
export function bindMedLevel(root, ctx, rerender) {
  repaint = rerender;
  root.querySelectorAll('[data-pkpart]').forEach((b) => b.addEventListener('click', () => { ctx.pkPart = b.dataset.pkpart; rerender(); }));
  // The four buttons are four places on the span slider, so whichever he uses
  // the other one follows (his ask, 2026-09-20).
  root.querySelectorAll('[data-pk-range]').forEach((b) => b.addEventListener('click', () => {
    const M = model();
    if (M) lsSet('span', String(presetSpan(M, b.dataset.pkRange)));
    rerender();
  }));
  root.querySelector('[data-pk-wline]')?.addEventListener('click', () => { lsSet('wline', lsGet('wline', '0') === '1' ? '0' : '1'); rerender(); });
  root.querySelectorAll('[data-pk-unit]').forEach((b) => b.addEventListener('click', () => { lsSet('unit', b.dataset.pkUnit); rerender(); }));
  root.querySelector('[data-pk-log]')?.addEventListener('click', () => openShot(null));
  // Remembered only: a repaint here would cut the opening animation short.
  root.querySelector('[data-pk-logfold]')?.addEventListener('toggle', (e) => {
    lsSet('logopen', e.currentTarget.open ? '1' : '0');
  });
  root.querySelectorAll('[data-pk-weight]').forEach((b) => b.addEventListener('click', () => openWeight()));
  root.querySelectorAll('[data-pk-weight-edit]').forEach((b) => b.addEventListener('click', () => openWeight(b.dataset.pkWeightEdit)));
  root.querySelector('[data-pk-wlogfold]')?.addEventListener('toggle', (e) => {
    lsSet('wlogopen', e.currentTarget.open ? '1' : '0');
  });
  root.querySelectorAll('[data-pk-shot]').forEach((b) => b.addEventListener('click', () => openShot(b.dataset.pkShot)));
  root.querySelectorAll('[data-pk-restore]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkRestore;
    save((d) => { const s = d.pk.shots[id]; if (s) d.pk.shots[id] = { ...s, removed: false, restoredAt: new Date().toISOString() }; });
  }));
  bindPlot(root);

  // Cravings.
  root.querySelectorAll('[data-pk-week]').forEach((b) => b.addEventListener('click', () => {
    const end = addDays(ctx.pkWeekEnd || todayIso(), Number(b.dataset.pkWeek));
    ctx.pkWeekEnd = end > todayIso() ? todayIso() : end;
    ctx.pkDay = ctx.pkWeekEnd;
    rerender();
  }));
  root.querySelectorAll('[data-pk-day]').forEach((b) => b.addEventListener('click', () => { ctx.pkDay = b.dataset.pkDay; rerender(); }));
  const cardIso = root.querySelector('[data-pk-dayiso]')?.dataset.pkDayiso;
  // The chosen craving's highlight glides to a new choice (B5-4); a day change or
  // a craving taken back off shows it in place.
  const crave = root.querySelector('.pk-crave');
  if (crave) glide(crave, crave.querySelector(':scope > .pk-cbtn.on'), { key: 'pk-crave', cls: 'gi-pick', animate: craveTap });
  craveTap = false;
  root.querySelectorAll('[data-pk-crave]').forEach((b) => b.addEventListener('click', () => {
    const iso = cardIso || ctx.pkDay || todayIso();
    const v = Number(b.dataset.pkCrave);
    craveTap = true;   // the choice glides to the new one (B5-4)
    save((d) => {
      const cur = d.pk.feel[iso] || {};
      if (cur.c === v) {
        const next = { ...cur, c: null, at: new Date().toISOString() };
        if (feelEmpty(next)) delete d.pk.feel[iso]; else d.pk.feel[iso] = next;
      } else d.pk.feel[iso] = { ...cur, c: v, at: new Date().toISOString() };
    });
  }));
  const feelEdit = (change) => {
    const iso = cardIso || ctx.pkDay || todayIso();
    save((d) => {
      const next = change({ ...(d.pk.feel[iso] || {}) });
      next.c = next.c ?? null;
      if (feelEmpty(next)) delete d.pk.feel[iso]; else d.pk.feel[iso] = next;
    });
  };
  root.querySelectorAll('[data-pk-tag]').forEach((b) => b.addEventListener('click', () => feelEdit((f) => {
    const k = b.dataset.pkTag;
    f.tags = { ...(f.tags || {}), [k]: ((f.tags || {})[k] || 0) + 1 };
    return f;
  })));
  root.querySelectorAll('[data-pk-untag]').forEach((b) => b.addEventListener('click', () => feelEdit((f) => {
    const k = b.dataset.pkUntag;
    const tags = { ...(f.tags || {}) };
    if ((tags[k] || 0) > 1) tags[k] -= 1; else delete tags[k];
    if (Object.keys(tags).length) f.tags = tags; else delete f.tags;
    return f;
  })));
  root.querySelectorAll('[data-pk-when]').forEach((b) => b.addEventListener('click', () => feelEdit((f) => {
    const k = b.dataset.pkWhen;
    const cur = f.when || [];
    const when = cur.includes(k) ? cur.filter((x) => x !== k) : WHEN.map(([w]) => w).filter((w) => w === k || cur.includes(w));
    if (when.length) f.when = when; else delete f.when;
    return f;
  })));
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

  // Schedules.
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
  // What If: which schedules are drawn, the view, the weeks.
  const toggle = (id) => {
    const list = plans();
    const cur = selected(list) || new Set([...root.querySelectorAll('.pk-plan.on [data-pk-toggle]')].map((b) => b.dataset.pkToggle));
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    lsSet('plans', [...cur].join(','));
    rerender();
  };
  root.querySelectorAll('[data-pk-toggle]').forEach((b) => b.addEventListener('click', () => toggle(b.dataset.pkToggle)));
  root.querySelectorAll('[data-pk-all]').forEach((b) => b.addEventListener('click', () => {
    lsSet('plans', b.dataset.pkAll === '1' ? plans().map((p) => p.id).join(',') : ',');
    rerender();
  }));
  root.querySelectorAll('[data-pk-spen]').forEach((b) => b.addEventListener('click', () => { lsSet('spen', b.dataset.pkSpen); rerender(); }));
  root.querySelectorAll('[data-pk-sort]').forEach((b) => b.addEventListener('click', () => { lsSet('ssort', b.dataset.pkSort); rerender(); }));
  root.querySelectorAll('[data-pk-smode]').forEach((b) => b.addEventListener('click', () => { lsSet('smode', b.dataset.pkSmode); rerender(); }));
  // Plan a switch: synced in settings.pk.sw, so every device shows the same plan.
  const setSw = (k, v) => save((d) => { const pk = d.settings.pk || {}; d.settings.pk = { ...pk, sw: { ...(pk.sw || {}), [k]: v } }; });
  root.querySelector('[data-pk-swto]')?.addEventListener('change', (e) => setSw('to', e.target.value));
  root.querySelector('[data-pk-swday]')?.addEventListener('change', (e) => setSw('day', e.target.value));
  root.querySelector('[data-pk-swpen]')?.addEventListener('change', (e) => { if (e.target.value) setSw('pen', e.target.value); });
  root.querySelectorAll('[data-pk-uselow]').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.pkUselow);
    if (!(v < prefs().rangeMax)) { toast('That low is above your high', 'bad'); return; }
    save((d) => { d.settings.pk = { ...(d.settings.pk || {}), rangeMin: v }; });
  }));
  root.querySelector('[data-pk-swline]')?.addEventListener('click', () => { lsSet('swline', lsGet('swline', '1') === '1' ? '0' : '1'); rerender(); });
  root.querySelectorAll('[data-pk-sweeks]').forEach((b) => b.addEventListener('click', () => { lsSet('sweeks', b.dataset.pkSweeks); rerender(); }));
  root.querySelectorAll('[data-pk-expand]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.pkExpand; lsSet(k, zoomOf(k) > 0 ? '0' : '100'); rerender(); }));
  // The chart follows the slider while he drags it (his ask, 2026-09-20: "can
  // the slider live update as I slide"). A view repaint cannot do that: it
  // replaces the slider itself and the drag ends on the first frame, which is
  // exactly why the edit guard holds repaints back during a drag. So the head
  // is left alone and only the picture under it is redrawn, once a frame.
  const liveSlider = (r, which, onInput) => {
    let queued = false;
    const draw = () => {
      queued = false;
      const body = root.querySelector(`[data-pk-body="${which}"]`);
      if (!body) return rerender();
      if (which === 'level') {
        const M = model();
        if (!M) return rerender();
        body.closest('.pk-cmpsec')?.classList.toggle('wide', zoomWide('lexpand'));
        body.innerHTML = levelChart(M, ctx, true);
        bindPlot(root);
      } else {
        const a = compareArgs;
        if (!a) return rerender();
        body.closest('.pk-cmpsec')?.classList.toggle('wide', zoomWide('sexpand'));
        body.innerHTML = compareChart(a.M, a.chosen, a.colors, a.p, a.mode, a.weeks);
        bindCompare(root);
      }
      return undefined;
    };
    r.addEventListener('input', () => {
      onInput(r);
      if (queued) return;
      queued = true;
      requestAnimationFrame(draw);
    });
    // On release, one ordinary repaint so the header and everything else on the
    // page agree with the number that was just chosen.
    r.addEventListener('change', () => rerender());
  };
  root.querySelectorAll('[data-pk-zoom]').forEach((r) => {
    const key = r.dataset.pkZoom;
    liveSlider(r, key === 'lexpand' ? 'level' : 'compare', () => lsSet(key, String(Math.round(Number(r.value) || 0))));
  });
  root.querySelectorAll('[data-pk-span]').forEach((r) => {
    liveSlider(r, 'level', () => {
      const v = Math.round(Number(r.value) || 0);
      lsSet('span', String(v));
      r.title = spanText(v);
    });
  });
  bindCompare(root);
  root.querySelectorAll('[data-pk-hide]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkHide;
    save((d) => { const x = d.pk.plans[id]; if (x) d.pk.plans[id] = { ...x, hidden: true }; });
  }));
  root.querySelectorAll('[data-pk-unhide]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.pkUnhide;
    save((d) => { const x = d.pk.plans[id]; if (x) d.pk.plans[id] = { ...x, hidden: false }; });
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
}

function bindPlot(root) {
  const plot = root.querySelector('.pk-plot:not([data-pk-cmp])');
  const c = chartState;
  if (!plot || !c) return;
  const svg = plot.querySelector('svg');
  const guide = svg.querySelector('.pk-guide');
  const out = root.querySelector('[data-pk-readout]');
  let cur = c.M.now;
  const show = (t) => {
    cur = Math.min(c.x1, Math.max(c.x0, t));
    const x = c.X(cur), y = c.Y(c.val(c.M.withNext, cur));
    guide.style.opacity = '1';
    guide.querySelector('line').setAttribute('x1', x); guide.querySelector('line').setAttribute('x2', x);
    guide.querySelector('circle').setAttribute('cx', x); guide.querySelector('circle').setAttribute('cy', y);
    out.innerHTML = readout(cur);
  };
  const fromEvent = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * c.W;
    return c.x0 + ((px - c.m.l) / (c.W - c.m.l - c.m.r)) * (c.x1 - c.x0);
  };
  svg.addEventListener('pointermove', (e) => show(fromEvent(e)));
  svg.addEventListener('pointerdown', (e) => show(fromEvent(e)));
  svg.addEventListener('pointerleave', () => { guide.style.opacity = '0'; out.innerHTML = readout(c.M.now); });
  plot.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(cur + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 7 : 1) * DAY / 4);
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

// A date stepper for the sheets: the day in a pill (tap it for the picker),
// a day back and a day on. Today has no day on, but the arrow keeps its place
// (invisible) so the pill stays centred.
const CHEV_L = '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>';
const CHEV_R = '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';
function dateStep(date) {
  return `<div class="pk-datestep">
    <button type="button" class="icon-btn" data-dstep="-1" aria-label="Day before">${CHEV_L}</button>
    <label class="pk-datepill"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>
      <span data-dlabel>${dayName(midnight(date))}</span><input type="date" name="date" value="${date}" max="${todayIso()}" aria-label="Date"></label>
    <button type="button" class="icon-btn ${date >= todayIso() ? 'pk-invis' : ''}" data-dstep="1" aria-label="Day after" ${date >= todayIso() ? 'tabindex="-1" aria-hidden="true"' : ''}>${CHEV_R}</button>
  </div>`;
}
function bindDateStep(f, st) {
  const inp = f.querySelector('[name=date]');
  const next = f.querySelector('[data-dstep="1"]');
  const show = () => {
    inp.value = st.date;
    f.querySelector('[data-dlabel]').textContent = dayName(midnight(st.date));
    const atToday = st.date >= todayIso();
    next.classList.toggle('pk-invis', atToday);
    next.tabIndex = atToday ? -1 : 0;
    next.setAttribute('aria-hidden', String(atToday));
  };
  f.querySelectorAll('[data-dstep]').forEach((b) => b.addEventListener('click', () => {
    const d = addDays(st.date, Number(b.dataset.dstep));
    if (d > todayIso()) return;
    st.date = d; show();
  }));
  inp.addEventListener('change', () => { if (inp.value && inp.value <= todayIso()) st.date = inp.value; show(); });
}

/** One row of a sheet: the name, the current value, and its choices folded under it. */
function sheetRow(k, label, val, body) {
  return `<div class="pk-row" data-row="${k}">
    <button type="button" class="pk-rhead" data-open="${k}" aria-expanded="false"><span>${label}</span><b data-val="${k}">${esc(val)}</b>
      <svg class="pk-chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
    <div class="fold-body shut" data-body="${k}" inert><div class="fold-clip"><div class="pk-rbody">${body}</div></div></div>
  </div>`;
}
/** Open one row, close the others. */
function bindRows(f) {
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
  const open = (k) => f.querySelectorAll('[data-open]').forEach((h) => set(h.dataset.open, h.dataset.open === k && !h.classList.contains('open')));
  f.querySelectorAll('[data-open]').forEach((h) => h.addEventListener('click', () => {
    open(h.dataset.open);
    if (h.classList.contains('open')) f.querySelector(`[data-body="${h.dataset.open}"] input[type=text]`)?.focus({ preventScroll: true });
  }));
  return { close: (k) => set(k, false) };
}

function openShot(id) {
  const M = model();
  if (!M) return;
  const raw = id ? pkDoc().shots[id] : null;
  const shot = raw ? { id, ...raw, t: Date.parse(raw.at) } : null;
  const last = M.last;
  const start = localParts(shot ? shot.t : Date.now());
  const std = M.drug.doses || [];
  const st = {
    date: start.date,
    time: shot && shot.timeKnown === false ? '' : start.time,
    mg: shot ? shot.mg : last ? last.mg : std[0] || null,
    site: shot ? shot.site || '' : '',
    note: shot?.note || '',
  };
  // His own doses: the non-standard amounts he has actually taken, newest first.
  const mine = [];
  for (const s of [...M.shots].reverse()) {
    if (!std.includes(s.mg) && !mine.includes(s.mg)) mine.push(s.mg);
    if (mine.length === 4) break;
  }
  const lastSite = !shot && last?.site ? last.site : null;
  const doseVal = () => (st.mg > 0 ? `${mgStr(st.mg)} mg` : 'Choose');
  const siteVal = () => (st.site ? SITE_NAME[st.site] || st.site : 'None');
  const chip = (v) => `<button type="button" class="pk-chip ${st.mg === v ? 'on' : ''}" data-mg="${v}" aria-pressed="${st.mg === v}">${mgStr(v)}</button>`;
  const other = st.mg != null && !std.includes(st.mg) && !mine.includes(st.mg) ? st.mg : '';

  const doseBody = `
    <div class="pk-chips" style="--n:${std.length}">${std.map(chip).join('')}</div>
    ${mine.length ? `<small class="pk-sublab">Your doses</small><div class="pk-chips" style="--n:${mine.length}">${mine.map(chip).join('')}</div>` : ''}
    <label class="pk-other"><small>Other</small><input class="in-num" type="number" inputmode="decimal" step="any" min="0.01" name="mg" value="${other}" placeholder="0"><b>mg</b></label>`;
  const cell = (k) => `<button type="button" class="pk-cellbtn ${st.site === k ? 'on' : ''} ${lastSite === k ? 'last' : ''}" data-site="${k}" aria-label="${esc(SITE_NAME[k])}" aria-pressed="${st.site === k}">${lastSite === k ? '<em>Last</em>' : ''}</button>`;
  const limb = (k, l) => `<button type="button" class="pk-site ${st.site === k ? 'on' : ''} ${lastSite === k ? 'last' : ''}" data-site="${k}" aria-pressed="${st.site === k}">${l}</button>`;
  const siteBody = `
    <div class="pk-belly">
      <small class="rl pk-part">Stomach</small>${COLS3.map(([, l]) => `<small>${l}</small>`).join('')}
      ${ROWS3.map(([r, rl]) => `<small class="rl">${rl}</small>${COLS3.map(([c]) => (r === 'm' && c === 'm' ? '<span class="pk-navel" title="Belly button: stay 2 inches away"><i></i><small>2 in</small></span>' : cell(stomachKey(r, c)))).join('')}`).join('')}
    </div>
    <div class="pk-limbs">
      <small>Thigh</small>${limb('thigh-l', 'Left')}${limb('thigh-r', 'Right')}
      <small>Back of arm</small>${limb('arm-l', 'Left')}${limb('arm-r', 'Right')}
    </div>
    <small class="pk-sublab pk-note2">Stomach 2 inches from the belly button. Someone else gives the arm.</small>`;
  const noteBody = `<input type="text" name="note" maxlength="200" value="${esc(st.note)}" placeholder="Anything to remember" aria-label="Note">`;

  const body = `<div class="pk-form">
    ${dateStep(st.date)}
    <div class="pk-rows">
      <label class="pk-row pk-rstatic"><span>Time</span><input class="pk-timechip" type="time" name="time" value="${st.time}" aria-label="Time"></label>
      ${sheetRow('dose', 'Dose', doseVal(), doseBody)}
      ${sheetRow('site', 'Site', siteVal(), siteBody)}
      ${sheetRow('note', 'Note', st.note || 'Add', noteBody)}
    </div>
  </div>`;
  const footer = `${shot ? '<button class="btn ghost danger pk-left" data-pk-remove>Remove</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-pk-save>${shot ? 'Save' : 'Log shot'}</button>`;

  openModal({
    title: shot ? 'Edit shot' : 'Log a shot',
    body, footer,
    onMount(back) {
      const f = back.querySelector('.pk-form');
      const rows = bindRows(f);
      bindDateStep(f, st);
      const setVal = (k, v) => { f.querySelector(`[data-val="${k}"]`).textContent = v; };
      const mgIn = f.querySelector('[name=mg]');
      const markChips = () => f.querySelectorAll('[data-mg]').forEach((x) => { const on = Number(x.dataset.mg) === st.mg; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
      f.querySelectorAll('[data-mg]').forEach((b) => b.addEventListener('click', () => {
        st.mg = Number(b.dataset.mg); mgIn.value = ''; markChips(); setVal('dose', doseVal());
        setTimeout(() => rows.close('dose'), 160);
      }));
      mgIn.addEventListener('input', () => { const v = Number(mgIn.value); st.mg = v > 0 ? v : null; markChips(); setVal('dose', doseVal()); });
      f.querySelectorAll('[data-site]').forEach((b) => b.addEventListener('click', () => {
        st.site = st.site === b.dataset.site ? '' : b.dataset.site;
        f.querySelectorAll('[data-site]').forEach((x) => { const on = x.dataset.site === st.site; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        setVal('site', siteVal());
        if (st.site) setTimeout(() => rows.close('site'), 160);
      }));
      const noteIn = f.querySelector('[name=note]');
      noteIn.addEventListener('input', () => { st.note = noteIn.value; setVal('note', noteIn.value.trim() || 'Add'); });
      noteIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rows.close('note'); } });
      f.querySelector('[name=time]').addEventListener('change', (e) => { st.time = e.target.value; });

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
        const key = shot ? shot.id : `s${uid()}`;
        save((d) => { d.pk.shots[key] = rec; });
        closeModal();
        toast(shot ? 'Shot saved' : `${mgStr(st.mg)} mg logged`);
      });
      back.querySelector('[data-pk-remove]')?.addEventListener('click', () => {
        save((d) => { const s = d.pk.shots[shot.id]; if (s) d.pk.shots[shot.id] = { ...s, removed: true, removedAt: new Date().toISOString() }; });
        closeModal();
        toast('Shot removed. Restore it under Removed.');
      });
    },
  });
}

// ---------------------------------------------------------- weight sheet --
// A weight is the app's own bodyweight measurement, so the rehab markers that
// read bodyweight and this model both use it.
function openWeight(onDate) {
  const unit = state.data.settings.weightUnit || 'kg';
  const prev = latest('bodyweight', null);
  const kg = bodyweightKg();
  // Editing a row he tapped in the weight log: that day's date and that day's
  // number, so the sheet opens on what he is changing rather than on today.
  const row = onDate ? (state.data.measurements || []).find((m) => m.measure === 'bodyweight' && m.date === onDate) : null;
  const rowShown = row ? Math.round((row.unit === unit ? row.value
    : toKg(row.value, row.unit || state.data.settings.weightUnit || 'kg') * (unit === 'lb' ? 2.2046226218 : 1)) * 10) / 10 : null;
  const shown = rowShown != null ? rowShown : (kg ? Math.round((unit === 'lb' ? kg * 2.2046226218 : kg) * 10) / 10 : '');
  const st = { date: onDate || todayIso() };
  // The hint is the latest weigh-in itself, its number beside its own date (it
  // printed the edited row's number next to the latest date, 2026-09-22).
  const inUnit = (m) => Math.round((m.unit === unit ? m.value : toKg(m.value, m.unit || state.data.settings.weightUnit || 'kg') * (unit === 'lb' ? 2.2046226218 : 1)) * 10) / 10;
  const hint = row ? '' : prev ? `Last: ${inUnit(prev)} ${unit}, ${dayName(midnight(prev.date))}` : kg ? `In Settings: ${shown} ${unit}` : '';
  openModal({
    title: row ? 'Edit weight' : 'Log weight',
    body: `<div class="pk-form">
      ${dateStep(st.date)}
      <label class="pk-weight"><input class="in-num" type="number" inputmode="decimal" step="0.1" min="20" max="700" name="w" value="${shown}" placeholder="${shown || '0'}" aria-label="Weight in ${unit}"><b>${unit}</b></label>
      ${hint ? `<small class="pk-sublab pk-center">${esc(hint)}</small>` : ''}
    </div>`,
    footer: `${row ? '<button class="btn danger" data-pk-wdel>Remove</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-pk-wsave>${row ? 'Save' : 'Log weight'}</button>`,
    onMount(back) {
      const f = back.querySelector('.pk-form');
      bindDateStep(f, st);
      const inp = f.querySelector('[name=w]');
      const save = () => {
        const v = Number(inp.value);
        const low = unit === 'lb' ? 44 : 20, high = unit === 'lb' ? 700 : 320;
        if (!(v >= low && v <= high)) { toast(`Enter your weight in ${unit}`, 'bad'); return; }
        // One weight a day: a second one on the same date replaces the first,
        // so two devices cannot disagree about which is the latest (audit F34).
        const same = allMeasurements().filter((m) => m.measure === 'bodyweight' && m.date === st.date && !m.src?.startsWith('Clinic'));
        const mine = same.find((m) => (state.data.measurements || []).some((x) => x.id === m.id));
        if (mine) update((d) => {
          const r = d.measurements.find((x) => x.id === mine.id);
          if (r) { r.value = v; r.unit = unit; r.at = new Date().toISOString(); }
          // Editing a row onto a date that already has one: that date keeps one.
          if (row && row.id !== mine.id) d.measurements = d.measurements.filter((x) => x.id !== row.id);
          syncBodyweightSetting(d);
        });
        else if (row) update((d) => {
          // A changed date moves the row he is editing (it used to add a new one
          // and leave the old one where it was, 2026-09-22 audit).
          const r = d.measurements.find((x) => x.id === row.id);
          if (r) { r.value = v; r.unit = unit; r.date = st.date; r.at = new Date().toISOString(); }
          syncBodyweightSetting(d);
        });
        else addMeasurement({ measure: 'bodyweight', leg: null, value: v, unit, date: st.date, at: new Date().toISOString(), src: 'Logged in the app' });
        repaint();
        closeModal();
        toast(`${v} ${unit} logged`);
      };
      back.querySelector('[data-pk-wsave]').addEventListener('click', save);
      back.querySelector('[data-pk-wdel]')?.addEventListener('click', () => {
        update((d) => {
          d.measurements = d.measurements.filter((m) => m.id !== row.id);
          syncBodyweightSetting(d);
        });
        repaint();
        closeModal();
        toast('Weight removed');
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    },
  });
}
