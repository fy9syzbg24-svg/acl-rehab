// The plan. Round 3 (2026-09-30): the spectrum ribbon with its glass lens leads, then the days
// to the stage, the month card, the chosen stage as tiles and bullet bars, and the shelf.
// Markers are never a measure of the knee's healing: each is the plan's own target, with the
// source it names; the ribbon colours the calendar and never fills to show progress.

import { esc, todayIso, addDays, fmtDateShort, daysBetween } from '../util.js';
import { state, update } from '../store.js';
import { planOf, activeVersion, revisionOf, monthForDate, monthShort, monthLong } from '../../data/plan.js';
import { goalProgress, monthCompletion } from '../goals.js';
import { markerRows, focusTiles, targetTiles, bindMarkers, monthElapsed, shortCat } from './monthboard.js';
import { renderJourney, bindJourney, renderRoad, RIBBON, RIBBON_ON, renderRibbon, bindRibbon,
  stageCountdown, stageIndexAt, monthForStage, performedShows } from './journey.js';
import { menu, sheet, INFO, CHEV } from './pkit.js';
import { CATEGORIES } from '../../data/measurements.js';
import { REHAB_PROGRAM, GYM_PROGRAM } from '../../data/program.js';
import { exerciseById, pictureFor } from '../components.js';
import { catGlyph } from '../glyphs.js';
import { frameHtml } from '../frames.js';
import { liteMotion } from '../motion.js';
import { haptic } from '../native-bridge.js';

export { goalProgress, monthCompletion };


// Which plan the page shows: the one in use unless he picked the other. Both
// are kept (his call, 19 Sep 2026): the original document to look back at or
// go back to, the revision to run on. From 22 Sep there is ONE plan (his call):
// the original is kept for reference behind a link at the foot of the page and
// can no longer be switched to from here.
function viewedVersion(ctx) {
  const active = activeVersion(state.data);
  if (!revisionOf(state.data)) return 'original';
  return ctx.planView === 'original' || ctx.planView === 'revised' ? ctx.planView : active;
}

// Stages or months (his ask, 22 Sep): round 3 folds the months view into the ribbon itself.
// The lens picks a stage AND a month (the cells under the road), and the month card shows that
// month's calendar and key dates, so one page answers both questions (the old menu is gone).

/** A tile's deadline in the app's date format, the year left off (the plan is one season). */
const dueText = (iso) => fmtDateShort(iso).replace(/, \d{4}$/, '');

/**
 * The month view: each goal sits in the month its stage is due, counted once
 * ("anything I wanted done by the end of that month", his words). A stage due
 * on the 1st belongs to the month before, so leaving on 1 Feb reads as January.
 */
export function monthsOfStages(stages) {
  const byKey = new Map();
  stages.forEach((s, i) => {
    const key = addDays(s.end, s.end.endsWith('-01') ? -1 : 0).slice(0, 7);
    if (!byKey.has(key)) byKey.set(key, { id: `mo-${key}`, key, stages: [] });
    byKey.get(key).stages.push({ s, i });
  });
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).map((mo) => {
    const d = new Date(mo.key + '-15T12:00:00');
    return { ...mo, label: d.toLocaleDateString('en-US', { month: 'short' }),
      long: d.toLocaleDateString('en-US', { month: 'long' }),
      goals: mo.stages.flatMap(({ s }) => s.goals), last: mo.key + '-31' };
  });
}

export function renderPlan(ctx) {
  const today = todayIso();
  const version = viewedVersion(ctx);
  const active = activeVersion(state.data);
  const { months: MONTHS, meta } = planOf(state.data, version);
  const current = monthForDate(today, MONTHS);
  const stages = !!MONTHS[0].short && MONTHS.every((x) => x.start && x.end);
  const rev = revisionOf(state.data);
  const reference = rev && version === 'original' && active !== 'original';
  const m = MONTHS.find((x) => x.id === ctx.openMonth) || current || MONTHS[0];
  if (!stages || reference || (rev && active === 'original')) return renderReference(ctx, today, { version, active, MONTHS, meta, current, m, rev, reference });

  // Round 3 (2026-09-30), his words: "i think the plan page on the new app still looks a bit
  // stale" and "i do like the multicolor of this from the legacy ... be creative!". The plan is
  // led by the spectrum ribbon with its glass lens (journey.js renderRibbon): drag the lens to
  // scrub stages and months, the cards under it follow. Then the days to the stage (A8, the
  // plan's own date marked show), the month card (a calendar in the ribbon's colours with the
  // key dates beside it), the chosen stage as tiles and bullet bars, and the shelf of what he
  // has kept (plan 2.12: markers met and exercises the program has moved past, gold edged,
  // never vanished). Tiles and two or three word headings, no paragraphs (his rule for Plan).
  const key = monthKeyValid(ctx.planMonth, MONTHS) || monthForStage(m, today);
  return `
  <div class="stack plan-page pl4">
    <header class="pagehead">
      <h1>${esc(meta.title || 'The Plan')}</h1>
    </header>
    <section class="p4-hero">
      ${renderRibbon(ctx, today, { selected: m.id, month: key, months: MONTHS, meta })}
      ${countdownHtml(today, meta, MONTHS)}
    </section>
    <div class="p4-cards" data-p4-cards>${cardsHtml(m, key, MONTHS, meta, today, current)}</div>
    ${shelfHtml(MONTHS, today)}
    ${rev ? `<button class="p4-foot" data-planview="original">Original plan, August 2026${CHEV}</button>` : ''}
    ${meta.source ? `<button type="button" class="p4-foot p4-src" data-plan-src>Where the plan comes from${INFO}</button>` : ''}
  </div>`;
}

/** A 'YYYY-MM' the plan covers, or null. */
function monthKeyValid(key, months) {
  if (!/^\d{4}-\d\d$/.test(String(key || ''))) return null;
  return key >= months[0].start.slice(0, 7) && key <= months[months.length - 1].end.slice(0, 7) ? key : null;
}

const longDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * A8, days to the stage: the number big, his plan's own label under it, the date after it. A
 * plain count (no "only", no "left!", no bar). Tapping it moves the lens to the stage holding
 * that date. On the day: "Today" in ink (gold means finished, not arrived).
 */
function countdownHtml(today, meta, months) {
  const c = stageCountdown(today, meta);
  if (!c) return '';
  const inPlan = c.date >= months[0].start && c.date <= months[months.length - 1].end;
  const st = inPlan ? months[stageIndexAt(months, c.date)] : null;
  return `<button type="button" class="p4-count ${c.today ? 'is-today' : ''}" ${st ? `data-p4-count="${esc(st.id)}" data-p4-countmonth="${c.date.slice(0, 7)}"` : ''}
    aria-label="${esc(c.today ? `Today: ${c.label}` : `${c.days} days to ${c.label}, ${longDay(c.date)}`)}">
    <b class="p4-cn">${c.today ? 'Today' : rollDigits(c.days)}</b>
    <span class="p4-ct"><b>${c.today ? '' : `${c.days === 1 ? 'day' : 'days'} to `}${esc(c.label)}</b><small>${esc(longDay(c.date))}</small></span>
  </button>`;
}

/**
 * A number whose digits roll into place once on arrival (round 3 #3): each digit is a slot, a
 * strip of 0 to 9 that settles on its own figure with a short stagger. The strip is decoration;
 * the accessible name carries the number. Reduce Motion and light motion: drawn settled.
 */
function rollDigits(n) {
  return `<span class="p4-roll" aria-hidden="true">${String(n).split('').map((d, k) =>
    `<span class="p4-slot" style="--d:${d};--k:${k}"><span>${'0123456789'.split('').map((x) => `<i>${x}</i>`).join('')}</span></span>`).join('')}</span>`;
}

/** The two cards the ribbon drives: the month, then the stage. */
function cardsHtml(m, key, months, meta, today, current) {
  const i = months.indexOf(m);
  return `${monthCardHtml(key, months, meta, today)}
    <div class="p4-stagewrap" data-p4-stage>${stageCardHtml(m, i, today, m.id === current?.id)}</div>`;
}

// ------------------------------------------------------------- the month card --
/** Every key date in a month: the stages' own dates first, the plan's list only for a day no stage names. */
function datesIn(key, months, meta) {
  const inMonth = (d) => d && typeof d.date === 'string' && d.date.slice(0, 7) === key;
  const out = months.flatMap((s) => (s.card?.dates || []).filter(inMonth).map((d) => ({ ...d })));
  const days = new Set(out.map((d) => d.date));
  for (const d of (meta.dates || []).filter(inMonth)) if (!days.has(d.date)) { out.push({ ...d, sub: d.sub || d.note }); days.add(d.date); }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The month as a calendar in the ribbon's own colours: every day tinted by the stage it falls
 * in (past days keep their colour, his T21), key dates filled solid, today ringed turquoise,
 * a performed show as a small ink dot. Beside it the key dates, one line each (the plan's
 * words behind a tap, never a paragraph). A stage due this month names itself in the head.
 */
function monthCardHtml(key, months, meta, today) {
  const [y, mo] = key.split('-').map(Number);
  const nDays = new Date(y, mo, 0).getDate();
  const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
  const dates = datesIn(key, months, meta);
  const keyDays = new Set(dates.map((d) => d.date));
  const shows = performedShows().filter((s) => s.date.slice(0, 7) === key);
  const showDays = new Set(shows.map((s) => s.date));
  const span0 = months[0].start, span1 = months[months.length - 1].end;
  const idxAt = (iso) => (iso >= span0 && iso <= span1 ? stageIndexAt(months, iso) : -1);
  const title = new Date(`${key}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  // The key to the calendar's colours: each stage that runs this month, with its word (the
  // colour never stands alone) and where it starts or is due.
  const md = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const legend = months.map((s, i) => ({ s, i })).filter(({ s }) => s.start.slice(0, 7) <= key && s.end.slice(0, 7) >= key
    && !(s.start.slice(0, 7) < key && s.end === `${key}-01`))
    .map(({ s, i }) => {
      const ends = s.end.slice(0, 7) === key;
      const starts = s.start.slice(0, 7) === key && s.start !== span0;
      const when = ends ? `due ${md(s.end)}` : starts ? `from ${md(s.start)}` : 'all month';
      return `<span class="p4-leg" style="--c:${RIBBON[i]}"><i></i><b>${esc(s.short)}</b><em>${esc(when)}</em></span>`;
    }).join('');
  const cells = [];
  for (let k = 0; k < lead; k++) cells.push('<i class="p4-d blank"></i>');
  for (let d = 1; d <= nDays; d++) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    const i = idxAt(iso);
    const cls = [i < 0 ? 'off' : '', keyDays.has(iso) ? 'key' : '', iso === today ? 'today' : '', showDays.has(iso) ? 'show' : '', iso < today ? 'past' : ''].filter(Boolean).join(' ');
    cells.push(`<i class="p4-d ${cls}" style="${i >= 0 ? `--c:${RIBBON[i]};--on:${RIBBON_ON[i]}` : ''}">${d}</i>`);
  }
  // One badge per day: several events on one date stack beside it (the 23rd holds three).
  const byDay = [];
  dates.forEach((d, n) => {
    const last = byDay[byDay.length - 1];
    if (last && last.date === d.date) last.items.push({ d, n }); else byDay.push({ date: d.date, items: [{ d, n }] });
  });
  const rows = byDay.map(({ date, items }) => {
    const i = idxAt(date);
    return `<div class="p4-date ${date < today ? 'past' : ''}" style="${i >= 0 ? `--c:${RIBBON[i]};--on:${RIBBON_ON[i]}` : ''}">
      <span class="p4-dd">${Number(date.slice(8, 10))}</span>
      <span class="p4-dl">${items.map(({ d, n }) => `<button type="button" data-p4-date="${n}">${esc(d.label)}</button>`).join('')}</span></div>`;
  }).join('') + shows.map((s) => `<div class="p4-date show"><span class="p4-dd">${Number(s.date.slice(8, 10))}</span><span class="p4-dl"><b>The show${s.count > 1 ? `, ${s.count} shows` : ''}</b></span></div>`).join('');
  return `<section class="p4-month" data-p4-month="${key}" aria-label="${esc(title)}">
    <div class="p4-mhead"><h2>${esc(title)}</h2></div>
    <div class="p4-mbody">
      <div class="p4-cal" role="img" aria-label="${esc(`${title}: ${dates.length} key date${dates.length === 1 ? '' : 's'}`)}">
        ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l) => `<i class="p4-wd">${l}</i>`).join('')}
        ${cells.join('')}
      </div>
      <div class="p4-dates">
        <div class="p4-legend">${legend}</div>
        ${rows || '<span class="p4-none">No key dates</span>'}</div>
    </div>
  </section>`;
}

// ------------------------------------------------------------- the stage card --
/**
 * The chosen stage: its swatch, name and dates, three chips (the day, the phase, markers met),
 * then the markers still open as bullet bars (left blue, right orange, the target a tick;
 * monthboard.js markerRows). Met markers move to the shelf with one gold line pointing there.
 * Then tiles: what the evaluation found, each week, the gate in; focus and the plan's notes one
 * tap away. `readOnly` for the sheet on Progress (recording stays on Plan).
 */
function stageCardHtml(m, i, today, isNow, { readOnly = false } = {}) {
  const colour = RIBBON[i] || 'var(--ink-2)';
  const goals = m.goals.map((g) => ({ g, p: goalProgress(g) }));
  const open = goals.filter((x) => !x.p.done);
  const met = goals.length - open.length;
  const at = today > m.end ? m.end : today < m.start ? m.start : today;
  const el = monthElapsed(m, at);
  const stateWord = isNow ? `Day ${el.gone} of ${el.total}` : m.end < today ? 'Ended' : `In ${daysBetween(today, m.start)} days`;
  const c = m.card || {};
  const comp = monthCompletion(m);
  const weekly = (m.weeklyTargets || []).filter((t) => !t.cats.includes('*'));
  const when = String(c.found?.when || '').replace(/^(\d{1,2}) ([A-Z][a-z]{2})\b/, '$2 $1');
  const markersB = `<div class="p4-block">
      <div class="p4-h"><h3>Markers</h3><span>${open.length ? `${open.length} open` : 'All met'}</span></div>
      ${open.length ? markerRows(open, { colour }) : ''}
      ${met && !readOnly ? `<button type="button" class="p4-toshelf" data-p4-toshelf>${GOLDCHECK}<span>${met} met, on the shelf</span>${CHEV}</button>` : ''}
      ${open.filter((x) => x.g.caution).map((x) => `<p class="pm-caution">${esc(x.g.caution)}</p>`).join('')}
    </div>`;
  const evalB = !readOnly && c.found?.tiles?.length ? `<div class="p4-block">
      <div class="p4-h"><h3>Evaluation</h3>${when ? `<span>${esc(when)}</span>` : ''}</div>
      <div class="p4-tiles">${c.found.tiles.map((t, k) => `<div class="p4-tile" style="--i:${k}">
        <small class="${t.leg === 'L' ? 'L' : t.leg === 'R' ? 'R' : ''}">${esc(t.t)}</small><b>${esc(t.v)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}</div>`).join('')}</div>
    </div>` : '';
  const weeklyB = readOnly || !weekly.length ? '' : `<div class="p4-block">
      <div class="p4-h"><h3>Each week</h3></div>
      <div class="p4-tiles wk">${weekly.map((t, k) => {
        const goal = state.data.settings.weeklyOverrides?.[t.id] ?? t.target;
        const cat = t.cats[0];
        return `<div class="p4-tile p4-wk" style="--i:${k};--c:${CATEGORIES[cat]?.color || 'var(--ink-2)'}" title="${esc(t.label)}">
          <span class="p4-wg">${catGlyph(cat, 18)}</span><small>${esc(shortCat(t.label))}</small><b>${goal}<em> a week</em></b></div>`;
      }).join('')}</div>
    </div>`;
  const gatesB = readOnly || !c.gates?.length ? '' : `<div class="p4-block">
      <div class="p4-h"><h3>Gate in</h3></div>
      <div class="p4-tiles">${c.gates.map((g, k) => `<div class="p4-tile gate" style="--i:${k}"><b>${esc(g.t)}</b>${g.sub ? `<span>${esc(g.sub)}</span>` : ''}</div>`).join('')}</div>
    </div>`;
  const rowsB = readOnly ? '' : `<div class="p4-rows">
      ${comp.focusTotal ? `<button type="button" class="p4-row" data-plan-focus="${esc(m.id)}"><span>Focus</span><em>${isNow ? `${comp.focusDone} of ${comp.focusTotal} touched` : `${comp.focusTotal} items`}</em>${CHEV}</button>` : ''}
      ${(c.notes || []).map((n, k) => `<button type="button" class="p4-row" data-plan-note="${esc(m.id)}:${k}"><span>${esc(n.h)}</span>${CHEV}</button>`).join('')}
    </div>`;
  // The iPad (wide and tall, never an iPhone held sideways): the markers stand in a column of
  // their own beside everything else about the stage (rt-plan.css `.p4-two`, two columns from
  // 620 pt of content). Elsewhere the blocks stack in the order they always had.
  const body = !readOnly && planWide()
    ? `<div class="p4-two"><div class="p4-cA">${markersB}</div><div class="p4-cB">${evalB}${weeklyB}${gatesB}${rowsB}</div></div>`
    : `${markersB}${evalB}${weeklyB}${gatesB}${rowsB}`;
  return `<section class="p4-stage" style="--mc:${colour};--on:${RIBBON_ON[i] || '#fff'}">
    <div class="p4-sh">
      <span class="p4-sw" aria-hidden="true"></span>
      <div class="p4-shn"><h2>${esc(m.short || monthShort(m))}</h2>${m.title ? `<small>${esc(m.title)}</small>` : ''}</div>
      <span class="p4-range">${esc(dueText(m.start))} to ${esc(dueText(m.end))}</span>
    </div>
    <div class="p4-chips">
      <span class="p4-chip ${isNow ? 'now' : ''}">${esc(stateWord)}</span>
      ${m.melbournePhase ? `<span class="p4-chip">Phase ${esc(String(m.melbournePhase))}</span>` : ''}
      <span class="p4-chip met"><b>${met}</b> of ${goals.length} met</span>
    </div>
    ${body}
  </section>`;
}

/** The iPad's plan layout (see stageCardHtml): wide AND tall, and a page at least 620 pt across. */
function planWide() {
  try {
    return matchMedia('(min-width: 700px) and (min-height: 560px)').matches && (document.getElementById('view')?.clientWidth || 0) - 32 >= 620;
  } catch { return false; }
}

const GOLDCHECK = '<svg class="p4-gc" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';

// ------------------------------------------------------------------ the shelf --
/**
 * Exercises the program has moved past: logged on two or more days, not in the program now,
 * and not logged in the last two weeks. Facts from his record only (names, days, the last
 * date); nothing is judged or guessed.
 */
function earlierExercises(today) {
  const now = new Set(REHAB_PROGRAM.concat(GYM_PROGRAM).map((p) => p.ex));
  const by = new Map();
  for (const [iso, day] of Object.entries(state.data.days || {})) {
    for (const e of day?.entries || []) {
      if (!e || !e.logged || !e.ex || now.has(e.ex)) continue;
      const o = by.get(e.ex) || { ex: e.ex, days: new Set(), last: iso };
      o.days.add(iso);
      if (iso > o.last) o.last = iso;
      by.set(e.ex, o);
    }
  }
  const cut = addDays(today, -14);
  return [...by.values()].filter((o) => o.days.size >= 2 && o.last < cut && exerciseById(o.ex))
    .sort((a, b) => (a.last > b.last ? -1 : 1));
}

/**
 * The shelf (plan 2.12): what he has kept. Markers met (once each, however many stages repeat
 * them) with a gold edge, gold meaning finished; then the exercises the program has moved past,
 * each with its picture. A shelf, not a list: one row that scrolls sideways. Nothing here is a
 * comparison or a streak. A marker he ticked himself can be put back from its tile.
 */
function shelfHtml(months, today) {
  const seen = new Set();
  const met = [];
  months.forEach((m, i) => m.goals.forEach((g) => {
    const p = goalProgress(g);
    if (!p.done || seen.has(g.text)) return;
    seen.add(g.text);
    met.push({ g, p, m, i });
  }));
  const old = earlierExercises(today);
  if (!met.length && !old.length) return '';
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
  const metTiles = met.map(({ g, p, m, i }, k) => {
    const inner = `<span class="p4-kst" style="--c:${RIBBON[i]}"><i></i>${esc(m.short)}</span>
      <b class="p4-kt">${esc(g.text)}</b>${p.detail ? `<small>${esc(cap(p.detail))}</small>` : ''}`;
    return p.manual
      ? `<button type="button" class="p4-kept" style="--i:${k}" data-shelf-undo="${esc(g.id)}" aria-label="${esc(`${g.text}, met. Options`)}">${inner}</button>`
      : `<div class="p4-kept" style="--i:${k}">${inner}</div>`;
  }).join('');
  const oldTiles = old.map((o, k) => {
    const ex = exerciseById(o.ex);
    const img = pictureFor(o.ex)?.img;
    return `<div class="p4-kept ex" style="--i:${met.length + k}">
      ${img ? `<span class="p4-kpic">${frameHtml(img, { size: 56, radius: 12 })}</span>`
        : `<span class="p4-kpic glyph" style="--c:${CATEGORIES[ex?.cat]?.color || 'var(--ink-2)'}">${catGlyph(ex?.cat, 28)}</span>`}
      <b class="p4-kt">${esc(ex?.name || o.ex)}</b><small>${o.days.size} days, last ${esc(dueText(o.last))}</small></div>`;
  }).join('');
  return `<section class="p4-shelf" id="p4-shelf" aria-label="The shelf">
    <div class="p4-h"><h3>The shelf</h3><span>${met.length ? `${met.length} met` : ''}${met.length && old.length ? ' · ' : ''}${old.length ? `${old.length} earlier` : ''}</span></div>
    <div class="p4-shelfrow">${metTiles}${oldTiles}</div>
  </section>`;
}

/** The original plan, or a plan without stage dates: the v3 page (road and the stage below). */
function renderReference(ctx, today, { version, active, MONTHS, meta, current, m, rev, reference }) {
  const my = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = my(MONTHS[0].start);
  const last = my(MONTHS[MONTHS.length - 1].end);
  const stages = !!MONTHS[0].short;
  return `
  <div class="stack plan-page plan3 pl3">
    <header class="pagehead">
      <h1>${esc(meta.title || '6-Month Plan')}</h1>
      <div class="lede">${esc(first)} to ${esc(last)}</div>
    </header>
    ${reference ? `<div class="plan-refnote"><b>Original plan, August 2026</b><span>Kept for reference. Its goals live on in the plan.</span>
      <button class="btn sm" data-planview="revised">Back to the plan</button></div>` : ''}
    ${rev && active === 'original' ? `<div class="plan-ver" role="group" aria-label="Which plan to show">
      ${[['revised', 'New Plan'], ['original', 'Original Plan']].map(([v, name]) => `
      <button class="${version === v ? 'on' : ''}" data-planview="${v}" aria-pressed="${version === v}">
        <b>${esc(name)}</b><small>${active === v ? 'In use' : 'Not in use'}</small>
      </button>`).join('')}
    </div>
    ${version !== active ? `<button class="btn primary plan-use" data-useplan="${esc(version)}">Use this plan</button>` : ''}` : ''}
    <section class="pl-roadcard ${reference ? 'plan-ref' : ''}">
      ${roadHead(null, rev && !reference ? meta.source : '')}
      ${stages && m.start ? renderRoad(ctx, today, { selected: m.id, months: MONTHS, meta }) : renderJourney(ctx, today, { selected: m.id, months: MONTHS, meta, heading: null })}
    </section>
    <div class="${reference ? 'plan-ref' : ''}">${monthCard(m, today, m.id === current?.id, RIBBON[MONTHS.indexOf(m)] || 'var(--ink-2)')}</div>
  </div>`;
}

/** The road's heading on the reference page: the source behind an (i). */
function roadHead(mode, source) {
  return `<div class="pl-roadhead">
    <h2>The stages</h2>
    ${source ? `<button type="button" class="pl-i" data-plan-src aria-label="Where the plan comes from">${INFO}</button>` : ''}
  </div>`;
}

const MON = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
const DAY = (iso) => Number(iso.slice(8, 10));

/** A stage's own card: dates, what was found, the gate in, good to know. Visual, never a paragraph. */
function stageExtras(m, today, where = 'top') {
  const c = m.card;
  if (!c) return '';
  const out = [];
  // Gate In and Good to Know sit at the bottom of the stage (his call, 19 Sep);
  // Key Dates and what was found stay above the markers.
  const top = where === 'top';
  if (top && c.dates?.length) {
    out.push(`<section class="pm-sec"><h2 class="ov-h">Key dates</h2>
      <div class="sc-dates n${c.dates.length}">${c.dates.map((d) => `
        <div class="sc-date ${d.date < today ? 'past' : ''}">
          <div class="sc-cal"><b>${DAY(d.date)}</b><small>${esc(MON(d.date))}</small></div>
          <div class="sc-dtext"><b>${esc(d.label)}</b>${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</div>
        </div>`).join('')}</div></section>`);
  }
  if (top && c.found?.tiles?.length) {
    // Fix d-progress:d26: one grouped list, not six look alike tiles (Never 3); the date the
    // app's way, month first ("Sep 11", C30), whatever order the plan's text used.
    const when = String(c.found.when || '').replace(/^(\d{1,2}) ([A-Z][a-z]{2})\b/, '$2 $1');
    out.push(`<section class="pm-sec pl-sec"><div class="pl-mhead"><h2 class="pl-h">What the evaluation found</h2>${when ? `<span class="pm-days">${esc(when)}</span>` : ''}</div>
      <div class="pl-found">${c.found.tiles.map((t, i) => `
        <div class="pl-frow" style="--i:${i}">
          <span class="pl-fk ${t.leg === 'L' ? 'L' : t.leg === 'R' ? 'R' : ''}">${esc(t.t)}</span>
          <span class="pl-fv"><b>${esc(t.v)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span>
        </div>`).join('')}</div></section>`);
  }
  if (!top && c.gates?.length) {
    out.push(`<section class="pm-sec"><h2 class="ov-h">Gate in</h2>
      <div class="sc-tiles n${c.gates.length}">${c.gates.map((g, i) => `
        <div class="sc-tile gate" style="--i:${i}"><b>${esc(g.t)}</b>${g.sub ? `<span>${esc(g.sub)}</span>` : ''}</div>`).join('')}</div></section>`);
  }
  if (!top && c.notes?.length) {
    // The notes are sentences (his clinicians' words, kept word for word), so they sit one tap
    // away as rows that open, never as paragraphs on the page.
    out.push(`<section class="pm-sec pl-sec"><h2 class="pl-h">Good to know</h2>
      <div class="pl-notes">${c.notes.map((n, i) => `<button type="button" class="pl-note" data-plan-note="${esc(m.id)}:${i}">${esc(n.h)}${CHEV}</button>`).join('')}</div></section>`);
  }
  return out.join('');
}

/** The chosen stage's head: its name, dates and three chips (the day, the phase, the markers met). */
function stageHead(m, today, isNow, colour) {
  const goals = m.goals.map((g) => ({ g, p: goalProgress(g) }));
  const met = goals.filter((x) => x.p.done).length;
  const at = today > m.end ? m.end : today < m.start ? m.start : today;
  const el = monthElapsed(m, at);
  const range = `${dueText(m.start)} to ${dueText(m.end)}`;
  const state = isNow ? `Day ${el.gone} of ${el.total}` : m.end < today ? 'Done' : `In ${daysBetween(today, m.start)} days`;
  return `
  <section class="pl-stage" style="--mc:${colour}">
    <div class="pl-stagehead">
      <span class="pl-swatch" aria-hidden="true"></span>
      <h2>${esc(m.short || monthShort(m))}</h2>
      <span class="pl-range">${esc(range)}</span>
    </div>
    <div class="pl-chips">
      <span class="pl-chip ${isNow ? 'now' : ''}">${esc(state)}</span>
      ${m.melbournePhase ? `<span class="pl-chip">Phase ${esc(String(m.melbournePhase))}</span>` : ''}
      <span class="pl-chip met"><b>${met}</b> of ${goals.length} met</span>
    </div>
  </section>`;
}

function monthCard(m, today, isNow, colour) {
  const goals = m.goals.map((g) => ({ g, p: goalProgress(g) }));
  return `${stageHead(m, today, isNow, colour)}
  ${stageExtras(m, today)}
  <section class="pm-sec pl-sec">
    <h2 class="pl-h">Markers</h2>
    ${markerRows(goals, { colour })}
    ${goals.some((x) => x.g.caution) ? goals.filter((x) => x.g.caution).map((x) => `<p class="pm-caution">${esc(x.g.caution)}</p>`).join('') : ''}
  </section>
  <section class="pm-sec pl-sec">
    ${isNow ? focusTiles(m, m.start, m.end, { title: 'Focus so far' })
      // A stage not under way keeps its focus one tap away (the plan's own words, in a sheet).
      : `<h2 class="pl-h">Focus</h2><button type="button" class="pl-note pl-focusrow" data-plan-focus="${esc(m.id)}">${m.focus.reduce((n, f) => n + f.items.length, 0)} items${CHEV}</button>`}
  </section>
  <section class="pm-sec pl-sec">
    ${targetTiles(m, { title: 'Each week' })}
  </section>
  ${stageExtras(m, today, 'bottom')}`;
}

/**
 * A stage in a sheet, picked in place: the road at the top of Progress opens this and never
 * jumps to the Plan tab (his call, 23 Sep; rehab SKILL A59). The same road picks another stage
 * inside the sheet; the head and the markers follow. The plan in use, read only here: recording
 * a result stays on the Plan tab, where the marker rows keep their buttons.
 */
export function openStageSheet(ctx, id = null) {
  const { months: MONTHS, meta } = planOf(state.data, activeVersion(state.data));
  if (!MONTHS.length) return;
  const today = todayIso();
  const current = monthForDate(today, MONTHS);
  let sel = id || current?.id || MONTHS[0].id;
  const dated = MONTHS.every((x) => x.start && x.end);
  const card = () => {
    const m = MONTHS.find((x) => x.id === sel) || current || MONTHS[0];
    return stageCardHtml(m, MONTHS.indexOf(m), today, m.id === current?.id, { readOnly: true });
  };
  const m0 = MONTHS.find((x) => x.id === sel) || MONTHS[0];
  const body = `<div class="pl-sheetbody p4-sheet">
    ${dated ? renderRibbon(ctx, today, { selected: m0.id, months: MONTHS, meta }) : ''}
    <div data-p4-stage>${card()}</div>
  </div>`;
  sheet({ title: meta.title || 'The plan', body, cls: 'pl-stagesheet', onMount(el) {
    const host = el.querySelector('[data-p4-stage]');
    const show = (sid) => { if (sid === sel || !host) return; sel = sid; host.innerHTML = card(); };
    bindRibbon(el, { months: MONTHS, onScrub: show, onPick: show });
  } });
}

/** The handlers inside the two cards (bound again whenever the ribbon swaps them). */
function bindCards(host, ctx, rerender) {
  const version = viewedVersion(ctx);
  host.querySelectorAll('[data-plan-focus]').forEach((b) => b.addEventListener('click', () => {
    const { months } = planOf(state.data, version);
    const st = months.find((x) => x.id === b.dataset.planFocus);
    if (!st) return;
    const now = todayIso();
    const live = now >= st.start && now <= st.end;
    sheet({ title: `${st.short || monthShort(st)} focus`,
      body: `<div class="pl-srcsheet">${live ? focusTiles(st, st.start, st.end, { title: '' })
        : `<ul class="p4-focus">${st.focus.flatMap((f) => f.items).map((it) => `<li>${esc(it.t)}</li>`).join('')}</ul>`}</div>`,
      onMount(el) { bindMarkers(el, ctx, rerender); } });
  }));
  host.querySelectorAll('[data-plan-note]').forEach((b) => b.addEventListener('click', () => {
    const [id, i] = b.dataset.planNote.split(':');
    const { months } = planOf(state.data, version);
    const n = months.find((x) => x.id === id)?.card?.notes?.[Number(i)];
    if (n) sheet({ title: n.h, body: `<div class="pl-srcsheet"><p>${esc(n.t)}</p></div>` });
  }));
  // A key date: the plan's own words for it, one tap away (never a paragraph on the page).
  host.querySelectorAll('[data-p4-date]').forEach((b) => b.addEventListener('click', () => {
    const { months, meta } = planOf(state.data, version);
    const key = b.closest('[data-p4-month]')?.dataset.p4Month;
    const d = key ? datesIn(key, months, meta)[Number(b.dataset.p4Date)] : null;
    if (!d) return;
    sheet({ title: d.label, body: `<div class="pl-srcsheet"><p class="p4-when">${esc(longDay(d.date))}</p>${d.sub ? `<p>${esc(d.sub)}</p>` : ''}</div>` });
  }));
  host.querySelector('[data-p4-toshelf]')?.addEventListener('click', () => {
    const shelf = document.getElementById('p4-shelf');
    if (!shelf) return;
    shelf.scrollIntoView({ behavior: liteMotion() ? 'auto' : 'smooth', block: 'center' });
    shelf.classList.remove('flash');
    void shelf.offsetWidth;
    shelf.classList.add('flash');
  });
  bindMarkers(host, ctx, rerender);
}

export function bindPlan(root, ctx, rerender) {
  root.querySelectorAll('[data-planview]').forEach((b) => b.addEventListener('click', () => {
    ctx.planView = b.dataset.planview;
    ctx.openMonth = null;
    rerender();
    window.scrollTo(0, 0);
  }));
  root.querySelectorAll('[data-plan-src]').forEach((b) => b.addEventListener('click', () => {
    const meta = planOf(state.data, viewedVersion(ctx)).meta;
    sheet({ title: meta.title || 'The plan', body: `<div class="pl-srcsheet"><p>${esc(meta.source || '')}</p><p class="pl-srcnote">Every progression names its source.</p></div>` });
  }));
  root.querySelector('[data-useplan]')?.addEventListener('click', (ev) => {
    const v = ev.currentTarget.dataset.useplan;
    update((d) => { d.settings.planVersion = v; });
    ctx.planView = v;
    rerender();
  });

  const cards = root.querySelector('[data-p4-cards]');
  if (!cards) {
    // The reference page (the original plan): the v3 road and stage.
    bindCards(root, ctx, rerender);
    bindJourney(root, ctx, rerender);
    return;
  }
  const { months: MONTHS, meta } = planOf(state.data, viewedVersion(ctx));
  const today = todayIso();
  const current = monthForDate(today, MONTHS);
  let shown = `${ctx.openMonth || current?.id || MONTHS[0].id}|${ctx.planMonth || ''}`;
  // The ribbon drives the cards in place: a scrub swaps them at once, a release keeps them and
  // slides the new stage in from the side it came from. Nothing is repainted around them, so
  // the finger never loses the lens.
  const swap = (id, key, { slide = 0 } = {}) => {
    const m = MONTHS.find((x) => x.id === id);
    if (!m) return;
    const sig = `${id}|${key}`;
    if (sig === shown) return;
    const [oldId, oldKey] = shown.split('|');
    shown = sig;
    ctx.openMonth = id;
    ctx.planMonth = key;
    const monthEl = cards.querySelector('[data-p4-month]');
    const stageEl = cards.querySelector('[data-p4-stage]');
    if (key !== oldKey && monthEl) {
      monthEl.outerHTML = monthCardHtml(key, MONTHS, meta, today);
      bindCards(cards.querySelector('[data-p4-month]'), ctx, rerender);
    }
    if (id !== oldId && stageEl) {
      stageEl.innerHTML = stageCardHtml(m, MONTHS.indexOf(m), today, m.id === current?.id);
      bindCards(stageEl, ctx, rerender);
      const dir = slide || (MONTHS.findIndex((x) => x.id === id) > MONTHS.findIndex((x) => x.id === oldId) ? 1 : -1);
      if (!liteMotion() && stageEl.animate) {
        stageEl.animate([{ transform: `translateX(${dir * 28}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }],
          { duration: 360, easing: 'cubic-bezier(.22, 1.05, .36, 1)' });
      }
    }
  };
  bindRibbon(root, {
    months: MONTHS,
    onScrub: (id, key) => swap(id, key),
    onPick: (id, key) => swap(id, key),
  });
  bindCards(cards, ctx, rerender);
  root.querySelector('[data-p4-count]')?.addEventListener('click', (e) => {
    const b = e.currentTarget;
    const hero = root.querySelector('.rb-hero');
    haptic('selection');
    hero?.__rbPick?.(b.dataset.p4Count, b.dataset.p4Countmonth);
  });
  // A marker he ticked himself, from its shelf tile: put it back (his tap, no confirm; Undo is
  // the same tap again from the stage, where it returns as an open marker).
  root.querySelectorAll('[data-shelf-undo]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.shelfUndo;
    const pick = await menu(b, { title: '', items: [{ id: 'undo', title: 'Not done yet' }] });
    if (pick !== 'undo') return;
    update((d) => { d.planGoals[id] = { done: false, date: todayIso() }; });
    rerender();
  }));
}
