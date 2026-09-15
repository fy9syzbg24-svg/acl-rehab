// What a repaint must carry across (2026-09-14, revision 3: F30, F39, F51).
//
// Views repaint by replacing their HTML. Without this, a remote sync or a
// selection closed every open disclosure, dropped keyboard focus to the page,
// and snapped a scrolled strip of sub tabs back to its start. None of it is
// data: it lives here, per device, for one paint to the next.
//
//   details[data-key]          stay open or closed as he left them
//   [data-focus-key] or #id    keeps keyboard focus (only when focus was in the view)
//   .subnav, [data-keep-scroll] keep their horizontal scroll; the selected tab is
//                               brought into view without moving the page

export function capture(root) {
  const snap = { open: new Map(), focus: null, scroll: new Map() };
  if (!root) return snap;
  root.querySelectorAll('details[data-key]').forEach((d) => snap.open.set(d.dataset.key, d.open));
  const a = document.activeElement;
  if (a && root.contains(a) && a !== root) {
    snap.focus = a.dataset?.focusKey ? `[data-focus-key="${cssEscape(a.dataset.focusKey)}"]`
      : a.id ? `#${cssEscape(a.id)}` : null;
  }
  root.querySelectorAll('.subnav, [data-keep-scroll]').forEach((el, i) => {
    snap.scroll.set(el.dataset.keepScroll || `subnav${i}`, el.scrollLeft);
  });
  return snap;
}

export function restore(root, snap) {
  if (!root || !snap) return;
  root.querySelectorAll('details[data-key]').forEach((d) => {
    if (snap.open.has(d.dataset.key)) d.open = snap.open.get(d.dataset.key);
  });
  root.querySelectorAll('.subnav, [data-keep-scroll]').forEach((el, i) => {
    const k = el.dataset.keepScroll || `subnav${i}`;
    if (snap.scroll.has(k)) el.scrollLeft = snap.scroll.get(k);
    const on = el.querySelector('.on, [aria-current="page"]');
    if (on) {
      // Reveal the selected tab inside the strip only; the page does not move.
      const l = on.offsetLeft - 16;
      const r = on.offsetLeft + on.offsetWidth + 16 - el.clientWidth;
      if (el.scrollLeft > l) el.scrollLeft = Math.max(0, l);
      else if (el.scrollLeft < r) el.scrollLeft = r;
    }
  });
  if (snap.focus) {
    const el = root.querySelector(snap.focus);
    if (el && document.activeElement !== el) {
      try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    }
  }
}

function cssEscape(s) {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

/** Scroll the page to the top: smooth, or at once under reduced motion. */
export function scrollTop() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (window.scrollY < 2) return;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}
