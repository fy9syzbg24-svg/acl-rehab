// Completion motion: Gold Echo, Saturation Wake, Orbit Seal, Constellation Close.
//
// Built from ChatGPT's handoff of 2026-09-16 (his ask: "the celebration screen
// that I clicked confirm on was pretty stale and boring. i want the app to be
// more fun with cooler celebration and animation"). The source of truth is that
// handoff's motion-spec.md, its storyboards and its SVGs, kept off this public
// repo; where they are, and every change made to them, is in the gitignored
// CELEBRATION-BUILD-2026-09-16.local.md.
//
// One visual language scaled to the size of the finish: a set gets one echo,
// an exercise an orbit and a seal, the whole day the widest release.
//
// Rules this file keeps, from him and from the handoff:
//   - GOLD MEANS COMPLETION AND NOTHING ELSE. It never appears before a finish.
//   - Turquoise owns active work. Green, blue and orange are never celebration.
//   - A set never needs a tap and never stops the workout.
//   - Only an exercise may take over the screen, briefly, and it never asks for
//     confirmation. The day is the largest moment.
//   - Celebrate finishing the plan, never effort, weight, reps or performance.
//   - No emoji, no mascots, no trophies, no generic confetti.
//   - Reduced motion gets a quieter version that still makes the finish clear.
//   - Low Power Mode (liteMotion) animates opacity and transform only.
//   - SYMMETRY (his words, 2026-09-16: "if gpt does anything non symmetrical or
//     balanced fix that") and WORDS ON SOLID GROUND ("keeping the solid white in
//     the circle behind the timer like in your example is the right call").

import { liteMotion } from '../motion.js';

// The player's timer ring in its SVG's own units. player.js builds its RING from
// these, so every moment here lands exactly on the ring at any drawn size: 160 pt,
// or 200 pt on a phone 390 pt or wider (mobile.css), where the stroke grows too.
export const RING_VIEW = 160;
export const RING_R = 63;
export const RING_STROKE = 9;

// Gold as the theme's own tokens: GPT's #F2B84B, #FFD978 and #FFF1B2 in dark,
// deeper golds in light so they still read on a pale page. Set as style, because
// an SVG attribute cannot read a CSS variable (el() does this).
const GOLD = 'var(--gold)';
const GOLD_GLOW = 'var(--gold-glow)';
const GOLD_SOFT = 'var(--gold-soft)';
const TONES = [GOLD, GOLD_GLOW, GOLD_SOFT];

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const lite = () => { try { return liteMotion(); } catch { return false; } };
const SVGNS = 'http://www.w3.org/2000/svg';

// Easing, named for what the handoff calls it.
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';
const EASE_OUT_CUBIC = 'cubic-bezier(.33, 1, .68, 1)';
const EASE_IN_OUT = 'cubic-bezier(.65, 0, .35, 1)';
const BALLISTIC = 'cubic-bezier(.12, .75, .3, 1)';
// A spring with a small overshoot, sampled as keyframes, because Web Animations
// has no spring easing. `over` is the overshoot as a fraction (0.04 = 4%).
const spring = (from, to, over) => [
  { transform: `scale(${from})`, offset: 0 },
  { transform: `scale(${to * (1 + over)})`, offset: 0.62 },
  { transform: `scale(${to * (1 - over * 0.35)})`, offset: 0.84 },
  { transform: `scale(${to})`, offset: 1 },
];

// ChatGPT drew every piece on a 512 canvas with the timer ring at radius 145.
// The geometry is kept in THEIR units and scaled to whatever ring it is drawn
// around, so the proportions match the storyboards at any size.
const GPT_RING = 145;

// The burst and the particles keep GPT's reach (ring 145, longest ray 220) but
// not its layout. GPT's rays cycled through five lengths, so the burst came out
// longer on one side, and its particles were an irregular spiral bunched to one
// side. Both are rebuilt with eightfold symmetry, mirror true on both axes, with
// the short rays the long ones divided by the golden ratio.
const PHI = (1 + Math.sqrt(5)) / 2;
const RAY_IN = 150;
const RAY_LONG = 220;
const RAY_SHORT = RAY_IN + (RAY_LONG - RAY_IN) / PHI;

// 24 rays [angle deg, inner r, outer r, stroke width], one every 15 degrees from
// the top. Every third (the four cardinal and four diagonal) is long.
const RAYS = Array.from({ length: 24 }, (_, i) => (i % 3 === 0
  ? [-90 + i * 15, RAY_IN, RAY_LONG, 3]
  : [-90 + i * 15, RAY_IN, RAY_SHORT, 2]));

// 32 particles [angle deg, r, size, tone index], each halfway between two rays:
// an inner and an outer ring of 8 in the middle of every 45 degree sector, and
// 16 flanking the long rays, one each side.
const PARTICLES = [
  ...Array.from({ length: 8 }, (_, i) => [22.5 + i * 45, 168, 5, 1]),
  ...Array.from({ length: 8 }, (_, i) => [22.5 + i * 45, 212, 3, 0]),
  ...Array.from({ length: 16 }, (_, i) => [-90 + Math.floor(i / 2) * 45 + (i % 2 ? 7.5 : -7.5), 194, 3.5, 2]),
];
const BURST_REACH = Math.max(RAY_LONG, ...PARTICLES.map(([, r, size]) => r + size * 1.4));
// The burst's own depth, from where its rays start to its farthest point.
const BAND = BURST_REACH - RAY_IN;
// Below this share of its depth the rays are stubs; the moment plays without them.
const MIN_BAND = 0.35;

const polar = (deg, r) => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
};

function el(tag, attrs = {}, parent = null) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if ((k === 'stroke' || k === 'fill') && String(v).startsWith('var(')) n.style[k] = v;
    else n.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * An SVG stage centred on (cx, cy) inside `host`, `span` px on each side of the
 * centre, never catching a tap. Everything is drawn in px around 0,0. Exported
 * for the flight of a set's number home to its segment (choreo.js fly, B2-7).
 */
export function stage(host, cx, cy, span, cls) {
  const svg = el('svg', {
    class: `cel-stage ${cls || ''}`, width: span * 2, height: span * 2,
    viewBox: `${-span} ${-span} ${span * 2} ${span * 2}`, 'aria-hidden': 'true',
  });
  svg.style.left = `${cx - span}px`;
  svg.style.top = `${cy - span}px`;
  host.appendChild(svg);
  return svg;
}

/** The timer ring as drawn: its radius, stroke and outer edge in px. */
function ringGeometry(ring) {
  const s = (ring?.offsetWidth || RING_VIEW) / RING_VIEW;
  return { s, R: RING_R * s, stroke: RING_STROKE * s, outer: (RING_R + RING_STROKE / 2) * s };
}

// A burst is a band that starts just outside the ring. `f` (0 to 1) is how much
// of its depth fits, and it shortens from the OUTSIDE, so a short screen gets
// shorter rays, never rays pulled in behind the ring where the mask hides them.
const band = (rIn, k, f) => (r) => rIn + (r - RAY_IN) * k * f;

function rays(parent, at, k, cls) {
  const g = el('g', { class: cls || 'cel-rays' }, parent);
  for (const [deg, r1, r2, w] of RAYS) {
    const [x1, y1] = polar(deg, at(r1));
    const [x2, y2] = polar(deg, at(r2));
    el('line', { x1, y1, x2, y2, stroke: GOLD, 'stroke-width': Math.max(1.25, w * k * 1.6), 'stroke-linecap': 'round' }, g);
  }
  return g;
}

function particles(parent, at, k, cls) {
  const g = el('g', { class: cls || 'cel-parts' }, parent);
  for (const [deg, r, size, tone] of PARTICLES) {
    const [x, y] = polar(deg, at(r));
    el('circle', { cx: x, cy: y, r: Math.max(1, size * k * 1.4), fill: TONES[tone] }, g);
  }
  return g;
}

// How much of a burst's depth fits around (cx, cy), in viewport px, before it
// would touch the words above or below it or the screen edge. The same on every
// side, so it is never cut flat on one.
function bandFit(rIn, k, cx, cy, above, below) {
  const GAP = 14;
  const room = Math.min(cy - above, below - cy, cx, window.innerWidth - cx) - GAP;
  return Math.max(0, Math.min(1, (room - rIn) / (BAND * k)));
}

function after(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// In the coordinates an absolute child of `host` uses: its padding box, so the
// border is taken off. Without that the flash sat 1 pt right of and below the ring.
function centreOf(target, host) {
  const t = target.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  return [t.left - h.left - host.clientLeft + t.width / 2, t.top - h.top - host.clientTop + t.height / 2];
}

// Words always sit on plain ground. GPT's own storyboards let particles cross
// "Complete", so every burst is drawn through this mask: nothing inside the
// ring, and nothing over the words. `boxes` are DOMRects of the text, turned
// into stage coordinates by `origin`.
let maskSeq = 0;
function clearGround(svg, span, ringR, boxes = [], origin = [0, 0]) {
  const id = `cel-clear-${++maskSeq}`;
  const m = el('mask', { id, maskUnits: 'userSpaceOnUse', x: -span, y: -span, width: span * 2, height: span * 2 }, el('defs', {}, svg));
  el('rect', { x: -span, y: -span, width: span * 2, height: span * 2, fill: '#fff' }, m);
  el('circle', { cx: 0, cy: 0, r: ringR, fill: '#000' }, m);
  const PAD = 10;
  for (const b of boxes) {
    if (!b || !b.width) continue;
    el('rect', {
      x: b.left - origin[0] - PAD, y: b.top - origin[1] - PAD,
      width: b.width + PAD * 2, height: b.height + PAD * 2, rx: 14, fill: '#000',
    }, m);
  }
  // The mask sits on a still wrapper, so scaling the burst inside it never
  // scales the clear areas with it.
  return el('g', { mask: `url(#${id})` }, svg);
}

// ------------------------------------------------------------ Gold Echo ----
//
// A set finished. 900 ms for the ring, 2.4 s for the grid; no tap, no pause.
// Beat: flash, expand, recover.
//   ring      turquoise to gold, scale 1.025, 120 ms ease out
//   grid      from 120 ms, radius 0 to the farthest panel corner, gold dots,
//             540 ms ease out cubic, then holds gold to 1800 ms and fades by
//             2400 ms (his ask was "turn gold for a few seconds")
//   shockwave from 120 ms, ring radius to 1.73 of it, 70% to 0%, 620 ms ease out
//   recovery  from 540 ms, gold back to turquoise, scale 1, 360 ms ease in out;
//             the gold lifts outward as it fades rather than blending
//   label     SET COMPLETE, in then out, 620 ms
// The wave and the shockwave start after the flash, as the handoff asks, so the
// flash reads as its own beat.

const GRID_HOLD_MS = 2400;
const WAVE_DELAY = 120;
const ECHO_MS = 900;
// The ring's beat, shared by the ring and the flash drawn over it so the two
// never slip apart while it scales.
const RING_BEAT = [
  { transform: 'scale(1)', easing: EASE_OUT },
  { transform: 'scale(1.025)', offset: 120 / ECHO_MS },
  { transform: 'scale(1.025)', offset: 540 / ECHO_MS, easing: EASE_IN_OUT },
  { transform: 'scale(1)' },
];

// `label` names what finished: a set in the player, a round in the custom
// workout (2026-09-18).
export function goldEcho(dial, { label = 'Set complete' } = {}) {
  if (!dial) return;
  const ring = dial.querySelector('.p-ring');
  const goldGrid = dial.querySelector('.p-dial__gold');
  if (!ring) return;

  // Reduced motion: no wave and no shockwave, but the finish is still unmissable:
  // the grid and the label show gold briefly and fade.
  if (reduced()) {
    goldGrid?.animate([{ opacity: 0 }, { opacity: 0.72, offset: 0.1 }, { opacity: 0.72, offset: 0.75 }, { opacity: 0 }],
      { duration: GRID_HOLD_MS, easing: 'linear' });
    labelIn(dial, label, 900);
    return;
  }

  const [cx, cy] = centreOf(ring, dial);
  const { R, stroke } = ringGeometry(ring);
  const w = dial.clientWidth;
  const h = dial.clientHeight;
  const far = Math.ceil(Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)));
  const svg = stage(dial, cx, cy, far, 'cel-echo');

  // Ring flash: a gold ring exactly over the timer ring, a pixel wider so no
  // colour shows at its edges, scaling with it.
  const flash = el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: GOLD, 'stroke-width': stroke + 1 }, svg);
  flash.style.opacity = '0';
  flash.style.transformOrigin = '0 0';
  flash.style.transformBox = 'view-box';
  flash.animate([
    { opacity: 0, easing: EASE_OUT },
    { opacity: 1, offset: 120 / ECHO_MS },
    { opacity: 1, offset: 540 / ECHO_MS, easing: EASE_IN_OUT },
    { opacity: 0 },
  ], { duration: ECHO_MS, easing: 'linear' });
  // On the recovery the gold lifts off the ring as it fades, an echo, instead of
  // crossfading in place: a gold and purple crossfade passes through a muddy
  // brown, worst on the light theme's deeper gold.
  flash.animate([...RING_BEAT.slice(0, 3), { transform: 'scale(1.2)' }], { duration: ECHO_MS, easing: 'linear' });
  ring.animate(RING_BEAT, { duration: ECHO_MS, easing: 'linear' });

  // Shockwave, starting on the ring. Its line stays 2 px as it grows.
  const wave = el('circle', {
    cx: 0, cy: 0, r: R, fill: 'none', stroke: GOLD_GLOW, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke',
  }, svg);
  wave.style.opacity = '0';   // or it shows as a thin gold ring once it ends
  wave.style.transformOrigin = '0 0';
  wave.style.transformBox = 'view-box';
  wave.animate([
    { transform: 'scale(1)', opacity: 0.7 },
    { transform: `scale(${182 / 105})`, opacity: 0 },
  ], { duration: 620, delay: WAVE_DELAY, easing: EASE_OUT });

  // The grid wave. At thirty frames a growing clip is not allowed, so it fades.
  if (goldGrid) {
    const run = GRID_HOLD_MS - WAVE_DELAY;
    const grown = 540 / run;
    const holdTo = (1800 - WAVE_DELAY) / run;
    if (lite()) {
      goldGrid.animate([{ opacity: 0 }, { opacity: 0.72, offset: grown }, { opacity: 0.72, offset: holdTo }, { opacity: 0 }],
        { duration: run, delay: WAVE_DELAY, easing: 'linear' });
    } else {
      const at = (r) => `circle(${r}px at ${cx}px ${cy}px)`;
      goldGrid.animate([
        { clipPath: at(0), opacity: 0.72, easing: EASE_OUT_CUBIC },
        { clipPath: at(far), opacity: 0.72, offset: grown },
        { clipPath: at(far), opacity: 0.72, offset: holdTo, easing: EASE_IN_OUT },
        { clipPath: at(far), opacity: 0 },
      ], { duration: run, delay: WAVE_DELAY, easing: 'linear' });
    }
  }

  labelIn(dial, label, 620);
  after(Math.max(ECHO_MS, WAVE_DELAY + 620) + 60).then(() => svg.remove());
}

// SET COMPLETE, where the storyboard puts it: under the ring, centred. Our dial
// is shorter than GPT's frame, so there is no room inside it (the label was
// clipped by the panel edge). It takes the line under the panel instead: the
// Next line fades out before the label fades in, so the two never overlap, and
// comes back after it.
function labelIn(dial, text, duration) {
  const row = dial.closest('.player')?.querySelector('.p-nextrow');
  if (!row) return;
  row.querySelector('.cel-label')?.remove();
  const next = row.querySelector('.p-next');
  const lab = document.createElement('span');
  lab.className = 'cel-label';
  lab.textContent = text;
  row.appendChild(lab);
  next?.animate([
    { opacity: 1 }, { opacity: 0, offset: 0.15 }, { opacity: 0, offset: 0.85 }, { opacity: 1 },
  ], { duration, easing: 'linear' });
  lab.animate([
    { opacity: 0, transform: 'translate(-50%, calc(-50% + 4px))' },
    { opacity: 0, transform: 'translate(-50%, calc(-50% + 4px))', offset: 0.15, easing: EASE_OUT },
    { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.4 },
    { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.6, easing: EASE_IN_OUT },
    { opacity: 0, transform: 'translate(-50%, -50%)', offset: 0.85 },
    { opacity: 0, transform: 'translate(-50%, -50%)' },
  ], { duration, easing: 'linear' }).finished.catch(() => {}).then(() => lab.remove());
}

// ------------------------------------------------------ Saturation Wake ----
//
// Waiting to working. The state itself lives in CSS (.p-dial.working), because
// it has to be right on every repaint, not only on the moment it changes. This
// adds the one thing CSS cannot: the label reading STARTING on the way in.
//   panel     #1A222A to #242F39, 280 ms ease in out (a lift layer's opacity)
//   grid      muted 18% to turquoise 42%, 320 ms ease out
//   glow      0 to a 28% turquoise bloom on the ring, 420 ms ease out cubic
//   ring      brighter, 240 ms ease out
//   label     REST to STARTING to WORK, 420 ms crossfade
//   line      scale x 0 to 1 from the centre, 360 ms ease out cubic
// Reverse is 320 ms ease in out. No gold: nothing has finished.

export function wakeLabel(phaseRow, workWord) {
  if (!phaseRow || reduced()) return;
  // Every copy of the word: the row mirrors it either side of the leg.
  for (const label of phaseRow.querySelectorAll('.p-label')) {
    const real = label.textContent;
    label.textContent = 'STARTING';
    label.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT });
    setTimeout(() => {
      // Only if nothing has redrawn the label meanwhile.
      if (label.isConnected && label.textContent === 'STARTING') {
        label.textContent = workWord || real;
        label.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 240, easing: EASE_OUT });
      }
    }, 180);
  }
}

// ----------------------------------------------------------- Orbit Seal ----
//
// An exercise finished. Takes over the screen briefly and NEVER asks for
// confirmation: it dismisses itself at 1400 ms, and a tap may end it after
// 460 ms. Beat: impact, orbit, seal.
//   ring flash   turquoise to bright gold, 160 ms ease out; dims to 35% under
//                the seal from 540 ms
//   radial lines radius 88 to 164, 360 ms ease out cubic
//   particles    radius 88 to 166, in then out, 620 ms ballistic
//   veil         0 to 92% page colour (GPT: 80%), 220 ms ease out
//   seal         0.82 to 1.00, 420 ms spring with 4% overshoot, inside the
//                ring at GPT's 118 of 145
//   copy         y +10 to 0, 280 ms ease out
//   dismiss      at 1400 ms, 220 ms ease in out
// Resolves when it has gone.
//
// Landing (B3-3, 2026-09-23): given `landEl` (the player's day thread), in full
// motion and with it on screen at the dismiss, the gold seal ring flies there
// instead of fading: to its centre and size, 420 ms, cubic-bezier(.32,.72,0,1),
// while the veil, the words and the burst fade out over 220 ms. Its rect is read
// at that moment, never before. It resolves once it has landed. Without it, in
// lite, under Reduce Motion or with it off screen, the seal dismisses as always.
// A timer resolves it in any case at 1400 + 420 + 300 ms (a hidden tab).

const VEIL = 0.92;

export function orbitSeal({ title = '', ringEl = null, landEl = null } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(); return; }
    const quiet = reduced();
    // A fixed layer over the whole screen, in viewport coordinates. Inside the
    // player it would scroll with the page and the burst could land off the ring.
    const layer = document.createElement('div');
    layer.className = `cel-orbit ${quiet ? 'quiet' : ''}`;
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-live', 'polite');
    document.body.appendChild(layer);

    const W = window.innerWidth;
    const H = window.innerHeight;
    let cx = W / 2;
    let cy = Math.min(H * 0.42, 340);
    let geo = { s: 1, R: 70, stroke: RING_STROKE, outer: 70 + RING_STROKE / 2 };
    if (ringEl && ringEl.isConnected) {
      const r = ringEl.getBoundingClientRect();
      if (r.width > 0) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; geo = ringGeometry(ringEl); }
    }
    const { s, R, stroke, outer } = geo;
    const k = R / GPT_RING;
    const rIn = outer + 3 * s;

    const veil = document.createElement('div');
    veil.className = 'cel-veil';
    layer.appendChild(veil);

    const span = Math.max(W, H, 360);
    const svg = stage(layer, cx, cy, span, 'cel-orbit-stage');

    const copy = document.createElement('div');
    copy.className = 'cel-copy';
    copy.innerHTML = `${title ? `<span class="cel-eyebrow"></span>` : ''}<b class="cel-big">Complete</b><span class="cel-sub">Logged</span>`;
    if (title) copy.querySelector('.cel-eyebrow').textContent = title;
    // Centred on the ring, and no wider than fits on BOTH sides of it, so a long
    // name wraps instead of running off one edge (landscape puts the ring right
    // of centre).
    copy.style.left = `${cx}px`;
    copy.style.maxWidth = `${Math.max(160, 2 * Math.min(cx, W - cx) - 48)}px`;
    layer.appendChild(copy);
    const copyH = copy.offsetHeight || 80;
    // Below the reach of the burst, or just under the ring when there is no
    // burst (reduced motion), and never off the bottom of the screen; then the
    // burst shortens to fit above the words (bandFit).
    const clearOf = quiet ? outer + 20 : rIn + BAND * k + 12;
    copy.style.top = `${Math.max(cy + outer + 16, Math.min(cy + clearOf, H - copyH - 24))}px`;
    let copyBox = copy.getBoundingClientRect();

    let done = false;
    let gone = false;
    const end = () => {
      if (gone) return;
      gone = true;
      clearTimeout(hardStop);
      layer.remove();
      resolve();
    };
    // The land ring's centre and radius in the viewport, or null: only in full
    // motion, and only when a point at its centre is really it (not scrolled
    // away, not under the header).
    const landing = () => {
      if (!landEl || quiet || lite() || !landEl.isConnected) return null;
      const r = landEl.getBoundingClientRect();
      if (!r.width || r.left < 0 || r.top < 0 || r.right > window.innerWidth || r.bottom > window.innerHeight) return null;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      layer.style.pointerEvents = 'none';
      const hit = document.elementFromPoint(x, y);
      if (!hit || !landEl.contains(hit)) return null;
      return [x, y, Math.max(2, r.width / 2 - 4)];   // the mini ring's radius: half, less its 2 px inset and half its 4 px stroke
    };
    const finish = () => {
      if (done) return;
      done = true;
      const to = landing();
      if (!to) {
        layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: EASE_IN_OUT })
          .finished.catch(() => {}).then(end);
        return;
      }
      // Everything but the seal fades as the veil does; the seal flies home.
      const fade = { duration: 220, easing: EASE_IN_OUT, fill: 'forwards' };
      veil.animate([{ opacity: VEIL }, { opacity: 0 }], fade);
      copy.animate([{ opacity: 0 }], fade);
      for (const n of svg.children) if (n !== sealG && n.tagName !== 'defs') n.animate([{ opacity: 0 }], fade);
      const k2 = to[2] / (R * (118 / GPT_RING));
      const at = `translate(${(to[0] - cx).toFixed(1)}px, ${(to[1] - cy).toFixed(1)}px) scale(${k2.toFixed(4)})`;
      sealG.animate([{ transform: 'translate(0px, 0px) scale(1)' }, { transform: at }],
        { duration: 420, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'forwards' });
      // Held gold all the way in, then gone into the thread in its last 80 ms.
      sealG.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 420, easing: 'linear', fill: 'forwards' });
      after(420).then(end);
    };
    const hardStop = setTimeout(end, 1400 + 420 + 300);
    const tapFrom = performance.now() + 460;
    layer.addEventListener('pointerup', () => { if (performance.now() >= tapFrom) finish(); });

    // GPT's veil was 80%, which left the player's own words showing through
    // behind "Complete" and "Logged". At 92% the screen underneath is only a hint.
    veil.animate([{ opacity: 0 }, { opacity: VEIL }], { duration: 220, easing: EASE_OUT, fill: 'forwards' });

    // The finished clock's digits are under the veil. A solid disc covers the
    // whole inside of the ring so they never ghost through the seal.
    const disc = el('circle', { cx: 0, cy: 0, r: R - stroke / 2 + 0.5, fill: 'var(--bg)' }, svg);
    disc.style.opacity = '0';

    // The dimmed ring the seal sits inside, as the storyboard draws it.
    const flash = el('circle', { cx: 0, cy: 0, r: R, fill: 'none', stroke: GOLD_GLOW, 'stroke-width': stroke + 1 }, svg);
    flash.style.opacity = '0';

    // The seal: GPT's completion ring at 118 of the 145 timer ring, with its
    // fine inner line at 91, concentric with the timer ring.
    const sealG = el('g', {}, svg);
    el('circle', { cx: 0, cy: 0, r: R * (118 / GPT_RING), fill: 'none', stroke: GOLD, 'stroke-width': Math.max(3, 8 * k * 1.4) }, sealG);
    el('circle', { cx: 0, cy: 0, r: R * (91 / GPT_RING), fill: 'none', stroke: GOLD_GLOW, 'stroke-width': Math.max(1, 2 * k * 1.4), opacity: 0.55 }, sealG);
    sealG.style.transformOrigin = '0 0';
    sealG.style.transformBox = 'view-box';
    sealG.style.opacity = '0';

    if (quiet) {
      // Reduced motion: no burst, no particles, nothing moves. The disc, the
      // dimmed ring, the seal and the words appear, hold, and go.
      disc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'forwards' });
      flash.animate([{ opacity: 0 }, { opacity: 0.35 }], { duration: 240, fill: 'forwards' });
      sealG.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'forwards' });
      copy.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, fill: 'forwards' });
      setTimeout(finish, 1400);
      return;
    }

    // Impact: the disc and a bright gold flash on the ring, then the flash dims
    // under the seal once it has landed.
    disc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT, fill: 'forwards' });
    flash.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT, fill: 'forwards' });
    after(540).then(() => flash.animate([{ opacity: 1 }, { opacity: 0.35 }], { duration: 220, easing: EASE_IN_OUT, fill: 'forwards' }));

    // Orbit: rays spring out from behind the ring, and the particles fly. Both
    // shorten together to fit the screen; if they would be stubs, they are left out.
    let f = bandFit(rIn, k, cx, cy, 0, copyBox.top);
    if (f < MIN_BAND) {
      // A short screen (a phone on its side): let the words sit closer to the
      // bottom before giving up on the burst.
      copy.style.top = `${Math.max(cy + outer + 16, Math.min(cy + clearOf, H - copyH - 12))}px`;
      copyBox = copy.getBoundingClientRect();
      f = bandFit(rIn, k, cx, cy, 0, copyBox.top);
    }
    if (f >= MIN_BAND) {
      const at = band(rIn, k, f);
      const burst = clearGround(svg, span, outer + 1, [copyBox], [cx, cy]);
      const rayG = rays(burst, at, k);
      rayG.style.transformOrigin = '0 0';
      rayG.style.transformBox = 'view-box';
      rayG.animate([
        { transform: `scale(${88 / 164})`, opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ], { duration: 360, easing: EASE_OUT_CUBIC, fill: 'forwards' });

      // Movement and brightness are separate animations, so the particles are
      // brightest once they are clear of the ring, not while it still hides them.
      const partG = particles(burst, at, k);
      partG.style.transformOrigin = '0 0';
      partG.style.transformBox = 'view-box';
      partG.animate([{ transform: `scale(${88 / 166})` }, { transform: 'scale(1)' }],
        { duration: 620, easing: BALLISTIC, fill: 'forwards' });
      partG.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }],
        { duration: 620, easing: 'linear', fill: 'forwards' });
    }

    // Seal: settles with a small spring once the burst has started, so every
    // layer does not arrive at the same instant.
    after(120).then(() => {
      sealG.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
      sealG.animate(spring(0.82, 1, 0.04), { duration: 420, easing: 'linear', fill: 'forwards' });
    });

    // Copy resolves under the stable seal, after the burst.
    copy.style.opacity = '0';
    after(180).then(() => copy.animate([
      { opacity: 0, transform: 'translate(-50%, 10px)' },
      { opacity: 1, transform: 'translate(-50%, 0)' },
    ], { duration: 280, easing: EASE_OUT, fill: 'forwards' }));

    setTimeout(finish, 1400);
  });
}

// --------------------------------------------------- Constellation Close ----
//
// The whole day finished. The largest moment. Beat: close, unify, release.
//   final segment  0 to 100% arc, 420 ms ease out cubic
//   gold trace     ring start to full circumference, 520 ms ease in out
//   ring           category colours to a gold overlay, 430 ms crossfade
//   halo bloom     0 to 72%, 520 ms ease out, blurred, behind the gold ring
//   burst          radius 126 to 184, 480 ms spring with 3% overshoot
//   particles      ring edge to radius 192, fading, 760 ms ballistic
//   copy           y +12 to 0, 360 ms ease out
//   Done           y +8 to 0, 320 ms ease out
// Reaches its stable state at 1500 ms and stays until Done is tapped.
//
// `ringHost` holds the day ring (drawn in its category colours by dayring.js,
// with the exercise just finished marked `closing`). This lays the gold over it.
// `settled` draws the finished state with no motion: a repaint of the screen
// or a later visit, so the gold never vanishes once it has been earned.

export function constellation(ringHost, { copy = null, done = null, settled = false } = {}) {
  const reveal = () => {
    if (copy) copy.style.opacity = '1';
    if (done) done.style.opacity = '1';
  };
  if (!ringHost || !ringHost.isConnected) return;
  const ringEl = ringHost.querySelector('.dayring2') || ringHost;
  const box = ringEl.getBoundingClientRect();
  if (!box.width) { reveal(); return; }
  const hostBox = ringHost.getBoundingClientRect();
  const cx = box.left - hostBox.left - ringHost.clientLeft + box.width / 2;
  const cy = box.top - hostBox.top - ringHost.clientTop + box.height / 2;
  const R = box.width / 2 - 12;   // dayring.js: size / 2 - stroke / 2 - 5, stroke 14
  const TRACE = Math.max(8, box.width * 0.07);
  const outer = R + TRACE / 2;
  const k = R / GPT_RING;
  const still = settled || reduced();
  const flat = lite();

  const span = Math.max(box.width, 360);
  const svg = stage(ringHost, cx, cy, span, 'cel-constellation');

  // The category tick marks outside the ring would poke through the gold as
  // coloured dashes, so they hand over to the gold with the ring.
  const marks = [...ringEl.querySelectorAll('.dr-mark')];
  const closing = ringEl.querySelector('.dr-seg.closing');

  // Halo first, so it blooms BEHIND the gold ring, blurred as GPT's asset is, and
  // masked off the middle of the ring where the words are.
  const blurId = `cel-blur-${++maskSeq}`;
  const filter = el('filter', { id: blurId, x: '-40%', y: '-40%', width: '180%', height: '180%' }, el('defs', {}, svg));
  el('feGaussianBlur', { stdDeviation: Math.max(4, 14 * k) }, filter);
  const haloG = clearGround(svg, span, R - TRACE / 2);
  const halo = el('circle', {
    cx: 0, cy: 0, r: R, fill: 'none', stroke: GOLD_GLOW, 'stroke-width': Math.max(6, 12 * k), filter: `url(#${blurId})`,
  }, haloG);
  halo.classList.add('cel-halo');
  halo.style.opacity = '0';

  // The gold ring that takes over the category segments.
  const C = 2 * Math.PI * R;
  const trace = el('circle', {
    cx: 0, cy: 0, r: R, fill: 'none', stroke: GOLD, 'stroke-width': TRACE,
    'stroke-linecap': 'round', transform: 'rotate(-90)',
  }, svg);

  if (still) {
    // Reduced motion, or the finish already played: the ring is simply gold and
    // the words are there. Clear, complete, and nothing moves.
    marks.forEach((m) => { m.style.opacity = '0'; });
    if (closing) { closing.style.strokeDashoffset = '0'; closing.style.opacity = '1'; }
    halo.style.opacity = '0.72';
    reveal();
    return;
  }

  if (copy) copy.style.opacity = '0';
  if (done) done.style.opacity = '0';

  // Close: the exercise just finished draws its own segment.
  if (closing) {
    if (flat) {
      closing.style.strokeDashoffset = '0';
      closing.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, fill: 'forwards' });
    } else {
      closing.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 420, easing: EASE_OUT_CUBIC, fill: 'forwards' });
      // A dash of no length still draws its round cap as a dot, so it shows only
      // once it has length.
      closing.animate([{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1 }], { duration: 420, easing: 'linear', fill: 'forwards' });
    }
  }

  // Unify: the gold trace draws round (or, at thirty frames, fades in), and the
  // marks hand over. Invisible until it starts, for the same cap dot reason.
  trace.style.opacity = '0';
  if (!flat) {
    trace.setAttribute('stroke-dasharray', `${C} ${C}`);
    trace.setAttribute('stroke-dashoffset', `${C}`);
  }
  after(420).then(() => {
    marks.forEach((m) => m.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 430, fill: 'forwards' }));
    if (flat) {
      trace.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 430, fill: 'forwards' });
    } else {
      trace.animate([{ strokeDashoffset: C }, { strokeDashoffset: 0 }], { duration: 520, easing: EASE_IN_OUT, fill: 'forwards' });
      trace.animate([{ opacity: 0 }, { opacity: 1, offset: 0.02 }, { opacity: 1 }], { duration: 520, easing: 'linear', fill: 'forwards' });
    }
  });

  after(850).then(() => halo.animate([{ opacity: 0 }, { opacity: 0.72 }], { duration: 520, easing: EASE_OUT, fill: 'forwards' }));

  // Release: the widest burst and particles, in the room between the words
  // above the ring and the words below it, the same on every side.
  const DAY_RAYS = 184 / 164;
  const DAY_PARTS = 192 / 166;
  const kr = k * DAY_RAYS;
  const kp = k * DAY_PARTS;
  const rIn = outer + 3;
  const origin = [hostBox.left + cx, hostBox.top + cy];
  const copyBox = copy?.getBoundingClientRect();
  const doneBox = done?.getBoundingClientRect();
  const above = ringHost.closest('.player')?.querySelector('.p-eyebrow')?.getBoundingClientRect().bottom ?? 0;
  const below = copyBox?.top ?? window.innerHeight;
  const f = bandFit(rIn, Math.max(kr, kp), origin[0], origin[1], above, below);
  if (f >= MIN_BAND) {
    const burst = clearGround(svg, span, outer + 1, [copyBox, doneBox], origin);
    const rayG = rays(burst, band(rIn, kr, f), kr, 'cel-rays cel-rays-day');
    rayG.style.transformOrigin = '0 0';
    rayG.style.transformBox = 'view-box';
    rayG.style.opacity = '0';
    const partG = particles(burst, band(rIn, kp, f), kp, 'cel-parts cel-parts-day');
    partG.style.transformOrigin = '0 0';
    partG.style.transformBox = 'view-box';
    partG.style.opacity = '0';

    after(1020).then(() => {
      rayG.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'forwards' });
      rayG.animate(spring(126 / 184, 1, 0.03), { duration: 480, easing: 'linear', fill: 'forwards' });
      partG.animate([{ transform: `scale(${126 / 192})` }, { transform: 'scale(1)' }],
        { duration: 760, easing: BALLISTIC, fill: 'forwards' });
      partG.animate([{ opacity: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0.85 }],
        { duration: 760, easing: 'linear', fill: 'forwards' });
    });
  }

  after(1140).then(() => {
    if (copy) copy.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 360, easing: EASE_OUT, fill: 'forwards' });
    if (done) done.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: EASE_OUT, fill: 'forwards' });
  });
}
