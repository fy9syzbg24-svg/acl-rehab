// The six month plan: one month at a time. 2026-09-14 revision 3.
//
// The journey ribbon across the top (the same one Progress shows, here it
// selects the month), six month tiles in a 3 by 2 grid with the selected one
// in the action colour, then the chosen month: a short summary on the inset
// surface, its markers, the focus it asks for and the weekly targets. The
// percentage on a tile is how far that month's markers are toward their
// targets, and it says so; it is never a measure of the knee.

import { esc, todayIso, addDays, fmtDateShort } from '../util.js';
import { state, update } from '../store.js';
import { planOf, activeVersion, revisionOf, monthForDate, monthShort, monthLong } from '../../data/plan.js';
import { goalProgress, monthCompletion } from '../goals.js';
import { markerCards, focusTiles, targetTiles, bindMarkers, monthElapsed } from './monthboard.js';
import { renderJourney, bindJourney, RIBBON } from './journey.js';

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

// Stages or months (his ask, 22 Sep): the same plan seen two ways. The choice
// is this device's, like the other view switches.
const MODE_KEY = 'rehab.planMode';
function planMode(ctx) {
  if (ctx.planMode === 'stages' || ctx.planMode === 'months') return ctx.planMode;
  try { const v = localStorage.getItem(MODE_KEY); if (v === 'months' || v === 'stages') return v; } catch { /* private window */ }
  return 'stages';
}

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

function goalScore(goals) {
  const ps = goals.map(goalProgress);
  return Math.round(ps.reduce((a, p) => a + Math.min(100, p.p), 0) / (ps.length || 1));
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
  const reference = rev && version === 'original' && active !== 'original';
  const mode = stages && !reference ? planMode(ctx) : 'stages';
  if (mode === 'months') return renderMonths(ctx, today, MONTHS, meta, first, last);

  return `
  <div class="stack plan-page plan3">
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
    ${rev && !reference && meta.source ? `<p class="plan-src">${esc(meta.source)}</p>` : ''}
    ${renderJourney(ctx, today, { selected: m.id, months: MONTHS, meta, heading: stages ? 'The Stages' : null })}
    ${stages ? modeSwitch('stages') : ''}
    <div class="mtiles ${reference ? 'plan-ref' : ''}" role="group" aria-label="${stages ? 'Stages' : 'Months'}: percent of each ${stages ? 'stage' : 'month'}'s marker targets reached">
      ${MONTHS.map((x, i) => {
        const c = monthCompletion(x);
        const on = x.id === m.id;
        return `<button class="mtile ${on ? 'on' : ''}" data-month="${x.id}" style="--mc:${RIBBON[i] || 'var(--ink-2)'};--i:${i}"
          aria-pressed="${on}" ${x.id === current?.id ? 'aria-current="date"' : ''}
          aria-label="${esc(x.short ? x.short + ', due ' + dueText(x.end) : monthLong(x))}: markers ${c.goalScore}% of the way to target${x.id === current?.id ? (stages ? ', current stage' : ', current month') : ''}">
          <span class="mt-name">${esc(monthShort(x))}${x.short ? `<small class="mt-due">${esc(dueText(x.end))}</small>` : ''}</span>
          <span class="mt-row"><b>${c.goalScore}%</b><i class="mt-bar"><i style="--p:${c.goalScore / 100}"></i></i></span>
        </button>`;
      }).join('')}
    </div>
    <div class="mt-key">Percent of each ${stages ? 'stage' : 'month'}'s marker targets reached${stages ? ', and the day it is due' : ''}</div>
    <div class="${reference ? 'plan-ref' : ''}">${monthCard(m, today, m.id === current?.id, RIBBON[MONTHS.indexOf(m)] || 'var(--ink-2)')}</div>
    ${rev && !reference && active !== 'original' ? `<button class="plan-origlink" data-planview="original">Original plan, August 2026<small>Kept for reference</small></button>` : ''}
  </div>`;
}

function modeSwitch(mode) {
  return `<div class="plan-mode"><div class="seg" role="group" aria-label="Show the plan by">
    ${[['stages', 'Stages'], ['months', 'Months']].map(([v, l]) => `<button class="${mode === v ? 'on' : ''}" data-planmode="${v}" aria-pressed="${mode === v}">${l}</button>`).join('')}
  </div></div>`;
}

/** The month view: what is due by the end of each month, then each stage due in the chosen one. */
function renderMonths(ctx, today, STAGES, meta, first, last) {
  const months = monthsOfStages(STAGES);
  const next = months.find((mo) => mo.stages.some(({ s }) => s.end >= today)) || months[months.length - 1];
  const mo = months.find((x) => x.id === ctx.openPlanMonth) || next;
  const lead = mo.stages[0];
  // The stages' own dates first (they carry a line of detail); the plan's key
  // dates only fill a day no stage names, so one event never shows twice.
  const inMonth = (d) => d.date.slice(0, 7) === mo.key || mo.stages.some(({ s: x }) => x.end === d.date);
  const dates = STAGES.flatMap((s) => s.card?.dates || []).filter(inMonth);
  const days = new Set(dates.map((d) => d.date));
  for (const d of (meta.dates || []).filter(inMonth)) if (!days.has(d.date)) { dates.push(d); days.add(d.date); }
  dates.sort((a, b) => (a.date < b.date ? -1 : 1));
  const MON = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
  return `
  <div class="stack plan-page plan3">
    <header class="pagehead">
      <h1>${esc(meta.title || '6-Month Plan')}</h1>
      <div class="lede">${esc(first)} to ${esc(last)}</div>
    </header>
    ${meta.source ? `<p class="plan-src">${esc(meta.source)}</p>` : ''}
    ${renderJourney(ctx, today, { selected: lead.s.id, months: STAGES, meta, heading: 'The Stages' })}
    ${modeSwitch('months')}
    <div class="mtiles n${months.length}" role="group" aria-label="Months: percent of the marker targets due that month reached">
      ${months.map((x, i) => {
        const pc = goalScore(x.goals);
        const on = x.id === mo.id;
        return `<button class="mtile ${on ? 'on' : ''}" data-planmonth="${x.id}" style="--mc:${RIBBON[x.stages[0].i] || 'var(--ink-2)'};--i:${i}"
          aria-pressed="${on}" ${x.id === next.id ? 'aria-current="date"' : ''}
          aria-label="${esc(x.long)}: ${esc(x.stages.map(({ s }) => s.short).join(' and '))} due, markers ${pc}% of the way to target">
          <span class="mt-name">${esc(x.label)}<small class="mt-due">${esc(x.stages.map(({ s }) => s.short).join(', '))}</small></span>
          <span class="mt-row"><b>${pc}%</b><i class="mt-bar"><i style="--p:${pc / 100}"></i></i></span>
        </button>`;
      }).join('')}
    </div>
    <div class="mt-key">Percent of the marker targets due by the end of each month</div>
    ${dates.length ? `<section class="pm-sec"><h2 class="ov-h">Key Dates in ${esc(mo.long)}</h2>
      <div class="sc-dates n${dates.length}">${dates.map((d) => `
        <div class="sc-date ${d.date < today ? 'past' : ''}">
          <div class="sc-cal"><b>${Number(d.date.slice(8, 10))}</b><small>${esc(MON(d.date))}</small></div>
          <div class="sc-dtext"><b>${esc(d.label)}</b>${d.sub || d.note ? `<small>${esc(d.sub || d.note)}</small>` : ''}</div>
        </div>`).join('')}</div></section>` : ''}
    ${mo.stages.map(({ s, i }) => {
      const goals = s.goals.map((g) => ({ g, p: goalProgress(g) }));
      const met = goals.filter((x) => x.p.done).length;
      const at = today > s.end ? s.end : today < s.start ? s.start : today;
      return `<section class="pm-sec">
        ${markerCards(goals, monthElapsed(s, at), { title: `${s.short}, due ${dueText(s.end)}`, days: false, tally: { met, total: goals.length }, colour: RIBBON[i] || 'var(--ink-2)' })}
        <button class="btn sm plan-openstage" data-openstage="${esc(s.id)}">Open the ${esc(s.short)} stage</button>
      </section>`;
    }).join('')}
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
      <div class="sc-tiles n${c.found.tiles.length}">${c.found.tiles.map((t, i) => `
        <div class="sc-tile ${t.leg === 'L' ? 'L' : t.leg === 'R' ? 'R' : ''}" style="--i:${i}">
          <small>${esc(t.t)}</small><b>${esc(t.v)}</b>${t.sub ? `<span>${esc(t.sub)}</span>` : ''}
        </div>`).join('')}</div></section>`);
  }
  if (!top && c.gates?.length) {
    out.push(`<section class="pm-sec"><h2 class="ov-h">Gate In</h2>
      <div class="sc-tiles n${c.gates.length}">${c.gates.map((g, i) => `
        <div class="sc-tile gate" style="--i:${i}"><b>${esc(g.t)}</b>${g.sub ? `<span>${esc(g.sub)}</span>` : ''}</div>`).join('')}</div></section>`);
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
  const setMode = (v) => {
    ctx.planMode = v;
    try { localStorage.setItem(MODE_KEY, v); } catch { /* private window */ }
  };
  root.querySelectorAll('[data-planview]').forEach((b) => b.addEventListener('click', () => {
    ctx.planView = b.dataset.planview;
    ctx.openMonth = null;
    rerender();
    window.scrollTo(0, 0);
  }));
  root.querySelectorAll('[data-planmode]').forEach((b) => b.addEventListener('click', () => {
    if (planMode(ctx) === b.dataset.planmode) return;
    setMode(b.dataset.planmode);
    rerender();
  }));
  root.querySelectorAll('[data-planmonth]').forEach((b) => b.addEventListener('click', () => {
    ctx.openPlanMonth = b.dataset.planmonth;
    rerender();
  }));
  root.querySelectorAll('[data-openstage]').forEach((b) => b.addEventListener('click', () => {
    setMode('stages');
    ctx.openMonth = b.dataset.openstage;
    rerender();
    window.scrollTo(0, 0);
  }));
  // A stage tapped on the road opens that stage, so the month view steps aside
  // first (registered before bindJourney, whose handler repaints).
  if (planMode(ctx) === 'months') {
    root.querySelectorAll('[data-jumpmonth]').forEach((g) => g.addEventListener('click', () => setMode('stages')));
  }
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
