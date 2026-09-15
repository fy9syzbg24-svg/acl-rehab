// The six month journey, drawn as a ribbon. 2026-09-14 revision 3 (F37).
//
// The full spectrum across the calendar is the one scoped exception to the
// app's colour rules, asked for by Reuben: it colours the calendar, never a
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

import { esc, todayIso } from '../util.js';
import { PLAN_MONTHS, monthForDate } from '../../data/plan.js';
import { monthCompletion } from '../goals.js';

const PHASES = [
  { label: 'Phase 2 · Strength', short: 'Phase 2', months: [1, 2] },
  { label: 'Phase 3 · Run and land', short: 'Phase 3', months: [3, 4] },
  { label: 'Phase 4 · Performance', short: 'Phase 4', months: [5, 6] },
];

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

const monthShort = (m) => m.monthLabel.replace(/ .*/, '').slice(0, 3);
const monthLong = (m) => m.monthLabel.replace(/ .*/, '');

export function renderJourney(ctx, atIso = null, { selected = null, heading = 'Your six-month plan' } = {}) {
  const iso = atIso || todayIso();
  const current = monthForDate(iso);
  const n = PLAN_MONTHS.length;
  // Nodes sit in the middle of equal slots, so the first and last have room
  // for their label and the 44px target without leaving the ribbon.
  const x = (i) => ((i + 0.5) / n) * 100;

  const nodes = PLAN_MONTHS.map((m, i) => {
    const c = monthCompletion(m);
    const met = c.goals.filter((g) => g.done).length;
    const done = m.goals.length > 0 && met === m.goals.length;
    const now = m.id === current?.id;
    const phase = PHASES.find((p) => p.months.includes(m.n));
    const label = `${monthLong(m)}${now ? ', current month' : ''}, ${phase ? phase.label + ', ' : ''}${met} of ${m.goals.length} markers met`;
    return `<button class="jr-node ${now ? 'now' : ''} ${done ? 'done' : ''} ${selected === m.id ? 'sel' : ''}"
        style="left:${x(i).toFixed(3)}%" data-jumpmonth="${esc(m.id)}" aria-label="${esc(label)}"
        ${selected ? `aria-pressed="${selected === m.id}"` : ''}>
        <span class="jr-month">${esc(monthShort(m))}</span>
        <i class="jr-dot">${done ? CHECK : ''}</i>
      </button>`;
  }).join('');

  // A break at each phase change, halfway between the two months' nodes.
  const breaks = PHASES.slice(1).map((p) => {
    const i = PLAN_MONTHS.findIndex((m) => m.n === p.months[0]);
    return i > 0 ? `<i class="jr-break" style="left:${((i / n) * 100).toFixed(3)}%"></i>` : '';
  }).join('');

  const phases = PHASES.map((p) => {
    const i = PLAN_MONTHS.findIndex((m) => m.n === p.months[0]);
    return `<span style="left:${((i / n) * 100).toFixed(3)}%" title="${esc(p.label)}">${esc(p.short)}</span>`;
  }).join('');

  const caption = current
    ? `${esc(monthLong(current))} · Current month`
    : iso < PLAN_MONTHS[0].start ? 'The plan has not started yet' : 'The six months are complete';

  return `
  <section class="journey2" aria-label="${esc(heading)}">
    ${heading ? `<h2 class="jr-title">${esc(heading)}</h2>` : ''}
    <div class="jr-road">
      <div class="jr-ribbon" aria-hidden="true">${breaks}</div>
      ${nodes}
    </div>
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
