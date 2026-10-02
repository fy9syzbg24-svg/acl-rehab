// GLP-1 (Rehab Test v3, 2026-09-30): native first, the page's own web UI as the fallback.
//
// Every bridge call resolves to null when the running app does not know it yet
// (native-bridge.js), and a native sheet or menu ALSO resolves to null when he
// closes it. The two are told apart by time: an unknown call comes back in a few
// milliseconds, a person closing a sheet takes far longer. A call found missing
// is remembered for the session, so the next tap goes straight to the web UI.
//
// Nothing here writes his data: sheets and menus return what he chose, and the
// caller saves it with the page's own save path.

import { isNative, call, rectOf, haptic } from '../native-bridge.js';
import { menu as appMenu } from '../menu.js';

const missing = new Set();
const FAST_MS = 350;

/** { value } from the app, or { web: true } when the web UI should run instead. */
export async function nativeFirst(name, args) {
  if (!isNative() || missing.has(name)) return { web: true };
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const out = await call(name, args);
  const dt = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  if (out == null && dt < FAST_MS) { missing.add(name); return { web: true }; }
  return { value: out };
}

/** A tick under the finger (Apple's selection haptic). Silent without the app. */
export const tick = (kind = 'selection') => { if (isNative()) haptic(kind); };

/** A colour token, resolved, for Swift (it cannot read CSS). */
export function cssColour(name, fallback = '#888888') {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}


/**
 * A menu of choices springing from an element: the native action sheet when the
 * app has one, else a small web menu anchored to the element. Resolves to the
 * chosen id, or null. Items: { id, title, checked?, destructive?, sep?, symbol? }. No sub lines
 * (his rule for menus); destructive items are drawn last and red.
 */
export async function pickFrom(anchor, { title = '', items }) {
  const list = [...items.filter((x) => !x.destructive), ...items.filter((x) => x.destructive)];
  // A `sep` item starts a new group, on both paths (the native menu draws each
  // group apart, audit d-glp1-22); `symbol` is an SF Symbol for the native row.
  let g = 0;
  const groups = list.map((x) => (x.sep ? ++g : g));
  const res = await nativeFirst('actions.show', {
    title: title || undefined, rect: rectOf(anchor),
    items: list.map(({ id, title: t, checked, destructive, symbol }, i) => ({ id: String(id), title: t, checked: !!checked, destructive: !!destructive, group: groups[i], ...(symbol ? { symbol } : {}) })),
  });
  if (!res.web) return res.value == null ? null : String(res.value);
  // The app's one web menu (js/menu.js), so GLP-1 menus look like every other screen's
  // (consistency pass 2026-09-30).
  return appMenu({ title, items: list.map((x, i) => ({ id: String(x.id), title: x.title, checked: x.checked === undefined ? undefined : !!x.checked, destructive: !!x.destructive, group: groups[i] })) }, anchor);
}

