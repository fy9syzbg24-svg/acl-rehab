// A sideways swipe on a date header moves a day (B5-5, 2026-09-23).
//
// The player's thresholds: over 56 px across, more than twice as far across as
// down, and under 800 ms, so a scroll or a slow drag is never read as a swipe.
// A touch that starts within 24 px of either screen edge is left alone: that
// is where iOS's own back gesture lives. A left swipe is the next day, a right
// swipe the previous one, through the same handler the arrows use. Passive
// listeners only, so scrolling is never held up, and the click a swipe could
// leave behind is swallowed so it never opens the date picker as well.

const EDGE = 24;
const MIN_DX = 56;
const MAX_MS = 800;

export function onSwipe(el, { left = null, right = null } = {}) {
  if (!el) return;
  let start = null;
  let swiped = 0;
  el.addEventListener('touchstart', (e) => {
    const t = e.touches.length === 1 ? e.touches[0] : null;
    start = t && t.clientX > EDGE && t.clientX < window.innerWidth - EDGE
      ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const s = start;
    start = null;
    const t = e.changedTouches?.[0];
    if (!s || !t || Date.now() - s.at >= MAX_MS) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) <= MIN_DX || Math.abs(dx) <= 2 * Math.abs(dy)) return;
    swiped = Date.now();
    (dx < 0 ? left : right)?.();
  }, { passive: true });
  el.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  el.addEventListener('click', (e) => {
    if (Date.now() - swiped < 500) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
