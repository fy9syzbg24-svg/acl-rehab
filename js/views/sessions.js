// Session history: every confirmed exercise, newest first, with what was
// actually done. 2026-09-14 ring design, audit item 17.
//
// Per set, per side, as recorded: "12 + 10", never sets multiplied by the
// best set. Work plus recovery is the player's own time; time away is kept
// separate, in the detail. The source says where a record came from (the
// player, a PhysiApp import, or "Recorded in app": a tick or typed numbers, which
// older records cannot tell apart, so neither is guessed; revision 3 F45). The detail opens
// the same record in the same editor Today uses; nothing here is a second
// editable copy.

import { parse } from '../morph.js';
import { growIn, foldAway } from '../fold.js';
import { esc, round, num, fmtDate, todayIso } from '../util.js';
import { state } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, BAND_BY_ID } from '../../data/program.js';
import { exerciseById, rowName } from '../components.js';
import { ptMark, bandMark } from '../ptmark.js';
import { fmtClock } from '../timing.js';
import { customChips, runName } from '../customworkout.js';

/** The document's days plus the Mac-only history days, for reading only. */
function withHistory(doc) {
  const hd = state.history?.days;
  if (!hd) return doc;
  const days = { ...doc.days };
  for (const [iso, d] of Object.entries(hd)) days[iso] = { ...(days[iso] || {}), entries: [...(days[iso]?.entries || []), ...d.entries] };
  return { ...doc, days };
}

const ITEM = Object.fromEntries(REHAB_PROGRAM.concat(GYM_PROGRAM).map((p) => [p.id, p]));

function sourceOf(rows) {
  if (rows.some((e) => e.timing?.runId)) return 'Player';
  if (rows.some((e) => e.via === 'custom')) return 'Custom workout timer';
  if (rows.some((e) => e.via === 'physiapp')) return 'PhysiApp';
  if (rows.some((e) => e.seeded)) return 'Clinical notes';
  return 'Recorded in app';
}

const PAGE = 50;

/** One row per exercise per day (per run, when the player ran it twice). */
export function collectSessions(doc) {
  const out = [];
  for (const iso of Object.keys(doc.days || {}).sort().reverse()) {
    const groups = new Map();
    for (const e of doc.days[iso].entries || []) {
      if (!e?.logged) continue;
      const k = e.runId ? `run:${e.runId}` : e.pid ? `pid:${e.pid}` : `ex:${e.ex}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const day = [];
    for (const [k, rows] of groups) {
      const e0 = rows[0];
      const item = e0.pid ? ITEM[e0.pid] : null;
      const name = e0.custom ? runName(e0) : rowName(e0, item?.title || exerciseById(e0.ex)?.name || e0.ex);
      const t = rows.find((e) => e.timing)?.timing || null;
      const order = { L: 0, R: 1, B: 2 };
      rows.sort((a, b) => (order[a.side || 'B'] - order[b.side || 'B']));
      const at = rows.map((e) => e.doneAt).filter(Boolean).sort().pop() || '';
      day.push({ id: `${iso}|${k}`, iso, at, pid: e0.pid || null, ex: e0.ex, entryId: e0.id, name, rows, timing: t, source: sourceOf(rows) });
    }
    // Within one date the order is fixed (F28): latest finish first, then by
    // name, then by id, so a repaint or a sort change never reshuffles a day.
    day.sort((a, b) => b.at.localeCompare(a.at) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    out.push(...day);
  }
  return out;
}

const sameAll = (xs) => xs.length && xs.every((x) => x === xs[0]);

/** What one side actually did, as recorded. */
export function workText(e) {
  // A custom workout reads as its rounds and times, never as "6 sets".
  if (e?.custom) return customChips(e).join(' · ') || 'done';
  const unit = e.loadUnit || state.data.settings.weightUnit;
  const bits = [];
  const bySet = Array.isArray(e.repsBySet) ? e.repsBySet.filter((x) => x != null) : [];
  const secs = Array.isArray(e.secsList) ? e.secsList.filter((x) => x != null) : [];
  if (bySet.length && !secs.length) bits.push(sameAll(bySet) ? `${bySet.length} × ${bySet[0]}` : `${bySet.join(' + ')} reps`);
  else if (secs.length) bits.push(sameAll(secs) ? `${secs.length} × ${secs[0]} sec` : `${secs.join(' + ')} sec`);
  else if (num(e.sets) && num(e.reps)) bits.push(`${e.sets} × ${e.reps}`);
  else if (num(e.reps)) bits.push(`${e.reps} reps`);
  else if (num(e.sets)) bits.push(`${e.sets} set${num(e.sets) === 1 ? '' : 's'}`);
  if (!secs.length && num(e.secs)) bits.push(`${round(num(e.secs), 1)} sec`);
  if (num(e.time)) bits.push(`${round(num(e.time), 1)} min`);
  if (num(e.load)) bits.push(`${round(num(e.load), 2)} ${unit}`);
  if (num(e.resistance)) bits.push(`level ${e.resistance}`);
  const b = e.band ? BAND_BY_ID[e.band] : null;
  if (b) bits.push(`${b.name} band`);
  if (e.partial) bits.push('partly');
  return bits.join(' · ') || 'done';
}

function sessionWork(s) {
  const sided = s.rows.some((e) => e.side === 'L' || e.side === 'R');
  if (!sided) return workText(s.rows[0]);
  return s.rows.map((e) => `${e.side === 'L' ? 'L' : e.side === 'R' ? 'R' : 'Both'} ${workText(e)}`).join(' / ');
}

function timeText(t) {
  if (!t) return '·';
  return fmtClock((t.activeSec || 0) + (t.restSec || 0));
}

function detail(s) {
  const t = s.timing;
  const d = new Date(s.iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const doneAt = s.rows.map((e) => e.doneAt).filter(Boolean).sort().pop();
  const effort = s.rows.find((e) => num(e.rpe) != null)?.rpe;
  const disc = s.rows.find((e) => num(e.discomfort) != null)?.discomfort;
  const notes = [...new Set(s.rows.map((e) => e.notes).filter(Boolean))];
  const line = (k, v) => (v == null || v === '' ? '' : `<div class="sd-line"><span>${esc(k)}</span><b>${v}</b></div>`);
  return `
    <h3>${esc(s.name)}</h3>
    <div class="sd-when">${esc(d)}${doneAt ? ` · ${esc(new Date(doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}` : ''}</div>
    <div class="sd-sides">${s.rows.map((e) => `<div class="sd-side">
      ${e.side === 'L' || e.side === 'R' ? `<small class="${e.side}">${e.side === 'L' ? 'Left' : 'Right'}</small>` : '<small>Both legs</small>'}
      <b>${esc(workText(e))}</b></div>`).join('')}</div>
    ${t ? line('Work', esc(fmtClock(t.activeSec || 0))) + line('Recovery', esc(fmtClock(t.restSec || 0)))
      + (t.awaySec ? line('Away, not counted', esc(fmtClock(t.awaySec))) : '')
      + (t.interruptions ? line('Paused', `${t.interruptions} time${t.interruptions === 1 ? '' : 's'}`) : '')
      + (t.inaccurate ? line('Timing', 'marked inaccurate') : '') : ''}
    ${line('Effort', effort != null ? esc(`${effort} of 10`) : null)}
    ${line('Discomfort', disc != null ? esc(`${disc} of 10`) : null)}
    ${line('Source', esc(s.source))}
    ${notes.length ? `<div class="sd-notes">${notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
    ${s.rows.some((e) => e.history) ? '' : `<button class="btn sd-edit" data-sess-edit="${esc(s.id)}">Correct this on Today</button>`}`;
}

/**
 * The table (or labelled rows on a narrow screen) and the selected record.
 * opts.limit shows only the newest few, with no filters and no panel.
 *
 * Revision 3: the filters are always drawn, so an empty result can be undone
 * where it happened (F04); Show more reaches every session, and the count
 * reads "Showing N of M" whatever the sort (F28); each row carries a stable
 * focus key, so choosing one keeps keyboard focus on it (F30).
 */
export function renderSessions(ctx, { limit = null } = {}) {
  const h = (ctx.hist ||= { sort: 'new', src: 'all', ex: 'all', sel: null, pages: 1 });
  const all = collectSessions(withHistory(state.data));
  let list = all;
  const exOptions = [...new Map(all.map((s) => [s.pid || `ex:${s.ex}`, s.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = !limit && (h.src !== 'all' || h.ex !== 'all');
  if (!limit) {
    if (h.src !== 'all') list = list.filter((s) => s.source === h.src);
    if (h.ex !== 'all') list = list.filter((s) => (s.pid || `ex:${s.ex}`) === h.ex);
    if (h.sort === 'old') list = list.slice().reverse();
    if (h.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name) || (a.iso < b.iso ? 1 : -1) || a.id.localeCompare(b.id));
  }
  const shown = limit ? list.slice(0, limit) : list.slice(0, PAGE * (h.pages || 1));
  if (limit && !shown.length) return '<div class="sess-empty">No sessions recorded yet</div>';
  const sel = limit ? null : (shown.find((s) => s.id === h.sel) || null);
  const row = (s) => `
    <tr class="sess-row ${sel?.id === s.id ? 'sel' : ''}" data-sess="${esc(s.id)}" data-focus-key="sess:${esc(s.id)}" tabindex="0"${sel?.id === s.id ? ' aria-current="true"' : ''}>
      <td class="sess-date"><span class="sess-k">Date</span><span class="sess-v">${esc(fmtDate(s.iso, 'short'))}${s.iso === todayIso() ? ' <span class="sess-today">today</span>' : ''}</span></td>
      <td class="sess-name"><span class="sess-k">Exercise</span><span class="sess-v">${esc(s.name)}${ptMark(s.rows[0])}${bandMark(s.rows.find((e) => e.band || e.bands || e.bandText), { planned: s.pid ? (state.data.program?.band?.[s.pid] ?? ITEM[s.pid]?.band ?? '') : '', usesBand: !!exerciseById(s.ex)?.usesBand })}</span></td>
      <td class="sess-work"><span class="sess-k">Actual work</span><span class="sess-v">${esc(sessionWork(s))}</span></td>
      <td class="sess-time ${s.timing ? '' : 'none'}"><span class="sess-k">Work + rest</span><span class="sess-v">${esc(timeText(s.timing))}</span></td>
      <td class="sess-src"><span class="sess-k">Source</span><span class="sess-v">${esc(s.source)}</span></td>
    </tr>
    ${sel?.id === s.id ? `<tr class="sess-inline"><td colspan="5"><div class="fold-body"><div class="fold-clip"><div class="sess-detail">${detail(s)}</div></div></div></td></tr>` : ''}`;
  const table = `<table class="sess-table">
      <thead><tr><th>Date</th><th>Exercise</th><th>Actual work</th><th>Work + rest</th><th>Source</th></tr></thead>
      <tbody>${shown.map(row).join('')}</tbody></table>`;
  if (limit) return `<div class="sess compact">${table}</div>`;
  const results = shown.length ? `${table}
      <div class="sess-more">
        <span class="sess-count">Showing ${shown.length} of ${list.length}</span>
        ${list.length > shown.length ? `<button class="btn sm" data-sess-more>Show ${Math.min(PAGE, list.length - shown.length)} more</button>` : ''}
      </div>`
    : `<div class="sess-empty" role="status">
        <b>${all.length ? 'No sessions match' : 'No sessions recorded yet'}</b>
        ${filtered ? '<button class="btn sm" data-sess-clear>Clear filters</button>' : ''}
      </div>`;
  return `
  <div class="sess">
    <div class="sess-tools">
      <label class="fld"><span class="fld-k">Sort</span><select data-hist="sort">
        <option value="new" ${h.sort === 'new' ? 'selected' : ''}>Newest first</option>
        <option value="old" ${h.sort === 'old' ? 'selected' : ''}>Oldest first</option>
        <option value="name" ${h.sort === 'name' ? 'selected' : ''}>Exercise name</option></select></label>
      <label class="fld"><span class="fld-k">Source</span><select data-hist="src">
        ${['all', 'Player', 'Custom workout timer', 'Recorded in app', 'PhysiApp', 'Clinical notes'].map((v) => `<option value="${v}" ${h.src === v ? 'selected' : ''}>${v === 'all' ? 'Every source' : v}</option>`).join('')}</select></label>
      <label class="fld wide"><span class="fld-k">Exercise</span><select data-hist="ex">
        <option value="all">Every exercise</option>
        ${exOptions.map(([k, n]) => `<option value="${esc(k)}" ${h.ex === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    </div>
    <div class="sess-split">
      <div class="sess-main">${results}</div>
      <aside class="sess-panel">${sel ? `<div class="sess-detail">${detail(sel)}</div>` : '<div class="sess-hint">Select a session to see every set.</div>'}</aside>
    </div>
  </div>`;
}

export function bindSessions(root, ctx, rerender, { onEdit } = {}) {
  const h = (ctx.hist ||= { sort: 'new', src: 'all', ex: 'all', sel: null, pages: 1 });
  root.querySelectorAll('[data-hist]').forEach((sel) => sel.addEventListener('change', () => {
    h[sel.dataset.hist] = sel.value;
    // A sort keeps the selection; a filter that hides it lets it go.
    if (sel.dataset.hist !== 'sort') h.pages = 1;
    rerender();
  }));
  root.querySelector('[data-sess-clear]')?.addEventListener('click', () => {
    h.src = 'all'; h.ex = 'all'; h.pages = 1;
    rerender();
    root.querySelector('[data-hist="src"]')?.focus({ preventScroll: true });
  });
  // Show more and a selection are patched into the table in place (Fable
  // B10): the rows already there keep their nodes and the page does not move.
  const fresh = () => parse(renderSessions(ctx)).firstElementChild;
  const bindMore = (btn) => btn?.addEventListener('click', () => {
    h.pages = (h.pages || 1) + 1;
    const sess = btn.closest('.sess');
    const next = sess && fresh();
    const body = sess?.querySelector('.sess-table tbody');
    const nextBody = next?.querySelector('.sess-table tbody');
    const more = sess?.querySelector('.sess-more');
    const nextMore = next?.querySelector('.sess-more');
    if (!body || !nextBody || !more || !nextMore) { rerender(); return; }
    const have = new Set([...body.querySelectorAll('[data-sess]')].map((tr) => tr.dataset.sess));
    const added = [...nextBody.children].filter((tr) => {
      const id = tr.dataset.sess || tr.previousElementSibling?.dataset.sess;
      return !have.has(id);
    });
    const firstNew = added.find((tr) => tr.dataset.sess);
    added.forEach((tr) => body.appendChild(tr));
    added.filter((tr) => tr.dataset.sess).forEach(bindRow);
    added.forEach((tr) => tr.querySelectorAll('[data-sess-edit]').forEach(bindEdit));
    more.replaceWith(nextMore);
    bindMore(nextMore.querySelector('[data-sess-more]'));
    firstNew?.focus({ preventScroll: true });
  });
  bindMore(root.querySelector('[data-sess-more]'));
  const pick = (id) => {
    h.sel = h.sel === id ? null : id;
    const sess = root.closest?.('.sess') || root.querySelector('.sess:not(.compact)') || document.querySelector('.sess:not(.compact)');
    const next = sess && fresh();
    const body = sess?.querySelector('.sess-table tbody');
    const panel = sess?.querySelector('.sess-panel');
    const nextPanel = next?.querySelector('.sess-panel');
    if (!body || !panel || !nextPanel) { rerender(); return; }
    body.querySelectorAll('.sess-inline:not(.sess-leaving)').forEach((tr) => {
      const fb = tr.querySelector('.fold-body');
      tr.classList.add('sess-leaving');
      foldAway(fb, 180, () => tr.remove());
    });
    body.querySelectorAll('[data-sess]').forEach((tr) => {
      const on = tr.dataset.sess === h.sel;
      tr.classList.toggle('sel', on);
      if (on) tr.setAttribute('aria-current', 'true'); else tr.removeAttribute('aria-current');
    });
    if (h.sel) {
      const liveRow = body.querySelector(`[data-sess="${CSS.escape(h.sel)}"]`);
      const inline = next.querySelector(`[data-sess="${CSS.escape(h.sel)}"]`)?.nextElementSibling;
      if (liveRow && inline?.classList.contains('sess-inline')) {
        liveRow.after(inline);
        inline.querySelectorAll('[data-sess-edit]').forEach(bindEdit);
        growIn(inline.querySelector('.fold-body'), 220);
      }
    }
    panel.replaceWith(nextPanel);
    nextPanel.querySelectorAll('[data-sess-edit]').forEach(bindEdit);
  };
  function bindRow(tr) {
    tr.addEventListener('click', () => pick(tr.dataset.sess));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(tr.dataset.sess); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const rows = [...tr.closest('tbody').querySelectorAll('[data-sess]')];
        const i = rows.indexOf(tr) + (e.key === 'ArrowDown' ? 1 : -1);
        rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
      }
    });
  }
  root.querySelectorAll('.sess:not(.compact) [data-sess]').forEach(bindRow);
  // A recent session on Overview opens History with it selected.
  root.querySelectorAll('.sess.compact [data-sess]').forEach((tr) => {
    const go = () => { h.sel = tr.dataset.sess; h.src = 'all'; h.ex = 'all'; ctx.gtab = 'history'; rerender(); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  function bindEdit(b) {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const s = collectSessions(state.data).find((x) => x.id === b.dataset.sessEdit);
      if (s && onEdit) onEdit(s);
    });
  }
  root.querySelectorAll('[data-sess-edit]').forEach(bindEdit);
}
