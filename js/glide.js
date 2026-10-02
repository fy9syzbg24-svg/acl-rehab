// Gliding selection (B5-4, 2026-09-23).
//
// A row of choices where one is selected (the dock, the rail, Progress's
// sections, My Program's days, the cravings scale) used to snap its highlight
// from one to the next: only a colour changed. Now each keeps ONE indicator,
// an absolutely positioned span drawn under the choices' words, and a change
// moves it with FLIP: it is put at its new box at once, then a transform
// carries it from where it was back to nothing, 280 ms on the panel ease.
// Transform only, so light motion keeps it; under Reduce Motion it jumps.
//
// Nothing is measured in the tap. glide() only notes what to do; the boxes are
// read in the next animation frame, from offsets (which ignore a pressed
// button's scale). A window resize or a turn of the phone puts every live
// indicator back in place with no animation.
//
// A container that a repaint builds again (anything inside #view) keeps no
// indicator of its own across it, so its last box is remembered by `key` and
// the new one glides from there when the caller says the change came from a
// tap on it (`animate`). morph.js leaves `.glide-ind` alone: it belongs to the
// page, not to the markup.

const DURATION = 280;
let ease = null;   // var(--ease-panel), read once (Web Animations cannot take a var())

const live = new Map();       // container -> state
const lastBox = new Map();    // key -> the last box drawn, for a container built again

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function easing() {
  if (ease) return ease;
  try { ease = getComputedStyle(document.documentElement).getPropertyValue('--ease-panel').trim(); } catch { /* the default below */ }
  if (!ease) ease = 'cubic-bezier(.45, 0, .2, 1)';
  return ease;
}

/**
 * The box of `active` (or of `target(active)`, an element inside it) in the
 * container's own coordinates, unaffected by a transform on the button (the
 * press scale) or on any ancestor (a page being pushed in).
 */
function boxOf(container, active, target) {
  if (!active || !active.isConnected || active.offsetParent !== container) return null;
  const x = active.offsetLeft;
  const y = active.offsetTop;
  const inner = target ? target(active) : null;
  if (!inner || inner === active) return { x, y, w: active.offsetWidth, h: active.offsetHeight };
  const b = active.getBoundingClientRect();
  const r = inner.getBoundingClientRect();
  const s = b.width && active.offsetWidth ? b.width / active.offsetWidth : 1;
  return { x: x + (r.left - b.left) / s, y: y + (r.top - b.top) / s, w: r.width / s, h: r.height / s };
}

function place(st, animate) {
  const { container } = st;
  if (!container.isConnected) { live.delete(container); return; }
  const box = boxOf(container, st.active, st.target);
  let ind = container.querySelector(':scope > .glide-ind');
  if (!box || box.w < 1 || box.h < 1) {
    // Nothing selected here (Settings on a phone, no craving picked): no
    // highlight, and the next one appears in place rather than flying in.
    if (ind) ind.hidden = true;
    st.box = null;
    if (st.key) lastBox.delete(st.key);
    return;
  }
  if (!ind) {
    ind = document.createElement('span');
    ind.className = `glide-ind${st.cls ? ` ${st.cls}` : ''}`;
    ind.setAttribute('aria-hidden', 'true');
    container.prepend(ind);
  }
  ind.hidden = false;
  let from = st.box || (st.key ? lastBox.get(st.key) : null);
  // Tapped again mid glide: start from where it is on screen, not where it was going.
  const running = ind.getAnimations?.() || [];
  if (running.length && from) {
    const m = new window.DOMMatrixReadOnly(getComputedStyle(ind).transform);
    from = { x: from.x + m.e, y: from.y + m.f, w: from.w * m.a, h: from.h * m.d };
    running.forEach((a) => a.cancel());
  }
  ind.style.left = `${box.x}px`;
  ind.style.top = `${box.y}px`;
  ind.style.width = `${box.w}px`;
  ind.style.height = `${box.h}px`;
  st.box = box;
  if (st.key) lastBox.set(st.key, box);
  if (!animate || !from || reduced()) return;
  const dx = from.x - box.x;
  const dy = from.y - box.y;
  const sx = from.w / box.w;
  const sy = from.h / box.h;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
  ind.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { transform: 'none' },
  ], { duration: DURATION, easing: easing() });
  // The chosen icon settles with a small overshoot (the dock, B5-4).
  if (st.settle) {
    const icon = st.target ? st.target(st.active) : st.active;
    icon?.animate?.([{ transform: 'scale(1.04)' }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  }
}

/**
 * Put `container`'s indicator under `active`, gliding there when `animate`.
 * Options: `key` remembers the box across a repaint that builds the container
 * again; `cls` styles the indicator (a pill, a fill, an underline); `target`
 * picks the element inside `active` whose box the indicator takes (the dock's
 * icon); `settle` gives that element its 4% overshoot when it moves.
 * Safe to call on every paint.
 */
export function glide(container, active, { key = null, cls = '', target = null, animate = false, settle = false } = {}) {
  if (!container) return;
  for (const c of live.keys()) if (!c.isConnected) live.delete(c);   // pages a repaint replaced
  const st = live.get(container) || { container, box: null };
  Object.assign(st, { active: active || null, key, cls, target, settle });
  live.set(container, st);
  if (st.pending) { st.animate = st.animate || animate; return; }
  st.pending = true;
  st.animate = animate;
  const run = () => {
    st.pending = false;
    place(st, st.animate);
    st.animate = false;
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else run();
}

// A new width or a turn of the phone: every live indicator back in place, no motion.
let resizeQueued = false;
function replaceAll() {
  resizeQueued = false;
  for (const st of [...live.values()]) place(st, false);
}
if (typeof window !== 'undefined') {
  const later = () => { if (resizeQueued) return; resizeQueued = true; requestAnimationFrame(replaceAll); };
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
}
