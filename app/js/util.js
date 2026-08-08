// Small helpers. No dependencies anywhere in this app.

// ---------------------------------------------------------------- dates ----
export function todayIso() {
  return toIso(new Date());
}

export function toIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse 'YYYY-MM-DD' as a *local* date, so nothing shifts across timezones. */
export function fromIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

export function daysBetween(isoA, isoB) {
  const ms = fromIso(isoB) - fromIso(isoA);
  return Math.round(ms / 86400000);
}

/** Monday-start week containing `iso`. */
export function weekStart(iso) {
  const d = fromIso(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toIso(d);
}

export function weekDays(startIso) {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso, style = 'long') {
  const d = fromIso(iso);
  if (style === 'short') return `${MON[d.getMonth()]} ${d.getDate()}`;
  if (style === 'dow') return DOW[d.getDay()];
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function fmtDateNum(iso) {
  const d = fromIso(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

/** Whole weeks + leftover days since a surgery date. */
export function postOp(surgeryIso, onIso) {
  if (!surgeryIso) return null;
  const days = daysBetween(surgeryIso, onIso);
  if (days < 0) return { days, weeks: 0, rem: 0, future: true };
  return { days, weeks: Math.floor(days / 7), rem: days % 7, months: days / 30.4375, future: false };
}

// ----------------------------------------------------------------- html ----
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ---------------------------------------------------------------- units ----
const LB_PER_KG = 2.2046226218;
const CM_PER_IN = 2.54;

export function toKg(value, unit) {
  return unit === 'lb' ? value / LB_PER_KG : value;
}
export function fromKg(kg, unit) {
  return unit === 'lb' ? kg * LB_PER_KG : kg;
}
export function toCm(value, unit) {
  return unit === 'in' ? value * CM_PER_IN : value;
}
export function fromCm(cm, unit) {
  return unit === 'in' ? cm / CM_PER_IN : cm;
}

/** Convert a stored {value, unit} into the user's current display unit. */
export function displayValue(value, storedUnit, wantUnit) {
  if (value === null || value === undefined || storedUnit === wantUnit) return value;
  if (storedUnit === 'kg' || storedUnit === 'lb') return round(fromKg(toKg(value, storedUnit), wantUnit), 1);
  if (storedUnit === 'cm' || storedUnit === 'in') return round(fromCm(toCm(value, storedUnit), wantUnit), 1);
  return value;
}

export function round(n, places = 0) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ misc ----
/** Limb symmetry index, involved / other * 100. */
export function lsi(involved, other) {
  if (!other || involved === null || involved === undefined) return null;
  return round((involved / other) * 100, 1);
}

/** 1 -> "1st", 11 -> "11th", 71 -> "71st" */
export function ord(n) {
  const i = Math.abs(Math.round(n));
  const rem100 = i % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][i % 10] || 'th'}`;
}

export function pct(done, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ------------------------------------------------------------------ theme ---
/**
 * Apply the chosen theme. 'auto' removes the attribute so the CSS falls back to
 * the device's own preference; 'light'/'dark' force it.
 *
 * Also updates <meta name="theme-color">, which is what iOS paints behind the
 * status bar in an installed app — leaving it fixed makes a light theme look
 * broken at the very top of the screen.
 */
export const THEME_KEY = 'rehab.theme';

export function applyTheme(pref) {
  const root = document.documentElement;
  try { localStorage.setItem(THEME_KEY, pref || 'light'); } catch { /* private mode */ }
  if (pref === 'light' || pref === 'dark') root.setAttribute('data-theme', pref);
  else root.removeAttribute('data-theme');

  const dark = pref === 'dark'
    || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0e1116' : '#f6f7f9');
  return dark;
}

/**
 * Apply the remembered theme synchronously at startup, before any data has
 * loaded. Without this a device set to dark shows a dark flash while the
 * document is read, then snaps to light.
 */
export function applyStoredTheme() {
  let pref = 'light';
  try { pref = localStorage.getItem(THEME_KEY) || 'light'; } catch { /* ignore */ }
  return applyTheme(pref);
}
