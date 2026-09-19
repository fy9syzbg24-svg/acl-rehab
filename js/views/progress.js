import { esc, todayIso, addDays, fmtDate, fmtDateNum, daysBetween, num, weekStart } from '../util.js';
import { state, getDay, loggedDates, hasCheckin } from '../store.js';
import { ptMark } from '../ptmark.js';
import { PLAN_MONTHS, PLAN_META, monthForDate } from '../../data/plan.js';
import { CASE, CLINIC_TIMELINE } from '../../data/history.js';
import { lineChart } from '../components.js';
import { monthCompletion } from '../goals.js';
import { planStreak, dayComplete } from '../planstreak.js';
import { renderWeekPanel, bindWeekPanel } from './week.js';
import { renderMeasuresPanel, bindMeasuresPanel } from './measures.js';
import { renderMelbourne, bindMelbourne } from './melbourneview.js';
import { renderOverview, bindOverview, weekBar, insightsRow } from './overview.js';
import { renderTrends, bindTrends } from './trends.js';
import { renderSessions, bindSessions } from './sessions.js';

// 2026-09-16: four sections. Overview is the glance, Trends the expanded
// view, History the record, Clinical the notes and every table and form.
const TABS = [['overview', 'Overview'], ['trends', 'Trends'], ['history', 'History'], ['clinical', 'Clinical']];
const CTABS = [['notes', 'Notes'], ['tests', 'Tests'], ['melbourne', 'Melbourne guide']];

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
    ${tab === 'trends' ? renderTrends(ctx) : ''}
    ${tab === 'history' ? renderHistoryPanel(ctx) : ''}
    ${tab === 'clinical' ? renderClinical(ctx) : ''}
  </div>`;
}

function renderClinical(ctx) {
  const ctab = ctx.ctab || 'notes';
  return `<div class="stack">
    <div class="tabrow subtabs" role="tablist" aria-label="Clinical">
      ${CTABS.map(([k, l]) => `<button class="btn sm ${ctab === k ? 'primary' : ''}" data-ctab="${k}" role="tab" aria-selected="${ctab === k}">${l}</button>`).join('')}
    </div>
    ${ctab === 'notes' ? renderClinicalPanel() : ''}
    ${ctab === 'tests' ? renderMeasuresPanel(ctx) : ''}
    ${ctab === 'melbourne' ? renderMelbourne(ctx) : ''}
  </div>`;
}

export function bindProgress(root, ctx, rerender) {
  const tab = ctx.gtab || 'overview';
  const ctab = ctx.ctab || 'notes';
  if (tab === 'clinical' && ctab === 'melbourne') bindMelbourne(root, ctx, rerender);
  if (tab === 'overview') bindOverview(root, ctx, rerender);
  if (tab === 'trends') bindTrends(root, ctx, rerender);
  root.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => { ctx.ctab = b.dataset.ctab; rerender(); }));
  root.querySelectorAll('[data-gtab]').forEach((b) => b.addEventListener('click', () => {
    if (ctx.gtab !== b.dataset.gtab) ctx.gview = null;
    ctx.gtab = b.dataset.gtab;
    rerender();
    if (!b.closest('.subnav')) window.scrollTo(0, 0);
  }));
  // Only the panel on screen binds (revision 3 F29): Overview's chart used to
  // get a second set of handlers from the Tests binder.
  if (tab === 'history') {
    bindWeekPanel(root, ctx, rerender);
    bindSessions(root, ctx, rerender, { onEdit: (s) => correctOnToday(ctx, s) });
  }
  if (tab === 'clinical' && ctab === 'tests') bindMeasuresPanel(root, ctx, rerender);
  root.querySelector('[data-calmore]')?.addEventListener('click', () => {
    const w = ctx.calWeeks || 8;
    ctx.calWeeks = w >= 26 ? 8 : w + 9;
    rerender();
  });
  root.querySelectorAll('.pc-cell[data-date]').forEach((c) => c.addEventListener('click', () => {
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
    ${weekBar(today)}
    ${renderWeekPanel(ctx)}
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

    ${planCalendar(today, ctx)}

    <div class="grid2">
      <section class="ov-sec">
        <div class="ov-head"><h2>Pain trend</h2><span class="ov-sub">0 to 10, per knee</span></div>
        <div>
          ${painPts.length ? lineChart([
            { label: 'Left', cls: 'lineL', color: 'left', points: painPts.filter((p) => num(p.c.painL) != null).map((p) => ({ date: p.date, value: num(p.c.painL) })) },
            { label: 'Right', cls: 'lineR', color: 'right', points: painPts.filter((p) => num(p.c.painR) != null).map((p) => ({ date: p.date, value: num(p.c.painR) })) },
          ].filter((s) => s.points.length), { height: 140 }) : '<div class="empty">Log a check-in or two and this fills in.</div>'}
          <div class="legend" style="margin-top:.4rem"><span><i style="background:var(--left)"></i>Left</span><span><i style="background:var(--right)"></i>Right</span></div>
        </div>
      </section>

      <section class="ov-sec">
        <div class="ov-head"><h2>${PLAN_MONTHS[0].short ? 'Stage completion' : 'Month completion'}</h2><span class="ov-sub">Measurable goals and focus items</span></div>
        <div>
          ${PLAN_MONTHS.map((m) => {
            const c = monthCompletion(m);
            const now = monthForDate(todayIso())?.id === m.id;
            return `<div style="margin-bottom:.55rem">
              <div class="row between tiny"><span>${esc(m.short ? `${m.short} · ${m.monthLabel}` : `${m.name} · ${m.monthLabel}`)}${now ? ' · <b>Now</b>' : ''}</span>
                <span class="mono">${c.goalScore}% goals · ${c.focusDone}/${c.focusTotal} focus</span></div>
              <div class="bar"><i style="--p:${c.goalScore / 100}"></i></div>
            </div>`;
          }).join('')}
        </div>
      </section>
    </div>

    <section class="ov-sec">
      <div class="ov-head"><h2>Where you are</h2><span class="ov-sub">Post-op timeline</span></div>
      <div>
        ${timeline(today)}
      </div>
    </section>
    ${insightsRow(today)}

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
  return `<section class="ov-sec">
    <div class="ov-head"><h2>Recent days</h2><span class="ov-sub">Workouts and check-ins, last three weeks</span></div>
    <div class="tline">${rows.join('')}</div>
  </section>`;
}

function renderClinicalPanel() {
  return `<div class="stack">
    <section class="card">
      <header><h2>Clinical history</h2><span class="sub">from your notes: background, not something to tick off</span></header>
      <div class="card-body">
        <div class="tline clinical">${CLINIC_TIMELINE.concat(state.history?.timeline || []).sort((a, b) => (a.date < b.date ? 1 : -1)).map((t, ti) => {
          // Long entries fold after two points. Nothing is removed: the rest
          // is one tap away, word for word.
          const head = t.points.slice(0, 2);
          const more = t.points.slice(2);
          return `<div class="tline-day">
            <div class="tline-date">${esc(fmtDate(t.date, 'short'))}${t.who ? ` · <span class="tline-who">${esc(t.who)}</span>` : ''}</div>
            <div class="tline-title">${esc(t.title)}${t.clinic ? ptMark({ seeded: true, clinic: t.clinic }) : ''}</div>
            <ul class="plain">${head.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
            ${more.length ? `<details class="exh-more" data-key="clin:${esc(t.date)}:${esc(t.title || String(ti))}"><summary>${more.length} more</summary>
              <ul class="plain">${more.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
          </div>`;
        }).join('')}</div>

        <div class="section-title" style="margin-top:1rem">Things being watched</div>
        <ul class="plain">${CASE.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>

        <div class="section-title" style="margin-top:1rem">Clearances</div>
        <ul class="plain">${CASE.clearances.map((c) => `<li>${esc(c.text)} <span class="pill status">${esc(c.status)}</span></li>`).join('')}</ul>

        <div class="section-title" style="margin-top:1rem">Ongoing management</div>
        <ul class="plain">${CASE.management.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      </div>
    </section>
  </div>`;
}

/**
 * The plan, day by day (revision 3 F33). Each date against the plan recorded
 * for it: complete, not complete, planned rest, or no plan recorded. Extra or
 * repeated work never darkens a day; it stays in Sessions. Newest week first,
 * a week to a row, so every day is a real 44px target. Tap a day to open it.
 */
function planCalendar(today, ctx) {
  const weeks = ctx.calWeeks || 8;
  const first = weekStart(today);
  let firstKnown = null;
  const rows = [];
  for (let w = 0; w < weeks; w++) {
    const mon = addDays(first, -7 * w);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDays(mon, i);
      if (iso > today) { cells.push('<span class="pc-cell future" aria-hidden="true"></span>'); continue; }
      const r = dayComplete(state.data, iso);
      const kind = !r ? 'unknown' : !r.planned ? 'rest' : r.complete ? 'done' : 'open';
      if (kind !== 'unknown' && (!firstKnown || iso < firstKnown)) firstKnown = iso;
      const word = { unknown: 'no plan recorded', rest: 'planned rest', done: `plan complete, ${r?.done} of ${r?.planned}`, open: `not complete, ${r?.done} of ${r?.planned}` }[kind];
      cells.push(`<button class="pc-cell ${kind} ${iso === today ? 'today' : ''}" data-date="${iso}" aria-label="${esc(fmtDate(iso, 'dow'))} ${esc(fmtDate(iso, 'short'))}: ${esc(word)}">${
        kind === 'done' ? PC_CHECK : kind === 'rest' ? '<b></b>' : kind === 'unknown' ? '<em></em>' : ''}</button>`);
    }
    rows.push(`<div class="pc-row"><span class="pc-wk">${esc(fmtDate(mon, 'short'))}</span>${cells.join('')}</div>`);
  }
  return `<section class="ov-sec panelsec plancal">
    <div class="ov-head"><h2>Plan days</h2></div>
    <div class="pc-sub">Each day against the plan recorded for it${firstKnown ? `. Plans recorded since ${esc(fmtDate(firstKnown, 'short'))}` : ''}.</div>
    <div class="pc-grid" role="group" aria-label="Plan days, newest week first">
      <div class="pc-row pc-head" aria-hidden="true"><span class="pc-wk"></span>${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
      ${rows.join('')}
    </div>
    <div class="pc-key">
      <span><i class="pc-cell done">${PC_CHECK}</i>Plan complete</span>
      <span><i class="pc-cell open"></i>Not complete</span>
      <span><i class="pc-cell rest"><b></b></i>Planned rest</span>
      <span><i class="pc-cell unknown"><em></em></i>No plan recorded</span>
    </div>
    <button class="btn sm" data-calmore>Show ${weeks >= 26 ? 'fewer' : 'earlier'} weeks</button>
  </section>`;
}

const PC_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

function timeline(today) {
  const s = state.data.settings;
  const rows = [
    { label: 'Injury', date: s.injuryDate, tone: '' },
    { label: 'Left ACL reconstruction', date: s.surgeryLeft, tone: 'left', note: CASE.legs.left.procedure + ' · ' + CASE.legs.left.weightBearing },
    { label: 'Right ACL reconstruction', date: s.surgeryRight, tone: 'right', note: CASE.legs.right.procedure + ' · ' + CASE.legs.right.weightBearing },
    { label: PLAN_MONTHS[0].short ? `Plan starts: ${PLAN_MONTHS[0].short}` : 'Plan starts: Month 1', date: PLAN_MONTHS[0].start, tone: '' },
    { label: 'Left knee reaches 9 months', date: addMonths(s.surgeryLeft, 9), tone: 'left', note: 'Melbourne guide: research suggests a minimum of 9 months before return to sport, guided by your surgeon.' },
    { label: 'Right knee reaches 9 months', date: addMonths(s.surgeryRight, 9), tone: 'right', note: 'Same 9-month marker for the right knee.' },
    ...(PLAN_META.dates || []).map((x) => ({ label: x.label, date: x.date, tone: '', note: x.note || '' })),
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
  const show = (PLAN_META.dates || []).find((x) => x.show);
  if (!show) return '';
  const gap = daysBetween(nine, show.date);
  return `<div class="tiny muted" style="margin-top:.6rem">
    The 9-month markers come from the Melbourne guide's return-to-sport section. ${esc(show.label)}
    sits <strong>${Math.abs(gap)} days ${gap < 0 ? 'before' : 'after'}</strong> the right knee reaches
    9 months. Worth raising with your team.
  </div>`;
}

function addMonths(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

