// Rehab Test round 3 (2026-09-30): press and hold an exercise picture to see the other key
// position. Research 10-round3-plan.md idea #11 "Peek the other frame" (plan 2.11).
//
// Why: he recognises an exercise by its picture (M1, "I could just recognize what it is"),
// and he learns by touching the thing and seeing the effect at once (M12, "I can kinda
// preview"). The row shows ONE frame; holding it turns the tile over to the end position
// (or, when the row already shows the last step, the start), letting go turns it back.
// Nothing opens and nothing is saved. A plain tap still opens the exercise sheet.
//
// The frames are crop windows onto the original file (exsheet.js framesOf); the file is never
// touched. A single picture has no other position, so it has no peek.
// Reduce Motion or light motion: the tile swaps without the turn; the haptic stays.

import { framesOf, cropStyle } from './views/exsheet.js';
import { liteMotion } from './motion.js';
import { reducedMotion } from './fold.js';
import * as N from './native-bridge.js';

const HOLD_MS = 300;
const SLOP = 10;

/** The other key position of a picture: { crop, path, label } or null. */
export function otherFrame(src) {
  if (!src) return null;
  const fr = framesOf(src);
  if (!fr || fr.crops.length < 2 || !fr.crops[0]) return null;
  const last = fr.crops.length - 1;
  const i = fr.at === last ? 0 : last;
  return { crop: fr.crops[i], path: fr.path, label: i === 0 ? 'Start position' : 'End position' };
}

function backFace(o) {
  const st = cropStyle(o.crop, 1, 0.94);
  return `<span class="pk-back" aria-hidden="true"><span style="${st.win}"><img src="${o.path}" alt="" draggable="false" decoding="async" style="${st.img}"></span><span class="pk-lab">${o.label === 'Start position' ? 'Start' : 'End'}</span></span>`;
}

/**
 * Make `btn` (a picture button holding a .frame-tile) peekable for the picture `src`.
 * The click that follows a peek is swallowed, so letting go never opens the sheet too.
 */
export function bindPeek(btn, src) {
  const o = otherFrame(src);
  if (!btn || !o || btn.dataset.peek) return;
  btn.dataset.peek = '1';
  btn.classList.add('pk');
  let timer = 0;
  let at = null;
  let peeked = 0;
  const flat = () => reducedMotion() || liteMotion();
  const show = () => {
    timer = 0;
    if (!btn.querySelector(':scope > .pk-back')) btn.insertAdjacentHTML('beforeend', backFace(o));
    btn.classList.toggle('pk-flat', flat());
    // One frame with the back face in place before the turn, so it turns rather than pops.
    requestAnimationFrame(() => btn.classList.add('pk-on'));
    peeked = Date.now();
    N.haptic('selection');
  };
  const hide = () => {
    clearTimeout(timer);
    timer = 0;
    at = null;
    if (btn.classList.contains('pk-on')) { btn.classList.remove('pk-on'); N.haptic('soft'); }
    // The click a release may leave behind comes at once; a later tap is a real tap.
    if (peeked) setTimeout(() => { peeked = 0; }, 350);
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    at = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(show, HOLD_MS);
  }, { passive: true });
  btn.addEventListener('pointermove', (e) => {
    if (!at || !timer) return;
    if (Math.abs(e.clientX - at.x) > SLOP || Math.abs(e.clientY - at.y) > SLOP) { clearTimeout(timer); timer = 0; }
  }, { passive: true });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, hide, { passive: true });
  // iOS would otherwise offer its own long press menu on the picture.
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    if (peeked) { peeked = 0; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}
