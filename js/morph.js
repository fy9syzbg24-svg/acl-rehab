// Update a view in place (2026-09-15, Fable's audit B1, B2, B5, B10).
//
// Views render by building an HTML string. Replacing the whole view with it on
// every tick threw away every node: all photos decoded again, every row laid
// out again, and handlers bound again, which is what made a tick or a fold
// cost a frame on the phone. `morph` walks the current DOM beside the freshly
// rendered markup and changes only what differs:
//
//   - attributes are synced; an <img> keeps its node, so it is never decoded
//     again; a <details> keeps the open state he gave it
//   - a form control he is using is left alone; otherwise its checked and
//     value follow the markup
//   - where a subtree's shape changed, it is replaced only when it holds no
//     controls (text, chips, rings); if a control would have to be created or
//     removed, morph gives up and says so, and the caller repaints the view the
//     ordinary way, so a change can never leave a control without its handler
//
// Handlers stay attached because the nodes that carry them are kept. An
// element whose data-* attributes would change gives up too: a handler may
// have read them when it was bound.
//
// Never use it to change what a view's handlers closed over (Today's date, for
// one): those views repaint in full for that.

const CONTROLS = 'button, input, select, textarea, details, summary, a[href], label, [tabindex], [data-rowclick], [data-bigpic]';

// Whitespace between tags is layout-neutral here (every view's markup is
// indented template literals), so it never counts toward a shape.
const blank = (n) => n.nodeType === 3 && !n.nodeValue.trim();

/** Roll one element's number. Safe to call repeatedly; the class is one shot. */
function rollNumber(el) {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.classList.remove('roll');
  requestAnimationFrame(() => {
    el.classList.add('roll');
    setTimeout(() => el.classList.remove('roll'), 420);
  });
}
// A gliding selection's indicator (glide.js) belongs to the page, not to the
// markup: it is never compared, kept or removed by a patch (B5-4).
const kids = (el) => [...el.childNodes].filter((n) => !blank(n) && n.nodeType !== 8 && !n.classList?.contains('glide-ind'));

function sameShape(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].nodeType !== b[i].nodeType) return false;
    if (a[i].nodeType === 1 && a[i].tagName !== b[i].tagName) return false;
  }
  return true;
}

/**
 * An element keeps its data-* exactly, or it cannot be kept: a handler may have
 * read them, on the element or on an ancestor (closest('[data-entry]')), when
 * it was bound.
 */
// Set by the page's own code after it binds (focus keys, bound markers), never
// in markup: kept as they are, never read as a difference.
const BOUND = new Set(['data-focus-key', 'data-cues', 'data-bound']);

function dataStable(cur, next) {
  for (const { name, value } of [...next.attributes]) {
    if (name.startsWith('data-') && cur.getAttribute(name) !== value) return false;
  }
  for (const { name } of [...cur.attributes]) {
    if (name.startsWith('data-') && !BOUND.has(name) && !next.hasAttribute(name)) return false;
  }
  return true;
}

export const stats = { changes: 0 };

// Classes that belong to an animation in flight, never to the data (his
// report, 2026-09-15: no tick animation on supplements, because the patch that
// follows a tick took `pop` off one frame in). A patch keeps them:
//   ONE_SHOT  drawn by a render for one moment (a tick's pop, a row's flash);
//             kept for SHOT_MS after it appeared, then free to go
//   MOTION    added by the fold and drag code while something moves
//
// Not `breathing` (B5-1, 2026-09-23): Start's breath is state the render owns
// (today.js workoutButton), so a patch must be able to take it off. In this
// list it never came off: Start kept breathing after the first tick until a
// full repaint, and the recovery window could not hand the breath back and
// forth. A patch whose markup still wants it keeps it, so it is never cut.
const ONE_SHOT = new Set(['pop', 'flash']);
// `won-wait` (B5-2) holds a finishing day's burst until the tick's dot lands;
// `wd-new` (B5-3) marks a week check drawing in on Overview.
const MOTION = new Set(['animating', 'fading', 'shut', 'closing', 'litein', 'liteout', 'just-open', 'sess-leaving', 'tr-enter', 'dragging', 'roll', 'settling', 'anim-hold', 'won-wait', 'wd-new']);
const SHOT_MS = 900;
const shotAt = new WeakMap();

/** Note the one-shot classes a full repaint just drew, so a patch right after keeps them. */
export function markOneShots(root) {
  const now = Date.now();
  root?.querySelectorAll?.('.pop, .flash').forEach((el) => shotAt.set(el, now));
}

function syncClass(cur, next) {
  const have = cur.classList;
  const want = new Set((next.getAttribute('class') || '').split(/\s+/).filter(Boolean));
  const recent = Date.now() - (shotAt.get(cur) || 0) < SHOT_MS;
  for (const c of [...have]) {
    if (want.has(c) || MOTION.has(c) || (ONE_SHOT.has(c) && recent)) continue;
    have.remove(c);
    stats.changes++;
  }
  for (const c of want) {
    if (have.contains(c)) continue;
    have.add(c);
    stats.changes++;
    if (ONE_SHOT.has(c)) shotAt.set(cur, Date.now());
  }
}

function syncAttrs(cur, next) {
  for (const { name } of [...cur.attributes]) {
    if (!next.hasAttribute(name)) {
      if (cur.tagName === 'DETAILS' && name === 'open') continue;
      if (BOUND.has(name)) continue;
      if (name === 'class') { syncClass(cur, next); continue; }
      cur.removeAttribute(name);
      stats.changes++;
    }
  }
  for (const { name, value } of [...next.attributes]) {
    if (cur.tagName === 'DETAILS' && name === 'open') continue;
    if (name === 'class') { if (cur.getAttribute('class') !== value) syncClass(cur, next); continue; }
    if (cur.getAttribute(name) !== value) { cur.setAttribute(name, value); stats.changes++; }
  }
}

function syncControl(cur, next) {
  if (cur === document.activeElement) return;
  // The hidden switch inside a tap control (B6-1) holds no data: its state is
  // whatever his last tap left. Setting it back would be a toggle by script,
  // which some iOS versions answer with a second tap he never made.
  if (cur.classList.contains('hap')) return;
  if (cur.tagName === 'INPUT') {
    const type = (cur.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      const want = next.hasAttribute('checked');
      if (cur.checked !== want) { cur.checked = want; stats.changes++; }
    } else {
      const want = next.getAttribute('value') ?? '';
      if (cur.value !== want) { cur.value = want; stats.changes++; }
    }
  } else if (cur.tagName === 'TEXTAREA') {
    if (cur.value !== next.textContent) cur.value = next.textContent;
  }
}

/** Make `cur` match `next`. Returns false if that would need a new control. */
export function morph(cur, next) {
  if (cur.nodeType !== next.nodeType) return false;
  if (cur.nodeType === 3 || cur.nodeType === 8) {
    if (cur.nodeValue !== next.nodeValue) {
      // C4 (2026-09-15): a NUMBER that changes during a patch rolls to its new
      // value instead of swapping. Done here rather than per view, because
      // Progress and the week matrix repaint through the shell and have no
      // patch of their own to hang it on, so every number in the app gets it
      // for free and none can be forgotten.
      //
      // Only a number, and only a short one: rolling a sentence or a date range
      // would be noise, and this runs on every text change in the app.
      //
      // B5-3 (2026-09-23): an element can opt in with `data-roll` to roll a
      // count of the form "3 of 10" too (Supplements' taken count). Opt in
      // only: nothing else that reads "N of M" changed how it moves.
      const was = cur.nodeValue, now = next.nodeValue;
      const numeric = (t) => /^[\d.,:]{1,12}$/.test(t.trim()) && t.trim() !== '';
      const ofCount = (t) => /^\d+ of \d+$/.test(t.trim());
      const optIn = !!cur.parentElement?.hasAttribute('data-roll');
      cur.nodeValue = now;
      stats.changes++;
      if (cur.parentElement && ((numeric(was) && numeric(now)) || (optIn && ofCount(was) && ofCount(now)))) rollNumber(cur.parentElement);
    }
    return true;
  }
  if (cur.nodeType !== 1) return true;
  if (cur.tagName !== next.tagName) return false;
  if (cur.tagName === 'INPUT' || cur.tagName === 'TEXTAREA') syncControl(cur, next);
  if (cur.isEqualNode(next)) return true;
  if (!dataStable(cur, next)) return false;
  syncAttrs(cur, next);
  if (cur.tagName === 'TEXTAREA') return true;
  const a = kids(cur);
  const b = kids(next);
  if (sameShape(a, b)) {
    for (let i = 0; i < a.length; i++) if (!morph(a[i], b[i])) return false;
    return true;
  }
  if (cur.querySelector(CONTROLS) || next.querySelector(CONTROLS)) return false;
  cur.innerHTML = next.innerHTML;
  stats.changes++;
  return true;
}

/** Parse markup inertly (no image loads, no scripts). */
export function parse(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

/**
 * Morph the view's content to freshly rendered markup. Returns true when it
 * was done in place; false means nothing reliable was done and the caller
 * must repaint.
 */
export function morphView(root, html) {
  const next = parse(html).firstElementChild;
  const cur = root.firstElementChild;
  if (!cur || !next || root.childElementCount !== 1) return false;
  return morph(cur, next);
}
