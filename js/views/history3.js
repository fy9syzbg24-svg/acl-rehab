// Progress > History for Rehab Test v3 (2026-09-30). History was 16 screens on the phone
// (audit R4). Now the month is the signature (research 07 4.7): one calendar, a filled cell
// per day, the done colour ONLY on a day whose plan is complete (green means done, his rule);
// a day with some of the plan done fills from the bottom in neutral ink by how much was done;
// planned rest is outlined; a day with no plan recorded keeps a faint dot for any work. A tap
// opens that day in a sheet (what was done with each exercise's single frame picture, the knee
// check-in, notes) with a way into Today. Swipe the month sideways, or use the arrows.
// The weekly targets are set from a menu (no number boxes, 07 4.4); the old week tables live
// one tap away in a sheet ("Exercise by exercise"), so nothing he could do before is gone.

import { esc, todayIso, fmtDate, num, addDays, weekStart, weekDays } from '../util.js';
import { state, update, getDay, hasCheckin, weeklyTargetInfo, setWeeklyTarget } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM } from '../../data/program.js';
import { monthForDate } from '../../data/plan.js';
import { dayComplete } from '../planstreak.js';
import { goalGroups } from './week.js';
import { shortCat } from './monthboard.js';
import { workText } from './sessions.js';
import { catRing } from './overview.js';
import { exerciseById, rowName, pictureFor, closeModal, iconTile } from '../components.js';
import { ptMark, bandMark, nameWithMarks } from '../ptmark.js';
import { frameHtml } from '../frames.js';
import { menu, sheet, DOWN } from './pkit.js';

const MONTH_NAME = (key) => new Date(`${key}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';
const ARW_L = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const ARW_R = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// Round 3 (2026-09-30, plan 2.7 "his life as markers on timelines"): a clinic visit, a show he
// marked performed and a shot day ride on their calendar day as one small ink glyph each, read
// only from his record (program.clinicDays, pk.shots) and the test app's own store (rt.local
// shows, feature A1). Facts, no sentence, no conclusion; never a medicine name or a dose.
const LIFE_G = {
  clinic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  show: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/></svg>',
  shot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5l4 4M17.5 6.5l-8.5 8.5-3.5 1 1-3.5 8.5-8.5M7 17l-2.5 2.5"/></svg>',
};
export const LIFE_WORDS = { clinic: 'Clinic visit', show: 'Show', shot: 'Shot day' };
let lifeMemo = null;
export function lifeDays() {
  if (lifeMemo && lifeMemo.at > Date.now() - 2000) return lifeMemo.map;
  const map = {};
  const add = (iso, k) => { if (iso) (map[iso] ||= new Set()).add(k); };
  for (const [iso, on] of Object.entries(state.data?.program?.clinicDays || {})) if (on) add(iso, 'clinic');
  for (const sh of Object.values(state.data?.pk?.shots || {})) {
    if (!sh || sh.removed || !(sh.mg > 0)) continue;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(sh.at || sh.date || ''));
    if (m) add(m[1], 'shot');
  }
  try {
    const loc = JSON.parse(localStorage.getItem('rt.local.v1') || 'null');
    for (const [iso, sh] of Object.entries(loc?.shows || {})) if (sh && sh.performed && !sh.hidden) add(iso, 'show');
  } catch { /* no store yet: no shows */ }
  lifeMemo = { at: Date.now(), map };
  return map;
}
const lifeHtml = (set) => (set && set.size ? `<i class="h3-life">${['show', 'clinic', 'shot'].filter((k) => set.has(k)).map((k) => `<span class="h3-lg ${k}">${LIFE_G[k]}</span>`).join('')}</i>` : '');
/** The key's entries for the life glyphs present in a month. */
export function lifeKey(monthKey) {
  const seen = new Set();
  for (const [iso, set] of Object.entries(lifeDays())) if (iso.startsWith(monthKey)) set.forEach((k) => seen.add(k));
  return ['show', 'clinic', 'shot'].filter((k) => seen.has(k)).map((k) => `<span><i class="h3-kl">${LIFE_G[k]}</i>${LIFE_WORDS[k]}</span>`).join('');
}

/** One cell's state against the plan recorded for that day. Extra work never darkens a day. */
function dayState(iso, today) {
  if (iso > today) return { kind: 'future' };
  const d = getDay(iso);
  const logged = (d?.entries || []).filter((e) => e.logged);
  const r = dayComplete(state.data, iso);
  if (!r) return { kind: logged.length ? 'work' : 'none', n: logged.length };
  if (!r.planned) return { kind: logged.length ? 'work' : 'rest', n: logged.length };
  if (r.complete) return { kind: 'done', done: r.done, planned: r.planned };
  return { kind: r.done ? 'part' : 'open', done: r.done, planned: r.planned, frac: r.planned ? r.done / r.planned : 0 };
}

export function monthCalendar(ctx, today = todayIso()) {
  const key = ctx.histMonth || today.slice(0, 7);
  const [y, m] = key.split('-').map(Number);
  const daysIn = new Date(y, m, 0).getDate();
  const lead = (new Date(`${key}-01T12:00:00`).getDay() + 6) % 7;   // Monday first
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="h3-cell pad" aria-hidden="true"></span>');
  let done = 0;
  for (let dn = 1; dn <= daysIn; dn++) {
    const iso = `${key}-${String(dn).padStart(2, '0')}`;
    const st = dayState(iso, today);
    if (st.kind === 'done') done++;
    const word = {
      future: 'ahead', none: 'nothing recorded', work: `${st.n} exercise${st.n === 1 ? '' : 's'} done, no plan recorded`, rest: 'planned rest',
      done: `plan complete, ${st.done} of ${st.planned}`, part: `${st.done} of ${st.planned} planned done`, open: `none of ${st.planned} planned done`,
    }[st.kind];
    const life = lifeDays()[iso];
    const lifeWords = life ? [...life].map((k) => `, ${LIFE_WORDS[k].toLowerCase()}`).join('') : '';
    cells.push(`<button type="button" class="h3-cell ${st.kind} ${iso === today ? 'today' : ''}" data-h3-day="${iso}" style="--f:${(st.frac || 0).toFixed(3)};--i:${dn}"
      ${st.kind === 'future' ? 'tabindex="-1" aria-hidden="true" disabled' : `aria-label="${esc(fmtDate(iso, 'dow'))} ${esc(fmtDate(iso, 'short'))}: ${esc(word)}${esc(lifeWords)}"`}>
      <b>${dn}</b>${st.kind === 'done' ? CHECK : ''}${lifeHtml(life)}</button>`);
  }
  const shift = (k) => { const d = new Date(y, m - 1 + k, 15); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const prevKey = shift(-1); const nextKey = shift(1);
  const canNext = nextKey <= today.slice(0, 7);
  return `<section class="h3-cal" aria-label="${esc(MONTH_NAME(key))}">
    <div class="h3-calhead">
      <h2>${esc(MONTH_NAME(key))}</h2>
      <span class="h3-calcount">${done ? `<b>${done}</b> complete` : ''}</span>
      <button type="button" class="pg-glassbtn" data-h3-month="${prevKey}" aria-label="Previous month">${ARW_L}</button>
      ${canNext ? `<button type="button" class="pg-glassbtn" data-h3-month="${nextKey}" aria-label="Next month">${ARW_R}</button>` : ''}
    </div>
    <div class="h3-dow" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="h3-grid">${cells.join('')}</div>
  </section>`;
}

/** This month's weekly targets: a tap on one sets his own number from a menu. */
export function targetRows() {
  const today = todayIso();
  const month = monthForDate(today);
  const targets = (month?.weeklyTargets || []).filter((t) => !t.cats.includes('*'));
  if (!targets.length) return '';
  const hits = new Map(goalGroups(today).map((g) => [g.t.id, g]));
  return `<section class="h3-sec"><h2 class="h3-h">This week</h2><div class="h3-list">${targets.map((t) => {
    const g = hits.get(t.id);
    const goal = state.data.settings.weeklyOverrides?.[t.id] ?? t.target;
    const hit = g ? g.hit : 0;
    const mine = state.data.settings.weeklyOverrides?.[t.id] != null;
    return `<div class="h3-target" style="--c:${esc(g?.colour || 'var(--ink-3)')}">
      <button type="button" class="h3-tmain" data-catgoal="${esc(t.id)}" aria-label="${esc(shortCat(t.label))}: ${Math.min(hit, goal)} of ${goal} this week. Open on Today">
        ${catRing(Math.min(hit, goal), goal, 40)}
        <span class="h3-tt"><b>${esc(shortCat(t.label))}</b><small>${hit >= goal ? 'Goal met' : `${Math.min(hit, goal)} of ${goal} this week`}</small></span>
      </button>
      <button type="button" class="h3-tn" data-h3-target="${esc(t.id)}" aria-label="${esc(shortCat(t.label))}: ${goal} a week, ${mine ? 'your number' : 'from the plan'}. Change">${goal} a week${DOWN}</button>
    </div>`;
  }).join('')}</div></section>`;
}

function pictureTile(exId) {
  const p = pictureFor(exId);
  // No photo (an exercise bike): its drawn glyph on a tile, never an empty grey square (audit d10).
  return p?.img ? frameHtml(p.img, { size: 48, radius: 11 }) : `<span class="h3-nopic h3-glyph" aria-hidden="true">${iconTile(exId, 48)}</span>`;
}

/** A day of the calendar, in a sheet: every confirmed exercise, the check-in, the notes. */
export function openDaySheet(iso, ctx) {
  const d = getDay(iso) || {};
  const logged = (d.entries || []).filter((e) => e.logged);
  const r = dayComplete(state.data, iso);
  const c = d.checkin || {};
  const byEx = new Map();
  for (const e of logged) { const k = e.pid || `x:${e.ex}`; if (!byEx.has(k)) byEx.set(k, []); byEx.get(k).push(e); }
  const rows = [...byEx.values()].map((es) => {
    const ex = exerciseById(es[0].ex);
    const name = rowName(es[0], es[0].title || ex?.name || es[0].ex);
    const sided = es.some((e) => e.side === 'L' || e.side === 'R');
    // The band is the loop beside the name (bandMark), the clinic its badge (ptMark), as on
    // Today, Program and Sessions; the work line no longer says it in words (audit d10).
    const bare = (e) => ({ ...e, band: null });
    const work = sided
      ? es.map((e) => `${e.side === 'L' || e.side === 'R' ? `<b class="${e.side}">${e.side}</b> ` : ''}${esc(workText(bare(e)))}`).join('<i> · </i>')
      : esc(workText(bare(es[0])));
    const marks = ptMark(es.find((e) => e.clinic)) + bandMark(es.find((e) => e.band || e.bands || e.bandText), { usesBand: !!ex?.usesBand });
    return `<div class="h3-ex">${pictureTile(es[0].ex)}<span class="h3-exname"><b>${nameWithMarks(name, marks)}</b><small>${work}</small></span></div>`;
  }).join('');
  const bits = hasCheckin(d) ? [
    num(c.painL) != null ? `<span><small>Pain left</small><b class="L">${esc(String(c.painL))}</b></span>` : '',
    num(c.painR) != null ? `<span><small>Pain right</small><b class="R">${esc(String(c.painR))}</b></span>` : '',
    [c.effusionL, c.effusionR].some((v) => v && v !== 'Zero') ? `<span><small>Swelling</small><b>${esc([c.effusionL && `L ${c.effusionL}`, c.effusionR && `R ${c.effusionR}`].filter(Boolean).join(', '))}</b></span>` : '',
    c.nextDay ? `<span><small>Next day</small><b>${esc(String(c.nextDay))}</b></span>` : '',
  ].join('') : '';
  const complete = r && r.planned && r.complete;
  const head = !r ? '' : !r.planned ? 'Planned rest' : r.complete ? `Plan complete, ${r.done} of ${r.planned}` : `${r.done} of ${r.planned} planned`;
  sheet({
    title: new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    cls: 'h3-daysheet',
    body: `<div class="h3-day">
      ${head ? `<div class="h3-dayhead ${complete ? 'done' : ''}">${complete ? CHECK : ''}${esc(head)}</div>` : ''}
      ${rows ? `<div class="h3-exs">${rows}</div>` : '<div class="h3-none">No exercises recorded</div>'}
      ${bits ? `<div class="h3-check">${bits}</div>` : ''}
      ${d.notes ? `<p class="h3-notes">${esc(d.notes)}</p>` : ''}
      <button type="button" class="btn primary h3-open" data-h3-open="${iso}">Open in Today</button>
    </div>`,
    onMount(el) {
      el.querySelector('[data-h3-open]')?.addEventListener('click', () => { closeModal({ restore: false }); ctx.date = iso; ctx.go('today'); });
    },
  });
}

function weekSheetBody(ws) {
  const today = todayIso();
  const days = weekDays(ws);
  const rows = (list) => list.map((item) => {
    const ex = exerciseById(item.ex);
    const name = item.title || ex?.name || item.ex;
    const hit = days.map((iso) => (getDay(iso)?.entries || []).some((e) => e.ex === item.ex && e.logged));
    const n = hit.filter(Boolean).length;
    const info = weeklyTargetInfo(item.ex, ws);
    const met = info.target != null && n >= info.target;
    return `<div class="h3-wrow">
      ${pictureTile(item.ex)}
      <span class="h3-wmain"><b>${esc(name)}</b>
        <span class="h3-wdays">${days.map((iso, i) => `<button type="button" class="${hit[i] ? 'on' : ''} ${iso === today ? 'today' : ''}" ${iso > today ? 'disabled aria-hidden="true" tabindex="-1"' : `data-h3-openday="${iso}"`} aria-label="${esc(fmtDate(iso, 'dow'))}${hit[i] ? ', done' : ''}">${esc(fmtDate(iso, 'dow').slice(0, 1))}</button>`).join('')}</span></span>
      <button type="button" class="h3-wn ${met ? 'met' : ''}" data-h3-extarget="${esc(item.ex)}" aria-label="${esc(name)}: ${n}${info.target != null ? ` of ${info.target}` : ''} this week. Change the target">${n}${info.target != null ? `<small> of ${info.target}</small>` : ''}${DOWN}</button>
    </div>`;
  }).join('');
  return `<div class="h3-week">
    <div class="h3-wnav"><button type="button" class="pg-glassbtn" data-h3-wk="-7" aria-label="Previous week">${ARW_L}</button>
      <b>${esc(fmtDate(ws, 'short'))} to ${esc(fmtDate(addDays(ws, 6), 'short'))}</b>
      ${ws < weekStart(today) ? `<button type="button" class="pg-glassbtn" data-h3-wk="7" aria-label="Next week">${ARW_R}</button>` : '<span class="h3-wsp"></span>'}</div>
    <h3 class="h3-wh">Rehab</h3><div class="h3-wlist">${rows(REHAB_PROGRAM)}</div>
    <h3 class="h3-wh">Gym</h3><div class="h3-wlist">${rows(GYM_PROGRAM)}</div>
  </div>`;
}

export function bindHistory3(root, ctx, rerender) {
  // A target is a shortcut into its goal group on Today (as the old week tiles were).
  root.querySelectorAll('.h3-tmain[data-catgoal]').forEach((b) => b.addEventListener('click', () => {
    ctx.date = todayIso(); ctx.openGoals = true; ctx.openGoal = b.dataset.catgoal; ctx.scrollGoals = true; ctx.go('today');
  }));
  root.querySelectorAll('[data-h3-month]').forEach((b) => b.addEventListener('click', () => {
    const to = b.dataset.h3Month;
    const now = todayIso().slice(0, 7);
    ctx.pushDir = to > (ctx.histMonth || now) ? 1 : -1;
    ctx.histMonth = to === now ? null : to;
    rerender();
  }));
  root.querySelectorAll('[data-h3-day]').forEach((b) => b.addEventListener('click', () => openDaySheet(b.dataset.h3Day, ctx)));
  root.querySelectorAll('[data-h3-target]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.h3Target;
    const t = monthForDate(todayIso())?.weeklyTargets.find((x) => x.id === id);
    if (!t) return;
    const cur = state.data.settings.weeklyOverrides?.[id] ?? t.target;
    const items = [...Array(8).keys()].map((n) => ({ id: String(n), title: n === t.target ? `${n} a week, the plan` : `${n} a week`, checked: n === cur }));
    const pick = await menu(b, { title: shortCat(t.label), items });
    if (pick == null || Number(pick) === cur) return;
    update((d) => {
      d.settings.weeklyOverrides = { ...(d.settings.weeklyOverrides || {}) };
      // The plan's own number goes back to the plan, never a stored copy of it (and never a 0 by accident).
      if (Number(pick) === t.target) delete d.settings.weeklyOverrides[id];
      else d.settings.weeklyOverrides[id] = Number(pick);
    });
    rerender();
  }));
  root.querySelector('[data-h3-grid]')?.addEventListener('click', () => {
    // The week, exercise by exercise, as a phone list (the old wide table scrolled sideways
    // and cut the titles): picture, full title, the seven days with the done ones green, and
    // the count against his target, set from a menu. Opening a day leaves the sheet.
    let ws = weekStart(todayIso());
    const paint = (el) => {
      el.querySelector('.mbody').innerHTML = weekSheetBody(ws);
      el.querySelectorAll('[data-h3-wk]').forEach((b) => b.addEventListener('click', () => { ws = addDays(ws, Number(b.dataset.h3Wk)); paint(el); }));
      el.querySelectorAll('[data-h3-openday]').forEach((b) => b.addEventListener('click', () => { closeModal({ restore: false }); ctx.date = b.dataset.h3Openday; ctx.go('today'); }));
      el.querySelectorAll('[data-h3-extarget]').forEach((b) => b.addEventListener('click', async () => {
        const ex = b.dataset.h3Extarget;
        const info = weeklyTargetInfo(ex, ws);
        const items = [{ id: 'auto', title: 'From the program', checked: info.src !== 'yours' }]
          .concat([...Array(8).keys()].map((n) => ({ id: String(n), title: `${n} a week`, checked: info.src === 'yours' && info.target === n })));
        const pick = await menu(b, { title: 'Days this week', items });
        if (pick == null) return;
        setWeeklyTarget(ex, pick === 'auto' ? null : Number(pick));
        paint(el);
      }));
    };
    sheet({ title: 'Exercise by exercise', cls: 'h3-gridsheet', body: '', onMount: paint });
  });
  // Swipe the month sideways.
  const cal = root.querySelector('.h3-cal');
  if (cal) {
    let x0 = null; let y0 = null;
    cal.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    cal.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const btns = [...root.querySelectorAll('[data-h3-month]')];
      const want = dx < 0 ? btns.find((b) => b.dataset.h3Month > (ctx.histMonth || todayIso().slice(0, 7))) : btns[0];
      want?.click();
    });
  }
}
