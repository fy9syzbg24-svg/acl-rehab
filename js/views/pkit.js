// Rehab Test v3 (2026-09-30): the Progress, Plan and Program kit. One chart, one bullet bar,
// one menu and one sheet for every screen in that area, so he learns each once
// (research 04 section H, 07 section 4.7; Apple HIG Charts: keep charts of the same data
// consistent in type, colour and interaction).
//
// Rules this file keeps (RUBRIC 10 and his standing rules):
//   - the axis fits the data in view; his reference lines are part of the frame, never hidden
//   - axes sit inside the plot: gridline numbers at the leading edge, reference labels at the
//     trailing end of their own line, both at low opacity, never over a data mark's label
//   - left is blue with round dots, right orange with square dots (never colour alone)
//   - a single dated result is a number, never a chart (audit R2)
//   - the whole plot is the touch target: drag scrubs with a selection tick at each session,
//     a tap asks the native app for its Swift Charts screen and falls back to pinning the
//     session under the finger (never a dead tap)
//   - menus: the native action sheet when the app has one, a web sheet otherwise
//   - nothing here writes his data

import { esc, round, fmtDate } from '../util.js';
import { openModal } from '../components.js';
import { menu as appMenu } from '../menu.js';
import { actions, chart as nativeChart, haptic, isNative } from '../native-bridge.js';

// ------------------------------------------------------------ native, or not ---
// The bridge resolves to null both when the app does not know a call yet and when he
// closes a native menu without choosing. A person cannot close a menu in under a quarter
// of a second, so a null that fast means "not supported": the web fallback runs.
const FAST = 250;
async function nativeOrNull(fn) {
  if (!isNative()) return { ok: false, value: null };
  const t0 = performance.now();
  const value = await fn();
  if (value == null && performance.now() - t0 < FAST) return { ok: false, value: null };
  return { ok: true, value };
}

/**
 * A menu of choices springing from an element. Resolves to the chosen id or null.
 * items: [{ id, title, checked?, destructive? }]. No sub lines (07 4.8: menus have none),
 * destructive last. Web fallback: a sheet of rows, the checked one ticked.
 */
export async function menu(anchor, { title = '', items = [] } = {}) {
  const list = items.filter(Boolean);
  const order = list.filter((x) => !x.destructive).concat(list.filter((x) => x.destructive));
  // The app's one menu (js/menu.js: native first, the same web menu on every screen);
  // consistency pass 2026-09-30, this drew its own sheet of rows.
  return appMenu({ title, items: order.map(({ id, title: t, checked, destructive }) => ({ id, title: t, checked: checked === undefined ? undefined : !!checked, destructive: !!destructive })) }, anchor);
}

/** An iOS style sheet (native.css styles the page's modal as one). Returns the sheet element. */
export function sheet({ title, body, cls = '', onMount = null }) {
  return openModal({
    title, body,
    onMount(el) {
      const m = el.querySelector('.modal');
      m?.classList.add('pg-sheet');
      if (cls) cls.split(/\s+/).forEach((c) => c && m?.classList.add(c));
      onMount?.(el);
    },
  });
}

export const CHECK = '<svg class="pg-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4L18 8"/></svg>';
export const CHEV = '<svg class="pg-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
export const DOWN = '<svg class="pg-down" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';
export const INFO = '<svg class="pg-info" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>';

// --------------------------------------------------------------- numbers ---
/** A number printed the way he reads it: at most one decimal, no trailing zero. */
export const nfmt = (v, places = 1) => (typeof v === 'number' && Number.isFinite(v) ? String(round(v, places)) : String(v ?? ''));

/** Round, familiar ticks (HIG Charts: 0, 5, 10; multiples of 20) inside [lo, hi], about four. */
function niceTicks(lo, hi, want = 4) {
  const span = Math.max(1e-9, hi - lo);
  const raw = span / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= want + 0.5) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

// --------------------------------------------------------------- the chart ---
// Charts on screen by id: geometry and data, read by the binder.
const CHARTS = new Map();
let seq = 0;

/**
 * One chart in the kit. Returns HTML (an SVG in a host), or '' when there is nothing to draw.
 *   series: [{ key: 'L' | 'R' | 'B', name, points: [{ t: ms, v: number, iso? }] }]
 *   rules:  [{ v, label, kind: 'goal' | 'ref' | 'rec' }]   his clinician's goal solid, published dashed
 *   unit:   printed in the headline, never on the axis (HIG: units in the title in compact space)
 *   native: the chart.show payload for a tap (the app's own Swift Charts screen), optional
 */
export function kitChart({ series = [], rules = [], width = 330, height = 190, unit = '', floor = 0.3, zero = false, native = null, label = '' } = {}) {
  const S = series.map((s) => ({ ...s, points: (s.points || []).filter((p) => typeof p.v === 'number' && Number.isFinite(p.v)).sort((a, b) => a.t - b.t) }))
    .filter((s) => s.points.length);
  if (!S.length) return '';
  const id = `k${++seq}`;
  const W = Math.max(200, Math.round(width));
  const H = Math.round(height);
  const padT = 14, padB = 24, padL = 10, padR = 10;
  const ts = [...new Set(S.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  const vals = S.flatMap((s) => s.points.map((p) => p.v));
  const rv = rules.filter((r) => typeof r.v === 'number').map((r) => r.v);
  const lowD = Math.min(...vals), highD = Math.max(...vals);
  // The frame: data and every reference line in sight; floor under the lowest value in view.
  let hi = Math.max(highD, ...rv);
  let lo = zero ? 0 : Math.min(lowD - (highD - lowD || Math.abs(lowD) || 1) * floor, ...rv.map((v) => v - (hi - lowD) * 0.08));
  if (!zero && lowD >= 0 && lo < 0) lo = 0;
  hi += (hi - lo) * 0.08;
  if (hi === lo) { hi += 1; lo -= 1; }
  const x = (t) => (t1 === t0 ? W / 2 : padL + 30 + ((t - t0) / (t1 - t0)) * (W - padL - padR - 44));
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const grid = niceTicks(lo, hi).filter((v) => y(v) > padT + 6 && y(v) < H - padB - 4);
  const gridSvg = grid.map((v) => `<line class="kc-grid" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
    <text class="kc-tick" x="4" y="${(y(v) - 3).toFixed(1)}">${esc(nfmt(v, 1))}</text>`).join('');
  // Reference lines, labelled at their trailing end; labels nudged apart so none touch.
  const placed = [];
  const ruleList = rules.filter((r) => typeof r.v === 'number').sort((a, b) => b.v - a.v).map((r) => {
    let ly = y(r.v) - 6;
    for (const p of placed) if (Math.abs(p - ly) < 12) ly = p + 12;
    placed.push(ly);
    return { r, ly };
  });
  const ruleSvg = ruleList.map(({ r }) => `<line class="kc-rule ${r.kind || 'ref'}" x1="0" x2="${W}" y1="${y(r.v).toFixed(1)}" y2="${y(r.v).toFixed(1)}"/>`).join('');
  // The labels go on last, each on a panel coloured plate sized from its text (his rule: no
  // words over a graphic), so a dense line never runs through them.
  const ruleLabs = ruleList.filter(({ r }) => r.label).map(({ r, ly }) => {
    const lw = String(r.label).length * 6.3 + 8;
    return `<rect class="kc-plate" x="${(W - lw).toFixed(1)}" y="${(ly - 11).toFixed(1)}" width="${lw.toFixed(1)}" height="15" rx="4"/>
      <text class="kc-rulelab ${r.kind || 'ref'}" x="${W - 4}" y="${ly.toFixed(1)}" text-anchor="end">${esc(r.label)}</text>`;
  }).join('');
  // Right is drawn first and wider, left on top and thinner: where the legs match, both show.
  const lineSvg = S.slice().sort((a, b) => (a.key === 'R' ? -1 : b.key === 'R' ? 1 : 0)).map((s) => {
    const pts = s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const marks = s.points.map((p) => (s.key === 'R'
      ? `<rect class="kc-mk R" x="${(x(p.t) - 5.5).toFixed(1)}" y="${(y(p.v) - 5.5).toFixed(1)}" width="11" height="11" rx="2"/>`
      : `<circle class="kc-mk ${esc(s.key)}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${s.key === 'L' ? 3.8 : 4.2}"/>`)).join('');
    return `${s.points.length > 1 ? `<polyline class="kc-line ${esc(s.key)}" points="${pts}"/>` : ''}${marks}`;
  }).join('');
  // Dates along the bottom, inside the plot: first and last (and a middle one when there is room).
  const dl = (t, anchor) => `<text class="kc-date" x="${x(t).toFixed(1)}" y="${H - 7}" text-anchor="${anchor}">${esc(fmtDate(isoOf(t), 'short'))}</text>`;
  const dates = t1 === t0 ? dl(t0, 'middle') : dl(t0, 'start') + dl(t1, 'end') + (ts.length > 3 && W > 300 ? dl(ts[Math.floor(ts.length / 2)], 'middle') : '');
  CHARTS.set(id, { ts, S, x, y, W, H, unit, native, padT, padB, opts: arguments[0] });
  const summary = `${label || 'Chart'}: ${S.map((s) => `${s.name} from ${nfmt(s.points[0].v)} to ${nfmt(s.points[s.points.length - 1].v)}`).join('; ')} ${unit}, ${fmtDate(isoOf(t0), 'short')} to ${fmtDate(isoOf(t1), 'short')}`;
  return `<div class="kc" data-kc="${id}" style="--kc-h:${H}px">
    <svg class="kc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}">
      ${gridSvg}${ruleSvg}${lineSvg}${ruleLabs}${dates}
      <g class="kc-cursor"><line class="kc-cur" x1="0" x2="0" y1="${padT - 6}" y2="${H - padB}"/></g>
    </svg>
  </div>`;
}

export const isoOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const msOf = (iso) => new Date(`${iso}T12:00:00`).getTime();

/**
 * Wire every kit chart inside root. onScrub(t | null, values) is called as the finger moves
 * (values: { L, R, B } at that session) and with null on release, so the caller swaps its
 * headline and puts it back (Apple Health's move: numbers in the headline, never over the curve).
 */
export function bindKitCharts(root, { onScrub = null } = {}) {
  root.querySelectorAll('.kc[data-kc]').forEach((host) => {
    if (host.__kc) return;
    host.__kc = true;
    let c = CHARTS.get(host.dataset.kc);
    if (!c) return;
    // Drawn narrower or wider than the width it was built for (a sheet is 48 pt narrower
    // than the window its caller measured): build it again at the drawn width, so nothing
    // is squashed by preserveAspectRatio none (audit d21: 361 drawn at 345, dots 7.26 x 7.60).
    const drawn = host.clientWidth;
    if (c.opts && drawn >= 200 && Math.abs(drawn - c.W) > 1) {
      const t = document.createElement('div');
      t.innerHTML = kitChart({ ...c.opts, width: drawn });
      const fresh = t.firstElementChild;
      if (fresh && CHARTS.get(fresh.dataset.kc)) {
        CHARTS.delete(host.dataset.kc);
        host.replaceWith(fresh);
        host = fresh;
        host.__kc = true;
        c = CHARTS.get(host.dataset.kc);
      }
    }
    const svg = host.querySelector('svg');
    const cur = host.querySelector('.kc-cursor');
    let down = null; let scrubbing = false; let pinned = null; let lastT = null;
    const nearest = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * c.W;
      let best = c.ts[0]; let bd = Infinity;
      for (const t of c.ts) { const d = Math.abs(c.x(t) - px); if (d < bd) { bd = d; best = t; } }
      return best;
    };
    const valuesAt = (t) => Object.fromEntries(c.S.map((s) => [s.key, s.points.filter((p) => p.t === t).pop()?.v ?? null]));
    const show = (t) => {
      host.classList.add('scrub');
      cur.querySelector('line').setAttribute('x1', c.x(t).toFixed(1));
      cur.querySelector('line').setAttribute('x2', c.x(t).toFixed(1));
      host.querySelectorAll('.kc-mk').forEach((m) => {
        const mx = m.hasAttribute('cx') ? Number(m.getAttribute('cx')) : Number(m.getAttribute('x')) + 5.5;
        m.classList.toggle('hot', Math.abs(mx - c.x(t)) < 0.6);
      });
      if (t !== lastT) { lastT = t; haptic('selection'); }
      onScrub?.(t, valuesAt(t), host);
    };
    const hide = () => { host.classList.remove('scrub'); host.querySelectorAll('.kc-mk.hot').forEach((m) => m.classList.remove('hot')); lastT = null; onScrub?.(null, null, host); };
    // One scrub grammar (round 3 plan, idea 1): a sideways drag scrubs at once, AND a press
    // held still for 240 ms starts the scrub too (a light tap when it engages), so the same
    // gesture works on every chart in the app, the GLP-1 ones included. Once a held scrub is
    // on, the page does not scroll under the finger.
    let holdT = 0;
    host.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId }; scrubbing = false;
      clearTimeout(holdT);
      if (e.pointerType !== 'mouse') holdT = setTimeout(() => {
        if (!down || scrubbing) return;
        scrubbing = true; pinned = null;
        try { host.setPointerCapture(down.id); } catch { /* ignore */ }
        haptic('light');
        const t0 = nearest(down.x);
        lastT = t0;   // the light tap is this moment's haptic; the next session ticks
        show(t0);
      }, 240);
    });
    host.addEventListener('touchmove', (e) => { if (scrubbing) e.preventDefault(); }, { passive: false });
    host.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      if (!scrubbing && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) clearTimeout(holdT);
      if (!scrubbing && Math.abs(e.clientX - down.x) > 6 && Math.abs(e.clientX - down.x) > Math.abs(e.clientY - down.y)) {
        scrubbing = true; pinned = null;
        try { host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      if (scrubbing) { e.preventDefault(); show(nearest(e.clientX)); }
    });
    const up = async (e) => {
      clearTimeout(holdT);
      if (!down) return;
      const tap = !scrubbing && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8;
      const at = e.clientX;
      down = null;
      if (scrubbing) { scrubbing = false; hide(); return; }
      if (!tap) return;
      // A tap: the app's full chart screen when it has one, else pin the session here.
      if (c.native) {
        const got = await nativeOrNull(() => nativeChart(c.native));
        if (got.ok) return;
      }
      const t = nearest(at);
      if (pinned === t) { pinned = null; hide(); } else { pinned = t; show(t); }
    };
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', () => { clearTimeout(holdT); down = null; if (scrubbing) { scrubbing = false; hide(); } });
    host.style.touchAction = 'pan-y';
  });
}

/** The chart.show payload for the app's Swift Charts screen (CONTRACT.md). */
export function nativeSpec({ kind = 'strength', title, takeaway = '', unit = '', series = [], rules = [] }) {
  const COL = { L: '#0A84FF', R: '#FF9500', B: '#8E8E93' };
  return {
    kind, title, takeaway, unit,
    series: series.filter((s) => s.points?.length).map((s) => ({ name: s.name, colour: COL[s.key] || '#8E8E93', points: s.points.map((p) => [p.t, p.v]), style: s.key === 'R' ? 'square' : 'circle' })),
    rules: rules.filter((r) => typeof r.v === 'number').map((r) => ({ value: r.v, label: r.label, colour: r.kind === 'goal' ? '#1E8A3C' : '#8E8E93' })),
  };
}

// ------------------------------------------------------------ bullet bars ---
/**
 * A bullet bar (Stephen Few; 04 C14): one measure, its target tick, labels OUTSIDE the bar.
 *   value, max: the scale (0 to max)
 *   marks: [{ v, label, kind: 'goal' | 'ref' }] ticks through the bar, labels under it
 *   cls: 'L' | 'R' | 'B' | 'met' for the fill colour
 */
export function bulletBar({ value, max, marks = [], cls = 'B', label = '' }) {
  const pc = (v) => Math.max(0, Math.min(100, (v / (max || 1)) * 100));
  const ticks = marks.filter((k) => typeof k.v === 'number');
  return `<div class="pg-bullet ${esc(cls)}" role="img" aria-label="${esc(label)}">
    <span class="pkb-track"><i style="--p:${(pc(value) / 100).toFixed(4)}"></i>${ticks.map((k) => `<b class="pkb-tick ${esc(k.kind || 'ref')}" style="left:${pc(k.v).toFixed(2)}%"></b>`).join('')}</span>
    ${ticks.some((k) => k.label) ? `<span class="pkb-labs">${ticks.filter((k) => k.label).map((k) => `<span class="${esc(k.kind || 'ref')}" style="left:${pc(k.v).toFixed(2)}%">${esc(k.label)}</span>`).join('')}</span>` : ''}
  </div>`;
}

/**
 * The labels under a bullet bar are placed by value, so two close together would print over
 * each other: after the paint, each label keeps its place on the first line when it fits,
 * else drops to a second line, else shifts right; one that runs off the end is pulled back in.
 * Measured, never guessed.
 */
export function fitBulletLabels(root) {
  root.querySelectorAll('.pkb-labs').forEach((row) => {
    const R = row.getBoundingClientRect();
    if (!R.width) return;
    const spans = [...row.children].sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left));
    spans.forEach((s) => { s.style.removeProperty('--dx'); s.classList.remove('lift'); });
    const lines = [-Infinity, -Infinity];
    let lifted = false;
    for (const s of spans) {
      const r = s.getBoundingClientRect();
      let dx = 0;
      if (r.right > R.right) dx = R.right - r.right;
      if (r.left + dx < R.left) dx = R.left - r.left;
      let line = lines.findIndex((end) => r.left + dx >= end + 6);
      if (line < 0) { line = lines[0] <= lines[1] ? 0 : 1; dx = lines[line] + 6 - r.left; }
      if (line === 1) { s.classList.add('lift'); lifted = true; }
      if (dx) s.style.setProperty('--dx', `${dx.toFixed(1)}px`);
      lines[line] = r.right + dx;
    }
    row.classList.toggle('two', lifted);
  });
}

// ------------------------------------------------------------- selects as menus ---
/**
 * Every <select> inside root becomes a menu button with its value as its label (07 4.4: "a
 * Menu button with the value as its label"). The select stays in the page, hidden, and keeps
 * its own change handlers: a choice sets its value and fires 'change', so nothing that reads
 * it has to know. The native action sheet in the app, the web sheet otherwise.
 */
export function enhanceSelects(root) {
  root.querySelectorAll('select:not([data-pg-menu])').forEach((sel) => {
    sel.setAttribute('data-pg-menu', '1');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pg-selbtn';
    const label = () => {
      const o = sel.options[sel.selectedIndex];
      const t = o ? o.textContent.trim() : '';
      return t && t !== '·' ? t : 'Choose';
    };
    btn.innerHTML = `<span>${esc(label())}</span>${DOWN}`;
    btn.setAttribute('aria-label', `${sel.getAttribute('aria-label') || sel.closest('label')?.textContent?.trim() || 'Choose'}: ${label()}`);
    sel.hidden = true;
    sel.after(btn);
    btn.addEventListener('click', async () => {
      const items = [...sel.options].map((o, i) => ({ id: String(i), title: o.textContent.trim() === '·' || !o.textContent.trim() ? 'Not set' : o.textContent.trim(), checked: i === sel.selectedIndex }));
      const pick = await menu(btn, { title: sel.getAttribute('aria-label') || '', items });
      if (pick == null || Number(pick) === sel.selectedIndex) return;
      sel.selectedIndex = Number(pick);
      btn.querySelector('span').textContent = label();
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      sel.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}

/** A confirmation as Apple draws it: a sheet with the destructive action in red, never a browser alert. */
export async function confirmDestructive(anchor, { title, action = 'Delete' }) {
  const pick = await menu(anchor, { title, items: [{ id: 'yes', title: action, destructive: true }] });
  return pick === 'yes';
}
