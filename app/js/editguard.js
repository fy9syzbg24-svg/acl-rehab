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

/** The control in `root` that a redraw would interrupt right now, or null. */
export function editingIn(root) {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  if (!a || !root || !root.contains(a)) return null;
  if (a.tagName === 'TEXTAREA') return a;
  if (a.tagName === 'SELECT') return COARSE ? a : null;
  if (a.tagName === 'INPUT') {
    const type = (a.getAttribute('type') || '').toLowerCase();
    if (TYPING.has(type)) return a;
    if (PICKERS.has(type)) return COARSE ? a : null;
  }
  if (a.isContentEditable) return a;
  return null;
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
    busy.addEventListener('blur', () => {
      if (waiting !== busy) return;
      waiting = null;
      // After the blur settles, so a tap that caused it is handled first.
      setTimeout(() => guarded(...args), 0);
    }, { once: true });
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
