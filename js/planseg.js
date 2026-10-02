// Plan and Program, one tab (his pick 2026-09-30, the Rehab Test bar). The program is set
// "every month or two" with his physio (his words), so it has no dock tab of its own on the
// mobile shell: a two way switch under the page head, the same switch as Progress's, moves
// between the two pages. Ported from the test app (ios/web-overlay/native.js), where it ran
// the same way. It only adds the switch and presses the dock's own routing; it writes nothing.

const PLAN_SEG = [['plan', 'Plan'], ['program', 'Program']];
const $ = (s, r = document) => r.querySelector(s);
const view = () => (location.hash || '#today').slice(1).split(/[/?]/)[0] || 'today';

function planSwitch() {
  const v = view();
  const main = $('#view');
  if (!main || (v !== 'plan' && v !== 'program')) return;
  const old = $('.nt-seg', main);
  if (old && old.dataset.for === v && old.isConnected) return;
  old?.remove();
  const head = $('.stack > .pagehead', main);
  if (!head) return;
  const nav = document.createElement('nav');
  nav.className = 'subnav nt-seg';
  nav.dataset.for = v;
  nav.setAttribute('aria-label', 'Plan or program');
  nav.innerHTML = PLAN_SEG.map(([k, l]) =>
    `<button type="button" data-nseg="${k}" class="${k === v ? 'on' : ''}" ${k === v ? 'aria-current="page"' : ''}>${l}</button>`).join('');
  head.after(nav);
}

document.addEventListener('click', (e) => {
  const seg = e.target.closest?.('[data-nseg]');
  if (!seg) return;
  e.preventDefault();
  if (view() !== seg.dataset.nseg) location.hash = seg.dataset.nseg;
}, true);

// A microtask, not an animation frame: a page opened in the background (or a hidden tab)
// gets no frames, and the switch must already be there when it is shown.
let queued = false;
const tidy = () => { queued = false; planSwitch(); };
new MutationObserver(() => {
  if (!queued) { queued = true; queueMicrotask(tidy); }
}).observe(document.body, { subtree: true, childList: true });
