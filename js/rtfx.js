// Rehab Test round 3 (2026-09-30): small shared motion helpers, owned by the global builder.
// design-pass/research/10-round3-plan.md section 2, ideas 3 and 4; 11 section A7.
//
//   rollDigits(el, fromText?)  numbers roll into place (idea 3): each digit is a slot that
//                              rolls to its new value, once, on arrival or on a change. The
//                              value is never animated through false numbers on the record:
//                              only its arrival moves, and the final text is exactly what the
//                              page drew. Reduce Motion or Low Power: nothing moves.
//   spark(fromEl, toEl, opts)  a tick sends a small green spark along a short arc into the ring
//                              or segment it counts for (idea 4, 08 lesson 13: motion explains
//                              where progress went). Lands with haptic('light'). Green = done,
//                              so it only ever flies after his tap.
//   nightNow(date?)            true from 00:00 to 04:59 local (A7 Tonight): the root carries
//                              `rt-night` then (rt.js), and celebrations should pass quiet: true.
//   still()                    true when motion is reduced (system setting or Low Power).

import { haptic as nativeHaptic } from './native-bridge.js';

export const still = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.classList.contains('lite-motion');
  } catch { return true; }
};

export const nightNow = (d = new Date()) => d.getHours() < 5;

const rolling = new WeakSet();
export const isRolling = (el) => rolling.has(el);

/**
 * Roll the digits of el's current text into place, from `fromText` (the value it showed
 * before) or from zeros on arrival. Only the digits move; letters and signs stay put.
 */
export function rollDigits(el, fromText = null) {
  if (!el || !el.isConnected || rolling.has(el) || still()) return false;
  const text = el.textContent;
  if (!/\d/.test(text) || text.length > 12 || el.children.length) return false;
  const cs = getComputedStyle(el);
  let lh = parseFloat(cs.lineHeight);
  if (!Number.isFinite(lh)) lh = parseFloat(cs.fontSize) * 1.2;
  if (!Number.isFinite(lh) || lh <= 0) return false;
  // Right aligned digit columns: the old value's digits line up with the new one's units.
  const from = String(fromText ?? '').replace(/\D/g, '');
  const digitsNew = text.replace(/\D/g, '');
  const pad = from.padStart(digitsNew.length, '0').slice(-digitsNew.length);
  if (fromText != null && pad === digitsNew) return false;
  rolling.add(el);
  let di = 0;
  const cols = [];
  const html = [...text].map((ch) => {
    if (!/\d/.test(ch)) return `<span aria-hidden="true">${ch === ' ' ? '&nbsp;' : ch.replace(/[<&>]/g, '')}</span>`;
    const to = Number(ch);
    const start = fromText == null ? 0 : Number(pad[di]);
    di++;
    cols.push({ to, start });
    return `<span class="rt-odo" aria-hidden="true" style="line-height:${lh}px"><span class="rt-odo-sz">${ch}</span><span class="rt-odo-col" style="line-height:${lh}px">0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</span></span>`;
  }).join('');
  el.setAttribute('aria-label', text.trim());
  el.innerHTML = html;
  const wrote = el.innerHTML;
  const anims = [...el.querySelectorAll('.rt-odo-col')].map((col, i) => {
    const { to, start } = cols[i];
    // Units lead, higher places follow a beat later (a counter settling, left to right).
    const delay = (cols.length - 1 - i) * 55;
    const travel = start === to && fromText == null ? 0 : 1;
    return col.animate([
      { transform: `translateY(${-(start * lh)}px)` },
      { transform: `translateY(${-(to * lh)}px)` },
    ], { duration: travel ? 560 + Math.abs(to - start) * 18 : 1, delay, easing: 'cubic-bezier(.2, 1.14, .32, 1)', fill: 'both' });
  });
  Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
    rolling.delete(el);
    // The page may have patched it meanwhile: its text wins.
    if (el.innerHTML === wrote) { el.textContent = text; el.removeAttribute('aria-label'); }
  });
  return true;
}

/**
 * A spark from one element into another along a short arc. `onLand` runs when it
 * arrives (at once when motion is reduced). Returns the flight time in ms (0 if none).
 */
export function spark(fromEl, toEl, { color = 'var(--good-fill)', onLand = null, haptic = true } = {}) {
  const a = fromEl?.getBoundingClientRect?.();
  const b = toEl?.getBoundingClientRect?.();
  const land = () => { try { onLand?.(); } catch { /* the caller's */ } if (haptic) nativeHaptic('light'); };
  if (!a || !b || still() || !b.width) { land(); return 0; }
  const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
  const x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
  // The arc bows up and away, like a thrown thing, never through the words between.
  const cx = (x0 + x1) / 2 + (x1 > x0 ? -1 : 1) * Math.min(60, Math.abs(y1 - y0) * 0.25);
  const cy = Math.min(y0, y1) - 46;
  const pt = (t) => [(1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y1];
  const dur = Math.round(Math.min(520, 300 + Math.hypot(x1 - x0, y1 - y0) * 0.35));
  const layer = document.createElement('div');
  layer.className = 'rt-spark-layer';
  layer.setAttribute('aria-hidden', 'true');
  // A bright head and three fading motes behind it: a spark, not a glow.
  layer.innerHTML = [0, 1, 2, 3].map((i) => `<i class="rt-spark ${i ? 'mote' : ''}" style="--c:${color}"></i>`).join('');
  document.body.appendChild(layer);
  const frames = (lag, shrink) => Array.from({ length: 13 }, (_, k) => {
    const t = Math.max(0, Math.min(1, k / 12 - lag));
    const [x, y] = pt(t);
    const s = (1 - t * 0.45) * shrink;
    return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`, opacity: t >= 1 && lag ? 0 : 1 };
  });
  const parts = [...layer.children];
  const anims = parts.map((p, i) => p.animate(frames(i * 0.06, i ? 0.62 - i * 0.12 : 1),
    { duration: dur, easing: 'cubic-bezier(.45, .05, .35, 1)', fill: 'forwards' }));
  anims[0].finished.catch(() => {}).then(() => {
    land();
    layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished.catch(() => {}).then(() => layer.remove());
    // The target answers the arrival with a small pop.
    if (toEl.isConnected) toEl.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.2, 1.3, .3, 1)' });
  });
  return dur;
}
