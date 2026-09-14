import { esc, todayIso, addDays, fmtDate, fmtDateNum, daysBetween, num } from '../util.js';
import { state, getDay, loggedDates, hasCheckin } from '../store.js';
import { PLAN_MONTHS, monthForDate } from '../../data/plan.js';
import { CASE, CLINIC_TIMELINE } from '../../data/history.js';
import { heatmap, lineChart } from '../components.js';
import { monthCompletion } from '../goals.js';
import { planStreak, dayComplete } from '../planstreak.js';
import { renderWeekPanel, bindWeekPanel } from './week.js';
import { renderMeasuresPanel, bindMeasuresPanel } from './measures.js';
import { renderMelbourne, bindMelbourne } from './melbourneview.js';
import { renderOverview, bindOverview } from './overview.js';
import { renderSessions, bindSessions } from './sessions.js';

const TABS = [['overview', 'Overview'], ['week', 'This week'], ['history', 'History'],
              ['tests', 'Tests and VALD'], ['melbourne', 'Melbourne'], ['clinical', 'Clinical notes']];

export function renderProgress(ctx) {
  const tab = ctx.gtab || 'overview';
  // 2026-09-14 ring design: one page head and the same underline sub
  // navigation on every device; the panels below are the existing ones.
  return `<div class="stack progress">
    <header class="pagehead"><h1>Progress</h1></header>
    <nav class="subnav" aria-label="Progress sections">
      ${TABS.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-gtab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${l}</button>`).join('')}
    </nav>
    ${tab === 'overview' ? renderOverview(ctx) : ''}
    ${tab === 'week' ? renderWeekPanel(ctx) : ''}
    ${tab === 'history' ? renderHistoryPanel(ctx) : ''}
    ${tab === 'tests' ? renderMeasuresPanel(ctx) : ''}
    ${tab === 'melbourne' ? renderMelbourne(ctx) : ''}
    ${tab === 'clinical' ? renderClinicalPanel() : ''}
  </div>`;
}

export function bindProgress(root, ctx, rerender) {
  const tab = ctx.gtab || 'overview';
  if (tab === 'melbourne') bindMelbourne(root, ctx, rerender);
  if (tab === 'overview') bindOverview(root, ctx, rerender);
  root.querySelectorAll('[data-gtab]').forEach((b) => b.addEventListener('click', () => {
    if (ctx.gtab !== b.dataset.gtab) ctx.gview = null;
    ctx.gtab = b.dataset.gtab;
    rerender();
    if (!b.closest('.subnav')) window.scrollTo(0, 0);
  }));
  bindWeekPanel(root, ctx, rerender);
  bindMeasuresPanel(root, ctx, rerender);
  if (tab === 'history') {
    bindSessions(root, ctx, rerender, { onEdit: (s) => correctOnToday(ctx, s) });
  }
  root.querySelectorAll('.heat-cell[data-date]').forEach((c) => c.addEventListener('click', () => {
    ctx.date = c.dataset.date;
    ctx.go('today');
  }));
}

/** Open a session's own record in Today's editor, on its date. */
function correctOnToday(ctx, s) {
  ctx.date = s.iso;
  ctx.editing = s.pid || s.entryId;
  ctx.openRest = true;   // a row not planned that day sits in the fold
  ctx.scrollToRow = s.pid || s.entryId;
  ctx.go('today');
}

function renderHistoryPanel(ctx) {
  const today = todayIso();
  const dates = loggedDates();
  // Workouts and check-ins are different things, counted apart. A workout
  // day has something confirmed; opening a row or typing numbers is not one.
  const streak = planStreak(state.data, today);
  const from30 = addDays(today, -29);
  const workout30 = dates.filter((d) => d >= from30 && (getDay(d).entries || []).some((e) => e.logged)).length;
  const checkins30 = dates.filter((d) => d >= from30 && hasCheckin(getDay(d))).length;

  const painPts = dates
    .map((d) => ({ date: d, c: getDay(d).checkin || {} }))
    .filter((x) => num(x.c.painL) != null || num(x.c.painR) != null);

  return `
  <div class="stack">
    <section class="ov-sec panelsec">
      <div class="ov-head"><h2>Sessions</h2></div>
      ${renderSessions(ctx)}
    </section>
    <div class="kpis">
      <div class="kpi"><div class="v">${streak}</div><div class="k">plan streak</div></div>
      <div class="kpi"><div class="v">${workout30}</div><div class="k">workout days, last 30</div></div>
      <div class="kpi"><div class="v">${checkins30}</div><div class="k">knee check-ins, last 30</div></div>
    </div>

    ${recentDays(today)}

    <section class="card">
      <header><h2>Activity</h2><span class="sub">26 weeks · darker = more exercises confirmed</span></header>
      <div class="card-body">
        ${heatmap(today, 26, levelFor)}
        <div class="row tiny muted" style="margin-top:.5rem;gap:.4rem">
          <span>less</span>
          ${['', 'l1', 'l2', 'l3', 'l4'].map((c) => `<span class="heat-cell ${c}" style="width:12px;flex:none"></span>`).join('')}
          <span>more</span>
          <span class="spacer"></span><span>columns are weeks, rows Mon → Sun</span>
        </div>
      </div>
    </section>

    <div class="grid2">
      <section class="card">
        <header><h2>Pain trend</h2><span class="sub">0 to 10, per knee</span></header>
        <div class="card-body">
          ${painPts.length ? lineChart([
            { label: 'Left', cls: 'lineL', color: 'left', points: painPts.filter((p) => num(p.c.painL) != null).map((p) => ({ date: p.date, value: num(p.c.painL) })) },
            { label: 'Right', cls: 'lineR', color: 'right', points: painPts.filter((p) => num(p.c.painR) != null).map((p) => ({ date: p.date, value: num(p.c.painR) })) },
          ].filter((s) => s.points.length), { height: 140 }) : '<div class="empty">Log a check-in or two and this fills in.</div>'}
          <div class="legend" style="margin-top:.4rem"><span><i style="background:var(--left)"></i>Left</span><span><i style="background:var(--right)"></i>Right</span></div>
        </div>
      </section>

      <section class="card">
        <header><h2>Month completion</h2><span class="sub">measurable goals vs focus items</span></header>
        <div class="card-body">
          ${PLAN_MONTHS.map((m) => {
            const c = monthCompletion(m);
            const now = monthForDate(todayIso())?.id === m.id;
            return `<div style="margin-bottom:.55rem">
              <div class="row between tiny"><span>${esc(m.name)} · ${esc(m.monthLabel)} ${now ? '<span class="pill accent">now</span>' : ''}</span>
                <span class="mono">${c.goalScore}% goals · ${c.focusDone}/${c.focusTotal} focus</span></div>
              <div class="bar"><i style="width:${c.goalScore}%"></i></div>
            </div>`;
          }).join('')}
        </div>
      </section>
    </div>

    <section class="card">
      <header><h2>Where you are</h2><span class="sub">post-op timeline</span></header>
      <div class="card-body">
        ${timeline(today)}
      </div>
    </section>

  </div>`;
}

/**
 * The last three weeks as a dated timeline, workouts and check-ins on their
 * own lines so neither passes for the other. Confirmed exercises only; a
 * partial one says so; a day that was only opened does not appear.
 */
function recentDays(today) {
  const rows = [];
  for (let i = 0; i < 21; i++) {
    const iso = addDays(today, -i);
    const d = getDay(iso);
    if (!d) continue;
    const logged = (d.entries || []).filter((e) => e.logged);
    const exercises = new Set(logged.map((e) => e.pid || `x:${e.ex}`));
    const partial = new Set(logged.filter((e) => e.partial).map((e) => e.pid || `x:${e.ex}`));
    const c = d.checkin || {};
    const check = hasCheckin(d);
    if (!exercises.size && !check && !d.notes) continue;
    const plan = dayComplete(state.data, iso);
    rows.push(`<div class="tline-day">
      <div class="tline-date">${esc(fmtDate(iso, 'short'))}${iso === today ? ' · today' : ''}</div>
      ${exercises.size ? `<div class="tline-row two">
        <span class="tline-main"><b>Workout</b><span class="tline-sub">${exercises.size} exercise${exercises.size === 1 ? '' : 's'} confirmed${partial.size ? `, ${partial.size} partly` : ''}${plan && plan.planned ? ` · ${plan.done} of ${plan.planned} planned` : ''}</span></span>
        ${plan && plan.planned && plan.complete ? '<span class="pill good">plan done</span>' : '<span></span>'}
      </div>` : ''}
      ${check ? `<div class="tline-row two">
        <span class="tline-main"><b>Knee check-in</b><span class="tline-sub">${[
          (num(c.painL) != null || num(c.painR) != null) ? `pain L ${c.painL ?? '·'} · R ${c.painR ?? '·'}` : '',
          [c.effusionL, c.effusionR].some((v) => v && v !== 'Zero') ? 'swelling logged' : '',
          c.nextDay ? `yesterday left you ${String(c.nextDay).toLowerCase()}` : '',
        ].filter(Boolean).map(esc).join(' · ') || 'notes'}</span></span><span></span>
      </div>` : ''}
      ${d.notes ? `<div class="tline-note">${esc(d.notes)}</div>` : ''}
    </div>`);
  }
  if (!rows.length) return '';
  return `<section class="card">
    <header><h2>Recent days</h2><span class="sub">workouts and check-ins, last three weeks</span></header>
    <div class="card-body"><div class="tline">${rows.join('')}</div></div>
  </section>`;
}

function renderClinicalPanel() {
  return `<div class="stack">
    <section class="card">
      <header><h2>Clinical history</h2><span class="sub">from your notes: background, not something to tick off</span></header>
      <div class="card-body">
        <div class="tline clinical">${CLINIC_TIMELINE.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => {
          // Long entries fold after two points. Nothing is removed: the rest
          // is one tap away, word for word.
          const head = t.points.slice(0, 2);
          const more = t.points.slice(2);
          return `<div class="tline-day">
            <div class="tline-date">${esc(fmtDate(t.date, 'short'))}${t.who ? ` · <span class="tline-who">${esc(t.who)}</span>` : ''}</div>
            <div class="tline-title">${esc(t.title)}</div>
            <ul class="plain">${head.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
            ${more.length ? `<details class="exh-more"><summary>${more.length} more</summary>
              <ul class="plain">${more.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
          </div>`;
        }).join('')}</div>

        <div class="section-title" style="margin-top:1rem">Things being watched</div>
        <ul class="plain">${CASE.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>

        <div class="section-title" style="margin-top:1rem">Clearances</div>
        <ul class="plain">${CASE.clearances.map((c) => `<li>${esc(c.text)} <span class="pill ${c.status === 'cleared' ? 'good' : 'warn'}">${esc(c.status)}</span></li>`).join('')}</ul>

        <div class="section-title" style="margin-top:1rem">Ongoing management</div>
        <ul class="plain">${CASE.management.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>
    </section>
  </div>`;
}

function levelFor(iso) {
  const d = getDay(iso);
  if (!d) return 0;
  const n = (d.entries || []).filter((e) => e.logged).length;
  if (!n) return hasCheckin(d) ? 1 : 0;
  if (n >= 10) return 4;
  if (n >= 6) return 3;
  if (n >= 3) return 2;
  return 1;
}

function timeline(today) {
  const s = state.data.settings;
  const rows = [
    { label: 'Injury', date: s.injuryDate, tone: '' },
    { label: 'Left ACL reconstruction', date: s.surgeryLeft, tone: 'left', note: CASE.legs.left.procedure + ' · ' + CASE.legs.left.weightBearing },
    { label: 'Right ACL reconstruction', date: s.surgeryRight, tone: 'right', note: CASE.legs.right.procedure + ' · ' + CASE.legs.right.weightBearing },
    { label: 'Plan starts: Month 1', date: PLAN_MONTHS[0].start, tone: '' },
    { label: 'Left knee reaches 9 months', date: addMonths(s.surgeryLeft, 9), tone: 'left', note: 'Melbourne guide: research suggests a minimum of 9 months before return to sport, guided by your surgeon.' },
    { label: 'Right knee reaches 9 months', date: addMonths(s.surgeryRight, 9), tone: 'right', note: 'Same 9-month marker for the right knee.' },
    { label: 'Plan target: full 1-hour show', date: PLAN_MONTHS[5].end, tone: '', note: 'Month 6 also asks for two full show runs in one day by the end of January.' },
  ].filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));

  return `<div>${rows.map((r) => {
    const past = r.date <= today;
    const d = daysBetween(today, r.date);
    return `<div class="row" style="gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--line-2);align-items:flex-start">
      <span class="pill ${r.tone}" style="min-width:82px;justify-content:center">${esc(fmtDateNum(r.date))}</span>
      <div style="flex:1;min-width:0">
        <div class="small" style="font-weight:${past ? 450 : 560}">${esc(r.label)}</div>
        ${r.note ? `<div class="tiny muted">${esc(r.note)}</div>` : ''}
      </div>
      <span class="tiny ${past ? 'muted' : ''}" style="white-space:nowrap">${past ? `${-d} d ago` : `in ${d} d`}</span>
    </div>`;
  }).join('')}
  ${gapNote()}</div>`;
}

function gapNote() {
  const nine = addMonths(state.data.settings.surgeryRight, 9);
  if (!nine) return '';
  const gap = daysBetween(nine, PLAN_MONTHS[5].end);
  return `<div class="tiny muted" style="margin-top:.6rem">
    The 9-month markers come from the Melbourne guide's return-to-sport section. Your plan's Month 6 target, the full
    1-hour show: sits <strong>${Math.abs(gap)} days ${gap < 0 ? 'before' : 'after'}</strong> the right knee reaches
    9 months. Worth raising with your team.
  </div>`;
}

function addMonths(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

