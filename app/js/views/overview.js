// Progress > Overview: where the analysis that used to sit above the Today
// list now lives. The six month road, this week's cadence, the month board
// and the insight cards, in that order. Today is a checklist; this is the
// study. Everything here reads the real calendar date, not the date Today is
// browsing, because it describes where he is now.

import { esc, todayIso } from '../util.js';
import { renderJourney, bindJourney } from './journey.js';
import { renderMonthBoard, bindMonthBoard, shortCat } from './monthboard.js';
import { goalGroups } from './week.js';
import { computeInsights } from '../insights.js';

export function renderOverview(ctx) {
  const iso = todayIso();
  return `
  <div class="stack">
    ${renderJourney(ctx, iso)}
    ${weekBar(iso)}
    ${insightsRow(iso)}
    ${renderMonthBoard(ctx, iso)}
  </div>`;
}

/**
 * The week's cadence: one tile per weekly target this month asks for, pips
 * for sessions done. Each tile is a shortcut into the goal group on Today, so
 * the thing that says what is short is the thing that fixes it.
 */
export function weekBar(iso) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  const worst = groups.find((g) => !g.met);
  return `
  <div class="card weekbar-card">
    <div class="card-body" style="padding:.6rem .8rem">
      <div class="section-title centred" style="margin:0 0 .5rem">This week
        ${worst && worst.hit / worst.goal < 0.5
          ? `<span class="tiny" style="text-transform:none;letter-spacing:0;font-weight:450;color:var(--warn)">
              · light on ${esc(worst.label.toLowerCase())}</span>` : ''}
        <span class="tiny muted" style="text-transform:none;letter-spacing:0;font-weight:450"> · tap to log</span>
      </div>
      <div class="weekcats centred">
        ${groups.map((g, i) => `
          <button class="weekcat tappable ${g.met ? 'met' : ''}" data-catgoal="${i}"
                  style="--c:${g.colour}" title="${esc(g.t.label)}: tap to log">
            <span class="wchead"><span class="wclabel tiny">${esc(shortCat(g.t.label))}</span>
              <span class="tiny mono">${g.hit}/${g.goal}</span></span>
            <span class="pips">${Array.from({ length: g.goal }, (_, k) =>
              `<i class="${k < g.hit ? 'on' : ''}"></i>`).join('')}</span>
          </button>`).join('')}
      </div>
    </div>
  </div>`;
}

function insightsRow(iso) {
  const list = computeInsights(iso);
  if (!list.length) return '';
  return `<div class="insights">
    ${list.map((i) => `<div class="insight ${i.kind}">
      <span class="iicon">${i.icon}</span>
      <span class="ibody"><b>${esc(i.title)}</b><span>${esc(i.sub)}</span></span>
    </div>`).join('')}
  </div>`;
}

export function bindOverview(root, ctx, rerender) {
  bindJourney(root, ctx);
  bindMonthBoard(root, ctx, rerender);
  // A weekly category is a shortcut, not a second place to log: it opens the
  // goal group on Today with that category expanded.
  root.querySelectorAll('[data-catgoal]').forEach((b) => b.addEventListener('click', () => {
    const g = goalGroups(todayIso())[Number(b.dataset.catgoal)];
    if (!g) return;
    ctx.date = todayIso();
    ctx.openGoals = true;
    ctx.openGoal = g.t.id;
    ctx.scrollGoals = true;
    ctx.go('today');
  }));
}
