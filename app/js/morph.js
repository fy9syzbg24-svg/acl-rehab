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
const kids = (el) => [...el.childNodes].filter((n) => !blank(n) && n.nodeType !== 8);

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

function syncAttrs(cur, next) {
  for (const { name } of [...cur.attributes]) {
    if (!next.hasAttribute(name)) {
      if (cur.tagName === 'DETAILS' && name === 'open') continue;
      if (BOUND.has(name)) continue;
      cur.removeAttribute(name);
      stats.changes++;
    }
  }
  for (const { name, value } of [...next.attributes]) {
    if (cur.tagName === 'DETAILS' && name === 'open') continue;
    if (cur.getAttribute(name) !== value) { cur.setAttribute(name, value); stats.changes++; }
  }
}

function syncControl(cur, next) {
  if (cur === document.activeElement) return;
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
    if (cur.nodeValue !== next.nodeValue) { cur.nodeValue = next.nodeValue; stats.changes++; }
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
