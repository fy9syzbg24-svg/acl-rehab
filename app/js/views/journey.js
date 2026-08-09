// The six-month road across the top of Today.
//
// Built from HTML positioned by percentage — not a stretched SVG — so the
// type stays crisp at any width. Click a month to open it in the plan tab.

import { esc, todayIso, daysBetween } from '../util.js';
import { PLAN_MONTHS, PLAN_START, PLAN_END } from '../../data/plan.js';
import { monthCompletion } from './planview.js';

// `short` is what fits under a ~130px band on an iPhone-width screen; `label`
// is the full text for anyone with room. Truncating with an ellipsis instead
// left every phase reading "PHASE 2 · STRENG…" on a real phone.
const PHASES = [
  { label: 'Phase 2 · Strength', short: 'Phase 2', months: [1, 2], color: '#e0603a' },
  { label: 'Phase 3 · Run & land', short: 'Phase 3', months: [3, 4], color: '#d4a017' },
  { label: 'Phase 4 · Performance', short: 'Phase 4', months: [5, 6], color: '#8a5cd6' },
];

export function renderJourney(ctx) {
  const iso = ctx.date || todayIso();
  const total = daysBetween(PLAN_START, PLAN_END);
  const at = (d) => (daysBetween(PLAN_START, d) / total) * 100;
  const fx = Math.max(0, Math.min(100, at(iso)));

  const nodes = PLAN_MONTHS.map((m) => {
    const c = monthCompletion(m);
    const met = c.goals.filter((g) => g.done).length;
    return {
      m, x: at(m.end), met, goals: m.goals.length,
      past: iso > m.end, now: iso >= m.start && iso <= m.end,
      done: m.goals.length > 0 && met === m.goals.length,
    };
  });

  const bands = PHASES.map((ph) => {
    const a = PLAN_MONTHS.find((m) => m.n === ph.months[0]);
    const b = PLAN_MONTHS.find((m) => m.n === ph.months[ph.months.length - 1]);
    return { ...ph, xa: at(a.start), xb: at(b.end) };
  });

  return `
  <section class="card journey">
    <div class="jtrack">
      ${bands.map((b) => `<i class="jband" style="left:${b.xa.toFixed(2)}%;width:${(b.xb - b.xa).toFixed(2)}%;--c:${b.color}"></i>`).join('')}
      <i class="jfill" style="width:${fx.toFixed(2)}%"></i>
      ${nodes.map((n) => `
        <button class="jnode ${n.past ? 'past' : ''} ${n.now ? 'now' : ''} ${n.done ? 'done' : ''}"
          style="left:${n.x.toFixed(2)}%" data-jumpmonth="${esc(n.m.id)}"
          title="${esc(n.m.name)} · ${esc(n.m.title)}">
          <span class="jname">${esc(n.m.monthLabel.replace(/ .*/, '').slice(0, 3))}</span>
          <i class="jdot">${n.done ? '✓' : ''}</i>
          <span class="jmet">${n.met}/${n.goals}</span>
        </button>`).join('')}
      <i class="jyou" style="left:${fx.toFixed(2)}%"></i>
    </div>
    <div class="jphases">
      ${bands.map((b) => `<span style="left:${b.xa.toFixed(2)}%;width:${(b.xb - b.xa).toFixed(2)}%;color:${b.color}" title="${esc(b.label)}">
        <em class="full">${esc(b.label)}</em><em class="short">${esc(b.short)}</em>
      </span>`).join('')}
    </div>
  </section>`;
}

export function bindJourney(root, ctx) {
  root.querySelectorAll('[data-jumpmonth]').forEach((g) => g.addEventListener('click', () => {
    ctx.openMonth = g.dataset.jumpmonth;
    ctx.go('plan');
  }));
}
