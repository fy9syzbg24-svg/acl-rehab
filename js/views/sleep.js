// Rehab Test round 3 (2026-09-30): "The Night". The Sleep page, rebuilt from scratch.
//
// His words tonight: "we can still do a pretty significant design overhaul of the aura ring,
// sleep data", "I definitely will be looking at the sleep data a lot, so maybe have that a
// little less hidden", "oura still looks very similar to the web app version". Plan 1B in
// design-pass/research/10-round3-plan.md, 10d part A (Option A), 04 section F.
//
// What is on it, top to bottom:
//   1. The ribbon: fourteen nights on ONE clock axis (bedtime top, wake bottom), today right.
//      Faint = in bed, solid = asleep, hollow = another time zone, a dot = his estimate, a
//      dashed capsule = no ring data. His median bedtime as a dashed line with a band of one
//      hour either side. Press and drag along it: one night per step with a selection tick.
//      His life under it as glyphs (shot, clinic, show, away), facts only, no conclusion.
//      Its header carries the two levers his own record proved: bedtime swing and sleep owed.
//   2. The dusk card: time asleep rolling up, the sky behind the night following that
//      night's REAL clock (indigo at bedtime, lilac at dawn, daylight blue for a late wake),
//      the hypnogram drawing in like the night passing, press and drag to read any moment
//      with a tick at each stage change, and the four stages against his usual bracket.
//   3. Against your usual: six rows, each his middle half of the last 30 nights as a band,
//      his median as a tick, the chosen night as a dot (a ring and the words "outside your
//      usual" when it falls outside). Tagged measured or estimate. Tap: the long view.
//   4. Trends: thirteen weeks of weekly medians as small multiples with one shared finger.
//   5. The night of a dose as dumbbells, then the v3 sections below the fold (recovery.js).
//
// Rules this page keeps (his, standing): a RECORD, never advice (no verdict words, no
// readiness advice, arrows never coloured good or bad, no red); his estimate is the main
// figure on a night Oura got wrong, Oura's own figure beside it; temperatures in F (a change
// times 1.8, never plus 32); words on solid ground (every label sits on a solid strip, never
// on the sky); one colour one meaning: indigo and blue here are the SLEEP panel's own and
// never touch a leg (no L or R on this page), turquoise only for the selected night, green
// only for a met marker, gold never. No emoji, no dashes in screen text. Nothing is written.

import { esc, round, fmtDateShort, toIso } from '../util.js';
import { state } from '../store.js';
import {
  ringReady, ringSettled, ringNights, ringBuiltAt, lastNight, recentNights, nightFor,
  ringMedian, shotNightEffect, SLEEP_TARGET_H, STEADY_WINDOW, DEBT_NIGHTS,
  phaseRuns, nightMinutes, inBedMinutes, movementLevels, stageMinutes, stepNight, STAGES, nightSpan, weekdayOf,
  syncRing, syncWords, waitForMac, shotSentence, bedHour, awayNight, steadiness,
  middleHalf, wakeHour, owedThrough, ouraValue, isEstimate,
} from '../ring.js';
import { toast } from '../components.js';
import { countUp, pageEnter } from '../motion.js';
import { haptic, chart as nativeChart, isNative } from '../native-bridge.js';
import { sheet } from './pkit.js';
import { SERVER_MODE } from '../sync/local-store.js';
import {
  longView, rangeBar, placeSection, loadSection, inRange, layoutWidth, WIDE_AT,
  clock, hm, fitAxis, openMetric, recoveryRange,
} from './recovery.js';

const RIB_NIGHTS = 14;
const USUAL_NIGHTS = 30;
const TREND_WEEKS = 13;

// ------------------------------------------------------------------ glyphs ---
const I = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const G = {
  moon: I('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  stars: I('<path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z"/>'),
  bolt: I('<path d="M13 3L5.5 13.5H11l-1 7.5L18.5 10H13z"/>'),
  wave: I('<path d="M3 12h3l2-5 3 10 3-8 2 3h5"/>'),
  heart: I('<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>'),
  temp: I('<path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/>'),
  lungs: I('<path d="M12 4v8M12 10c-2 0-3-2-5-2-2 0-3 3-3 7 0 3 1 5 3 5s4-2 4-5v-5M12 10c2 0 3-2 5-2 2 0 3 3 3 7 0 3-1 5-3 5s-4-2-4-5v-5"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  shot: I('<path d="M14 4l6 6M17 7l-8.5 8.5-3.5 1 1-3.5L14.5 4.5M4 20l2.5-2.5M11 8l5 5"/>'),
  clinic: I('<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  show: I('<path d="M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4L12 15.7l-4.8 2.6 1-5.4-4-3.7 5.4-.7z"/>'),
  away: I('<path d="M3 13l18-6-7 13-2-5z"/>'),
  up: I('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: I('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  sync: I('<path d="M20 12a8 8 0 0 1-13.3 6"/><path d="M4 12a8 8 0 0 1 13.3-6"/><path d="M17.3 2.6V6h-3.4"/><path d="M6.7 21.4V18h3.4"/>'),
  check: I('<path d="M6 12.5l4 4L18 8"/>'),
  chev: I('<path d="M9 6l6 6-6 6"/>'),
};

// ------------------------------------------------------------------ time -----
const shiftIso = (iso, days) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return toIso(d); };
const dayGap = (a, b) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 864e5);

/** A continuing clock hour (27.5 is 3:30 AM) as "3:30 AM", or "3 AM" on the hour. Round 3
 *  consistency (2026-09-30): the app's one clock style, as Today, Supplements and the player
 *  write it (toLocaleTimeString en-US), with a no break space so "AM" never wraps alone. */
function clockH(h, short = false) {
  const t = Math.round((((h % 24) + 24) % 24) * 60);
  const hh = Math.floor(t / 60) % 24;
  const mm = t % 60;
  const ap = hh >= 12 ? '\u00a0PM' : '\u00a0AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 || short ? `${h12}${ap}` : `${h12}:${String(mm).padStart(2, '0')}${ap}`;
}

/** Hours and minutes as { h, m } for the rolling hero. */
const hmParts = (hours) => { const t = Math.round(hours * 60); return { h: Math.floor(t / 60), m: t % 60 }; };

/** Minutes as "40m" or "1h 05m". */
function mins(m) {
  const t = Math.round(m);
  return t < 60 ? `${t}m` : `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, '0')}m`;
}

/** The newest calendar day a night could carry: the ring dates a night by the morning it ends. */
function endDay() {
  const last = lastNight();
  const today = toIso(new Date());
  return last && last.day > today ? last.day : today;
}

/** The night on screen: the one he chose, or the newest. */
function selectedIso(ctx) {
  const ns = ringNights();
  if (!ns.length) return null;
  return ctx && ctx.slNight && nightFor(ctx.slNight) ? ctx.slNight : ns[ns.length - 1].day;
}

/** The fourteen calendar days of the ribbon page that holds `iso`, oldest first. */
function windowDays(iso) {
  const end0 = endDay();
  const page = Math.max(0, Math.floor(dayGap(iso, end0) / RIB_NIGHTS));
  const end = shiftIso(end0, -RIB_NIGHTS * page);
  return Array.from({ length: RIB_NIGHTS }, (_, i) => shiftIso(end, i - (RIB_NIGHTS - 1)));
}

// ----------------------------------------------------------- his life -----
// Facts from his record only, placed on the night that FOLLOWED them (a night is the evening
// of one day into the morning of the next; the ring dates it by the morning). No sentence, no
// conclusion: a glyph and, on the dusk card, its word.
function lifeByEvening() {
  const out = {};
  const add = (iso, kind) => { if (!iso) return; (out[iso] ||= new Set()).add(kind); };
  for (const s of Object.values(state.data?.pk?.shots || {})) {
    if (!s || !s.at || !(s.mg > 0) || s.removed) continue;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(String(s.at));
    if (!m) continue;
    // A dose after midnight belongs to the evening before, the app's own 5am line.
    add(Number(m[2]) < 5 ? shiftIso(m[1], -1) : m[1], 'shot');
  }
  for (const [iso, on] of Object.entries(state.data?.program?.clinicDays || {})) if (on) add(iso, 'clinic');
  // Shows he puts on a day live in the test app's own device store (round 3, A1). Read
  // defensively: a missing or unreadable store is simply no shows.
  try {
    const loc = JSON.parse(localStorage.getItem('rt.local.v1') || 'null');
    // Only a show he ticked performed, like History's calendar and the Plan road (round 3
    // consistency pass): a show only planned is not yet a fact of that night.
    for (const [iso, s] of Object.entries(loc?.shows || {})) if (s && typeof s === 'object' && s.performed && !s.hidden) add(iso, 'show');
  } catch { /* no store yet */ }
  return out;
}
const LIFE_WORD = { shot: 'Shot', clinic: 'Clinic', show: 'Show', away: 'Away' };

// ------------------------------------------------------------------ page -----
/** The name Progress's Legs / Sleep switch uses, or null until the ring has nights. */
export function sleepLabel() {
  return ringReady() ? 'Sleep' : null;
}

// The iPad (wide AND tall, so never an iPhone held sideways): the ribbon and the night card
// stand side by side, his usual under the ribbon, the trends across the foot as a grid
// (rt-sleep.css `.sl-tab`). Decided in script as well as CSS because the ribbon is drawn in the
// width of its column, so the page redraws when a rotation flips this (see bindSleep).
const TAB_MQ = '(min-width: 700px) and (min-height: 560px)';
const TAB_AT = 640;
function isTab(cw) {
  try { return matchMedia(TAB_MQ).matches && cw >= TAB_AT; } catch { return false; }
}

export function renderSleep(ctx) {
  if (!ringReady()) return ringSettled() ? emptyPage() : '<div class="stack rc-wait sl" aria-busy="true"></div>';
  const cw = layoutWidth();
  const wide = cw >= WIDE_AT;
  const tab = isTab(cw);
  const iso = selectedIso(ctx);
  const range = recoveryRange();
  const nights = inRange(ringNights(), range);
  // The iPad puts the ribbon with his usual under it on one side and the night card with the
  // shape of his nights on the other (two columns of about the same height), then the trends
  // across the foot as a grid. Anywhere else: the order it always had.
  const rib = ribbon(iso, cw, tab ? Math.floor((cw + 20) / 2) : null);
  const night = `<div class="sl-nightbox" data-sl-night>${duskCard(iso)}</div>`;
  const ranges = `<div data-sl-ranges>${rangeRows(iso)}</div>`;
  const grid = tab
    ? `<div class="sl-grid">
      <div class="sl-col">${rib}${ranges}</div>
      <div class="sl-col">${night}${nightsShape(nights)}</div>
    </div>
    ${trends()}`
    : `<div class="sl-grid">
      <div class="sl-col">
        ${rib}
        ${night}
      </div>
      <div class="sl-col">
        ${ranges}
        ${trends()}
      </div>
    </div>`;
  return `<div class="stack rc rc3 sl${wide ? ' sl-wide' : ''}${tab ? ' sl-tab' : ''}" data-sl data-rc-wide="${wide ? '1' : '0'}" data-sl-tab="${tab ? '1' : '0'}">
    ${grid}
    ${doseSection()}
    ${tab ? '' : nightsShape(nights)}
    ${wide ? rangeBar(range, nights) : ''}
    ${wide ? (tab ? `<div class="sl-long">${longView(nights, Math.floor(cw / (cw >= 950 ? 3 : 2)) - 8)}</div>` : longView(nights, cw)) : ''}
    ${wide ? placeSection(nights) : ''}
    ${wide ? loadSection(nights, cw) : ''}
    ${foot()}
  </div>`;
}

function emptyPage() {
  return `<div class="stack sl"><div class="sl-empty">
    <span class="sl-emptyglyph">${G.moon}</span>
    <b>No ring nights yet</b>
    <span>They arrive from the Mac by themselves.</span>
  </div></div>`;
}

// --------------------------------------------------------------- ribbon -----
function ribbon(iso, cw, colW = null) {
  const days = windowDays(iso);
  const slots = days.map((d) => ({ day: d, n: nightFor(d), evening: shiftIso(d, -1) }));
  const have = slots.filter((s) => s.n && bedHour(s.n) != null);
  const beds = have.map((s) => bedHour(s.n));
  const wakes = have.map((s) => wakeHour(s.n)).filter((x) => x != null);
  let lo = beds.length ? Math.min(...beds) : 22;
  let hi = wakes.length ? Math.max(...wakes) : 32;
  lo = Math.floor(lo - 0.4);
  hi = Math.ceil(hi + 0.2);
  if (hi - lo < 8) hi = lo + 8;
  // On the iPad the ribbon has its own column: drawn at that width (a wider drawing scaled down
  // would shrink every label) and a little taller, since it shares the row with the night card.
  const W = Math.max(280, (colW ?? Math.min(cw, 560)) - 28);
  const padL = 36;
  const padR = 4;
  const PH = colW ? 150 : 112;
  const top = 10;
  const slotW = (W - padL - padR) / RIB_NIGHTS;
  const capW = Math.min(15, slotW * 0.58);
  const y = (h) => top + ((h - lo) / (hi - lo)) * PH;
  const cx = (i) => padL + slotW * (i + 0.5);
  const step = hi - lo > 9 ? 4 : 2;
  const ticks = [];
  for (let h = Math.ceil(lo / step) * step; h <= hi; h += step) ticks.push(h);
  const medBed = ringMedian(beds);
  const life = lifeByEvening();
  const pid = `slr${Math.random().toString(36).slice(2, 7)}`;
  const selI = slots.findIndex((s) => s.day === iso);

  const caps = slots.map((s, i) => {
    const x = cx(i) - capW / 2;
    if (!s.n || bedHour(s.n) == null) {
      // No ring data: a calm dashed capsule where a night would sit. Never red.
      const b = medBed != null ? medBed : lo + 1;
      return `<rect class="sl-miss" x="${x.toFixed(1)}" y="${y(b).toFixed(1)}" width="${capW.toFixed(1)}"
        height="${(y(b + SLEEP_TARGET_H) - y(b)).toFixed(1)}" rx="${(capW / 2).toFixed(1)}"/>`;
    }
    const n = s.n;
    const b = bedHour(n);
    const e = wakeHour(n) ?? b + (n.sleepH || 0);
    const runs = phaseRuns(n);
    const away = awayNight(n);
    const y0 = y(b);
    const y1 = y(e);
    const r = capW / 2;
    // Asleep: every stretch that is not awake, joined when the gap between them is short.
    const solid = [];
    if (runs) {
      for (const run of runs) {
        if (run.id === 'awake') continue;
        const a = b + run.from / 60;
        const z = b + run.to / 60;
        const last = solid[solid.length - 1];
        if (last && a - last[1] < 0.09) last[1] = z; else solid.push([a, z]);
      }
    } else if (Number.isFinite(n.sleepH)) solid.push([b, b + n.sleepH]);
    return `<g class="sl-cap${away ? ' away' : ''}${n.restMode ? ' rest' : ''}" data-i="${i}">
      <clipPath id="${pid}c${i}"><rect x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${capW.toFixed(1)}" height="${Math.max(capW, y1 - y0).toFixed(1)}" rx="${r.toFixed(1)}"/></clipPath>
      <rect class="sl-bed" x="${x.toFixed(1)}" y="${y0.toFixed(1)}" width="${capW.toFixed(1)}" height="${Math.max(capW, y1 - y0).toFixed(1)}" rx="${r.toFixed(1)}"/>
      <g clip-path="url(#${pid}c${i})">${solid.map(([a, z]) => `<rect class="sl-asleep" x="${x.toFixed(1)}" y="${y(a).toFixed(1)}" width="${capW.toFixed(1)}" height="${Math.max(1, y(z) - y(a)).toFixed(1)}"/>`).join('')}</g>
      <rect class="sl-sel" x="${(x - 3).toFixed(1)}" y="${(y0 - 3).toFixed(1)}" width="${(capW + 6).toFixed(1)}" height="${(Math.max(capW, y1 - y0) + 6).toFixed(1)}" rx="${(r + 3).toFixed(1)}"/>
      ${n.est ? `<circle class="sl-estdot" cx="${cx(i).toFixed(1)}" cy="${(y0 - 7).toFixed(1)}" r="2.6"/>` : ''}
    </g>`;
  }).join('');

  const letters = slots.map((s, i) => {
    const kinds = [...(life[s.evening] || [])];
    if (s.n && awayNight(s.n)) kinds.push('away');
    const label = `${weekdayOf(s.evening)} night${kinds.length ? `, ${kinds.map((k) => LIFE_WORD[k]).join(', ')}` : ''}`;
    return `<span class="sl-day${i === selI ? ' on' : ''}${s.n ? '' : ' none'}" data-i="${i}" aria-label="${esc(label)}">
      <b>${esc(weekdayOf(s.evening, true).slice(0, 1))}</b>
      <span class="sl-life">${kinds.slice(0, 2).map((k) => `<i class="sl-g ${k}" title="${esc(LIFE_WORD[k])}">${G[k]}</i>`).join('')}</span>
    </span>`;
  }).join('');

  const swing = steadiness(STEADY_WINDOW, days[days.length - 1]);
  const owed = owedThrough(iso);
  const first = days[0];
  const last = days[days.length - 1];
  const latestPage = last >= (lastNight() || {}).day;
  const missNow = !nightFor(last) && last === endDay() && lastNight();
  const payload = { days: slots.map((s) => (s.n && bedHour(s.n) != null ? s.day : null)), padL, slotW, W };
  return `<section class="sl-rib" data-sl-rib='${esc(JSON.stringify(payload))}' aria-label="Your last ${RIB_NIGHTS} nights">
    <div class="sl-ribhead">
      <button type="button" class="sl-lever${swing && swing.hours <= 1 ? ' met' : ''}" data-sl-lever="swing">
        <span class="sl-levlab">Bedtime swing</span>
        <b>${swing ? `${esc(String(round(swing.hours, 1)))}<i>h</i>` : '<i>not yet</i>'}${swing && swing.hours <= 1 ? `<span class="sl-met">${G.check}</span>` : ''}</b>
      </button>
      <span class="sl-ribrange">${esc(fmtDateShort(first))} to ${esc(fmtDateShort(last))}${latestPage ? '' : `<button type="button" class="sl-glass sl-latest" data-sl-go="${esc((lastNight() || {}).day || '')}">Latest</button>`}</span>
      <button type="button" class="sl-lever end${owed && owed.hours <= 1 ? ' met' : ''}" data-sl-lever="owed">
        <span class="sl-levlab">Sleep owed</span>
        <b data-sl-owed>${owed ? `${esc(String(round(owed.hours, 1)))}<i>h</i>` : '<i>not yet</i>'}${owed && owed.hours <= 1 ? `<span class="sl-met">${G.check}</span>` : ''}</b>
      </button>
    </div>
    <div class="sl-ribplot" data-sl-ribplot>
      <svg viewBox="0 0 ${W.toFixed(0)} ${(PH + top + 4).toFixed(0)}" width="100%" role="img"
        aria-label="Bedtime and wake time for each night, with your median bedtime">
        ${ticks.map((h) => `<g class="sl-tick"><line x1="${padL - 4}" x2="${W - padR}" y1="${y(h).toFixed(1)}" y2="${y(h).toFixed(1)}"/>
          <text x="${padL - 8}" y="${(y(h) + 3.8).toFixed(1)}" text-anchor="end">${esc(clockH(h, true))}</text></g>`).join('')}
        ${medBed != null ? `<rect class="sl-medband" x="${padL}" width="${(W - padL - padR).toFixed(1)}" y="${y(Math.max(lo, medBed - 1)).toFixed(1)}" height="${(y(Math.min(hi, medBed + 1)) - y(Math.max(lo, medBed - 1))).toFixed(1)}" rx="4"/>
          <line class="sl-medline" x1="${padL}" x2="${W - padR}" y1="${y(medBed).toFixed(1)}" y2="${y(medBed).toFixed(1)}"/>` : ''}
        ${caps}
      </svg>
      <div class="sl-days" style="padding-left:${(padL / W * 100).toFixed(2)}%;padding-right:${(padR / W * 100).toFixed(2)}%">${letters}</div>
      <div class="sl-owedrow" style="padding-left:${(padL / W * 100).toFixed(2)}%;padding-right:${(padR / W * 100).toFixed(2)}%" aria-hidden="true"><span class="sl-owedin"><span class="sl-bracket" data-sl-bracket></span></span></div>
    </div>
    ${missNow ? `<div class="sl-missline">No ring data since ${esc(weekdayOf((lastNight() || {}).day))}</div>` : ''}
  </section>`;
}

// ----------------------------------------------------------- dusk card -----
// The sky's colour at a clock hour: indigo through the night, lilac at dawn, daylight blue
// for a late wake, dusk violet in the evening. Colour here is the CLOCK, never a verdict.
const SKY = [
  [0, [34, 38, 84]], [3, [35, 40, 88]], [5, [46, 54, 104]], [6, [70, 68, 128]], [7, [92, 82, 146]],
  [8, [66, 92, 152]], [10, [58, 104, 172]], [13, [62, 116, 184]], [17, [78, 90, 152]],
  [19, [72, 70, 132]], [21, [48, 52, 106]], [24, [34, 38, 84]],
];
function skyAt(h) {
  const t = ((h % 24) + 24) % 24;
  for (let i = 1; i < SKY.length; i++) {
    const [h1, c1] = SKY[i];
    const [h0, c0] = SKY[i - 1];
    if (t <= h1) {
      const k = (t - h0) / (h1 - h0 || 1);
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')})`;
    }
  }
  return 'rgb(34,38,84)';
}
function skyGradient(n) {
  const b = bedHour(n);
  const total = nightMinutes(n) / 60;
  if (b == null || !total) return '';
  const stops = [];
  for (let k = 0; k <= 12; k++) {
    const f = k / 12;
    stops.push(`${skyAt(b + total * f)} ${(f * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function usualStages(iso) {
  const ns = recentNights(USUAL_NIGHTS, iso).filter((n) => n.phases && n.day !== iso);
  const out = {};
  for (const sg of STAGES) out[sg.id] = middleHalf(ns.map((n) => (stageMinutes(n) || {})[sg.id]), 6);
  return out;
}

/** An older night named once: "Mon night into Tue, Sep 29" (the date is the morning it ended). */
function spanDated(n) {
  const sp = nightSpan(n, true);
  return `${sp.includes(' night into ') ? sp.replace(/ morning$/, '') : sp}, ${fmtDateShort(n.day)}`;
}

function duskCard(iso) {
  const n = iso ? nightFor(iso) : null;
  if (!n) return '';
  const runs = phaseRuns(n) || [];
  const total = nightMinutes(n);
  const st = stageMinutes(n) || { awake: 0, rem: 0, light: 0, deep: 0 };
  const asleepH = Number.isFinite(n.sleepH) ? n.sleepH : ((st.rem + st.light + st.deep) / 60);
  const { h, m } = hmParts(asleepH);
  // "Last night" only for the ring's latest night that ended this morning, the same rule as
  // Today's sleep chip (round 3 consistency pass): a stale sync never passes for last night;
  // an older night is named by its date and its span.
  const isLatest = n.day === (lastNight() || {}).day
    && String(n.bedEnd || n.day || '').slice(0, 10) === toIso(new Date());
  const life = lifeByEvening()[shiftIso(n.day, -1)] || new Set();
  const kinds = [...life];
  if (awayNight(n)) kinds.push('away');
  // Against his own last 30 nights (Oura's measured figure on a corrected night).
  const usual = ringMedian(recentNights(USUAL_NIGHTS, n.day).filter((x) => x.day !== n.day).map((x) => ouraValue(x, 'sleepH')));
  const d = usual == null ? null : asleepH - usual;
  const chip = d == null ? ''
    : Math.abs(d) < 1 / 60 ? '<span class="sl-chip">your usual</span>'
      : `<span class="sl-chip">${d > 0 ? G.up : G.down}${esc(mins(Math.abs(d) * 60))} ${d > 0 ? 'over' : 'under'} your usual</span>`;
  const est = isEstimate(n, 'sleepH');
  const W = 1000;
  const H = 120;
  const LANE = H / 4;
  const x = (mm) => (mm / Math.max(1, total)) * W;
  const estFrom = n.est && n.oura && n.oura.phasesLen ? n.oura.phasesLen * 5 : null;
  const mv = movementLevels(n);
  const usualSt = usualStages(n.day);
  // The clock times sit on the axis ends under the hypnogram; the sentence names them only
  // when there is no hypnogram to carry them (PSP-13).
  const bedLine = n.bed && !runs.length ? `In bed ${mins(inBedMinutes(n))}, ${clock(n.bed)} to ${clock(n.bedEnd)}` : `In bed ${mins(inBedMinutes(n))}`;
  const scrub = scrubData(n, runs, total, mv, estFrom);
  return `<section class="sl-dusk" data-sl-card aria-label="${esc(isLatest ? 'Last night' : nightSpan(n))}">
    <div class="sl-dhead">
      ${isLatest ? '<span class="sl-when">Last night</span>' : ''}
      <span class="sl-span">${esc(isLatest ? nightSpan(n) : spanDated(n))}</span>
      ${kinds.length || n.restMode ? `<span class="sl-lifechips">${kinds.map((k) => `<span class="sl-lchip">${G[k]}${esc(LIFE_WORD[k])}</span>`).join('')}${n.restMode ? '<span class="sl-lchip">Rest mode</span>' : ''}</span>` : ''}
    </div>
    <div class="sl-hero" aria-label="Time asleep ${h} hours ${m} minutes">
      <b class="sl-big" data-sl-big data-h="${h}" data-m="${m}"><span data-sl-h>${h}</span><i>h</i> <span data-sl-m>${String(m).padStart(2, '0')}</span><i>m</i></b>
      <span class="sl-herosub">${est ? '<span class="sl-tag est">Estimate</span>' : ''}${chip}</span>
      ${est ? `<span class="sl-oura">Oura ${esc(hm(n.oura.sleepH))}${n.est.back ? `, back to sleep ${esc(clock(`T${n.est.back}`))}` : ''}</span>` : ''}
    </div>
    <div class="sl-read" data-sl-read aria-live="polite"><span data-sl-readdef>${esc(bedLine)}</span></div>
    ${runs.length ? `<div class="sl-hypbox" data-sl-scrub='${esc(JSON.stringify(scrub))}'>
      <div class="sl-sky" style="background:${esc(skyGradient(n))}"></div>
      <svg class="sl-hyp sl-draw" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Sleep stages across the night">
        ${[1, 2, 3].map((k) => `<line class="sl-lane" x1="0" x2="${W}" y1="${k * LANE}" y2="${k * LANE}"/>`).join('')}
        ${runs.map((r, i) => {
          const p = runs[i - 1];
          const w = Math.max(1.5, x(r.to) - x(r.from));
          return `${p ? `<line class="sl-link" x1="${x(r.from).toFixed(1)}" x2="${x(r.from).toFixed(1)}" y1="${(Math.min(p.lane, r.lane) * LANE + LANE / 2).toFixed(1)}" y2="${(Math.max(p.lane, r.lane) * LANE + LANE / 2).toFixed(1)}"/>` : ''}
            <rect class="sl-h ${r.id}${estFrom != null && r.from >= estFrom ? ' est' : ''}" data-ri="${i}" x="${x(r.from).toFixed(1)}" y="${(r.lane * LANE + LANE * 0.14).toFixed(1)}" width="${w.toFixed(1)}" height="${(LANE * 0.72).toFixed(1)}" rx="3"/>`;
        }).join('')}
        ${estFrom != null ? `<line class="sl-estl" x1="${x(estFrom).toFixed(1)}" x2="${x(estFrom).toFixed(1)}" y1="0" y2="${H}"/>` : ''}
      </svg>
      ${mv ? `<svg class="sl-mv" viewBox="0 0 ${W} 16" preserveAspectRatio="none" aria-hidden="true">${mv.map((v, i) => (v > 1 ? `<rect x="${((i / mv.length) * W).toFixed(1)}" y="${(16 - v * 3.6).toFixed(1)}" width="1.8" height="${(v * 3.6).toFixed(1)}"/>` : '')).join('')}</svg>` : ''}
      <span class="sl-cur" aria-hidden="true"></span>
    </div>
    ${timeAxis(n, total)}` : ''}
    <div class="sl-stages">
      ${STAGES.map((sg) => stageRow(sg, st[sg.id] || 0, usualSt[sg.id])).join('')}
    </div>
  </section>`;
}

function stageRow(sg, m, u) {
  const max = Math.max(m, u ? u.hi * 1.3 : 0, 30);
  const pc = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  return `<button type="button" class="sl-stage ${sg.id}" data-sl-stage="${sg.id}">
    <span class="sl-sname"><i class="sl-sw ${sg.id}"></i>${esc(sg.label)}</span>
    <span class="sl-strack">
      <i class="sl-sfill" style="width:${pc(m)}"></i>
      ${u ? `<i class="sl-sbr" style="left:${pc(u.lo)};width:calc(${pc(u.hi)} - ${pc(u.lo)})"></i><i class="sl-smid" style="left:${pc(u.mid)}"></i>` : ''}
    </span>
    <span class="sl-sval"><b>${esc(mins(m))}</b>${u ? `<small>usual ${esc(mins(u.mid))}</small>` : ''}</span>
  </button>`;
}

/** What the hypnogram says under a finger: each stretch with its clock and movement. */
function scrubData(n, runs, total, mv, estFrom) {
  const m0 = /T(\d{2}):(\d{2})/.exec(n.bed || '');
  const bedMin = m0 ? Number(m0[1]) * 60 + Number(m0[2]) : null;
  const at = (mm) => (bedMin == null ? '' : clockH((bedMin + mm) / 60));
  return {
    total,
    bedMin,
    runs: runs.map((r) => {
      let move = '';
      if (mv && r.id !== 'awake') {
        const seg = mv.slice(r.from * 2, r.to * 2).filter((v) => v > 0);
        if (seg.length) {
          const avg = seg.reduce((a, b) => a + b, 0) / seg.length;
          move = avg < 1.25 ? 'Still' : avg < 1.8 ? 'Some movement' : 'Restless';
        }
      }
      return { id: r.id, label: r.label, from: r.from, to: r.to, t0: at(r.from), t1: at(r.to),
        len: mins(r.to - r.from), move, est: estFrom != null && r.from >= estFrom ? 1 : 0 };
    }),
  };
}

/** Hour marks on the night's own clock (the offset in its bedtime string), on a solid strip. */
function timeAxis(n, total) {
  if (!n.bed || !total) return '';
  const b = bedHour(n);
  const marks = [];
  for (let hh = Math.ceil(b + 0.35); hh < b + total / 60 - 0.35; hh++) {
    if ((hh - Math.ceil(b)) % 2) continue;
    marks.push({ pct: ((hh - b) * 60 / total) * 100, label: clockH(hh, true) });
  }
  return `<div class="sl-axis" aria-hidden="true">
    <span class="sl-tstart">${esc(clock(n.bed))}</span>
    ${marks.filter((m) => m.pct > 14 && m.pct < 86).map((m) => `<span class="sl-hour" style="left:${m.pct.toFixed(1)}%">${esc(m.label)}</span>`).join('')}
    <span class="sl-tend">${esc(clock(n.bedEnd))}</span>
  </div>`;
}

// ------------------------------------------------------- against your usual -----
const RANGE = [
  { k: 'sleepScore', label: 'Sleep score', icon: 'stars', unit: '', nd: 0, scored: true },
  { k: 'readiness', label: 'Readiness', icon: 'bolt', unit: '', nd: 0, scored: true },
  { k: 'hrv', label: 'HRV', icon: 'wave', unit: 'ms', nd: 0 },
  { k: 'lowestHr', label: 'Lowest heart rate', icon: 'heart', unit: 'bpm', nd: 0 },
  { k: 'tempDev', label: 'Temperature', icon: 'temp', unit: '°F', nd: 1, conv: (v) => v * 1.8, signed: true },
  { k: 'breath', label: 'Breathing', icon: 'lungs', unit: '/min', nd: 1 },
];

/** His middle half of one field over the 30 nights before `iso` (rest mode out of scored ones). */
function usualOf(row, iso) {
  const conv = row.conv || ((v) => v);
  const ns = recentNights(USUAL_NIGHTS + 1, iso).filter((x) => x.day !== iso && !(row.scored && x.restMode));
  return middleHalf(ns.map((x) => { const v = ouraValue(x, row.k); return Number.isFinite(v) ? conv(v) : NaN; }));
}

const fmtV = (row, v) => {
  const s = String(round(v, row.nd));
  return row.signed && v > 0 ? `+${s}` : s;
};

function rangeRows(iso) {
  const n = iso ? nightFor(iso) : null;
  if (!n) return '';
  const rows = RANGE.filter((r) => Number.isFinite(n[r.k])).map((r) => {
    const conv = r.conv || ((v) => v);
    const v = conv(n[r.k]);
    const u = usualOf(r, iso);
    const est = isEstimate(n, r.k);
    if (!u) {
      return `<button type="button" class="sl-rr" data-sl-metric="${r.k}">
        <span class="sl-rbadge">${G[r.icon]}</span>
        <span class="sl-rname">${esc(r.label)}</span>
        ${est ? '<small class="sl-rout">estimate</small>' : ''}
        <span class="sl-rval"><b>${esc(fmtV(r, v))}<i>${esc(r.unit)}</i></b></span>
      </button>`;
    }
    const spread = Math.max(u.hi - u.lo, Math.abs(u.mid) * 0.04, r.nd ? 0.2 : 1);
    const a = Math.min(u.lo - spread * 0.9, v - spread * 0.25);
    const z = Math.max(u.hi + spread * 0.9, v + spread * 0.25);
    const pc = (x) => `${(((x - a) / (z - a)) * 100).toFixed(1)}%`;
    const outside = v < u.lo || v > u.hi;
    const diff = v - u.mid;
    const flat = Math.abs(diff) < (r.nd ? 0.05 : 0.5);
    const oura = est ? conv(n.oura[r.k]) : null;
    return `<button type="button" class="sl-rr${outside ? ' out' : ''}" data-sl-metric="${r.k}"
        aria-label="${esc(`${r.label} ${fmtV(r, v)} ${r.unit}. Your middle half ${fmtV(r, u.lo)} to ${fmtV(r, u.hi)}.${outside ? ' Outside your usual.' : ''} Open the long view`)}">
      <span class="sl-rbadge">${G[r.icon]}</span>
      <span class="sl-rname">${esc(r.label)}</span>
      <span class="sl-rval"><b>${esc(fmtV(r, v))}<i>${esc(r.unit)}</i></b></span>
      <span class="sl-rcap" aria-hidden="true">
        <i class="sl-rband" style="left:${pc(u.lo)};width:calc(${pc(u.hi)} - ${pc(u.lo)})"></i>
        <i class="sl-rmid" style="left:${pc(u.mid)}"></i>
        <i class="sl-rdot${outside ? ' ring' : ''}" style="left:${pc(v)}"></i>
      </span>
      <small class="sl-rdel">${flat ? 'level' : `${diff > 0 ? G.up : G.down}${esc(String(round(Math.abs(diff), r.nd)))}`}</small>
      ${est || outside ? `<small class="sl-rout">${est ? `estimate, Oura ${esc(fmtV(r, oura))}` : ''}${outside ? `<b>${est ? ', o' : 'O'}utside your usual</b>` : ''}</small>` : ''}
    </button>`;
  }).join('');
  if (!rows) return '';
  return `<section class="sl-sec sl-ranges">
    <div class="sl-shead"><h2>Against your usual</h2><span class="sl-count">last ${USUAL_NIGHTS} nights</span></div>
    <div class="sl-rlist">${rows}</div>
  </section>`;
}

// --------------------------------------------------------------- trends -----
const TRENDS = [
  { k: 'sleepH', label: 'Time asleep', fmt: (v) => hm(v), open: 'sleepH' },
  { k: 'bed', label: 'Bedtime', fmt: (v) => clockH(v), get: (n) => bedHour(n), invert: true },
  { k: 'hrv', label: 'HRV', fmt: (v) => `${round(v, 0)} ms`, open: 'hrv' },
  { k: 'lowestHr', label: 'Lowest heart rate', fmt: (v) => `${round(v, 0)} bpm`, open: 'lowestHr' },
];
const mondayOf = (iso) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toIso(d); };

function trendWeeks() {
  const last = lastNight();
  if (!last) return [];
  const end = mondayOf(last.day);
  const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => shiftIso(end, -7 * (TREND_WEEKS - 1 - i)));
  const byWeek = {};
  for (const n of ringNights()) {
    if (n.day < weeks[0]) continue;
    (byWeek[mondayOf(n.day)] ||= []).push(n);
  }
  return weeks.map((w) => ({ week: w, nights: byWeek[w] || [] }));
}

function trends() {
  const weeks = trendWeeks();
  if (weeks.filter((w) => w.nights.length).length < 4) return '';
  const W = 200;
  const H = 40;
  const rows = TRENDS.map((t) => {
    const get = t.get || ((n) => ouraValue(n, t.k));
    const vals = weeks.map((w) => ringMedian(w.nights.map(get)));
    const fin = vals.filter(Number.isFinite);
    if (fin.length < 4) return '';
    const lo = Math.min(...fin);
    const hi = Math.max(...fin);
    const pad = (hi - lo) * 0.18 || 0.5;
    const X = (i) => (i / (weeks.length - 1)) * W;
    const Y = (v) => {
      const f = (v - (lo - pad)) / ((hi + pad) - (lo - pad));
      return t.invert ? 3 + f * (H - 6) : H - 3 - f * (H - 6);
    };
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
      pen = true;
    });
    const band = middleHalf(fin, 4);
    const lastI = vals.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0).pop();
    const firstI = vals.findIndex(Number.isFinite);
    const labels = vals.map((v) => (Number.isFinite(v) ? t.fmt(v) : ''));
    const bandY = band ? [Y(band.lo), Y(band.hi)].sort((p, q) => p - q) : null;
    return `<${t.open ? 'button type="button"' : 'div'} class="sl-trow" ${t.open ? `data-sl-metric="${t.open}"` : ''} data-sl-vals='${esc(JSON.stringify(labels))}'>
      <span class="sl-tname">${esc(t.label)}</span>
      <span class="sl-tthen"><small>${esc(fmtDateShort(weeks[firstI].week))}</small>${esc(labels[firstI])}</span>
      <svg class="sl-tsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${bandY ? `<rect class="sl-tband" x="0" width="${W}" y="${bandY[0].toFixed(1)}" height="${Math.max(1, bandY[1] - bandY[0]).toFixed(1)}"/>` : ''}
        <path class="sl-tline" d="${d.trim()}"/>
        <path class="sl-tnow" d="M${X(lastI).toFixed(1)} ${Y(vals[lastI]).toFixed(1)}l0 0"/>
      </svg>
      <b class="sl-tv" data-sl-tv data-def="${esc(labels[lastI])}">${esc(labels[lastI])}</b>
    </${t.open ? 'button' : 'div'}>`;
  }).join('');
  const weekLabels = weeks.map((w) => `Week of ${fmtDateShort(w.week)}`);
  return `<section class="sl-sec sl-trends" data-sl-trends='${esc(JSON.stringify(weekLabels))}'>
    <div class="sl-shead"><h2>Trends</h2><span class="sl-count" data-sl-tweek data-def="${TREND_WEEKS} weeks, each its middle night">${TREND_WEEKS} weeks, each its middle night</span></div>
    <div class="sl-tlist" data-sl-tlist>${rows}<span class="sl-tcur" aria-hidden="true"></span></div>
  </section>`;
}

// ------------------------------------------------------------ your nights -----
/**
 * How long his nights run, and what a typical one is made of: five columns of nights by
 * length (the 7 hour line between two of them) and the median night by stage in the dusk
 * card's own stage colours, the words on a legend under it, never inside the bar.
 */
function nightsShape(nights) {
  const hs = nights.map((n) => ouraValue(n, 'sleepH')).filter(Number.isFinite);
  if (hs.length < 8) return '';
  const bins = [
    { lab: 'under 5h', test: (x) => x < 5 },
    { lab: '5 to 6h', test: (x) => x >= 5 && x < 6 },
    { lab: '6 to 7h', test: (x) => x >= 6 && x < 7 },
    { lab: '7 to 8h', test: (x) => x >= 7 && x < 8, at: true },
    { lab: '8h or more', test: (x) => x >= 8, at: true },
  ].map((b) => ({ ...b, n: hs.filter(b.test).length }));
  const top = Math.max(...bins.map((b) => b.n)) || 1;
  const med = ringMedian(hs);
  const deep = ringMedian(nights.map((n) => n.deepH));
  const rem = ringMedian(nights.map((n) => ouraValue(n, 'remH')));
  const awake = ringMedian(nights.map((n) => ouraValue(n, 'awakeH')));
  const light = med != null && deep != null && rem != null ? Math.max(0, med - deep - rem) : null;
  const parts = light == null ? [] : [
    { id: 'deep', lab: 'Deep', v: deep }, { id: 'light', lab: 'Light', v: light },
    { id: 'rem', lab: 'REM', v: rem }, ...(awake != null ? [{ id: 'awake', lab: 'Awake', v: awake }] : []),
  ];
  return `<section class="sl-sec sl-shape">
    <div class="sl-shead"><h2>Your nights</h2><span class="sl-count">${hs.length} nights, middle ${esc(hm(med))}</span></div>
    <div class="sl-cols" role="img" aria-label="How many nights fall in each length">
      ${bins.map((b, i) => `<div class="sl-colw${b.at ? ' at' : ''}${i === 3 ? ' first7' : ''}">
        <b>${b.n}</b>
        <span class="sl-colbar"><i style="height:${Math.max(3, (b.n / top) * 100).toFixed(1)}%;--i:${i}"></i></span>
        <span class="sl-collab">${esc(b.lab)}</span>
      </div>`).join('')}
    </div>
    ${parts.length ? `<div class="sl-typ">
      <h3>A typical night</h3>
      <span class="sl-typbar">${parts.map((p) => `<i class="${p.id}" style="flex:${p.v.toFixed(3)}"></i>`).join('')}</span>
      <span class="sl-typkey">${parts.map((p) => `<span><i class="sl-sw ${p.id}"></i>${esc(p.lab)}<b>${esc(hm(p.v))}</b></span>`).join('')}</span>
    </div>` : ''}
  </section>`;
}

// ------------------------------------------------------------- dose night -----
function doseSection() {
  const eff = shotNightEffect(Object.values(state.data?.pk?.shots || {}));
  if (!eff) return '';
  const all = [];
  const k = eff.keys;
  if (k.tempDev) all.push({ lab: 'Temperature', word: 'temperature', f: 1.8, unit: '°F', nd: 2, e: k.tempDev });
  if (k.breath) all.push({ lab: 'Breathing', word: 'breathing', f: 1, unit: '/min', nd: 2, e: k.breath });
  if (k.sleepH) all.push({ lab: 'Time asleep', how: 'long', f: 60, unit: 'min', nd: 0, e: k.sleepH });
  if (k.sleepScore) all.push({ lab: 'Sleep score', how: 'well', f: 1, unit: '', nd: 1, e: k.sleepScore });
  if (!all.length) return '';
  const rows = all.map((r) => {
    const v = r.e.diff * r.f;
    const lo = r.e.lo * r.f;
    const hi = r.e.hi * r.f;
    const span = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(v)) * 1.15 || 1;
    const pc = (x) => `${(50 + (x / span) * 48).toFixed(1)}%`;
    return `<div class="sl-dose${r.e.clears ? ' on' : ''}">
      <span class="sl-dlab">${esc(r.lab)}<small>${r.e.clears ? 'moves' : 'no measurable change'}</small></span>
      <span class="sl-dbell" aria-hidden="true">
        <i class="sl-dzero"></i>
        <i class="sl-dci" style="left:${pc(Math.min(lo, hi))};width:calc(${pc(Math.max(lo, hi))} - ${pc(Math.min(lo, hi))})"></i>
        <i class="sl-dbar" style="left:${pc(Math.min(0, v))};width:calc(${pc(Math.max(0, v))} - ${pc(Math.min(0, v))})"></i>
        <i class="sl-dhome"></i>
        <i class="sl-dnow" style="left:${pc(v)}"></i>
      </span>
      <b class="sl-dval">${v >= 0 ? '+' : ''}${esc(String(round(v, r.nd)))}<i>${esc(r.unit)}</i></b>
    </div>`;
  }).join('');
  const moved = all.filter((r) => r.e.clears);
  const same = all.filter((r) => !r.e.clears);
  return `<section class="sl-sec sl-doses">
    <div class="sl-shead"><h2>The night of a dose</h2><span class="sl-count">${eff.cycles} cycles</span></div>
    <div class="sl-dlist">
      <div class="sl-dkey"><span><i class="sl-dhome"></i>Rest of that week</span><span><i class="sl-dnow"></i>First night</span></div>
      ${rows}
    </div>
    <div class="sl-dsay rc-about-src" data-about="The night of a dose">${esc(shotSentence(moved.map((r) => ({ word: r.word, how: r.how })), same.map((r) => ({ word: r.word, how: r.how }))))}</div>
  </section>`;
}

// ---------------------------------------------------------------- foot -----
function foot() {
  const built = ringBuiltAt();
  let when = '';
  if (built) {
    const d = new Date(built);
    const iso = toIso(d);
    const hh = d.getHours();
    const t = `${hh % 12 === 0 ? 12 : hh % 12}:${String(d.getMinutes()).padStart(2, '0')}${hh >= 12 ? '\u00a0PM' : '\u00a0AM'}`;
    when = iso === toIso(new Date()) ? `Ring synced ${t}` : `Ring synced ${fmtDateShort(iso)}, ${t}`;
  }
  return `<div class="sl-foot">
    <span data-sl-synced>${esc(when || 'From the Mac')}</span>
    <button type="button" class="sl-glass sl-sync" data-sl-sync aria-label="Sync ring data">${G.sync}</button>
  </div>
  <div class="rc-about-src" data-about="The ring">${ringNights().length} nights on this device. Read only: nothing here is part of your record, and nothing here is advice. Morning readiness was tested against how your sessions went and predicted neither what you did nor how it went.</div>
  <div class="rc-about-src" data-about="Against your usual">Each band is the middle half of your last ${USUAL_NIGHTS} nights, the tick in it your median, the dot the night on screen. Rest mode nights are left out of the scored ones. On a night you corrected, your estimate is the main figure and Oura's own reading sits beside it; the bands use Oura's readings.</div>
  <div class="rc-about-src" data-about="Bedtime swing">The typical distance of a bedtime from your own pattern (the middle of the ${STEADY_WINDOW} nights before it), over the nights on the ribbon. An hour further off went with about two points less readiness, in both halves of your record.</div>
  <div class="rc-about-src" data-about="Sleep owed">Hours below ${SLEEP_TARGET_H} across the chosen night and the ${DEBT_NIGHTS - 1} before it, bracketed under them on the ribbon. Each hour owed went with a lower readiness score and a slightly higher lowest heart rate.</div>
  <button type="button" class="rc-aboutrow sl-about" data-sl-about>About these numbers<span class="sl-achev">${G.chev}</span></button>`;
}

// ================================================================ binding =====
let outsideFn = null;
let outsideOn = false;

export function bindSleep(root, ctx, rerender) {
  const sl = root.querySelector('[data-sl]');
  if (!sl) return;
  const tick = () => { haptic('selection'); };
  const reduce = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

  // ------- choosing a night: in place when it is on this ribbon, a repaint otherwise ------
  const select = (iso, { animate = true, dir = 0 } = {}) => {
    if (!iso || !nightFor(iso)) return;
    const was = selectedIso(ctx);
    ctx.slNight = iso;
    const rib = sl.querySelector('[data-sl-rib]');
    let data = null;
    try { data = JSON.parse(rib?.dataset.slRib || 'null'); } catch { /* repaint below */ }
    const i = data ? data.days.indexOf(iso) : -1;
    if (i < 0) { rerender(); return; }
    rib.querySelectorAll('.sl-cap').forEach((g) => g.classList.toggle('on', Number(g.dataset.i) === i));
    rib.querySelectorAll('.sl-day').forEach((g) => g.classList.toggle('on', Number(g.dataset.i) === i));
    placeBracket();
    const owed = owedThrough(iso);
    const ow = rib.querySelector('[data-sl-owed]');
    if (ow) ow.innerHTML = owed ? `${esc(String(round(owed.hours, 1)))}<i>h</i>${owed.hours <= 1 ? `<span class="sl-met">${G.check}</span>` : ''}` : '<i>not yet</i>';
    rib.querySelector('[data-sl-lever="owed"]')?.classList.toggle('met', !!owed && owed.hours <= 1);
    const box = sl.querySelector('[data-sl-night]');
    const rng = sl.querySelector('[data-sl-ranges]');
    if (box) box.innerHTML = duskCard(iso);
    if (rng) rng.innerHTML = rangeRows(iso);
    bindNight(animate);
    if (animate && was !== iso) {
      const d = dir || (iso > was ? 1 : -1);
      pageEnter([box?.firstElementChild].filter(Boolean), d, { push: true });
    }
  };

  // ------- the ribbon ------
  const rib = sl.querySelector('[data-sl-rib]');
  const plot = rib?.querySelector('[data-sl-ribplot]');
  const placeBracket = () => {
    const br = rib?.querySelector('[data-sl-bracket]');
    if (!br) return;
    let data = null;
    try { data = JSON.parse(rib.dataset.slRib); } catch { return; }
    const owed = owedThrough(selectedIso(ctx));
    const all = (owed?.days || []).map((d) => windowIndex(d)).filter((x) => x >= 0);
    if (!owed || !all.length) { br.style.display = 'none'; return; }
    br.style.display = '';
    const a = Math.min(...all);
    const b = Math.max(...all);
    br.style.left = `${(a / RIB_NIGHTS) * 100}%`;
    br.style.width = `${((b - a + 1) / RIB_NIGHTS) * 100}%`;
    void data;
  };
  const windowIndex = (d) => {
    try { return JSON.parse(rib.dataset.slRib).days.indexOf(d); } catch { return -1; }
  };
  if (rib && plot) {
    let data = null;
    try { data = JSON.parse(rib.dataset.slRib); } catch { data = null; }
    const selI = data ? data.days.indexOf(selectedIso(ctx)) : -1;
    rib.querySelectorAll('.sl-cap').forEach((g) => g.classList.toggle('on', Number(g.dataset.i) === selI));
    placeBracket();
    // Press and drag along the ribbon: the nearest night under the finger, one tick each.
    const nearest = (clientX) => {
      const b = plot.getBoundingClientRect();
      const scale = b.width / data.W;
      const f = (clientX - b.left) / scale;
      const raw = Math.floor((f - data.padL) / data.slotW);
      const want = Math.max(0, Math.min(RIB_NIGHTS - 1, raw));
      let best = null;
      for (let k = 0; k < RIB_NIGHTS; k++) {
        if (!data.days[k]) continue;
        if (best == null || Math.abs(k - want) < Math.abs(best - want)) best = k;
      }
      return best;
    };
    let down = null;
    let moved = false;
    plot.addEventListener('pointerdown', (e) => {
      if (!data) return;
      down = { x: e.clientX, y: e.clientY, i: nearest(e.clientX) };
      moved = false;
      try { plot.setPointerCapture(e.pointerId); } catch { /* old WebKit */ }
    });
    plot.addEventListener('pointermove', (e) => {
      if (!down) return;
      if (!moved && Math.abs(e.clientX - down.x) < 6) return;
      moved = true;
      const k = nearest(e.clientX);
      const iso = data.days[k];
      if (iso && iso !== selectedIso(ctx)) { tick(); select(iso, { animate: false }); }
    });
    const up = (e) => {
      if (!down) return;
      const wasTap = !moved;
      down = null;
      if (wasTap && e.type === 'pointerup') {
        const iso = data.days[nearest(e.clientX)];
        if (iso && iso !== selectedIso(ctx)) { tick(); select(iso); }
      } else if (moved) {
        // Lifting the finger settles the card: the hypnogram draws the chosen night in.
        const svg = sl.querySelector('.sl-hyp');
        if (svg && !reduce()) { svg.classList.remove('sl-draw'); void svg.getBoundingClientRect(); svg.classList.add('sl-draw'); }
      }
    };
    plot.addEventListener('pointerup', up);
    plot.addEventListener('pointercancel', up);
    plot.style.touchAction = 'pan-y';
  }
  sl.querySelectorAll('[data-sl-go]').forEach((b) => b.addEventListener('click', () => {
    ctx.slNight = b.dataset.slGo;
    rerender();
  }));
  sl.querySelectorAll('[data-sl-lever]').forEach((b) => b.addEventListener('click', () => openLever(b.dataset.slLever, selectedIso(ctx))));

  // ------- the night (card and range rows): rebound after every change ------
  const bindNight = (animate) => {
    const card = sl.querySelector('[data-sl-card]');
    if (!card) return;
    if (animate) {
      const big = card.querySelector('[data-sl-big]');
      const hEl = card.querySelector('[data-sl-h]');
      const mEl = card.querySelector('[data-sl-m]');
      if (big && hEl && mEl && !reduce()) {
        const H = Number(big.dataset.h);
        const M = Number(big.dataset.m);
        hEl.textContent = '0';
        mEl.textContent = '0';
        countUp(hEl, 0, H);
        countUp(mEl, 0, M, { onDone: () => { mEl.textContent = String(M).padStart(2, '0'); } });
      }
    } else {
      card.querySelector('.sl-hyp')?.classList.remove('sl-draw');
    }
    bindScrub(card, tick);
    // Swipe the card sideways: the night before or after, across the whole record.
    let sx = null;
    card.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-sl-scrub], .sl-stage')) { sx = null; return; }
      sx = { x: e.clientX, y: e.clientY };
    });
    card.addEventListener('pointerup', (e) => {
      if (!sx) return;
      const dx = e.clientX - sx.x;
      const dy = e.clientY - sx.y;
      sx = null;
      if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx) * 0.7) return;
      const to = stepNight(selectedIso(ctx), dx < 0 ? 1 : -1);
      if (to) { tick(); select(to.day, { dir: dx < 0 ? 1 : -1 }); }
    });
    card.style.touchAction = 'pan-y';
    sl.querySelectorAll('[data-sl-ranges] [data-sl-metric]').forEach((b) => b.addEventListener('click', () => openLong(b.dataset.slMetric, b)));
    requestAnimationFrame(() => fitAxisSl(sl));
  };
  bindNight(true);

  // ------- trends: one finger across every row ------
  bindTrends(sl, tick);
  sl.querySelectorAll('.sl-trends [data-sl-metric]').forEach((b) => b.addEventListener('click', (e) => {
    if (b.dataset.slDragged === '1') { b.dataset.slDragged = ''; e.preventDefault(); return; }
    openLong(b.dataset.slMetric, b);
  }));

  // ------- the v3 sections below the fold, and the foot ------
  sl.querySelectorAll('[data-rc-range]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('rehab.recovery.range', b.dataset.rcRange); } catch { /* per device */ }
    rerender();
  }));
  const sync = sl.querySelector('[data-sl-sync]');
  sync?.addEventListener('click', async () => {
    const when = sl.querySelector('[data-sl-synced]');
    const back = when ? when.textContent : '';
    const say = (t) => { if (when) when.textContent = t; };
    sync.disabled = true;
    say(SERVER_MODE ? 'Asking Oura' : 'Checking');
    try {
      const out = await syncRing();
      if (!out.ok) { say(back); toast(`<b>Could not sync</b><br><span>${esc(out.message)}</span>`, 'warn'); return; }
      if (out.message) toast(`<b>Some of it did not come back</b><br><span>${esc(out.message)}</span>`, 'warn');
      else { const w = syncWords(out); toast(`<b>${esc(w.title)}</b><br><span>${esc(w.body)}</span>`); }
      if (out.asked && !out.changed) {
        waitForMac((day) => { toast(`<b>Ring updated</b><br><span>Newest night ${esc(fmtDateShort(day))}.</span>`); rerender(); });
      }
      rerender();
    } finally {
      sync.disabled = false;
    }
  });
  sl.querySelector('[data-sl-about]')?.addEventListener('click', () => {
    const bits = [...sl.querySelectorAll('.rc-about-src')].map((n) => `<div class="rc-aboutbit">${n.dataset.about ? `<b>${esc(n.dataset.about)}</b>` : ''}<p>${esc(n.textContent.replace(/\s+/g, ' ').trim())}</p></div>`);
    sheet({ title: 'About these numbers', body: `<div class="rc-about">${bits.join('')}</div>` });
  });

  // Width: redraw once if the layout decision flips (the same check the v3 page ran).
  const drawn = sl.dataset.rcWide === '1';
  const drawnTab = sl.dataset.slTab === '1';
  const check = () => {
    const el = document.getElementById('view');
    if (!el || !el.clientWidth || !document.body.contains(sl)) return;
    if ((el.clientWidth - 76 >= WIDE_AT) !== drawn || isTab(el.clientWidth - 84) !== drawnTab) rerender();
  };
  requestAnimationFrame(() => requestAnimationFrame(() => { check(); fitAxis(sl); fitAxisSl(sl); }));
  const view = document.getElementById('view');
  if (view && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!document.body.contains(sl)) { ro.disconnect(); return; }
      check();
      fitAxisSl(sl);
    });
    ro.observe(view);
  }
}

/** The hypnogram's finger: a cursor, the stretch under it lit, the readout above it swapped. */
function bindScrub(card, tick) {
  const box = card.querySelector('[data-sl-scrub]');
  const read = card.querySelector('[data-sl-read]');
  const def = read ? read.innerHTML : '';
  const rows = [...card.querySelectorAll('[data-sl-stage]')];
  if (!box) return;
  let data;
  try { data = JSON.parse(box.dataset.slScrub); } catch { return; }
  const cur = box.querySelector('.sl-cur');
  const rects = [...box.querySelectorAll('.sl-h')];
  let last = -1;
  let pinned = null;
  const light = (pred) => {
    box.classList.toggle('on', !!pred);
    rects.forEach((el, i) => el.classList.toggle('hot', !!pred && pred(data.runs[i], i)));
  };
  const say = (html) => { if (read) { read.innerHTML = html; read.classList.toggle('live', html !== def); } };
  const restore = () => {
    cur.classList.remove('on');
    light(null);
    rows.forEach((r) => r.classList.remove('sel'));
    say(def);
    last = -1;
    pinned = null;
  };
  const at = (clientX) => {
    const b = box.getBoundingClientRect();
    const px = Math.max(0, Math.min(b.width, clientX - b.left));
    const m = (px / b.width) * data.total;
    let i = data.runs.findIndex((r) => m >= r.from && m < r.to);
    if (i < 0) i = data.runs.length - 1;
    cur.style.left = `${px}px`;
    cur.classList.add('on');
    if (i === last) {
      // Same stretch: only the clock moves.
      const t = read?.querySelector('[data-sl-now]');
      if (t && data.bedMin != null) t.textContent = clockH((data.bedMin + m) / 60);
      return;
    }
    if (last !== -1) tick();
    last = i;
    const r = data.runs[i];
    light((_, j) => j === i);
    rows.forEach((x) => x.classList.toggle('sel', x.dataset.slStage === r.id));
    say(`<span class="sl-rd"><i class="sl-sw ${r.id}"></i><b>${esc(r.label)}</b></span>
      <span data-sl-now>${esc(data.bedMin != null ? clockH((data.bedMin + m) / 60) : '')}</span>
      <span class="sl-rdm">${esc(r.t0)} to ${esc(r.t1)}, ${esc(r.len)}${r.move ? `, ${esc(r.move.toLowerCase())}` : ''}${r.est ? ', estimate' : ''}</span>`);
  };
  box.addEventListener('pointerdown', (e) => {
    pinned = null;
    try { box.setPointerCapture(e.pointerId); } catch { /* old WebKit */ }
    haptic('soft');
    at(e.clientX);
  });
  box.addEventListener('pointermove', (e) => { if (e.buttons || e.pressure > 0 || e.pointerType === 'mouse') at(e.clientX); });
  box.addEventListener('pointerup', () => { if (!pinned) restore(); });
  box.addEventListener('pointercancel', restore);
  box.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pinned) restore(); });
  // A stage row lights every stretch of that stage and says how many; tap again to clear.
  rows.forEach((row) => row.addEventListener('click', () => {
    const id = row.dataset.slStage;
    if (pinned === id) { restore(); return; }
    restore();
    pinned = id;
    rows.forEach((x) => x.classList.toggle('sel', x === row));
    light((r) => r.id === id);
    const mine = data.runs.filter((r) => r.id === id);
    if (!mine.length) return;
    const long = mine.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
    say(`<span class="sl-rd"><i class="sl-sw ${id}"></i><b>${esc(long.label)}</b></span>
      <span class="sl-rdm">${mine.length} ${mine.length === 1 ? 'stretch' : 'stretches'}, longest ${esc(long.len)} from ${esc(long.t0)}</span>`);
  }));
  if (!outsideOn) {
    outsideOn = true;
    document.addEventListener('pointerdown', (e) => outsideFn && outsideFn(e), { passive: true });
  }
  outsideFn = (e) => {
    if (!document.body.contains(box)) return;
    if (!pinned) return;
    if (!box.contains(e.target) && !rows.some((x) => x.contains(e.target))) restore();
  };
}

/** One cursor through every trend row; each row's number becomes that week's. */
function bindTrends(sl, tick) {
  const sec = sl.querySelector('[data-sl-trends]');
  const list = sec?.querySelector('[data-sl-tlist]');
  if (!list) return;
  let weeks;
  try { weeks = JSON.parse(sec.dataset.slTrends); } catch { return; }
  const head = sec.querySelector('[data-sl-tweek]');
  const cur = list.querySelector('.sl-tcur');
  const rows = [...list.querySelectorAll('.sl-trow')].map((r) => {
    let vals = [];
    try { vals = JSON.parse(r.dataset.slVals); } catch { /* none */ }
    return { el: r, v: r.querySelector('[data-sl-tv]'), vals, svg: r.querySelector('.sl-tsvg') };
  });
  if (!rows.length) return;
  let last = -1;
  let start = null;
  let active = false;
  // In a grid (the iPad) the rows are not one above another, so a single line through them all
  // would cross nothing: each row gets its own cursor at the same week, and the finger reads its
  // position from the row it started on. On the phone the one list-wide cursor is kept.
  const grid = () => rows.length > 1 && Math.abs(rows[0].el.offsetLeft - rows[1].el.offsetLeft) > 40;
  let base = rows[0];
  const own = [];
  const at = (clientX) => {
    const b = base.svg.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - b.left) / b.width));
    const i = Math.round(f * (weeks.length - 1));
    if (grid()) {
      rows.forEach((r, k) => {
        const c = own[k] || (own[k] = r.el.appendChild(Object.assign(document.createElement('span'), { className: 'sl-tcur sl-tcur-own', ariaHidden: 'true' })));
        const sb = r.svg.getBoundingClientRect(); const rb = r.el.getBoundingClientRect();
        c.style.left = `${sb.left - rb.left + (i / (weeks.length - 1)) * sb.width}px`;
        c.style.top = `${sb.top - rb.top - 4}px`;
        c.style.height = `${sb.height + 8}px`;
        c.style.bottom = 'auto';
        c.classList.add('on');
      });
    } else {
      const lb = list.getBoundingClientRect();
      cur.style.left = `${b.left - lb.left + (i / (weeks.length - 1)) * b.width}px`;
      cur.classList.add('on');
    }
    if (i === last) return;
    if (last !== -1) tick();
    last = i;
    head.textContent = weeks[i];
    rows.forEach((r) => { if (r.v) r.v.textContent = r.vals[i] || 'no nights'; });
  };
  const restore = () => {
    cur.classList.remove('on');
    own.forEach((c) => c.classList.remove('on'));
    head.textContent = head.dataset.def;
    rows.forEach((r) => { if (r.v) r.v.textContent = r.v.dataset.def; });
    last = -1;
  };
  list.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, target: e.target.closest('.sl-trow') }; active = false; base = rows.find((r) => r.el === start.target) || rows[0]; });
  list.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!active) {
      if (Math.abs(e.clientX - start.x) < 8) return;
      if (Math.abs(e.clientY - start.y) > Math.abs(e.clientX - start.x)) { start = null; return; }
      active = true;
      try { list.setPointerCapture(e.pointerId); } catch { /* old WebKit */ }
    }
    at(e.clientX);
  });
  const end = () => {
    if (active && start?.target) start.target.dataset.slDragged = '1';
    if (active) setTimeout(() => rows.forEach((r) => { r.el.dataset.slDragged = ''; }), 60);
    start = null;
    if (active) restore();
    active = false;
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.style.touchAction = 'pan-y';
}

/** Hide an hour label that would touch the start or end time (measured after paint). */
function fitAxisSl(root) {
  root.querySelectorAll('.sl-axis').forEach((ax) => {
    const hours = [...ax.querySelectorAll('.sl-hour')];
    hours.forEach((h) => { h.style.visibility = ''; });
    const kept = [ax.querySelector('.sl-tstart'), ax.querySelector('.sl-tend')].filter(Boolean).map((e) => e.getBoundingClientRect());
    for (const h of hours) {
      const b = h.getBoundingClientRect();
      if (kept.some((k) => b.left < k.right + 8 && b.right > k.left - 8)) h.style.visibility = 'hidden';
      else kept.push(b);
    }
  });
}

// ------------------------------------------------------------- long views -----
const LONG = {
  sleepH: { title: 'Time asleep', unit: 'h', rule: SLEEP_TARGET_H, nd: 1 },
  sleepScore: { title: 'Sleep score', unit: '', nd: 0, scored: true },
  readiness: { title: 'Readiness', unit: '', nd: 0, scored: true },
  hrv: { title: 'HRV', unit: 'ms', nd: 0 },
  lowestHr: { title: 'Lowest heart rate', unit: 'bpm', nd: 0 },
  tempDev: { title: 'Temperature', unit: '°F', nd: 2, conv: (v) => v * 1.8 },
  breath: { title: 'Breathing', unit: '/min', nd: 1 },
};
const SLEEP_HEX = '#5E5CE6';

/**
 * The long view of one measure: the app's Swift Charts screen when it has one (every night,
 * his middle half as a band, his median and for sleep the 7 hour line, shot nights as marks),
 * else the web sheet recovery.js has always drawn. Nothing is written.
 */
async function openLong(k, el) {
  const m = LONG[k];
  if (!m) return;
  const conv = m.conv || ((v) => v);
  const ns = ringNights().filter((n) => Number.isFinite(ouraValue(n, k)));
  if (!ns.length) return;
  if (isNative()) {
    const pts = ns.map((n) => [Date.parse(`${n.day}T12:00:00`), round(conv(ouraValue(n, k)), 3)]);
    const recent = ns.slice(-USUAL_NIGHTS).filter((n) => !(m.scored && n.restMode)).map((n) => conv(ouraValue(n, k)));
    const u = middleHalf(recent);
    // Each shot sits on the dot of the night that followed it (the evening of the dose, dated
    // by the ring by the next morning), so "the night of a dose" reads on the same chart.
    const byDay = Object.fromEntries(ns.map((n) => [n.day, n]));
    const shots = [];
    for (const [evening] of Object.entries(lifeByEvening()).filter(([, set]) => set.has('shot'))) {
      const n = byDay[shiftIso(evening, 1)];
      if (!n) continue;
      shots.push({ ms: Date.parse(`${n.day}T12:00:00`), label: 'Shot night', colour: '#8E8E93', value: round(conv(ouraValue(n, k)), 3) });
    }
    const spec = {
      kind: 'sleep', title: m.title, unit: m.unit, decimals: m.nd,
      takeaway: u ? `Middle half of your last ${USUAL_NIGHTS} nights ${round(u.lo, m.nd)} to ${round(u.hi, m.nd)}${m.unit ? ` ${m.unit}` : ''}` : '',
      series: [{ name: m.title, colour: SLEEP_HEX, points: pts, style: 'linepoints' }],
      rules: [
        ...(u ? [{ value: round(u.mid, 3), label: 'Your usual', colour: '#8E8E93' }] : []),
        ...(m.rule ? [{ value: m.rule, label: `${m.rule} hours`, colour: '#8E8E93' }] : []),
      ],
      bands: u ? [{ from: u.lo, to: u.hi, colour: SLEEP_HEX, label: 'Your middle half' }] : [],
      marks: shots, marksName: 'Shot nights',
      ranges: [{ label: '2W', days: 14 }, { label: '1M', days: 30 }, { label: '3M', days: 91 }, { label: 'All', days: 3650 }],
    };
    const t0 = performance.now();
    const ok = await nativeChart(spec);
    if (ok != null || performance.now() - t0 > 250) return;
  }
  void el;
  openMetric(k);
}

/** The two levers his record proved, as a small sheet: the number and where it came from. */
function openLever(which, iso) {
  const days = windowDays(iso);
  if (which === 'swing') {
    const s = steadiness(STEADY_WINDOW, days[days.length - 1]);
    sheet({ title: 'Bedtime swing', cls: 'sl-levsheet', body: `<div class="sl-lev">
      <b class="sl-levbig">${s ? `${esc(String(round(s.hours, 1)))}<i>h</i>` : 'Not enough nights yet'}</b>
      <span class="sl-levgoal${s && s.hours <= 1 ? ' met' : ''}">${s && s.hours <= 1 ? `${G.check}Within 1 hour` : 'Aiming for within 1 hour'}</span>
      <p>How far a bedtime typically sat from your own pattern, over ${s ? s.n : 0} nights to ${esc(fmtDateShort(days[days.length - 1]))}.</p>
      <p>An hour further off went with about two points less readiness, in both halves of your record.</p>
    </div>` });
    return;
  }
  const o = owedThrough(iso);
  sheet({ title: 'Sleep owed', cls: 'sl-levsheet', body: `<div class="sl-lev">
    <b class="sl-levbig">${o ? `${esc(String(round(o.hours, 1)))}<i>h</i>` : 'Not enough nights yet'}</b>
    <span class="sl-levgoal${o && o.hours <= 1 ? ' met' : ''}">${o && o.hours <= 1 ? `${G.check}Under 1 hour` : 'Aiming for under 1 hour'}</span>
    <p>Hours below ${SLEEP_TARGET_H} across ${o ? o.days.map((d) => esc(weekdayOf(shiftIso(d, -1), true))).join(', ') : 'the last three'} nights.</p>
    <p>Each hour owed went with a lower readiness score and a slightly higher lowest heart rate.</p>
  </div>` });
}
