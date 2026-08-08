// The one place data goes in. Everything else in the app reads from here.

import { esc, todayIso, addDays, fmtDateNum, uid, num, round, weekStart, weekDays } from '../util.js';
import { state, update, ensureDay, getDay, lastEntry, maxLoad, loadSeries,
         weekDots, weeklyTargetInfo } from '../store.js';
import { monthForDate } from '../../data/plan.js';
import { CATEGORIES, MEASURE_BY_ID, UNIT_LABEL } from '../../data/measurements.js';
import { REHAB_PROGRAM, GYM_PROGRAM, PROGRAM_SOURCE, BAND_BY_ID, THERABAND } from '../../data/program.js';
import { CLINIC_HEP } from '../../data/history.js';
import { dayCategories, dayTags } from './week.js';
import { openExercisePicker, allExercises, exerciseById, openMeasureEntry, loadBars, thumb, iconTile, openPicture, renderDatePill } from '../components.js';
import { renderMonthBoard, bindMonthBoard, shortCat } from './monthboard.js';
import { renderJourney, bindJourney } from './journey.js';
import { computeInsights } from '../insights.js';
import { toast } from '../components.js';
import { entriesFor } from '../store.js';

const EFFUSION = ['', 'Zero', 'Trace', '1+', '2+', '3+'];

/** The weekly targets this month asks for, each as a group you can log into. */
function goalGroups(iso) {
  const month = monthForDate(iso);
  if (!month) return [];
  const days = weekDays(weekStart(iso));
  return month.weeklyTargets
    .filter((t) => !t.cats.includes('*'))
    .map((t) => {
      let hit = 0;
      for (const d of days) {
        if (t.tagged) { if (dayTags(d).has(t.tagged)) hit++; continue; }
        if (t.cats.some((c) => dayCategories(d).has(c))) hit++;
      }
      const goal = state.data.settings.weeklyOverrides?.[t.id] ?? t.target;
      const label = t.label.replace(/ sessions.*$/, '').replace(/ \(.*\)$/, '');
      return { t, label, hit, goal, left: Math.max(0, goal - hit), met: hit >= goal,
               colour: CATEGORIES[t.cats[0]]?.color || 'var(--accent)' };
    })
    .sort((a, b) => (a.met - b.met) || (b.left - a.left));
}

export function renderToday(ctx) {
  const iso = ctx.date || todayIso();
  const month = monthForDate(iso);
  const day = getDay(iso);
  const entries = day?.entries || [];
  const c = day?.checkin || {};
  const seg = ctx.seg || 'rehab';
  const warn = kneeWarning(c);

  const doneIds = new Set(entries.filter((e) => e.pid && e.logged).map((e) => e.pid));
  const nDone = completedList(entries).length;
  const extras = entries.filter((e) => !e.pid);

  return `
  <div class="stack">
    ${renderDatePill(iso, { done: nDone })}

    ${renderJourney(ctx)}

    ${weekBar(iso)}

    ${warn ? `<div class="callout ${warn.level}">${warn.html}</div>` : ''}
    ${day?.seeded ? `<div class="callout warn small">Seeded from ${esc(day.source || 'your clinical notes')}. Edit or delete anything that is not right.</div>` : ''}

    ${renderMonthBoard(ctx)}

    ${insightsRow(iso)}

    <div class="grid2 panels">
      <section class="card panel ${ctx.openKnees ? 'open' : ''}">
        <button class="panel-head" data-panel="knees">
          <span class="panel-title"><h2>How the knees are</h2>
            <span class="sub">${kneeSummary(c)} ${painSpark(iso)}</span></span>
          <span class="chev">⌄</span>
        </button>
        ${ctx.openKnees ? `<div class="card-body">
          ${legBlock('L', 'Left', c)}
          ${legBlock('R', 'Right', c)}
          <div class="row" style="margin-top:.5rem">
            <label class="fld" style="flex:1;min-width:150px">Yesterday's session left me
              <select data-ck="nextDay">
                ${['', 'Better', 'Same', 'Worse'].map((o) => `<option ${c.nextDay === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
              </select>
            </label>
            <label class="fld" style="width:110px">Effort (1–10)
              <input type="number" min="0" max="10" step="1" data-ck="rpe" value="${c.rpe ?? ''}">
            </label>
          </div>
          <label class="fld" style="margin-top:.5rem">Notes
            <textarea data-ck="notes" placeholder="How it felt, anything that flared, sleep, mood…">${esc(c.notes || '')}</textarea>
          </label>
        </div>` : ''}
      </section>

      <section class="card panel ${ctx.openTests ? 'open' : ''}">
        <button class="panel-head" data-panel="tests">
          <span class="panel-title"><h2>Measurements &amp; tests</h2>
            <span class="sub">${testsSummary(iso)}</span></span>
          <span class="chev">⌄</span>
        </button>
        ${ctx.openTests ? `<div class="card-body tight">
          <div class="row" style="justify-content:flex-end;margin-bottom:.4rem">
            <button class="btn sm" data-act="add-measure">+ Record a test</button>
          </div>
          ${dayMeasurements(iso)}
        </div>` : ''}
      </section>
    </div>

    <section class="card" id="session-card">
      <header>
        <h2>Today's session</h2>
        <div class="row" style="gap:.25rem">
          <button class="btn sm ${seg === 'rehab' ? 'primary' : ''}" data-seg="rehab">Rehab program <span class="mono">${countDone(REHAB_PROGRAM, doneIds)}</span></button>
          <button class="btn sm ${seg === 'gym' ? 'primary' : ''}" data-seg="gym">Open chain <span class="mono">${countDone(GYM_PROGRAM, doneIds)}</span></button>
          ${(() => {
            const g = goalGroups(iso);
            if (!g.length) return '';
            const met = g.filter((x) => x.met).length;
            return `<button class="btn sm ${seg === 'goals' ? 'primary' : ''}" data-seg="goals">
              By goal <span class="mono">${met}/${g.length}</span></button>`;
          })()}
          <button class="btn sm ${seg === 'extra' ? 'primary' : ''}" data-seg="extra">Anything else <span class="mono">${extras.length}</span></button>
          <button class="btn sm ${seg === 'done' ? 'primary' : ''} ${nDone ? 'has-done' : ''}" data-seg="done">Completed today <span class="mono">${nDone}</span></button>
        </div>
      </header>
      <div class="card-body tight">
        ${seg === 'rehab' ? rehabSegment(iso, entries, ctx) : ''}
        ${seg === 'gym' ? gymSegment(iso, entries, ctx) : ''}
        ${seg === 'extra' ? extraSegment(extras, month, ctx.flash, ctx) : ''}
        ${seg === 'done' ? completedSegment(entries, ctx) : ''}
        ${seg === 'goals' ? goalsSegment(iso, entries, ctx) : ''}
      </div>
    </section>

    <label class="fld">Anything else about today
      <textarea data-daynote placeholder="Not an exercise — travel, a flare-up, how the show rehearsal went…">${esc(day?.notes || '')}</textarea>
    </label>
  </div>`;
}

/** Everything marked done today, wherever it lives. */
function completedList(entries) {
  const out = [];
  for (const item of REHAB_PROGRAM.concat(GYM_PROGRAM)) {
    const mine = entries.filter((e) => e.pid === item.id);
    if (isLogged(mine)) out.push({ key: item.id, item, mine, ex: exerciseById(item.ex) });
  }
  for (const e of entries.filter((x) => !x.pid && x.logged)) {
    out.push({ key: e.id, mine: [e], ex: exerciseById(e.ex) });
  }
  return out;
}

function completedSegment(entries, ctx) {
  const list = completedList(entries);
  if (!list.length) {
    return '<div class="empty">Nothing marked done yet. Tick an exercise in any of the other tabs.</div>';
  }
  return `
    <div class="tiny muted" style="margin-bottom:.5rem">
      Everything you have marked done today, from all three tabs. Untick to send one back.
    </div>
    <div class="done-list">
      ${list.map((row) => {
        const editing = ctx.editing === row.key;
        const name = row.item?.title || row.ex?.name || row.mine[0].ex;
        return `<div class="prow done ${editing ? 'editing' : ''}"${catStyle(row.ex)}>
          <div class="prow-head">
            <input type="checkbox" checked data-doneoff="${esc(row.key)}" title="Mark as not done">
            ${row.item?.thumb
              ? `<img class="thumb" src="${esc(row.item.thumb)}" alt="" decoding="async" style="width:66px;height:37px">`
              : thumb(row.mine[0].ex, 37)}
            <div class="prow-main" data-doneclick="${esc(row.key)}">
              <span class="pname">${esc(name)}</span>
            </div>
            ${!editing ? `<div class="prow-summary" data-doneclick="${esc(row.key)}">${entryChips(row.mine)}
              <span class="editcue">edit</span></div>` : ''}
          </div>
          ${editing ? row.mine.map((e) => entryFields(e, row.ex)).join('') + logBar(row.key) : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function countDone(list, loggedIds) {
  const n = list.filter((p) => loggedIds.has(p.id)).length;
  return `${n}/${list.length}`;
}

/**
 * Scroll the window, smoothly, without relying on `behavior: 'smooth'` —
 * which is silently a no-op in some engines, so a jump that should be gentle
 * simply does not happen at all.
 */
function scrollWindowTo(top, ms = 320) {
  const start = window.scrollY;
  const dist = Math.max(0, top) - start;
  if (Math.abs(dist) < 2) return;
  // rAF does not fire while the page is hidden, so an animation would simply
  // never arrive. Jump instead of not moving at all.
  if (document.visibilityState !== 'visible') { window.scrollTo(0, Math.max(0, top)); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;   // easeInOutQuad
    window.scrollTo(0, start + dist * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// --------------------------------------------------------- week cadence ---
/**
 * The week's cadence, at the top where it is seen before anything is logged.
 *
 * It used to sit far down inside the month board, which meant the one thing
 * that answers "what should I do today?" was the thing you had to dig for.
 * Each category is a button that jumps to the By goal tab below.
 */
function weekBar(iso) {
  const groups = goalGroups(iso);
  if (!groups.length) return '';
  const worst = groups.find((g) => !g.met);
  return `
  <div class="card weekbar-card">
    <div class="card-body" style="padding:.6rem .8rem">
      <div class="section-title centred" style="margin:0 0 .5rem">This week
        ${worst && worst.hit / worst.goal < 0.5
          ? `<span class="tiny" style="text-transform:none;letter-spacing:0;font-weight:450;color:var(--warn)">
              · light on ${esc(worst.label.toLowerCase())}</span>` : ''}
        <span class="tiny muted" style="text-transform:none;letter-spacing:0;font-weight:450"> · tap to log</span>
      </div>
      <div class="weekcats centred">
        ${groups.map((g, i) => `
          <button class="weekcat tappable ${g.met ? 'met' : ''}" data-catgoal="${i}"
                  style="--c:${g.colour}" title="${esc(g.t.label)} — tap to log">
            <span class="wchead"><span class="wclabel tiny">${esc(shortCat(g.t.label))}</span>
              <span class="tiny mono">${g.hit}/${g.goal}</span></span>
            <span class="pips">${Array.from({ length: g.goal }, (_, k) =>
              `<i class="${k < g.hit ? 'on' : ''}"></i>`).join('')}</span>
          </button>`).join('')}
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ date header --
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

/** Tiny 14-day sparkline of worst-knee pain, for the collapsed panel header. */
function painSpark(iso) {
  const pts = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(iso, -i);
    const c = state.data.days[d]?.checkin || {};
    const worst = Math.max(num(c.painL) ?? -1, num(c.painR) ?? -1);
    pts.push(worst >= 0 ? worst : null);
  }
  if (pts.filter((v) => v !== null).length < 3) return '';
  const W = 72; const H = 20;
  const x = (i) => 2 + (i / 13) * (W - 4);
  const y = (v) => H - 3 - (v / 10) * (H - 6);
  let d = ''; let started = false;
  pts.forEach((v, i) => {
    if (v === null) return;
    d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    started = true;
  });
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" title="Worst-knee pain, last 14 days">
    <path d="${d.trim()}" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function kneeSummary(c) {
  const bits = [];
  if (num(c.painL) != null || num(c.painR) != null) {
    bits.push(`pain L ${c.painL ?? '–'} · R ${c.painR ?? '–'}`);
  }
  const eff = [c.effusionL, c.effusionR].filter((v) => v && v !== 'Zero');
  if (eff.length) bits.push(`swelling ${eff.join(', ')}`);
  else if (c.effusionL === 'Zero' || c.effusionR === 'Zero') bits.push('no swelling');
  if (c.nextDay) bits.push(`yesterday: ${c.nextDay.toLowerCase()}`);
  return bits.length ? esc(bits.join('  ·  ')) : '<em>not logged yet — takes ten seconds</em>';
}

function testsSummary(iso) {
  const n = state.data.measurements.filter((m) => m.date === iso).length;
  return n ? `${n} recorded today` : '<em>nothing recorded today</em>';
}

function legBlock(side, label, c) {
  const painKey = side === 'L' ? 'painL' : 'painR';
  const effKey = side === 'L' ? 'effusionL' : 'effusionR';
  const painVal = c[painKey] ?? '';
  return `
  <div style="margin-bottom:.45rem">
    <div class="row" style="gap:.4rem;margin-bottom:.15rem">
      <span class="sidetag ${side}">${esc(label)}</span>
      <span class="tiny muted">pain</span>
      <strong class="mono" style="font-size:.8rem">${painVal === '' ? '—' : painVal + '/10'}</strong>
      <span class="spacer"></span>
      <label class="tiny muted" style="display:flex;gap:.3rem;align-items:center">swelling
        <select data-ck="${effKey}" style="width:auto;padding:.15rem .3rem;font-size:.75rem">
          ${EFFUSION.map((o) => `<option value="${o}" ${(c[effKey] || '') === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
        </select>
      </label>
    </div>
    <input type="range" min="0" max="10" step="1" data-ck="${painKey}" value="${painVal === '' ? 0 : painVal}">
  </div>`;
}

function kneeWarning(c) {
  const eff = [c.effusionL, c.effusionR].filter(Boolean);
  const swollen = eff.filter((v) => v && v !== 'Zero');
  const pain = Math.max(num(c.painL) ?? 0, num(c.painR) ?? 0);
  if (swollen.length) {
    return { level: 'bad', html: `<strong>Swelling logged (${esc(swollen.join(', '))}).</strong> Your plan's rule: <em>“If any swelling, regress as tolerated.”</em>` };
  }
  if (c.nextDay === 'Worse') {
    return { level: 'warn', html: '<strong>Yesterday left you worse.</strong> Your plan asks you to watch next-day symptoms and back off rather than push through.' };
  }
  if (pain >= 2) {
    return { level: 'warn', html: `<strong>Pain at ${pain}/10.</strong> Your plan gates impact work on discomfort staying under 2/10.` };
  }
  return null;
}

// --------------------------------------------------------- program rows ----
// Three states per row:
//   untouched  - collapsed, neutral
//   editing    - expanded with the input fields and a Log button
//   done       - collapsed, green, with what you entered shown on the right

function isEditing(ctx, key) {
  return ctx.editing === key;
}

/** Green means logged — ticked, or confirmed with the Log it button. */
function isLogged(mine) {
  return mine.length > 0 && mine.every((e) => e.logged);
}

/** One-line readout of what was entered, for the collapsed green row. */
function entryChips(mine) {
  if (!mine.length) return '';
  return mine.map((e) => {
    const bits = [];
    if (e.sets && e.reps) bits.push(`${e.sets}×${e.reps}`);
    else if (e.reps) bits.push(`${e.reps} reps`);
    else if (e.sets) bits.push(`${e.sets} sets`);
    if (num(e.load)) bits.push(`${round(num(e.load), 2)} ${e.loadUnit || state.data.settings.weightUnit}`);
    if (num(e.time)) bits.push(`${round(num(e.time), 2)} min`);
    if (num(e.secs)) bits.push(`${round(num(e.secs), 1)} s`);
    if (num(e.secsL) != null || num(e.secsR) != null) bits.push(`L ${e.secsL ?? '–'} · R ${e.secsR ?? '–'} s`);
    if (num(e.testL) != null || num(e.testR) != null) bits.push(`best L ${e.testL ?? '–'} · R ${e.testR ?? '–'}`);
    if (num(e.resistance)) bits.push(`level ${e.resistance}`);
    if (num(e.calories)) bits.push(`${e.calories} cal`);
    if (num(e.rpe)) bits.push(`effort ${e.rpe}`);
    const b = e.band ? BAND_BY_ID[e.band] : null;
    const side = (e.side || 'B') !== 'B' ? `<b class="sidetag ${e.side}">${e.side}</b> ` : '';
    return `<span class="sumchip">${side}${b ? `<i class="swatch" style="background:${b.swatch}"></i>` : ''}${
      bits.length ? esc(bits.join(' · ')) : '<span class="muted">done</span>'}</span>`;
  }).join('');
}

function catStyle(ex) {
  const c = CATEGORIES[ex?.cat]?.color;
  return c ? ` style="--cat:${c}"` : '';
}

function programRow(item, iso, entries, ctx) {
  const ex = exerciseById(item.ex);
  const mine = entries.filter((e) => e.pid === item.id);
  const started = mine.length > 0;
  const done = isLogged(mine);
  const editing = started && isEditing(ctx, item.id);
  const stage = state.data.program.stage[item.id] || 0;
  const progs = item.progressions || [];
  const band = state.data.program.band[item.id] ?? item.band ?? '';
  const stageLabel = progs.length ? (stage ? progs[stage - 1] : 'Base') : null;

  return `
  <div class="prow ${done ? 'done' : ''} ${started && !done ? 'started' : ''} ${editing ? 'editing' : ''}" data-pid="${esc(item.id)}"${catStyle(ex)}>
    <div class="prow-head">
      <input type="checkbox" data-ptoggle="${esc(item.id)}" ${done ? 'checked' : ''}>
      <button class="prow-shot" data-bigpic="${esc(item.id)}" title="Show it bigger">
        ${item.thumb ? `<img src="${esc(item.thumb)}" alt="" decoding="async">` : iconTile(item.ex, 42)}
      </button>
      <div class="prow-main" data-rowclick="${esc(item.id)}">
        <span class="pname">${esc(item.title || ex?.name || item.ex)}</span>
        <span class="prow-tags">
          ${item.sets ? `<span class="pill">${item.sets} × ${item.reps ?? '?'}${item.hold ? ' · hold ' + esc(item.hold) : ''}</span>` : ''}
          ${item.sides === 'each' ? '<span class="pill">each side</span>' : ''}
          ${item.sides === 'left' ? '<span class="pill left">left only</span>' : ''}
          ${band ? bandChip(band) : ''}
          ${stageLabel ? `<span class="pill ${stage ? 'good' : ''}">${esc(stageLabel)}</span>` : ''}
          ${item.goal ? `<span class="pill">goal ${esc(item.goal)}</span>` : ''}
          ${weekStrip(item.ex, iso)}
        </span>
      </div>
      ${started && !editing ? `<div class="prow-summary" data-rowclick="${esc(item.id)}">${entryChips(mine)}
        <span class="editcue">edit</span></div>` : ''}
    </div>
    ${item.notYet && !started ? `<div class="tiny prow-note" style="color:var(--warn)">${esc(item.notYetNote)}</div>` : ''}
    ${editing ? mine.map((e) => entryFields(e, ex)).join('') + logBar(item.id) : ''}
  </div>`;
}

function logBar(key) {
  return `<div class="logbar"><button class="btn primary sm" data-log="${esc(key)}">Log it</button></div>`;
}

/** Seven dots, Mon to Sun, plus how you are tracking against your own target. */
function weekStrip(exId, iso) {
  if (!exId) return '';
  const dots = weekDots(exId, iso);
  const days = weekDays(weekStart(iso));
  const n = dots.filter(Boolean).length;
  const info = weeklyTargetInfo(exId, iso);
  const dotsHtml = dots
    .map((on, i) => `<i class="wd${on ? ' on' : ''}${days[i] === iso ? ' today' : ''}"></i>`)
    .join('');

  if (info.target === null) {
    return `<span class="weekstrip" title="${esc(info.from)}">
      ${dotsHtml}<b class="wk-count off">${n}<span class="muted">/–</span></b></span>`;
  }
  const met = n >= info.target;
  const daysLeft = days.filter((d) => d >= iso).length;   // today still counts
  const atRisk = !met && (info.target - n) > daysLeft;
  return `<span class="weekstrip" title="${esc(info.from)} — ${esc(SRC_LABEL[info.src] || '')}">
    ${dotsHtml}
    <b class="wk-count ${met ? 'met' : atRisk ? 'risk' : ''}">${n}/${info.target}</b>
  </span>`;
}

const SRC_LABEL = {
  plan: 'from the plan',
  derived: 'my starting number',
  yours: 'you set this',
  fallback: 'fallback default',
};

function bandChip(id) {
  const b = BAND_BY_ID[id];
  if (!b) return '';
  return `<span class="pill"><i class="swatch" style="background:${b.swatch}"></i>${esc(b.name)}</span>`;
}

/** Log once, count twice: turn logged rows into test results as well, so a
 *  number never has to be typed in two places.
 *
 *  Deliberately conservative. It writes only a value you actually entered,
 *  only for exercises that map to a test, and never a second result for the
 *  same test, leg and day — re-logging or an edit must not stack duplicates
 *  or quietly overwrite a real test you recorded properly.
 *  Returns labels for what it saved.
 */
function recordAsTests(iso, entries) {
  const saved = [];
  const rows = [];
  for (const e of entries) {
    const ex = exerciseById(e.ex);
    const m = testableMeasure(ex);
    if (!m) continue;

    const mf = measureField(ex);
    if (!mf) continue;   // no honest equivalent on a training row

    // Which legs, and with what number.
    let pairs;
    const split = splitOn(e, ex);
    if (split) {
      pairs = [['L', num(e.secsL)], ['R', num(e.secsR)]];
    } else if (testFields(ex)) {
      pairs = [['L', num(e.testL)], ['R', num(e.testR)]];
    } else {
      const v = num(e[mf.f]);
      const leg = e.side === 'L' || e.side === 'R' ? e.side : null;
      // A both-sides row for a per-leg test is one number for two legs; that
      // is a guess, so it is left for the "↗ test" button to confirm.
      if (m.perLeg && !leg) continue;
      pairs = [[leg, v]];
    }

    for (const [leg, value] of pairs) {
      if (value == null || Number.isNaN(value)) continue;
      const exists = state.data.measurements.some(
        (x) => x.measure === m.id && x.date === iso && (x.leg || null) === (leg || null));
      if (exists) continue;
      rows.push({ id: uid(), date: iso, measure: m.id, leg: leg || null, value });
      // "11 reps" and "27s" both read right; the unit table mixes words and symbols.
      const u = UNIT_LABEL[m.unit] || '';
      const withUnit = u.length > 2 ? `${value} ${u}` : `${value}${u}`;
      saved.push(`${m.label}${leg ? ` (${leg === 'L' ? 'left' : 'right'})` : ''} ${withUnit}`);
    }
  }
  if (rows.length) update((d) => { d.measurements.push(...rows); });
  return saved;
}

/** True when logging this row can also stand as a test result. */
export function testableMeasure(ex) {
  const m = ex?.measure ? MEASURE_BY_ID[ex.measure] : null;
  return m || null;
}

// Which entry field actually holds the quantity a test measures. Only these
// three are honest equivalences: seconds held, reps performed, load lifted.
// A measure in cm, degrees, newtons or per-cent has no counterpart on a
// training row, so those keep the manual "↗ test" button and are never
// written automatically.
const UNIT_FIELD = { sec: 'secs', reps: 'reps' };

/** {measure, field} when logging this row can stand as a test, else null. */
function measureField(ex) {
  const m = testableMeasure(ex);
  const f = m && UNIT_FIELD[m.unit];
  return f ? { m, f } : null;
}

/** True for a both-sides row whose test is measured in seconds.
 *
 *  Only the seconds field is split into left/right. Reps are deliberately
 *  NOT split: PhysiApp syncs into `reps`, so replacing it with two empty
 *  boxes hid the number that had actually come across, and the reps you do
 *  in a working set are not a max-effort test anyway. Rep-based tests get
 *  their own boxes instead — see testBoxes. */
function splitOn(e, ex) {
  const mf = measureField(ex);
  if (!mf || !mf.m.perLeg || mf.f !== 'secs') return null;
  if ((e.side || 'B') !== 'B') return null;
  return 'secs';
}

/** The dedicated per-side test inputs, for rep-counted tests. */
function testFields(ex) {
  const mf = measureField(ex);
  if (!mf || mf.f !== 'reps' || !mf.m.perLeg) return null;
  return mf;
}

function sideBox(e, field, side, label) {
  const k = field + side;
  return `<label class="fld"><span class="sidetag ${side}">${side}</span> ${label}<input type="number" step="any" min="0" data-f="${k}" value="${e[k] ?? ''}"></label>`;
}

function secsFields(e, ex) {
  if (splitOn(e, ex)) {
    return sideBox(e, 'secs', 'L', 'Secs') + sideBox(e, 'secs', 'R', 'Secs');
  }
  if (!ex?.secs) {
    return `<label class="fld">Min<input type="number" step="any" min="0" data-f="time" value="${e.time ?? ''}"></label>`;
  }
  return `<label class="fld">Secs<input type="number" step="any" min="0" data-f="secs" value="${e.secs ?? ''}"></label>`;
}

function repsFields(e, ex) {
  return `<label class="fld">Reps<input type="number" step="1" min="0" data-f="reps" value="${e.reps ?? ''}"></label>`;
}

/** "Best L / Best R" — the max-effort figure that counts as a test result,
 *  kept separate from the reps you did in a working set. */
function testBoxes(e, ex) {
  const mf = testFields(ex);
  if (!mf) return '';
  return `<span class="testboxes" title="${esc(mf.m.label)} — your best, recorded as a test">
    ${sideBox(e, 'test', 'L', 'Best')}${sideBox(e, 'test', 'R', 'Best')}
  </span>`;
}

function entryFields(e, ex) {
  const unit = e.loadUnit || state.data.settings.weightUnit;
  const usesBand = ex?.usesBand;
  const side = `<span class="sidetag ${e.side || 'B'}">${e.side === 'L' ? 'Left' : e.side === 'R' ? 'Right' : 'both'}</span>`;

  if (ex?.cardio) {
    return `
    <div class="pfields" data-entry="${esc(e.id)}">
      ${side}
      <label class="fld">Minutes<input type="number" step="any" min="0" data-f="time" value="${e.time ?? ''}"></label>
      <label class="fld">Level 1–20<input type="number" step="1" min="1" max="20" data-f="resistance" value="${e.resistance ?? ''}"></label>
      <label class="fld">Calories<input type="number" step="1" min="0" data-f="calories" value="${e.calories ?? ''}"></label>
      <label class="fld">Effort<input type="number" step="1" min="0" max="10" data-f="rpe" value="${e.rpe ?? ''}"></label>
      <label class="fld wide">Note<input data-f="notes" value="${esc(e.notes || '')}"></label>
    </div>`;
  }

  return `
  <div class="pfields" data-entry="${esc(e.id)}">
    ${side}
    <label class="fld">Sets<input type="number" step="1" min="0" data-f="sets" value="${e.sets ?? ''}"></label>
    ${repsFields(e, ex)}
    <label class="fld">Load ${esc(unit)}<input type="number" step="any" min="0" data-f="load" value="${e.load ?? ''}"></label>
    ${secsFields(e, ex)}
    ${usesBand ? `<label class="fld" style="width:104px">Theraband
      <select data-f="band" class="bandsel">
        <option value="">none</option>
        ${THERABAND.map((b) => `<option value="${b.id}" ${e.band === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select></label>` : ''}
    ${testBoxes(e, ex)}
    <label class="fld wide">Note<input data-f="notes" value="${esc(e.notes || '')}"></label>
    ${ex?.measure ? `<button class="btn sm astest" data-astest="${esc(e.id)}"
      title="Record this as a test result, so it counts towards your month markers">↗ test</button>` : ''}
  </div>`;
}

function rehabSegment(iso, entries, ctx) {
  const done = REHAB_PROGRAM.filter((p) => isLogged(entries.filter((e) => e.pid === p.id))).length;
  return `
  <div class="row between" style="margin-bottom:.5rem">
    <span class="tiny muted">${esc(PROGRAM_SOURCE.clinician)}'s program — ${done} of ${REHAB_PROGRAM.length} done. Tick one to fill it in.</span>
    <div class="row" style="gap:.3rem">
      <button class="btn sm" data-act="untick-all">Clear</button>
      <button class="btn sm" data-act="tick-all">Tick everything</button>
    </div>
  </div>
  ${REHAB_PROGRAM.map((p) => programRow(p, iso, entries, ctx)).join('')}`;
}

function gymSegment(iso, entries, ctx) {
  return `
  <div class="tiny muted" style="margin-bottom:.6rem">Your working resistance, so you know where to start. Bars are your top load each session.</div>
  ${GYM_PROGRAM.map((p) => gymCard(p, entries, ctx, iso)).join('')}
  <div class="row" style="margin-top:.6rem">
    <button class="btn sm" data-act="add-ex">+ Add another gym exercise</button>
  </div>`;
}

function gymCard(item, entries, ctx, iso) {
  const ex = exerciseById(item.ex);
  const mine = entries.filter((e) => e.pid === item.id);
  const started = mine.length > 0;
  const done = isLogged(mine);
  const editing = started && isEditing(ctx, item.id);
  const sides = sidesFor(item);
  const unit = state.data.settings.weightUnit;
  const cardio = !!ex?.cardio;
  const field = cardio ? 'resistance' : 'load';

  const boards = !editing ? '' : sides.map((s) => {
    const leg = s === 'B' ? null : s;
    const mx = maxLoad(item.ex, leg, field);
    const series = loadSeries(item.ex, leg, 12, field);
    const last = series.length ? series[series.length - 1] : null;
    return `
    <div class="board">
      <div class="row between" style="gap:.4rem">
        <span class="sidetag ${s}">${cardio ? 'best level' : s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'both legs'}</span>
        <span class="mono board-max">${mx ? (cardio ? `L${round(mx.load, 0)}` : `${round(mx.load, 2)} ${esc(mx.loadUnit || unit)}`) : '—'}</span>
      </div>
      ${loadBars(series)}
      <div class="tiny muted">${last
        ? cardio
          ? `last ${esc(fmtDateNum(last.date))} · level ${round(last.load, 0)}${last.time ? ` · ${round(last.time, 0)} min` : ''}${last.calories ? ` · ${last.calories} cal` : ''}`
          : `last ${esc(fmtDateNum(last.date))} · ${round(last.load, 2)} ${esc(last.unit)}${last.sets ? ` · ${last.sets} × ${last.reps ?? '?'}` : ''}`
        : 'nothing logged yet'}</div>
    </div>`;
  }).join('');

  return `
  <div class="gymcard ${done ? 'done' : ''} ${started && !done ? 'started' : ''} ${editing ? 'editing' : ''}"${catStyle(ex)}>
    <div class="prow-head">
      <input type="checkbox" data-ptoggle="${esc(item.id)}" ${done ? 'checked' : ''}>
      ${thumb(item.ex, 42)}
      <div class="prow-main" data-rowclick="${esc(item.id)}">
        <span class="pname">${esc(ex?.name || item.ex)}</span>
        <span class="prow-tags">
          ${item.sets ? `<span class="pill">${item.sets} × ${item.reps}${item.sides === 'each' ? ' each side' : ''}</span>` : '<span class="pill">minutes · level · calories</span>'}
          ${weekStrip(item.ex, iso)}
          ${ex?.aka ? `<span class="tiny muted"><em>${esc(ex.aka)}</em></span>` : ''}
        </span>
      </div>
      ${started && !editing ? `<div class="prow-summary" data-rowclick="${esc(item.id)}">${entryChips(mine)}
        <span class="editcue">edit</span></div>` : ''}
    </div>
    ${editing ? `<div class="boards">${boards}</div>` + mine.map((e) => entryFields(e, ex)).join('') + logBar(item.id) : ''}
  </div>`;
}

/**
 * This month's weekly targets, each as a group you can open and tick into.
 * The groups come from the plan, so they change as you move through the months —
 * Month 1 asks for strength, balance and aerobic; Month 4 adds plyometrics,
 * agility, running, dance and kneeling.
 */
function goalsSegment(iso, entries, ctx) {
  const groups = goalGroups(iso);
  if (!groups.length) return '<div class="empty">This date sits outside the plan window.</div>';
  const month = monthForDate(iso);
  const openKey = ctx.openGoal === undefined ? (groups.find((g) => !g.met)?.t.id ?? null) : ctx.openGoal;

  return `
  <div class="tiny muted" style="margin-bottom:.5rem">
    What ${esc(month.name)} asks for each week. Open a group to log something towards it.
  </div>
  ${groups.map((g) => {
    const open = openKey === g.t.id;
    const all = allExercises().filter((x) => g.t.tagged ? x.tag === g.t.tagged : g.t.cats.includes(x.cat));
    const showAll = ctx.goalAll === g.t.id;
    const list = showAll || !month.n ? all : all.filter((x) => !x.months || x.months.includes(month.n));
    return `
    <div class="goalgroup ${g.met ? 'met' : ''} ${open ? 'open' : ''}" style="--c:${g.colour}">
      <button class="goalhead" data-goalgroup="${esc(g.t.id)}">
        <span class="goalname">${esc(g.label)}</span>
        <span class="pips">${Array.from({ length: g.goal }, (_, i) => `<i class="${i < g.hit ? 'on' : ''}"></i>`).join('')}</span>
        <span class="tiny mono nowrap ${g.met ? 'metx' : ''}">${g.met ? 'done' : `${g.left} to go`}</span>
        <span class="chev">⌄</span>
      </button>
      ${open ? `<div class="goalbody">
        ${list.map((ex) => {
          const mine = entries.filter((e) => e.ex === ex.id && !e.pid);
          const started = mine.length > 0;
          const done = started && mine.every((e) => e.logged);
          const editing = started && ctx.editing === 'cat:' + ex.id;
          return `<div class="prow ${done ? 'done' : started ? 'started' : ''} ${editing ? 'editing' : ''}"${catStyle(ex)}>
            <div class="prow-head">
              <input type="checkbox" data-cattoggle="${esc(ex.id)}" ${done ? 'checked' : ''}>
              ${thumb(ex.id, 38)}
              <div class="prow-main" data-catclick="${esc(ex.id)}">
                <span class="pname">${esc(ex.name)}</span>
                <span class="prow-tags">
                  ${ex.clinic ? '<span class="pill">clinic</span>' : ''}
                  ${weekStrip(ex.id, iso)}
                </span>
              </div>
              ${started && !editing ? `<div class="prow-summary" data-catclick="${esc(ex.id)}">${entryChips(mine)}
                <span class="editcue">edit</span></div>` : ''}
            </div>
            ${editing ? mine.map((e) => entryFields(e, ex)).join('') + logBar('cat:' + ex.id) : ''}
          </div>`;
        }).join('')}
        ${all.length > list.length || showAll
          ? `<button class="btn sm ghost" data-goalall="${esc(g.t.id)}" style="margin-top:.4rem">
              ${showAll ? 'Just this month' : `Show all ${all.length}`}</button>` : ''}
      </div>` : ''}
    </div>`;
  }).join('')}`;
}

function extraSegment(extras, month, flash, ctx) {
  return `
  <div class="row between" style="margin-bottom:.5rem">
    <span class="tiny muted">Anything outside the program — walks, dance, conditioning, show work.</span>
    <div class="row" style="gap:.3rem">
      ${extras.length ? `<button class="btn sm danger" data-act="clear-extras">Clear all ${extras.length}</button>` : ''}
      <button class="btn sm" data-act="repeat-last">Repeat last session</button>
      <button class="btn sm" data-act="add-hep">${esc(CLINIC_HEP.label || 'Clinic program')}</button>
      <button class="btn primary sm" data-act="add-ex">+ Add exercise</button>
    </div>
  </div>
  ${extras.length
    ? extras.map((e) => {
        const ex = exerciseById(e.ex);
        const editing = isEditing(ctx, e.id);
        const done = !!e.logged;
        return `<div class="prow ${done ? 'done' : 'started'} ${editing ? 'editing' : ''} ${e.id === flash ? 'flash' : ''}"${catStyle(ex)}>
          <div class="prow-head">
            <input type="checkbox" data-etoggle="${esc(e.id)}" ${done ? 'checked' : ''}>
            ${thumb(e.ex, 38)}
            <div class="prow-main" data-rowclick="${esc(e.id)}">
              <span class="pname">${esc(ex?.name || e.ex)}</span>
              <span class="prow-tags">
                ${ex?.cat ? `<span class="pill" style="background:color-mix(in srgb, ${CATEGORIES[ex.cat]?.color || '#888'} 16%, transparent);color:${CATEGORIES[ex.cat]?.color || '#888'}">${esc(CATEGORIES[ex.cat]?.label || ex.cat)}</span>` : ''}
                ${e.seeded ? '<span class="seeded-dot" title="from your clinical notes">●</span>' : ''}
              </span>
            </div>
            ${!editing ? `<div class="prow-summary" data-rowclick="${esc(e.id)}">${entryChips([e])}
              <span class="editcue">edit</span></div>` : ''}
            <button class="btn sm ghost danger" data-del-entry="${esc(e.id)}">✕</button>
          </div>
          ${editing ? entryFields(e, ex) + logBar(e.id) : ''}
        </div>`;
      }).join('')
    : '<div class="empty">Nothing extra logged.</div>'}`;
}

// ----------------------------------------------------------- measurements --
function dayMeasurements(iso) {
  const rows = state.data.measurements.filter((m) => m.date === iso);
  if (!rows.length) return '<div class="empty">No tests recorded on this date.</div>';
  return `<table class="tbl"><tbody>${rows.map((r) => {
    const m = MEASURE_BY_ID[r.measure];
    const u = m?.unit === 'weight' ? (r.unit || state.data.settings.weightUnit) : m?.unit === 'grade' ? '' : UNIT_LABEL[m?.unit] || '';
    return `<tr>
      <td>${esc(m?.label || r.measure)}</td>
      <td class="nowrap">${r.leg ? `<span class="sidetag ${r.leg}">${r.leg}</span>` : ''}</td>
      <td class="num mono">${esc(String(r.value))} ${esc(u)}</td>
      <td class="tiny muted">${esc(r.note || r.src || '')}</td>
      <td class="num"><button class="btn sm ghost danger" data-del-measure="${esc(r.id)}">✕</button></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}

// ------------------------------------------------------------------ bind ---
/** An exercise+side may only appear once in a day. Editing beats duplicating. */
function alreadyLogged(day, exId, side) {
  return (day.entries || []).some((e) => e.ex === exId && (e.side || 'B') === (side || 'B'));
}

function sidesFor(item) {
  if (item.sides === 'each') return ['L', 'R'];
  if (item.sides === 'left') return ['L'];
  if (item.sides === 'right') return ['R'];
  return ['B'];
}

function newEntriesFor(item, ex, logged = false) {
  const sides = sidesFor(item);
  return sides.map((side) => {
    const prev = lastEntry(item.ex, side);
    return {
      id: uid(),
      pid: item.id,
      ex: item.ex,
      logged,
      side,
      sets: prev?.sets ?? item.sets ?? null,
      reps: prev?.reps ?? item.reps ?? null,
      load: prev?.load ?? null,
      loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
      time: prev?.time ?? null,
      band: ex?.usesBand ? (state.data.program.band[item.id] || prev?.band || item.band || '') : undefined,
    };
  });
}

/** Announce a personal best when a loaded entry gets marked done. */
function pbCheck(iso, list) {
  for (const e of list) {
    const l = num(e.load);
    if (!l) continue;
    const prior = entriesFor(e.ex, e.side === 'B' ? null : e.side)
      .filter((x) => x.date < iso && num(x.load) > 0)
      .map((x) => num(x.load));
    if (prior.length && l > Math.max(...prior)) {
      const name = exerciseById(e.ex)?.name || e.ex;
      toast(`🏆 <b>New best — ${esc(String(round(l, 1)))} ${esc(e.loadUnit || state.data.settings.weightUnit)}</b><br>
        <span>${esc(name)}${e.side && e.side !== 'B' ? ` (${e.side === 'L' ? 'left' : 'right'})` : ''} · was ${esc(String(round(Math.max(...prior), 1)))}</span>`);
    }
  }
}

export function bindToday(root, ctx, rerender) {
  const iso = ctx.date || todayIso();
  bindMonthBoard(root, ctx, rerender);
  bindJourney(root, ctx);
  if (ctx.flash) {
    const el = root.querySelector('.prow.flash');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ctx.flash = null;
  }

  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.nav;
    ctx.date = v === 'today' ? todayIso() : addDays(iso, Number(v));
    rerender();
  }));
  root.querySelector('[data-jump]')?.addEventListener('change', (e) => {
    if (e.target.value) { ctx.date = e.target.value; rerender(); }
  });
  root.querySelectorAll('[data-bigpic]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    openPicture(b.dataset.bigpic);
  }));
  root.querySelectorAll('[data-panel="knees"], [data-panel="tests"]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.panel === 'knees' ? 'openKnees' : 'openTests';
    ctx[k] = !ctx[k];
    rerender();
  }));
  root.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => {
    ctx.seg = b.dataset.seg;
    rerender();
  }));

  root.querySelectorAll('[data-ck]').forEach((inp) => {
    const key = inp.dataset.ck;
    const ev = inp.type === 'range' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      update(() => {
        const d = ensureDay(iso);
        const raw = inp.value;
        d.checkin[key] = inp.type === 'number' || inp.type === 'range' ? (raw === '' ? '' : Number(raw)) : raw;
      });
      if (inp.type === 'range' || key === 'nextDay' || key.startsWith('effusion')) rerender();
    });
  });

  root.querySelector('[data-daynote]')?.addEventListener('input', (e) => {
    update(() => { ensureDay(iso).notes = e.target.value; });
  });

  // tick a program item on/off
  // The checkbox only toggles "done". It never expands the row.
  root.querySelectorAll('[data-ptoggle]').forEach((cb) => cb.addEventListener('change', () => {
    const pid = cb.dataset.ptoggle;
    const item = REHAB_PROGRAM.concat(GYM_PROGRAM).find((p) => p.id === pid);
    if (!item) return;
    update(() => {
      const d = ensureDay(iso);
      const mine = d.entries.filter((e) => e.pid === pid);
      if (!mine.length) d.entries.push(...newEntriesFor(item, exerciseById(item.ex), true));
      else for (const e of mine) e.logged = cb.checked;
      if (cb.checked) pbCheck(iso, d.entries.filter((e) => e.pid === pid));
    });
    if (cb.checked) {
      const tests = recordAsTests(iso, ensureDay(iso).entries.filter((e) => e.pid === pid));
      if (tests.length) {
        toast(`📏 <b>Also saved as ${tests.length === 1 ? 'a test' : 'tests'}</b><br><span>${esc(tests.join(' · '))}</span>`);
      }
    }
    ctx.editing = null;          // ticking collapses; it never opens the row
    rerender();
  }));

  // Same for a row under "Anything else".
  root.querySelectorAll('[data-etoggle]').forEach((cb) => cb.addEventListener('change', () => {
    update(() => {
      const e = ensureDay(iso).entries.find((x) => x.id === cb.dataset.etoggle);
      if (e) e.logged = cb.checked;
    });
    if (cb.checked) {
      const e = ensureDay(iso).entries.find((x) => x.id === cb.dataset.etoggle);
      const tests = e ? recordAsTests(iso, [e]) : [];
      if (tests.length) {
        toast(`📏 <b>Also saved as ${tests.length === 1 ? 'a test' : 'tests'}</b><br><span>${esc(tests.join(' · '))}</span>`);
      }
    }
    ctx.editing = null;
    rerender();
  }));

  // Clicking anywhere else on the row expands it, or collapses it again.
  // Collapsing this way does not mark it done.
  root.querySelectorAll('[data-rowclick]').forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.rowclick;
    const item = REHAB_PROGRAM.concat(GYM_PROGRAM).find((p) => p.id === key);
    const d = ensureDay(iso);
    const has = item
      ? d.entries.some((e) => e.pid === key)
      : d.entries.some((e) => e.id === key);
    if (item && !has) {
      update(() => { d.entries.push(...newEntriesFor(item, exerciseById(item.ex), false)); });
      ctx.editing = key;
    } else {
      ctx.editing = ctx.editing === key ? null : key;
    }
    rerender();
  }));

  // --- the Completed today card ---------------------------------------
  root.querySelectorAll('[data-doneoff]').forEach((cb) => cb.addEventListener('change', () => {
    const key = cb.dataset.doneoff;
    update(() => {
      for (const e of ensureDay(iso).entries) {
        if (e.pid === key || e.id === key) e.logged = false;
      }
    });
    if (ctx.editing === key) ctx.editing = null;
    rerender();
  }));

  root.querySelectorAll('[data-doneclick]').forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.doneclick;
    ctx.editing = ctx.editing === key ? null : key;
    rerender();
  }));

  // "Log it" marks it done and collapses. The numbers saved as you typed.
  root.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.log;
    const catEx = key.startsWith('cat:') ? key.slice(4) : null;
    const marked = [];
    update(() => {
      for (const e of ensureDay(iso).entries) {
        if (catEx ? (e.ex === catEx && !e.pid) : (e.pid === key || e.id === key)) {
          e.logged = true;
          marked.push(e);
        }
      }
    });
    const tests = recordAsTests(iso, marked);
    pbCheck(iso, marked);
    if (tests.length) {
      toast(`📏 <b>Also saved as ${tests.length === 1 ? 'a test' : 'tests'}</b><br><span>${esc(tests.join(' · '))}</span>`);
    }
    ctx.editing = null;
    rerender();
  }));

  root.querySelector('[data-act="tick-all"]')?.addEventListener('click', () => {
    update(() => {
      const d = ensureDay(iso);
      ctx.editing = null;
      for (const item of REHAB_PROGRAM) {
        if (item.notYet) continue;
        if (d.entries.some((e) => e.pid === item.id)) continue;
        d.entries.push(...newEntriesFor(item, exerciseById(item.ex), true));
      }
    });
    rerender();
  });

  root.querySelectorAll('[data-entry] [data-f]').forEach((inp) => {
    const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      const id = inp.closest('[data-entry]').dataset.entry;
      const f = inp.dataset.f;
      update(() => {
        const e = ensureDay(iso).entries.find((x) => x.id === id);
        if (!e) return;
        e[f] = inp.type === 'number' ? num(inp.value) : inp.value;
        if (f === 'load' && e.load != null && !e.loadUnit) e.loadUnit = state.data.settings.weightUnit;
        // remember the band for this program item
        if (f === 'band' && e.pid) state.data.program.band[e.pid] = inp.value;
      });
      if (f === 'band' || f === 'load') rerender();
    });
  });

  // --- the category tabs ------------------------------------------------
  root.querySelectorAll('[data-goalgroup]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.goalgroup;
    const groups = goalGroups(iso);
    const current = ctx.openGoal === undefined ? (groups.find((g) => !g.met)?.t.id ?? null) : ctx.openGoal;
    ctx.openGoal = current === id ? null : id;
    rerender();
  }));
  root.querySelectorAll('[data-goalall]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = b.dataset.goalall;
    ctx.goalAll = ctx.goalAll === id ? null : id;
    rerender();
  }));

  root.querySelectorAll('[data-cattoggle]').forEach((cb) => cb.addEventListener('change', () => {
    const exId = cb.dataset.cattoggle;
    const ex = exerciseById(exId);
    update(() => {
      const d = ensureDay(iso);
      const mine = d.entries.filter((e) => e.ex === exId && !e.pid);
      if (mine.length) { for (const e of mine) e.logged = cb.checked; return; }
      const prev = lastEntry(exId, 'B');
      d.entries.push({
        id: uid(), ex: exId, side: 'B', logged: cb.checked,
        sets: prev?.sets ?? null, reps: prev?.reps ?? null,
        load: prev?.load ?? null, loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
        secs: prev?.secs ?? null, time: prev?.time ?? null,
        band: ex?.usesBand ? (prev?.band || '') : undefined,
      });
    });
    ctx.editing = null;
    rerender();
  }));

  root.querySelectorAll('[data-catclick]').forEach((el) => el.addEventListener('click', () => {
    const exId = el.dataset.catclick;
    const key = 'cat:' + exId;
    const d = ensureDay(iso);
    if (!d.entries.some((e) => e.ex === exId && !e.pid)) {
      const ex = exerciseById(exId);
      const prev = lastEntry(exId, 'B');
      update(() => {
        d.entries.push({
          id: uid(), ex: exId, side: 'B', logged: false,
          sets: prev?.sets ?? null, reps: prev?.reps ?? null,
          load: prev?.load ?? null, loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
          secs: prev?.secs ?? null, time: prev?.time ?? null,
          band: ex?.usesBand ? (prev?.band || '') : undefined,
        });
      });
      ctx.editing = key;
    } else {
      ctx.editing = ctx.editing === key ? null : key;
    }
    rerender();
  }));

  // Tapping a weekly category is a SHORTCUT, not a second place to log: it
  // opens the By goal tab in Today's session with that category expanded, and
  // scrolls you there. One logging surface, reached faster.
  root.querySelectorAll('[data-catgoal]').forEach((b) => b.addEventListener('click', () => {
    const g = goalGroups(iso)[Number(b.dataset.catgoal)];
    if (!g) return;
    ctx.seg = 'goals';
    ctx.openGoal = g.t.id;
    rerender();   // synchronous, so the card exists immediately below
    // Computed offset rather than scrollIntoView: the sticky header would
    // otherwise cover the card's own heading, and smooth scrollIntoView is a
    // no-op in some engines.
    const card = document.getElementById('session-card');
    if (card) {
      const header = document.querySelector('.mtop') || document.querySelector('.topbar');
      const clear = (header ? header.getBoundingClientRect().height : 0) + 8;
      scrollWindowTo(card.getBoundingClientRect().top + window.scrollY - clear);
    }
  }));

  root.querySelectorAll('[data-astest]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const entry = ensureDay(iso).entries.find((x) => x.id === b.dataset.astest);
    const ex = entry && exerciseById(entry.ex);
    if (!ex?.measure) return;
    // carry across whatever the row already holds — seconds, reps or load
    const seed = num(entry.secs) ?? num(entry.reps) ?? num(entry.load) ?? null;
    const sp = splitOn(entry, ex) ? 'secs' : (testFields(ex) ? 'test' : null);
    const split = sp && (num(entry[sp + 'L']) != null || num(entry[sp + 'R']) != null);
    openMeasureEntry({
      measureId: ex.measure,
      date: iso,
      prefill: split
        ? { L: num(entry[sp + 'L']), R: num(entry[sp + 'R']) }
        : (entry.side === 'L' || entry.side === 'R' ? { [entry.side]: seed } : { L: seed, R: seed }),
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  }));

  root.querySelectorAll('[data-del-entry]').forEach((b) => b.addEventListener('click', () => {
    update(() => {
      const d = ensureDay(iso);
      d.entries = d.entries.filter((x) => x.id !== b.dataset.delEntry);
    });
    rerender();
  }));

  root.querySelectorAll('[data-del-measure]').forEach((b) => b.addEventListener('click', () => {
    update((d) => { d.measurements = d.measurements.filter((m) => m.id !== b.dataset.delMeasure); });
    rerender();
  }));

  root.querySelector('[data-act="add-ex"]')?.addEventListener('click', () => {
    const month = monthForDate(iso);
    openExercisePicker({
      monthN: month?.n,
      onPick(ex, side) {
        const day = ensureDay(iso);
        if (alreadyLogged(day, ex.id, side)) {
          // Already there — take him to it instead of stacking another row.
          ctx.seg = 'extra';
          ctx.flash = (day.entries.find((e) => e.ex === ex.id && (e.side || 'B') === (side || 'B')) || {}).id;
          rerender();
          return;
        }
        const prev = lastEntry(ex.id, side);
        update(() => {
          day.entries.push({
            id: uid(), ex: ex.id, side, logged: false,
            sets: prev?.sets ?? null, reps: prev?.reps ?? null,
            load: prev?.load ?? null, loadUnit: prev?.loadUnit || state.data.settings.weightUnit,
            band: ex.usesBand ? (prev?.band || '') : undefined,
          });
        });
        ctx.seg = 'extra';
        ctx.editing = day.entries[day.entries.length - 1]?.id || null;
        rerender();
      },
    });
  });

  root.querySelector('[data-act="add-hep"]')?.addEventListener('click', () => {
    update(() => {
      const d = ensureDay(iso);
      for (const e of CLINIC_HEP.entries) {
        if (alreadyLogged(d, e.ex, e.side)) continue;
        d.entries.push({ id: uid(), ...e, logged: false });
      }
    });
    rerender();
  });

  root.querySelector('[data-act="repeat-last"]')?.addEventListener('click', () => {
    const prev = Object.keys(state.data.days)
      .filter((k) => k < iso && (state.data.days[k].entries || []).length)
      .sort().pop();
    if (!prev) { alert('No earlier session to copy.'); return; }
    update(() => {
      const d = ensureDay(iso);
      for (const e of state.data.days[prev].entries) {
        const { id, seeded, ...rest } = e;
        if (rest.pid && d.entries.some((x) => x.pid === rest.pid)) continue;
        if (alreadyLogged(d, rest.ex, rest.side)) continue;
        d.entries.push({ id: uid(), ...rest, logged: false });
      }
    });
    rerender();
  });

  root.querySelector('[data-act="clear-extras"]')?.addEventListener('click', () => {
    const n = (getDay(iso)?.entries || []).filter((e) => !e.pid).length;
    if (!confirm(`Remove all ${n} exercise${n === 1 ? '' : 's'} from "Anything else" on this day?`)) return;
    update(() => {
      const d = ensureDay(iso);
      d.entries = d.entries.filter((e) => e.pid);
    });
    rerender();
  });

  root.querySelector('[data-act="untick-all"]')?.addEventListener('click', () => {
    const ids = new Set(REHAB_PROGRAM.map((p) => p.id));
    ctx.editing = null;
    update(() => {
      const d = ensureDay(iso);
      d.entries = d.entries.filter((e) => !ids.has(e.pid));
    });
    rerender();
  });

  root.querySelector('[data-act="add-measure"]')?.addEventListener('click', () => {
    openMeasureEntry({
      measureId: 'sl_calf_raise',
      date: iso,
      onSave(rows) {
        update((d) => { for (const r of rows) d.measurements.push({ id: uid(), ...r }); });
        rerender();
      },
    });
  });
}
