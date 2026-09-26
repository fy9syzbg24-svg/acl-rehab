// The two pages that live beside the tabs instead of inside Progress.
//
// His ask, 2026-09-20: "oura ring and glp1 pages can live on this side bar on
// the mac and ipad app." Both are whole screens in their own right and both
// were three taps deep, so on a device with a side rail they become a place of
// their own. Nothing about them changes: the same panels, the same binders.
//
// Where they show:
//   full shell (index.html)   always, at every width; its tab row scrolls.
//   mobile shell (m.html)     only while the rail is up (900px and wider),
//                             which is the iPad in landscape. A phone, and the
//                             iPad held upright, keep them inside Progress:
//                             a bottom dock of seven is not a dock.
// So exactly one surface offers each page at any moment, never both.
//
// Both are named from HIS data and hidden until it is there, so this public
// shell names neither and neither is ever a dead tab.
import { esc } from './util.js';
import { medTabLabel } from './views/medlevel.js';
import { recoveryTabLabel } from './views/recovery.js';
import { ringSettled } from './ring.js';

export const RAIL_PAGES = { meds: medTabLabel, recovery: recoveryTabLabel };

const RAIL_MQ = '(min-width: 900px)';

/** Are these two top-level pages on this device, right now? */
export function railShowing() {
  if (!document.body.classList.contains('mobile')) return true;
  try {
    return window.matchMedia(RAIL_MQ).matches;
  } catch {
    return false;   // no matchMedia: keep them where every device has them
  }
}

export const railLabel = (v) => (RAIL_PAGES[v] ? RAIL_PAGES[v]() : null);

/**
 * Should this view be sent somewhere else? Either the rail is not up (he
 * rotated the iPad, so the page is back inside Progress), or his data does
 * not hold it at all. The ring layer loads asynchronously on every route,
 * this device's own cache included, so "not ready yet" is not "not there":
 * a deep link waits for the answer rather than being bounced to Today.
 */
export function railUnavailable(view) {
  if (!RAIL_PAGES[view]) return false;
  if (!railShowing()) return true;
  return !railLabel(view) && (view !== 'recovery' || ringSettled());
}

/** A Progress panel drawn as a page of its own: one h1, then the panel. */
export function railPage(view, render, ctx) {
  return `<div class="stack">
    <header class="pagehead"><h1>${esc(railLabel(view) || 'Progress')}</h1></header>
    ${render(ctx)}
  </div>`;
}

/**
 * Name the two buttons from his data and hide them until it is there. Hiding,
 * never disabling: a dead control is not left on screen (his rule).
 */
export function paintRailTabs() {
  for (const v of Object.keys(RAIL_PAGES)) {
    const btn = document.getElementById(`tab-${v}`);
    if (!btn) continue;
    const name = railLabel(v);
    btn.hidden = !name;
    const span = document.getElementById(`tab-${v}-label`);
    if (name && span && span.textContent !== name) span.textContent = name;
  }
}

/** Repaint when the rail comes or goes, which on the iPad is every rotation. */
export function watchRail(onChange) {
  try {
    window.matchMedia(RAIL_MQ).addEventListener('change', () => onChange());
  } catch { /* older engines: the page is correct on its next paint anyway */ }
}
