// The badge for work done at physical therapy: any row that names its clinic
// (`clinic`) shows that clinic's badge from the synced case file
// (`caseFile.clinics[id]`: name, logo as SVG text). That is a row entered from
// his clinical notes, or (his call, 2026-09-18) a row he logged himself that
// matches an exercise in the clinic's note for that day, which keeps his row
// as the one record and marks it instead of adding a copy. The logo is his
// data, never shipped in this public shell, and it is drawn through an <img>
// data URL so nothing in it can run. A row whose clinic has no badge shows
// nothing (his call, 2026-09-17: no mark on the Melbourne rows).

import { state } from './store.js';

export const PT_LABEL = 'Done at physical therapy';

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function ptMark(e) {
  if (!e?.clinic) return '';
  const c = state.data?.caseFile?.clinics?.[e.clinic];
  if (!c?.logo || !/^\s*<svg[\s>]/.test(c.logo)) return '';
  const label = escAttr(`${PT_LABEL}${c.name ? `, ${c.name}` : ''}`);
  return `<img class="pt-mark pt-logo" src="data:image/svg+xml,${encodeURIComponent(c.logo)}" alt="${label}" title="${label}">`;
}

// ---------------------------------------------------------------- bands ----
// A small band loop beside the name (and beside the clinic badge) on any row
// done with a resistance band, in the colour that was logged (his ask,
// 2026-09-18: "an icon like this... change the color to be the appropriate
// color that was logged. Do it for all of the exercises that use bands").
//
// A row names its band as `band` (a Theraband id in program.js), `bands` when
// more than one was used (one loop each), or `bandText` for a band whose colour
// was never recorded (a neutral loop, titled with what the note said). A
// program row not logged yet shows the band planned for it, if any.

import { BAND_BY_ID } from '../data/program.js';

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A hex colour mixed toward black (amt < 0) or white (amt > 0), for the band's
// shading. Computed here rather than with a CSS filter, which Safari does not
// apply to shapes inside an SVG.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(ch);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * One band, drawn like the real thing (his photo, 2026-09-18): a short wide loop
 * seen from above and in front. The front face is the band's colour, the thin
 * top edge a little lighter, and the inside of the far wall, seen through the
 * opening, darker. Geometry: the top rim is an ellipse (16, 7, 14 x 5), the
 * bottom rim the same 5 units lower, the opening an ellipse 1.2 units in; the
 * far wall's lower edge meets the opening at (5.85, 9.5) and (26.15, 9.5).
 */
function loop(colour, label) {
  return `<span class="band-mark${colour ? '' : ' unknown'}" role="img" aria-label="${escText(label)}" title="${escText(label)}">${bandSvg(colour)}</span>`;
}

/** The band drawing alone (for the picker's buttons, which carry their own name). */
export function bandSvg(colour) {
  const f = (c) => (colour ? `style="fill:${c}"` : '');
  return `<svg viewBox="0 0 32 20" aria-hidden="true">
    <path class="bm-wall" ${f(colour ? shade(colour, -0.38) : '')} d="M3.2 7A12.8 4.1 0 0 1 28.8 7A12.8 4.1 0 0 1 26.15 9.5A12.8 4.1 0 0 0 5.85 9.5A12.8 4.1 0 0 1 3.2 7Z"/>
    <path class="bm-front" ${f(colour || '')} d="M2 7A14 5 0 0 0 30 7L30 12A14 5 0 0 1 2 12Z"/>
    <path class="bm-rim" ${f(colour ? shade(colour, 0.22) : '')} fill-rule="evenodd" d="M2 7A14 5 0 1 0 30 7A14 5 0 1 0 2 7Z M3.2 7A12.8 4.1 0 1 0 28.8 7A12.8 4.1 0 1 0 3.2 7Z"/>
    <path class="bm-edge" d="M2 7A14 5 0 0 1 30 7L30 12A14 5 0 0 1 2 12Z M3.2 7A12.8 4.1 0 1 0 28.8 7A12.8 4.1 0 1 0 3.2 7Z"/>
  </svg>`;
}

/**
 * The band loops for a row: `{ band, bands, bandText }`. `planned` is the band
 * his program sets for the exercise, used when the row itself recorded none
 * (PhysiApp never sends a colour). `usesBand` draws a neutral loop when no
 * colour is known at all, so every banded exercise is marked, and says so.
 */
export function bandMark(e, { planned = '', usesBand = false } = {}) {
  const ids = e && Array.isArray(e.bands) && e.bands.length ? e.bands : e?.band ? [e.band] : planned ? [planned] : [];
  const known = ids.map((id) => BAND_BY_ID[id]).filter(Boolean);
  if (known.length) return known.map((b) => loop(b.swatch, `${b.name} band${!e?.band && !e?.bands && planned ? ', as planned' : ''}`)).join('');
  if (e?.bandText) return loop(null, String(e.bandText));
  if (usesBand) return loop(null, 'Band, colour not recorded');
  return '';
}

// ------------------------------------------------------------ the picker --
// Choosing a band by looking at it (his ask, 2026-09-18: "visually show all of
// the bands as opposed to having them just listed"). His bands, lightest to
// heaviest, in the order he gave: yellow, red, green, blue, black, silver, gold.
// Tan stays drawable for anything already logged with it, and appears here
// only when it is the current choice.
export const HIS_BANDS = ['yellow', 'red', 'green', 'blue', 'black', 'silver', 'gold'];

/**
 * A row of band buttons. `attr` names the data attribute each button carries
 * (its value is the band id, '' for None); `none` adds a No band button.
 */
export function bandPicker({ value = '', attr, key = '', none = true, label = 'Band colour' }) {
  const ids = HIS_BANDS.concat(value && !HIS_BANDS.includes(value) && BAND_BY_ID[value] ? [value] : []);
  const btn = (id, name, svg) => `<button type="button" class="bp${value === id ? ' on' : ''}" role="radio" aria-checked="${value === id}"
    ${attr}="${escText(id)}"${key ? ` data-bpkey="${escText(key)}"` : ''} title="${escText(name)}">${svg}<span>${escText(name)}</span></button>`;
  return `<div class="band-pick" role="radiogroup" aria-label="${escText(label)}">
    ${ids.map((id) => btn(id, BAND_BY_ID[id].name, `<span class="band-mark">${bandSvg(BAND_BY_ID[id].swatch)}</span>`)).join('')}
    ${none ? btn('', 'None', '<span class="band-mark unknown clear">' + bandSvg(null) + '</span>') : ''}
  </div>`;
}
