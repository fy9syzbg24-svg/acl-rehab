// Light motion when the phone slows the page down (2026-09-15, his report:
// "in low power mode the animations get choppy again").
//
// What is happening: Safari already draws page animation at 60 Hz at most
// (scrolling is the phone's own and stays at 120). In Low Power Mode iOS drops
// page animation, CSS and requestAnimationFrame alike, to 30 frames a second,
// and a page cannot ask for more (WebKit bugs 168837 and 169138). A row growing
// taller, or rows sliding, at 30 frames reads as steps.
//
// A page cannot see Low Power Mode, but it can see its frames. The gaps between
// animation frames are sampled for a moment when the app opens or comes back,
// and while a finger is down (the frames before a tap lands). When they run
// about 33 ms apart, motion goes light: whatever grew or slid now appears in
// place and fades in, which looks smooth at 30 frames. Back at 60, the full
// motion returns by itself. Reduce Motion still means no motion at all.
//
// For testing, localStorage 'rehab.motion' = 'lite' or 'full' forces a mode.

const SAMPLES = 12;
const SLOW_MS = 24;          // 60 Hz is 16.7 ms a frame, 30 Hz is 33.3
const gaps = [];
let lite = false;
let sampling = false;

function forced() {
  try { return localStorage.getItem('rehab.motion'); } catch { return null; }
}

function decide() {
  const f = forced();
  if (f === 'lite' || f === 'full') lite = f === 'lite';
  else if (gaps.length >= 4) {
    const sorted = gaps.slice().sort((a, b) => a - b);
    lite = sorted[Math.floor(sorted.length / 2)] > SLOW_MS;
  }
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('lite-motion', lite);
}

/** Sample a few frame gaps, then stop. Never runs while nothing is asked of it. */
function sample(frames) {
  if (sampling || typeof requestAnimationFrame !== 'function' || document.visibilityState !== 'visible') return;
  sampling = true;
  let last = 0;
  let left = frames;
  const step = (t) => {
    if (last) {
      gaps.push(t - last);
      if (gaps.length > SAMPLES) gaps.shift();
    }
    last = t;
    if (--left > 0 && document.visibilityState === 'visible') requestAnimationFrame(step);
    else { sampling = false; decide(); }
  };
  requestAnimationFrame(step);
}

/** True while the page is being drawn at about 30 frames a second. */
export function liteMotion() {
  const f = forced();
  return f === 'lite' ? true : f === 'full' ? false : lite;
}

if (typeof document !== 'undefined') {
  decide();
  // A moment after opening or coming back, once the first drawing is done, so
  // the page's own start-up work is not mistaken for a slow screen.
  setTimeout(() => sample(8), 1200);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    gaps.length = 0;
    setTimeout(() => sample(8), 600);
  });
  document.addEventListener('pointerdown', () => sample(6), { capture: true, passive: true });
}

/**
 * A new page, or a new Progress panel, fades up into place instead of cutting
 * in (2026-09-15, his pick). Web Animations on opacity and transform, so the
 * system draws it; opacity only at 30 frames; nothing under Reduce Motion.
 */
export function pageEnter(els, dir = 0, { push = false } = {}) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lite = liteMotion();
  // 2026-09-15, item 8: changing tab pushes sideways, the way changing exercise
  // does, instead of lifting 8px. `dir` is +1 for a tab further right in the
  // dock and -1 for further left, so the movement matches the row of tabs he
  // just tapped. 0 keeps the original lift, which is what a Progress panel and
  // the Mac still use. Opacity only at 30 frames (Low Power Mode).
  //
  // `push` (B5-5, 2026-09-23): a new day or week pushes in from the side he
  // went, the way changing exercise does. At 30 frames the old one has
  // already gone and the new one slides 32 px, as in the player.
  const from = dir === 0 ? 'translateY(8px)' : `translateX(${dir * 24}px)`;
  const slide = push && dir !== 0 && lite;
  const duration = slide ? 200 : lite ? 160 : 240;
  for (const el of els) {
    const a = el?.animate?.(slide
      ? [{ transform: `translateX(${dir * 32}px)` }, { transform: 'none' }]
      : lite
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
    { duration, easing: slide ? 'cubic-bezier(.16, 1, .3, 1)' : 'cubic-bezier(.2, .8, .2, 1)' });
    // A tab in the background draws no frames: never leave it part way.
    if (a && push) setTimeout(() => { if (a.playState === 'running') a.finish(); }, duration + 300);
  }
}

/**
 * What a new day or week pushes (B5-5): the page's content under its header,
 * so the date and its arrows stay put under his thumb. Under Progress's
 * section row for a panel inside Progress (History's weeks).
 */
export function underHeader(root) {
  const page = root?.firstElementChild;
  if (!page) return [];
  if (page.querySelector(':scope > .subnav')) return [...page.querySelectorAll(':scope > .subnav ~ *')];
  const head = page.querySelector(':scope > header');
  if (!head) return [page];
  return [...page.children].filter((el) => el !== head && (head.compareDocumentPosition(el) & 4));   // 4: after the header
}

// ---------------------------------------------------------------- reveal --
// His ask, 2026-09-20: "animations currently all load when i open a page, but
// that means i miss most of them if they are below the line. can we have the
// animations happen when they appear on the screen."
//
// Every entrance animation in the app is a CSS animation with `both` fill, so
// it sits at its first frame until it runs. Holding it with
// `animation-play-state: paused` costs nothing and keeps that first frame on
// screen; an IntersectionObserver lets each one go the moment it comes into
// view. Anything already on screen is released by the observer's first
// callback, which arrives before the next paint, so nothing is delayed.
//
// No layout is read here: every match is held, and the observer decides. That
// is deliberate, measuring each element's position after a paint would cost
// more than the animations do.
const HOLD = 'anim-hold';

// The entrance animations, by what they are drawn on. Growing bars, rising
// tiles, filling arcs, drawing lines, rolling numbers. Anything that repeats
// for ever (a pulse, a breathing button) and anything a tap starts is left
// alone: those are not missed by scrolling past them.
const ENTRANCE = [
  '.rc-tile', '.rc-mark', '.rc-arc .ra-fill',           // the ring section
  '.rc-colbar i', '.rc-sbar', '.rc-prow', '.rc-pbar i',
  '.rc-hyp', '.rc-hypg', '.rc-mv', '.rc-lbar i',        // the night in detail
  '.rc-eband',                                          // the whole record on a stretch card
  '.rcard', '.rbar-track > i', '.rcol-track > i',       // where you stand
  '.rrow-bars i', '.rarc .range', '.rarc .hyper', '.fstrip-bar .track i', '.rung-bar',
  '.markers2 .mk-bar > i', '.mk-segs > i > i',          // plan markers
  '.tr-line.drawing',                                   // a trend line drawing itself
  '.mtile .mt-bar > i', '.wgoal .cr-arc',               // plan stages, the week's rings (2026-09-22)
  '.targetrow .bar > i', '.pm-sec .sc-tile', '.snd-facts .sc-tile',
  '.wf-bar i',                                          // Today's week foot (B5-3)
  '.ovs-week .wd-new svg path',                         // Overview, a day newly complete (B5-3)
].join(', ');

// ⚠️ The trap that cost a round of his time on 2026-09-20: a bar held at
// `scaleX(0)` has a bounding box of zero width, and IntersectionObserver never
// reports a zero area element as intersecting. Watching the animating element
// itself meant those bars, columns and arcs were held for ever: his knee range
// arcs never drew and four of the five sleep columns stayed empty.
//
// So each held element is watched through an ANCHOR: the nearest ancestor that
// is not itself held and has a real box. One anchor releases everything held
// inside it, which keeps the reveal local (a card's own bars, not the page).
let io = null;
const waiting = new WeakMap();   // anchor -> the elements it releases

function observer() {
  if (io) return io;
  if (typeof IntersectionObserver !== 'function') return null;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const el of waiting.get(e.target) || []) el.classList.remove(HOLD);
      waiting.delete(e.target);
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
  return io;
}

function anchorOf(el) {
  let a = el.parentElement;
  for (let up = 0; up < 5 && a; up += 1) {
    const r = a.getBoundingClientRect();
    if (r.width > 0.5 && r.height > 0.5) return a;
    a = a.parentElement;
  }
  return el.parentElement || el;
}

/**
 * Hold every entrance animation inside `root` until it is scrolled into view.
 * Called at the end of each paint; safe to call again on the same elements.
 */
export function revealOnScroll(root) {
  if (!root || reducedMotionPref()) return;
  const ob = observer();
  if (!ob) return;
  // Measure first, hold second: adding the class as we go would force a fresh
  // layout for every element instead of one for the lot.
  const pairs = [];
  for (const el of root.querySelectorAll(ENTRANCE)) {
    if (el.classList.contains(HOLD)) continue;
    pairs.push([el, anchorOf(el)]);
  }
  for (const [el, anchor] of pairs) {
    el.classList.add(HOLD);
    const held = waiting.get(anchor);
    if (held) { held.push(el); continue; }
    waiting.set(anchor, [el]);
    ob.observe(anchor);
  }
}

function reducedMotionPref() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ------------------------------------------------------------ count up --
// B5-3 (2026-09-23): a number that changed on this device since it last showed
// it counts up to its new value once, the moment it comes into view. The value
// it counts from is per device (the caller keeps it, in localStorage), so old
// progress is never replayed: an unchanged number, a first visit or a number
// that went down simply draws settled.

/** Run `fn` once, the first time `el` is on screen (watched through an anchor with a real box). */
export function whenSeen(el, fn) {
  if (!el) return;
  if (typeof IntersectionObserver !== 'function') { fn(); return; }
  const anchor = el.getBoundingClientRect().height > 0.5 ? el : anchorOf(el);
  const ob = new IntersectionObserver((entries) => {
    if (!el.isConnected) { ob.disconnect(); return; }   // repainted away before it was seen
    if (!entries.some((e) => e.isIntersecting)) return;
    ob.disconnect();
    fn();
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
  ob.observe(anchor);
}

/**
 * Count `el`'s text from `from` up to `to`. Text only (light motion reads the
 * same); in full motion each of a few steps also rolls up into place, the app's
 * number roll (a transform). A timer writes the final value if the frames stop.
 * Stops the moment something else writes the element (a repaint), and under
 * Reduce Motion writes the final value at once.
 */
export function countUp(el, from, to, { onDone = null } = {}) {
  if (!el) return;
  const steps = to - from;
  if (steps <= 0 || reducedMotionPref()) { el.textContent = String(to); onDone?.(); return; }
  const rollEach = steps <= 3 && !liteMotion();
  const ms = rollEach ? 260 * steps : Math.min(900, 300 + 40 * steps);
  const t0 = performance.now();
  let shown = el.textContent;
  let stop = false;
  const write = (v) => {
    const t = String(v);
    if (t === shown) return;
    el.textContent = t;
    shown = t;
    if (rollEach) {
      el.classList.remove('roll');
      requestAnimationFrame(() => { el.classList.add('roll'); setTimeout(() => el.classList.remove('roll'), 420); });
    }
  };
  const finish = () => {
    if (stop) return;
    stop = true;
    if (el.textContent === shown) write(to);
    onDone?.();
  };
  const frame = (t) => {
    if (stop) return;
    if (el.textContent !== shown) { stop = true; return; }   // a repaint wrote it: leave it alone
    const k = Math.min(1, (t - t0) / ms);
    // Rolled steps land evenly, the first a beat after it appears; a long
    // count eases out, fast then settling.
    const v = rollEach ? from + Math.floor(k * steps + 1e-9) : Math.round(from + steps * (1 - (1 - k) ** 3));
    write(Math.min(to, v));
    if (k < 1) requestAnimationFrame(frame);
    else finish();
  };
  requestAnimationFrame(frame);
  setTimeout(finish, ms + 120);
}
