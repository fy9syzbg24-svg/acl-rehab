// Supplements — what you take, and whether you took it today.
//
// Replaces the Notes-app checklist, which had to be unticked by hand every day
// and kept no history. Here the LIST and the DAILY TICKS are separate things:
//
//   state.data.supplements        the list itself — id, name, when, active
//   state.data.days[iso].supps    { [suppId]: true } for that day only
//
// So a new day starts clean automatically, and every past day stays on record.
// Both are registered in sync/records.js, so the list and the ticks travel
// between devices like everything else.

import { esc, todayIso, uid, addDays } from '../util.js';
import { state, update, ensureDay, getDay } from '../store.js';

// His current list, in the order he keeps it. Seeded once, then his to edit.
const DEFAULTS = [
  ['Ritalin XR', 'morning'],
  ['Creatine Morning', 'morning'],
  ['Fiber', 'morning'],
  ['Vitamin C', 'morning'],
  ['Multivitamin', 'morning'],
  ['Collagen', 'morning'],
  ['Prozac', 'morning'],
  ['Magnesium evening', 'evening'],
  ['Creatine Evening', 'evening'],
  ['Statin', 'evening'],
];

export function seedSupplements(d) {
  if (Array.isArray(d.supplements) && d.supplements.length) return false;
  d.supplements = DEFAULTS.map(([name, when], i) => ({
    id: uid(), name, when, order: i, active: true,
  }));
  return true;
}

const listOf = () => (state.data.supplements || [])
  .filter((s) => s.active !== false)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const tickedOn = (iso) => (getDay(iso)?.supps) || {};

/** How many of the current list were taken on a given day. */
export function suppScore(iso) {
  const list = listOf();
  if (!list.length) return null;
  const t = tickedOn(iso);
  return { taken: list.filter((s) => t[s.id]).length, total: list.length };
}

export function renderSupplements(ctx) {
  const iso = ctx.date || todayIso();
  const list = listOf();
  const ticks = tickedOn(iso);
  const isToday = iso === todayIso();
  const score = suppScore(iso);

  const group = (when) => {
    const rows = list.filter((s) => (s.when || 'morning') === when);
    if (!rows.length) return '';
    return `
      <div class="section-title" style="margin:.9rem 0 .45rem">${when === 'morning' ? 'Morning' : 'Evening'}</div>
      <div class="supplist">
        ${rows.map((s) => `
          <button class="supprow ${ticks[s.id] ? 'on' : ''}" data-supp="${esc(s.id)}">
            <i class="supptick">${ticks[s.id] ? '✓' : ''}</i>
            <span class="suppname">${esc(s.name)}</span>
            <span class="suppdel" data-suppdel="${esc(s.id)}" role="button" aria-label="Remove ${esc(s.name)}">✕</span>
          </button>`).join('')}
      </div>`;
  };

  return `
  <div class="stack">
    <section class="card">
      <header>
        <h2>Supplements</h2>
        <span class="sub">${esc(isToday ? 'today' : new Date(iso + 'T00:00').toDateString())}</span>
      </header>
      <div class="card-body">
        ${score ? `
          <div class="suppscore">
            <div class="bar ${score.taken === score.total ? 'good' : ''}">
              <i style="width:${score.total ? (score.taken / score.total) * 100 : 0}%"></i>
            </div>
            <span class="tiny mono">${score.taken}/${score.total}</span>
          </div>` : ''}

        ${list.length ? group('morning') + group('evening')
          : '<div class="tiny muted">No supplements yet — add one below.</div>'}

        <div class="row" style="margin-top:1rem;gap:.4rem">
          <label class="fld" style="flex:1;min-width:160px">Add a supplement
            <input id="supp-new" placeholder="e.g. Vitamin D" autocomplete="off">
          </label>
          <label class="fld" style="width:120px">When
            <select id="supp-when">
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
            </select>
          </label>
          <button class="btn primary" data-supp-add>Add</button>
        </div>
        <div class="tiny muted" style="margin-top:.4rem">
          Ticks are per day and reset themselves — yesterday stays on record.
        </div>
      </div>
    </section>

    ${historyCard(iso)}
  </div>`;
}

/** A fortnight of adherence, so the log is visible rather than just stored. */
function historyCard(iso) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(iso, -(13 - i)));
  const rows = days.map((d) => ({ d, s: suppScore(d) })).filter((r) => r.s);
  if (!rows.length) return '';
  const anyTaken = rows.some((r) => r.s.taken > 0);
  return `
  <section class="card">
    <header><h2>Last 14 days</h2><span class="sub">what you actually took</span></header>
    <div class="card-body">
      ${anyTaken ? `<div class="suppgrid">
        ${rows.map((r) => {
          const p = r.s.total ? r.s.taken / r.s.total : 0;
          const cls = p === 1 ? 'full' : p > 0 ? 'part' : '';
          return `<div class="suppday ${cls}" title="${esc(r.d)} — ${r.s.taken}/${r.s.total}">
            <span class="tiny">${esc(r.d.slice(8))}</span>
          </div>`;
        }).join('')}
      </div>` : '<div class="tiny muted">Nothing ticked yet.</div>'}
    </div>
  </section>`;
}

export function bindSupplements(root, ctx, rerender) {
  const iso = ctx.date || todayIso();

  root.querySelectorAll('[data-supp]').forEach((b) => b.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-suppdel]')) return;      // the ✕ handles itself
    const id = b.dataset.supp;
    update(() => {
      const day = ensureDay(iso);
      day.supps = { ...(day.supps || {}) };
      if (day.supps[id]) delete day.supps[id]; else day.supps[id] = true;
    });
    rerender();
  }));

  root.querySelectorAll('[data-suppdel]').forEach((x) => x.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const id = x.dataset.suppdel;
    const s = (state.data.supplements || []).find((y) => y.id === id);
    if (!s || !confirm(`Remove "${s.name}" from the list?\n\nPast days keep whatever you already ticked.`)) return;
    update((d) => {
      // Soft-delete: past days reference this id, and a tombstoned record would
      // make their history unreadable.
      const row = (d.supplements || []).find((y) => y.id === id);
      if (row) row.active = false;
    });
    rerender();
  }));

  root.querySelector('[data-supp-add]')?.addEventListener('click', () => {
    const input = root.querySelector('#supp-new');
    const name = input.value.trim();
    if (!name) return;
    const when = root.querySelector('#supp-when').value;
    update((d) => {
      d.supplements = d.supplements || [];
      const max = d.supplements.reduce((n, s) => Math.max(n, s.order ?? 0), -1);
      d.supplements.push({ id: uid(), name, when, order: max + 1, active: true });
    });
    input.value = '';
    rerender();
  });

  root.querySelector('#supp-new')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') root.querySelector('[data-supp-add]')?.click();
  });
}
