// The six month journey, drawn as a ribbon. 2026-09-14 revision 3 (F37).
//
// The full spectrum across the calendar is the one scoped exception to the
// app's colour rules, asked for by the owner: it colours the calendar, never a
// forecast of healing, and it never fills to show progress. What it carries:
//
//   - one node per month, evenly spaced, with the month above it
//   - a strong outlined marker on the current month (neutral, not a category)
//   - a small green check on a month whose markers are all met, and nothing
//     else coloured by attainment
//   - short breaks where the Melbourne phase changes, phase names in neutral
//     ink below, the full phase text in the node's accessible name
//
// Built from HTML positioned by percentage so type stays crisp at any width.
// On Progress a node selects its stage in place (his call, 22 Sep: no jump to
// Plan); on Plan it selects the month or stage below.

import { esc, todayIso, daysBetween, addDays } from '../util.js';
import { PLAN_MONTHS, PLAN_META, monthForDate, monthShort, monthLong } from '../../data/plan.js';
import { monthCompletion } from '../goals.js';
import { haptic } from '../native-bridge.js';
import { local } from '../rtlocal.js';

// The ribbon's colour at each node, in order; tiles and marker bars of a month
// or stage take the colour of its node, so a stage reads as one colour.
// Round 3 consistency (2026-09-30): Impact was #3686ED, a blue next to the left leg's
// #0A84FF; on Progress the mini ribbon sits right above the blue L half of the figure, and
// blue MEANS the left leg in this app. Impact is indigo now and Build moves to orchid purple
// so the two stay apart; the road still runs the full spectrum (the Plan builder's own
// fallback: "if it reads as left, shift Impact to indigo").
export const RIBBON = ['#9A4DD6', '#5A5CDB', '#2AC7D5', '#3BBB81', '#E0B52E', '#EF6549'];

const PHASE_LABEL = { 1: 'Phase 1 · Early', 2: 'Phase 2 · Strength', 3: 'Phase 3 · Run and land', 4: 'Phase 4 · Performance' };

// The Melbourne phases along the ribbon: each run of months (or stages) that
// share a phase, read from the plan in view rather than fixed to six months.
function phasesOf(months) {
  const out = [];
  for (const m of months) {
    const last = out[out.length - 1];
    if (last && last.n === m.melbournePhase) last.months.push(m.n);
    else out.push({ n: m.melbournePhase, label: PHASE_LABEL[m.melbournePhase] || `Phase ${m.melbournePhase}`, short: `Phase ${m.melbournePhase}`, months: [m.n] });
  }
  return out;
}

// Months under a stage ribbon (his ask, 19 Sep 2026), as CELLS to scale since
// 2026-09-22 (the combined design he picked): each month runs from its 1st (or
// the plan's first day) to the next 1st, with a hairline where it starts and its
// name centred in it, so no tick ever hangs under a mark. A last month under 8%
// of the plan (1 Feb, one day) folds into the one before; a first month under 8%
// keeps its hairline and drops its word ("thin").
function monthCells(months) {
  const first = months[0].start;
  const last = months[months.length - 1].end;
  const total = daysBetween(first, last) + 1;
  const name = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
  const starts = [first];
  let [y, m] = first.split('-').map(Number);
  for (let guard = 0; guard < 48; guard++) {
    m++; if (m > 12) { m = 1; y++; }
    const iso = `${y}-${String(m).padStart(2, '0')}-01`;
    if (iso > last) break;
    starts.push(iso);
  }
  const cells = starts.map((iso, i) => {
    const x = (daysBetween(first, iso) / total) * 100;
    const next = i + 1 < starts.length ? (daysBetween(first, starts[i + 1]) / total) * 100 : 100;
    return { x, w: next - x, label: name(iso), key: iso.slice(0, 7) };
  });
  while (cells.length > 1 && cells[cells.length - 1].w < 8) cells[cells.length - 2].w += cells.pop().w;
  return cells;
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';


export function renderJourney(ctx, atIso = null, { selected = null, heading = null, months = PLAN_MONTHS, meta = PLAN_META } = {}) {
  const iso = atIso || todayIso();
  const current = monthForDate(iso, months);
  const n = months.length;
  const PHASES = phasesOf(months);
  if (heading === null) heading = meta.version === 'revised' ? (meta.title || 'Your Plan') : 'Your Six-Month Plan';
  // To scale (his call, 2026-09-19, Fable's idea 2): a stage takes the width of
  // its own dates, so a seven week Build no longer reads shorter than a three
  // week Impact. Equal slots remain the fallback for a plan with no end dates.
  const span0 = months[0].start, span1 = months[n - 1].end;
  const total = span1 ? daysBetween(span0, span1) + 1 : 0;
  const toScale = total > 0 && months.every((m) => m.start && m.end);
  // The start of a stage as a share of the whole plan, and the node in the
  // middle of its own stretch, pulled in at the ends so labels stay on screen.
  const startX = (i) => (toScale ? (daysBetween(span0, months[i].start) / total) * 100 : (i / n) * 100);
  const endX = (i) => (toScale ? ((daysBetween(span0, months[i].end) + 1) / total) * 100 : ((i + 1) / n) * 100);
  const x = (i) => {
    if (!toScale) return ((i + 0.5) / n) * 100;
    const mid = (startX(i) + endX(i)) / 2;
    return Math.min(96, Math.max(4, mid));
  };

  // A stage plan drawn to scale is drawn as SEGMENTS (his pick, 2026-09-22):
  // each stage is its own stretch of the ribbon and its own button, the current
  // one framed along its whole length, names in one row above. The original
  // six month road keeps its dots.
  const seg = !!months[0].short && toScale;
  const phaseAt = months.map((m) => m.melbournePhase);
  const nodes = months.map((m, i) => {
    const c = monthCompletion(m);
    const met = c.goals.filter((g) => g.done).length;
    const done = m.goals.length > 0 && met === m.goals.length;
    const now = m.id === current?.id;
    const phase = PHASES.find((p) => p.months.includes(m.n));
    const label = `${m.short ? m.short + ', ' + m.monthLabel : monthLong(m)}${now ? (m.short ? ', current stage' : ', current month') : ''}, ${phase ? phase.label + ', ' : ''}${met} of ${m.goals.length} markers met`;
    const edges = seg ? `${i > 0 && phaseAt[i - 1] !== phaseAt[i] ? 'phs' : ''} ${i < n - 1 && phaseAt[i + 1] !== phaseAt[i] ? 'phe' : ''}` : '';
    const place = seg ? `left:${startX(i).toFixed(3)}%;width:${(endX(i) - startX(i)).toFixed(3)}%` : `left:${x(i).toFixed(3)}%`;
    return `<button class="jr-node ${now ? 'now' : ''} ${done ? 'done' : ''} ${selected === m.id ? 'sel' : ''} ${edges}"
        style="${place}" data-jumpmonth="${esc(m.id)}" aria-label="${esc(label)}"
        ${selected ? `aria-pressed="${selected === m.id}"` : ''}>
        <span class="jr-month">${esc(monthShort(m))}</span>
        <i class="jr-dot">${done ? CHECK : ''}</i>
      </button>`;
  }).join('');

  // A break at each phase change, halfway between the two months' nodes. As
  // segments, a hairline at every stage change and the wider break at a phase.
  const breaks = seg
    ? months.slice(1).map((m, k) => `<i class="jr-break${phaseAt[k] === phaseAt[k + 1] ? ' st' : ''}" style="left:${startX(k + 1).toFixed(3)}%"></i>`).join('')
    : PHASES.slice(1).map((p) => {
      const i = months.findIndex((m) => m.n === p.months[0]);
      return i > 0 ? `<i class="jr-break" style="left:${startX(i).toFixed(3)}%"></i>` : '';
    }).join('');

  const phases = PHASES.map((p, k) => {
    const i = months.findIndex((m) => m.n === p.months[0]);
    const a = startX(i);
    const next = PHASES[k + 1] ? startX(months.findIndex((m) => m.n === PHASES[k + 1].months[0])) : 100;
    return `<span style="left:${a.toFixed(3)}%${seg ? `;width:${(next - a).toFixed(3)}%` : ''}" title="${esc(p.label)}">${esc(p.short)}</span>`;
  }).join('');

  // A stage picked on the road names itself here (Progress, his call 22 Sep:
  // a tap selects in place, it never jumps to the Plan tab).
  const picked = selected && selected !== current?.id ? months.find((m) => m.id === selected) : null;
  const caption = picked
    ? (picked.short ? `${esc(picked.short)}, ${esc(picked.monthLabel)}` : esc(monthLong(picked)))
    : current
    ? (current.short ? `${esc(current.short)}, ${esc(current.monthLabel)} · Current stage` : `${esc(monthLong(current))} · Current month`)
    : iso < months[0].start ? 'The plan has not started yet' : (meta.version === 'revised' ? 'The plan is complete' : 'The six months are complete');

  return `
  <section class="journey2 ${months[0].short ? 'stages' : ''} ${seg ? 'jr-seg' : ''}" aria-label="${esc(heading || meta.title || 'Your plan')}">
    ${heading ? `<h2 class="jr-title">${esc(heading)}</h2>` : ''}
    <div class="jr-road">
      <div class="jr-ribbon" aria-hidden="true">${breaks}</div>
      ${nodes}
    </div>
    ${seg ? `<div class="jr-months" aria-hidden="true">${monthCells(months).map((c) =>
      `<span class="${c.w < 8 ? 'thin' : ''}" style="left:${c.x.toFixed(3)}%;width:${c.w.toFixed(3)}%">${esc(c.label)}</span>`).join('')}</div>` : ''}
    <div class="jr-phases" aria-hidden="true">${phases}</div>
    <div class="jr-caption">${caption}</div>
  </section>`;
}

// ------------------------------------------------------------- names ----
// One row of names over the segments, each over the middle of its own stage.
// Where two would come closer than --jr-name-gap, they move apart by the least
// total amount (pool adjacent violators: least squares under an order and a
// gap), kept inside the road. If that would push a name more than 8px off its
// stage, or the names cannot fit at all, the row takes a smaller type
// (jr-tight) and is placed again. Measured, never guessed (his rule).
function placeNames(sec) {
  const road = sec?.querySelector('.jr-road');
  const labels = road ? [...road.querySelectorAll('.jr-month')] : [];
  if (!labels.length) return;
  sec.classList.remove('jr-tight');
  for (let pass = 0; pass < 2; pass++) {
    labels.forEach((l) => l.style.removeProperty('--dx'));
    const R = road.getBoundingClientRect();
    if (!R.width) return;                           // hidden: the observer runs it again when shown
    const GAP = parseFloat(getComputedStyle(road).getPropertyValue('--jr-name-gap')) || 8;
    const it = labels.map((l) => { const r = l.getBoundingClientRect(); return { x: r.left - R.left, w: r.width }; });
    let acc = 0;
    const want = it.map((o) => { const v = o.x - acc; acc += o.w + GAP; return v; });
    const hi = R.width - (acc - GAP);               // room left once every gap is kept
    if (hi < 0 && pass === 0) { sec.classList.add('jr-tight'); continue; }
    const blocks = [];
    want.forEach((v) => {
      blocks.push({ v, n: 1 });
      while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
        const b = blocks.pop(); const a = blocks[blocks.length - 1];
        a.v = (a.v * a.n + b.v * b.n) / (a.n + b.n); a.n += b.n;
      }
    });
    const fit = blocks.flatMap((b) => Array(b.n).fill(Math.min(Math.max(b.v, 0), Math.max(hi, 0))));
    const dx = fit.map((v, i) => v - want[i]);
    if (pass === 0 && Math.max(...dx.map(Math.abs)) > 8) { sec.classList.add('jr-tight'); continue; }
    labels.forEach((l, i) => { if (Math.abs(dx[i]) > 0.25) l.style.setProperty('--dx', `${dx[i].toFixed(1)}px`); });
    return;
  }
}

// Width changes (rotation, the rail, text size) place the names again.
const observed = new WeakSet();
const roadObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const e of entries) {
      if (!e.target.isConnected) { roadObserver.unobserve(e.target); continue; }
      placeNames(e.target.closest('section.journey2'));
    }
  })
  : null;

/**
 * Place every segment road's names inside root. Called when a view binds, and
 * by the shells after a soft repaint: a patch strips the offsets and the tight
 * class, which the template does not carry, and this puts them straight back
 * in the same task, so nothing is ever drawn without them.
 */
export function layoutRoads(root) {
  for (const sec of root?.querySelectorAll?.('section.journey2.jr-seg') || []) {
    placeNames(sec);
    const road = sec.querySelector('.jr-road');
    if (road && roadObserver && !observed.has(road)) { observed.add(road); roadObserver.observe(road); }
  }
}

export function bindJourney(root, ctx, rerender = null, { select = null } = {}) {
  layoutRoads(root);
  // The row is measured in the app's font; once it has loaded, measure again.
  document.fonts?.ready?.then(() => layoutRoads(root));
  root.querySelectorAll('[data-jumpmonth]').forEach((g) => g.addEventListener('click', () => {
    if (select) { select(g.dataset.jumpmonth); return; }
    ctx.openMonth = g.dataset.jumpmonth;
    if (rerender) rerender();
    // From another page the road is the plan in use: the Plan tab must open on
    // that plan, not on the original he last looked at (2026-09-22 audit).
    else { ctx.planView = null; ctx.go('plan'); }
  }));
}

// ===================================================================== v3 road ==
// Rehab Test v3 (2026-09-30): the stage road as ONE line (research 08 lesson 8, Flighty's
// line with a moving marker; 07 4.6 Plan's signature). Stages are segments to scale in the
// ribbon's own colours (the calendar, never a fill of progress: his standing rule for the
// ribbon), each named above with the date it is due under the name ("so I can kind of see a
// deadline", 23 Sep). A turquoise "you are here" needle glides along the line to today when
// the page opens (a spring; a cut under Reduce Motion). A stage whose markers are all met
// carries a small green check. The Melbourne phases sit under the line in neutral ink.
// A tap on a segment selects that stage (Plan) or opens it (elsewhere); it never jumps
// somewhere unexpected (his call, 22 Sep).

const dueShort = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function roadGeometry(months) {
  const span0 = months[0].start, span1 = months[months.length - 1].end;
  const total = daysBetween(span0, span1) + 1;
  const sx = (i) => (daysBetween(span0, months[i].start) / total) * 100;
  const ex = (i) => ((daysBetween(span0, months[i].end) + 1) / total) * 100;
  const at = (iso) => Math.max(0, Math.min(100, ((daysBetween(span0, iso) + 0.5) / total) * 100));
  return { sx, ex, at, span0, span1 };
}

export function renderRoad(ctx, atIso = null, { selected = null, months = PLAN_MONTHS, meta = PLAN_META } = {}) {
  const iso = atIso || todayIso();
  if (!months.every((m) => m.start && m.end)) return renderJourney(ctx, iso, { selected, months, meta });
  const current = monthForDate(iso, months);
  const G = roadGeometry(months);
  const PH = phasesOf(months);
  const here = iso >= G.span0 && iso <= G.span1 ? G.at(iso) : null;
  const segs = months.map((m, i) => {
    const c = monthCompletion(m);
    const met = c.goals.filter((g) => g.done).length;
    const done = m.goals.length > 0 && met === m.goals.length;
    const now = m.id === current?.id;
    const phase = PH.find((p) => p.months.includes(m.n));
    return `<button type="button" class="rd-seg ${now ? 'now' : ''} ${selected === m.id ? 'sel' : ''} ${done ? 'done' : ''} ${m.end < iso ? 'past' : ''}"
        style="left:${G.sx(i).toFixed(3)}%;width:${(G.ex(i) - G.sx(i)).toFixed(3)}%;--c:${RIBBON[i] || 'var(--ink-3)'}"
        data-jumpmonth="${esc(m.id)}" aria-pressed="${selected === m.id}"
        aria-label="${esc(`${monthShort(m)}, due ${dueShort(m.end)}${now ? ', current stage' : ''}, ${phase ? phase.label + ', ' : ''}${met} of ${m.goals.length} markers met`)}">
        <span class="jr-month"><b>${esc(monthShort(m))}${done ? CHECK : ''}</b><small>${esc(dueShort(m.end))}</small></span>
        <i class="rd-bar"></i>
      </button>`;
  }).join('');
  const phases = PH.map((p, k) => {
    const i = months.findIndex((m) => m.n === p.months[0]);
    const a = G.sx(i);
    const next = PH[k + 1] ? G.sx(months.findIndex((m) => m.n === PH[k + 1].months[0])) : 100;
    return `<span style="left:${a.toFixed(3)}%;width:${(next - a).toFixed(3)}%" title="${esc(p.label)}">${esc(p.short)}</span>`;
  }).join('');
  return `<section class="journey2 jr-seg road" aria-label="${esc(meta.title || 'The plan')}: the stages">
    <div class="jr-road">
      ${segs}
      ${here != null ? `<i class="rd-here" style="--x:${here.toFixed(3)}%" aria-hidden="true"><span>Today</span></i>` : ''}
    </div>
    <div class="rd-phases" aria-hidden="true">${phases}</div>
  </section>`;
}

/**
 * The same road, small, for the top of Progress (his call 20 Sep: the road leads Progress),
 * one line of words over a thin line: the stage, the day of it, the date it is due.
 */
export function roadStrip(atIso = null, { extra = '' } = {}) {
  const iso = atIso || todayIso();
  const months = PLAN_MONTHS;
  if (!months.length || !months.every((m) => m.start && m.end)) return '';
  const G = roadGeometry(months);
  const cur = monthForDate(iso, months);
  const here = iso >= G.span0 && iso <= G.span1 ? G.at(iso) : null;
  const day = cur ? daysBetween(cur.start, iso) + 1 : 0;
  const len = cur ? daysBetween(cur.start, cur.end) + 1 : 0;
  const words = cur
    ? `<b>${esc(monthShort(cur))}</b><span>day ${day} of ${len}</span>${extra}`
    : `<b>${iso < G.span0 ? 'Starts ' + esc(dueShort(G.span0)) : 'Plan complete'}</b>${extra}`;
  return `<button type="button" class="rd-strip" data-roadstrip="${esc(cur?.id || '')}" aria-label="${esc(cur ? `${monthShort(cur)}, day ${day} of ${len}, due ${dueShort(cur.end)}. Show the stages` : 'Show the stages')}">
    <span class="rd-strip-t">${words}</span>
    ${cur ? `<span class="rd-strip-due">Due ${esc(dueShort(cur.end))}</span>` : ''}
    <span class="rd-mini" aria-hidden="true">${months.map((m, i) => `<i class="${m.id === cur?.id ? 'now' : ''}" style="left:${G.sx(i).toFixed(3)}%;width:${(G.ex(i) - G.sx(i)).toFixed(3)}%;--c:${RIBBON[i] || 'var(--ink-3)'}"></i>`).join('')}
      ${here != null ? `<b class="rd-minihere" style="--x:${here.toFixed(3)}%"></b>` : ''}</span>
  </button>`;
}

/**
 * The strip opens the stage in place (a sheet, `open(id)`); it never jumps to the Plan tab
 * (his call 23 Sep, rehab SKILL A59: "The Progress road never jumps to Plan").
 */
export function bindRoadStrip(root, ctx, { open = null } = {}) {
  root.querySelector('[data-roadstrip]')?.addEventListener('click', (e) => {
    open?.(e.currentTarget.dataset.roadstrip || null);
  });
}

// ================================================================= r3 ribbon ==
// Round 3 (2026-09-30), his words: "i do like the multicolor of this from the legacy ... be
// creative!" and "i think the plan page on the new app still looks a bit stale". The legacy
// journey ribbon comes back as ONE thick road through the full spectrum (Build violet, Impact
// blue, Agility teal, Rehearse green, Show yellow, Tour orange: the scoped colour exception, used
// on the ribbon, the lens and a stage's own swatch only; it colours the calendar and never fills
// to show progress). Over it sits a glass LENS: the chosen stage seen through it, taller, as if
// magnified. Press and drag along the road and the lens follows the finger, a date bubble says
// where it is, the stage and month under it light up with a selection tick at every boundary,
// and the cards below follow as it moves (his "I can kinda preview"; research 10 idea #1, one
// scrub grammar). Let go: the lens springs out to the width of that stage. The turquoise
// "you are here" needle glides to today on arrival. Months sit under the road as cells to
// scale; his performed shows (rt.local, read only) are small ink dots between road and months.
// Exported for the Progress header too (renderRibbon with mini: true).

/** The road's gradient: each stage solid across its own stretch, blending only at the seams. */
export function ribbonGradient(months = PLAN_MONTHS) {
  const G = roadGeometry(months);
  const stops = months.map((m, i) => {
    const c = RIBBON[i] || '#8E8E93';
    const a = G.sx(i), b = G.ex(i);
    const pad = Math.min(1.2, (b - a) / 5);
    return `${c} ${(a + (i ? pad : 0)).toFixed(2)}%, ${c} ${(b - (i < months.length - 1 ? pad : 0)).toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Text that reads on a stage's own colour (the light hues take ink, the deep ones white). */
export const RIBBON_ON = ['#fff', '#fff', '#082A2E', '#062817', '#2A1E00', '#fff'];

/** The stage index holding a date, clamped to the plan. */
export function stageIndexAt(months, iso) {
  if (iso < months[0].start) return 0;
  const i = months.findIndex((m) => iso >= m.start && iso <= m.end);
  return i >= 0 ? i : months.length - 1;
}

/** The month a stage opens on: today's when the stage holds today, else the month holding its middle. */
export function monthForStage(m, iso = todayIso()) {
  if (iso >= m.start && iso <= m.end) return iso.slice(0, 7);
  return addDays(m.start, Math.floor(daysBetween(m.start, m.end) / 2)).slice(0, 7);
}

/** The stage a month opens on: the current one when the month holds today, else the one at the 15th. */
export function stageForMonth(months, key, iso = todayIso()) {
  if (iso.slice(0, 7) === key && iso >= months[0].start && iso <= months[months.length - 1].end) return months[stageIndexAt(months, iso)];
  const first = `${key}-01`;
  const mid = `${key}-15`;
  const pick = mid > months[months.length - 1].end ? months[months.length - 1].end : mid < months[0].start ? first : mid;
  return months[stageIndexAt(months, pick < months[0].start ? months[0].start : pick)];
}

/** Performed shows from his device store (A1, rt.local.shows), read only. Sorted dates. */
export function performedShows() {
  try {
    const s = local.get('shows', {}) || {};
    return Object.entries(s)
      .filter(([k, v]) => /^\d{4}-\d\d-\d\d$/.test(k) && v && v.performed && !v.hidden)
      .map(([k, v]) => ({ date: k, count: Number(v.count) || 1, atMs: v.atMs || null }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch { return []; }
}

/**
 * A8, days to the stage: the next date in the plan's own key dates marked `show` that is today
 * or later; if none, the next future date of any kind; if none, null. The label is his plan's
 * own words, verbatim. { days, label, date, today }. Also for Today's all done line.
 */
export function stageCountdown(atIso = null, meta = PLAN_META) {
  const iso = atIso || todayIso();
  const ahead = (meta?.dates || []).filter((d) => d && typeof d.date === 'string' && d.date >= iso)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const t = ahead.find((d) => d.show) || ahead[0];
  if (!t) return null;
  return { days: daysBetween(iso, t.date), label: String(t.label || ''), date: t.date, today: t.date === iso };
}

const monthName = (key, style = 'short') => new Date(`${key}-15T12:00:00`).toLocaleDateString('en-US', { month: style });

/**
 * The ribbon. Hero (Plan): names with the due date over each stage, the road and its lens, the
 * needle, show dots, month cells. Mini (Progress header, 20 pt): the road, the current stage
 * framed, the needle; no words. `selected` is a stage id, `month` a 'YYYY-MM' key.
 */
export function renderRibbon(ctx, atIso = null, { selected = null, month = null, months = PLAN_MONTHS, meta = PLAN_META, mini = false, shows = null } = {}) {
  const iso = atIso || todayIso();
  if (!months.length || !months.every((m) => m.start && m.end)) return mini ? '' : renderJourney(ctx, iso, { selected, months, meta, heading: null });
  const G = roadGeometry(months);
  const cur = monthForDate(iso, months);
  const si = Math.max(0, months.findIndex((m) => m.id === (selected || cur?.id)));
  const here = iso >= G.span0 && iso <= G.span1 ? G.at(iso) : null;
  const grad = ribbonGradient(months);
  const seams = months.slice(1).map((m, k) => `<i class="rb-seam${months[k].melbournePhase !== m.melbournePhase ? ' ph' : ''}" style="left:${G.sx(k + 1).toFixed(3)}%"></i>`).join('');
  const lensVars = `--l:${G.sx(si).toFixed(3)};--w:${(G.ex(si) - G.sx(si)).toFixed(3)};--grad:${grad}`;
  if (mini) {
    return `<span class="rb rb-mini" aria-hidden="true" style="--grad:${grad}">
      <span class="rb-road">${seams}</span>
      <span class="rb-lens" style="${lensVars}"><i class="rb-lensfill"></i></span>
      ${here != null ? `<b class="rb-here" style="--x:${here.toFixed(3)}%"></b>` : ''}
    </span>`;
  }
  const mk = month || monthForStage(months[si], iso);
  const names = months.map((m, i) => {
    const c = monthCompletion(m);
    const met = c.goals.filter((g) => g.done).length;
    const done = m.goals.length > 0 && met === m.goals.length;
    const mid = (G.sx(i) + G.ex(i)) / 2;
    return `<button type="button" class="rb-name ${i === si ? 'sel' : ''} ${m.id === cur?.id ? 'now' : ''} ${m.end < iso ? 'past' : ''}" data-rb-stage="${esc(m.id)}"
      style="--x:${mid.toFixed(3)}%;--c:${RIBBON[i] || 'var(--ink-3)'}" aria-pressed="${i === si}"
      aria-label="${esc(`${monthShort(m)}, due ${dueShort(m.end)}${m.id === cur?.id ? ', current stage' : ''}, ${met} of ${m.goals.length} markers met`)}">
      <b>${esc(monthShort(m))}${done ? CHECK : ''}</b><small>${esc(dueShort(m.end))}</small></button>`;
  }).join('');
  const cells = monthCells(months).map((c) => {
    const key = c.key;
    return `<button type="button" class="rb-mon ${key === mk ? 'sel' : ''} ${c.w < 8 ? 'thin' : ''} ${key === iso.slice(0, 7) ? 'now' : ''}" data-rb-month="${key}"
      style="left:${c.x.toFixed(3)}%;width:${c.w.toFixed(3)}%" aria-pressed="${key === mk}" aria-label="${esc(monthName(key, 'long'))}">${esc(c.label)}</button>`;
  }).join('');
  const dots = (shows || performedShows()).filter((s) => s.date >= G.span0 && s.date <= G.span1)
    .map((s) => `<i class="rb-show" style="left:${G.at(s.date).toFixed(3)}%" title="Show"></i>`).join('');
  const m = months[si];
  return `<section class="rb rb-hero" data-rb aria-label="${esc(meta.title || 'The plan')}: the stages">
    <div class="rb-names">${names}</div>
    <div class="rb-track" data-rb-track tabindex="0" role="slider" aria-label="The plan, by stage"
      aria-valuemin="1" aria-valuemax="${months.length}" aria-valuenow="${si + 1}" aria-valuetext="${esc(`${monthShort(m)}, ${dueShort(m.start)} to ${dueShort(m.end)}`)}">
      <div class="rb-road" style="--grad:${grad}">${seams}</div>
      <div class="rb-lens" style="${lensVars}"><i class="rb-lensfill"></i></div>
      ${here != null ? `<i class="rb-here" style="--x:${here.toFixed(3)}%" aria-hidden="true"><span>Today</span></i>` : ''}
      <span class="rb-read" aria-hidden="true"></span>
    </div>
    ${dots ? `<div class="rb-dots" aria-hidden="true">${dots}</div>` : ''}
    <div class="rb-mons">${cells}</div>
  </section>`;
}

// Names over the road: centred on their stage, spread by the least total movement where two
// would touch (the same pooling as placeNames), kept inside the row; a tighter type if they
// cannot fit. Measured, never guessed.
function spreadNames(sec) {
  const row = sec?.querySelector('.rb-names');
  const labels = row ? [...row.querySelectorAll('.rb-name')] : [];
  if (!labels.length) return;
  sec.classList.remove('rb-tight');
  for (let pass = 0; pass < 2; pass++) {
    labels.forEach((l) => l.style.removeProperty('--dx'));
    const R = row.getBoundingClientRect();
    if (!R.width) return;
    const GAP = 6;
    const it = labels.map((l) => { const r = l.getBoundingClientRect(); return { x: r.left - R.left, w: r.width }; });
    let acc = 0;
    const want = it.map((o) => { const v = o.x - acc; acc += o.w + GAP; return v; });
    const hi = R.width - (acc - GAP);
    if (hi < 0 && pass === 0) { sec.classList.add('rb-tight'); continue; }
    const blocks = [];
    want.forEach((v) => {
      blocks.push({ v, n: 1 });
      while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
        const b = blocks.pop(); const a = blocks[blocks.length - 1];
        a.v = (a.v * a.n + b.v * b.n) / (a.n + b.n); a.n += b.n;
      }
    });
    const fit = blocks.flatMap((b) => Array(b.n).fill(Math.min(Math.max(b.v, 0), Math.max(hi, 0))));
    const dx = fit.map((v, i) => v - want[i]);
    if (pass === 0 && Math.max(...dx.map(Math.abs)) > 14) { sec.classList.add('rb-tight'); continue; }
    labels.forEach((l, i) => { if (Math.abs(dx[i]) > 0.25) l.style.setProperty('--dx', `${dx[i].toFixed(1)}px`); });
    return;
  }
}

const rbObserved = new WeakSet();
const rbObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const e of entries) {
      if (!e.target.isConnected) { rbObserver.unobserve(e.target); continue; }
      const sec = e.target.closest('.rb-hero');
      spreadNames(sec);
      const track = sec?.querySelector('[data-rb-track]');
      if (track && track.__rbLens) track.__rbLens();
    }
  })
  : null;

/** Put the lens over [a, b] (percent of the road), never narrower than 58 pt, kept on the road. */
function setLens(track, a, b, { instant = false } = {}) {
  const lens = track.querySelector('.rb-lens');
  if (!lens) return;
  const W = track.getBoundingClientRect().width || 1;
  const minW = (58 / W) * 100;
  let w = b - a;
  let l = a;
  if (w < minW) { l = Math.max(0, Math.min(100 - minW, a - (minW - w) / 2)); w = minW; }
  lens.classList.toggle('instant', instant);
  lens.style.setProperty('--l', l.toFixed(3));
  lens.style.setProperty('--w', w.toFixed(3));
}

/**
 * Wire every hero ribbon inside root. onScrub(stageId, monthKey) runs as the lens crosses a
 * stage or month while dragging (cheap: the caller patches its cards); onPick(stageId, monthKey)
 * on release, a tap on a name, a month or the keyboard. Nothing is saved by the ribbon.
 */
export function bindRibbon(root, { months = PLAN_MONTHS, onScrub = null, onPick = null } = {}) {
  for (const sec of root?.querySelectorAll?.('.rb-hero') || []) {
    const track = sec.querySelector('[data-rb-track]');
    if (!track || track.__rbBound) continue;
    track.__rbBound = true;
    const G = roadGeometry(months);
    const total = daysBetween(G.span0, G.span1) + 1;
    const names = [...sec.querySelectorAll('.rb-name')];
    const mons = [...sec.querySelectorAll('.rb-mon')];
    const read = sec.querySelector('.rb-read');
    let si = Math.max(0, names.findIndex((n) => n.classList.contains('sel')));
    let mk = mons.find((b) => b.classList.contains('sel'))?.dataset.rbMonth || null;
    const lensTo = (i, opts) => setLens(track, G.sx(i), G.ex(i), opts);
    track.__rbLens = () => lensTo(si, { instant: true });
    lensTo(si, { instant: true });
    spreadNames(sec);
    document.fonts?.ready?.then(() => spreadNames(sec));
    if (rbObserver && !rbObserved.has(track)) { rbObserved.add(track); rbObserver.observe(track); }

    const mark = (i, key) => {
      names.forEach((n, k) => { n.classList.toggle('sel', k === i); n.setAttribute('aria-pressed', String(k === i)); });
      mons.forEach((b) => { const on = b.dataset.rbMonth === key; b.classList.toggle('sel', on); b.setAttribute('aria-pressed', String(on)); });
      const m = months[i];
      track.setAttribute('aria-valuenow', String(i + 1));
      track.setAttribute('aria-valuetext', `${monthShort(m)}, ${dueShort(m.start)} to ${dueShort(m.end)}`);
    };
    const isoAt = (clientX) => {
      const R = track.getBoundingClientRect();
      const f = Math.max(0, Math.min(0.9999, (clientX - R.left) / (R.width || 1)));
      return { iso: addDays(G.span0, Math.floor(f * total)), f, R };
    };
    const pick = (i, key, how) => {
      const changed = i !== si || key !== mk;
      si = i; mk = key;
      mark(i, key);
      lensTo(i);
      if (changed || how === 'release') onPick?.(months[i].id, key, how);
    };
    sec.__rbPick = (id, key) => {
      const i = months.findIndex((m) => m.id === id);
      if (i >= 0) pick(i, key || monthForStage(months[i]), 'code');
    };

    let drag = null;
    track.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      drag = { id: e.pointerId, x0: e.clientX, moved: false, i: si, key: mk };
      try { track.setPointerCapture(e.pointerId); } catch { /* old engine */ }
    });
    track.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.abs(e.clientX - drag.x0) < 5) return;
      if (!drag.moved) { drag.moved = true; sec.classList.add('scrub'); }
      const { iso, f, R } = isoAt(e.clientX);
      const i = stageIndexAt(months, iso);
      const key = iso.slice(0, 7);
      const w = 58 / (R.width || 1) * 100;
      const lens = track.querySelector('.rb-lens');
      lens?.classList.add('instant');
      const l = Math.max(0, Math.min(100 - w, f * 100 - w / 2));
      lens?.style.setProperty('--l', l.toFixed(3));
      lens?.style.setProperty('--w', w.toFixed(3));
      if (read) {
        read.textContent = `${dueShort(iso)} · ${monthShort(months[i])}`;
        read.style.setProperty('--x', `${(Math.max(0.1, Math.min(0.9, f)) * 100).toFixed(2)}%`);
      }
      if (i !== drag.i || key !== drag.key) {
        haptic('selection');
        drag.i = i; drag.key = key;
        mark(i, key);
        onScrub?.(months[i].id, key);
      }
    });
    const end = (e, cancel = false) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      sec.classList.remove('scrub');
      if (cancel) { mark(si, mk); lensTo(si); onScrub?.(months[si].id, mk); return; }
      if (d.moved) { pick(d.i, d.key, 'release'); return; }
      // A tap on the road: the stage under the finger, its own month.
      const { iso } = isoAt(e.clientX);
      const i = stageIndexAt(months, iso);
      if (i !== si) haptic('selection');
      pick(i, i === si ? mk : monthForStage(months[i]), 'tap');
    };
    track.addEventListener('pointerup', (e) => end(e));
    track.addEventListener('pointercancel', (e) => end(e, true));
    track.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const i = Math.max(0, Math.min(months.length - 1, si + step));
      if (i !== si) { haptic('selection'); pick(i, monthForStage(months[i]), 'key'); }
    });
    names.forEach((n) => n.addEventListener('click', () => {
      const i = months.findIndex((m) => m.id === n.dataset.rbStage);
      if (i < 0) return;
      if (i !== si) haptic('selection');
      pick(i, i === si ? mk : monthForStage(months[i]), 'tap');
    }));
    mons.forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.rbMonth;
      const m = stageForMonth(months, key);
      const i = months.indexOf(m);
      if (key !== mk) haptic('selection');
      pick(i, key, 'tap');
    }));
  }
}
