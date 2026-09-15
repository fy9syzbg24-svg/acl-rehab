// The day ring: planned exercises, filled in category colour as they are
// confirmed done. 2026-09-14 revision 3.
//
//   - one segment per planned item, in plan order, with a short outer mark in
//     its category colour; an unconfirmed segment stays a neutral track
//   - a dense plan (more than 12 items) draws one arc per category instead,
//     each as long as that category's share and filled by its confirmed share,
//     so nothing becomes an unreadable sliver; the denominator never changes
//   - the check and "Plan Complete!" only when the plan really is complete
//   - never more than 100%; supplements and the knee check-in are not in it

import { esc } from './util.js';
import { CATEGORIES } from '../data/measurements.js';
import { exerciseById } from './components.js';
import { itemStatus } from './logging.js';

const DENSE = 12;

function catOf(item) {
  return exerciseById(item.ex)?.cat || 'strength';
}

function arc(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

/**
 * SVG and centre for the ring. opts: { size, stroke, center: 'count' | 'check' | 'none', celebrate }
 * Returns { html, done, total, complete }.
 */
export function dayRing(planned, entries, { size = 88, stroke = 8, center = 'count', celebrate = false, label = 'planned' } = {}) {
  const total = planned.length;
  const doneFlags = planned.map((p) => itemStatus(p, entries).state === 'done');
  const done = doneFlags.filter(Boolean).length;
  const complete = total > 0 && done >= total;
  const c = size / 2;
  const r = c - stroke / 2 - 5;
  const markR = r + stroke / 2 + 3;
  const TAU = Math.PI * 2;
  let segs = '';

  if (!total) {
    segs = `<circle class="dr-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}"/>`;
  } else if (total <= DENSE) {
    const gap = total > 1 ? Math.min(0.12, 0.5 / total) : 0;
    const each = TAU / total;
    planned.forEach((p, i) => {
      const a0 = i * each + gap / 2;
      const a1 = (i + 1) * each - gap / 2;
      const col = CATEGORIES[catOf(p)]?.color || 'var(--ink-2)';
      segs += `<path class="dr-seg ${doneFlags[i] ? 'on' : ''}" d="${arc(c, c, r, a0, a1)}" stroke-width="${stroke}" style="--seg:${col}"/>`;
      const mid0 = (a0 + a1) / 2 - Math.min(0.09, (a1 - a0) / 3);
      const mid1 = (a0 + a1) / 2 + Math.min(0.09, (a1 - a0) / 3);
      segs += `<path class="dr-mark" d="${arc(c, c, markR, mid0, mid1)}" style="--seg:${col}"/>`;
    });
  } else {
    // One arc per category, in the order categories first appear in the plan.
    const order = [];
    const counts = {};
    const doneBy = {};
    planned.forEach((p, i) => {
      const k = catOf(p);
      if (!(k in counts)) { order.push(k); counts[k] = 0; doneBy[k] = 0; }
      counts[k]++;
      if (doneFlags[i]) doneBy[k]++;
    });
    const gap = order.length > 1 ? 0.1 : 0;
    let a = 0;
    for (const k of order) {
      const span = (counts[k] / total) * TAU;
      const a0 = a + gap / 2;
      const a1 = a + span - gap / 2;
      const col = CATEGORIES[k]?.color || 'var(--ink-2)';
      segs += `<path class="dr-seg" d="${arc(c, c, r, a0, a1)}" stroke-width="${stroke}" style="--seg:${col}"/>`;
      if (doneBy[k]) {
        const f = a0 + (a1 - a0) * (doneBy[k] / counts[k]);
        segs += `<path class="dr-seg on" d="${arc(c, c, r, a0, Math.max(a0 + 0.001, f))}" stroke-width="${stroke}" style="--seg:${col}"/>`;
      }
      segs += `<path class="dr-mark" d="${arc(c, c, markR, a0, a1)}" style="--seg:${col}"/>`;
      a += span;
    }
  }

  const middle = center === 'none' ? ''
    : complete && center === 'check'
      ? `<span class="dr-check ${celebrate ? 'play' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span>`
      : `<span class="dr-count"><b>${done}/${total}</b><small>${esc(label)}</small></span>`;
  const html = `<span class="dayring2 ${complete ? 'complete' : ''} ${celebrate ? 'celebrate' : ''}" style="--dr:${size}px"
    role="img" aria-label="${done} of ${total} planned exercises done${complete ? ', plan complete' : ''}">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">${segs}</svg>${middle}</span>`;
  return { html, done, total, complete };
}

/** The categories in a plan, for a small legend under a dense ring. */
export function ringLegend(planned) {
  const seen = [];
  for (const p of planned) { const k = catOf(p); if (!seen.includes(k)) seen.push(k); }
  if (seen.length < 2) return '';
  return `<span class="dr-legend">${seen.map((k) => `<span style="--seg:${CATEGORIES[k]?.color}">${esc(shortLabel(CATEGORIES[k]?.label || k))}</span>`).join('')}</span>`;
}

function shortLabel(label) {
  return label.replace(/ \/.*$/, '').replace(/-specific$/, '').replace(/ run-through$/, '');
}
