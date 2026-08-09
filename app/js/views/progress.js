import { esc, currentDayIso, addDays, fmtDate, fmtDateNum, daysBetween, num } from '../util.js';
import { state, getDay, loggedDates, hasCheckin } from '../store.js';
import { PLAN_MONTHS, monthForDate } from '../../data/plan.js';
import { CASE, CLINIC_TIMELINE } from '../../data/history.js';
import { heatmap, lineChart } from '../components.js';
import { monthCompletion } from './planview.js';
import { renderWeekPanel, bindWeekPanel } from './week.js';
import { renderMeasuresPanel, bindMeasuresPanel } from './measures.js';
import { renderMelbourne, bindMelbourne } from './melbourneview.js';

const TABS = [['week', 'This week'], ['history', 'History'], ['tests', 'Tests & VALD'],
              ['melbourne', 'Melbourne'], ['clinical', 'Clinical notes']];

export function renderProgress(ctx) {
  const tab = ctx.gtab || 'week';
  return `<div class="stack">
    <div class="tabrow">
      ${TABS.map(([k, l]) => `<button class="btn sm ${tab === k ? 'primary' : ''}" data-gtab="${k}">${l}</button>`).join('')}
    </div>
    ${tab === 'week' ? renderWeekPanel(ctx) : ''}
    ${tab === 'history' ? renderHistoryPanel(ctx) : ''}
    ${tab === 'tests' ? renderMeasuresPanel(ctx) : ''}
    ${tab === 'melbourne' ? renderMelbourne(ctx) : ''}
    ${tab === 'clinical' ? renderClinicalPanel() : ''}
  </div>`;
}

export function bindProgress(root, ctx, rerender) {
  if ((ctx.gtab || 'week') === 'melbourne') bindMelbourne(root, ctx, rerender);
  root.querySelectorAll('[data-gtab]').forEach((b) => b.addEventListener('click', () => {
    ctx.gtab = b.dataset.gtab;
    rerender();
  }));
  bindWeekPanel(root, ctx, rerender);
  bindMeasuresPanel(root, ctx, rerender);
  root.querySelectorAll('.heat-cell[data-date]').forEach((c) => c.addEventListener('click', () => {
    ctx.date = c.dataset.date;
    ctx.go('today');
  }));
}

function renderHistoryPanel(ctx) {
  const today = currentDayIso();
  const dates = loggedDates();
  const streak = currentStreak(today);
  const last30 = countIn(addDays(today, -29), today);
  const totalSessions = dates.filter((d) => (getDay(d).entries || []).length).length;

  const painPts = dates
    .map((d) => ({ date: d, c: getDay(d).checkin || {} }))
    .filter((x) => num(x.c.painL) != null || num(x.c.painR) != null);

  return `
  <div class="stack">
    <div class="kpis">
      <div class="kpi"><div class="v">${streak}</div><div class="k">day streak</div></div>
      <div class="kpi"><div class="v">${last30}</div><div class="k">days logged, last 30</div></div>
      <div class="kpi"><div class="v">${totalSessions}</div><div class="k">sessions logged</div></div>
    </div>

    <section class="card">
      <header><h2>Activity</h2><span class="sub">26 weeks · darker = more categories trained</span></header>
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
        <header><h2>Pain trend</h2><span class="sub">0–10, per knee</span></header>
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
            const now = monthForDate(currentDayIso())?.id === m.id;
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

function renderClinicalPanel() {
  return `<div class="stack">
    <section class="card">
      <header><h2>Clinical history</h2><span class="sub">from your notes — background, not something to tick off</span></header>
      <div class="card-body">
        ${CLINIC_TIMELINE.map((t) => `
          <div style="margin-bottom:.9rem">
            <div class="row" style="gap:.4rem"><strong class="small">${esc(fmtDate(t.date, 'short'))} — ${esc(t.title)}</strong>
              <span class="tiny muted">${esc(t.who)}</span></div>
            <ul class="plain">${t.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
          </div>`).join('')}

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
  const n = (d.entries || []).length;
  if (!n) return hasCheckin(d) ? 1 : 0;
  if (n >= 10) return 4;
  if (n >= 6) return 3;
  if (n >= 3) return 2;
  return 1;
}

function countIn(fromIsoStr, toIsoStr) {
  return loggedDates().filter((d) => d >= fromIsoStr && d <= toIsoStr).length;
}

function currentStreak(today) {
  const set = new Set(loggedDates());
  let n = 0;
  let cur = today;
  if (!set.has(cur)) cur = addDays(cur, -1); // today not logged yet doesn't break it
  while (set.has(cur)) { n++; cur = addDays(cur, -1); }
  return n;
}

function timeline(today) {
  const s = state.data.settings;
  const rows = [
    { label: 'Injury', date: s.injuryDate, tone: '' },
    { label: 'Left ACL reconstruction', date: s.surgeryLeft, tone: 'left', note: CASE.legs.left.procedure + ' · ' + CASE.legs.left.weightBearing },
    { label: 'Right ACL reconstruction', date: s.surgeryRight, tone: 'right', note: CASE.legs.right.procedure + ' · ' + CASE.legs.right.weightBearing },
    { label: 'Plan starts — Month 1', date: PLAN_MONTHS[0].start, tone: '' },
    { label: 'Left knee reaches 9 months', date: addMonths(s.surgeryLeft, 9), tone: 'left', note: 'Melbourne guide: research suggests a minimum of 9 months before return to sport, guided by your surgeon.' },
    { label: 'Right knee reaches 9 months', date: addMonths(s.surgeryRight, 9), tone: 'right', note: 'Same 9-month marker for the right knee.' },
    { label: 'Plan target — full 1-hour show', date: PLAN_MONTHS[5].end, tone: '', note: 'Month 6 also asks for two full show runs in one day by the end of January.' },
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
    The 9-month markers come from the Melbourne guide's return-to-sport section. Your plan's Month 6 target — the full
    1-hour show — sits <strong>${Math.abs(gap)} days ${gap < 0 ? 'before' : 'after'}</strong> the right knee reaches
    9 months. Worth raising with your team.
  </div>`;
}

function addMonths(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

