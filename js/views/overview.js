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

import { esc, todayIso, addDays } from '../util.js';
import { whenSeen, countUp } from '../motion.js';
import { renderJourney, bindJourney } from './journey.js';
import { shortCat } from './monthboard.js';
import { goalGroups } from './week.js';
import { computeInsights } from '../insights.js';
import { milestones, earnedAll, unseenMilestones, markSeen } from '../milestones.js';
import { planStreak, versionFor } from '../planstreak.js';
import { state, update } from '../store.js';
import { weekDots } from '../player/player.js';
import { functionStrip, renderBoard, bindBoard } from './standboard.js';
import { renderLadder, bindLadder } from './melbourneview.js';

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
  // 2026-09-16 redesign (his brief, ChatGPT's direction, his rules): the
  // glance. Charts, sessions and insights live on Trends and History.
  // 2026-09-20: the road moved to the top, his call.
  void cw; void wide;
  // The journey road leads (his call, 2026-09-20: "this bar was better at the
  // top of the page"). It is the one thing on Overview that answers "where am I
  // in the plan", so it reads first and everything else is detail under it.
  return `
  <div class="ov">
    <div class="ov-plain ov-road">${renderJourney(ctx, iso, { selected: ctx.roadSel || null })}</div>
    ${summary(iso)}
    ${functionStrip()}
    ${renderBoard()}
    ${renderLadder()}
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
        // The number is drawn for the eye (it may count up, B5-3) and said once,
        // final, for a screen reader. Tabular digits at a fixed width, so the
        // words beside it never move while it counts.
        ? `<div class="ovs-big"><b class="ovs-n" aria-hidden="true" style="min-width:calc(${String(streak).length}ch - ${(String(streak).length * 0.04).toFixed(2)}em)">${streak}</b><span class="sr-only">${streak}</span><span>planned day${streak === 1 ? '' : 's'} in a row</span></div>`
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
    <div class="wgoals n${groups.length}">
      ${groups.map((g, i) => {
        const shown = Math.min(g.hit, g.goal);
        const label = shortCat(g.t.label);
        return `
        <button class="wgoal ${g.met ? 'met' : ''}" data-catgoal="${i}" style="--c:${g.colour};--i:${i}"
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

export function insightsRow(iso) {
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
  // A tap picks a stage here and names it under the road; a second tap on it
  // goes back to the current stage. It never leaves Progress (his call, 22 Sep).
  bindJourney(root, ctx, rerender, { select: (id) => { ctx.roadSel = ctx.roadSel === id ? null : id; rerender({ soft: true }); } });
  // A badge that resolved on screen has had its moment.
  if (root.querySelector('.ms-badge.resolve')) {
    update((d) => { markSeen(d, iso, unseenMilestones(d, iso)); });
  }
  root.querySelector('[data-ms-open]')?.addEventListener('click', () => { ctx.gview = 'milestones'; rerender(); window.scrollTo(0, 0); });
  root.querySelector('[data-ms-close]')?.addEventListener('click', () => { ctx.gview = null; rerender(); });
  bindBoard(root, ctx, rerender);
  bindLadder(root, ctx, rerender);
  bindWeekBar(root, ctx);
  landNumbers(root, iso);
}

// ---------------------------------------------------- numbers that land --
// B5-3 (2026-09-23). What this device last showed, per device and never
// synced: the streak counts up from it once, and only the week's checks that
// are new since then draw in. A first visit, an unchanged value or a streak
// that went down draws settled, so old progress is never replayed.
const SEEN_STREAK = 'rehab.ov.streak';
const SEEN_WEEK = 'rehab.ov.week';
const readSeen = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writeSeen = (k, v) => { try { localStorage.setItem(k, v); } catch { /* per device, a convenience */ } };

// A value counts as shown only once its motion has finished on a page that is
// still there: opening the app paints Overview up to three times in its first
// 60 ms (data arriving after the first paint), so a count or a draw that began
// on a page already replaced was never seen. Under Reduce Motion nothing moves,
// so what is drawn is shown.
function landNumbers(root, iso) {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const n = root.querySelector('.ovs-streak .ovs-n');
  if (n) {
    const to = Number(n.textContent);
    const was = readSeen(SEEN_STREAK);
    const from = was == null || was === '' ? NaN : Number(was);
    if (!still && Number.isFinite(from) && Number.isFinite(to) && from >= 0 && from < to) {
      n.textContent = String(from);
      whenSeen(n, () => countUp(n, from, to, { onDone: () => { if (n.isConnected) writeSeen(SEEN_STREAK, String(to)); } }));
    } else if (Number.isFinite(to)) writeSeen(SEEN_STREAK, String(to));
  }
  const cells = [...root.querySelectorAll('.ovs-week .weekdots > .wd')];
  if (cells.length === 7) {
    const done = cells.map((c, i) => (c.classList.contains('done') ? addDays(iso, i - 6) : null)).filter(Boolean);
    let before = null;
    try { before = JSON.parse(readSeen(SEEN_WEEK) || 'null'); } catch { before = null; }
    let k = 0;
    if (Array.isArray(before) && !still) {
      cells.forEach((c, i) => {
        const d = addDays(iso, i - 6);
        if (!c.classList.contains('done') || before.includes(d)) return;
        c.classList.add('wd-new');
        c.style.setProperty('--i', String(k++));
        c.querySelector('svg path')?.setAttribute('pathLength', '14');
      });
    }
    const week = cells[0].parentElement;
    if (!k) { writeSeen(SEEN_WEEK, JSON.stringify(done)); return; }
    // Shown once every new check has finished drawing on this page.
    let left = k;
    const drawn = () => { if (--left === 0 && week.isConnected) writeSeen(SEEN_WEEK, JSON.stringify(done)); };
    week.querySelectorAll('.wd-new svg path').forEach((p) => p.addEventListener('animationend', drawn, { once: true }));
  }
}

/**
 * A weekly category is a shortcut, not a second place to log: it opens the
 * goal group on Today with that category expanded. Bound wherever weekBar is
 * drawn (History draws it; its tiles did nothing there until 2026-09-22).
 */
export function bindWeekBar(root, ctx) {
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
