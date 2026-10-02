import { esc, todayIso, addDays, fmtDate, fmtDateShort, daysBetween, num, weekStart } from '../util.js';
import { state, getDay, loggedDates, hasCheckin, surgeryDate } from '../store.js';
import { ptMark } from '../ptmark.js';
import { PLAN_MONTHS, PLAN_META, monthForDate } from '../../data/plan.js';
import { CASE, CLINIC_TIMELINE } from '../../data/history.js';
import { lineChart } from '../components.js';
import { monthCompletion } from '../goals.js';
import { planStreak, dayComplete } from '../planstreak.js';
import { monthCalendar, targetRows, bindHistory3, lifeKey } from './history3.js';
import { kitChart, bindKitCharts, nativeSpec, msOf, CHEV, DOWN, menu, sheet, enhanceSelects } from './pkit.js';
import { renderMeasuresPanel, bindMeasuresPanel, MTABS } from './measures.js';
import { renderMelbourne, bindMelbourne } from './melbourneview.js';
import { renderOverview, bindOverview, weekBar, bindWeekBar, insightsRow, contentWidth } from './overview.js';
import { renderTrends, bindTrends } from './trends.js';
import { renderSessions, bindSessions, sessionCount } from './sessions.js';
import { renderMedLevel, bindMedLevel, medTabLabel } from './medlevel.js';
import { renderRecovery, bindRecovery, recoveryTabLabel } from './recovery.js';
import * as REC from './recovery.js';
import { tablet } from './standboard.js';
import { isNative } from '../native-bridge.js';
import { railShowing, pageShowing } from '../railpages.js';
import { glide } from '../glide.js';

// Set by a tap in the section row, read by the paint it asks for (B5-4).
let subnavTap = false;

// Round 3 (2026-09-30), his words tonight: "Maybe we can work in the diagram of the leg"
// and, of sleep, "I definitely will be looking at the sleep data a lot, so maybe have that a
// little less hidden". Plan 1B and 1C: a glass switch leads Progress, Legs / Sleep, remembered
// per device, and History (the record, where the supplement ticks now live too) is the third
// place. Trends and Clinical are one level down from Legs (rows at the foot of Legs, and each
// region sheet's "Every ... test"), so no switch sits inside the switch (audit R5).
//
// Sleep shows the sleep builder's page when it exports renderSleep and bindSleep (recovery.js,
// or js/views/sleep.js), else the Oura section as it was. It appears from data, like the old
// Oura section: never a dead segment. In the native app the ring page has no tab of its own
// (the overlay's "Oura" button went there), so Sleep lives here; the full desktop shell and an
// iPad with the side rail keep the ring on the rail (railpages.js: one surface each).
const MODE_KEY = 'rt.progress.mode';
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'sleep' ? 'sleep' : 'overview'; } catch { return 'overview'; } };
const saveMode = (v) => { try { localStorage.setItem(MODE_KEY, v); } catch { /* per device */ } };

let EXT = null;         // the sleep builder's own module, when there is one
let lastRerender = null;
(async () => {
  for (const f of ['./sleep.js']) {
    try {
      const m = await import(f);
      if (m && typeof m.renderSleep === 'function') { EXT = m; if (document.querySelector('#view .progress[data-mode="sleep"]')) lastRerender?.(); return; }
    } catch { /* not built (yet): the Oura section stands in */ }
  }
})();
function sleepApi() {
  const m = typeof REC.renderSleep === 'function' ? REC : EXT;
  if (m) return { render: m.renderSleep, bind: typeof m.bindSleep === 'function' ? m.bindSleep : () => {}, label: m.sleepLabel?.() };
  return { render: renderRecovery, bind: bindRecovery, label: null };
}
const sleepHere = () => (isNative() || !railShowing()) && !!(recoveryTabLabel() || (sleepApi().render !== renderRecovery && sleepApi().label !== null));

const LEGS = new Set(['overview', 'trends', 'clinical']);
const modes = () => {
  const out = [['overview', 'Legs']];
  if (sleepHere()) out.push(['sleep', 'Sleep']);
  out.push(['history', 'History']);
  // The web app on a phone still offers the medicine section here (no rail, no tab of its own).
  if (!isNative() && !pageShowing('meds') && medTabLabel()) out.push(['meds', medTabLabel()]);
  return out;
};
function currentTab(ctx) {
  let tab = ctx.gtab || readMode();
  if (tab === 'recovery') tab = 'sleep';
  if (tab === 'sleep' && !sleepHere()) tab = 'overview';
  if (tab === 'meds' && (isNative() || pageShowing('meds') || !medTabLabel())) tab = 'overview';
  return tab;
}
const CTABS = [['notes', 'Notes'], ['tests', 'Tests'], ['melbourne', 'Melbourne guide']];
const SUB = { trends: 'Every test', clinical: 'Clinical' };
const BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

export function renderProgress(ctx) {
  const tab = currentTab(ctx);
  ctx.gtab = tab;
  const seg = LEGS.has(tab) ? 'overview' : tab;
  // The data-nring mark tells the native overlay this row already offers the ring (it would
  // otherwise add its own "Oura" button, a second way to the same page).
  return `<div class="stack progress" data-mode="${esc(seg)}">
    <header class="pagehead"><h1>Progress</h1></header>
    <nav class="subnav pg-modes n${modes().length}" aria-label="Progress">
      ${modes().map(([k, l]) => `<button class="${seg === k ? 'on' : ''}" data-gtab="${k}" ${seg === k ? 'aria-current="page"' : ''}>${esc(l)}</button>`).join('')}
      <i data-nring hidden></i>
    </nav>
    ${SUB[tab] ? `<button type="button" class="pg-back" data-gtab="overview">${BACK}Legs</button>` : ''}
    ${tab === 'overview' ? renderOverview(ctx) + legsMore() : ''}
    ${tab === 'trends' ? renderTrends(ctx) : ''}
    ${tab === 'history' ? renderHistoryPanel(ctx) : ''}
    ${tab === 'clinical' ? renderClinical(ctx) : ''}
    ${tab === 'meds' ? renderMedLevel(ctx) : ''}
    ${tab === 'sleep' ? `<div class="pg-sleep">${sleepApi().render(ctx)}</div>` : ''}
  </div>`;
}

// One level down from Legs: every test over time, and the clinic's notes, tests and the guide.
function legsMore() {
  return `<nav class="pg-more" aria-label="More about the legs">
    <button type="button" data-gtab="trends"><span>Every test</span>${CHEV}</button>
    <button type="button" data-gtab="clinical"><span>Clinical notes and tests</span>${CHEV}</button>
  </nav>`;
}

function renderClinical(ctx) {
  const ctab = ctx.ctab || 'notes';
  // Rehab Test v3 (2026-09-30, audit R5, ruling K17): no switch inside the switch. The part of
  // Clinical on show is a menu button with its name, like Trends' region.
  ctx.mtabMenu = true;
  const name = ctab === 'tests' ? (MTABS.find(([k]) => k === (ctx.mtab || 'baselines')) || MTABS[0])[1] : (CTABS.find(([k]) => k === ctab) || CTABS[0])[1];
  return `<div class="stack">
    <div class="t3-bar"><button type="button" class="t3-pick" data-ctab-menu aria-label="Clinical: ${esc(name)}. Change">${esc(name)}${DOWN}</button></div>
    ${ctab === 'notes' ? renderClinicalPanel() : ''}
    ${ctab === 'tests' ? renderMeasuresPanel(ctx) : ''}
    ${ctab === 'melbourne' ? renderMelbourne(ctx) : ''}
  </div>`;
}

// A turn of the iPad (834 to 1194 wide) or a Split View resize changes how wide every chart here
// should be drawn (they are drawn in real pixels, in the width of their column). The page repaints
// once when the view's width has moved by more than 120 pt since it was drawn; the iPhone turned
// sideways never passes `tablet()`, and a phone's width never moves that far.
let drawnWidth = 0;
if (typeof window !== 'undefined') {
  let queued = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(() => {
      const v = document.getElementById('view');
      if (!v || !document.querySelector('#view .progress') || !lastRerender || !tablet()) return;
      if (Math.abs(v.clientWidth - drawnWidth) > 120) { drawnWidth = v.clientWidth; lastRerender(); }
    });
  });
}

export function bindProgress(root, ctx, rerender) {
  lastRerender = rerender;
  drawnWidth = document.getElementById('view')?.clientWidth || 0;
  const tab = currentTab(ctx);
  const ctab = ctx.ctab || 'notes';
  if (tab === 'clinical' && ctab === 'melbourne') bindMelbourne(root, ctx, rerender);
  if (tab === 'overview') bindOverview(root, ctx, rerender);
  if (tab === 'trends') bindTrends(root, ctx, rerender);
  if (tab === 'meds') bindMedLevel(root, ctx, rerender);
  if (tab === 'sleep') sleepApi().bind(root, ctx, rerender);
  root.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => { ctx.ctab = b.dataset.ctab; rerender(); }));
  root.querySelector('[data-ctab-menu]')?.addEventListener('click', async (e) => {
    const cur = (ctx.ctab || 'notes') === 'tests' ? `tests:${ctx.mtab || 'baselines'}` : (ctx.ctab || 'notes');
    const items = [{ id: 'notes', title: 'Notes' }, ...MTABS.map(([k, l]) => ({ id: `tests:${k}`, title: l })), { id: 'melbourne', title: 'Melbourne guide' }]
      .map((x) => ({ ...x, checked: x.id === cur }));
    const pick = await menu(e.currentTarget, { title: 'Clinical', items });
    if (!pick || pick === cur) return;
    const [c, m] = pick.split(':');
    ctx.ctab = c;
    if (m) { ctx.mtab = m; ctx.chartMeasure = null; }
    rerender();
    window.scrollTo(0, 0);
  });
  if (tab === 'clinical') enhanceSelects(root);
  root.querySelectorAll('[data-cl-note]').forEach((b) => b.addEventListener('click', () => openClinicNote(Number(b.dataset.clNote))));
  root.querySelectorAll('[data-gtab]').forEach((b) => b.addEventListener('click', () => {
    if (ctx.gtab !== b.dataset.gtab) ctx.gview = null;
    // A tap in the section row glides its underline to the new one (B5-4).
    subnavTap = !!b.closest('.subnav') && ctx.gtab !== b.dataset.gtab;
    ctx.gtab = b.dataset.gtab;
    if (b.closest('.subnav') && (ctx.gtab === 'overview' || ctx.gtab === 'sleep')) saveMode(ctx.gtab);
    rerender();
    if (!b.closest('.subnav')) window.scrollTo(0, 0);
  }));
  const nav = root.querySelector('.progress > .subnav');
  if (nav) glide(nav, nav.querySelector('button.on'), { key: 'progress-subnav', cls: 'gi-line', animate: subnavTap });
  subnavTap = false;
  // Only the panel on screen binds (revision 3 F29): Overview's chart used to
  // get a second set of handlers from the Tests binder.
  if (tab === 'history') {
    bindHistory3(root, ctx, rerender);
    // Fix b-native:N8: the Knee pain chart was drawn with a native spec but never bound, so a tap
    // opened nothing. Bound here like every other kit chart: a tap opens the app's chart, a drag scrubs.
    bindKitCharts(root);
    root.querySelector('[data-h3-sess]')?.addEventListener('click', () => { ctx.histSessOpen = !ctx.histSessOpen; rerender(); });
    bindSessions(root, ctx, rerender, { onEdit: (s) => correctOnToday(ctx, s) });
  }
  if (tab === 'clinical' && ctab === 'tests') bindMeasuresPanel(root, ctx, rerender);
}

/** Open a session's own record in Today's editor, on its date. */
function correctOnToday(ctx, s) {
  ctx.date = s.iso;
  ctx.editing = s.pid || s.entryId;
  ctx.openRest = true;   // a row not planned that day sits in the fold
  ctx.scrollToRow = s.pid || s.entryId;
  ctx.go('today');
}

// Rehab Test v3 (2026-09-30): the month calendar leads (history3.js). Under it, one line of
// counts (not three look alike tiles, 07 4.6), the week's goal rings, the targets, the pain
// trend as a kit chart, the sessions and the dated timeline. The stage completion bars moved
// to Plan only (the road and the stage cards say it there).
function renderHistoryPanel(ctx) {
  const today = todayIso();
  const dates = loggedDates();
  const from30 = addDays(today, -29);
  const workout30 = dates.filter((d) => d >= from30 && (getDay(d).entries || []).some((e) => e.logged)).length;
  const checkins30 = dates.filter((d) => d >= from30 && hasCheckin(getDay(d))).length;
  const painPts = dates.map((d) => ({ date: d, c: getDay(d).checkin || {} })).filter((x) => num(x.c.painL) != null || num(x.c.painR) != null);
  const pain = [
    { key: 'L', name: 'Left', points: painPts.filter((p) => num(p.c.painL) != null).map((p) => ({ t: msOf(p.date), v: num(p.c.painL) })) },
    { key: 'R', name: 'Right', points: painPts.filter((p) => num(p.c.painR) != null).map((p) => ({ t: msOf(p.date), v: num(p.c.painR) })) },
  ].filter((x) => x.points.length);
  const painChart = pain.length && new Set(pain.flatMap((x) => x.points.map((p) => p.t))).size > 1
    ? kitChart({ series: pain, width: contentWidth() + 8, height: 150, zero: true, unit: 'of 10', label: 'Knee pain, 0 to 10',
      native: nativeSpec({ kind: 'pain', title: 'Knee pain', unit: 'of 10', series: pain }) }) : '';
  // Fix d-progress:d4: every calendar state has its key (C7: colour that carries meaning is explained).
  const key = `<div class="h3-key" aria-hidden="true">
      <span><i class="h3-kd done"></i>Plan done</span><span><i class="h3-kd part"></i>Part done</span>
      <span><i class="h3-kd open"></i>Planned, not done</span><span><i class="h3-kd rest"></i>Rest</span><span><i class="h3-kd work"></i>Extra work</span>
      ${lifeKey(ctx.histMonth || today.slice(0, 7))}
    </div>`;
  // Fix d-progress:d7 (C3, heavy panels closed on the phone): the session list is a row that
  // opens in place, and the week grid sits above it where it can be found.
  const sessOpen = !!ctx.histSessOpen;
  const nSess = sessionCount();
  const cal = monthCalendar(ctx, today).replace(/<\/section>\s*$/, `${key}</section>`);
  const facts = `<div class="h3-facts"><span><b>${workout30}</b> workout days</span><span><b>${checkins30}</b> knee check-ins</span><span class="h3-when">last 30 days</span></div>`;
  const grid = `<button type="button" class="h3-row" data-h3-grid>Exercise by exercise, this week${CHEV}</button>`;
  const pains = painChart ? `<section class="h3-sec"><h2 class="h3-h">Knee pain</h2><div class="h3-card">${painChart}</div></section>` : '';
  const sess = `<section class="h3-sec">
      <button type="button" class="h3-row h3-disc ${sessOpen ? 'on' : ''}" data-h3-sess aria-expanded="${sessOpen}"><b>Sessions</b><span class="h3-rowv">${nSess}${CHEV}</span></button>
      ${sessOpen ? renderSessions(ctx) : ''}
    </section>`;
  const keyDates = `<section class="h3-sec"><h2 class="h3-h">Key dates</h2><div class="h3-card">${timeline(today)}</div></section>`;
  // The iPad (wide and tall, never an iPhone held sideways): the month leads on the leading half
  // with the dated timeline under it, the counts, targets, pain, sessions and insights on the
  // trailing half (rt-progress.css lays the two columns out from 620 pt of content).
  if (tablet() && contentWidth() >= 620) {
    return `
  <div class="stack hist3 h3-tab">
    <div class="h3-lcol">${cal}${keyDates}</div>
    <div class="h3-rcol">${facts}${targetRows()}${grid}${pains}${sess}${insightsRow(today)}</div>
  </div>`;
  }
  return `
  <div class="stack hist3">
    ${cal}
    ${facts}
    ${targetRows()}
    ${grid}
    ${pains}
    ${sess}
    ${keyDates}
    ${insightsRow(today)}
  </div>`;
}

// Rehab Test v3 (2026-09-30, audit R5): the notes as visit rows (date, clinician, title and
// the clinic's badge) that open the full note in a sheet, word for word. His clinical text is
// his data: nothing is shortened, only moved one tap away.
const clinicTimeline = () => CLINIC_TIMELINE.concat(state.history?.timeline || []).sort((a, b) => (a.date < b.date ? 1 : -1));

function renderClinicalPanel() {
  const rows = clinicTimeline();
  return `<div class="stack cl3">
    <div class="cl-list">${rows.map((t, i) => `<button type="button" class="cl-row" data-cl-note="${i}">
      <span class="cl-date"><b>${esc(String(Number(t.date.slice(8, 10))))}</b><small>${esc(new Date(`${t.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short' }))}</small></span>
      <span class="cl-text"><b>${esc(t.title)}${t.clinic ? ptMark({ seeded: true, clinic: t.clinic }) : ''}</b>${t.who ? `<small>${esc(String(t.who).split(',')[0])}</small>` : ''}</span>
      ${CHEV}</button>`).join('')}</div>
    ${CASE.flags?.length ? `<section class="h3-sec"><h2 class="h3-h">Being watched</h2><ul class="cl-ul">${CASE.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul></section>` : ''}
    ${CASE.clearances?.length ? `<section class="h3-sec"><h2 class="h3-h">Clearances</h2><ul class="cl-ul">${CASE.clearances.map((c) => `<li><span>${esc(c.text)}</span><span class="cl-pill">${esc(c.status)}</span></li>`).join('')}</ul></section>` : ''}
    ${CASE.management?.length ? `<section class="h3-sec"><h2 class="h3-h">Ongoing management</h2><ul class="cl-ul">${CASE.management.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>` : ''}
  </div>`;
}

function openClinicNote(i) {
  const t = clinicTimeline()[i];
  if (!t) return;
  sheet({
    title: t.title,
    body: `<div class="cl-note"><div class="cl-notewho">${esc(fmtDate(t.date, 'short'))}${t.who ? ` · ${esc(t.who)}` : ''}</div>
      <ul>${t.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`,
  });
}

function timeline(today) {
  const s = state.data.settings;
  // The case file's dates stand in when a device's settings have none
  // (surgeryDate), and a note joins only the parts it has (2026-09-22 audit:
  // the rows vanished there, and an empty case file printed a lone " · ").
  const L = surgeryDate('left'), R = surgeryDate('right');
  const legNote = (leg) => [CASE?.legs?.[leg]?.procedure, CASE?.legs?.[leg]?.weightBearing].filter(Boolean).join(' · ');
  const rows = [
    { label: 'Injury', date: s.injuryDate, tone: '' },
    { label: 'Left ACL reconstruction', date: L, tone: 'left', note: legNote('left') },
    { label: 'Right ACL reconstruction', date: R, tone: 'right', note: legNote('right') },
    { label: PLAN_MONTHS[0].short ? `Plan starts: ${PLAN_MONTHS[0].short}` : 'Plan starts: Month 1', date: PLAN_MONTHS[0].start, tone: '' },
    { label: 'Left knee reaches 9 months', date: addMonths(L, 9), tone: 'left', note: 'Melbourne guide, return to sport' },
    { label: 'Right knee reaches 9 months', date: addMonths(R, 9), tone: 'right', note: 'Melbourne guide, return to sport' },
    ...(PLAN_META.dates || []).map((x) => ({ label: x.label, date: x.date, tone: '', note: x.note || '' })),
  ].filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));

  return `<div>${rows.map((r) => {
    const past = r.date <= today;
    const d = daysBetween(today, r.date);
    return `<div class="row" style="gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--line-2);align-items:flex-start">
      <span class="pill ${r.tone}" style="min-width:82px;justify-content:center">${esc(fmtDateShort(r.date))}</span>
      <div style="flex:1;min-width:0">
        <div class="small" style="font-weight:${past ? 450 : 560}">${esc(r.label)}</div>
        ${r.note ? `<div class="tiny muted">${esc(r.note)}</div>` : ''}
      </div>
      <span class="tiny ${past ? 'muted' : ''}" style="white-space:nowrap">${d === 0 ? 'today' : past ? `${-d} d ago` : `in ${d} d`}</span>
    </div>`;
  }).join('')}
  ${gapNote()}</div>`;
}

function gapNote() {
  const nine = addMonths(surgeryDate('right'), 9);
  if (!nine) return '';
  const show = (PLAN_META.dates || []).find((x) => x.show);
  if (!show) return '';
  const gap = daysBetween(nine, show.date);
  // Fix d-progress:d12: a fact, not a sentence about the screen, and no advice (never tell him what to raise).
  return `<div class="tiny muted" style="margin-top:.6rem">${esc(show.label)}: <strong>${Math.abs(gap)} day${Math.abs(gap) === 1 ? '' : 's'} ${gap < 0 ? 'before' : 'after'}</strong> the right knee reaches 9 months</div>`;
}

function addMonths(iso, n) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

