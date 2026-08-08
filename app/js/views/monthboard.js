// "This month" — the 6-month plan surfaced on the Today page, so the goals
// chase you rather than waiting in a tab you have to remember to open.
//
// Three questions it answers at a glance:
//   Am I on pace for this month's markers?
//   What have I not touched this week?
//   Is anything still outstanding from a month that has already ended?

import { esc, todayIso, daysBetween, weekStart, weekDays, pct, round, fmtDate, uid } from '../util.js';
import { state, update, getDay, hasCheckin, focusCoverage } from '../store.js';
import { openMeasureEntry } from '../components.js';
import { PLAN_MONTHS, monthForDate } from '../../data/plan.js';
import { CATEGORIES } from '../../data/measurements.js';
import { goalProgress } from './planview.js';
import { dayCategories, dayTags } from './week.js';

/** Fraction of the month gone, 0–1. */
function monthElapsed(month, iso) {
  const total = daysBetween(month.start, month.end) + 1;
  const gone = Math.min(total, Math.max(0, daysBetween(month.start, iso) + 1));
  return { total, gone, left: total - gone, frac: gone / total };
}

function paceOf(p, elapsedFrac) {
  if (p.done) return { cls: 'met', label: 'Met' };
  if (p.p == null) return { cls: '', label: '' };
  // A blunt check: are you as far through the goal as you are through the month?
  const slack = 0.12;
  if (p.p / 100 >= elapsedFrac - slack) return { cls: 'ok', label: 'On pace' };
  return { cls: 'behind', label: 'Behind' };
}

export function renderMonthBoard(ctx) {
  const iso = ctx.date || todayIso();
  const month = monthForDate(iso);
  if (!month) return '';
  const el = monthElapsed(month, iso);

  const goals = month.goals.map((g) => ({ g, p: goalProgress(g) }));
  const met = goals.filter((x) => x.p.done).length;

  return `
  <section class="card monthboard">
    <button class="panel-head" data-panel="board">
      <span class="panel-title">
        <h2>${esc(month.name)} · ${esc(month.monthLabel)}</h2>
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
      ${markerBlock(goals, el)}
      ${weekBlock(month, iso)}
      ${focusBlock(month, iso)}
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
function markerBlock(goals, el) {
  return `
  <div class="section-title">Markers for this month
    <span class="tiny muted" style="text-transform:none;letter-spacing:0;font-weight:450">
      · ${el.gone} of ${el.total} days gone</span></div>
  <div class="markers">
    ${goals.map(({ g, p }) => {
      const pace = paceOf(p, el.frac);
      const action = g.measure ? 'record' : 'toggle';
      return `<div class="marker ${pace.cls}">
        <button class="marker-add" data-marker="${esc(g.id)}" data-action="${action}"
          title="${action === 'record' ? 'Record a result for this marker' : 'Mark this done'}">
          ${action === 'record' ? '＋' : p.done ? '✓' : '○'}</button>
        <div class="mtitle" title="${esc(g.text)}">${esc(g.text)}</div>
        <div class="bar slim ${p.done ? 'good' : pace.cls === 'behind' ? 'warn' : ''}" style="margin:.35rem 0 .3rem">
          <i style="width:${Math.min(100, p.p || 0)}%"></i></div>
        <div class="mfoot">
          <span class="mdetail">${esc(p.detail ? p.detail[0].toUpperCase() + p.detail.slice(1) : '')}</span>
          ${pace.label ? `<span class="mstate ${pace.cls}"><i></i>${esc(pace.label)}</span>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

/**
 * Is the month board collapsed?
 *
 * Default differs by device on purpose: on a phone the expanded board pushes
 * everything else off the screen, so it starts closed and opens on tap. On a
 * desktop there is room, so it starts open. Once you touch the chevron your
 * choice wins for the session either way.
 */
function boardClosed(ctx) {
  if (ctx.openBoard !== undefined) return ctx.openBoard === false;
  return document.body.classList.contains('mobile');
}

// ------------------------------------------------------------- this week ---
// The cadence bar moved to the top of Today (weekBar in today.js), where it is
// seen before anything is logged and where each category can be tapped to log.
// Rendering it here as well was just noise.
function weekBlock() {
  return '';
}

// ------------------------------------------------------------ focus work ---
function focusBlock(month, iso) {
  const wkStart = weekStart(iso);
  const items = month.focus.flatMap((f, fi) => f.items.map((it, ii) => ({ it, key: `${month.id}:${fi}:${ii}` })));
  const auto = items.map((x) => ({ ...x, cov: focusCoverage(x.it, wkStart, iso) }))
    .filter((x) => x.cov.kind === 'auto');
  const manual = items.filter((x) => focusCoverage(x.it, wkStart, iso).kind === 'manual');
  const doneCount = auto.filter((x) => x.cov.hit).length;

  return `
  <div class="section-title" style="margin-top:1rem">The month's focus, this week
    <span class="tiny muted" style="text-transform:none;letter-spacing:0;font-weight:450">
      · ${doneCount} of ${auto.length} touched · ticks itself from what you log</span></div>
  <div class="focusgrid">
    ${auto.map((x) => `
      <div class="focusitem ${x.cov.hit ? 'hit' : ''}" title="${esc(x.it.t)}">
        <span class="fmark">${x.cov.hit ? '✓' : ''}</span>
        <span class="ftext">${esc(shortFocus(x.it.t))}</span>
        <span class="fcount tiny mono">${x.cov.days ? x.cov.days + 'd' : ''}</span>
      </div>`).join('')}
  </div>
  ${manual.length ? `<details class="disc" style="margin-top:.5rem"><summary>${manual.length} judgement calls — tick these yourself</summary>
    ${manual.map((x) => {
      const on = !!state.data.planFocus[x.key];
      return `<label class="checkline ${on ? 'done' : ''}">
        <input type="checkbox" data-focus="${esc(x.key)}" ${on ? 'checked' : ''}>
        <span class="t">${esc(x.it.t)}</span></label>`;
    }).join('')}
  </details>` : ''}`;
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

/** Focus bullets are long; the grid needs a label, not a paragraph. */
function shortFocus(text) {
  let s = text.replace(/^As tolerated:\s*/i, '').replace(/^Continue\s+/i, '').replace(/^Progress(ing)?\s+/i, '');
  s = s.split(/\s*[—(]\s*/)[0];
  const arrows = s.split('→').map((x) => x.trim()).filter(Boolean);
  if (arrows.length > 1) s = `${arrows[0]} → ${arrows[arrows.length - 1]}`;
  return s.length > 76 ? s.slice(0, 74).trimEnd() + '…' : s;
}

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
  return `
  <div class="callout bad small" style="margin-top:1rem">
    <strong>Still outstanding from earlier months.</strong> These markers were not met by the end of their month,
    so they carry forward.
    <ul class="plain" style="margin-top:.35rem">
      ${out.map(({ m, g, p }) => `<li>${esc(g.text)}
        <span class="tiny muted">— ${esc(m.name)}${p.detail ? ' · ' + esc(p.detail) : ''}</span></li>`).join('')}
    </ul>
  </div>`;
}

export function bindMonthBoard(root, ctx, rerender) {
  root.querySelector('[data-panel="board"]')?.addEventListener('click', () => {
    ctx.openBoard = boardClosed(ctx);
    rerender();
  });

  // Log straight from the marker rather than hunting for it further down.
  root.querySelectorAll('[data-marker]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = b.dataset.marker;
    const goal = PLAN_MONTHS.flatMap((m) => m.goals).find((g) => g.id === id);
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
}
