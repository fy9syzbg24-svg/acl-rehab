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
  // A whole circle cannot be one SVG arc: its two ends are the same point and
  // it draws nothing (audit L11, a one-item day). Draw it as two halves.
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI;
    return `${arc(cx, cy, r, a0, mid)} ${arc(cx, cy, r, mid, a0 + Math.PI * 2 - 1e-7).replace(/^M[^A]*/, '')}`;
  }
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
export function dayRing(planned, entries, { size = 88, stroke = 8, center = 'count', celebrate = false, label = 'planned', middle: customMiddle = '', closing = null, won = false, wonPlay = false } = {}) {
  const total = planned.length;
  const doneFlags = planned.map((p) => itemStatus(p, entries).state === 'done');
  const done = doneFlags.filter(Boolean).length;
  const complete = total > 0 && done >= total;
  const c = size / 2;
  const r = c - stroke / 2 - 5;
  const markR = r + stroke / 2 + 3;
  const TAU = Math.PI * 2;
  let segs = '';
  // Plan Complete (2026-09-15, his pick): the done segments draw in turn, then
  // the check, then the milestone badge lands. Each drawn segment gets its
  // order; the whole fill's length is published as --fill-end for what follows.
  let onIndex = 0;
  const fillStep = Math.round(Math.min(90, 1100 / Math.max(1, total)));
  const fill = () => (celebrate ? ` pathLength="1"` : '');
  const nth = () => (celebrate ? `;--i:${onIndex++}` : '');

  if (!total) {
    segs = `<circle class="dr-track" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke}"/>`;
  } else if (total <= DENSE) {
    const gap = total > 1 ? Math.min(0.12, 0.5 / total) : 0;
    const each = TAU / total;
    planned.forEach((p, i) => {
      const a0 = i * each + gap / 2;
      const a1 = (i + 1) * each - gap / 2;
      const col = CATEGORIES[catOf(p)]?.color || 'var(--ink-2)';
      if (celebrate && doneFlags[i]) segs += `<path class="dr-seg" d="${arc(c, c, r, a0, a1)}" stroke-width="${stroke}"/>`;
      // `closing`: the exercise just finished, drawn in by the day's finish
      // (celebrate.js constellation), so it carries a unit length to animate.
      const closes = closing != null && p.id === closing && doneFlags[i];
      segs += doneFlags[i]
        ? `<path class="dr-seg on${closes ? ' closing' : ''}" d="${arc(c, c, r, a0, a1)}" stroke-width="${stroke}"${closes && !celebrate ? ' pathLength="1"' : fill()} style="--seg:${col}${nth()}"/>`
        : `<path class="dr-seg" d="${arc(c, c, r, a0, a1)}" stroke-width="${stroke}" style="--seg:${col}"/>`;
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
        // The exercise just finished (the day finish's close beat) is its own
        // last slice of the category's fill, so only that slice draws in.
        const closes = closing != null && planned.some((p, i) => p.id === closing && doneFlags[i] && catOf(p) === k);
        if (closes && !celebrate) {
          const prev = a0 + (a1 - a0) * ((doneBy[k] - 1) / counts[k]);
          if (doneBy[k] > 1) segs += `<path class="dr-seg on" d="${arc(c, c, r, a0, Math.max(a0 + 0.001, prev))}" stroke-width="${stroke}" style="--seg:${col}"/>`;
          segs += `<path class="dr-seg on closing" d="${arc(c, c, r, prev, Math.max(prev + 0.001, f))}" stroke-width="${stroke}" pathLength="1" style="--seg:${col}"/>`;
        } else {
          segs += `<path class="dr-seg on" d="${arc(c, c, r, a0, Math.max(a0 + 0.001, f))}" stroke-width="${stroke}"${fill()} style="--seg:${col}${nth()}"/>`;
        }
      }
      segs += `<path class="dr-mark" d="${arc(c, c, markR, a0, a1)}" style="--seg:${col}"/>`;
      a += span;
    }
  }

  // A finished day on Today (his ask, 18 Sep: "a very visual representation of
  // accomplishment"): the app's gold starburst in miniature around the ring,
  // eightfold symmetric like celebrate.js's, a gold halo, and "done!".
  const showWon = won && complete;
  if (showWon) {
    const rIn = markR + 5;
    const long = rIn + stroke * 0.95;
    const short = rIn + (long - rIn) / ((1 + Math.sqrt(5)) / 2);
    let burst = '';
    for (let i = 0; i < 24; i++) {
      const a = (-90 + i * 15) * Math.PI / 180;
      const r2 = i % 3 === 0 ? long : short;
      burst += `<line x1="${(c + Math.cos(a) * rIn).toFixed(2)}" y1="${(c + Math.sin(a) * rIn).toFixed(2)}" x2="${(c + Math.cos(a) * r2).toFixed(2)}" y2="${(c + Math.sin(a) * r2).toFixed(2)}" stroke-width="${i % 3 === 0 ? 2.2 : 1.4}"/>`;
    }
    for (let i = 0; i < 8; i++) {
      const a = (22.5 + i * 45) * Math.PI / 180;
      const rr = (rIn + long) / 2 + 1;
      burst += `<circle cx="${(c + Math.cos(a) * rr).toFixed(2)}" cy="${(c + Math.sin(a) * rr).toFixed(2)}" r="1.9"/>`;
    }
    segs = `<circle class="dr-halo" cx="${c}" cy="${c}" r="${r}" stroke-width="${stroke + 6}"/>${segs}<g class="dr-burst${wonPlay ? ' play' : ''}" style="transform-origin:${c}px ${c}px">${burst}</g>`;
  }

  // 'custom' puts caller markup in the middle: the day finish draws "5 of 5"
  // and "Complete" inside the ring, as ChatGPT's storyboard does (2026-09-16).
  const middle = center === 'custom' ? `<span class="dr-custom">${customMiddle}</span>`
    : center === 'none' ? ''
    : complete && center === 'check'
      ? `<span class="dr-check ${celebrate ? 'play' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8"/></svg></span>`
      : `<span class="dr-count"><b class="${`${done}/${total}`.length > 4 ? 'long' : ''}">${done}/${total}</b><small>${esc(showWon ? `${label}!` : label)}</small></span>`;
  const fillEnd = celebrate ? 150 + Math.max(0, onIndex - 1) * fillStep + 420 : 0;
  const html = `<span class="dayring2 ${complete ? 'complete' : ''} ${celebrate ? 'celebrate' : ''} ${showWon ? `won${wonPlay ? ' play' : ''}` : ''}" style="--dr:${size}px${celebrate ? `;--fill-step:${fillStep}ms;--fill-end:${fillEnd}ms` : ''}"
    role="img" aria-label="${done} of ${total} ${label === 'done' ? '' : 'planned '}exercises done${complete ? ', plan complete' : ''}">
    <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">${segs}</svg>${middle}</span>`;
  return { html, done, total, complete, fillEnd };
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
