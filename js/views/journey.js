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
// On Progress a node opens that month on Plan; on Plan it selects the month.

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

// Month ticks under a stage ribbon (his ask, 19 Sep 2026). Stages are drawn in
// equal slots, not to scale, so a date sits inside its own stage's slot at the
// fraction of that stage it has reached: the ticks are true to each stage.
function monthTicks(months) {
  const n = months.length;
  const first = months[0].start;
  const last = months[n - 1].end;
  const out = [];
  let [y, m] = first.split('-').map(Number);
  for (let guard = 0; guard < 48; guard++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-01`;
    if (iso > last) break;
    if (iso >= first) {
      const i = months.findIndex((s) => iso >= s.start && iso <= s.end);
      if (i >= 0) {
        const s = months[i];
        const frac = daysBetween(s.start, iso) / (daysBetween(s.start, s.end) + 1);
        const label = new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
        out.push({ x: ((i + frac) / n) * 100, label });
      }
    }
    m++; if (m > 12) { m = 1; y++; }
  }
  // Two labels closer than a tenth of the ribbon would touch on a phone; the
  // plan's own first month gives way (the date line under the title has it).
  return out.filter((t, i) => !(i === 0 && t.x < 4 && out[1] && out[1].x - t.x < 10))
    .filter((t, i, a) => i === 0 || t.x - a[i - 1].x >= 10);
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';


export function renderJourney(ctx, atIso = null, { selected = null, heading = null, months = PLAN_MONTHS, meta = PLAN_META } = {}) {
  const iso = atIso || todayIso();
  const current = monthForDate(iso, months);
  const n = months.length;
  const PHASES = phasesOf(months);
  if (heading === null) heading = meta.version === 'revised' ? (meta.title || 'Your Plan') : 'Your Six-Month Plan';
  // Nodes sit in the middle of equal slots, so the first and last have room
  // for their label and the 44px target without leaving the ribbon.
  const x = (i) => ((i + 0.5) / n) * 100;

  const nodes = months.map((m, i) => {
    const c = monthCompletion(m);
    const met = c.goals.filter((g) => g.done).length;
    const done = m.goals.length > 0 && met === m.goals.length;
    const now = m.id === current?.id;
    const phase = PHASES.find((p) => p.months.includes(m.n));
    const label = `${m.short ? m.short + ', ' + m.monthLabel : monthLong(m)}${now ? (m.short ? ', current stage' : ', current month') : ''}, ${phase ? phase.label + ', ' : ''}${met} of ${m.goals.length} markers met`;
    return `<button class="jr-node ${now ? 'now' : ''} ${done ? 'done' : ''} ${selected === m.id ? 'sel' : ''}"
        style="left:${x(i).toFixed(3)}%" data-jumpmonth="${esc(m.id)}" aria-label="${esc(label)}"
        ${selected ? `aria-pressed="${selected === m.id}"` : ''}>
        <span class="jr-month">${esc(monthShort(m))}</span>
        <i class="jr-dot">${done ? CHECK : ''}</i>
      </button>`;
  }).join('');

  // A break at each phase change, halfway between the two months' nodes.
  const breaks = PHASES.slice(1).map((p) => {
    const i = months.findIndex((m) => m.n === p.months[0]);
    return i > 0 ? `<i class="jr-break" style="left:${((i / n) * 100).toFixed(3)}%"></i>` : '';
  }).join('');

  const phases = PHASES.map((p) => {
    const i = months.findIndex((m) => m.n === p.months[0]);
    return `<span style="left:${((i / n) * 100).toFixed(3)}%" title="${esc(p.label)}">${esc(p.short)}</span>`;
  }).join('');

  const caption = current
    ? (current.short ? `${esc(current.short)}, ${esc(current.monthLabel)} · Current stage` : `${esc(monthLong(current))} · Current month`)
    : iso < months[0].start ? 'The plan has not started yet' : (meta.version === 'revised' ? 'The plan is complete' : 'The six months are complete');

  return `
  <section class="journey2 ${months[0].short ? 'stages' : ''}" aria-label="${esc(heading || meta.title || 'Your plan')}">
    ${heading ? `<h2 class="jr-title">${esc(heading)}</h2>` : ''}
    <div class="jr-road">
      <div class="jr-ribbon" aria-hidden="true">${breaks}</div>
      ${nodes}
    </div>
    ${months[0].short ? `<div class="jr-months" aria-hidden="true">${monthTicks(months).map((t) =>
      `<span class="${t.x < 4 ? 'first' : t.x > 96 ? 'last' : ''}" style="left:${t.x.toFixed(3)}%">${esc(t.label)}</span>`).join('')}</div>` : ''}
    <div class="jr-phases" aria-hidden="true">${phases}</div>
    <div class="jr-caption">${caption}</div>
  </section>`;
}

export function bindJourney(root, ctx, rerender = null) {
  root.querySelectorAll('[data-jumpmonth]').forEach((g) => g.addEventListener('click', () => {
    ctx.openMonth = g.dataset.jumpmonth;
    if (rerender) rerender();
    else ctx.go('plan');
  }));
}
