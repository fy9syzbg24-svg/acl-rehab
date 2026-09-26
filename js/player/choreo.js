// Small moves the player makes on its own numbers (Batch 1, 2026-09-23).
//
// Transform and opacity only, through the Web Animations API, so a move never
// costs a layout or a paint. Low Power Mode (lite, 30 frames a second) keeps
// what is cheap there (opacity, and a transform that only moves a layer);
// Reduce Motion gets nothing, and the number simply changes. Web Animations
// stall in a hidden tab, so each one also has a timer that cancels it, and
// nothing is ever left half scaled.
//
// Batch 2 (the dial comes alive): roll, beat, stamp and land on the ring and
// its numbers, the rest's breath, the Set done ripple, the flight of a set's
// number home to its segment and the next number arriving behind it.
//
// Batch 3 (between exercises): the Next tile's lift, the level word's swap,
// the Next up intro, the day thread's segment, and the launch from Today.

import { liteMotion } from '../motion.js';
import { stage } from './celebrate.js';

const reduced = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};
const lite = () => { try { return liteMotion(); } catch { return false; } };
const EASE_OUT = 'cubic-bezier(.2, .8, .2, 1)';

/**
 * One Web Animation with a timer behind it: a hidden tab never runs the
 * animation's own end, so the timer cancels it (seam S12). Null when nothing
 * can move.
 */
function play(el, frames, opts) {
  if (!el || typeof el.animate !== 'function') return null;
  let a = null;
  try { a = el.animate(frames, opts); } catch { return null; }
  const ms = (opts.duration || 0) + (opts.delay || 0);
  setTimeout(() => { try { a.cancel(); } catch { /* already gone */ } }, ms + 300);
  return a;
}

/**
 * A number arriving: it lands from a little larger and a little faint, as the
 * count back in's digits do (B1-6). Returns the Animation, or null when there
 * is nothing to move.
 */
export function pop(el, { scale = 1.22, ms = 220 } = {}) {
  if (reduced()) return null;
  const frames = lite()
    ? [{ opacity: 0.4 }, { opacity: 1 }]
    : [{ transform: `scale(${scale})`, opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }];
  return play(el, frames, { duration: ms, easing: EASE_OUT });
}

/**
 * A number that changed rolls in (B2-4, B2-7): +1 rises from below (one more
 * rep, the rest clock arriving), -1 drops from above (one fewer). A short move
 * of the number's own layer, so Low Power Mode keeps it.
 */
export function roll(el, dir = 1, { ms = 200, delay = 0 } = {}) {
  if (reduced()) return null;
  // With a delay it holds its first frame until it starts, so it never shows
  // early (arrive).
  return play(el, [
    { transform: `translateY(${dir * 40}%)`, opacity: 0.2 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { duration: ms, easing: EASE_OUT, ...(delay ? { delay, fill: 'backwards' } : {}) });
}

/**
 * The ring's middle waits while a set's number flies out of it, then the next
 * number rolls in (B2-7, review 2026-09-23): the whole middle, words included,
 * is held clear for `delay` ms and fades in over `ms` while the number rises.
 * Two numbers never share the middle, and nothing crosses a word. Full motion
 * only: the flight it waits for never happens in Low Power Mode.
 */
export function arrive(centre, num, { delay = 100, ms = 220 } = {}) {
  if (reduced()) return null;
  const total = delay + ms;
  const a = play(centre, [
    { opacity: 0 },
    { opacity: 0, offset: delay / total, easing: EASE_OUT },
    { opacity: 1 },
  ], { duration: total, easing: 'linear' });
  roll(num, 1, { ms, delay });
  return a;
}

/**
 * The Next tile lifts once as the coach names what it shows (B3-1, "Right leg
 * next."): up 3 px and back, from .7 to full, 240 ms. Opacity only in lite.
 */
export function lift(el) {
  if (reduced()) return null;
  return play(el, lite() ? [{ opacity: 0.7 }, { opacity: 1 }] : [
    { transform: 'translateY(0)', opacity: 0.7 },
    { transform: 'translateY(-3px)', opacity: 1, offset: 0.45 },
    { transform: 'translateY(0)', opacity: 1 },
  ], { duration: 240, easing: 'ease-out' });
}

/**
 * A word changes in place (B3-4, the level line's Try): the old word slides
 * out to the left and the new one in from the right, 12 px and opacity, 240 ms,
 * one animation on the one element, the text swapped at its faint middle.
 * Lite fades it; Reduce Motion simply swaps. `html`, when given, is what goes
 * in (the level word's quieter "(Name)", 23 Sep); `text` is what it reads as.
 */
export function swapWord(el, text, html = null) {
  if (!el) return null;
  const set = () => {
    if (!el.isConnected || el.textContent === text) return;
    if (html != null) el.innerHTML = html; else el.textContent = text;
  };
  if (reduced()) { set(); return null; }
  const a = play(el, lite()
    ? [{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }]
    : [{ transform: 'translateX(0)', opacity: 1, easing: 'ease-in' },
      { transform: 'translateX(-12px)', opacity: 0, offset: 0.5 },
      { transform: 'translateX(12px)', opacity: 0, offset: 0.5, easing: 'ease-out' },
      { transform: 'translateX(0)', opacity: 1 }],
  { duration: 240, easing: 'linear' });
  if (!a) set(); else setTimeout(set, 120);
  return a;
}

/** A small fact arrives beside a word that changed (B3-4): a fade, after the word's middle. */
export function appear(el, { delay = 120, ms = 160 } = {}) {
  if (reduced()) return null;
  return play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay, easing: 'ease-out', fill: 'backwards' });
}

/**
 * Next up introduces itself (B3-2), after its push has landed: the title rises
 * 8 px into place in 280 ms, then each of the get ready's chips the same way,
 * 60 ms apart; and the step picture pushes in slowly, scale 1 to 1.03 from its
 * centre, over `remainingMs` (what is left of the get ready), held there until
 * settle() brings it back to 1 in 300 ms as the work begins. The picture's box
 * clips it, so it never spills or scrolls. Lite: the words fade, no push.
 * Reduce Motion: nothing. Returns { settle, cancel }, or null.
 */
export function intro(root, remainingMs, { words = true, push = true } = {}) {
  if (!root || reduced()) return null;
  const L = lite();
  const rise = L ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }];
  if (words) {
    play(root.querySelector('.p-title'), rise, { duration: 280, easing: EASE_OUT });
    root.querySelectorAll('[data-slot="next"] .p-chips li').forEach((li, i) => {
      play(li, rise, { duration: 280, delay: 60 * (i + 1), easing: EASE_OUT, fill: 'backwards' });
    });
  }
  const img = !L && push && remainingMs > 400 ? root.querySelector('.p-img img') : null;
  let a = null;
  if (img && typeof img.animate === 'function') {
    try {
      a = img.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }],
        { duration: remainingMs, easing: 'linear', fill: 'forwards' });
    } catch { a = null; }
  }
  let over = false;
  const drop = () => { try { a?.cancel(); } catch { /* gone */ } };
  // Frames stop in a hidden tab: the push is dropped a while after its end.
  const backstop = a ? setTimeout(drop, remainingMs + 1500) : null;
  return {
    settle() {
      if (over) return;
      over = true;
      clearTimeout(backstop);
      if (!a) return;
      const p = Number(a.effect?.getComputedTiming?.().progress);
      const from = 1 + 0.03 * (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 1);
      drop();
      if (img.isConnected && !reduced()) play(img, [{ transform: `scale(${from.toFixed(4)})` }, { transform: 'scale(1)' }], { duration: 300, easing: EASE_OUT });
    },
    cancel() { over = true; clearTimeout(backstop); drop(); },
  };
}

/**
 * The day thread's new segment draws in (B3-3), as the seal lands in it: its
 * stroke from nothing to whole in 420 ms (it carries pathLength 1), visible
 * only once it has length, so a round cap never shows as a dot. One animation.
 * Lite fades it in over 160 ms; Reduce Motion leaves it drawn.
 */
export function drawSeg(seg) {
  if (!seg || reduced()) return null;
  return lite()
    ? play(seg, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
    : play(seg, [
      { strokeDashoffset: 1, opacity: 0 },
      { strokeDashoffset: 0.94, opacity: 1, offset: 0.06 },
      { strokeDashoffset: 0, opacity: 1 },
    ], { duration: 420, easing: 'cubic-bezier(.33, 1, .68, 1)' });
}

/**
 * Launch (B3-6): Today's day ring grows into the workout dial. The dial starts
 * where the ring was, at its size (`from`: translate and one uniform scale about
 * the dial's centre, so it moves along the line between the two centres), and
 * settles in 520 ms; the rest of the screen rises 10 px and fades in, one group
 * after another 50 ms apart, from 120 ms. Transform and opacity only, no colour.
 * Lite: the dial scales up from .9 and .4 opacity in 240 ms, no travel. Reduce
 * Motion: nothing. Everything is cancelled at 520 + 400 ms whatever happens.
 */
export function launch(dial, from, groups = []) {
  if (!dial || reduced()) return [];
  const out = [];
  if (lite()) {
    out.push(play(dial, [{ transform: 'scale(.9)', opacity: 0.4 }, { transform: 'scale(1)', opacity: 1 }], { duration: 240, easing: EASE_OUT }));
  } else {
    out.push(play(dial, [
      { transform: `translate(${from.dx.toFixed(1)}px, ${from.dy.toFixed(1)}px) scale(${from.s.toFixed(4)})` },
      { transform: 'translate(0px, 0px) scale(1)' },
    ], { duration: 520, easing: EASE_OUT }));
    groups.forEach((els, i) => els.forEach((el) => out.push(play(el, [
      { transform: 'translateY(10px)', opacity: 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration: 300, delay: 120 + 50 * i, easing: EASE_OUT, fill: 'backwards' }))));
  }
  const all = out.filter(Boolean);
  setTimeout(() => all.forEach((a) => { try { a.cancel(); } catch { /* gone */ } }), 520 + 400);
  return all;
}

/** The ring beats once, on each of the last three seconds (B2-6). */
export function beat(ringEl) {
  if (reduced()) return null;
  return play(ringEl, [
    { transform: 'scale(1)' },
    { transform: 'scale(1.035)', offset: 0.3 },
    { transform: 'scale(1)' },
  ], { duration: 260, easing: 'ease-out' });
}

/** The clock's digit is stamped as the beat lands (B2-6): 1.14 to 1. */
export function stamp(el) {
  if (reduced()) return null;
  return play(el, [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 180, easing: EASE_OUT });
}

/** A step that ended by itself lands on the ring (B2-6): 1.05 to 1. */
export function land(ringEl) {
  if (reduced()) return null;
  return play(ringEl, [{ transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}

/**
 * The leg's pill flips over to the new leg at a switch (B2-2): a quarter turn
 * down to face him in 320 ms, done before the next line. Low Power Mode fades
 * it up in 160 ms instead.
 */
export function flip(el) {
  if (reduced()) return null;
  return lite()
    ? play(el, [{ opacity: 0.3 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
    : play(el, [
      { transform: 'perspective(400px) rotateX(90deg)', opacity: 0.3 },
      { transform: 'perspective(400px) rotateX(0deg)', opacity: 1 },
    ], { duration: 320, easing: 'ease-out' });
}

// -------------------------------------------------------------- breath ----
// Rest breathes (B2-5): a soft halo round the bezel, four seconds in and six
// out, ten seconds a breath. Each half eases on its own, so the turn at the
// top of the breath and at the bottom is gentle and the timing is exact.
const BREATH_MS = 10000;
const IN = 0.4;
const smooth = (s) => s * s * (3 - 2 * s);   // near enough to ease-in-out, for the fade's start

/** The breath's opacity at a point in its cycle, to fade out from (nothing is measured). */
function breathOpacity(ms) {
  const t = (((ms % BREATH_MS) + BREATH_MS) % BREATH_MS) / BREATH_MS;
  return t < IN ? 0.25 + 0.5 * smooth(t / IN) : 0.75 - 0.5 * smooth((t - IN) / (1 - IN));
}

/**
 * Start the rest's breath on `el` in phase with the rest: `elapsed` seconds in.
 * With `remaining`, it stops itself 3.2 s before the rest ends, so the
 * countdown's beats own the last three seconds. Returns a controller whose
 * stop() fades the breath out over 300 ms and then cancels it (stop({ now:
 * true }) cancels at once, for a re-seed), or null under Reduce Motion.
 * Low Power Mode breathes by opacity alone.
 */
export function breathe(el, { elapsed = 0, remaining = null } = {}) {
  if (!el || typeof el.animate !== 'function' || reduced()) return null;
  const T = 'translate(-50%, -50%)';
  const ease = 'ease-in-out';
  const frames = lite()
    ? [{ opacity: 0.25, easing: ease }, { opacity: 0.75, offset: IN, easing: ease }, { opacity: 0.25 }]
    : [{ transform: `${T} scale(.96)`, opacity: 0.25, easing: ease },
      { transform: `${T} scale(1.05)`, opacity: 0.75, offset: IN, easing: ease },
      { transform: `${T} scale(.96)`, opacity: 0.25 }];
  let a = null;
  try {
    a = el.animate(frames, { duration: BREATH_MS, iterations: Infinity, easing: 'linear' });
    a.currentTime = Math.max(0, elapsed * 1000) % BREATH_MS;
  } catch { return null; }
  let done = false;
  let timer = null;
  const ctl = {
    anim: a,
    stop({ now = false } = {}) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (now || reduced() || document.visibilityState !== 'visible') { try { a.cancel(); } catch { /* gone */ } return; }
      const from = breathOpacity(Number(a.currentTime) || 0);
      try { a.pause(); } catch { /* gone */ }
      let fade = null;
      try { fade = el.animate([{ opacity: from }, { opacity: 0 }], { duration: 300, easing: 'ease-out', fill: 'forwards' }); } catch { /* none */ }
      let cleared = false;
      const clear = () => {
        if (cleared) return;
        cleared = true;
        try { a.cancel(); } catch { /* gone */ }
        try { fade?.cancel(); } catch { /* gone */ }
      };
      if (fade) fade.finished.then(clear, clear);
      setTimeout(clear, 400);
    },
  };
  if (remaining != null) timer = setTimeout(() => ctl.stop(), Math.max(0, (remaining - 3.2) * 1000));
  return ctl;
}

// ------------------------------------------------------------ Set done ----

/**
 * The tap lands (B2-7): a turquoise wash from the centre of `rect` (the ring),
 * 2.2 times its larger side across, gone in 260 ms. Concentric, like every
 * other moment on the dial (review, 2026-09-23: from the finger point it sat
 * lopsided across the dial). `host` is where it is drawn (it clips it), `rect`
 * the target's box and `hostRect` the host's, both read in the frame after the
 * tap, never in it. `before` puts it under a layer (the ring's goes under the
 * bezel's solid disc, so nothing moves behind a digit).
 */
export function ripple(host, rect, hostRect, { before = null } = {}) {
  if (!host || !rect || reduced()) return null;
  const d = 2.2 * Math.max(rect.width, rect.height);
  const px = rect.left + rect.width / 2 - hostRect.left - (host.clientLeft || 0);
  const py = rect.top + rect.height / 2 - hostRect.top - (host.clientTop || 0);
  const s = document.createElement('span');
  s.className = 'p-ripple';
  s.setAttribute('aria-hidden', 'true');
  s.style.width = `${d}px`;
  s.style.height = `${d}px`;
  s.style.left = `${px - d / 2}px`;
  s.style.top = `${py - d / 2}px`;
  host.insertBefore(s, before && before.parentNode === host ? before : null);
  let gone = false;
  const remove = () => { if (!gone) { gone = true; s.remove(); } };
  let a = null;
  try {
    // The wash keeps most of its strength while it spreads and fades in the
    // last half, so it is seen, not just a flicker under the finger.
    a = s.animate([
      { transform: 'scale(0)', opacity: 0.35, easing: 'cubic-bezier(.2, .8, .2, 1)' },
      { opacity: 0.3, offset: 0.45, easing: 'linear' },
      { transform: 'scale(1)', opacity: 0 },
    ], { duration: 260, easing: 'linear' });
    a.finished.then(remove, remove);
  } catch { remove(); }
  setTimeout(remove, 400);
  return s;
}

/**
 * The set's number flies home (B2-7): from the ring's centre to the middle of
 * its segment, shrinking and fading, 240 ms, on a tap-through stage over the
 * dial while the segment draws in green. `to` is [x, y] from the centre in px,
 * `size` the number's type size. Full motion only: Low Power Mode and Reduce
 * Motion never create it.
 */
export function fly(dial, ring, text, to, { size = 40 } = {}) {
  if (!dial || !ring || reduced() || lite()) return null;
  const d = dial.getBoundingClientRect();
  const r = ring.getBoundingClientRect();
  const cx = r.left - d.left - dial.clientLeft + r.width / 2;
  const cy = r.top - d.top - dial.clientTop + r.height / 2;
  const span = Math.ceil(Math.hypot(to[0], to[1]) + size);
  const svg = stage(dial, cx, cy, span, 'p-flystage');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('class', 'p-fly');
  t.setAttribute('x', '0');
  t.setAttribute('y', '0');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.style.fontSize = `${size}px`;
  t.style.transformOrigin = '0 0';
  t.style.transformBox = 'view-box';
  t.textContent = text;
  svg.appendChild(t);
  let gone = false;
  const remove = () => { if (!gone) { gone = true; svg.remove(); } };
  try {
    t.animate([
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      { transform: `translate(${to[0].toFixed(1)}px, ${to[1].toFixed(1)}px) scale(.28)`, opacity: 0 },
    ], { duration: 240, easing: 'cubic-bezier(.32, .72, 0, 1)', fill: 'forwards' }).finished.then(remove, remove);
  } catch { remove(); }
  setTimeout(remove, 600);
  return t;
}
