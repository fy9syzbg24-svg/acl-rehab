// The six month plan: one month at a time. 2026-09-14 revision 3.
//
// The journey ribbon across the top (the same one Progress shows, here it
// selects the month), six month tiles in a 3 by 2 grid with the selected one
// in the action colour, then the chosen month: a short summary on the inset
// surface, its markers, the focus it asks for and the weekly targets. The
// percentage on a tile is how far that month's markers are toward their
// targets, and it says so; it is never a measure of the knee.

import { esc, todayIso } from '../util.js';
import { PLAN_MONTHS, PLAN_START, PLAN_END, monthForDate } from '../../data/plan.js';
import { goalProgress, monthCompletion } from '../goals.js';
import { markerCards, focusTiles, targetTiles, bindMarkers, monthElapsed } from './monthboard.js';
import { renderJourney, bindJourney } from './journey.js';

export { goalProgress, monthCompletion };

// The ribbon's colour at each month's node, for the tile bars.
const RIBBON = ['#7853E8', '#3686ED', '#2AC7D5', '#3BBB81', '#E0B52E', '#EF6549'];

const monthShort = (m) => m.monthLabel.replace(/ .*/, '').slice(0, 3);
const monthLong = (m) => m.monthLabel.replace(/ .*/, '');

export function renderPlan(ctx) {
  const today = todayIso();
  const current = monthForDate(today);
  const openId = ctx.openMonth || current?.id || PLAN_MONTHS[0].id;
  const m = PLAN_MONTHS.find((x) => x.id === openId) || PLAN_MONTHS[0];
  const my = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = my(PLAN_START);
  const last = my(PLAN_END);

  return `
  <div class="stack plan-page plan3">
    <header class="pagehead">
      <h1>6-Month Plan</h1>
      <div class="lede">${esc(first)} to ${esc(last)}</div>
    </header>
    ${renderJourney(ctx, today, { selected: m.id })}
    <div class="mtiles" role="group" aria-label="Months: percent of each month's marker targets reached">
      ${PLAN_MONTHS.map((x, i) => {
        const c = monthCompletion(x);
        const on = x.id === m.id;
        return `<button class="mtile ${on ? 'on' : ''}" data-month="${x.id}" style="--mc:${RIBBON[i] || 'var(--ink-2)'}"
          aria-pressed="${on}" ${x.id === current?.id ? 'aria-current="date"' : ''}
          aria-label="${esc(monthLong(x))}: markers ${c.goalScore}% of the way to target${x.id === current?.id ? ', current month' : ''}">
          <span class="mt-name">${esc(monthShort(x))}</span>
          <span class="mt-row"><b>${c.goalScore}%</b><i class="mt-bar"><i style="width:${c.goalScore}%"></i></i></span>
        </button>`;
      }).join('')}
    </div>
    <div class="mt-key">Percent of each month's marker targets reached</div>
    ${monthCard(m, today, m.id === current?.id)}
  </div>`;
}

function monthCard(m, today, isNow) {
  const goals = m.goals.map((g) => ({ g, p: goalProgress(g) }));
  const met = goals.filter((x) => x.p.done).length;
  const at = today > m.end ? m.end : today < m.start ? m.start : today;
  const el = monthElapsed(m, at);
  return `
  <section class="pm-summary">
    <h2>${esc(monthLong(m))} · Phase ${esc(String(m.melbournePhase))}</h2>
    <div class="pm-met">${met} of ${goals.length} markers met</div>
    <div class="pm-title">${esc(m.name)}: ${esc(m.title)}</div>
    ${m.note ? `<p class="pm-note">${esc(m.note)}</p>` : ''}
  </section>
  <section class="pm-sec">
    ${markerCards(goals, el, { title: isNow ? 'Markers for this month' : 'Markers', days: isNow })}
    ${goals.some((x) => x.g.caution) ? goals.filter((x) => x.g.caution).map((x) => `<p class="pm-caution">${esc(x.g.caution)}</p>`).join('') : ''}
  </section>
  <section class="pm-sec">
    ${focusTiles(m, m.start, m.end, { title: isNow ? "The month's focus so far" : "The month's focus" })}
  </section>
  <section class="pm-sec">
    ${targetTiles(m)}
  </section>`;
}

export function bindPlan(root, ctx, rerender) {
  root.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
    ctx.openMonth = b.dataset.month;
    rerender();
  }));
  bindJourney(root, ctx, rerender);
  bindMarkers(root, ctx, rerender);
}
