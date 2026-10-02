// Rehab Test only (2026-09-29): the behaviour half of rt.css.
//
// 1. The top bar, Apple's way: over a large title it is empty glass buttons; once
//    the page's title scrolls under it, the bar frosts and shows that title small
//    and centred. Tapping it scrolls to the top (as iOS does on the status bar).
// 2. Every control springs when pressed (CSS), and lists fade their rows in as
//    they arrive (CSS), so this file only watches the scroll and the title.

import { rollDigits, isRolling, nightNow } from './rtfx.js';

const bar = document.querySelector('.mtop');
const barIn = bar?.querySelector('.mtop-in');
let inline = null;
if (barIn) {
  inline = document.createElement('button');
  inline.type = 'button';
  inline.className = 'rt-inline';
  inline.tabIndex = -1;
  inline.setAttribute('aria-hidden', 'true');
  inline.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  barIn.appendChild(inline);
}

let title = null;
function findTitle() {
  title = document.querySelector('#view .pagehead h1, #view .p-title');
  if (inline) inline.textContent = title ? title.textContent.trim() : '';
}
function onScroll() {
  if (!bar) return;
  if (!title || !title.isConnected) findTitle();
  const edge = bar.getBoundingClientRect().bottom;
  // A title whose resting place is already beside the glass buttons (Supps: bottom 105
  // against a 109 bar) must scroll half its height before the bar frosts, or the bar reads
  // it as gone at scroll 0 and draws the title twice (audit T19, b-runtime-01).
  let past = window.scrollY > 40;
  if (title) {
    const r = title.getBoundingClientRect();
    const rest = r.bottom + window.scrollY;
    past = window.scrollY > 0 && r.bottom < Math.min(edge, rest - r.height / 2);
  }
  if (past && inline && title && inline.textContent !== title.textContent.trim()) inline.textContent = title.textContent.trim();
  bar.classList.toggle('scrolled', past);
  document.documentElement.classList.toggle('rt-top', !past);
}
window.addEventListener('scroll', onScroll, { passive: true });
const view = document.getElementById('view');
if (view) {
  new MutationObserver(() => { findTitle(); onScroll(); }).observe(view, { childList: true });
}
findTitle();
onScroll();

// 3. Numbers roll into place (round 3, plan 2.3; rtfx.js rollDigits). A hero number rolls
//    its digits in once when its screen arrives, and rolls from the old value to the new one
//    when a patch changes it (a tick: "5 of 12" to "6 of 12"). Only the arrival moves; the
//    text is exactly what the page drew. Reduce Motion or Low Power: nothing moves.
//    Which number is which across repaints: its data-roll name, or its place on the page.

const ROLL = '.pk-big b, [data-roll], .dr-count b';
const shown = new Map();   // key -> the text it last showed
function rollKey(el, i) {
  const name = el.getAttribute('data-roll');
  return `${location.hash || '#today'}|${name || `@${i}`}`;
}
let rollQueued = false;
function rolls() {
  rollQueued = false;
  const els = [...document.querySelectorAll(`#view :is(${ROLL})`)];
  els.forEach((el, i) => {
    if (isRolling(el) || el.children.length) return;
    const text = el.textContent;
    const key = rollKey(el, i);
    const before = shown.get(key);
    shown.set(key, text);
    if (before === text) return;
    // Below the fold it waits: an arrival nobody sees is not an arrival.
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    rollDigits(el, before ?? null);
  });
}
const queueRolls = () => { if (!rollQueued) { rollQueued = true; requestAnimationFrame(rolls); } };
if (view) new MutationObserver(queueRolls).observe(view, { childList: true, subtree: true, characterData: true });
queueRolls();

// 4. Tonight (A7, 11-features section A): from 00:00 to 04:59 the root carries rt-night, and
//    the page washes take the dusk of the Oura night card (rt.css). Checked on load, when the
//    app comes back (rt-wake, visibility) and once a minute. At 5:00 the class goes and the
//    wash changes over 0.6 s; content never crossfades. window.__rtNight tells others
//    (celebrations pass quiet: true while it is set).
function night() {
  const on = nightNow();
  window.__rtNight = on;
  document.documentElement.classList.toggle('rt-night', on);
}
night();
setInterval(night, 60000);
window.addEventListener('rt-wake', night);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') night(); });
