// No em or en dash in screen text (his rule for this app, 2026-09-12; DESIGN-LANGUAGE
// Never 10). The page's own words are already clean; what still showed dashes after the
// v3 build was HIS data drawn as-is: clinician names with their clinic ("Annie Strauch \u2014
// a clinician"), the case file's watch list ("9th\u201310th percentile") and program
// notes. Consistency pass 2026-09-30: one display-time pass over #view and the sheets
// swaps the mark, never a word:
//   a range between numbers   "9th\u201310th", "3 \u2013 5"  ->  "9th to 10th", "3 to 5"
//   any other dash             "A \u2014 B", "A\u2014B"      ->  "A, B"
// His record is never touched (only the text node on screen). Left alone: anything he
// can type into (inputs, textareas, contenteditable), and text marked `data-verbatim`
// or a clinician's note points (`.cl-note ul`), which are shown word for word.

const DASH = /[\u2013\u2014]/;
const SKIP = 'textarea, input, [contenteditable], script, style, [data-verbatim], .cl-note ul';

export function undashText(s) {
  if (!DASH.test(s)) return s;
  return s
    .replace(/(\d[\w.%]*)\s*[\u2013\u2014]\s*(?=\d)/g, '$1 to ')
    .replace(/\s*[\u2013\u2014]\s*/g, (m, at, all) => (at === 0 || at + m.length >= all.length ? ' ' : ', '))
    .replace(/,\s*,/g, ',');
}

function fixNode(n) {
  if (n.nodeType !== 3) return;
  const t = n.nodeValue;
  if (!t || !DASH.test(t)) return;
  const p = n.parentElement;
  if (!p || p.closest(SKIP)) return;
  const v = undashText(t);
  if (v !== t) n.nodeValue = v;
}

function sweep(root) {
  if (!root) return;
  if (root.nodeType === 3) { fixNode(root); return; }
  if (root.nodeType !== 1 || !DASH.test(root.textContent || '')) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) fixNode(n);
}

export function watchDashes(...roots) {
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fixNode(m.target);
      else m.addedNodes.forEach(sweep);
    }
  });
  for (const r of roots) {
    if (!r) continue;
    sweep(r);
    mo.observe(r, { childList: true, subtree: true, characterData: true });
  }
  return mo;
}
