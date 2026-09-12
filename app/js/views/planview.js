// The six month plan: one month at a time, drawn the way the month board on
// Overview draws it. He likes that board ("things are big and clear, like the
// markers for this month"), so the Plan tab is that board for any month, with
// the six months as a strip of tiles above it. Same marker cards, same focus
// tiles, same weekly target tiles, one implementation.

import { esc, todayIso } from '../util.js';
import { PLAN_MONTHS, monthForDate } from '../../data/plan.js';
import { goalProgress, monthCompletion } from '../goals.js';
import { markerCards, focusTiles, targetTiles, bindMarkers, monthElapsed } from './monthboard.js';

export { goalProgress, monthCompletion };

export function renderPlan(ctx) {
  const today = todayIso();
  const current = monthForDate(today);
  const openId = ctx.openMonth || current?.id || PLAN_MONTHS[0].id;
  const m = PLAN_MONTHS.find((x) => x.id === openId) || PLAN_MONTHS[0];

  return `
  <div class="stack today">
    <section class="card">
      <header class="hero">
        <div>
          <h2>6 month plan</h2>
          <div class="sub">August 2026 to January 2027 · goal based, not date based</div>
        </div>
      </header>
      <div class="card-body tight">
        <div class="monthstrip">
          ${PLAN_MONTHS.map((x) => {
            const c = monthCompletion(x);
            const isNow = x.id === current?.id;
            return `<button class="kpi ${x.id === openId ? 'on' : ''} ${isNow ? 'now' : ''}" data-month="${x.id}" title="${esc(x.title)}">
              <div class="v">${c.goalScore}%</div>
              <div class="k">${esc(x.monthLabel.replace(/ .*/, '').slice(0, 3))}</div>
            </button>`;
          }).join('')}
        </div>
      </div>
    </section>

    ${monthCard(m, today, m.id === current?.id)}
  </div>`;
}

function monthCard(m, today, isNow) {
  const goals = m.goals.map((g) => ({ g, p: goalProgress(g) }));
  const met = goals.filter((x) => x.p.done).length;
  // Pace is judged against today inside the month, the whole month once it
  // has passed, and not at all before it starts.
  const at = today > m.end ? m.end : today < m.start ? m.start : today;
  const el = monthElapsed(m, at);
  return `
  <section class="card monthboard">
    <div class="panel-head static">
      <span class="panel-title">
        <h2>${esc(m.name)} · ${esc(m.monthLabel)}</h2>
        <span class="sub">${esc(m.title)}</span>
      </span>
      <span class="row" style="gap:.7rem;flex:none">
        <span class="daysleft"><b>${met}/${goals.length}</b><span>markers met</span></span>
        <span class="pill" style="background:rgba(255,255,255,.18);color:#fff">Phase ${m.melbournePhase}</span>
      </span>
    </div>
    <div class="card-body board-body">
      ${m.note ? `<div class="notice info" style="margin:.6rem 0 .2rem">${esc(m.note)}</div>` : ''}
      ${markerCards(goals, el, { title: isNow ? 'Markers for this month' : 'Markers', days: isNow })}
      ${goals.some((x) => x.g.caution) ? goals.filter((x) => x.g.caution).map((x) => `<div class="tiny" style="color:var(--warn);margin-top:.4rem">${esc(x.g.caution)}</div>`).join('') : ''}
      ${focusTiles(m, m.start, m.end, { title: isNow ? "The month's focus so far" : "The month's focus" })}
      ${targetTiles(m)}
    </div>
  </section>`;
}

export function bindPlan(root, ctx, rerender) {
  root.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
    ctx.openMonth = b.dataset.month;
    rerender();
  }));
  bindMarkers(root, ctx, rerender);
}
