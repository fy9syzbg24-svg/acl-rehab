// Opening and closing in place (2026-09-15, Fable's audit B1, B5, B9).
//
// A body is a one-row grid (`.crow-body` or `.fold-body`) whose single child
// clips its content. Going from 0fr to 1fr tracks the content itself, so a
// photo that loads part way just keeps growing and nothing is measured.
//
// Nothing here reads layout. The body goes in already shut, is drawn shut for
// one frame, and the next frame lets it grow: the tap itself costs no forced
// layout, which is what made the old open cost 45 ms at 6x CPU.

import { parse, morph } from './morph.js';

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const DONE_PAD = 40;   // ms after the transition before the classes come off

/** Grow a body that was just put in the page. */
export function growIn(body, ms, onDone) {
  if (!body || reducedMotion()) { onDone?.(); return; }
  body.classList.add('shut', 'animating', 'fading');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    body.classList.remove('shut');
    setTimeout(() => { body.classList.remove('animating', 'fading'); onDone?.(); }, ms + DONE_PAD);
  }));
}

/** Fold a body away, then call done (which takes it out of the page). */
export function foldAway(body, ms, done) {
  if (!body || reducedMotion()) { done(); return; }
  body.classList.remove('fading');
  body.classList.add('animating', 'closing');
  requestAnimationFrame(() => body.classList.add('shut'));
  setTimeout(done, ms + 20);
}

/**
 * Put a freshly rendered block's body into the live block without repainting.
 * `html` renders the block with its body (markup, or an element parsed from
 * it); `bodySel` finds the body directly
 * under the block. Everything but the body is patched with morph; returns the
 * inserted body, or null when the live block could not be patched (the caller
 * repaints in full).
 */
export function insertBody(live, html, bodySel) {
  const tpl = typeof html === 'string' ? parse(html).firstElementChild : html;
  if (!live || !tpl) return null;
  const body = tpl.querySelector(bodySel);
  if (!body || body.parentElement !== tpl) return null;
  const at = [...tpl.children].indexOf(body);
  body.remove();
  if (live.querySelector(`:scope > ${bodySel}`)) return null;
  if (!morph(live, tpl)) return null;
  live.insertBefore(body, live.children[at] || null);
  return body;
}

/** Patch a block to its rendering without its body (after a fold starts). */
export function patchHead(live, html, bodySel) {
  const tpl = typeof html === 'string' ? parse(html).firstElementChild : html;
  if (!live || !tpl) return false;
  const liveBody = live.querySelector(`:scope > ${bodySel}`);
  const tplBody = tpl.querySelector(`:scope > ${bodySel}`);
  if (tplBody) return false;
  if (liveBody) liveBody.remove();
  const ok = morph(live, tpl);
  if (liveBody) live.appendChild(liveBody);
  return ok;
}
