import { esc, todayIso, addDays, weekStart, weekDays, fmtDate, fromIso, pct, num } from '../util.js';
import { state, update, getDay, hasCheckin, weeklyTargetInfo, setWeeklyTarget } from '../store.js';
import { monthForDate } from '../../data/plan.js';
import { CATEGORIES } from '../../data/measurements.js';
import { exerciseById, thumb } from '../components.js';
import { REHAB_PROGRAM, GYM_PROGRAM } from '../../data/program.js';

/** Which categories were touched on a given day. */
// Only LOGGED rows count towards the week.
//
// Opening an exercise creates its row before you have done anything, so
// counting every row meant a session you merely looked at lit a pip and the
// weekly cadence over-reported. Green means done everywhere else in the app;
// it means done here too.
export function dayCategories(iso) {
  const day = getDay(iso);
  if (!day) return new Set();
  return new Set((day.entries || [])
    .filter((e) => e.logged)
    .map((e) => exerciseById(e.ex)?.cat).filter(Boolean));
}

export function dayTags(iso) {
  const day = getDay(iso);
  if (!day) return new Set();
  return new Set((day.entries || [])
    .filter((e) => e.logged)
    .map((e) => exerciseById(e.ex)?.tag).filter(Boolean));
}

function targetValue(t) {
  const o = state.data.settings.weeklyOverrides?.[t.id];
  return typeof o === 'number' ? o : t.target;
}

function hitsFor(target, days) {
  let n = 0;
  for (const iso of days) {
    if (target.cats.includes('*')) {
      const d = getDay(iso);
      if (d && ((d.entries || []).length || hasCheckin(d))) n++;
      continue;
    }
    const cats = dayCategories(iso);
    if (target.tagged) {
      if (dayTags(iso).has(target.tagged)) n++;
      continue;
    }
    if (target.cats.some((c) => cats.has(c))) n++;
  }
  return n;
}

export function renderWeekPanel(ctx) {
  const anchor = ctx.date || todayIso();
  const ws = weekStart(anchor);
  const days = weekDays(ws);
  const month = monthForDate(anchor) || monthForDate(ws);
  const targets = month?.weeklyTargets || [];

  const rows = targets.map((t) => {
    const goal = targetValue(t);
    const hit = hitsFor(t, days);
    const p = pct(hit, goal);
    return `<div class="targetrow">
      <span class="small tlabel">${esc(t.label)}
        ${t.src === 'plan' ? '<span class="pill">from plan</span>' : '<span class="pill" title="I set this starting number — change it freely">my default</span>'}
      </span>
      <span class="tcount">
        <strong class="mono small">${hit} /</strong>
        <input type="number" min="0" max="14" value="${goal}" data-target="${esc(t.id)}" class="in-num">
      </span>
      <div class="bar ${p >= 100 ? 'good' : ''}"><i style="width:${p}%"></i></div>
      ${t.note ? `<div class="tiny muted tnote">${esc(t.note)}</div>` : ''}
    </div>`;
  }).join('');

  const painSeries = days.map((iso) => {
    const c = getDay(iso)?.checkin || {};
    return { iso, l: num(c.painL), r: num(c.painR), eff: [c.effusionL, c.effusionR].filter((v) => v && v !== 'Zero') };
  });

  return `
    <div class="card"><div class="card-body" style="padding:.6rem .9rem">
      <div class="row between weeknav">
        <div class="datenav">
          <button class="icon-btn" data-wnav="-7">‹</button>
          <span class="d">${esc(fmtDate(ws, 'short'))} – ${esc(fmtDate(addDays(ws, 6), 'short'))}</span>
          <button class="icon-btn" data-wnav="7">›</button>
          ${ws === weekStart(todayIso()) ? '<span class="pill accent">this week</span>' : '<button class="btn sm ghost" data-wnav="now">this week</button>'}
        </div>
        ${month ? `<span class="pill accent">${esc(month.name)} · ${esc(month.monthLabel)}</span>` : ''}
      </div>
    </div></div>

    <div class="grid2">
      <section class="card">
        <header><h2>Weekly targets</h2><span class="sub">edit any number to suit</span></header>
        <div class="card-body">
          ${targets.length ? rows : '<div class="empty">No targets for this week — it sits outside the plan window.</div>'}
        </div>
      </section>

      <section class="card">
        <header><h2>Knee response</h2><span class="sub">pain and effusion across the week</span></header>
        <div class="card-body">
          <table class="tbl">
            <thead><tr><th>Day</th><th class="num">Pain L</th><th class="num">Pain R</th><th>Effusion</th></tr></thead>
            <tbody>
              ${painSeries.map((p) => `<tr>
                <td>${esc(fmtDate(p.iso, 'dow'))} <span class="muted tiny">${esc(fmtDate(p.iso, 'short'))}</span></td>
                <td class="num mono">${p.l ?? '·'}</td>
                <td class="num mono">${p.r ?? '·'}</td>
                <td>${p.eff.length ? `<span class="pill bad">${esc(p.eff.join(', '))}</span>` : '<span class="muted tiny">—</span>'}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>

    ${exerciseGrid(ws, days)}

    <section class="card">
      <header><h2>What you did</h2><span class="sub">tap a day to open it</span></header>
      <div class="card-body scroll-x">
        <table class="tbl" style="min-width:640px">
          <thead><tr><th>Day</th><th>Categories</th><th class="num">Exercises</th><th class="num">Load volume</th><th>Notes</th></tr></thead>
          <tbody>
            ${days.map((iso) => {
              const d = getDay(iso);
              const cats = [...dayCategories(iso)];
              const vol = (d?.entries || []).reduce((a, e) => a + (num(e.sets) || 1) * (num(e.reps) || 0) * (num(e.load) || 0), 0);
              return `<tr>
                <td><button class="btn sm ghost" data-openday="${iso}">${esc(fmtDate(iso, 'dow'))} ${esc(fmtDate(iso, 'short'))}</button></td>
                <td>${cats.length ? cats.map((k) => `<span class="pill" style="background:color-mix(in srgb, ${CATEGORIES[k]?.color || '#888'} 16%, transparent);color:${CATEGORIES[k]?.color || '#888'}">${esc(CATEGORIES[k]?.label || k)}</span>`).join(' ') : '<span class="muted tiny">rest / not logged</span>'}</td>
                <td class="num mono">${(d?.entries || []).length || '·'}</td>
                <td class="num mono">${vol ? Math.round(vol) : '·'}</td>
                <td class="tiny muted">${esc((d?.notes || '').slice(0, 60))}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
}

/** Every program exercise against the seven days, with your own weekly target. */
function exerciseGrid(ws, days) {
  const today = todayIso();
  const section = (title, items, note) => {
    const rows = items.map((item) => {
      const ex = exerciseById(item.ex);
      const hit = days.map((iso) => {
        const d = getDay(iso);
        return !!d && (d.entries || []).some((e) => e.ex === item.ex && e.logged);
      });
      const n = hit.filter(Boolean).length;
      const info = weeklyTargetInfo(item.ex, ws);
      const target = info.target;
      const met = target !== null && n >= target;
      const left = target === null ? null : Math.max(0, target - n);
      const daysLeft = days.filter((d) => d >= today).length;
      const atRisk = target !== null && !met && left > daysLeft;
      return `<tr>
        <td class="gridname">
          ${thumb(item.ex, 28)}
          <span>${esc(item.title || ex?.name || item.ex)}</span>
        </td>
        ${hit.map((on, i) => `<td class="num">
          <button class="daycell ${on ? 'on' : ''} ${days[i] === today ? 'today' : ''} ${days[i] > today ? 'future' : ''}"
            data-openday="${days[i]}" title="${esc(fmtDate(days[i]))}">${on ? '✓' : ''}</button>
        </td>`).join('')}
        <td class="num nowrap">
          <span class="wk-count ${met ? 'met' : atRisk ? 'risk' : ''}">${n}/</span><input
            type="number" min="0" max="14" value="${target ?? ''}" placeholder="–"
            data-extarget="${esc(item.ex)}" title="${esc(info.from)}" class="in-num">
        </td>
        <td class="tiny">
          ${target === null
            ? `<span class="muted">not this month</span>`
            : met
              ? '<span class="muted">done</span>'
              : `<span style="${atRisk ? 'color:var(--warn)' : 'color:var(--ink-2)'}">${left} to go</span>`}
          <div class="tiny muted">${esc(info.from)}${info.src === 'derived' ? ' · my number' : info.src === 'plan' ? ' · from plan' : info.src === 'yours' ? ' · yours' : ''}</div>
        </td>
      </tr>`;
    }).join('');
    return `
      <div class="section-title" style="margin-top:.9rem">${esc(title)}</div>
      ${note ? `<div class="tiny muted" style="margin-bottom:.35rem">${esc(note)}</div>` : ''}
      <div class="scroll-x"><table class="tbl gridtbl" style="min-width:620px">
        <thead><tr>
          <th>Exercise</th>
          ${days.map((iso) => `<th class="num">${esc(fmtDate(iso, 'dow').slice(0, 1))}<br><span class="tiny muted">${fromIso(iso).getDate()}</span></th>`).join('')}
          <th class="num">Done</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
  };

  return `
  <section class="card">
    <header>
      <h2>Exercise by exercise</h2>
      <span class="sub">which days you did each one</span>
    </header>
    <div class="card-body tight">
      <div class="callout small" style="margin:.4rem 0 .2rem">
        The clinician program gives sets, reps and holds but never says how often. So each exercise takes the
        weekly session count its <strong>category</strong> has in the 6-month plan for whichever month you are in —
        in ${esc(monthForDate(ws)?.name || 'this month')}, a strength exercise inherits the plan's strength-sessions number.
        Move into the next month and the quotas move with it. Type over any number to fix it to your own.
        Most of the plan's weekly numbers are still my starting points rather than the document's — hover a target to see which.
      </div>
      ${section('Rehab program', REHAB_PROGRAM)}
      ${section('Open chain', GYM_PROGRAM)}
    </div>
  </section>`;
}

export function bindWeekPanel(root, ctx, rerender) {
  const anchor = ctx.date || todayIso();
  root.querySelectorAll('[data-wnav]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.wnav;
    ctx.date = v === 'now' ? todayIso() : addDays(anchor, Number(v));
    rerender();
  }));
  root.querySelectorAll('[data-openday]').forEach((b) => b.addEventListener('click', () => {
    ctx.date = b.dataset.openday;
    ctx.go('today');
  }));
  root.querySelectorAll('[data-extarget]').forEach((inp) => inp.addEventListener('change', () => {
    setWeeklyTarget(inp.dataset.extarget, inp.value === '' ? null : Number(inp.value));
    rerender();
  }));
  root.querySelectorAll('[data-target]').forEach((inp) => inp.addEventListener('change', () => {
    update((d) => {
      d.settings.weeklyOverrides = d.settings.weeklyOverrides || {};
      d.settings.weeklyOverrides[inp.dataset.target] = Number(inp.value);
    });
    rerender();
  }));
}
