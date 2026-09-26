// Progress > Oura Ring. What the ring measured, drawn the way Overview is drawn.
//
// The rules this section follows, and why:
//
// 1. It shows a RECORD, never advice. Morning readiness was tested against how
//    his sessions actually went and predicted nothing, in either direction, so
//    nothing here tells him to train or to rest. It prints what happened.
// 2. Each metric owns ONE colour, and that colour appears only inside that
//    metric's own titled panel. Three are defined and nothing else is coloured,
//    so a hue here can never be read as a leg (blue and orange) or a category.
//    Green still means only met or done, gold only finished.
// 3. Two measures are given their own tiles because they are the two
//    relationships that held in both halves of his history: how far a bedtime
//    sat from his own recent pattern, and sleep owed over three nights. They
//    are his to move. Everything else is context.
// 4. Nights in another time zone are drawn hollow rather than hidden, because
//    travel moved his heart rate and breathing more than anything else did, and
//    a chart that quietly dropped them would flatter him.
// 5. Rest mode nights are marked on the scored charts only. Rest mode rescores
//    some of Oura's own numbers without the body changing; the raw readings
//    carry across it untouched.
//
// The phone gets the top two sections and stops. The wide layout gets the long
// view, the shape of his nights, where he slept and the load relationship.

import { esc, round, fmtDateShort, toIso } from '../util.js';
import { state, surgeryDate } from '../store.js';
import { contentWidth } from './overview.js';
import {
  ringReady, ringSettled, ringNights, ringBuiltAt, lastNight, recentNights, monthly,
  steadiness, sleepAbove, sleepDebt, windowMedian, awayNight, nightFor,
  ringMedian, shotNightEffect, SLEEP_TARGET_H, DEBT_NIGHTS,
  phaseRuns, nightMinutes, movementLevels, stageMinutes, stepNight, STAGES, nightSpan, weekdayOf,
  syncRing, syncWords, waitForMac, shotSentence,
} from '../ring.js';
import { toast } from '../components.js';
import { SERVER_MODE } from '../sync/local-store.js';

const RANGES = [['all', 'All'], ['6m', '6 months'], ['3m', '3 months']];
const RANGE_KEY = 'rehab.recovery.range';

export function recoveryRange() {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    return RANGES.some(([k]) => k === v) ? v : 'all';
  } catch {
    return 'all';
  }
}
function setRange(v) {
  try { localStorage.setItem(RANGE_KEY, v); } catch { /* per device */ }
}

const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
const STARS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z"/><path d="M18.5 16.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/></svg>';
const BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L5.5 13.5H11l-1 7.5L18.5 10H13z"/></svg>';
const WAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h3l2-5 3 10 3-8 2 3h5"/></svg>';
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13l18-6-7 13-2-5z"/></svg>';
// Two arrows round, the ordinary sign for fetching again. Icon only, with the
// words in its label and its tooltip (his ask, 2026-09-22).
const SYNC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-13.3 6"/>'
  + '<path d="M4 12a8 8 0 0 1 13.3-6"/><path d="M17.3 2.6V6h-3.4"/><path d="M6.7 21.4V18h3.4"/></svg>';

/** Nights inside the chosen range, oldest first. */
function inRange(nights, range) {
  if (range === 'all' || !nights.length) return nights;
  const end = new Date(`${nights[nights.length - 1].day}T12:00:00`);
  end.setMonth(end.getMonth() - (range === '3m' ? 3 : 6));
  const from = toIso(end);
  return nights.filter((n) => n.day >= from);
}

// The line between the logging layout and the full one. His iPad is the device
// this has to get right: at 834 points portrait the content column is about
// 570 wide in the desktop shell and about 760 in the mobile one, while the
// phone is about 317 in either. 520 separates them in both shells and both
// orientations, which a higher threshold did not: the iPad fell to the phone
// layout even at 1024 wide.
const WIDE_AT = 520;

/**
 * The width this section is drawn at.
 *
 * `contentWidth()` reads the live view element, and during a page transition
 * that element can still be a few pixels wide. Trusting it there silently drew
 * the narrow layout on a wide screen, so the decision is recorded on the
 * element and checked again after paint (see bindRecovery), the same "measure,
 * never guess" rule the board's labels follow.
 */
function layoutWidth() {
  const cw = contentWidth();
  // Below the floor contentWidth() returns, the view has not been laid out yet
  // and the number means nothing. Fall back to the window, which always has one.
  if (cw <= 280) return Math.max(280, (window.innerWidth || 360) - 72);
  return cw;
}

export function renderRecovery(ctx) {
  // The load is async on every route, this device's own cache included, so the
  // first paint of the app always sees no ring. Until it has settled this page
  // stays quiet rather than saying "nothing here" and correcting itself a
  // frame later; store.js repaints as soon as the layer lands.
  if (!ringReady()) return ringSettled() ? empty() : '<div class="stack rc-wait" aria-busy="true"></div>';
  const cw = layoutWidth();
  const wide = cw >= WIDE_AT;
  const range = recoveryRange();
  const nights = inRange(ringNights(), range);
  return `<div class="stack rc" data-rc-wide="${wide ? '1' : '0'}">
    ${nightBar(ctx)}
    ${lastNightStrip(ctx)}
    ${nightDetail(ctx)}
    ${markerSection()}
    ${wide ? rangeBar(range, nights) : ''}
    ${wide ? longView(nights, cw) : ''}
    ${sleepShape(nights, wide)}
    ${wide ? placeSection(nights) : ''}
    ${wide ? loadSection(nights, cw) : ''}
    ${shotSection()}
    ${footNote()}
  </div>`;
}

/**
 * Which night the page is showing. The arrows at the top set it; everything
 * night specific on the page follows the same answer, so there is one date to
 * change and it is the first thing on the screen (his ask, 2026-09-22).
 */
function selectedIso(ctx) {
  const ns = ringNights();
  if (!ns.length) return null;
  const latest = ns[ns.length - 1].day;
  return (ctx && ctx.rcNight && nightFor(ctx.rcNight)) ? ctx.rcNight : latest;
}

/**
 * The night picker, at the very top. It says which night in words as well as
 * by date, because Oura dates a night by the morning it ends and that is not
 * obvious from "Sep 21" alone (his ask, 2026-09-22).
 */
/**
 * One row for the whole header (his ask, 2026-09-22, after the first version
 * took two): the night on the left with its arrows, the sync button on the
 * right. The arrows and the button share a line because neither needs a line
 * of its own, and this section is long enough already.
 *
 * The sync button: on the Mac it fetches from Oura, on the phone and iPad it
 * picks up what the Mac last put in the relay, which is all a device without
 * the tokens can do.
 */
function nightBar(ctx) {
  const ns = ringNights();
  if (!ns.length) return '';
  const latest = ns[ns.length - 1].day;
  const iso = selectedIso(ctx);
  const n = nightFor(iso);
  const prev = stepNight(iso, -1);
  const next = stepNight(iso, 1);
  const built = ringBuiltAt();
  return `<div class="rc-pick">
    <span class="rc-pickside">
      <button class="btn sm ghost" data-rc-night="${prev ? esc(prev.day) : ''}" ${prev ? '' : 'disabled hidden'}
        aria-label="The night before">\u2039</button>
      <button class="btn sm ghost" data-rc-night="${next ? esc(next.day) : ''}" ${next ? '' : 'disabled hidden'}
        aria-label="The night after">\u203a</button>
    </span>
    <span class="rc-pickmid">
      <b>${esc(fmtDateShort(iso))}</b>
      <small class="rc-spanlong">${esc(nightSpan(n))}</small>
      <small class="rc-spanshort">${esc(nightSpan(n, true))}</small>
    </span>
    <span class="rc-pickside end">
      <span class="rc-topwhen" data-rc-synced>${built ? `Updated ${esc(fmtDateShort(toIso(new Date(built))))}` : ''}</span>
      ${iso === latest ? '' : `<button class="btn sm rc-latest" data-rc-night="${esc(latest)}">Latest</button>`}
      <button class="btn sm rc-sync" data-rc-sync title="Sync ring data"
        aria-label="Sync ring data">${SYNC}</button>
    </span>
  </div>`;
}

function empty() {
  return `<div class="stack">
    <div class="empty rc-empty">
      <b>No ring nights yet</b>
      <span>The nightly summary is built on the Mac and shared through your own private repo.
      Once it is there, this page fills in by itself.</span>
    </div>
  </div>`;
}

// ------------------------------------------------------------- last night ----

const DELTA_DAYS = 30;

/**
 * One tile per headline measure for the most recent night, each against the
 * median of the last thirty nights, with that measure's own small chart. Heart
 * rate reads the other way round, so the arrow is worked out per measure and
 * never coloured good or bad: it is a fact, not a verdict.
 */
/**
 * Every heading in this section carries its own icon in its own colour, so the
 * page reads as one thing rather than a stack of unrelated panels. The colour
 * is the metric's, and it appears only inside that metric's own block.
 */
function secHead(title, icon, cls, count) {
  return `<div class="ov-head rc-head2 ${cls || ''}">
    <span class="rc-hbadge">${icon}</span>
    <h2>${esc(title)}</h2>
    ${count ? `<span class="ov-count">${count}</span>` : ''}
  </div>`;
}

function lastNightStrip(ctx) {
  const iso = selectedIso(ctx);
  const n = iso ? nightFor(iso) : null;
  if (!n) return '';
  const isLatest = n.day === (lastNight() || {}).day;
  const tiles = [
    { k: 'sleepH', label: 'Slept', icon: MOON, cls: 'sleep', fmt: (v) => hm(v), unit: '', up: true },
    { k: 'sleepScore', label: 'Sleep score', icon: STARS, cls: 'sleep', fmt: (v) => String(Math.round(v)), unit: '', up: true },
    { k: 'hrv', label: 'HRV', icon: WAVE, cls: 'hrv', fmt: (v) => String(Math.round(v)), unit: 'ms', up: true },
    { k: 'lowestHr', label: 'Lowest heart rate', icon: HEART, cls: 'hr', fmt: (v) => String(Math.round(v)), unit: 'bpm', up: false },
    { k: 'readiness', label: 'Readiness', icon: BOLT, cls: 'hrv', fmt: (v) => String(Math.round(v)), unit: '', up: true },
  ].filter((t) => Number.isFinite(n[t.k]));
  if (!tiles.length) return '';
  const away = awayNight(n);
  return `<section class="ov-sec rc-sec">
    ${secHead(isLatest ? 'Last night' : 'That night', MOON, 'sleep', `${esc(fmtDateShort(n.day))}${away ? ' · away' : ''}${n.restMode ? ' · rest mode' : ''}`)}
    <div class="rc-strip n${tiles.length}">
      ${tiles.map((t, i) => {
        // Against the nights up to THIS one: an older night was measured
        // against the newest thirty (2026-09-22 audit).
        const med = windowMedian(t.k, DELTA_DAYS, n.day);
        const d = med == null ? null : n[t.k] - med;
        const vals = recentNights(DELTA_DAYS, n.day).map((x) => x[t.k]);
        // The arrow says which way it moved. It is never coloured good or bad:
        // that is a judgement, and this section prints facts.
        const chip = d == null ? ''
          : Math.abs(d) < (t.k === 'sleepH' ? 1 / 60 : 0.5)
            ? '<span class="rc-chip flat">level</span>'
            : `<span class="rc-chip ${d > 0 ? 'up' : 'down'}">${d > 0 ? ARROW_UP : ARROW_DOWN}${esc(signed(d, t.k))}</span>`;
        return `<div class="rc-tile ${t.cls}" style="--i:${i}">
          <span class="rc-head">
            <span class="rc-badge">${t.icon}</span>
            <span class="rc-lab">${esc(t.label)}</span>
          </span>
          <span class="rc-row">
            <b class="rc-val">${esc(t.fmt(n[t.k]))}${t.unit ? `<i>${esc(t.unit)}</i>` : ''}</b>
            ${chip}
          </span>
          ${spark(vals, 120, 42)}
        </div>`;
      }).join('')}
    </div>
    <div class="rc-note">Each figure against the middle of your last ${DELTA_DAYS} nights, with those nights drawn behind it.</div>
  </section>`;
}

const ARROW_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const ARROW_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

function hm(h) {
  const t = Math.round(h * 60);
  return `${Math.floor(t / 60)}h ${String(t % 60).padStart(2, '0')}m`;
}
function signed(d, key) {
  const a = Math.abs(d);
  if (key === 'sleepH') return hm(a);
  return String(round(a, a < 10 ? 1 : 0));
}

// --------------------------------------------------------- a night in detail --

/**
 * One night drawn the way a sleep night wants to be drawn: the stages as a
 * hypnogram across the real clock, movement under it, and the four stages as
 * bars with their own minutes and share.
 *
 * Every colour here is the sleep colour at a different depth, inside this one
 * panel and always beside its own name, so the rule that a colour means one
 * thing still holds. Awake is deliberately the palest: it is the absence of the
 * thing being measured.
 */
function nightDetail(ctx) {
  // The night is chosen at the top of the page (nightBar), so this section
  // only draws it.
  const iso = selectedIso(ctx);
  const n = iso ? nightFor(iso) : null;
  const runs = phaseRuns(n);
  if (!n || !runs) return '';
  const mins = nightMinutes(n);
  const st = stageMinutes(n) || {};
  const asleep = (st.rem || 0) + (st.light || 0) + (st.deep || 0);
  const W = 1000;
  const H = 128;
  const LANE = H / 4;
  const x = (m) => (m / Math.max(1, mins)) * W;
  const mv = movementLevels(n);
  return `<section class="ov-sec rc-sec rc-night sleep">
    <div class="ov-head rc-head2 sleep">
      <span class="rc-hbadge">${MOON}</span>
      <h2>A night in detail</h2>
      <span class="rc-nav"><b>${esc(fmtDateShort(iso))}<small class="rc-nspan">${esc(nightSpan(n, true))}</small></b></span>
    </div>
    <div class="rc-nwrap">
      <div class="rc-nhead">
        <span class="rc-nlab">Time asleep</span>
        <b class="rc-nbig">${esc(hm(asleep / 60))}</b>
        <span class="rc-nsub">In bed ${esc(hm(mins / 60))}${clock(n.bed) ? ` · ${esc(weekdayOf(n.bed, true))} ${esc(clock(n.bed))} to ${esc(weekdayOf(n.bedEnd, true))} ${esc(clock(n.bedEnd))}` : ''}</span>
      </div>
      <svg class="rc-hyp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
          aria-label="Sleep stages across the night">
        <g class="rc-hypg">
        ${runs.map((r, i) => {
          const prevR = runs[i - 1];
          const y = r.lane * LANE;
          const w = Math.max(1.5, x(r.to) - x(r.from));
          return `${prevR ? `<line class="rc-hlink" x1="${x(r.from).toFixed(1)}" y1="${(Math.min(prevR.lane, r.lane) * LANE + LANE * 0.5).toFixed(1)}"
              x2="${x(r.from).toFixed(1)}" y2="${(Math.max(prevR.lane, r.lane) * LANE + LANE * 0.5).toFixed(1)}"/>` : ''}
            <rect class="rc-h ${r.id}" x="${x(r.from).toFixed(1)}" y="${(y + LANE * 0.16).toFixed(1)}"
              width="${w.toFixed(1)}" height="${(LANE * 0.68).toFixed(1)}"/>`;
        }).join('')}
        </g>
      </svg>
      ${timeAxis(n, mins)}
      ${mv ? `<svg class="rc-mv" viewBox="0 0 ${W} 22" preserveAspectRatio="none" role="img" aria-label="Movement through the night">
        ${mv.map((v, i) => (v > 1 ? `<rect x="${((i / mv.length) * W).toFixed(1)}" y="${(11 - v * 2.4).toFixed(1)}"
          width="1.6" height="${(v * 4.8).toFixed(1)}"/>` : '')).join('')}
      </svg>
      <div class="rc-note">Movement</div>` : ''}
      <div class="rc-legend">
        ${STAGES.map((sg, i) => {
          const m = st[sg.id] || 0;
          const share = asleep > 0 && sg.id !== 'awake' ? Math.round((m / asleep) * 100) : null;
          return `<div class="rc-lrow" style="--i:${i}">
            <span class="rc-lbar ${sg.id}"><i style="width:${((m / Math.max(1, mins)) * 100).toFixed(1)}%"></i></span>
            <span class="rc-lname">${esc(sg.label)}</span>
            <b>${esc(hm(m / 60))}</b>
            <span class="rc-lpct">${share == null ? '' : `${share}%`}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </section>`;
}

/** Hour marks across the night, placed on the real clock. */
function timeAxis(n, mins) {
  if (!n.bed || !mins) return '';
  // On the ring's own clock, as the start and end labels are: the offset in the
  // bedtime string, not this device's time zone. Away from home the ticks used
  // to be in one zone and the ends in another, "on the hour" landing at :30
  // (2026-09-22 audit). The UTC fields of `wall` are that clock.
  const start = new Date(n.bed);
  const om = /([+-])(\d{2}):?(\d{2})$/.exec(n.bed);
  const off = om ? (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3])) : -start.getTimezoneOffset();
  const wall = new Date(start.getTime() + off * 60000);
  const marks = [];
  const first = new Date(wall);
  first.setUTCMinutes(0, 0, 0);
  if (first < wall) first.setUTCHours(first.getUTCHours() + 1);
  // Every other hour keeps the labels apart at any width.
  const pad = (v) => String(v).padStart(2, '0');
  for (let t = new Date(first); (t - wall) / 60000 < mins; t.setUTCHours(t.getUTCHours() + 2)) {
    marks.push({ pct: ((t - wall) / 60000 / mins) * 100, label: clock(`T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`) });
  }
  return `<div class="rc-axis" aria-hidden="true">
    <span class="rc-tstart">${esc(clock(n.bed))}</span>
    ${marks.filter((m) => m.pct > 13 && m.pct < 87).map((m) => `<span class="rc-tick" style="left:${m.pct.toFixed(1)}%">${esc(m.label)}</span>`).join('')}
    <span class="rc-tend">${esc(clock(n.bedEnd))}</span>
  </div>`;
}

/** The clock time from a stored bedtime, in his own locale. */
function clock(iso) {
  const m = iso && /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '';
  const h = Number(m[1]);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]}${ampm}`;
}

// ----------------------------------------------------------------- markers ---

/**
 * The two things his own history says are worth moving, and the sleep count
 * beside them. Each is a measured number with the window it was measured over,
 * and a bar that fills toward steadier or more nights. Green only when met.
 */
function markerSection() {
  const st = steadiness();
  const ab = sleepAbove();
  const debtNow = latestDebt();
  const cards = [];
  if (st) {
    // Steadier is a SMALLER number, so the arc fills as the swing comes down.
    // Two hours off his own pattern is an empty arc.
    cards.push({
      cls: 'sleep', icon: CLOCK, title: 'Bedtime steadiness',
      big: round(st.hours, 1), unit: 'h', frac: 1 / Math.max(1, st.hours),
      met: st.hours <= 1, goal: 'within 1h', sub: `typical swing off your own pattern, last ${st.n} nights`,
      foot: 'An hour further off went with about two points less readiness, in both halves of your record.',
    });
  }
  if (ab) {
    cards.push({
      cls: 'sleep', icon: MOON, title: `Nights at ${SLEEP_TARGET_H} hours`,
      big: ab.hit, unit: `/${ab.n}`, frac: ab.n ? Math.min(1, (ab.hit / ab.n) / 0.5) : 0,
      met: ab.n > 0 && ab.hit / ab.n >= 0.5, goal: `half of ${ab.n}`,
      sub: `last ${ab.n} nights with a reading`,
      foot: `Across your whole record you are under ${SLEEP_TARGET_H} hours on most nights.`,
    });
  }
  if (debtNow != null) {
    cards.push({
      cls: 'hr', icon: WAVE, title: 'Sleep owed',
      big: round(debtNow, 1), unit: 'h', frac: 1 / Math.max(1, debtNow),
      met: debtNow <= 1, goal: 'under 1h',
      sub: `below ${SLEEP_TARGET_H} hours across the last ${DEBT_NIGHTS} nights`,
      foot: 'Each hour owed went with a lower readiness score and a slightly higher lowest heart rate.',
    });
  }
  if (!cards.length) return '';
  return `<section class="ov-sec rc-sec">
    ${secHead('Worth moving', BOLT, 'hrv', 'measured on your own nights')}
    <div class="rc-marks n${cards.length}">
      ${cards.map((c, i) => `
        <div class="rc-mark ${c.cls} ${c.met ? 'met' : ''}" style="--i:${i}">
          <div class="rc-mtop">
            ${arc(c.frac, c.big, c.unit, c.met)}
            <div class="rc-mwords">
              <span class="rc-mtitle">${esc(c.title)}</span>
              <span class="rc-msub">${esc(c.sub)}</span>
              <span class="rc-goal ${c.met ? 'met' : ''}">${c.met ? `${CHECK} ${esc(c.goal)}` : `Aiming for ${esc(c.goal)}`}</span>
            </div>
          </div>
          <span class="rc-mfoot">${esc(c.foot)}</span>
        </div>`).join('')}
    </div>
  </section>`;
}

const CHECK = '<svg class="rc-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/**
 * A measured value inside an arc that fills toward its target, so a FULL ring
 * always means the target is met and the fraction is readable without knowing
 * the scale. Two of these read the other way round (a smaller swing and less
 * sleep owed are better), which is why the fraction is target over current
 * rather than current over target. The arithmetic is the same one the plan
 * marker uses, so the two surfaces can never disagree.
 */
function arc(frac, big, unit, met) {
  const size = 96;
  const stroke = 9;
  const r = size / 2 - stroke / 2 - 1;
  const f = Math.max(0, Math.min(1, frac));
  return `<span class="rc-arc ${met ? 'met' : ''}" aria-hidden="true">
    <svg viewBox="0 0 ${size} ${size}">
      <circle class="ra-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      ${f > 0 ? `<circle class="ra-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
        pathLength="100" stroke-dasharray="${(f * 100).toFixed(2)} 100"
        transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
    </svg>
    <b class="ra-val">${esc(String(big))}<i>${esc(String(unit))}</i></b>
  </span>`;
}

/** Sleep owed as at the most recent night that can carry a reading. */
function latestDebt() {
  const ns = ringNights();
  for (let i = ns.length - 1; i >= Math.max(0, ns.length - 5); i--) {
    const d = sleepDebt(ns[i].day);
    if (d != null) return d;
  }
  return null;
}

// --------------------------------------------------------------- long view ---

function rangeBar(range, nights) {
  return `<div class="board-bar rc-bar-row">
    <span class="board-title">The long view</span>
    <span class="seg" role="group" aria-label="Range">
      ${RANGES.map(([k, l]) => `<button class="${range === k ? 'on' : ''}" data-rc-range="${k}" aria-pressed="${range === k}">${esc(l)}</button>`).join('')}
    </span>
  </div>
  <div class="rc-note">${nights.length} nights drawn${nights.length ? `, ${esc(fmtDateShort(nights[0].day))} to ${esc(fmtDateShort(nights[nights.length - 1].day))}` : ''}. Hollow marks are nights in another time zone.</div>`;
}

/** The dates worth a rule on a long chart, taken from his own record. */
function eventRules() {
  const out = [];
  const sl = surgeryDate('left'), sr = surgeryDate('right');
  if (sl) out.push({ day: sl, label: 'Left' });
  if (sr) out.push({ day: sr, label: 'Right' });
  const shots = Object.values(state.data.pk?.shots || {})
    .filter((x) => x && x.at && x.mg > 0 && !x.removed)
    .map((x) => String(x.at).slice(0, 10))
    .sort();
  if (shots.length) out.push({ day: shots[0], label: 'First dose' });
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

const LONG = [
  { k: 'hrv', cls: 'hrv', title: 'HRV', unit: 'ms', icon: WAVE, note: 'Higher is usually a more rested night.' },
  { k: 'lowestHr', cls: 'hr', title: 'Lowest heart rate', unit: 'bpm', icon: HEART, note: 'Lower is usually a more rested night.' },
  { k: 'sleepH', cls: 'sleep', title: 'Sleep', unit: 'h', icon: MOON, note: `The rule sits at ${SLEEP_TARGET_H} hours.`, rule: SLEEP_TARGET_H },
];

function longView(nights, cw) {
  const rules = eventRules();
  const w = Math.max(280, cw - 24);
  return LONG.map((m) => {
    const pts = nights.filter((n) => Number.isFinite(n[m.k]))
      .map((n) => ({ day: n.day, value: n[m.k], away: awayNight(n) }));
    if (pts.length < 8) return '';
    const months = monthly([m.k]).filter((r) => pts.some((p) => p.day.startsWith(r.month)));
    return `<section class="ov-sec panelsec rc-chart ${m.cls}">
      ${secHead(m.title, m.icon, m.cls, `${pts.length} nights · median ${esc(String(round(ringMedian(pts.map((p) => p.value)), 1)))} ${esc(m.unit)}`)}
      ${periodReadout(m)}
      <details class="rc-fold">
        <summary><span>Every night, drawn</span>${CHEV}</summary>
        <div class="rc-foldbody">
          ${nightChart(pts, months, m, w, rules)}
          <div class="rc-note">${esc(m.note)} Each dot is one night, the heavy line each month's middle night, and hollow dots are nights in another time zone.</div>
        </div>
      </details>
    </section>`;
  }).join('');
}

/**
 * One night per mark, the monthly median as a line over them, and a labelled
 * rule at each event. Drawn in real pixels so nothing is squeezed, and labels
 * are placed in measured boxes rather than nudged, the same lesson as the other
 * charts in this app.
 */
/**
 * The chart in words, above the chart.
 *
 * His own dot clouds were honest and unreadable ("I don't really know how to
 * interpret this"), so each one now opens with three named stretches of his
 * life and the middle night of each, plus the change in plain language. The
 * stretches come from his own operation dates, because those are the events
 * that actually divide this record.
 */
function periodReadout(m) {
  const sl = surgeryDate('left'), sr = surgeryDate('right');
  const first = sl;
  const last = sr && sr > (sl || '') ? sr : sl;
  if (!first || !last) return '';
  const ns = ringNights();
  const med = (sel) => ringMedian(ns.filter(sel).map((n) => n[m.k]));
  // Each stretch keeps its own place (k), so a stretch with no nights does not
  // shift the lines below onto another stretch's dates (2026-09-22 audit).
  const cols = [
    { k: 0, lab: 'Before the first operation', v: med((n) => n.day < first) },
    { k: 1, lab: 'Between the operations', v: med((n) => n.day >= first && n.day < last) },
    { k: 2, lab: 'Since the second', v: med((n) => n.day >= last) },
  ].filter((c) => c.v != null);
  if (cols.length < 2) return '';
  const a = cols[0].v;
  const b = cols[cols.length - 1].v;
  const d = b - a;
  const nd = Math.abs(a) < 10 ? 1 : 0;
  const word = Math.abs(d) < (Math.abs(a) < 10 ? 0.2 : 1) ? 'about the same as'
    : `${round(Math.abs(d), nd)} ${esc(m.unit)} ${d > 0 ? 'higher' : 'lower'} than`;
  return `<div class="rc-periods">
    ${cols.map((c, i) => `${i ? '<span class="rc-parrow" aria-hidden="true">' + ARROW_RIGHT + '</span>' : ''}
      <div class="rc-period${i === cols.length - 1 ? ' now' : ''}">
        <b>${esc(String(round(c.v, nd)))}<i>${esc(m.unit)}</i></b>
        <span>${esc(c.lab)}</span>
      </div>`).join('')}
    ${eraBand(m, ns, first, last, cols, nd)}
    <div class="rc-psay">Today's stretch is <b>${word}</b> before your first operation.</div>
  </div>`;
}

/**
 * His whole record as one band across the card, split at the two operations,
 * with each stretch's own middle drawn as a level line (his ask, 2026-09-20:
 * the folded cards "look kind of boring and stale"). Every night is on it, so
 * the card carries a picture without being opened, and the three numbers above
 * are the same three lines below. Nothing new is claimed: it is the record.
 */
function eraBand(m, ns, first, last, cols, nd) {
  const pts = ns.filter((n) => Number.isFinite(n[m.k])).map((n) => ({ day: n.day, v: n[m.k] }));
  if (pts.length < 8) return '';
  const W = 1000;
  const H = 54;
  const days = pts.map((p) => p.day);
  const d0 = days[0];
  const d1 = days[days.length - 1];
  const span = Math.max(1, dayNum(d1) - dayNum(d0));
  const x = (day) => ((dayNum(day) - dayNum(d0)) / span) * W;
  const vals = pts.map((p) => p.v);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || 1;
  const y = (v) => H - 4 - ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - 8);
  const dots = pts.map((p) => `<circle cx="${x(p.day).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.2"/>`).join('');
  const edges = [first, last].filter((d) => d > d0 && d < d1)
    .map((d) => `<line class="rc-eb-edge" x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="2" y2="${H - 2}"/>`).join('');
  // One level line per stretch, at that stretch's own middle, across its own days.
  const bounds = [[d0, first], [first, last], [last, d1]];
  const levels = cols.map((c) => {
    const [a, b] = bounds[c.k] || [];
    if (!a || !b || c.v == null) return '';
    const xa = Math.max(0, x(a));
    const xb = Math.min(W, Math.max(xa + 2, x(b)));
    return `<line class="rc-eb-med" x1="${xa.toFixed(1)}" x2="${xb.toFixed(1)}" y1="${y(c.v).toFixed(1)}" y2="${y(c.v).toFixed(1)}"/>`;
  }).join('');
  const label = `Every night from ${fmtDateShort(d0)} to ${fmtDateShort(d1)}, with each stretch's middle drawn across it`;
  return `<svg class="rc-eband" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
    <g class="rc-eb-dots">${dots}</g>${edges}${levels}
  </svg>`;
}

const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00`) / 86400000);

const CHEV = '<svg class="rc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

function nightChart(pts, months, m, w, rules) {
  const h = 180;
  const padL = 40;
  const padR = 12;
  const padT = 16;
  const padB = 26;
  const iw = Math.max(40, w - padL - padR);
  const ih = h - padT - padB;
  const days = pts.map((p) => +new Date(`${p.day}T12:00:00`));
  const t0 = Math.min(...days);
  const t1 = Math.max(...days);
  const span = Math.max(1, t1 - t0);
  const vals = pts.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (m.rule != null) { lo = Math.min(lo, m.rule); hi = Math.max(hi, m.rule); }
  const pad = (hi - lo) * 0.12 || 1;
  lo -= pad; hi += pad;
  const x = (t) => padL + ((t - t0) / span) * iw;
  const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  const ticks = niceTicks(lo, hi, 4);
  const mline = months.map((r) => (Number.isFinite(r[m.k])
    ? { t: +new Date(`${r.month}-15T12:00:00`), v: r[m.k] } : null)).filter(Boolean)
    .filter((p) => p.t >= t0 - 15 * 864e5 && p.t <= t1 + 15 * 864e5);
  return `<svg class="rc-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"
      aria-label="${esc(m.title)} for each night, with each month's middle value">
    ${ticks.map((v) => `<g class="rc-grid"><line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${(w - padR).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="rc-ytick" x="${padL - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(String(round(v, hi - lo < 4 ? 1 : 0)))}</text></g>`).join('')}
    ${m.rule != null ? `<line class="rc-target" x1="${padL}" y1="${y(m.rule).toFixed(1)}" x2="${(w - padR).toFixed(1)}" y2="${y(m.rule).toFixed(1)}"/>` : ''}
    ${placeRules(rules, x, t0, t1, padL, iw, padT, ih)}
    ${pts.map((p) => {
      const cx = x(+new Date(`${p.day}T12:00:00`)).toFixed(1);
      const cy = y(p.value).toFixed(1);
      return p.away
        ? `<circle class="rc-dot away" cx="${cx}" cy="${cy}" r="2.6"/>`
        : `<circle class="rc-dot" cx="${cx}" cy="${cy}" r="2.2"/>`;
    }).join('')}
    ${mline.length > 1 ? `<path class="rc-mline" d="${mline.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')}"/>` : ''}
    ${mline.map((p) => `<circle class="rc-mdot" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.4"/>`).join('')}
    <text class="rc-xtick" x="${padL}" y="${h - 8}">${esc(fmtDateShort(pts[0].day))}</text>
    <text class="rc-xtick" x="${w - padR}" y="${h - 8}" text-anchor="end">${esc(fmtDateShort(pts[pts.length - 1].day))}</text>
  </svg>`;
}

/**
 * Event rules with their labels PLACED, not nudged: each label's box is worked
 * out from its own length, and one that would run into the label before it
 * drops to the next row instead of overlapping it. A label that would leave the
 * chart flips to the other side of its line. The same lesson as the board's
 * labels and the level chart's: measure the box, never hope.
 */
function placeRules(rules, x, t0, t1, padL, iw, padT, ih) {
  const CH = 5.35;          // width of one character at this font size
  const ROW = 11;           // distance between label rows
  const ROWS = 3;
  const placed = [];
  const out = [];
  for (const r of rules) {
    const t = +new Date(`${r.day}T12:00:00`);
    if (t < t0 || t > t1) continue;
    const rx = x(t);
    const w = r.label.length * CH + 6;
    const flip = rx + w > padL + iw;
    const left = flip ? rx - w : rx;
    let row = 0;
    while (row < ROWS - 1 && placed.some((p) => p.row === row && left < p.right && p.left < left + w)) row++;
    placed.push({ row, left, right: left + w });
    out.push(`<g class="rc-ev"><line x1="${rx.toFixed(1)}" y1="${padT}" x2="${rx.toFixed(1)}" y2="${padT + ih}"/>
      <text x="${(rx + (flip ? -4 : 4)).toFixed(1)}" y="${(padT + 9 + row * ROW).toFixed(1)}" text-anchor="${flip ? 'end' : 'start'}">${esc(r.label)}</text></g>`);
  }
  return out.join('');
}

function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(round(v, 4));
  return out;
}

/**
 * A tile's own nights behind its number: a filled area, not a hairline, because
 * at this size a 1 px line reads as noise and a shape reads as a shape.
 */
function spark(values, w = 120, h = 34) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 3) return '<span class="rc-spark" aria-hidden="true"></span>';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const rng = hi - lo || 1;
  const X = (i) => ((i / (v.length - 1)) * w).toFixed(1);
  const Y = (x) => (h - 2 - ((x - lo) / rng) * (h - 6)).toFixed(1);
  const line = v.map((x, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(x)}`).join(' ');
  return `<span class="rc-spark" aria-hidden="true"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path class="sp-fill" d="${line} L${w} ${h} L0 ${h} Z"/>
    <path class="sp-line" d="${line}"/>
    <circle class="sp-now" cx="${X(v.length - 1)}" cy="${Y(v[v.length - 1])}" r="2.4"/>
  </svg></span>`;
}

// ------------------------------------------------------------- sleep shape ---

/** How his nights are distributed, and what they are made of. */
function sleepShape(nights, wide) {
  const hs = nights.map((n) => n.sleepH).filter(Number.isFinite);
  if (hs.length < 8) return '';
  const bins = [
    { lab: 'under 5h', test: (x) => x < 5 },
    { lab: '5 to 6h', test: (x) => x >= 5 && x < 6 },
    { lab: '6 to 7h', test: (x) => x >= 6 && x < 7 },
    { lab: '7 to 8h', test: (x) => x >= 7 && x < 8 },
    { lab: '8h or more', test: (x) => x >= 8 },
  ].map((b) => ({ ...b, n: hs.filter(b.test).length }));
  const top = Math.max(...bins.map((b) => b.n)) || 1;
  const deep = ringMedian(nights.map((n) => n.deepH));
  const rem = ringMedian(nights.map((n) => n.remH));
  const awake = ringMedian(nights.map((n) => n.awakeH));
  const med = ringMedian(hs);
  const light = med != null && deep != null && rem != null && awake != null
    ? Math.max(0, med - deep - rem) : null;
  return `<section class="ov-sec rc-sec">
    ${secHead('The shape of your nights', MOON, 'sleep', `${hs.length} nights · median ${esc(hm(med))}`)}
    <div class="rc-shape ${wide ? 'wide' : ''}">
      <div class="rc-cols sleep" role="img" aria-label="How many nights fall in each length">
        ${bins.map((b, i) => `<div class="rc-col" style="--i:${i}">
          <span class="rc-colbar"><i style="height:${((b.n / top) * 100).toFixed(1)}%"></i></span>
          <b>${b.n}</b><span class="rc-collab">${esc(b.lab)}</span>
        </div>`).join('')}
      </div>
      ${light != null ? `<div class="rc-stack" role="img" aria-label="A typical night, by stage">
        <span class="rc-stitle">A typical night</span>
        <span class="rc-sbar">
          <i class="s-deep" style="flex:${deep.toFixed(2)}"><b>${esc(hm(deep))}</b></i>
          <i class="s-light" style="flex:${light.toFixed(2)}"><b>${esc(hm(light))}</b></i>
          <i class="s-rem" style="flex:${rem.toFixed(2)}"><b>${esc(hm(rem))}</b></i>
        </span>
        <span class="rc-skey"><b class="k-deep">Deep</b><b class="k-light">Light</b><b class="k-rem">REM</b></span>
        <span class="rc-note">Awake in bed, ${esc(hm(awake))}, is not drawn.</span>
      </div>` : ''}
    </div>
  </section>`;
}

// ------------------------------------------------------------------- place ---

/** Nights at home against nights in another time zone, and what it cost. */
function placeSection(nights) {
  const home = nights.filter((n) => !awayNight(n));
  const away = nights.filter(awayNight);
  if (away.length < 5 || home.length < 10) return '';
  const rows = [
    { k: 'avgHr', lab: 'Sleeping heart rate', unit: 'bpm', nd: 1 },
    { k: 'lowestHr', lab: 'Lowest heart rate', unit: 'bpm', nd: 1 },
    { k: 'breath', lab: 'Breath rate', unit: '/min', nd: 2 },
    { k: 'sleepH', lab: 'Sleep', unit: 'h', nd: 2 },
    { k: 'hrv', lab: 'HRV', unit: 'ms', nd: 1 },
    { k: 'steps', lab: 'Steps', unit: '', nd: 0 },
  ];
  return `<section class="ov-sec rc-sec">
    ${secHead('Home against away', PLANE, 'hr', `${away.length} nights in another time zone`)}
    <div class="rc-place">
      <div class="rc-phead"><span></span><span class="ph-home">Home</span><span class="ph-sp"></span><span class="ph-away">Away</span><span></span></div>
      ${rows.map((r, i) => {
        const a = ringMedian(home.map((n) => n[r.k]));
        const b = ringMedian(away.map((n) => n[r.k]));
        if (a == null || b == null) return '';
        const d = b - a;
        // The bar grows out from the middle, so its own half of the track is
        // the most it can ever use. Anything above 50% used to run out over
        // the numbers either side.
        const share = Math.min(50, (Math.abs(d) / Math.max(Math.abs(a), 1e-9)) * 100 * 6);
        return `<div class="rc-prow" style="--i:${i}">
          <span class="rc-plab">${esc(r.lab)}</span>
          <span class="rc-pv">${esc(String(round(a, r.nd)))}<i>${esc(r.unit)}</i></span>
          <span class="rc-pbar"><i class="${d >= 0 ? 'up' : 'down'}" style="width:${share.toFixed(1)}%"></i></span>
          <span class="rc-pv away">${esc(String(round(b, r.nd)))}<i>${esc(r.unit)}</i></span>
          <span class="rc-pd ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '+' : ''}${esc(String(round(d, r.nd)))}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="rc-note">Middle night of each group. A touring fortnight is the closest thing your record holds to a run of shows.</div>
  </section>`;
}

// -------------------------------------------------------------------- load ---

/**
 * The one relationship that held in both halves of his record: a harder day
 * went with faster breathing that night. Drawn as the nights themselves with a
 * fitted line, because a scatter is the honest way to show how loose it is.
 */
function loadSection(nights, cw) {
  const pts = nights.filter((n) => Number.isFinite(n.metMin) && Number.isFinite(n.breath))
    .map((n) => ({ x: n.metMin, y: n.breath, away: awayNight(n) }));
  if (pts.length < 20) return '';
  const w = Math.max(280, Math.min(cw - 24, 560));
  const h = 190;
  const padL = 40;
  const padB = 30;
  const padT = 14;
  const padR = 12;
  const iw = w - padL - padR;
  const ih = h - padT - padB;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = 0;
  const x1 = Math.max(...xs) * 1.04 || 1;
  const y0 = Math.min(...ys) - 0.4;
  const y1 = Math.max(...ys) + 0.4;
  const X = (v) => padL + ((v - x0) / (x1 - x0)) * iw;
  const Y = (v) => padT + ih - ((v - y0) / (y1 - y0)) * ih;
  const n = pts.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
  const slope = sxx ? sxy / sxx : 0;
  const per10 = slope * 10;
  return `<section class="ov-sec panelsec rc-chart hr">
    ${secHead('A harder day, and the night after', BOLT, 'hr', `${n} nights`)}
    <div class="rc-oneline">
      <b>${esc(String(round(per10, 3)))}</b>
      <span>more breaths a minute that night, for each ten MET minutes the day before.
      Loose, and the only load relationship that held in both halves of your record.</span>
    </div>
    <details class="rc-fold">
      <summary><span>Every night, drawn</span>${CHEV}</summary>
      <div class="rc-foldbody">
    <svg class="rc-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"
        aria-label="Breath rate that night against how hard the day before was">
      ${niceTicks(y0, y1, 4).map((v) => `<g class="rc-grid"><line x1="${padL}" y1="${Y(v).toFixed(1)}" x2="${w - padR}" y2="${Y(v).toFixed(1)}"/>
        <text class="rc-ytick" x="${padL - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(String(round(v, 1)))}</text></g>`).join('')}
      ${pts.map((p) => `<circle class="rc-dot ${p.away ? 'away' : ''}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.away ? 2.6 : 2.2}"/>`).join('')}
      <path class="rc-fit" d="M${X(x0).toFixed(1)} ${Y(my + slope * (x0 - mx)).toFixed(1)} L${X(x1).toFixed(1)} ${Y(my + slope * (x1 - mx)).toFixed(1)}"/>
      <text class="rc-xtick" x="${padL}" y="${h - 8}">no load</text>
      <text class="rc-xtick" x="${w - padR}" y="${h - 8}" text-anchor="end">${Math.round(x1)} MET min</text>
      <text class="rc-axis" x="${padL - 30}" y="${padT + ih / 2}" transform="rotate(-90 ${padL - 30} ${padT + ih / 2})" text-anchor="middle">breaths /min</text>
    </svg>
      </div>
    </details>
  </section>`;
}

// -------------------------------------------------------------- shot night ---

/** What the night of a dose does, measured on his own nights. */
function shotSection() {
  const shots = Object.values(state.data.pk?.shots || {});
  const eff = shotNightEffect(shots);
  if (!eff) return '';
  const tempK = eff.keys.tempDev;
  const brK = eff.keys.breath;
  const slK = eff.keys.sleepH;
  const scK = eff.keys.sleepScore;
  if (!tempK && !brK) return '';
  // Grouped by what the numbers say (clears), never by a fixed expectation: as
  // he logs more cycles a measure can move from one group to the other, and
  // the words follow it (2026-09-22 audit; the groups used to be hard coded).
  const all = [];
  if (tempK) all.push({ lab: 'Body temperature', word: 'temperature', icon: TEMP, v: tempK.diff, unit: 'C', nd: 2, on: tempK.clears });
  if (brK) all.push({ lab: 'Breath rate', word: 'breathing', icon: WAVE, v: brK.diff, unit: '/min', nd: 2, on: brK.clears });
  if (slK) all.push({ lab: 'Time asleep', how: 'long', icon: MOON, v: slK.diff * 60, unit: 'min', nd: 0, on: slK.clears });
  if (scK) all.push({ lab: 'Sleep score', how: 'well', icon: STARS, v: scK.diff, unit: '', nd: 1, on: scK.clears });
  const moved = all.filter((r) => r.on);
  const same = all.filter((r) => !r.on);
  const card = (r, i) => `<div class="rc-scard ${r.on ? 'on' : 'off'}" style="--i:${i}">
    <span class="rc-sbadge">${r.icon}</span>
    <span class="rc-slab">${esc(r.lab)}</span>
    <b class="rc-sval">${r.v >= 0 ? '+' : ''}${esc(String(round(r.v, r.nd)))}<i>${esc(r.unit)}</i></b>
    <span class="rc-dbar" aria-hidden="true"><i style="width:${Math.min(50, Math.abs(r.v) * (r.unit === 'C' ? 220 : r.unit === '/min' ? 160 : 4)).toFixed(0)}%"
      class="${r.v >= 0 ? 'up' : 'down'}"></i></span>
  </div>`;
  return `<section class="ov-sec rc-sec">
    ${secHead('The night of a dose', WAVE, 'hrv', `${eff.cycles} cycles`)}
    <div class="rc-shotwrap">
      ${moved.length ? `<div class="rc-sgroup moves">
        <span class="rc-gtitle">${TICK_SM} Moves</span>
        <div class="rc-shot">${moved.map(card).join('')}</div>
      </div>` : ''}
      ${same.length ? `<div class="rc-sgroup stays">
        <span class="rc-gtitle">${MINUS_SM} No measurable change</span>
        <div class="rc-shot">${same.map((r, i) => card(r, i + moved.length)).join('')}</div>
      </div>` : ''}
    </div>
    <div class="rc-note">The first night of each cycle against the rest of that cycle, on your own nights.
    ${esc(shotSentence(moved, same))}</div>
  </section>`;
}

const TEMP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0z"/></svg>';
const TICK_SM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';
const MINUS_SM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>';

function footNote() {
  const built = ringBuiltAt();
  const ns = ringNights();
  return `<div class="rc-foot">${ns.length} nights on this device${built ? `, built ${esc(fmtDateShort(toIso(new Date(built))))}` : ''}.
    Read only: nothing here is part of your record, and nothing here is advice.
    Morning readiness was tested against how your sessions went and predicted neither what you did nor how it went.</div>`;
}

// ------------------------------------------------------------------- binding --

export function bindRecovery(root, ctx, rerender) {
  root.querySelectorAll('[data-rc-range]').forEach((b) => b.addEventListener('click', () => {
    setRange(b.dataset.rcRange);
    rerender();
  }));
  const sync = root.querySelector('[data-rc-sync]');
  if (sync) {
    sync.addEventListener('click', async () => {
      const when = root.querySelector('[data-rc-synced]');
      const back = when ? when.textContent : '';
      const say = (t) => { if (when) when.textContent = t; };
      sync.disabled = true;
      say(SERVER_MODE ? 'Asking Oura...' : 'Checking...');
      try {
        const out = await syncRing();
        if (!out.ok) {
          say(back);
          toast(`<b>Could not sync</b><br><span>${esc(out.message)}</span>`, 'warn');
          return;
        }
        if (out.message) toast(`<b>Some of it did not come back</b><br><span>${esc(out.message)}</span>`, 'warn');
        else {
          const w = syncWords(out);
          toast(`<b>${esc(w.title)}</b><br><span>${esc(w.body)}</span>`);
        }
        // The Mac answers a request on its own clock, so the page waits for it
        // instead of leaving him to press the button again.
        if (out.asked && !out.changed) {
          waitForMac((day) => {
            toast(`<b>Ring updated</b><br><span>Newest night ${esc(fmtDateShort(day))}.</span>`);
            rerender();
          });
        }
        rerender();
      } finally {
        sync.disabled = false;
      }
    });
  }
  root.querySelectorAll('[data-rc-night]').forEach((b) => b.addEventListener('click', () => {
    if (!b.dataset.rcNight) return;
    ctx.rcNight = b.dataset.rcNight;
    rerender();
  }));
  const rc = root.querySelector('.rc');
  if (!rc) return;

  // Check the decision against the real width once the paint has landed, and
  // again whenever the view is resized. Only a flip between the two layouts
  // redraws, so this can never loop.
  const drawn = rc.dataset.rcWide === '1';
  const check = () => {
    const el = document.getElementById('view');
    if (!el || !el.clientWidth || !document.body.contains(rc)) return;
    if ((el.clientWidth - 76 >= WIDE_AT) !== drawn) rerender();
  };
  requestAnimationFrame(() => requestAnimationFrame(check));
  const el = document.getElementById('view');
  if (el && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!document.body.contains(rc)) { ro.disconnect(); return; }
      check();
    });
    ro.observe(el);
  }
  void ctx;
}

/** The section's own label, so the tab is named in one place. */
export function recoveryTabLabel() {
  return ringReady() ? 'Oura Ring' : null;
}
