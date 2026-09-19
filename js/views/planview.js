// The six month plan: one month at a time. 2026-09-14 revision 3.
//
// The journey ribbon across the top (the same one Progress shows, here it
// selects the month), six month tiles in a 3 by 2 grid with the selected one
// in the action colour, then the chosen month: a short summary on the inset
// surface, its markers, the focus it asks for and the weekly targets. The
// percentage on a tile is how far that month's markers are toward their
// targets, and it says so; it is never a measure of the knee.

import { esc, todayIso } from '../util.js';
import { state, update } from '../store.js';
import { planOf, activeVersion, revisionOf, monthForDate, monthShort, monthLong } from '../../data/plan.js';
import { goalProgress, monthCompletion } from '../goals.js';
import { markerCards, focusTiles, targetTiles, bindMarkers, monthElapsed } from './monthboard.js';
import { renderJourney, bindJourney, RIBBON } from './journey.js';

export { goalProgress, monthCompletion };


// Which plan the page shows: the one in use unless he picked the other. Both
// are kept (his call, 19 Sep 2026): the original document to look back at or
// go back to, the revision to run on.
function viewedVersion(ctx) {
  const active = activeVersion(state.data);
  if (!revisionOf(state.data)) return 'original';
  return ctx.planView === 'original' || ctx.planView === 'revised' ? ctx.planView : active;
}

export function renderPlan(ctx) {
  const today = todayIso();
  const version = viewedVersion(ctx);
  const active = activeVersion(state.data);
  const { months: MONTHS, meta } = planOf(state.data, version);
  const current = monthForDate(today, MONTHS);
  const stages = !!MONTHS[0].short;
  const openId = ctx.openMonth || current?.id || MONTHS[0].id;
  const m = MONTHS.find((x) => x.id === openId) || current || MONTHS[0];
  const my = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = my(MONTHS[0].start);
  const last = my(MONTHS[MONTHS.length - 1].end);
  const rev = revisionOf(state.data);

  return `
  <div class="stack plan-page plan3">
    <header class="pagehead">
      <h1>${esc(meta.title || '6-Month Plan')}</h1>
      <div class="lede">${esc(first)} to ${esc(last)}</div>
    </header>
    ${rev ? `<div class="plan-ver" role="group" aria-label="Which plan to show">
      ${[['revised', 'New Plan'], ['original', 'Original Plan']].map(([v, name]) => `
      <button class="${version === v ? 'on' : ''}" data-planview="${v}" aria-pressed="${version === v}">
        <b>${esc(name)}</b><small>${active === v ? 'In use' : v === 'original' ? 'Saved for reference' : 'Not in use'}</small>
      </button>`).join('')}
    </div>
    ${meta.source ? `<p class="plan-src">${esc(meta.source)}</p>` : ''}
    ${version !== active ? `<button class="btn primary plan-use" data-useplan="${esc(version)}">Use this plan</button>` : ''}` : ''}
    ${renderJourney(ctx, today, { selected: m.id, months: MONTHS, meta, heading: stages ? 'The Stages' : null })}
    <div class="mtiles" role="group" aria-label="${stages ? 'Stages' : 'Months'}: percent of each ${stages ? 'stage' : 'month'}'s marker targets reached">
      ${MONTHS.map((x, i) => {
        const c = monthCompletion(x);
        const on = x.id === m.id;
        return `<button class="mtile ${on ? 'on' : ''}" data-month="${x.id}" style="--mc:${RIBBON[i] || 'var(--ink-2)'}"
          aria-pressed="${on}" ${x.id === current?.id ? 'aria-current="date"' : ''}
          aria-label="${esc(x.short ? x.short + ', ' + x.monthLabel : monthLong(x))}: markers ${c.goalScore}% of the way to target${x.id === current?.id ? ', current month' : ''}">
          <span class="mt-name">${esc(monthShort(x))}</span>
          <span class="mt-row"><b>${c.goalScore}%</b><i class="mt-bar"><i style="--p:${c.goalScore / 100}"></i></i></span>
        </button>`;
      }).join('')}
    </div>
    <div class="mt-key">Percent of each ${stages ? 'stage' : 'month'}'s marker targets reached</div>
    ${monthCard(m, today, m.id === current?.id, RIBBON[MONTHS.indexOf(m)] || 'var(--ink-2)')}
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
    out.push(`<section class="pm-sec"><h2 class="ov-h">Key Dates</h2>
      <div class="sc-dates n${c.dates.length}">${c.dates.map((d) => `
        <div class="sc-date ${d.date < today ? 'past' : ''}">
          <div class="sc-cal"><b>${DAY(d.date)}</b><small>${esc(MON(d.date))}</small></div>
          <div class="sc-dtext"><b>${esc(d.label)}</b>${d.sub ? `<small>${esc(d.sub)}</small>` : ''}</div>
        </div>`).join('')}</div></section>`);
  }
  if (top && c.found?.tiles?.length) {
    out.push(`<section class="pm-sec"><div class="pm-head"><h2 class="ov-h">What Derrick Found</h2>${c.found.when ? `<span class="pm-days">${esc(c.found.when)}</span>` : ''}</div>
      <div class="sc-tiles n${c.found.tiles.length}">${c.found.tiles.map((t) => `
        <div class="sc-tile ${t.leg === 'L' ? 'L' : t.leg === 'R' ? 'R' : ''}">
          <small>${esc(t.t)}</small><b>${esc(t.v)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}
        </div>`).join('')}</div></section>`);
  }
  if (!top && c.gates?.length) {
    out.push(`<section class="pm-sec"><h2 class="ov-h">Gate In</h2>
      <div class="sc-tiles n${c.gates.length}">${c.gates.map((g) => `
        <div class="sc-tile gate"><b>${esc(g.t)}</b>${g.sub ? `<span>${esc(g.sub)}</span>` : ''}</div>`).join('')}</div></section>`);
  }
  if (!top && c.notes?.length) {
    out.push(`<section class="pm-sec"><h2 class="ov-h">Good to Know</h2>
      <div class="sc-notes">${c.notes.map((n) => `
        <div class="sc-note"><b>${esc(n.h)}</b><span>${esc(n.t)}</span></div>`).join('')}</div></section>`);
  }
  return out.join('');
}

function monthCard(m, today, isNow, colour) {
  const goals = m.goals.map((g) => ({ g, p: goalProgress(g) }));
  const met = goals.filter((x) => x.p.done).length;
  const at = today > m.end ? m.end : today < m.start ? m.start : today;
  const el = monthElapsed(m, at);
  // A stage has no summary card (his call, 19 Sep): the ribbon and tiles carry
  // its name, dates and phase; the markers tally sits beside its heading.
  return `
  ${m.short ? '' : `<section class="pm-summary">
    <h2>${esc(monthLong(m))} · Phase ${esc(String(m.melbournePhase))}</h2>
    <div class="pm-met">${met} of ${goals.length} markers met</div>
    <div class="pm-title">${esc(m.name)}: ${esc(m.title)}</div>
    ${typeof m.note === 'string' ? `<p class="pm-note">${esc(m.note)}</p>` : ''}
  </section>`}
  ${stageExtras(m, today)}
  <section class="pm-sec">
    ${markerCards(goals, el, { title: isNow ? (m.short ? 'Markers for This Stage' : 'Markers for This Month') : 'Markers', days: isNow, tally: m.short ? { met, total: goals.length } : null, colour })}
    ${goals.some((x) => x.g.caution) ? goals.filter((x) => x.g.caution).map((x) => `<p class="pm-caution">${esc(x.g.caution)}</p>`).join('') : ''}
  </section>
  <section class="pm-sec">
    ${focusTiles(m, m.start, m.end, { title: m.short ? (isNow ? "The Stage's Focus So Far" : "The Stage's Focus") : (isNow ? "The Month's Focus So Far" : "The Month's Focus") })}
  </section>
  <section class="pm-sec">
    ${targetTiles(m, { title: m.short ? 'Each Week in This Stage' : 'Each Week This Month' })}
  </section>
  ${stageExtras(m, today, 'bottom')}`;
}

export function bindPlan(root, ctx, rerender) {
  root.querySelectorAll('[data-planview]').forEach((b) => b.addEventListener('click', () => {
    ctx.planView = b.dataset.planview;
    ctx.openMonth = null;
    rerender();
  }));
  root.querySelector('[data-useplan]')?.addEventListener('click', (ev) => {
    const v = ev.currentTarget.dataset.useplan;
    update((d) => { d.settings.planVersion = v; });
    ctx.planView = v;
    rerender();
  });
  root.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
    ctx.openMonth = b.dataset.month;
    rerender();
  }));
  bindJourney(root, ctx, rerender);
  bindMarkers(root, ctx, rerender);
}
