// Rehab Test v3 (2026-09-30): same document View Transitions, when WebKit has them.
//
//   vtStart(update, names?, opts?) -> Promise (resolves when the new screen is drawn)
//     update  the function that changes the page (sync or async), exactly what would
//             run without a transition.
//     names   shared elements: { name: oldElement }. Each old element gets that
//             view-transition-name for the snapshot; after update() the NEW element
//             with data-vt="name" takes it, so the picture on a row grows into the
//             sheet or the player (DESIGN-LANGUAGE, Motion: shared element).
//     opts    { dir: 1 | -1 | 0 }  1 pushes forward (new page from the right), -1 goes
//             back, 0 only morphs the shared elements and cuts the rest.
//
// Never a crossfade between screens (his rule): the page is named rt-page and SLIDES;
// the root snapshot is a cut. Reduce Motion or the app's light motion: no transition at
// all, update() runs plain (the caller's own shorter push still plays). Nested calls
// (a transition asked for inside another's update) just run update().
//
//   vtSupported()  true when a transition would run now.

let active = false;

const reduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.classList.contains('lite-motion');
  } catch { return false; }
};

export const vtSupported = () => typeof document !== 'undefined'
  && typeof document.startViewTransition === 'function' && !reduced();

export async function vtStart(update, names = {}, opts = {}) {
  if (active || !vtSupported()) { await update(); return false; }
  const root = document.documentElement;
  const dir = opts.dir || 0;
  const tagged = [];
  for (const [name, el] of Object.entries(names || {})) {
    if (!el || !el.style) continue;
    el.style.viewTransitionName = cssName(name);
    tagged.push(el);
  }
  root.dataset.vt = dir > 0 ? 'fwd' : dir < 0 ? 'back' : 'morph';
  active = true;
  let t;
  try {
    t = document.startViewTransition(async () => {
      for (const el of tagged) if (el.isConnected) el.style.viewTransitionName = '';
      await update();
      for (const name of Object.keys(names || {})) {
        const n = document.querySelector(`[data-vt="${CSS.escape(name)}"]`);
        if (n) n.style.viewTransitionName = cssName(name);
      }
    });
  } catch {
    active = false;
    delete root.dataset.vt;
    await update();
    return false;
  }
  const clean = () => {
    active = false;
    delete root.dataset.vt;
    for (const name of Object.keys(names || {})) {
      document.querySelectorAll(`[data-vt="${CSS.escape(name)}"]`).forEach((n) => { n.style.viewTransitionName = ''; });
    }
    for (const el of tagged) el.style.viewTransitionName = '';
  };
  // A transition skipped (a second tab tapped mid transition, the app sent to the background)
  // rejects `ready`; the page is already drawn by update(), so that is not an error. Unhandled,
  // it landed in window.__rtErrors on quick tab changes (round 3 consistency pass).
  t.ready.catch(() => {});
  t.finished.then(clean, clean);
  try { await t.updateCallbackDone; } catch { /* the update itself threw: already logged */ }
  return true;
}

/** A name safe for view-transition-name (an identifier). */
function cssName(name) {
  return `rt-${String(name).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** True while a transition runs (a caller can skip its own entrance animation). */
export const vtActive = () => active;
