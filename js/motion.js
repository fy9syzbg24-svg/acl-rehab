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
export function pageEnter(els, dir = 0) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const lite = liteMotion();
  // 2026-09-15, item 8: changing tab pushes sideways, the way changing exercise
  // does, instead of lifting 8px. `dir` is +1 for a tab further right in the
  // dock and -1 for further left, so the movement matches the row of tabs he
  // just tapped. 0 keeps the original lift, which is what a Progress panel and
  // the Mac still use. Opacity only at 30 frames (Low Power Mode).
  const from = dir === 0 ? 'translateY(8px)' : `translateX(${dir * 24}px)`;
  for (const el of els) {
    el?.animate?.(lite
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
    { duration: lite ? 160 : 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
}
