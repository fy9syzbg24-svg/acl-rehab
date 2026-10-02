// GLP-1 (Rehab Test round 3, 2026-09-30): ONE scrub grammar for every GLP-1 chart
// (round 3 plan, idea 1: "learned once, works on every picture"). The Level chart, the
// What If compare chart, the Cravings day band and the Weight chart all read the same way:
//
//   press and hold (240 ms, a light tap when it engages), then drag: a cursor follows the
//   finger, the caller swaps its headline to the value under it, and a selection tick is
//   felt each time the finger crosses a boundary the caller names (a shot, a day, an event,
//   a weigh in). Release restores everything; nothing opens and nothing is saved.
//   A quick tap goes to onTap (the caller's own tap: the native chart, a bubble's sheet).
//   A sideways swipe that starts without the hold is left alone (it scrolls the record).
//   A mouse or trackpad (iPad, Mac) reads on hover, with no ticks.
//
// Haptics go through native-bridge haptic('selection') (via ask.js tick), silent without the app.
// Nothing here writes his data.

import { tick } from './ask.js';

export const HOLD_MS = 240;

/**
 * Wire one element.
 *   el        the touch target (the whole plot: HIG, "the whole plot area scrubbable")
 *   at(x)     the reading at a client x: { key, ...anything } (key names the boundary cell:
 *             crossing to a new key ticks). Return null for "nothing here".
 *   show(r)   paint the reading; hide() put things back.
 *   onTap(x)  optional, for a quick tap (under 400 ms, moved under 8 pt).
 *   holdMs    optional, 0 starts at once (a strip too thin to scroll the page).
 * Returns { stop() } to drop the listeners.
 */
export function holdScrub(el, { at, show, hide, onTap = null, holdMs = HOLD_MS }) {
  let start = null, timer = 0, scrubbing = false, moved = false, lastKey, justScrubbed = 0;
  const read = (x, feel) => {
    const r = at(x);
    if (!r) return;
    if (feel && lastKey !== undefined && r.key !== lastKey) tick('selection');
    lastKey = r.key;
    show(r);
  };
  const begin = (x) => {
    scrubbing = true;
    el.classList.add('scrubbing');
    tick('light');
    lastKey = undefined;
    read(x, true);
  };
  const finish = () => {
    clearTimeout(timer);
    if (scrubbing) { scrubbing = false; el.classList.remove('scrubbing'); justScrubbed = Date.now(); hide(); }
    lastKey = undefined;
  };
  const onStart = (e) => {
    if (e.touches.length !== 1) { finish(); return; }
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, at: Date.now() };
    moved = false; scrubbing = false;
    clearTimeout(timer);
    if (holdMs <= 0) { begin(t.clientX); return; }
    timer = setTimeout(() => { if (!moved && start) begin(start.x); }, holdMs);
  };
  const onMove = (e) => {
    const t = e.touches[0];
    if (!start || !t) return;
    if (scrubbing) { e.preventDefault(); read(t.clientX, true); return; }
    if (Math.abs(t.clientX - start.x) > 8 || Math.abs(t.clientY - start.y) > 8) { moved = true; clearTimeout(timer); }
  };
  const onEnd = () => {
    const was = scrubbing;
    const quick = start && !moved && !was && Date.now() - start.at < 400;
    const x = start ? start.x : 0;
    finish();
    start = null;
    if (quick && onTap) onTap(x);
  };
  // A long press ends in a click on WebKit: the scrub must not also open what is under it.
  const swallow = (e) => { if (Date.now() - justScrubbed < 450) { e.stopPropagation(); e.preventDefault(); } };
  const hover = (e) => { if (e.pointerType === 'mouse') read(e.clientX, false); };
  const leave = (e) => { if (e.pointerType === 'mouse' && !scrubbing) { hide(); lastKey = undefined; } };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd);
  el.addEventListener('touchcancel', finish);
  el.addEventListener('click', swallow, true);
  el.addEventListener('pointermove', hover);
  el.addEventListener('pointerleave', leave);
  return {
    stop() {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', finish);
      el.removeEventListener('click', swallow, true);
      el.removeEventListener('pointermove', hover);
      el.removeEventListener('pointerleave', leave);
    },
  };
}

/** The client x of an SVG drawing's user unit: for charts drawn in their own viewBox. */
export function userX(svg, clientX, W) {
  const r = svg.getBoundingClientRect();
  return ((clientX - r.left) / (r.width || 1)) * W;
}
