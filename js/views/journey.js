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

import { esc, todayIso, daysBetween } from '../util.js';
import { PLAN_MONTHS, PLAN_META, monthForDate, monthShort, monthLong } from '../../data/plan.js';
import { monthCompletion } from '../goals.js';

// The ribbon's colour at each node, in order; tiles and marker bars of a month
// or stage take the colour of its node, so a stage reads as one colour.
export const RIBBON = ['#7853E8', '#3686ED', '#2AC7D5', '#3BBB81', '#E0B52E', '#EF6549'];

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
    return { x, w: next - x, label: name(iso) };
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
