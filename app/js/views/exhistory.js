// An exercise's own history, inside its open row on Today and My Program.
//
// Three different things, labeled so they never blur: the TARGET (the
// prescription), the LAST confirmed result, and the BEST load. Only
// confirmed rows count; an opened row or typed numbers do not. Loads are
// compared in kilograms whatever they were entered in, and a result with one
// figure for both legs is shown as that, never as a left and a right.
//
// Short by default: two or three lines, with recent sessions and notes behind
// a disclosure. Not a place to log; the row's own fields are that.

import { esc, num, round, fmtDateNum, toKg, fromKg } from '../util.js';
import { BAND_BY_ID } from '../../data/program.js';
import { prescriptionLine } from '../components.js';

/** Confirmed rows for an item before a date, grouped by date, newest first. */
export function historyFor(doc, item, beforeIso) {
  const byDate = new Map();
  for (const [date, day] of Object.entries(doc?.days || {})) {
    if (date >= beforeIso) continue;
    for (const e of day.entries || []) {
      if (!e?.logged) continue;
      if (e.pid !== item.id && !(e.pid == null && e.ex === item.ex)) continue;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(e);
    }
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, rows]) => ({ date, rows }));
}

function rowText(e, unit) {
  const bits = [];
  const bySet = Array.isArray(e.repsBySet) ? e.repsBySet.filter((x) => x != null) : [];
  if (bySet.length > 1 && bySet.some((x) => x !== bySet[0])) bits.push(`${bySet.join(' + ')} reps`);
  else if (e.sets && e.reps) bits.push(`${e.sets} × ${e.reps}`);
  else if (e.reps) bits.push(`${e.reps} reps`);
  const secs = num(e.secs) ?? num(e.hold);
  if (secs) bits.push(`${round(secs, 1)} s`);
  if (num(e.time)) bits.push(`${round(num(e.time), 1)} min`);
  if (num(e.load)) bits.push(`${round(num(e.load), 2)} ${e.loadUnit || unit}`);
  const b = e.band ? BAND_BY_ID[e.band] : null;
  if (b) bits.push(`${b.name} band`);
  if (e.partial) bits.push('partial');
  return bits.join(' · ') || 'done';
}

function sideLabel(e, item) {
  const s = e.side || 'B';
  if (s === 'L') return '<b class="sidetag L">L</b> ';
  if (s === 'R') return '<b class="sidetag R">R</b> ';
  return item.sides === 'each' ? '<span class="tiny muted">both legs, one figure:</span> ' : '';
}

/** Heaviest load per side, in kg, with the unit it was entered in for display. */
export function bestLoad(history, unit) {
  const best = {};
  for (const { date, rows } of history) {
    for (const e of rows) {
      const l = num(e.load);
      if (!l) continue;
      const kg = toKg(l, e.loadUnit || unit);
      const side = e.side || 'B';
      if (!best[side] || kg > best[side].kg) best[side] = { kg, date };
    }
  }
  return best;
}

export function renderHistory(doc, item, iso) {
  const unit = doc.settings?.weightUnit || 'kg';
  const hist = historyFor(doc, item, iso);
  const band = doc.program?.band?.[item.id] ?? item.band ?? '';
  const target = prescriptionLine(item, band);
  const last = hist[0];
  const best = bestLoad(hist, unit);
  const bestSides = Object.entries(best);

  const recent = hist.slice(0, 6);
  const notes = [];
  for (const { date, rows } of hist) {
    for (const e of rows) {
      if (e.notes && notes.length < 4) notes.push({ date, text: e.notes, via: e.via });
    }
  }

  return `<div class="exhist">
    ${target ? `<div class="exh-line"><span class="exh-k">Target</span><span class="exh-v">${target}</span></div>` : ''}
    <div class="exh-line"><span class="exh-k">Last</span><span class="exh-v">${last
      ? `${esc(fmtDateNum(last.date))} · ${last.rows.map((e) => `${sideLabel(e, item)}${esc(rowText(e, unit))}`).join(' · ')}${last.rows.some((e) => e.via === 'physiapp') ? '<span class="srcnote">PhysiApp</span>' : ''}`
      : '<span class="muted">nothing confirmed yet</span>'}</span></div>
    ${bestSides.length ? `<div class="exh-line"><span class="exh-k">Best load</span><span class="exh-v">${bestSides
      .map(([s, b]) => `${s === 'B' ? '' : `<b class="sidetag ${s}">${s}</b> `}${esc(String(round(fromKg(b.kg, unit), 1)))} ${esc(unit)} <span class="tiny muted">${esc(fmtDateNum(b.date))}</span>`)
      .join(' · ')}</span></div>` : ''}
    ${recent.length > 1 || notes.length ? `<details class="exh-more">
      <summary>Recent sessions${notes.length ? ' and notes' : ''}</summary>
      <ul class="exh-list">${recent.map(({ date, rows }) => `<li><span class="mono">${esc(fmtDateNum(date))}</span> ${rows.map((e) => `${sideLabel(e, item)}${esc(rowText(e, unit))}`).join(' · ')}</li>`).join('')}</ul>
      ${notes.length ? `<ul class="exh-list notes">${notes.map((n) => `<li><span class="mono">${esc(fmtDateNum(n.date))}</span> ${esc(n.text)}${n.via === 'physiapp' ? ' <span class="srcnote">PhysiApp</span>' : ''}</li>`).join('')}</ul>` : ''}
    </details>` : ''}
  </div>`;
}
