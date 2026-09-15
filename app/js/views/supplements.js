// Supplements and as-needed medication.
//
// Two separate things live here:
//
//   supplements[]   a daily checklist, take it or you don't
//   prnMeds[] + doses[]   as-needed drugs where the QUESTION is "when may I
//                         take another?", so each dose is timestamped
//
// THE HISTORY RULE
// Adding or removing a supplement must never rewrite the past. So membership
// is not a boolean, it is a list of date SPANS: {from, until}. A supplement
// shows on date D if any span covers D. Deleting closes the open span at
// today; re-adding opens a new one. Yesterday keeps whatever was true
// yesterday, which is the whole point of keeping a log.
//
// SEEDED IDS ARE DETERMINISTIC
// The first version used uid() for the seeded list. The Mac seeded ten rows
// and the phone seeded ten more with different ids, and sync, correctly,
// kept all twenty. Anything seeded independently on multiple devices must
// derive its id from its content so every device produces the same record.

import { parse, morph } from '../morph.js';
import { growIn, foldAway, insertBody, patchHead } from '../fold.js';
import { esc, todayIso, currentDayIso, uid, fmtDate, onTimePicked } from '../util.js';
import { state, update, ensureDay, getDay } from '../store.js';
import { renderDatePill, bindDatePill, openModal, closeModal, toast } from '../components.js';

export const WHENS = [['morning', 'Morning'], ['anytime', 'Anytime'], ['evening', 'Evening']];

// THE RULE: whatever he has arranged in the app IS the default. His list lives
// in his synced data, never in this public code (2026-09-15, audit A28: the
// seed list here used to name his own medications). A fresh device starts
// empty and receives the real list by sync; `settings.suppsSeeded` means this
// never runs twice, so an update can never reorder, regroup or re-add anything
// he has curated.
const DEFAULTS = [];

// Common as-needed drugs, offered in the add sheet and seeded once.
export const PRN_PRESETS = [
  ['Naproxen', '200mg', 12],
  ['Tylenol', '1000mg', 6],
  ['Ibuprofen', '600mg', 6],
  ['Aspirin', '81mg', 12],
];
const PRN_SEED = ['Naproxen', 'Tylenol', 'Ibuprofen'];

export function seedPrnMeds(d) {
  if (d.settings?.prnSeeded) return false;
  if ((d.prnMeds || []).length) { (d.settings ||= {}).prnSeeded = true; return false; }
  d.prnMeds = d.prnMeds || [];
  const have = new Set(d.prnMeds.map((m) => m.id));
  let added = 0;
  PRN_PRESETS.filter(([n]) => PRN_SEED.includes(n)).forEach(([name, dose, waitHours], i) => {
    const id = 'prn_' + suppId(name).slice(4);
    if (have.has(id)) return;
    d.prnMeds.push({ id, name, dose, waitHours, order: i, spans: [{ from: '1970-01-01', until: null }] });
    added++;
  });
  (d.settings ||= {}).prnSeeded = true;
  return added > 0;
}

/** Stable id from a name, the same on every device, so seeding cannot duplicate. */
export function suppId(name) {
  return 'sup_' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function seedSupplements(d) {
  if (d.settings?.suppsSeeded) return false;      // he may legitimately empty the list
  // Belt and braces: a list that already exists is his, flag or no flag.
  if ((d.supplements || []).length) { (d.settings ||= {}).suppsSeeded = true; return false; }
  d.supplements = d.supplements || [];
  const have = new Set(d.supplements.map((s) => s.id));
  let added = 0;
  DEFAULTS.forEach(([name, when], i) => {
    const id = suppId(name);
    if (have.has(id)) return;
    d.supplements.push({ id, name, when, order: i, spans: [{ from: '1970-01-01', until: null }] });
    added++;
  });
  (d.settings ||= {}).suppsSeeded = true;
  return added > 0;
}

// The old dedupeSupplements() has been REMOVED on purpose. It collapsed rows by
// name, which is now wrong: the same supplement may legitimately appear twice
// (a morning dose and an evening one). The duplicate seeding it existed to
// repair was fixed at the source, seeded ids are deterministic, and the
// shared copy carries tombstones for the old random ids, so any stale device
// converges by pulling those rather than by re-deriving the fix locally.

// A pre-spans row: `active:false` meant removed, otherwise always present.
function normSpans(s) {
  if (Array.isArray(s.spans) && s.spans.length) return s.spans;
  return s.active === false ? [] : [{ from: '1970-01-01', until: null }];
}
function mergeSpans(spans) {
  const open = spans.some((x) => !x.until);
  const from = spans.map((x) => x.from).sort()[0] || '1970-01-01';
  return open ? [{ from, until: null }] : spans;
}

/** Was this item on the list on that date? */
export function activeOn(item, iso) {
  return normSpans(item).some((s) => s.from <= iso && (!s.until || iso < s.until));
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0)
  // Records are merged independently, so two devices can land on the same
  // order number. Breaking the tie on id keeps every device showing the same
  // sequence instead of each picking its own.
  || String(a.id).localeCompare(String(b.id));

export function listFor(iso) {
  return (state.data.supplements || [])
    .filter((s) => activeOn(s, iso))
    .sort(byOrder);
}

const ticksOn = (iso) => (getDay(iso)?.supps) || {};

// A tick is `true` (before 2026-09-14, no time known) or the ISO moment it was
// taken. Both are truthy, so every older reader still works. A time is never
// invented for an old tick; he can set one.
export function suppTime(value) {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
// Today registers what else a supplement's time sets: his collagen and the
// tendon loading are thirty minutes apart, always (his rule, 2026-09-14). A
// hook, because today.js already imports this file.
let suppTimeHook = null;
export function onSuppTime(fn) { suppTimeHook = fn; }

const hhmm24 = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const time12 = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export function suppScore(iso) {
  const list = listFor(iso);
  if (!list.length) return null;
  const t = ticksOn(iso);
  return { taken: list.filter((s) => t[s.id]).length, total: list.length };
}

// ----------------------------------------------------------------- PRN ---
const doses = () => state.data.doses || [];
const dosesFor = (medId) => doses().filter((x) => x.medId === medId)
  .sort((a, b) => String(b.at).localeCompare(String(a.at)));

/**
 * When may the next dose be taken, and how long is left.
 * Computed from the most recent dose regardless of date, so a wait that runs
 * past midnight still reads correctly on the following day.
 */
export function prnStatus(med, now = new Date()) {
  const last = dosesFor(med.id)[0];
  if (!last) return { clear: true, last: null };
  const lastAt = new Date(last.at);
  const nextAt = new Date(lastAt.getTime() + (Number(med.waitHours) || 0) * 3600e3);
  const msLeft = nextAt - now;
  return { clear: msLeft <= 0, last, lastAt, nextAt, msLeft };
}

/** Sum a day's doses when they share a unit, so a split dose reads as one. */
function totalFor(rows) {
  let sum = 0; let unit = null; let ok = true;
  for (const r of rows) {
    const m = /^\s*([\d.]+)\s*([a-zA-Z]*)/.exec(r.dose || '');
    if (!m) { ok = false; break; }
    const u = (m[2] || '').toLowerCase();
    if (unit === null) unit = u; else if (unit !== u) { ok = false; break; }
    sum += Number(m[1]);
  }
  if (!ok || !sum) return '';
  return `= ${Number(sum.toFixed(2))}${unit || ''} today`;
}

function humanLeft(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// --------------------------------------------------------------- render ---
/**
 * The checklist rows, grouped morning / anytime / evening. Shared by the
 * Supplements tab and the block on Today, so the two can never drift: same
 * rows, same folding, same tick. `edit` adds the drag handles and delete
 * marks; only the tab offers that.
 */
export function renderSuppGroups(iso, ctx, { edit = false } = {}) {
  const list = listFor(iso);
  const ticks = ticksOn(iso);
  const group = ([key, label]) => {
    const rows = list.filter((s) => (s.when || 'anytime') === key);
    // While editing, keep empty groups on screen so you can drag INTO them.
    if (!rows.length && !edit) return '';
    const taken = rows.filter((s) => ticks[s.id]).length;
    const done = rows.length > 0 && taken === rows.length;
    // 2026-09-14 revision 3 (F20): a finished group stays open until he folds
    // it, so the row he just ticked (and its time) does not jump away.
    const open = ctx.suppOpen?.[key] ?? true;
    return `
      <section class="suppgroup ${done ? 'done' : ''}">
        <button class="suppgrouphead" data-suppgroup="${key}" aria-expanded="${open}">
          <span class="sg-label">${label}</span>
          <span class="sg-count ${done ? 'good' : ''}">${done ? `${checkSvg}All taken` : `${taken} of ${rows.length}`}</span>
          <span class="sg-chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></svg></span>
        </button>
        ${open ? `<div class="fold-body"><div class="fold-clip"><div class="supplist ${edit ? 'editing' : ''}" data-dropzone="${key}">
          ${rows.map((s) => suppRow(s, iso, ticks, ctx, edit)).join('')}
        </div></div></div>` : ''}
      </section>`;
  };
  if (!list.length) return '<div class="tiny muted">Nothing on the list for this day.</div>';
  return WHENS.map(group).join('');
}

const checkSvg = '<svg class="sg-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

/**
 * One supplement (F21): a real checkbox with its name as the label, and a
 * separate time control beside it, in a slot that is always there (dimmed
 * until the supplement is ticked). Two independent actions, each at least
 * 44 px, keyboard operable.
 */
function suppRow(s, iso, ticks, ctx, edit) {
  const on = !!ticks[s.id];
  const t = suppTime(ticks[s.id]);
  const id = `supp-${s.id}-${iso}`;
  return `
    <div class="supprow ${on ? 'on' : ''} ${ctx.suppPop === s.id ? 'pop' : ''}" data-row="${esc(s.id)}">
      ${edit ? '<span class="supphandle" data-drag aria-label="Drag to reorder">≡</span>' : ''}
      <label class="supp-check" for="${esc(id)}">
        <input type="checkbox" id="${esc(id)}" class="supp-input" data-supp="${esc(s.id)}" ${on ? 'checked' : ''} data-focus-key="supp|${esc(s.id)}">
        <span class="supptick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span>
        <span class="suppname">${esc(s.name)}</span>
      </label>
      ${edit
        ? `<button class="suppdel" data-suppdel="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">✕</button>`
        : `<label class="supptime ${on ? '' : 'inactive'} ${t ? 'set' : ''}" data-supptime-wrap>
            <span>${t ? esc(time12(t)) : 'Set time'}</span>
            <input type="time" data-supptime="${esc(s.id)}" value="${t ? hhmm24(t) : ''}" ${on ? '' : 'disabled'} aria-label="Time you took ${esc(s.name)}">
          </label>`}
    </div>`;
}

/** Tick and fold handlers for the shared rows. */
export function bindSuppGroups(root, iso, ctx, rerender) {
  // A group folds and unfolds in place (Fable B5); while reordering, the
  // whole list repaints so the drag handles are bound.
  root.querySelectorAll('[data-suppgroup]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.suppgroup;
    ctx.suppOpen = { ...(ctx.suppOpen || {}) };
    ctx.suppOpen[k] = !(ctx.suppOpen[k] ?? true);
    const sec = b.closest('.suppgroup');
    const edit = !!sec?.querySelector('.supplist.editing') || !!(ctx.suppEdit && b.closest('.supps-page'));
    if (!sec || edit) { rerender(); return; }
    const tpl = [...parse(`<div>${renderSuppGroups(iso, ctx)}</div>`).firstElementChild.children]
      .find((x) => x.querySelector(`[data-suppgroup="${CSS.escape(k)}"]`));
    if (!tpl) { rerender(); return; }
    if (ctx.suppOpen[k]) {
      const body = insertBody(sec, tpl, '.fold-body');
      if (!body) { rerender(); return; }
      bindSuppGroups(body, iso, ctx, rerender);
      growIn(body, 220);
      return;
    }
    const body = sec.querySelector(':scope > .fold-body');
    if (!body || !patchHead(sec, tpl, '.fold-body')) { rerender(); return; }
    foldAway(body, 180, () => { if (!(ctx.suppOpen?.[k] ?? true)) body.remove(); });
  }));

  // The time wheel on a ticked row: when he actually took it, for the mornings
  // he logs later.
  root.querySelectorAll('[data-supptime]').forEach((inp) => {
    // iOS opens its wheel on a tap; desktop browsers need to be asked.
    inp.closest('[data-supptime-wrap]')?.addEventListener('click', (ev) => {
      if (inp.disabled) return;
      if (ev.target === inp) return;
      try { inp.showPicker?.(); } catch { /* the native tap still works */ }
    });
    onTimePicked(inp, (v) => {
      if (!/^\d{2}:\d{2}$/.test(v)) return;
      const [h, m] = v.split(':').map(Number);
      const at = new Date(iso + 'T00:00:00');
      at.setHours(h, m, 0, 0);
      update(() => {
        const day = ensureDay(iso);
        day.supps = { ...(day.supps || {}) };
        if (day.supps[inp.dataset.supptime]) day.supps[inp.dataset.supptime] = at.toISOString();
        suppTimeHook?.(iso, inp.dataset.supptime, at);
      });
      rerender({ soft: true });
    });
  });

  root.querySelectorAll('input[data-supp]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.supp;
    const on = cb.checked;
    update(() => {
      const day = ensureDay(iso);
      day.supps = { ...(day.supps || {}) };
      if (!on) delete day.supps[id];
      // F08: a tick on the day in hand records the moment; a tick on another
      // day records "taken, time unknown" (the existing true), never today's
      // clock on yesterday's list. He can set the real time with the chip.
      else day.supps[id] = iso === currentDayIso() ? new Date().toISOString() : true;
    });
    // Patched in place (Fable B2): the row in the tap, so the tick shows at
    // once; the group count, All taken and the page's own totals once that
    // frame is drawn.
    ctx.suppPop = on ? id : null;    // one render's worth of pop
    const row = cb.closest('.supprow');
    const edit = !!row?.closest('.supplist.editing');
    const tpl = row && parse(`<div>${renderSuppGroups(iso, ctx, { edit })}</div>`).firstElementChild
      .querySelector(`.supprow[data-row="${CSS.escape(id)}"]`);
    const ok = !!tpl && morph(row, tpl);
    if (!ok) rerender({ soft: true });
    ctx.suppPop = null;
    if (ok) requestAnimationFrame(() => setTimeout(() => { if (cb.isConnected) rerender({ soft: true }); }, 0));
  }));
}

/**
 * One line for Today: each as-needed medication and whether it is clear.
 * Empty when nothing is on the list.
 */
export function prnSummary(iso) {
  const day = prnDateFor(iso);
  const meds = (state.data.prnMeds || []).filter((m) => activeOn(m, day)).sort(byOrder);
  if (!meds.length) return '';
  return meds.map((m) => {
    const st = prnStatus(m);
    return `${m.name} ${!st.last || st.clear ? 'clear' : humanLeft(st.msLeft)}`;
  }).join(' · ');
}

export function renderSupplements(ctx) {
  const iso = ctx.suppDate || currentDayIso();
  const score = suppScore(iso);
  const d = new Date(iso + 'T12:00:00');
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  const cur = currentDayIso();

  return `
  <div class="stack supps-page">
    <header class="pagehead">
      <h1>Supplements</h1>
      <div class="daynav supps-nav">
        <span class="daynav-date lede"><span class="dn-long">${esc(d.toLocaleDateString('en-US', opts))}</span><span class="dn-short">${esc(d.toLocaleDateString('en-US', { ...opts, weekday: 'short', month: 'short' }))}</span>
          <input type="date" data-jump value="${iso}" aria-label="Jump to a date"></span>
        <span class="daynav-ctl">
          <button class="daynav-arrow" data-nav="-1" aria-label="Previous day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
          <button class="daynav-arrow" data-nav="1" aria-label="Next day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
          <button class="btn sm daynav-today" data-nav="today" ${iso === cur ? 'disabled aria-disabled="true"' : ''}>Today</button>
        </span>
      </div>
      <div class="supps-bar">
        <span class="supps-count">${score ? `${score.taken} of ${score.total} taken` : 'Nothing on the list'}</span>
        <button class="btn ${ctx.suppEdit ? 'primary' : ''}" data-supp-edit>${ctx.suppEdit ? 'Done' : 'Edit'}</button>
      </div>
    </header>

    <div class="supp-groups">${renderSuppGroups(iso, ctx, { edit: !!ctx.suppEdit })}</div>
    <button class="btn supp-add" data-supp-add><span aria-hidden="true">+</span> Add a supplement</button>

    ${renderPrn(ctx, iso)}
  </div>`;
}

/**
 * The as-needed card runs on the REAL calendar date, never the checklist's
 * 5am-shifted one. A dose is a timed event: its day is the clock's day, and
 * the countdown to the next one measures from the actual moment.
 *
 * `iso` is the day the CHECKLIST is showing. While that is the current one the
 * two differ only between midnight and 5am, and there the medication follows
 * the clock. Navigate deliberately to an older date and this follows you there,
 * exactly as it always did.
 */
function prnDateFor(iso) {
  return iso === currentDayIso() ? todayIso() : iso;
}

function renderPrn(ctx, iso) {
  const day = prnDateFor(iso);
  const meds = (state.data.prnMeds || []).filter((m) => activeOn(m, day)).sort(byOrder);

  return `
  <section class="card">
    <header><h2>As needed</h2><span class="sub">timed doses: aspirin, naproxen, paracetamol</span></header>
    <div class="card-body">
      ${meds.length ? meds.map((m) => {
        const st = prnStatus(m);
        const onThisDate = doses().filter((x) => x.medId === m.id && String(x.at).slice(0, 10) === day)
          .sort((a, b) => String(a.at).localeCompare(String(b.at)));
        // Fixed structure regardless of state: the row wrapped differently
        // depending on whether there was a countdown or a logged dose, so the
        // same medication looked like a different component at different times
        // of day. Grid, not flex-wrap.
        const pctElapsed = (!st.last || st.clear) ? 0
          : Math.max(0, Math.min(100, 100 - (st.msLeft / ((Number(m.waitHours) || 1) * 3600e3)) * 100));
        return `
        <div class="prnrow ${st.clear ? 'clear' : 'waiting'}" data-prn-row="${esc(m.id)}">
          <i class="prnfill" style="--p:${(pctElapsed / 100).toFixed(3)}"></i>
          <div class="prngrid">
            <span class="prnname">${esc(m.name)}</span>
            <span class="prndose tiny muted">${esc(m.dose || '')}${m.waitHours ? ` · ${esc(String(m.waitHours))}h` : ''}</span>
            <span class="prnstatus" data-prn-status="${esc(m.id)}">
              ${!st.last || st.clear
                ? '<span class="pill good">clear</span>'
                : `<span class="pill warn">${esc(humanLeft(st.msLeft))}</span>
                   <span class="tiny muted">until ${esc(hhmm(st.nextAt))}${
                     localIso(st.nextAt) !== localIso(st.lastAt) ? '+1' : ''}</span>`}
            </span>
            <span class="prnactions">
              <button class="btn sm ${st.clear ? 'primary' : ''}" data-prn-dose="${esc(m.id)}">Log</button>
              ${ctx.suppEdit ? `<button class="suppdel" data-prndel="${esc(m.id)}" aria-label="Remove ${esc(m.name)}">✕</button>` : ''}
            </span>
            ${onThisDate.length ? `<span class="prndoses">
              ${onThisDate.map((x) => `<button class="dosechip" data-dosedel="${esc(x.id)}" aria-label="Remove the ${esc(m.name)} dose at ${esc(hhmm(new Date(x.at)))}">
                <b>${esc(hhmm(new Date(x.at)))}</b>${x.dose ? ` · ${esc(x.dose)}` : ''}</button>`).join('')}
              ${onThisDate.length > 1 ? `<span class="dosetotal tiny muted">${esc(totalFor(onThisDate))}</span>` : ''}
            </span>` : ''}
          </div>
        </div>`;
      }).join('')
      : '<div class="tiny muted">Nothing added yet. Useful for anything with a minimum gap between doses.</div>'}
      <button class="btn sm" data-prn-add style="margin-top:.8rem">+ Add an as-needed medication</button>
    </div>
  </section>`;
}

// ----------------------------------------------------------------- bind ---
/**
 * Reordering by drag, built on pointer events.
 *
 * HTML5 drag-and-drop does not work with a finger on iOS, so this tracks the
 * pointer directly: the row under it is found with elementFromPoint and the
 * dragged row is moved before or after it live. Dropping into another group's
 * list also changes `when`, which is what makes "move it to evening" a drag
 * rather than a form field.
 */
function bindDragReorder(root, rerender) {
  let dragging = null;
  let startY = 0;

  const rowUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-row]') : null;
  };
  const zoneUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('[data-dropzone]') : null;
  };

  // Tracked on the document from pointerdown (Fable A2). Moving the row in
  // the DOM releases pointer capture on the handle (capture clears when its
  // element is removed), so pointerup never reached the handle and a reorder
  // was never committed. The row itself moves under the finger; the order is
  // written once, on release.
  root.querySelectorAll('[data-drag]').forEach((h) => {
    h.addEventListener('pointerdown', (e) => {
      if (dragging) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = h.closest('[data-row]');
      startY = e.clientY;
      dragging.classList.add('dragging');
      const pointer = e.pointerId;

      const move = (ev) => {
        if (!dragging || ev.pointerId !== pointer) return;
        ev.preventDefault();
        const over = rowUnder(ev.clientX, ev.clientY);
        if (over && over !== dragging) {
          const r = over.getBoundingClientRect();
          const after = ev.clientY > r.top + r.height / 2;
          const ref = after ? over.nextSibling : over;
          if (ref !== dragging && ref !== dragging.nextSibling) over.parentNode.insertBefore(dragging, ref);
        } else if (!over) {
          // Not over a row, maybe over an empty group's list.
          const zone = zoneUnder(ev.clientX, ev.clientY);
          if (zone && !zone.contains(dragging)) zone.appendChild(dragging);
        }
      };
      const finish = (ev) => {
        if (!dragging || ev.pointerId !== pointer) return;
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', finish, true);
        document.removeEventListener('pointercancel', finish, true);
        dragging.classList.remove('dragging');
        dragging = null;
        // Commit the DOM order back to the document, in one mutation.
        update((d) => {
          let order = 0;
          root.querySelectorAll('[data-dropzone]').forEach((zone) => {
            const when = zone.dataset.dropzone;
            zone.querySelectorAll('[data-row]').forEach((el) => {
              const row = (d.supplements || []).find((x) => x.id === el.dataset.row);
              if (!row) return;
              row.order = order++;
              row.when = when;
            });
          });
        });
        rerender();
      };
      document.addEventListener('pointermove', move, { capture: true, passive: false });
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', finish, true);
    });
  });
}

let prnTimer = null;
let prnVisHandler = null;

/**
 * Advance the countdowns in place.
 *
 * Deliberately frugal: it runs ONLY while the page is visible and only while
 * something is actually counting down, and it stops itself once everything is
 * clear. A timer ticking behind a closed Safari costs battery and buys nothing,
 * and a full re-render every second would fight anything being typed. It also
 * touches no network, every value here is computed from data already on the
 * device.
 */
function startPrnTicker(root) {
  stopPrnTicker();

  const waiting = () => (state.data.prnMeds || []).some((m) => {
    const st = prnStatus(m);
    return st.last && !st.clear;
  });

  const tick = () => {
    const rows = root.querySelectorAll('[data-prn-row]');
    if (!rows.length) return stopPrnTicker();
    rows.forEach((el) => {
      const med = (state.data.prnMeds || []).find((m) => m.id === el.dataset.prnRow);
      if (!med) return;
      const st = prnStatus(med);
      const fill = el.querySelector('.prnfill');
      const status = el.querySelector('[data-prn-status]');
      const pct = (!st.last || st.clear) ? 0
        : Math.max(0, Math.min(100, 100 - (st.msLeft / ((Number(med.waitHours) || 1) * 3600e3)) * 100));
      if (fill) fill.style.setProperty('--p', (pct / 100).toFixed(3));
      el.classList.toggle('clear', st.clear || !st.last);
      el.classList.toggle('waiting', !!st.last && !st.clear);
      if (status) {
        status.innerHTML = (!st.last || st.clear)
          ? '<span class="pill good">clear</span>'
          : `<span class="pill warn">${humanLeft(st.msLeft)}</span>
             <span class="tiny muted">until ${hhmm(st.nextAt)}${
               localIso(st.nextAt) !== localIso(st.lastAt) ? '+1' : ''}</span>`;
      }
    });
    // Everything clear: nothing left to count, so stop until a dose is logged.
    if (!waiting()) stopPrnTicker();
  };

  const resume = () => {
    clearInterval(prnTimer);
    prnTimer = null;
    if (document.visibilityState !== 'visible' || !waiting()) return;
    tick();
    // A minute is plenty: the shortest thing shown is minutes remaining.
    prnTimer = setInterval(tick, 60000);
  };

  prnVisHandler = resume;
  document.addEventListener('visibilitychange', prnVisHandler);
  resume();
}

function stopPrnTicker() {
  clearInterval(prnTimer);
  prnTimer = null;
  if (prnVisHandler) {
    document.removeEventListener('visibilitychange', prnVisHandler);
    prnVisHandler = null;
  }
}

export function bindSupplements(root, ctx, rerender) {
  const iso = ctx.suppDate || currentDayIso();
  startPrnTicker(root);
  // Its own date, not the shared ctx.date: this is the one screen whose day
  // runs to 5am, and Today must stay on the real calendar date.
  bindDatePill(root, iso, (next) => { ctx.suppDate = next; rerender(); }, { today: currentDayIso() });

  if (ctx.suppEdit) bindDragReorder(root, rerender);

  bindSuppGroups(root, iso, ctx, rerender);

  root.querySelectorAll('[data-suppdel]').forEach((x) => x.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = x.dataset.suppdel;
    const s = (state.data.supplements || []).find((y) => y.id === id);
    if (!s) return;
    if (!confirm(`Remove "${s.name}" from ${fmtDate(iso)} onwards?\n\nEarlier days keep it exactly as they are.`)) return;
    update(() => {
      const row = state.data.supplements.find((y) => y.id === id);
      row.spans = normSpans(row).map((sp) => (sp.until ? sp : { ...sp, until: iso }));
    });
    rerender();
  }));

  root.querySelector('[data-supp-edit]')?.addEventListener('click', () => {
    ctx.suppEdit = !ctx.suppEdit;
    rerender();
  });
  root.querySelector('[data-supp-add]')?.addEventListener('click', () => addSupplementSheet(iso, rerender));
  root.querySelector('[data-prn-add]')?.addEventListener('click', () => addPrnSheet(iso, rerender));

  root.querySelectorAll('[data-prndel]').forEach((x) => x.addEventListener('click', () => {
    const id = x.dataset.prndel;
    const m = (state.data.prnMeds || []).find((y) => y.id === id);
    if (!m || !confirm(`Remove "${m.name}" from ${fmtDate(iso)} onwards?\n\nLogged doses stay in the history.`)) return;
    update(() => {
      const row = state.data.prnMeds.find((y) => y.id === id);
      row.spans = normSpans(row).map((sp) => (sp.until ? sp : { ...sp, until: iso }));
    });
    rerender();
  }));

  root.querySelectorAll('[data-prn-dose]').forEach((b) => b.addEventListener('click', () => {
    const med = (state.data.prnMeds || []).find((m) => m.id === b.dataset.prnDose);
    // The real calendar date, not the checklist's: a dose logged at 2am is
    // stamped with the clock's day, so the countdown measures from the moment
    // it actually happened.
    if (med) logDoseSheet(med, prnDateFor(iso), rerender);
  }));

  root.querySelectorAll('[data-dosedel]').forEach((c) => c.addEventListener('click', () => {
    if (!confirm('Remove this dose from the log?')) return;
    update((d) => { d.doses = (d.doses || []).filter((x) => x.id !== c.dataset.dosedel); });
    rerender();
  }));
}

// ---------------------------------------------------------------- sheets ---
function addSupplementSheet(iso, rerender) {
  openModal({
    title: 'Add a supplement',
    body: `
      <label class="fld">Name<input id="sa-name" placeholder="e.g. Vitamin D" autocomplete="off"></label>
      <label class="fld" style="margin-top:.6rem">When
        <select id="sa-when">${WHENS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      </label>
      <div class="tiny muted" style="margin-top:.6rem">
        Added from <strong>${esc(fmtDate(iso))}</strong> onwards. Earlier days are untouched.
      </div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Add</button>',
    onMount(m) {
      const save = () => {
        const name = m.querySelector('#sa-name').value.trim();
        if (!name) return;
        const when = m.querySelector('#sa-when').value;
        update((d) => {
          d.supplements = d.supplements || [];
          // Always a NEW row, even if the name already exists, the same
          // supplement is often taken morning AND evening, and merging them
          // made the second one silently move the first.
          const max = d.supplements.reduce((n, s) => Math.max(n, s.order ?? 0), -1);
          d.supplements.push({ id: uid(), name, when, order: max + 1, spans: [{ from: iso, until: null }] });
        });
        closeModal(); rerender();
      };
      m.querySelector('[data-save]').addEventListener('click', save);
      m.querySelector('#sa-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    },
  });
}

function addPrnSheet(iso, rerender) {
  openModal({
    title: 'Add an as-needed medication',
    body: `
      <label class="fld">Start from a common one
        <select id="pa-preset">
          <option value="">choose, or type your own below</option>
          ${PRN_PRESETS.map(([n, d, h], i) => `<option value="${i}">${esc(n)} ${esc(d)} · every ${h}h</option>`).join('')}
        </select>
      </label>
      <div class="grid2" style="margin-top:.6rem">
        <label class="fld">Name<input id="pa-name" placeholder="e.g. Naproxen" autocomplete="off"></label>
        <label class="fld">Usual dose<input id="pa-dose" placeholder="e.g. 500mg" autocomplete="off"></label>
      </div>
      <label class="fld" style="margin-top:.6rem;max-width:220px">Minimum hours between doses
        <input id="pa-wait" type="number" step="0.5" min="0" placeholder="e.g. 8">
      </label>
      <div class="tiny muted" style="margin-top:.6rem">
        The countdown runs from your last dose, so a wait that crosses midnight still
        reads correctly the next day.
      </div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Add</button>',
    onMount(m) {
      m.querySelector('#pa-preset').addEventListener('change', (e) => {
        const preset = PRN_PRESETS[Number(e.target.value)];
        if (!preset) return;
        m.querySelector('#pa-name').value = preset[0];
        m.querySelector('#pa-dose').value = preset[1];
        m.querySelector('#pa-wait').value = String(preset[2]);
      });
      m.querySelector('[data-save]').addEventListener('click', () => {
        const name = m.querySelector('#pa-name').value.trim();
        if (!name) return;
        update((d) => {
          d.prnMeds = d.prnMeds || [];
          const row = {
            id: uid(), name,
            dose: m.querySelector('#pa-dose').value.trim(),
            waitHours: Number(m.querySelector('#pa-wait').value) || 0,
            order: d.prnMeds.length,
            spans: [{ from: iso, until: null }],
          };
          d.prnMeds.push(row);
        });
        closeModal(); rerender();
      });
    },
  });
}

function logDoseSheet(med, iso, rerender) {
  const st = prnStatus(med);
  const now = new Date();
  openModal({
    title: `${med.name}: log a dose`,
    body: `
      ${!st.clear ? `<div class="callout warn small" style="margin-bottom:.7rem">
        <strong>${esc(humanLeft(st.msLeft))} early.</strong> Clear at ${esc(hhmm(st.nextAt))}.
        Logging it anyway is fine. Every dose belongs in the record.
      </div>` : ''}
      <div class="grid2">
        <label class="fld">Time<input id="pd-time" type="time" value="${esc(hhmm(now))}"></label>
        <label class="fld">Dose<input id="pd-dose" value="${esc(med.dose || '')}" autocomplete="off"></label>
      </div>
      <div class="tiny muted" style="margin-top:.6rem">Recorded on ${esc(fmtDate(iso))}.</div>`,
    footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Log it</button>',
    onMount(m) {
      m.querySelector('[data-save]').addEventListener('click', () => {
        const [hh, mm] = (m.querySelector('#pd-time').value || hhmm(now)).split(':').map(Number);
        const at = `${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
        update((d) => {
          d.doses = d.doses || [];
          d.doses.push({ id: uid(), medId: med.id, at, dose: m.querySelector('#pd-dose').value.trim() });
        });
        closeModal();
        const after = prnStatus(med);
        toast(after.clear
          ? `<b>${esc(med.name)} logged</b>`
          : `<b>${esc(med.name)} logged</b><br><span>next dose clear at ${esc(hhmm(after.nextAt))}</span>`);
        rerender();
      });
    },
  });
}
