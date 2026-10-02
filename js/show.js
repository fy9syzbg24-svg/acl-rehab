// Rehab Test round 3 (2026-09-30): show day, the first show back, and days to the stage.
// design-pass/research/11-features-to-build.md A1 and A8; notes in design-pass/v3/r3-today-notes.md.
//
// Why: the whole app exists to get him back on stage ("Ready by Adelaide", his name for the
// plan, 2026-09-19). Before this a show day could only look like an unfinished rehab day, the
// complaint he made about a physio day ("This does not reflect the productive day that I've
// had.", 2026-09-18). His first performance since the injury is Thu 1 Oct.
//
// Rules kept here:
//   - A show lives in rtlocal.js (extras.shows in his synced record since 2026-09-30, registered
//     as 'y' in sync/records.js). Nothing is written to program.clinicDays or to his days.
//   - Nothing is deleted: taking a show off a day hides it (Undo puts it back as it was).
//   - The show row never counts in the day ring or in "N left" (default until his yes, B1).
//   - No rating and no knee score on a show (he dropped the pain reading, 2026-09-19); minutes
//     are empty until he types them, nothing invented.
//   - The first show back plays ONCE, ever, and only when that show is today or yesterday
//     (logging after the fact is normal, M3, but a moment days later would be odd). The
//     native layer plays kind 'show' (house lights: the room dims, a follow spot on the day
//     ring, a white shimmer, never gold: gold means the day is finished). Without the app, a
//     web overlay does the same. Between midnight and 5 am the quiet variant (A7).
//   - Days to the stage: a plain count to the next date his plan marks as a show, its label
//     verbatim from his plan (nothing hard coded); no "only", no "left!", no red.

import { esc, todayIso, addDays, daysBetween, fmtDate, onTimePicked } from './util.js';
import { local } from './rtlocal.js';
import { PLAN_META } from '../data/plan.js';
import { stageCountdown } from './views/journey.js';
import { openModal, closeModal, actionToast } from './components.js';
import * as N from './native-bridge.js';
import { reducedMotion } from './fold.js';

// ------------------------------------------------------------------ data ---
/** The show on a day, or null (hidden shows are not shown). */
export function showOn(iso) {
  const s = local.get(['shows', iso]);
  return s && typeof s === 'object' && !s.hidden ? s : null;
}

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

/** Put a show on a day. A show hidden earlier comes back with what he had entered. */
export function addShow(iso) {
  const was = local.get(['shows', iso]);
  const next = was && typeof was === 'object'
    ? { ...was, hidden: false, updatedMs: Date.now() }
    : { atMs: null, tz: zone(), count: 1, mins: null, note: '', performed: false, hidden: false, updatedMs: Date.now() };
  delete next.hiddenMs;
  return local.set(['shows', iso], next);
}

/** Change fields of a day's show. */
export function patchShow(iso, patch) {
  const was = showOn(iso);
  if (!was) return false;
  return local.set(['shows', iso], { ...was, ...patch, updatedMs: Date.now() });
}

/** Take a show off a day with an Undo that puts it back exactly as it was. */
export function removeShow(iso, after = null) {
  const before = local.get(['shows', iso]);
  if (!before) return;
  local.hide(['shows', iso]);
  after?.();
  actionToast('<b>Show removed</b>', 'Undo', () => { local.set(['shows', iso], before); after?.(); }, { key: 'show-undo' });
}

/** Has any show other than `iso` ever been ticked performed? */
function performedBefore(iso) {
  return local.list('shows').some((s) => s.key !== iso && s.performed);
}

const t12 = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// ------------------------------------------------------------------ glyph ---
/** A spotlight cone over a small stage line: one stroke weight, round caps, no emoji. */
export function stageGlyph(size = 30) {
  return `<svg class="show-glyph" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10.7 5.4L4.5 17.2h15L13.3 5.4z" fill="currentColor" opacity=".24" stroke="none"/>
    <path d="M9.6 2.8h4.8l-.9 2.6h-3z" fill="currentColor"/><path d="M10.7 5.4L4.5 17.2M13.3 5.4l6.2 11.8" opacity=".75"/>
    <ellipse cx="12" cy="17.6" rx="7.6" ry="1.5"/><path d="M3 20.8h18"/></svg>`;
}

// -------------------------------------------------------------------- row ---
/**
 * "The show" row, for the top of Today's list on a show day. The same row grammar as an
 * exercise (the tile, the title, the facts, Apple's circle), a black tile with the stage
 * glyph so it reads apart from every exercise at a glance. The circle ticks "performed"
 * (his green wash, T4).
 */
// r3fix TS-09: the row is slim (the done row's 52 pt grammar, a 40 pt black tile) and, when
// the day has tendon loading, it is the first row of that same list (`bare`), with no section
// gap, so the first exercise row moves down one slim row, not a full row plus a gap.
export function showRowHtml(iso, { bare = false } = {}) {
  const s = showOn(iso);
  if (!s) return '';
  const facts = [];
  facts.push(s.atMs ? `<span class="td-nw">${esc(t12(s.atMs))}</span>` : '<span class="td-addtime">Add the time</span>');
  if (s.count > 1) facts.push(`<span class="td-nw">${s.count} shows</span>`);
  if (s.mins) facts.push(`<span class="td-nw">${esc(String(s.mins))} min${s.count > 1 ? ' each' : ''}</span>`);
  const row = `
      <div class="crow trow td-showrow slim ${s.performed ? 'done' : ''}" data-showrow="${esc(iso)}">
        <div class="crow-head">
          <button class="crow-shot td-shot td-stage" data-showopen aria-label="The show: time and details">${stageGlyph(26)}</button>
          <button class="crow-main" data-showopen aria-label="The show, ${esc(s.atMs ? t12(s.atMs) : 'no time yet')}">
            <span class="crow-text">
              <span class="crow-name">The show</span>
              <span class="crow-sub">${facts.join(' · ')}</span>
            </span>
          </button>
          <input type="checkbox" class="tick" data-showtick ${s.performed ? 'checked' : ''} aria-label="Performed: the show">
        </div>
      </div>`;
  if (bare) return row;
  return `
  <section class="td-list td-showlist" aria-label="The show">
    <div class="checklist">${row}
    </div>
  </section>`;
}

/**
 * Wire the row inside `root`. `ringEl()` finds the day ring for the first show moment;
 * `repaint()` redraws Today after a change.
 */
export function bindShowRow(root, iso, { ringEl, repaint }) {
  root.querySelectorAll('[data-showopen]').forEach((b) => b.addEventListener('click', () => openShowSheet(iso, { repaint })));
  root.querySelector('[data-showtick]')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    const first = on && !performedBefore(iso) && !local.get(['seen', 'firstShow']);
    patchShow(iso, { performed: on, performedMs: on ? Date.now() : null });
    N.haptic(on ? 'success' : 'light');
    const row = e.target.closest('.crow');
    row?.classList.toggle('done', on);
    const recent = iso === todayIso() || iso === addDays(todayIso(), -1);
    if (first && recent) {
      local.set(['seen', 'firstShow'], iso);
      firstShowBack(ringEl?.() || row);
    }
    repaint?.();
  });
}

// ------------------------------------------------------------------ sheet ---
export function openShowSheet(iso, { repaint = null } = {}) {
  if (!showOn(iso)) addShow(iso);
  const s = showOn(iso);
  if (!s) return;
  const hhmm = s.atMs ? (() => { const d = new Date(s.atMs); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; })() : '';
  const back = openModal({
    title: 'The show',
    body: `<div class="show-sheet">
      <div class="show-hero"><span class="show-tile">${stageGlyph(40)}</span>
        <span class="show-when">${esc(iso === todayIso() ? 'Today' : fmtDate(iso, 'long'))}</span></div>
      <div class="show-group">
        <label class="show-row"><span>Time</span><span class="show-timebox"${hhmm ? '' : ' data-empty'}><span class="show-add" aria-hidden="true">Add the time</span><input type="time" data-show-time value="${hhmm}" aria-label="Time of the show"></span></label>
        <div class="show-row"><span>Shows that day</span>
          <span class="show-step" role="group" aria-label="Shows that day">
            <button type="button" data-show-count="-1" aria-label="One fewer">−</button>
            <b data-show-n>${s.count || 1}</b>
            <button type="button" data-show-count="1" aria-label="One more">+</button>
          </span></div>
        <label class="show-row"><span>Minutes each</span><input type="number" inputmode="numeric" min="1" max="240" data-show-mins value="${s.mins ?? ''}" placeholder="Add" aria-label="Minutes each"></label>
        <label class="show-row"><span>Note</span><input type="text" data-show-note maxlength="120" value="${esc(s.note || '')}" placeholder="Add a note" aria-label="Note" enterkeyhint="done"></label>
      </div>
      <button type="button" class="show-remove" data-show-remove>Remove the show</button>
    </div>`,
    onMount(root) {
      const m = root.querySelector('.modal');
      m?.classList.add('show-modal');
      // The sheet itself takes focus, so no field raises the keyboard before he picks one.
      m?.focus({ preventScroll: true });
    },
  });
  const time = back.querySelector('[data-show-time]');
  const box = time?.closest('.show-timebox');
  const setEmpty = () => box?.toggleAttribute('data-empty', !time.value);
  // Desktop browsers need to be asked for the wheel; iOS opens it on the tap.
  box?.addEventListener('click', (ev) => { if (ev.target !== time) { try { time.showPicker?.(); } catch { /* the tap still works */ } } });
  onTimePicked(time, (v) => {
    const before = showOn(iso)?.atMs ?? null;
    if (!/^\d{2}:\d{2}$/.test(v)) { patchShow(iso, { atMs: null }); setEmpty(); repaint?.(); return; }
    const [h, m] = v.split(':').map(Number);
    const at = new Date(`${iso}T00:00:00`);
    at.setHours(h, m, 0, 0);
    patchShow(iso, { atMs: at.getTime(), tz: zone() });
    setEmpty();
    repaint?.();
    // r3fix TS-05: iOS fills an empty time wheel with the clock and keeps it when the wheel
    // is dismissed, so a first time is never silent: it is said, with Undo back to no time.
    if (before == null) {
      actionToast(`<b>Show at ${esc(t12(at.getTime()))}</b>`, 'Undo', () => {
        patchShow(iso, { atMs: null });
        if (document.contains(time)) { time.value = ''; setEmpty(); }
        repaint?.();
      }, { key: 'show-time-undo' });
    }
  });
  back.querySelectorAll('[data-show-count]').forEach((b) => b.addEventListener('click', () => {
    const cur = showOn(iso)?.count || 1;
    const n = Math.min(6, Math.max(1, cur + Number(b.dataset.showCount)));
    if (n === cur) return;
    patchShow(iso, { count: n });
    back.querySelector('[data-show-n]').textContent = String(n);
    N.haptic('selection');
    repaint?.();
  }));
  back.querySelector('[data-show-mins]')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    patchShow(iso, { mins: e.target.value.trim() && Number.isFinite(v) && v > 0 ? Math.round(v) : null });
    repaint?.();
  });
  back.querySelector('[data-show-note]')?.addEventListener('change', (e) => { patchShow(iso, { note: e.target.value.trim() }); repaint?.(); });
  back.querySelector('[data-show-remove]')?.addEventListener('click', () => { closeModal(); removeShow(iso, repaint); });
}

// ------------------------------------------------------ the first show back ---
/**
 * House lights for the first show back. Native kind 'show' first; the web overlay only when
 * the app did not play it (never both). No words on the dimmed area.
 */
export async function firstShowBack(el) {
  const h = new Date().getHours();
  const quiet = h < 5;
  const rect = N.rectOf(el);
  const ok = await N.call('cel.play', { kind: 'show', rect, quiet });
  if (ok === true) return 'native';
  // A rising swell, then one sharp tap (quiet: one soft tap). Resolves null without the app.
  N.hapticScore(quiet
    ? [{ t: 0, type: 'tap', intensity: 0.4, sharpness: 0.2 }]
    : [{ t: 0, type: 'swell', intensity: 0.7, sharpness: 0.3, dur: 0.8 }, { t: 0.85, type: 'tap', intensity: 1, sharpness: 0.9 }]);
  houseLightsWeb(el);
  return 'web';
}

/** The web fallback: the room dims around a soft edged spot on `el`, a white shimmer circles once. */
export function houseLightsWeb(el) {
  const r = el?.getBoundingClientRect?.() || { left: innerWidth / 2 - 40, top: innerHeight / 3, width: 80, height: 80 };
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const rad = Math.max(r.width, r.height) / 2 + 28;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const still = reducedMotion();
  const ov = document.createElement('div');
  ov.className = `house-lights${still ? ' still' : ''}`;
  ov.setAttribute('aria-hidden', 'true');
  ov.style.cssText = `--cx:${cx}px;--cy:${cy}px;--r:${rad}px;--dim:${dark ? 0.72 : 0.5}`;
  ov.innerHTML = '<span class="hl-spot"></span><span class="hl-shimmer"></span>';
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('on'));
  setTimeout(() => { ov.classList.remove('on'); ov.classList.add('up'); }, still ? 1800 : 2400);
  setTimeout(() => ov.remove(), still ? 1900 : 3200);
  return ov;
}

// ------------------------------------------------------- days to the stage ---
/**
 * The next date his plan marks as a show (today or later), else the next future date of any
 * kind, else null. Returns { days, label, iso } with his plan's own label, verbatim.
 */
// Round 3 consistency (2026-09-30): the Plan's countdown (journey.js stageCountdown) is the one
// rule, so Today's all done line and the Plan never name two different targets.
export function nextStage(fromIso = todayIso(), meta = PLAN_META) {
  const t = stageCountdown(fromIso, meta);
  if (!t) return null;
  return { days: t.days, label: t.label || '', iso: t.date };
}

/** "98 days to First run of the show", or "Today: First run of the show". Plain, never urgent. */
export function stageLine(fromIso = todayIso()) {
  const s = nextStage(fromIso);
  if (!s || !s.label) return '';
  const words = s.days === 0 ? `<b>Today</b> ${esc(s.label)}` : `<b>${s.days}</b> day${s.days === 1 ? '' : 's'} to ${esc(s.label)}`;
  return `<div class="td-stageline" title="${esc(fmtDate(s.iso, 'long'))}">${stageGlyph(14)}${words}</div>`;
}
