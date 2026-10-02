// "This month", the 6-month plan surfaced on the Today page, so the goals
// chase you rather than waiting in a tab you have to remember to open.
//
// Three questions it answers at a glance:
//   Am I on pace for this month's markers?
//   What have I not touched this week?
//   Is anything still outstanding from a month that has already ended?

import { esc, todayIso, daysBetween, weekStart, pct, uid } from '../util.js';
import { state, update, focusCoverage } from '../store.js';
import { openMeasureEntry } from '../components.js';
import { PLAN_MONTHS, ORIGINAL_MONTHS, revisionOf, monthForDate } from '../../data/plan.js';
import { CATEGORIES, MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { goalProgress } from '../goals.js';
import { RIBBON } from './journey.js';

/** Fraction of the month gone, 0 to 1. */
export function monthElapsed(month, iso) {
  const total = daysBetween(month.start, month.end) + 1;
  const gone = Math.min(total, Math.max(0, daysBetween(month.start, iso) + 1));
  return { total, gone, left: total - gone, frac: gone / total };
}

// Revision 3 (F34): a marker says Met when it is met, and otherwise shows its
// own numbers. "On pace" (green) and "Behind" (warning) judged the calendar,
// not the knee, and reused the completion colour for something else.
function paceOf(p) {
  if (p.done) return { cls: 'met', label: 'Met' };
  if (p.untested || p.p == null) return { cls: '', label: '' };   // the detail already says not tested yet
  if (p.manual) return { cls: '', label: '' };                     // a tick of his own: the ring says it
  return { cls: '', label: 'Target not met' };
}

export function renderMonthBoard(ctx, atIso = null) {
  const iso = atIso || ctx.date || todayIso();
  const month = monthForDate(iso);
  if (!month) return '';
  const el = monthElapsed(month, iso);

  const goals = month.goals.map((g) => ({ g, p: goalProgress(g) }));
  const met = goals.filter((x) => x.p.done).length;

  return `
  <section class="card monthboard">
    <button class="panel-head" data-panel="board">
      <span class="panel-title">
        <h2>${esc(month.short ? `${month.short} · ${month.monthLabel}` : `${month.name} · ${month.monthLabel}`)}</h2>
        <span class="sub">${esc(month.title)}</span>
      </span>
      <span class="row" style="gap:.7rem;flex:none">
        ${ring(pct(met, goals.length), `${met}/${goals.length}`)}
        <span class="daysleft">
          <b>${el.left}</b><span>day${el.left === 1 ? '' : 's'} left</span>
        </span>
        <span class="chev">⌄</span>
      </span>
    </button>

    ${boardClosed(ctx) ? '' : `<div class="card-body board-body">
      ${markerCards(goals, el, { colour: RIBBON[PLAN_MONTHS.indexOf(month)] || 'var(--ink-2)' })}
      ${focusTiles(month, weekStart(iso), iso, { title: month.short ? "The stage's focus, this week" : "The month's focus, this week" })}
      ${carriedBlock(month)}
    </div>`}
  </section>`;
}

// ------------------------------------------------------------- the ring ----
function ring(percent, label) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const on = (Math.min(100, percent) / 100) * c;
  return `<span class="ring" title="${percent}% of this month's markers met">
    <svg viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="${r}" class="ring-bg"/>
      <circle cx="20" cy="20" r="${r}" class="ring-on"
        stroke-dasharray="${on.toFixed(1)} ${(c - on).toFixed(1)}" transform="rotate(-90 20 20)"/>
    </svg>
    <b>${esc(label)}</b></span>`;
}

// --------------------------------------------------------- month markers ---
/**
 * The month's markers as cards: a bar, the best so far, on pace or behind,
 * and a button to record straight into it. Shared with the Plan tab.
 */
// How far one leg is toward a marker's target, 0 to 1 (a two-leg marker draws a bar per leg).
function legFrac(g, v) {
  if (v == null || !g.target) return 0;
  return Math.max(0, Math.min(1, v / g.target));
}

export function markerCards(goals, el, { title = 'Markers for this month', days = true, tally = null, colour = 'var(--ink-2)' } = {}) {
  // Revision 3: one white surface per marker, the full title, left in blue and
  // right in orange, the bar neutral until the target is met (then green), and
  // a 44px add button in the action colour. No calendar pace judgement (F34).
  return `
  <div class="pm-head" style="--mc:${colour}">${tally ? `<div class="pm-headrow"><h2 class="ov-h">${esc(title)}</h2>
      <span class="pm-tally"><span><b>${tally.met}</b> of ${tally.total} met</span>
        <span class="mk-segs" role="img" aria-label="${tally.met} of ${tally.total} markers met">${goals.map(({ p }, i) =>
          `<i class="${p.done ? 'met' : ''}" style="--i:${i}"><i style="--p:${p.done ? 1 : Math.min(1, (p.p || 0) / 100)}"></i></i>`).join('')}</span></span></div>`
      : `<h2 class="ov-h">${esc(title)}</h2>`}
    ${days ? `<span class="pm-days">${el.gone} of ${el.total} days gone</span>` : ''}</div>
  <div class="markers2" style="--mc:${colour}">
    ${goals.map(({ g, p }, idx) => {
      const pace = paceOf(p);
      // A marker the ring measures has no button: there is nothing for him to
      // tick and nothing to record, and a dead control is hidden, never disabled.
      const action = p.auto ? null : (g.measure ? 'record' : 'toggle');
      const unit = p.sides?.unit ? ` ${p.sides.unit}` : '';
      const one = g.legs && g.legs.length === 1 ? g.legs[0] : null;
      const twoLegs = !!p.sides && g.kind !== 'lsi' && typeof g.target === 'number';
      const bar = (cls, frac) => `<div class="mk-bar ${cls}"><i style="--p:${frac};--i:${idx}"></i></div>`;
      const bars = p.done
        ? bar('good', 1)
        : twoLegs
          ? `<div class="mk-bars" role="img" aria-label="Left ${Math.round(legFrac(g, p.sides.L) * 100)}%, right ${Math.round(legFrac(g, p.sides.R) * 100)}% of the target">${bar('L', legFrac(g, p.sides.L))}${bar('R', legFrac(g, p.sides.R))}</div>`
          : bar(one === 'L' ? 'L' : one === 'R' ? 'R' : 'st', Math.min(100, p.p || 0) / 100);
      const detail = one && p.detail && !p.sides
        ? `<span class="${one}">${esc(p.detail[0].toUpperCase() + p.detail.slice(1))}</span>`
        : p.sides
        ? `<span class="L">Left ${p.sides.L ?? 'not tested'}${p.sides.L != null ? esc(unit) : ''}</span><span class="R">Right ${p.sides.R ?? 'not tested'}${p.sides.R != null ? esc(unit) : ''}</span>`
        : p.detail ? `<span>${esc(p.detail[0].toUpperCase() + p.detail.slice(1))}</span>` : '';
      return `<div class="marker2 ${p.done ? 'met' : ''}">
        <div class="mk-main">
          <div class="mk-title">${esc(g.text)}</div>
          ${detail ? `<div class="mk-vals">${detail}</div>` : ''}
          ${bars}
          ${pace.label ? `<div class="mk-state ${pace.cls}">${p.done ? CHECK : ''}${esc(pace.label)}</div>` : ''}
        </div>
        ${action ? `<button class="mk-add" data-marker="${esc(g.id)}" data-action="${action}"
          aria-label="${action === 'record' ? `Record a result for ${esc(g.text)}` : p.done ? `Mark ${esc(g.text)} not done` : `Mark ${esc(g.text)} done`}">
          ${action === 'record' ? PLUS : p.done ? CHECK : '<i class="mk-ring"></i>'}</button>`
        : `<span class="mk-auto" aria-hidden="true">${p.done ? CHECK : ''}</span>`}
      </div>`;
    }).join('')}
  </div>`;
}

const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/**
 * Is the month board collapsed? Open unless he closed it. It used to start
 * closed on a phone because it sat above the Today list; it lives on Progress
 * now, where the whole point of the screen is to read it.
 */
function boardClosed(ctx) {
  return ctx.openBoard === false;
}

// The week cadence bar renders above this board on Progress > Overview
// (weekBar in overview.js), not inside it.

// ------------------------------------------------------------ focus work ---
/**
 * The month's focus bullets as tiles that tick themselves from what is
 * logged between `from` and `to`. Judgement calls sit behind a disclosure
 * with a manual tick. Shared with the Plan tab, which passes the whole month.
 */
export function focusTiles(month, from, to, { title = "The month's focus" } = {}) {
  const items = month.focus.flatMap((f, fi) => f.items.map((it, ii) => ({ it, key: `${month.id}:${fi}:${ii}` })));
  const auto = items.map((x) => ({ ...x, cov: focusCoverage(x.it, from, to) }))
    .filter((x) => x.cov.kind === 'auto');
  const manual = items.filter((x) => focusCoverage(x.it, from, to).kind === 'manual');
  const doneCount = auto.filter((x) => x.cov.hit).length;

  return `
  <div class="pm-head"><h2 class="ov-h">${esc(title)}</h2><span class="pm-days">${doneCount} of ${auto.length} touched</span></div>
  <ul class="focuslist">
    ${auto.map((x) => `
      <li class="${x.cov.hit ? 'hit' : ''}" title="${esc(x.it.t)}">
        <span class="fl-mark" aria-label="${x.cov.hit ? 'touched' : 'not touched yet'}">${x.cov.hit ? CHECK : ''}</span>
        <span class="fl-text">${esc(x.it.t)}</span>
        <span class="fl-count">${x.cov.days ? `${x.cov.days} day${x.cov.days === 1 ? '' : 's'}` : ''}</span>
      </li>`).join('')}
  </ul>
  ${manual.length ? `<details class="disc pm-manual" data-key="focusmanual:${esc(month.id)}"><summary>${manual.length} judgement call${manual.length === 1 ? '' : 's'}: tick these yourself</summary>
    ${manual.map((x) => {
      const on = !!state.data.planFocus[x.key];
      return `<label class="checkline ${on ? 'done' : ''}">
        <input type="checkbox" data-focus="${esc(x.key)}" ${on ? 'checked' : ''}>
        <span class="t">${esc(x.it.t)}</span></label>`;
    }).join('')}
  </details>` : ''}`;
}

/** The plan's weekly targets for a month: category, how many a week, where it came from. */
export function targetTiles(month, { title = 'Each week this month' } = {}) {
  const rows = month.weeklyTargets.filter((t) => !t.cats.includes('*'));
  if (!rows.length) return '';
  return `
  <h2 class="ov-h pm-gap">${esc(title)}</h2>
  <ul class="targetlist">
    ${rows.map((t) => {
      const goal = state.data.settings.weeklyOverrides?.[t.id] ?? t.target;
      const colour = CATEGORIES[t.cats[0]]?.color || 'var(--ink-2)';
      return `<li style="--c:${colour}" title="${esc(t.label)}">
        <span class="tl-dot" aria-hidden="true"></span>
        <span class="tl-text"><b>${esc(shortCat(t.label))}</b><small>${t.src === 'plan' ? 'From the plan' : 'My starting number'}</small></span>
        <span class="tl-n">${goal} a week</span>
      </li>`;
    }).join('')}
  </ul>`;
}

/** Category labels have to fit on one line beside their count. */
export function shortCat(label) {
  return label
    .replace(/ sessions.*$/i, '')
    .replace(/ \(.*\)$/, '')
    .replace(/^Balance \/ .*/i, 'Balance')
    .replace(/^Agility \/ .*/i, 'Agility')
    .replace(/^Landing \/ impact$/i, 'Landing')
    .replace(/^Walk-jog \/ treadmill interval$/i, 'Walk-jog')
    .replace(/^Neuromuscular warm-up \/ maintenance$/i, 'Neuromuscular')
    .replace(/^Kneeling exposure$/i, 'Kneeling')
    .trim();
}

// The month's focus items are shown in full (audit L10). A shortened version
// dropped whatever followed a colon or bracket, which is the clinician's own
// qualifier, so none is generated any more.

// ------------------------------------------------- unfinished past months --
function carriedBlock(current) {
  const past = PLAN_MONTHS.filter((m) => m.n < current.n);
  const out = [];
  for (const m of past) {
    for (const g of m.goals) {
      const p = goalProgress(g);
      if (!p.done) out.push({ m, g, p });
    }
  }
  if (!out.length) return '';
  // One line, the list behind a tap. A paragraph here cost real screen space
  // on a phone and said the same thing every day.
  return `
  <details class="disc carried" data-key="carried" style="margin-top:.8rem">
    <summary><span class="pill warn">${out.length} not met ${out.length === 1 ? 'in an' : 'in'} earlier ${current.short ? 'stage' : 'month'}${out.length === 1 ? '' : 's'}</span>
      <span class="tiny muted">still counts; tap to see</span></summary>
    <ul class="plain" style="margin-top:.35rem">
      ${out.map(({ m, g, p }) => `<li>${esc(g.text)}
        <span class="tiny muted">${esc(m.name)}${p.detail ? ' · ' + esc(p.detail) : ''}</span></li>`).join('')}
    </ul>
  </details>`;
}

export function bindMonthBoard(root, ctx, rerender) {
  root.querySelector('[data-panel="board"]')?.addEventListener('click', () => {
    ctx.openBoard = boardClosed(ctx);
    rerender();
  });
  bindMarkers(root, ctx, rerender);
}

/** The record and toggle buttons on marker cards, and the manual focus ticks. */
export function bindMarkers(root, ctx, rerender) {
  // Log straight from the marker rather than hunting for it further down.
  root.querySelectorAll('[data-marker]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = b.dataset.marker;
    // Either plan: the Plan tab can show the one not in use.
    const goal = ORIGINAL_MONTHS.concat(revisionOf(state.data)?.stages || []).flatMap((m) => m.goals).find((g) => g.id === id);
    if (!goal) return;

    if (b.dataset.action === 'toggle') {
      update((d) => {
        const was = d.planGoals[id]?.done;
        d.planGoals[id] = { done: !was, date: todayIso() };
      });
      rerender();
      return;
    }

    openMeasureEntry({
      measureId: goal.measure,
      date: ctx.date || todayIso(),
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  }));
  // The judgement calls: these were rendered on Overview but never bound there.
  root.querySelectorAll('[data-focus]').forEach((cb) => cb.addEventListener('change', () => {
    // Untick deletes the key, so sync carries a tombstone. Set to undefined it
    // was an "edit" JSON then dropped, and another device ticked it back
    // (2026-09-22 audit).
    update((d) => { if (cb.checked) d.planFocus[cb.dataset.focus] = true; else delete d.planFocus[cb.dataset.focus]; });
    rerender();
  }));
}

// ==================================================================== v3 markers ==
// Rehab Test v3 (2026-09-30, research 07 4.7 "Plan markers", 04 G, audit PL4): each marker as a
// bullet bar, left in blue and right in orange against the stage's target (a solid tick), the
// latest number at the bar's end in the leg's colour. Green only when the target is met (the
// whole bar and a check). Not tested yet reads as an empty hatched track, never a zero. The
// record and tick buttons keep their jobs (bindMarkers). No "Target not met" words: the bar
// shows it (PL4). Full marker titles, as written in the plan.
/**
 * A marker's target in words with its unit, on the scale his result is read on (fix d-progress:d28:
 * "30" and "15" had no unit, "1 of 14 nights" sat against "0.5"). '' when there is no number.
 */
export function targetText(g, p) {
  if (typeof g.target !== 'number' || g.kind === 'lsi') return '';
  const lower = g.cmp === '<=' || g.cmp === '<';
  if (g.kind === 'ring') {
    if (g.metric === 'sleepNights') {
      const n = Number(String(p.detail || '').match(/of (\d+) nights/)?.[1]);
      return n ? `${Math.ceil(g.target * n - 1e-9)} of ${n} nights` : `${Math.round(g.target * 100)}% of nights`;
    }
    if (g.metric === 'bedtimeSteadiness') return `at most ${g.target}h`;
  }
  if (g.kind === 'ratio') return `${g.target}x bodyweight`;
  const m = g.measure ? MEASURE_BY_ID[g.measure] : null;
  const unit = p.sides?.unit || (m ? UNIT_LABEL[m.unit] || '' : '');
  const v = `${g.target}${unit ? (/^[°%/]/.test(unit) ? unit : ` ${unit}`) : ''}`;
  return `${lower ? 'at most ' : ''}${v}`;
}

export function markerRows(goals, { colour = 'var(--ink-2)' } = {}) {
  const row = ({ g, p }, idx) => {
    const action = p.auto ? null : (g.measure ? 'record' : 'toggle');
    const one = g.legs && g.legs.length === 1 ? g.legs[0] : null;
    const twoLegs = !!p.sides && g.kind !== 'lsi' && typeof g.target === 'number';
    const max = typeof g.target === 'number' ? g.target * 1.25 : 125;
    const bar = (leg, v) => {
      const met = typeof v === 'number' && typeof g.target === 'number' && (g.cmp === '<=' ? v <= g.target : v >= g.target);
      if (v == null) return `<span class="mr-bar ${leg} none"><span class="mr-leg">${leg}</span><span class="mr-track"><i class="mr-hatch"></i><b class="mr-tick" style="left:80%"></b></span><span class="mr-v">none</span></span>`;
      return `<span class="mr-bar ${leg} ${met ? 'met' : ''}"><span class="mr-leg">${leg}</span><span class="mr-track"><i style="--p:${Math.min(1, v / max).toFixed(4)};--i:${idx}"></i><b class="mr-tick" style="left:80%"></b></span><span class="mr-v">${esc(String(v))}</span></span>`;
    };
    let bars;
    if (twoLegs) bars = bar('L', p.sides.L) + bar('R', p.sides.R);
    else {
      const frac = p.done ? 1 : Math.min(1.25, (p.p || 0) / 100) / 1.25;
      const cls = p.done ? 'met' : one || 'B';
      bars = p.untested
        ? `<span class="mr-bar ${cls} none"><span class="mr-track"><i class="mr-hatch"></i><b class="mr-tick" style="left:80%"></b></span></span>`
        : `<span class="mr-bar ${cls}"><span class="mr-track"><i style="--p:${frac.toFixed(4)};--i:${idx}"></i>${p.manual ? '' : '<b class="mr-tick" style="left:80%"></b>'}</span></span>`;
    }
    const detail = !twoLegs && p.detail && !p.manual ? `<span class="mr-detail">${esc(p.detail[0].toUpperCase() + p.detail.slice(1))}</span>` : '';
    const target = targetText(g, p);
    // Two legs: the target sits under the title, never alone on a line of its own (d28); one bar:
    // the result and the target share the line under it.
    const tgtTop = twoLegs && target && !detail;
    return `<div class="mr ${p.done ? 'met' : ''}" style="--i:${idx}">
      <div class="mr-top">
        <span class="mr-title">${p.done ? CHECK : ''}${esc(g.text)}${tgtTop ? `<span class="mr-target top"><i></i>${esc(target)}</span>` : ''}</span>
        ${action ? `<button class="mr-add ${action} ${action === 'toggle' && !p.done ? 'word' : ''}" data-marker="${esc(g.id)}" data-action="${action}"
          aria-label="${action === 'record' ? `Record a result for ${esc(g.text)}` : p.done ? `Mark ${esc(g.text)} not done` : `Mark ${esc(g.text)} done`}">
          ${action === 'record' ? PLUS : p.done ? CHECK : 'Mark done'}</button>` : ''}
      </div>
      ${p.manual ? '' : `<div class="mr-bars">${bars}</div>`}
      ${detail || (target && !tgtTop) ? `<div class="mr-foot">${detail}${target && !tgtTop ? `<span class="mr-target"><i></i>${esc(target)}</span>` : ''}</div>` : ''}
    </div>`;
  };
  return `<div class="mrs" style="--mc:${colour}">${goals.map(row).join('')}</div>`;
}
