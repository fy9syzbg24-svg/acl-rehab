// Medication level model (2026-09-19). Pure functions, no DOM, no state.
//
// A two compartment model with first order absorption, the structure the
// published population models for weekly injected peptides use. Nothing about
// any particular drug lives in this file: the parameters, the reference
// schedule and the sources come from the synced document (`pk.drugs`), so the
// public shell stays generic. Amounts are in mg, volumes in L, times in hours
// inside the solver and in epoch ms at the edges.
//
// Body size enters the way the published model does it: clearances scale by
// (weight / refWt) ^ expCL, volumes by ((fat free mass + fatFrac * fat mass) /
// refWt) ^ expV, with fat free mass from Janmahasatian et al. 2005. Without a
// height the volumes fall back to total weight.

const HOUR = 3600e3;
const DAY = 86400e3;

/** Fat free mass in kg (Janmahasatian 2005). sex 'M' or 'F'. */
export function fatFreeMass(wtKg, htCm, sex = 'M') {
  if (!(wtKg > 0) || !(htCm > 0)) return null;
  const bmi = wtKg / ((htCm / 100) ** 2);
  return sex === 'F' ? (9270 * wtKg) / (8780 + 244 * bmi) : (9270 * wtKg) / (6680 + 216 * bmi);
}

/**
 * A person's parameters from the model's typical values.
 * eta multiplies ka, CL and Vc (for the between-person spread); 1 = typical.
 */
export function personParams(model, body = {}, eta = null) {
  const m = model;
  const ref = m.refWt || 70;
  const wt = body.wtKg > 0 ? body.wtKg : ref;
  const ffm = fatFreeMass(wt, body.htCm, body.sex);
  const sizeV = ffm != null && m.fatFrac != null ? (ffm + m.fatFrac * (wt - ffm)) / ref : wt / ref;
  const cl = Math.pow(wt / ref, m.expCL ?? 0.75);
  const v = Math.pow(sizeV, m.expV ?? 1);
  const e = eta || { ka: 1, CL: 1, Vc: 1 };
  return {
    ka: m.ka * e.ka,
    CL: m.CL * cl * e.CL,
    Q: m.Q * cl,
    Vc: m.Vc * v * e.Vc,
    Vp: m.Vp * v,
    F: m.F,
  };
}

/** Terminal half-life in hours for a parameter set (the slow exponent). */
export function terminalHalfLife(p) {
  const k10 = p.CL / p.Vc, k12 = p.Q / p.Vc, k21 = p.Q / p.Vp;
  const s = k10 + k12 + k21, prod = k10 * k21;
  const beta = (s - Math.sqrt(s * s - 4 * prod)) / 2;
  return Math.log(2) / beta;
}

/**
 * Simulate doses from t0 to t1 (epoch ms), fixed step, classic RK4.
 * doses: [{ t, mg }]. A dose enters the depot at the first step at or after
 * its time; with a 15 minute step that shifts a shot by at most 15 minutes.
 * Returns concentration (mg/L) and the amount absorbed into the body (mg,
 * central plus peripheral, bioavailability applied), one value per step.
 */
export function simulate(p, doses, t0, t1, stepH = 0.25) {
  const stepMs = stepH * HOUR;
  const n = Math.max(1, Math.ceil((t1 - t0) / stepMs)) + 1;
  const conc = new Float64Array(n);
  const amt = new Float64Array(n);
  const depot = new Float64Array(n);
  const ds = doses.filter((d) => d.mg > 0 && Number.isFinite(d.t)).sort((a, b) => a.t - b.t);
  const k10 = p.CL / p.Vc, k12 = p.Q / p.Vc, k21 = p.Q / p.Vp, ka = p.ka;
  let a0 = 0, a1 = 0, a2 = 0, di = 0;
  const f0 = (x0) => -ka * x0;
  const f1 = (x0, x1, x2) => ka * x0 - (k10 + k12) * x1 + k21 * x2;
  const f2 = (x1, x2) => k12 * x1 - k21 * x2;
  const h = stepH;
  for (let i = 0; i < n; i++) {
    const t = t0 + i * stepMs;
    while (di < ds.length && ds[di].t <= t) { a0 += p.F * ds[di].mg; di++; }
    conc[i] = a1 / p.Vc;
    amt[i] = a1 + a2;
    depot[i] = a0;
    const k1a = f0(a0), k1b = f1(a0, a1, a2), k1c = f2(a1, a2);
    const b0 = a0 + h / 2 * k1a, b1 = a1 + h / 2 * k1b, b2 = a2 + h / 2 * k1c;
    const k2a = f0(b0), k2b = f1(b0, b1, b2), k2c = f2(b1, b2);
    const c0 = a0 + h / 2 * k2a, c1 = a1 + h / 2 * k2b, c2 = a2 + h / 2 * k2c;
    const k3a = f0(c0), k3b = f1(c0, c1, c2), k3c = f2(c1, c2);
    const e0 = a0 + h * k3a, e1 = a1 + h * k3b, e2 = a2 + h * k3c;
    const k4a = f0(e0), k4b = f1(e0, e1, e2), k4c = f2(e1, e2);
    a0 += h / 6 * (k1a + 2 * k2a + 2 * k3a + k4a);
    a1 += h / 6 * (k1b + 2 * k2b + 2 * k3b + k4b);
    a2 += h / 6 * (k1c + 2 * k2c + 2 * k3c + k4c);
  }
  return { t0, stepMs, n, conc, amt, depot };
}

/** Linear interpolation into a simulation at time t (ms). */
export function at(sim, t, key = 'conc') {
  const arr = sim[key];
  const x = (t - sim.t0) / sim.stepMs;
  if (x <= 0) return arr[0];
  if (x >= sim.n - 1) return arr[sim.n - 1];
  const i = Math.floor(x), f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

/**
 * Steady state of a repeating schedule: enough doses that the last interval
 * no longer changes (twelve half-lives of build up), then peak, trough and
 * average concentration over that last interval, plus its time course.
 */
export function steadyState(p, mg, everyDays, stepH = 0.25) {
  const iv = everyDays * 24;
  const settleH = Math.max(12 * terminalHalfLife(p), 8 * iv);
  const count = Math.ceil(settleH / iv) + 1;
  const doses = [];
  for (let k = 0; k < count; k++) doses.push({ t: k * iv * HOUR, mg });
  const endMs = count * iv * HOUR;
  const sim = simulate(p, doses, 0, endMs, stepH);
  const from = Math.round(((count - 1) * iv * HOUR) / sim.stepMs);
  const to = Math.min(sim.n - 1, Math.round(endMs / sim.stepMs));
  let peak = -Infinity, trough = Infinity, sum = 0, cnt = 0, peakAt = 0;
  const course = [];
  for (let i = from; i <= to; i++) {
    const c = sim.conc[i];
    if (c > peak) { peak = c; peakAt = (i - from) * stepH; }
    if (c < trough) trough = c;
    if (i < to) { sum += c; cnt++; }
    course.push(c);
  }
  return { peak, trough, avg: sum / cnt, peakAtH: peakAt, course, stepH };
}

/** Deterministic random numbers, so the band never shimmers between paints. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(r) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** Log-normal multiplier with the model's between-person CV. */
function lognormal(r, cv) {
  if (!(cv > 0)) return 1;
  const w = Math.sqrt(Math.log(1 + cv * cv));
  return Math.exp(w * normal(r));
}

/**
 * The spread between people: n simulated people drawn from the model's
 * between-person variability, same doses, one hour step. Returns the 5th and
 * 95th percentile of concentration and of amount at every step.
 */
export function spread(model, body, doses, t0, t1, { n = 100, seed = 20260919, stepH = 1 } = {}) {
  const r = rng(seed);
  const iiv = model.iiv || {};
  const runs = [];
  for (let k = 0; k < n; k++) {
    const eta = { ka: lognormal(r, iiv.ka), CL: lognormal(r, iiv.CL), Vc: lognormal(r, iiv.Vc) };
    runs.push(simulate(personParams(model, body, eta), doses, t0, t1, stepH));
  }
  const steps = runs[0].n;
  const lo = new Float64Array(steps), hi = new Float64Array(steps);
  const loA = new Float64Array(steps), hiA = new Float64Array(steps);
  const col = new Float64Array(n), colA = new Float64Array(n);
  const iLo = Math.floor(0.05 * (n - 1)), iHi = Math.ceil(0.95 * (n - 1));
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < n; k++) { col[k] = runs[k].conc[i]; colA[k] = runs[k].amt[i]; }
    col.sort(); colA.sort();
    lo[i] = col[iLo]; hi[i] = col[iHi]; loA[i] = colA[iLo]; hiA[i] = colA[iHi];
  }
  return { t0, stepMs: runs[0].stepMs, n: steps, lo, hi, loA, hiA };
}

/**
 * Pen and cost arithmetic for one schedule and one pen, kept apart from the
 * model on purpose. Two views:
 *  - long run: dose rate against the pen's total, as if nothing expires;
 *  - in use window: the doses that fit inside `windowDays` of first use
 *    (day 0 to day windowDays inclusive) and inside the pen's contents; what
 *    is left then is thrown away, either because the window closed or because
 *    less than a full dose remains.
 * Priming (his report, 2026-09-19): every shot is primed with a few clicks
 * (his: 2) before the dose is dialled. The pen holds a little extra fill,
 * enough for about `prime.free` primes (his: 5, since a sixth dose runs
 * short); every prime after that comes out of the contents. With no prime
 * given nothing is lost to priming. Clicks shown for a dose never include it.
 * Clicks: a pen dials a full labelled dose in `pen.clicks` clicks, so a dose
 * is `clicks` of those when it is a whole number.
 * Sticks (his count, 2026-09-24): the dial stops at one labelled dose, so a
 * bigger dose is two or more injections, and every one is primed.
 * As sold (his measure, 2026-09-24): a pen is sold as `doses` weekly shots,
 * so its price buys `doses` weeks. Days covered beyond that are a gain, days
 * short a loss, valued at the price per week as sold.
 */
export function penMath(mg, everyDays, pen, windowDays = 30, prime = null) {
  const perDay = mg / everyDays;
  const perMg = pen.price / pen.mg;
  const eps = 1e-9;
  const pMg = prime && prime.mg > 0 ? prime.mg : 0;
  const free = prime && Number.isFinite(prime.free) ? prime.free : Infinity;
  const labelMg = pen.mg / (pen.doses || 4);
  const sticks = Math.max(1, Math.ceil(mg / labelMg - eps));
  const loss = (n) => Math.max(0, n * sticks - free) * pMg;
  const byWindow = Math.floor(windowDays / everyDays + eps) + 1;
  let shots = Math.max(0, Math.min(Math.floor(pen.mg / mg + eps), byWindow));
  while (shots > 0 && shots * mg + loss(shots) > pen.mg + eps) shots--;
  const byContent = shots < byWindow;
  const used = shots * mg;
  const primed = loss(shots);
  const left = Math.max(0, pen.mg - used - primed);
  const covered = shots * everyDays;
  const longSupply = pen.mg / perDay;
  let waste = 'none';
  if (left > 0.005) waste = byContent ? 'partial' : 'window';
  const clickMg = pen.clicks ? pen.mg / (pen.doses || 4) / pen.clicks : null;
  const clicks = clickMg ? mg / clickMg : null;
  const stickClicks = clicks != null
    ? Array.from({ length: sticks }, (_, i) => Math.min(pen.clicks, clicks - i * pen.clicks)) : null;
  const soldDays = (pen.doses || 4) * 7;
  const vsSoldDays = covered - soldDays;
  return {
    perDay, perWeek: perDay * 7, per30: perDay * 30,
    shotsPerPen: pen.mg / mg,
    shots, used, primed, left, leftPct: left / pen.mg, waste,
    clicks, wholeClicks: clicks != null && Math.abs(clicks - Math.round(clicks)) < 1e-6,
    sticks, stickClicks,
    soldDays, vsSoldDays, vsSoldValue: vsSoldDays * (pen.price / soldDays),
    costPerShot: mg * perMg,
    realCostPerShot: shots ? pen.price / shots : null,
    longSupplyDays: longSupply,
    realSupplyDays: covered,
    cost30Long: perDay * 30 * perMg,
    cost30Real: covered ? (pen.price * 30) / covered : null,
    costYearLong: perDay * 365 * perMg,
    costYearReal: covered ? (pen.price * 365) / covered : null,
  };
}

/**
 * The level that best separates craving days from clear days: predict a
 * craving below the cut, none at or above it, and keep the cut that is right
 * on the most days. Ties settle on the middle of the best run of cuts.
 * days: [{ level, craving: boolean }]. Needs both kinds to say anything.
 */
export function bestCut(days) {
  const pts = days.filter((d) => Number.isFinite(d.level)).sort((a, b) => a.level - b.level);
  const yes = pts.filter((d) => d.craving).length;
  if (pts.length < 6 || yes < 2 || pts.length - yes < 2) return null;
  // Only cuts between two of his days: a cut past either end would mean
  // "always" or "never", which is not a level (review 2026-09-19).
  const cuts = [];
  for (let i = 0; i < pts.length - 1; i++) if (pts[i + 1].level > pts[i].level) cuts.push((pts[i].level + pts[i + 1].level) / 2);
  if (!cuts.length) return null;
  let best = -1, bestCuts = [];
  for (const c of cuts) {
    const right = pts.filter((d) => (d.level < c) === d.craving).length;
    if (right > best) { best = right; bestCuts = [c]; } else if (right === best) bestCuts.push(c);
  }
  const cut = bestCuts[Math.floor((bestCuts.length - 1) / 2)];
  return { cut, right: best, total: pts.length };
}

export const MS = { HOUR, DAY };
