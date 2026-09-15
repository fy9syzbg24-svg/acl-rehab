// Progress > Overview. Everything here reads the real calendar date, not the
// date Today is browsing, because it describes where he is now.
//
// 2026-09-14 ring design, order settled with ChatGPT through the owner:
//   1. the plan streak and the latest earned milestone, side by side
//   2. this week's goal tiles, each a shortcut into Today (they ARE "this week")
//   3. the six month journey road, kept prominent
//   4. one measurement trend, with its selected record
//   5. the three most recent sessions, and a way into History
//   6. the insight cards
// The month board lives on Plan only. Sections and whitespace, not cards in
// cards. The milestone collection opens from the latest milestone.

import { esc, todayIso } from '../util.js';
import { renderJourney, bindJourney } from './journey.js';
import { shortCat } from './monthboard.js';
import { goalGroups } from './week.js';
import { computeInsights } from '../insights.js';
import { milestones, earnedAll, unseenMilestones, markSeen } from '../milestones.js';
import { planStreak, versionFor } from '../planstreak.js';
import { state, update } from '../store.js';
import { weekDots } from '../player/player.js';
import { renderTrend, bindTrend } from '../trend.js';
import { renderSessions, bindSessions } from './sessions.js';

const BADGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="5.5"/><path d="M9 13.8L7.5 21l4.5-2.4 4.5 2.4-1.5-7.2"/></svg>';
const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4.5h11.5l-2 4 2 4H5"/></svg>';
const SIGN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21v-8M12 7V3"/><path d="M5 7h12l2.5 3L17 13H5z"/></svg>';

/** Width a section's content can use, for charts drawn in real pixels. */
export function contentWidth() {
  const v = document.getElementById('view');
  const w = v ? v.clientWidth : 360;
  const pad = w >= 700 ? 48 : 40;
  return Math.max(260, w - pad - 36);
}

export function renderOverview(ctx) {
  const iso = todayIso();
  if (ctx.gview === 'milestones') return milestoneCollection(ctx, iso);
  const cw = contentWidth();
  const wide = cw >= 940;
  return `
  <div class="ov">
    ${summary(iso)}
    ${weekBar(iso)}
    <div class="ov-plain">${renderJourney(ctx, iso)}</div>
    <section class="ov-sec panelsec">
      <div class="ov-head"><h2>Measurements</h2></div>
      ${renderTrend(ctx, { key: 'overview', width: wide ? cw - 324 : cw })}
    </section>
    <section class="ov-sec panelsec">
      <div class="ov-head"><h2>Recent sessions</h2><button class="btn sm" data-gtab="history">View history</button></div>
      ${renderSessions(ctx, { limit: 3 })}
    </section>
    ${insightsRow(iso)}
  </div>`;
}

/** The latest milestone: the most recently celebrated, else the highest step. */
function latestMilestone(iso) {
  const all = earnedAll(state.data, iso);
  if (!all.length) return null;
  const seen = state.data.program?.seen || {};
  return all.slice().sort((a, b) => String(seen[b.key] || '').localeCompare(String(seen[a.key] || '')) || (b.n - a.n))[0];
}

// F43: one split summary, streak on the left, the latest milestone (or the
// next one) on the right. No oversized empty trophy card on a first day.
function summary(iso) {
  const known = !!versionFor(state.data, iso);
  const streak = planStreak(state.data, iso);
  const latest = latestMilestone(iso);
  const unseen = new Set(unseenMilestones(state.data, iso).map((m) => m.key));
  const next = milestones(state.data, iso).next.slice().sort((a, b) => a.left - b.left)[0];
  const right = latest
    ? `<span class="ms-badge earned ${unseen.has(latest.key) ? 'resolve' : ''}">${latest.id === 'firstplan' ? FLAG : BADGE}</span>
       <b class="ovs-ms-title">${esc(latest.label)}</b>`
    : next
      ? `<span class="ms-badge">${SIGN}</span>
         <b class="ovs-ms-title">Next: ${esc(next.label)}</b><span class="ovs-ms-sub">${next.left} to go</span>`
      : `<span class="ms-badge">${BADGE}</span><b class="ovs-ms-title">No milestones yet</b>`;
  return `
  <section class="ov-split" aria-label="Plan streak and milestones">
    <div class="ovs-streak">
      <div class="eyebrow">Plan streak</div>
      ${known
        ? `<div class="ovs-big"><b>${streak}</b><span>planned day${streak === 1 ? '' : 's'} in a row</span></div>`
        : '<div class="ovs-big none"><span>No plan recorded yet</span></div>'}
    </div>
    <button class="ovs-ms" data-ms-open aria-label="Milestones${latest ? `, latest ${esc(latest.label)}` : ''}">
      ${right}
      <span class="ovs-link">Milestones</span>
    </button>
    ${known ? `<div class="ovs-week">${weekDots(iso)}</div>` : ''}
  </section>`;
}

function milestoneCollection(ctx, iso) {
  const all = earnedAll(state.data, iso);
  const seen = state.data.program?.seen || {};
  const unseen = new Set(unseenMilestones(state.data, iso).map((m) => m.key));
  const next = milestones(state.data, iso).next.slice().sort((a, b) => a.left - b.left);
  const when = (k) => {
    const v = seen[k];
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '';
  };
  return `
  <div class="ov">
    <div class="ov-back"><button class="btn sm ghost" data-ms-close>‹ Overview</button></div>
    <section class="ov-sec">
      <div class="ov-head"><h2>Milestones</h2><span class="ov-count">${all.length} earned</span></div>
      <div class="ms-list">
        ${all.length ? all.slice().reverse().map((m) => `
          <div class="ms-row"><span class="ms-badge earned ${unseen.has(m.key) ? 'resolve' : ''}">${m.id === 'firstplan' ? FLAG : BADGE}</span>
            <span class="ms-text"><b>${esc(m.label)}</b><span>${esc(m.detail)}${when(m.key) ? ` · ${esc(when(m.key))}` : ''}</span></span></div>`).join('')
          : '<div class="ms-empty">None yet.</div>'}
      </div>
    </section>
    ${next.length ? `<section class="ov-sec">
      <div class="ov-head"><h2>Next</h2></div>
      <div class="ms-list">${next.map((n) => `
        <div class="ms-row"><span class="ms-badge">${SIGN}</span>
          <span class="ms-text"><b>${esc(n.label)}</b><span>${n.left} to go</span></span></div>`).join('')}</div>
    </section>` : ''}
  </div>`;
}

/**
 * The week's cadence (F27): one tile per weekly target this month asks for,
 * a category ring capped at the goal and the full label, two columns on a
 * phone. Raw extra work stays in History and never overfills a ring. Each
 * tile is a shortcut into the goal group on Today.
 */
export function weekBar(iso) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  return `
  <section class="ov-plain weeksec2">
    <h2 class="ov-h">This week</h2>
    <div class="wgoals">
      ${groups.map((g, i) => {
        const shown = Math.min(g.hit, g.goal);
        const label = shortCat(g.t.label);
        return `
        <button class="wgoal ${g.met ? 'met' : ''}" data-catgoal="${i}" style="--c:${g.colour}"
                aria-label="${esc(label)}: ${shown} of ${g.goal} planned this week${g.met ? ', goal met' : ''}. Open on Today">
          ${catRing(shown, g.goal)}
          <span class="wg-text"><b>${esc(label)}</b>
            <span class="wg-sub">${g.met ? `${CHECK} Goal met` : `${shown} of ${g.goal} planned`}</span></span>
        </button>`;
      }).join('')}
    </div>
  </section>`;
}

const CHECK = '<svg class="wg-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/** A small ring in the category colour, filled by done over goal, never past it. */
export function catRing(done, goal, size = 46) {
  const stroke = 5;
  const r = size / 2 - stroke / 2 - 1;
  const frac = goal > 0 ? Math.min(1, done / goal) : 0;
  return `<span class="catring" style="--cr:${size}px" aria-hidden="true">
    <svg viewBox="0 0 ${size} ${size}">
      <circle class="cr-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
      ${frac > 0 ? `<circle class="cr-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
        pathLength="100" stroke-dasharray="${(frac * 100).toFixed(2)} 100" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : ''}
    </svg><b>${done}/${goal}</b></span>`;
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
  const iso = todayIso();
  bindJourney(root, ctx);
  // A badge that resolved on screen has had its moment.
  if (root.querySelector('.ms-badge.resolve')) {
    update((d) => { markSeen(d, iso, unseenMilestones(d, iso)); });
  }
  root.querySelector('[data-ms-open]')?.addEventListener('click', () => { ctx.gview = 'milestones'; rerender(); window.scrollTo(0, 0); });
  root.querySelector('[data-ms-close]')?.addEventListener('click', () => { ctx.gview = null; rerender(); });
  bindTrend(root, ctx, rerender, {
    onOpen(measureId, date) {
      ctx.gtab = 'tests';
      ctx.mtab = 'history';
      ctx.chartMeasure = measureId;
      ctx.focusTest = { measure: measureId, date };
      rerender();
    },
    onRecord() { ctx.gtab = 'tests'; rerender(); },
  });
  bindSessions(root, ctx, rerender);
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
