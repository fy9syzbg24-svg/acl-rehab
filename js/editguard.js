// Never redraw the screen out from under something he is still using.
//
// Every view repaints by replacing its HTML. That is fine for a tap, and wrong
// while a control is in use: on iOS it closed the time wheel before he could
// tap the check mark (his report, 2026-09-14), and Codex's audit found the same
// shape elsewhere: typing a load redrew on every character, date and band
// pickers redrew on change, and a sync pull or a PhysiApp import redrew
// mid-typing. The data is still saved the moment it changes; only the redraw
// waits, and it happens as soon as he leaves the control.
//
// What counts as "in use":
//   text, number and similar inputs, and textareas: always (typing)
//   selects, date and time inputs: on a touch screen only, where they open a
//     native wheel that a redraw dismisses; a mouse picker closes on its own
//   checkboxes, radios, sliders and buttons: never, their redraw is the answer

export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const TYPING = new Set(['text', 'number', 'email', 'search', 'tel', 'url', 'password', '']);
const PICKERS = new Set(['date', 'time', 'datetime-local', 'month', 'week']);

// 2026-09-14 revision 3 (F17). Also held back:
//   a slider while it is being dragged (pointer down to pointer up)
//   a select or date or time picker on a mouse or trackpad too, until its
//     value has been chosen (a change event); on touch, until it is left,
//     because iOS fires change while the wheel is still turning
//   a field in an open sheet or dialog, not only in the view
let dragging = null;
const committed = new WeakSet();
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => {
    const r = e.target?.closest?.('input[type=range]');
    if (r) dragging = r;
  }, true);
  const endDrag = () => {
    if (!dragging) return;
    const was = dragging;
    dragging = null;
    was.dispatchEvent(new Event('rehab-drag-end'));
  };
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
  document.addEventListener('focusin', (e) => { if (e.target) committed.delete(e.target); }, true);
  document.addEventListener('change', (e) => { if (e.target) committed.add(e.target); }, true);
}

function inUse(a) {
  if (a.tagName === 'TEXTAREA') return true;
  if (a.tagName === 'SELECT') return COARSE || !committed.has(a);
  if (a.tagName === 'INPUT') {
    const type = (a.getAttribute('type') || '').toLowerCase();
    if (TYPING.has(type)) return true;
    if (PICKERS.has(type)) return COARSE || !committed.has(a);
  }
  return !!a.isContentEditable;
}

/** The control in `root` (or an open sheet) that a redraw would interrupt right now, or null. */
export function editingIn(root) {
  const modal = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  // A slider being dragged in an open sheet holds the repaint too (audit A26).
  if (dragging && root && (root.contains(dragging) || (modal && modal.contains(dragging)))) return dragging;
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  if (!a || !root) return null;
  if (!root.contains(a) && !(modal && modal.contains(a))) return null;
  return inUse(a) ? a : null;
}

/**
 * Wrap a view's paint function. A repaint asked for while a control is in use
 * runs once, when that control loses focus. `mustPaintNow()` lets navigation
 * (a change of tab) through regardless.
 */
export function guardPaint(root, paint, mustPaintNow = () => false) {
  let waiting = null;
  const guarded = (...args) => {
    const busy = mustPaintNow() ? null : editingIn(root);
    if (!busy) {
      waiting = null;
      return paint(...args);
    }
    if (waiting === busy) return undefined;
    waiting = busy;
    const go = () => {
      if (waiting !== busy) return;
      waiting = null;
      // After the blur settles, so a tap that caused it is handled first.
      setTimeout(() => guarded(...args), 0);
    };
    busy.addEventListener('blur', go, { once: true });
    busy.addEventListener('rehab-drag-end', go, { once: true });
    busy.addEventListener('change', () => { if (!COARSE) go(); }, { once: true });
    return undefined;
  };
  return guarded;
}

/** Resolve when nothing is being edited in `root` (for reloads and imports). */
export function whenIdle(root, extraBusy = () => false) {
  return new Promise((resolve) => {
    const check = () => {
      if (!editingIn(root) && !extraBusy()) return resolve();
      setTimeout(check, 500);
    };
    check();
  });
}
