// Rehab Test v3 (2026-09-30): one small drawn glyph per exercise category, so a category is
// carried by shape and word first and colour second (design-pass/v3/DESIGN-LANGUAGE.md, Colour).
// Line icons on a 24 unit grid, stroke = currentColor, in the spirit of SF Symbols. No emoji.
// The global builder owns this file; others import catGlyph / catWord.

import { CATEGORIES } from '../data/measurements.js';

const P = {
  // a dumbbell
  strength: '<path d="M6.5 8v8M3.5 10v4M17.5 8v8M20.5 10v4M6.5 12h11"/>',
  // one foot on a line, arms out
  balance: '<circle cx="12" cy="4.6" r="1.8"/><path d="M12 7v7M5.5 9.5l6.5 1.5 6.5-1.5M12 14l-1.5 6M8 20.5h8"/>',
  // a heart with a pulse
  aerobic: '<path d="M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z"/><path d="M7.5 12h2.5l1.2-2 1.6 4 1.2-2h2.5"/>',
  // a figure landing a jump, with an arc
  impact: '<circle cx="14" cy="4.6" r="1.8"/><path d="M13 7.5l-2 5 3 2.5-1 5M11 12.5l-4 1M14.5 9l3 2"/><path d="M4 20.5h16"/>',
  // a running figure
  running: '<circle cx="15" cy="4.6" r="1.8"/><path d="M13.5 7.5l-2.5 4.5 3.5 2-1.5 5.5M11 12l-4 .5M14 9l3.5 2.5"/>',
  // a zig zag between cones
  agility: '<path d="M4 18l5-6 5 6 5-6"/><path d="M4 20.5h2M18 20.5h2M11 20.5h2"/>',
  // a figure with raised arm and a note
  dance: '<circle cx="10" cy="4.6" r="1.8"/><path d="M10 7v6l-2.5 7M10 13l3 7M10 9l-4-2.5M10 9l4.5-3"/><path d="M18 11v5.5"/><circle cx="16.8" cy="16.8" r="1.4"/>',
  // a star
  show: '<path d="M12 3.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  // a kneeling figure
  kneeling: '<circle cx="12" cy="4.6" r="1.8"/><path d="M12 7v6.5h4.5v6.5M12 13.5l-3.5 6.5M12 9.5l-3.5 2.5"/>',
  // a bending arc with arrows (range of motion)
  mobility: '<path d="M5 17a8 8 0 0 1 14 0"/><path d="M5 13.5V17h3.5M19 13.5V17h-3.5"/>',
  // a crescent moon
  recovery: '<path d="M18.5 14.5A7 7 0 0 1 9.5 5.5a7 7 0 1 0 9 9z"/>',
};

/** The category's glyph as inline SVG (currentColor). Unknown categories get a plain dot. */
export function catGlyph(cat, size = 16, extra = '') {
  const body = P[cat] || '<circle cx="12" cy="12" r="4"/>';
  return `<svg class="cat-glyph ${extra}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** The short word for a category (Strength, Balance ...), without the slash forms. */
export function catWord(cat) {
  const label = CATEGORIES[cat]?.label || '';
  return label.split(/\s*\/\s*|-specific/)[0].trim();
}

export const CAT_KEYS = Object.keys(P);
