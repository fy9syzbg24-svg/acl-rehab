// Progress > Overview. Everything here reads the real calendar date, not the
// date Today is browsing, because it describes where he is now.
//
// 2026-09-14 ring design, order settled with ChatGPT through Reuben:
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
    <section class="ov-sec journeysec">${renderJourney(ctx, iso)}</section>
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

function summary(iso) {
  const known = !!versionFor(state.data, iso);
  const streak = planStreak(state.data, iso);
  const latest = latestMilestone(iso);
  const unseen = new Set(unseenMilestones(state.data, iso).map((m) => m.key));
  const next = milestones(state.data, iso).next.slice().sort((a, b) => a.left - b.left)[0];
  return `
  <div class="ov-summary">
    <section class="ov-card ov-streak">
      <div class="eyebrow">Plan streak</div>
      ${known
        ? `<div class="ov-big"><b>${streak}</b><span>planned day${streak === 1 ? '' : 's'} in a row</span></div>${weekDots(iso)}`
        : '<div class="ov-big small"><span>No plan recorded yet</span></div>'}
    </section>
    <button class="ov-card ov-latest" data-ms-open aria-label="All milestones">
      <div class="eyebrow">Latest milestone</div>
      ${latest
        ? `<div class="ms-row"><span class="ms-badge earned ${unseen.has(latest.key) ? 'resolve' : ''}">${latest.id === 'firstplan' ? FLAG : BADGE}</span>
            <span class="ms-text"><b>${esc(latest.label)}</b><span>${esc(latest.detail)}</span></span></div>`
        : '<div class="ms-row"><span class="ms-badge">' + BADGE + '</span><span class="ms-text"><b>None yet</b></span></div>'}
      ${next ? `<div class="ov-next">Next: ${esc(next.label)} · ${next.left} to go</div>` : ''}
      <span class="ov-all">All milestones<span aria-hidden="true">›</span></span>
    </button>
  </div>`;
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
 * The week's cadence: one tile per weekly target this month asks for, pips
 * for sessions done. Each tile is a shortcut into the goal group on Today, so
 * the thing that says what is short is the thing that fixes it.
 */
export function weekBar(iso) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  return `
  <section class="ov-sec weeksec">
    <div class="ov-head"><h2>This week</h2></div>
    <div class="weekcats centred">
      ${groups.map((g, i) => `
        <button class="weekcat tappable ${g.met ? 'met' : ''}" data-catgoal="${i}"
                style="--c:${g.colour}" title="${esc(g.t.label)}: tap to log">
          <span class="wchead"><span class="wclabel">${esc(shortCat(g.t.label))}</span>
            <span class="mono">${g.hit}/${g.goal}</span></span>
          <span class="pips">${Array.from({ length: g.goal }, (_, k) =>
            `<i class="${k < g.hit ? 'on' : ''}"></i>`).join('')}</span>
        </button>`).join('')}
    </div>
  </section>`;
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
