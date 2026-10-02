// Rehab Test round 3 (2026-09-30): "The Standing Figure", the lead of Progress > Legs.
//
// His words tonight: "Maybe we can work in the diagram of the leg. that you tap on the region
// to see more statistics", and of the legacy silhouette he sent: "i do like ... some version of
// this? be creative!". Plan 1C (research 10-round3-plan.md) and 10d part B3; A11 (the figure
// through time) from 11-features-to-build.md.
//
// What it is: the CC0 front figure he approved on 2026-09-16 (img/silhouette-front.svg, never
// modified; drawn here as a CSS mask so the page colours its lines, dark mode included), waist
// down, with each measured region filled like a glass toward that leg's reference.
//
// Rules this file keeps (his rules and the board's, standboard.js):
//   - Mirror view (research decision 1, default until he says): HIS left is on the image left,
//     blue, under a blue "L" capsule; his right on the image right, orange, under an "R". Same
//     order as every butterfly row below it.
//   - Same arithmetic as the board: fill height = result over the row's reference (his
//     clinician's goal, else the published typical, else the stronger leg), clipped at 130%,
//     so a goal sits at 77% of the region's height: a solid tick there for a clinician's goal
//     (only on the legs the goal names), dashed for a published typical, none leg to leg.
//   - The printed number is the truth and the biggest text; the fill only repeats it. No
//     percentage, no red, no hot to cool. Green only as the small check on a leg at its goal.
//   - Real anatomy, never boxes: the fills are clipped to the figure's own strokes (HOTS in
//     standboard.js, closed from the asset by a script). A region with nothing measured stays a
//     plain outline with no chip and no target.
//   - Words on solid ground: every word sits in the gutters or above and below the figure,
//     never on it. The number chips are the real tap targets (a hamstring strip is 14 pt wide).
//   - Fixed anatomical order, top to bottom. Nothing ranked, nothing advised.
//   - Motion: fills rise from the feet to the hips on arrival (40 ms a step, a spring,
//     transform only); Reduce Motion draws them full. Nothing loops.
//   - The date track (A11) only replays the SAME test the region shows now; a region whose test
//     did not exist yet goes to its plain outline. Release springs back to now. Nothing is saved.
//   - Nothing here writes his data.

import { esc, fmtDate } from '../util.js';
import { measurementsFor, latest } from '../store.js';
import { MEASURE_BY_ID } from '../../data/measurements.js';
import { LEVELS } from '../../data/norms.js';
import { meets } from '../clinicgoals.js';
import {
  REGION_BY_ID, boardRow, shownValue, HOTS, SIL_VIEW, CLIP, SHORT_UNIT, ageWords, goalsForStrip, openRegionSheet,
} from './standboard.js';
import { nfmt } from './pkit.js';
import { haptic } from '../native-bridge.js';

// Top to bottom: the order the figure is read in, and the order the region sheet swipes in.
export const BODY_ORDER = ['hips', 'quads', 'hamstrings', 'knee', 'calves', 'balance'];
// The arrival rises from the feet: a step per band, bottom first.
const RISE = { balance: 0, calves: 1, knee: 2, hamstrings: 3, quads: 3, hips: 4 };
// The figure's midline (the pelvis hotspot's own centre point).
const MID = 419.4;
const CHECK = '<svg class="fg-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';

const view = () => SIL_VIEW.split(' ').map(Number);
// Which look the figure uses (see fillsSvg). Per device; 'glass' is the 2026-09-30 night version.
const STYLES = ['level', 'tint', 'glow', 'rings', 'glass'];
let STYLE = (() => { try { const v = localStorage.getItem('rt.fig'); return STYLES.includes(v) ? v : 'level'; } catch { return 'level'; } })();
export function setFigureStyle(v) { if (STYLES.includes(v)) { STYLE = v; try { localStorage.setItem('rt.fig', v); } catch { /* per device */ } } }
const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('lite-motion'); } catch { return false; }
};

// ------------------------------------------------------------------ geometry --
let GEO = null;
function bboxOf(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0); const ys = n.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
/** Per region: its whole path, and per leg the shape (clip) and the box the fill rises in. */
function geo() {
  if (GEO) return GEO;
  GEO = {};
  for (const [id, h] of Object.entries(HOTS)) {
    const subs = h.d.trim().split(/(?=M )/).map((s) => s.trim()).filter(Boolean);
    const all = bboxOf(h.d);
    const legs = {};
    if (subs.length === 1) {
      // The pelvis is one shape across both legs: each half rises on its own side.
      legs.L = { d: h.d, ...all, x1: MID };
      legs.R = { d: h.d, ...all, x0: MID };
    } else {
      for (const d of subs) {
        const b = bboxOf(d);
        // Mirror view: the image left is HIS left.
        legs[(b.x0 + b.x1) / 2 < MID ? 'L' : 'R'] = { d, ...b };
      }
    }
    GEO[id] = { d: h.d, label: h.label, ...all, legs };
  }
  return GEO;
}

// ------------------------------------------------------------------ values --
/** The result of the row's OWN test for a leg, now or on/before a date. */
function legAt(row, leg, at) {
  if (!row) return null;
  const key = row.m.perLeg ? leg : null;
  if (!at) return row.m.perLeg ? row.legs[leg] || null : row.legs.B || null;
  const rows = measurementsFor(row.m.id, key).filter((r) => typeof r.value === 'number' && r.date <= at);
  return rows.length ? rows[rows.length - 1] : null;
}
// The row's unit as the board prints it ("lb", "°", "reps").
const unitOfRow = (row) => { const u = row.unit || ''; return u === 'deg' ? '°' : SHORT_UNIT[u] ?? u; };
const unitHtml = (u) => (u === '°' ? '°' : u ? `<i>${esc(u)}</i>` : '');
function numHtml(row, r) {
  if (!r) return '<em>not yet</em>';
  return `${esc(nfmt(shownValue(row.m, r.value), 1))}${unitHtml(unitOfRow(row))}`;
}
const legMet = (row, leg, r) => !!(r && row.kind === 'goal' && row.goalSides.includes(leg) && meets(row.goal, r.value));

/**
 * The reference in two words, for the right hand chip (the unit is the number's, just below).
 * A goal that names one leg is drawn only on that leg; the words and the sheet say which.
 */
function targetWords(row, { long = false } = {}) {
  const uu = unitOfRow(row);
  const u = !long ? '' : uu === '°' ? '°' : uu ? ` ${uu}` : '';
  if (row.kind === 'goal') {
    const side = row.goalSides.length === 1 ? (row.goalSides[0] === 'L' ? `, left${long ? ' leg' : ''}` : `, right${long ? ' leg' : ''}`) : '';
    return `Goal ${nfmt(shownValue(row.m, row.goal.value), 0)}${u}${side}`;
  }
  if (row.kind === 'ref' && row.typical) {
    const lv = row.typical.r.level;
    return `${lv === 'typical' ? 'Typical' : long ? (LEVELS[lv] || 'Reference') : 'Reference'} ${nfmt(shownValue(row.m, row.typical.value), 0)}${u}`;
  }
  return 'Leg to leg';
}

/** Rows with data, keyed by region id. */
function rowsNow() {
  const out = {};
  for (const id of [...BODY_ORDER, 'hops']) { const r = REGION_BY_ID[id] ? boardRow(REGION_BY_ID[id]) : null; if (r) out[id] = r; }
  return out;
}

/** The first name of whoever measured it ("Name"), from the record's own source line. */
const whoOf = (r) => (r?.src ? String(r.src).split(',')[0].trim() : '');

// ------------------------------------------------------------------ layers --
/**
 * The SVG of fills for a window of the figure. `only`: draw just that region's fills (the
 * sheet's crop). `prefix` keeps clip ids unique when the figure and a crop are both on screen.
 */
function fillsSvg(rows, { win = view(), only = null, prefix = 'fg', rise = false, leaders = null } = {}) {
  const G = geo();
  const clips = [];
  const groups = [];
  for (const id of BODY_ORDER) {
    const g = G[id];
    if (!g) continue;
    const row = rows[id];
    const show = row && (!only || only === id);
    const legs = ['L', 'R'].map((leg) => {
      const b = g.legs[leg];
      if (!b || !show) return '';
      const cid = `${prefix}-${id}-${leg}`;
      clips.push(`<clipPath id="${cid}"><path d="${b.d}"/></clipPath>`);
      const r = legAt(row, leg, null);
      const f = r ? row.frac(r.value) : null;
      const p = f == null ? 0 : f / CLIP;
      const h = b.y1 - b.y0;
      const tickKind = row.kind === 'goal' ? (row.goalSides.includes(leg) ? 'goal' : '') : row.kind === 'ref' ? 'ref' : '';
      const ty = b.y1 - h / CLIP;
      // 2026-09-30, his verdict on the rising fills: "still looks pretty bad". Three whole-region looks to pick
      // from (localStorage 'rt.fig'); each shows progress to his goal WITHOUT a hard band edge:
      //   tint   the region filled in its leg colour, stronger the closer to the goal (Hevy style one hue heat map)
      //   glow   a soft light from inside the region, brighter the closer to the goal
      //   rings  the figure neutral, a small progress ring on each region (Apple Fitness style)
      const q = f == null ? 0 : Math.max(0, Math.min(1, f));
      const met = legMet(row, leg, r) ? 'met' : '';
      const legCls = row.m.perLeg ? leg : 'B';
      if (STYLE === 'tint' || STYLE === 'level') return '';   // drawn once per leg below (legLayer)
      if (STYLE === 'glow') {
        return `<g clip-path="url(#${cid})">
          <rect class="fg-${STYLE} ${legCls} ${met}" data-fg-fill="${id}:${leg}" x="${b.x0.toFixed(1)}" y="${b.y0.toFixed(1)}" width="${(b.x1 - b.x0).toFixed(1)}" height="${h.toFixed(1)}" style="--q:${q.toFixed(3)};--d:${RISE[id] ?? 0}" ${STYLE === 'glow' && row.m.perLeg ? `fill="url(#${prefix}-r${leg})"` : ''}/>
          <rect class="fg-sheen" x="${b.x0.toFixed(1)}" y="${b.y0.toFixed(1)}" width="${(b.x1 - b.x0).toFixed(1)}" height="${h.toFixed(1)}" fill="url(#${prefix}-sheen)"/>
        </g>`;
      }
      if (STYLE === 'rings') {
        const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
        const rr = Math.max(4, Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.3);
        const C = 2 * Math.PI * rr;
        return `<g class="fg-ringset" style="--d:${RISE[id] ?? 0}">
          <circle class="fg-ring-track" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" stroke-width="${(rr * 0.34).toFixed(1)}"/>
          <circle class="fg-ring ${legCls} ${met}" data-fg-fill="${id}:${leg}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" stroke-width="${(rr * 0.34).toFixed(1)}"
            stroke-dasharray="${(C * q).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})"/>
        </g>`;
      }
      return `<g clip-path="url(#${cid})">
        <rect class="fg-fill ${row.m.perLeg ? leg : 'B'} ${legMet(row, leg, r) ? 'met' : ''}" ${row.m.perLeg ? `fill="url(#${prefix}-g${leg})"` : ''} data-fg-fill="${id}:${leg}" x="${b.x0.toFixed(1)}" y="${b.y0.toFixed(1)}" width="${(b.x1 - b.x0).toFixed(1)}" height="${h.toFixed(1)}"
          style="--p:${p.toFixed(4)};--d:${RISE[id] ?? 0}"/>
        ${tickKind ? `<line class="fg-tick ${tickKind}" x1="${b.x0.toFixed(1)}" x2="${b.x1.toFixed(1)}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"/>` : ''}
      </g>`;
    }).join('');
    groups.push(`<g class="fg-reg ${show ? 'has' : 'none'}" data-fg="${id}">
      ${show ? `<path class="fg-glass" d="${g.d}"/>` : ''}
      ${legs}
      <path class="fg-edge" d="${g.d}"/>
      ${show && !only ? `<path class="fg-hit" d="${g.d}" data-fg-open="${id}"/>` : ''}
    </g>`);
  }
  // TINT (his pick 2026-09-30, "a but i don't like the white sections deviding each body part"): each leg is ONE
  // shape (every region of that leg plus small bridges over the seams between them) filled with one vertical
  // gradient whose stops sit at each region's middle, at that region's strength. Neighbouring regions blend into each
  // other, so no band edge and no white seam; the inner thigh (hamstrings) is laid over the quads with soft sides.
  // LEVEL (2026-09-30, his next note: "now it looks like every single section is equally far along ... I can really
  // get a visual of where every section is progress-wise"): the same seamless leg, but pale; each region then fills
  // from its bottom up to its share of his goal (full = goal met), the top fifth of each fill fading so no edge is hard.
  // Region heights differ, so how far along each one is reads at a glance. TINT keeps the strength version, with the
  // strength stretched over 60 to 100 percent of the goal so the differences show.
  let legLayer = '';
  if (STYLE === 'tint' || STYLE === 'level') {
    const tone = (id, leg) => {
      const row = rows[id];
      if (!row || (only && only !== id)) return { q: 0, has: false };
      const r = legAt(row, leg, null);
      const f = r ? row.frac(r.value) : null;
      return { q: f == null ? 0 : Math.max(0, Math.min(1, f)), has: !!r, perLeg: row.m.perLeg };
    };
    const op = STYLE === 'level' ? () => '0.2' : (q) => (0.1 + 0.85 * Math.max(0, Math.min(1, (q - 0.6) / 0.4))).toFixed(3);
    const [VX, VY, VW, VH] = view();
    const box = (id, leg) => G[id]?.legs[leg];
    const thigh = (leg) => {
      const a = box('quads', leg); const b = box('hamstrings', leg);
      if (!a && !b) return null;
      const bs = [a, b].filter(Boolean);
      return { x0: Math.min(...bs.map((v) => v.x0)), x1: Math.max(...bs.map((v) => v.x1)), y0: Math.min(...bs.map((v) => v.y0)), y1: Math.max(...bs.map((v) => v.y1)) };
    };
    const qs = [];
    for (const id of BODY_ORDER) for (const leg of ['L', 'R']) { const t = tone(id, leg); if (t.has) qs.push(t.q); }
    const FLOOR = qs.length ? Math.max(0, Math.min(0.9, Math.min(...qs) * 0.7)) : 0;
    const legs2 = ['L', 'R'].map((leg) => {
      const bands = [['hips', box('hips', leg)], ['quads', thigh(leg)], ['knee', box('knee', leg)], ['calves', box('calves', leg)], ['balance', box('balance', leg)]].filter(([, b]) => b);
      const paths = ['hips', 'quads', 'hamstrings', 'knee', 'calves', 'balance'].map((id) => box(id, leg)?.d).filter(Boolean);
      const bridges = [];
      for (let i = 0; i + 1 < bands.length; i += 1) {
        const up = bands[i][1]; const dn = bands[i + 1][1];
        // Joints are narrower than the regions' boxes: bridge only the middle 56 percent, so nothing pokes out.
        const bx0 = Math.max(up.x0, dn.x0); const bx1 = Math.min(up.x1, dn.x1); const inset = (bx1 - bx0) * 0.22;
        const x0 = bx0 + inset; const x1 = bx1 - inset;
        if (x1 > x0) bridges.push(`<rect x="${x0.toFixed(1)}" y="${(up.y1 - 7).toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(dn.y0 - up.y1 + 14).toFixed(1)}"/>`);
        // And a thin seam cover across nearly the full width, for the slivers at the outline.
        const ti = { hips: 0.02, quads: 0.12, knee: 0.12, calves: 0.3 }[bands[i][0]] ?? 0.12;   // measured per joint: the ankle narrows most
        const tx0 = bx0 + (bx1 - bx0) * ti; const tx1 = bx1 - (bx1 - bx0) * ti;
        const lift = bands[i][0] === 'hips' ? 9 : 2;   // the hip's lower edge slants up at the outside
        if (tx1 > tx0) bridges.push(`<rect x="${tx0.toFixed(1)}" y="${(Math.min(up.y1, dn.y0) - lift).toFixed(1)}" width="${(tx1 - tx0).toFixed(1)}" height="${(Math.abs(dn.y0 - up.y1) + lift + 2).toFixed(1)}"/>`);
      }
      // His ask 2026-09-30: "each section does need some sort of dividing area ... Maybe a faint dashed line ... so
      // that it doesn't get confused with the actual outlines". Light dashes (never the ink of the outline) across the
      // seam between regions, and down the thigh between quads and hamstrings; clipped inside the leg.
      const dash = (x1, y1, x2, y2) => `<line class="fg-div" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      const divs = [];
      for (let i = 0; i + 1 < bands.length; i += 1) {
        const up = bands[i][1]; const dn = bands[i + 1][1];
        const y = (up.y1 + dn.y0) / 2;
        const xa = leg === 'L' ? Math.min(up.x0, dn.x0) - 2 : (bands[i][0] === 'hips' ? MID : Math.min(up.x0, dn.x0) - 2);
        const xb = leg === 'L' ? (bands[i][0] === 'hips' ? MID : Math.max(up.x1, dn.x1) + 2) : Math.max(up.x1, dn.x1) + 2;
        divs.push(dash(xa, y, xb, y));
      }
      const qb = box('quads', leg); const hb2 = box('hamstrings', leg);
      if (qb && hb2) {
        const x = leg === 'L' ? (qb.x1 + hb2.x0) / 2 : (hb2.x1 + qb.x0) / 2;
        divs.push(dash(x, Math.min(qb.y0, hb2.y0) + 1, x, Math.max(qb.y1, hb2.y1) - 1));
      }
      const dividers = divs.join('');
      const cid = `${prefix}-leg${leg}`;
      clips.push(`<clipPath id="${cid}">${paths.map((d) => `<path d="${d}"/>`).join('')}${bridges.join('')}</clipPath>`);
      const colour = leg === 'L' ? '--left-fill' : '--right-fill';
      const stops = bands.map(([id, b]) => {
        // The thigh holds two regions side by side: its colour is the mean of quads and hamstrings (the chips print both).
        const t = id === 'quads' ? { q: (tone('quads', leg).q + tone('hamstrings', leg).q) / 2 } : tone(id, leg);
        const off = Math.max(0, Math.min(1, ((b.y0 + b.y1) / 2 - VY) / VH));
        return `<stop offset="${off.toFixed(4)}" data-fg-fill="${id}:${leg}" style="stop-color:var(${colour});stop-opacity:${op(t.q)}"/>`;
      }).join('');
      const gid = `${prefix}-tint${leg}`;
      const lx0 = leg === 'L' ? VX : MID; const lx1 = leg === 'L' ? MID : VX + VW;
      // LEVEL: one fill per region of this leg, its height the share of the goal reached, on a scale that fits his
      // numbers the way his chart rule does (RUBRIC section 10: the floor 30 percent under the lowest value in view, the
      // top at the goal), so 84 and 95 percent no longer look the same. The part still to go is hatched; a met goal is
      // full with a gold rim (gold = finished).
      const levels = STYLE !== 'level' ? '' : ['hips', 'quads', 'hamstrings', 'knee', 'calves', 'balance'].map((id) => {
        const b = box(id, leg);
        const t = tone(id, leg);
        if (!b || !t.has) return '';
        const h = b.y1 - b.y0;
        const k = t.q >= 1 ? 1 : Math.max(0.05, Math.min(1, (t.q - FLOOR) / (1 - FLOOR)));
        const fh = h * k;
        const rid = `${prefix}-lv-${id}-${leg}`;
        clips.push(`<clipPath id="${rid}"><path d="${b.d}"/></clipPath><clipPath id="${rid}-half"><rect x="${(leg === 'L' ? VX : MID).toFixed(1)}" y="${VY}" width="${(leg === 'L' ? MID - VX : VX + VW - MID).toFixed(1)}" height="${VH}"/></clipPath>`);
        const lx = leg === 'L' ? VX : MID; const lw = leg === 'L' ? MID - VX : VX + VW - MID;
        return `<g clip-path="url(#${rid})">
          ${fh < h ? `<rect class="fg-togo" x="${lx.toFixed(1)}" y="${b.y0.toFixed(1)}" width="${lw.toFixed(1)}" height="${(h - fh).toFixed(1)}" fill="url(#${prefix}-hatch${leg})"/>` : ''}
          <rect class="fg-level ${leg} ${t.q >= 1 ? 'met' : ''}" data-fg-fill="${id}:${leg}" x="${lx.toFixed(1)}" y="${(b.y1 - fh).toFixed(1)}" width="${lw.toFixed(1)}" height="${fh.toFixed(1)}" fill="url(#${prefix}-lvg${leg})" style="--q:${t.q.toFixed(3)}"/>
          ${t.q >= 1 ? `<g clip-path="url(#${rid}-half)"><path class="fg-metrim" d="${b.d}"/></g>` : ''}
        </g>`;
      }).join('');
      const hams = levels;
      return {
        defs: `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${VY}" x2="0" y2="${VY + VH}">${stops}</linearGradient>
          <pattern id="${prefix}-hatch${leg}" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="3" style="fill:var(${colour});fill-opacity:.12"/><line x1="0" y1="0" x2="0" y2="3" style="stroke:var(${colour});stroke-opacity:.55;stroke-width:.9"/></pattern>
          <linearGradient id="${prefix}-lvg${leg}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(${colour});stop-opacity:.35"/><stop offset=".14" style="stop-color:var(${colour});stop-opacity:.95"/><stop offset="1" style="stop-color:var(${colour});stop-opacity:1"/></linearGradient>
          <linearGradient id="${prefix}-soft${leg}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(${colour});stop-opacity:0"/><stop offset=".35" style="stop-color:var(${colour});stop-opacity:1"/><stop offset=".65" style="stop-color:var(${colour});stop-opacity:1"/><stop offset="1" style="stop-color:var(${colour});stop-opacity:0"/></linearGradient>`,
        body: `<g class="fg-legtint" clip-path="url(#${cid})">
          <rect x="${lx0.toFixed(1)}" y="${VY}" width="${(lx1 - lx0).toFixed(1)}" height="${VH}" fill="url(#${gid})"/>
          <rect class="fg-sheen" x="${lx0.toFixed(1)}" y="${VY}" width="${(lx1 - lx0).toFixed(1)}" height="${VH}" fill="url(#${prefix}-sheen)"/>
          ${STYLE === 'level' ? '' : dividers}
        </g>${hams}${STYLE === 'level' ? `<g clip-path="url(#${cid})">${dividers}</g>` : ''}`,
      };
    });
    legLayer = legs2.map((l) => l.body).join('');
    clips.push(legs2.map((l) => l.defs).join(''));
  }
  // Each leg's liquid is a little lighter at its surface, like a glass seen from the side.
  // His ask 2026-09-30: "the sections look a little choppy at the top of each bar ... gradient into transparent for
  // the final 20% of each bar". Per bar (objectBoundingBox), the top fifth fades to nothing, so the colour melts into
  // the grey instead of cutting off.
  const grad = (leg, v) => `<linearGradient id="${prefix}-g${leg}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(${v});stop-opacity:0"/><stop offset=".2" style="stop-color:var(${v});stop-opacity:.9"/><stop offset="1" style="stop-color:var(${v});stop-opacity:.95"/></linearGradient>`;
  const rad = (leg, v) => `<radialGradient id="${prefix}-r${leg}" cx=".5" cy=".45" r=".65"><stop offset="0" style="stop-color:var(${v});stop-opacity:1"/><stop offset=".6" style="stop-color:var(${v});stop-opacity:.55"/><stop offset="1" style="stop-color:var(${v});stop-opacity:0"/></radialGradient>`;
  const sheen = `<linearGradient id="${prefix}-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  return `<svg class="fg-svg fg-style-${STYLE} ${rise ? 'rise' : ''}" viewBox="${win.join(' ')}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>${grad('L', '--left-fill')}${grad('R', '--right-fill')}${rad('L', '--left-fill')}${rad('R', '--right-fill')}${sheen}${clips.join('')}</defs>${legLayer}${groups.join('')}${leaders || ''}</svg>`;
}

/** The line art as a mask over a window of the asset, coloured by the page (ink, either theme). */
function artLayer(win = view()) {
  const [x, y, w, h] = win;
  const [X, Y, W, H] = view();
  const px = W - w > 0.01 ? ((x - X) / (W - w)) * 100 : 0;
  const py = H - h > 0.01 ? ((y - Y) / (H - h)) * 100 : 0;
  return `<div class="fg-art" aria-hidden="true" style="--ms:${((W / w) * 100).toFixed(2)}% ${((H / h) * 100).toFixed(2)}%;--mp:${px.toFixed(2)}% ${py.toFixed(2)}%"></div>`;
}

/**
 * One region cut from the figure, both legs, for the top of its sheet (the crop the tap
 * morphs into). Returns '' for a region the figure does not draw (function, hops).
 */
export function figCrop(id) {
  const g = geo()[id];
  const row = g && REGION_BY_ID[id] ? boardRow(REGION_BY_ID[id]) : null;
  if (!g || !row) return '';
  const pad = 5;
  const win = [g.x0 - pad, g.y0 - pad, g.x1 - g.x0 + pad * 2, g.y1 - g.y0 + pad * 2];
  // The crop box is 86 pt tall and at most 150 wide (rt-progress.css .fg-crop). A window wider
  // than that (Balance, 110 by 45) was squeezed by max-width: the fills kept their shape
  // (the SVG meets) while the art mask stretched to the box, so the toes floated above the
  // foot (r3 audit PSP-03). Taller windows keep the box at the window's own shape, so
  // both layers draw the same window at the same scale.
  const MAX_AR = 150 / 86;
  if (win[2] / win[3] > MAX_AR) { const h = win[2] / MAX_AR; win[1] -= (h - win[3]) / 2; win[3] = h; }
  return `<span class="fg-crop" style="--ar:${(win[2] / win[3]).toFixed(4)}" aria-hidden="true">
    ${fillsSvg({ [id]: row }, { win, only: id, prefix: `fgx${id}` })}${artLayer(win)}</span>`;
}

// ------------------------------------------------------------------ chips --
function chipCentres(rows) {
  const G = geo();
  const [, Y, , H] = view();
  const both = rows.quads && rows.hamstrings;
  const list = BODY_ORDER.filter((id) => rows[id] && G[id]).map((id) => {
    const b = G[id].legs.L || G[id];
    let cy = (b.y0 + b.y1) / 2;
    if (both && id === 'quads') cy = b.y0 + (b.y1 - b.y0) * 0.26;
    if (both && id === 'hamstrings') cy = b.y0 + (b.y1 - b.y0) * 0.8;
    return { id, cy };
  });
  // A chip is drawn 42 pt; centres 35 units apart (46 pt at the phone's 1.32 scale) leave a gap of about 4 pt, so no
  // hit area reaches into its neighbour's (round 3 leftovers, PSP-14; it was 31 units, 2 to 3 pt gaps).
  const GAP = 35;
  for (let i = 1; i < list.length; i++) if (list[i].cy - list[i - 1].cy < GAP) list[i].cy = list[i - 1].cy + GAP;
  const over = list.length ? list[list.length - 1].cy - (Y + H - 14) : 0;
  if (over > 0) for (let i = list.length - 1; i >= 0; i--) { list[i].cy -= over; if (i && list[i].cy - list[i - 1].cy >= GAP) break; }
  return list.map((c) => ({ ...c, pct: ((c.cy - Y) / H) * 100 }));
}

function leaderLines(rows, centres) {
  const G = geo();
  const [X, , W] = view();
  return centres.map(({ id, cy }) => ['L', 'R'].map((leg) => {
    const b = G[id].legs[leg];
    if (!b) return '';
    // Where the region's own edge is at that height: sample its outline points.
    const pts = (b.d.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/g) || []).map((s) => s.split(/\s+/).map(Number));
    const near = pts.filter(([, y]) => Math.abs(y - cy) < 4).map(([x]) => x);
    let x = leg === 'L' ? (near.length ? Math.min(...near) : b.x0) : (near.length ? Math.max(...near) : b.x1);
    if (id === 'hips') x = leg === 'L' ? b.x0 : b.x1;
    const y = Math.max(b.y0 + 2, Math.min(b.y1 - 2, cy));
    const from = leg === 'L' ? X : X + W;
    return `<path class="fg-lead" d="M ${from.toFixed(1)} ${cy.toFixed(1)} L ${(x + (leg === 'L' ? -2 : 2)).toFixed(1)} ${y.toFixed(1)}"/><circle class="fg-leaddot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.3"/>`;
  }).join('')).join('');
}

/**
 * The right chip's small line (r3 audit PSP-08): the target only when it applies to the
 * right leg (a goal that names it, or a published reference); otherwise the region's name,
 * so each pair reads as one row and a left leg's goal never sits over the right leg's value.
 * The goal's own leg is not repeated here: this chip is the right leg's.
 */
function rightLabel(row, name) {
  if (row.kind === 'goal') return row.goalSides.includes('R') ? `Goal ${nfmt(shownValue(row.m, row.goal.value), 0)}` : name;
  if (row.kind === 'ref' && row.typical) return targetWords(row);
  return name;
}

function chip(row, id, leg, pct) {
  const r = legAt(row, leg, null);
  const name = REGION_BY_ID[id]?.label || id;
  const say = `${name}. Left ${row.legs.L ? nfmt(shownValue(row.m, row.legs.L.value)) : 'not tested'}, right ${row.legs.R ? nfmt(shownValue(row.m, row.legs.R.value)) : 'not tested'} ${row.unit}. ${targetWords(row)}. Opens details`;
  return `<button type="button" class="fg-tag ${leg} ${legMet(row, leg, r) ? 'met' : ''}" data-fg-open="${id}" data-fg-chip="${id}" style="--y:${pct.toFixed(2)}"
      ${leg === 'R' ? 'tabindex="-1" aria-hidden="true"' : `aria-label="${esc(say)}"`}>
    <small>${esc(leg === 'L' ? name : rightLabel(row, name))}</small>
    <b data-fg-num="${id}:${leg}">${legMet(row, leg, r) ? CHECK : ''}<span>${numHtml(row, r)}</span></b>
  </button>`;
}

// ------------------------------------------------------------------ function and track --
function lefsAt(at) {
  const rows = measurementsFor('lefs', null).filter((r) => typeof r.value === 'number' && (!at || r.date <= at));
  return rows.length ? rows[rows.length - 1] : null;
}
function functionBar() {
  if (!MEASURE_BY_ID.lefs) return '';
  const r = lefsAt(null);
  if (!r) return '';
  const goals = goalsForStrip().slice().sort((a, b) => a.value - b.value);
  const next = goals.find((g) => r.value < g.value);
  return `<button type="button" class="fg-fn" data-fg-open="function" aria-label="${esc(`Function, Lower Extremity Functional Scale: ${Math.round(r.value)} of 80${next ? `, ${next.stage === 'discharge' ? 'discharge' : 'goal'} ${next.value}` : ''}. Opens details`)}">
    <span class="fg-fnname">Function</span>
    <span class="fg-fnbar" aria-hidden="true"><i data-fg-fnfill style="--p:${(r.value / 80).toFixed(4)}"></i>${goals.map((g) => `<b class="fg-fntick" style="--at:${(g.value / 80).toFixed(4)}"></b>`).join('')}</span>
    <span class="fg-fnnum" data-fg-fnnum>${Math.round(r.value)}<small> of 80</small></span>
  </button>`;
}

/** Every date the figure can be replayed at: a date of a region's own test, or of LEFS. */
function trackDates(rows) {
  const set = new Set();
  for (const row of Object.values(rows)) {
    if (row.region.id === 'hops') continue;
    for (const leg of row.m.perLeg ? ['L', 'R'] : [null]) measurementsFor(row.m.id, leg).forEach((r) => { if (typeof r.value === 'number') set.add(r.date); });
  }
  measurementsFor('lefs', null).forEach((r) => { if (typeof r.value === 'number') set.add(r.date); });
  return [...set].sort();
}

function dateTrack(dates) {
  if (dates.length < 2) return '';
  const n = dates.length;
  return `<div class="fg-trackwrap">
    <div class="fg-track" data-fg-track tabindex="0" role="slider" aria-label="Test date" aria-valuemin="0" aria-valuemax="${n - 1}" aria-valuenow="${n - 1}" aria-valuetext="${esc(fmtDate(dates[n - 1], 'short'))}">
      <span class="fg-rail" aria-hidden="true"></span>
      ${dates.map((d, i) => `<i class="fg-dot" style="--x:${(i / (n - 1)).toFixed(4)}" aria-hidden="true"></i>`).join('')}
      <b class="fg-knob" aria-hidden="true" style="--x:1"></b>
    </div>
    <div class="fg-trackl" aria-hidden="true"><span>${esc(fmtDate(dates[0], 'short'))}</span><span>${esc(fmtDate(dates[n - 1], 'short'))}</span></div>
  </div>`;
}

function freshness(rows) {
  let best = null;
  for (const row of Object.values(rows)) for (const leg of ['L', 'R', 'B']) { const r = row.legs[leg]; if (r && (!best || r.date > best.date)) best = r; }
  const l = lefsAt(null);
  if (l && (!best || l.date > best.date)) best = l;
  if (!best) return '';
  const who = whoOf(best);
  return `Tested ${fmtDate(best.date, 'short')}${who ? `, ${who.split(' ')[0]}` : ''}`;
}

// ------------------------------------------------------------------ render --
let risingSince = 0;

export function renderFigure() {
  const rows = rowsNow();
  const drawn = BODY_ORDER.filter((id) => rows[id]);
  if (!drawn.length) return '';
  // Rise on arrival: when the page before had no figure (another tab), or its rise had only
  // just begun (the app paints Progress two or three times in its first 60 ms).
  const old = document.querySelector('#view .fg');
  const rise = !reduced() && (!old || (old.classList.contains('rising') && performance.now() - risingSince < 400));
  const centres = chipCentres(rows);
  const hops = rows.hops;
  return `<section class="fg ${rise ? 'rising' : ''}" aria-label="Where you stand, on the figure">
    ${functionBar()}
    <div class="fg-head">
      <span class="fg-cap L" aria-hidden="true">L</span>
      <div class="fg-read" data-fg-read aria-live="polite">${esc(freshness(rows))}</div>
      <span class="fg-cap R" aria-hidden="true">R</span>
    </div>
    <div class="fg-body">
      <div class="fg-gut L">
        ${centres.map((c) => chip(rows[c.id], c.id, 'L', c.pct)).join('')}
      </div>
      <div class="fg-fig" data-fg-fig>
        ${fillsSvg(rows, { rise, leaders: leaderLines(rows, centres) })}
        ${artLayer()}
      </div>
      <div class="fg-gut R">
        ${centres.map((c) => chip(rows[c.id], c.id, 'R', c.pct)).join('')}
      </div>
    </div>
    ${dateTrack(trackDates(rows))}
    ${hops ? `<button type="button" class="fg-hops" data-fg-open="hops"><span>Hops and jumps</span><b class="L">${numHtml(hops, hops.legs.L)}</b><b class="R">${numHtml(hops, hops.legs.R)}</b></button>` : ''}
  </section>`;
}

// ------------------------------------------------------------------ bind --
export function bindFigure(root, ctx, rerender, { panel = null } = {}) {
  const fg = root.querySelector('.fg');
  if (!fg) return;
  const rows = rowsNow();
  const read = fg.querySelector('[data-fg-read]');
  const restText = read ? read.textContent : '';

  if (fg.classList.contains('rising')) {
    risingSince = performance.now();
    const last = [...fg.querySelectorAll('.fg-fill')].pop();
    const done = () => fg.classList.remove('rising');
    last?.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1400);
  }

  // Tap: a chip, the region itself, Function or Hops opens the region's sheet, which rises like
  // every other sheet. It used to morph the region's crop out of the figure (a View Transition):
  // on his iPhone that flew a copy up over the figure that stayed drawn, with the sheet held back
  // until the copy landed, so he saw the legs twice (his report, 2026-10-02).
  const open = (id) => {
    if (!id) return;
    // The iPad: the panel beside the figure shows the region (no sheet, nothing morphs), and the
    // outline stays on it until another is picked (overview.js owns the panel).
    if (panel && panel.live()) { panel.pick(id); return; }
    focusRegion(fg, id);
    openRegionSheet(id, ctx, rerender, { order: sheetOrder(rows) });
  };
  fg.addEventListener('click', (e) => {
    if (peeking || suppressClick) { suppressClick = false; e.preventDefault(); return; }
    const t = e.target.closest('[data-fg-open]');
    if (t) open(t.dataset.fgOpen);
  });

  // A region's sheet names the region it is on (a swipe moves it): the outline follows.
  const onFocus = (e) => { if (!fg.isConnected) { window.removeEventListener('rt-fig-focus', onFocus); return; } focusRegion(fg, e.detail, !!(panel && panel.live())); };
  window.addEventListener('rt-fig-focus', onFocus);

  bindPeek(fg, rows, read, restText);
  bindTrack(fg, rows, read, restText);
}

function focusRegion(fg, id, sticky = false) {
  fg.querySelectorAll('.fg-reg').forEach((g) => g.classList.toggle('on', g.dataset.fg === id));
  fg.querySelectorAll('.fg-tag').forEach((c) => c.classList.toggle('on', c.dataset.fgChip === id));
  fg.querySelector('.fg-fn')?.classList.toggle('on', id === 'function');
  if (!id || sticky) return;   // beside the panel the outline simply stays on the picked region
  // Cleared again when the sheet closes.
  const mr = document.getElementById('modal-root');
  if (!mr) return;
  const mo = new MutationObserver(() => {
    if (mr.querySelector('.rs-sheet')) return;
    mo.disconnect();
    fg.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
  });
  mo.observe(mr, { childList: true, subtree: true });
}

/** The regions a sheet swipes through, top of the body to the feet. */
export function sheetOrder(rows = rowsNow()) {
  return [...(lefsAt(null) ? ['function'] : []), ...BODY_ORDER.filter((id) => rows[id]), ...(rows.hops ? ['hops'] : [])];
}

// Press and hold, then drag across the figure: the region under the finger is outlined, the
// line above the figure reads its numbers, a selection tick at each boundary. Release restores
// and nothing opens (his "I can kinda preview", 2026-09-03).
let peeking = false;
let suppressClick = false;
function peekLine(id, rows) {
  const row = rows[id];
  if (!row) return '';
  const L = row.legs.L; const R = row.legs.R;
  return `<b>${esc(REGION_BY_ID[id]?.label || id)}</b>${L ? `<span class="L">L ${numHtml(row, L)}</span>` : ''}${R ? `<span class="R">R ${numHtml(row, R)}</span>` : ''}<span>${esc(targetWords(row, { long: true }))}</span>`;
}
function bindPeek(fg, rows, read, restText) {
  const fig = fg.querySelector('[data-fg-fig]');
  if (!fig) return;
  let timer = 0; let x0 = 0; let y0 = 0; let cur = null;
  const at = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.('.fg-reg.has')?.dataset.fg || null;
  };
  const show = (id) => {
    if (id === cur) return;
    cur = id;
    fg.querySelectorAll('.fg-reg').forEach((g) => g.classList.toggle('peek', g.dataset.fg === id));
    fg.querySelectorAll('.fg-tag').forEach((c) => c.classList.toggle('peek', c.dataset.fgChip === id));
    if (read) { if (id) read.innerHTML = peekLine(id, rows); else read.textContent = restText; }
    fg.classList.toggle('peeking', !!id);
    if (id) haptic('selection');
  };
  const end = () => {
    clearTimeout(timer);
    if (!peeking) return;
    peeking = false;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 400);
    cur = undefined;
    show(null);
    fg.classList.remove('peeking');
  };
  fig.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    x0 = t.clientX; y0 = t.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => { peeking = true; cur = undefined; show(at(x0, y0)); }, 340);
  }, { passive: true });
  fig.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (!t) return;
    if (!peeking) { if (Math.hypot(t.clientX - x0, t.clientY - y0) > 8) clearTimeout(timer); return; }
    e.preventDefault();   // the page does not scroll while he peeks
    show(at(t.clientX, t.clientY));
  }, { passive: false });
  fig.addEventListener('touchend', end);
  fig.addEventListener('touchcancel', end);
  fig.addEventListener('contextmenu', (e) => e.preventDefault());
}

// A11: drag the date track and every region shows its own test as it stood then.
function bindTrack(fg, rows, read, restText) {
  const track = fg.querySelector('[data-fg-track]');
  if (!track) return;
  const dates = trackDates(rows);
  const n = dates.length;
  const knob = track.querySelector('.fg-knob');
  let idx = n - 1; let dragging = false;

  const paint = (i) => {
    const at = i >= n - 1 ? null : dates[i];
    for (const [id, row] of Object.entries(rows)) {
      for (const leg of ['L', 'R']) {
        const r = legAt(row, leg, at);
        const rect = fg.querySelector(`[data-fg-fill="${id}:${leg}"]`);
        if (rect) {
          const f = r ? row.frac(r.value) : null;
          rect.style.setProperty('--p', f == null ? '0' : (f / CLIP).toFixed(4));
          const q = f == null ? 0 : Math.max(0, Math.min(1, f));
          rect.style.setProperty('--q', q.toFixed(3));
          if (rect.tagName.toLowerCase() === 'stop' && STYLE === 'tint') rect.style.stopOpacity = (0.1 + 0.85 * Math.max(0, Math.min(1, (q - 0.6) / 0.4))).toFixed(3);
          if (rect.classList.contains('fg-level')) rect.style.transform = `scaleY(${(q / Math.max(0.001, Number(rect.style.getPropertyValue('--q0')) || q || 0.001)).toFixed(4)})`;
          rect.classList.toggle('met', legMet(row, leg, r));
        }
        const num = fg.querySelector(`[data-fg-num="${id}:${leg}"]`);
        if (num) {
          const html = `${legMet(row, leg, r) ? CHECK : ''}<span>${numHtml(row, r)}</span>`;
          if (num.innerHTML !== html) { num.innerHTML = html; roll(num); }
          num.closest('.fg-tag')?.classList.toggle('then', !!at && !r);
        }
      }
      fg.querySelector(`.fg-reg[data-fg="${CSS.escape(id)}"]`)?.classList.toggle('empty', !!at && !legAt(row, 'L', at) && !legAt(row, 'R', at));
    }
    const l = lefsAt(at);
    const fill = fg.querySelector('[data-fg-fnfill]');
    if (fill) fill.style.setProperty('--p', l ? (l.value / 80).toFixed(4) : '0');
    const fnum = fg.querySelector('[data-fg-fnnum]');
    if (fnum) { const h = l ? `${Math.round(l.value)}<small> of 80</small>` : '<small>not yet</small>'; if (fnum.innerHTML !== h) { fnum.innerHTML = h; roll(fnum); } }
    knob.style.setProperty('--x', String(n > 1 ? i / (n - 1) : 1));
    track.setAttribute('aria-valuenow', String(i));
    track.setAttribute('aria-valuetext', fmtDate(dates[i], 'short'));
    fg.classList.toggle('past', !!at);
    if (read) {
      if (!at) read.textContent = restText;
      else {
        // Who measured it that day, from the records themselves.
        let who = '';
        for (const row of Object.values(rows)) for (const leg of ['L', 'R', null]) {
          const r = measurementsFor(row.m.id, row.m.perLeg ? leg : null).find((x) => x.date === at && x.src);
          if (r && !who) who = whoOf(r);
        }
        read.innerHTML = `<b>${esc(fmtDate(at, 'short'))}</b><span>${esc(ageWords(at))}</span>${who ? `<span>${esc(who)}</span>` : ''}`;
      }
    }
  };
  const idxAt = (clientX) => {
    const b = track.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - b.left - 12) / Math.max(1, b.width - 24)));
    return Math.round(f * (n - 1));
  };
  const step = (i) => { if (i === idx) return; idx = i; haptic('selection'); paint(i); };
  const back = () => { dragging = false; track.classList.remove('drag'); idx = n - 1; paint(idx); };
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.classList.add('drag');
    try { track.setPointerCapture(e.pointerId); } catch { /* fine */ }
    step(idxAt(e.clientX));
  });
  track.addEventListener('pointermove', (e) => { if (dragging) step(idxAt(e.clientX)); });
  track.addEventListener('pointerup', back);
  track.addEventListener('pointercancel', back);
  track.addEventListener('lostpointercapture', () => { if (dragging) back(); });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(Math.max(0, idx - 1)); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(Math.min(n - 1, idx + 1)); }
    else if (e.key === 'Escape') back();
  });
  track.addEventListener('blur', () => { if (idx !== n - 1) back(); });
}

/** A number that changed rolls up into place once (transform only). */
function roll(el) {
  if (reduced()) return;
  el.classList.remove('roll');
  void el.offsetWidth;
  el.classList.add('roll');
}
