// Progress > Overview: the simple view (2026-09-16). One card per body region,
// a graphic that matches what was measured (paired bullet bars for strength,
// goniometer arcs for knee range, count columns for calves, paired bars for
// balance), the printed values as the largest text, one line of arithmetic,
// the reference as a thin neutral rail, and a turquoise View details action
// into Trends. Never a verdict, never a percentage bigger than the number it
// came from, never words over a graphic. Direction: ChatGPT 16 Sep, checked
// against his rules; design record PROGRESS-DESIGN-2026-09-16.local.md.
//
// 2026-09-18, when a card read "typical" against a clinician's assessment:
// the card leads with his clinician's goal when there is one (a solid rail,
// the gap to it as the words), left against right is a second line (when both
// legs are affected, even legs say nothing about strength), every published
// reference is drawn,
// not only the lowest, strength also reads per kg of bodyweight, and the VALD
// percentiles and manual muscle test grades already in his record are printed.

import { esc, round, fmtDate, num, toKg, fromKg } from '../util.js';
import { state, latest, measurementsFor, getDay, loggedDates } from '../store.js';
import { MEASURE_BY_ID, UNIT_LABEL, CATEGORIES } from '../../data/measurements.js';
import { refsFor, inMeasureUnit, ageFrom, LEVELS } from '../../data/norms.js';
import { bodyweightKg } from '../goals.js';
import { activeGoal, gapWords, goalLabel, goalWho } from '../clinicgoals.js';

// Fixed anatomical order, his choice, never ranked. `tests` lists the
// measures that belong to the region, headline first; the card draws the
// first one with a result.
export const REGIONS = [
  { id: 'quads', label: 'Quads', cat: 'strength', graphic: 'bars',
    tests: ['hhd_knee_ext', 'dyno_knee_ext', 'fp_squat_peak_force', 'fp_squat_con_power', 'fp_squat_ecc_power', 'fp_squat_depth', 'squat_1rm', 'leg_press_1rm'] },
  { id: 'hamstrings', label: 'Hamstrings', cat: 'strength', graphic: 'bars',
    tests: ['hhd_hamstring_30', 'dyno_knee_flex', 'hamstring_9090', 'sl_bridge'] },
  { id: 'hips', label: 'Hips', cat: 'strength', graphic: 'rows',
    tests: ['hhd_hip_abd', 'hhd_hip_flex', 'hhd_hip_add', 'hhd_hip_er', 'dyno_hip_abd', 'dyno_hip_ext', 'hip_flexion', 'hip_ir', 'hip_er', 'side_bridge'] },
  { id: 'calves', label: 'Calves', cat: 'strength', graphic: 'columns',
    tests: ['sl_calf_raise'] },
  { id: 'balance', label: 'Balance', cat: 'balance', graphic: 'bars',
    tests: ['ybt_anterior', 'balance_eyes_open', 'balance_eyes_closed', 'sl_foam_task', 'sebt_composite', 'fp_sls_excursion', 'fp_sls_velocity', 'fp_qs_excursion', 'fp_qs_velocity', 'lateral_step_up', 'sl_squat_reps'] },
  { id: 'knee', label: 'Knee range', cat: 'mobility', graphic: 'arcs',
    tests: ['knee_flexion', 'knee_hyperextension', 'knee_extension', 'extension_lag', 'prone_hang', 'girth_thigh_10', 'girth_thigh_20', 'girth_midpatella', 'effusion'] },
  { id: 'hops', label: 'Hops and jumps', cat: 'impact', graphic: 'bars',
    tests: ['single_hop', 'triple_hop', 'triple_crossover_hop', 'side_hop', 'repeated_hops', 'fp_cmj_height', 'fp_cmj_power_bm', 'fp_cmj_asym', 'fp_slcmj_height', 'fp_imtp_peak'] },
];
export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// ------------------------------------------------------------- arithmetic --
function profile() {
  const s = state.data.settings || {};
  return { sex: s.sex || null, age: ageFrom(s.dob), bw: bodyweightKg(), weightUnit: s.weightUnit || 'kg' };
}

/** The reference that can be placed for a measure: typical first, then young adults, then athlete. */
export function placedRef(m, p = profile()) {
  const order = ['typical', 'young', 'athlete'];
  const refs = refsFor(m.id, { sex: p.sex, age: p.age })
    .map((r) => ({ r, ...inMeasureUnit(r, m, p.bw, { weightUnit: p.weightUnit }) }))
    .filter((x) => x.value != null)
    .sort((a, b) => order.indexOf(a.r.level) - order.indexOf(b.r.level));
  return refs[0] || null;
}

/** All placeable references for a measure, for the expanded charts. */
export function placedRefs(m, p = profile()) {
  return refsFor(m.id, { sex: p.sex, age: p.age })
    .map((r) => ({ r, ...inMeasureUnit(r, m, p.bw, { weightUnit: p.weightUnit }) }))
    .filter((x) => x.value != null);
}

const unitOf = (m, r) => (m.unit === 'weight' ? (r?.unit || state.data.settings.weightUnit || 'kg') : UNIT_LABEL[m.unit] || '');

/** Latest result per leg (or the single latest), with the dates they were taken. */
export function latestLegs(m) {
  if (!m.perLeg) { const B = latest(m.id, null); return B ? { B } : null; }
  const L = latest(m.id, 'L'); const R = latest(m.id, 'R');
  return L || R ? { L, R } : null;
}

/** "Left 5% ahead of right", "Even", or "Left only". Arithmetic on the two printed numbers. */
export function legWords(L, R, lower = false) {
  if (!L || !R) return L ? 'Left only' : 'Right only';
  if (L.value === R.value) return 'Even';
  // A grade ("Trace", "4/5") has no percentage: it read "Right NaN% ahead".
  if (typeof L.value !== 'number' || typeof R.value !== 'number') return '';
  // The gap as a share of the larger number, whichever way is better.
  const big = Math.max(Math.abs(L.value), Math.abs(R.value)) || 1;
  const pct = Math.round(Math.abs(L.value - R.value) / big * 100);
  const lead = (lower ? (L.value < R.value) : (L.value > R.value)) ? 'Left' : 'Right';
  return `${lead} ${pct}% ahead`;
}

/** The change since the previous result of the SAME test and leg, or null. */
export function sinceLast(m, leg) {
  const rows = measurementsFor(m.id, leg).filter((r) => typeof r.value === 'number');
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const prev = rows.slice(0, -1).filter((r) => r.date < last.date).pop();
  if (!prev) return null;
  // Two weights in different units are compared in the newer one's unit.
  const was = m.unit === 'weight' && prev.unit && last.unit && prev.unit !== last.unit
    ? fromKg(toKg(prev.value, prev.unit), last.unit) : prev.value;
  return { delta: round(last.value - was, 2), from: prev.date, to: last.date };
}

function sinceWords(m, legs) {
  const parts = [];
  for (const leg of m.perLeg ? ['L', 'R'] : [null]) {
    const s = sinceLast(m, leg);
    if (!s) continue;
    const sign = s.delta > 0 ? '+' : '';
    const u = unitOf(m, legs[leg || 'B']);
    const val = u === '°' || u === '%' ? `${sign}${s.delta}${u}` : `${sign}${s.delta} ${u}`.trim();
    parts.push(`${leg === 'L' ? 'Left' : leg === 'R' ? 'Right' : ''} ${val} since ${fmtDate(s.from, 'short')}`.trim());
  }
  return parts.length ? parts.join(' · ') : 'No like-for-like repeat yet';
}

/** A tiny sparkline for one leg when the same test has two or more dates. */
function spark(m, leg, cls) {
  const rows = measurementsFor(m.id, leg).filter((r) => typeof r.value === 'number');
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  if (dates.length < 2) return '';
  const pts = dates.map((d) => rows.filter((r) => r.date === d).pop());
  const vals = pts.map((r) => r.value);
  const lo = Math.min(...vals); const hi = Math.max(...vals);
  const W = 64; const H = 18;
  const px = (i) => 3 + (i / (pts.length - 1)) * (W - 6);
  const py = (v) => H - 3 - ((v - lo) / ((hi - lo) || 1)) * (H - 6);
  return `<svg class="rspark ${cls}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.map((r, i) => `${px(i).toFixed(1)},${py(r.value).toFixed(1)}`).join(' ')}"/></svg>`;
}

// ---------------------------------------------------------------- graphics --
const fmtV = (m, r) => (r ? `${round(r.value, 1)}` : '·');

/**
 * Paired bullet bars: left over right on one scale. `rails` are the marks
 * across both bars: the clinician's goal solid, published references thin.
 */
function bulletBars(m, legs, rails = []) {
  const vals = [legs.L?.value, legs.R?.value, ...rails.map((x) => x.value)].filter((v) => typeof v === 'number');
  const max = (Math.max(...vals) || 1) * 1.12;
  const w = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  const marks = rails.map((x) => `<b class="rrail ${x.cls}" style="left:${w(x.value)}"></b>`).join('');
  const row = (leg, r) => `<div class="rbar ${leg}">
      <span class="rbar-leg">${leg}</span>
      <span class="rbar-track"><i style="width:${r ? w(r.value) : 0}"></i>${marks}</span>
      <span class="rbar-val">${esc(fmtV(m, r))}<small>${esc(unitOf(m, r))}</small></span>
    </div>`;
  // One result for both legs is one bar, not a left bar and an empty right
  // (2026-09-22 audit: a squat 1RM read "L 100 kg" and "R ·").
  if (legs.B && !legs.L && !legs.R) return `<div class="rbars one">${row('B', legs.B).replace('<span class="rbar-leg">B</span>', '<span class="rbar-leg">Both</span>')}</div>`;
  return `<div class="rbars">${row('L', legs.L)}${row('R', legs.R)}</div>`;
}

/** Count columns for reps, one per leg, each mark as a rule across both. */
function countColumns(m, legs, rails = []) {
  const vals = [legs.L?.value, legs.R?.value, ...rails.map((x) => x.value)].filter((v) => typeof v === 'number');
  const max = (Math.max(...vals) || 1) * 1.12;
  const h = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  // The reference is a rule inside each column's track, on the same scale, so
  // it never crosses the printed numbers above.
  const marks = rails.map((x) => `<b class="rrule ${x.cls}" style="bottom:${h(x.value)}"></b>`).join('');
  const col = (leg, r) => `<div class="rcol ${leg}"><span class="rcol-val">${esc(fmtV(m, r))}<small>${esc(unitOf(m, r))}</small></span><span class="rcol-track"><i style="height:${r ? h(r.value) : 0}"></i>${marks}</span><span class="rcol-leg">${leg}</span></div>`;
  return `<div class="rcols">${col('L', legs.L)}${col('R', legs.R)}</div>`;
}

/** Goniometer arcs: a half circle per leg, the measured flexion drawn from straight. */
function gonioArcs(legsFlex, legsHyper) {
  const arc = (leg, flex, hyper) => {
    const R = 34; const cx = 44; const cy = 44;
    const p = (deg) => { const a = Math.PI - (deg / 180) * Math.PI; return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; };
    const [x1, y1] = p(0); const f = Math.min(180, Math.max(0, flex || 0)); const [x2, y2] = p(f);
    const hy = Math.max(0, hyper || 0);
    const [hx, hyy] = [cx + R * Math.cos(Math.PI + (hy / 180) * Math.PI), cy - R * Math.sin(Math.PI + (hy / 180) * Math.PI)];
    return `<svg class="rarc ${leg}" viewBox="0 0 88 56" aria-hidden="true">
      <path class="track" d="M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}"/>
      ${flex ? `<path class="range" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${f > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}"/>` : ''}
      ${hy ? `<path class="hyper" d="M ${cx - R} ${cy} A ${R} ${R} 0 0 0 ${hx.toFixed(1)} ${hyy.toFixed(1)}"/>` : ''}
    </svg>`;
  };
  const cell = (leg) => {
    const f = legsFlex?.[leg]; const h = legsHyper?.[leg];
    return `<div class="rgon ${leg}">${arc(leg, f?.value, h?.value)}
      <span class="rgon-val">${f ? `${h?.value ? `${round(h.value, 0)}-` : ''}0-${round(f.value, 0)}` : '·'}<small>°</small></span><span class="rgon-leg">${leg}</span></div>`;
  };
  return `<div class="rgons">${cell('L')}${cell('R')}</div>`;
}

/** Compact rows of paired bars for several movements at once (hips). */
function pairedRows(ms) {
  const rows = ms.map(({ m, legs }) => {
    const vals = [legs.L?.value, legs.R?.value].filter((v) => typeof v === 'number');
    const max = (Math.max(...vals) || 1) * 1.05;
    const w = (r) => `${r ? Math.max(0, Math.min(100, (r.value / max) * 100)).toFixed(1) : 0}%`;
    return `<div class="rrow">
      <span class="rrow-name">${esc(m.label)}</span>
      <span class="rrow-bars"><i class="L" style="width:${w(legs.L)}"></i><i class="R" style="width:${w(legs.R)}"></i></span>
      <span class="rrow-vals"><b class="L">${esc(fmtV(m, legs.L))}</b><b class="R">${esc(fmtV(m, legs.R))}</b><small>${esc(unitOf(m, legs.L || legs.R))}</small></span>
    </div>`;
  });
  return `<div class="rrows">${rows.join('')}</div>`;
}

// ------------------------------------------------------------------ cards --
// Manual muscle test grades that belong to a region, printed under it when his
// record holds one (the clinic's own grade, a different kind of number).
const REGION_MMT = { quads: ['mmt_knee_ext'], hamstrings: ['mmt_knee_flex'], hips: ['mmt_hip_abd', 'mmt_hip_ext'] };

const N_PER_LB = 4.4482216;
const PER_BW = new Set(['N/kg', 'kg/kg', 'xBW']);   // references scaled by his bodyweight
const ORD = (n) => { const k = Math.round(n); const t = k % 100; return `${k}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] || 'th'}`; };

/** "6 days ago", "today", from an ISO date. */
function ageWords(iso) {
  if (!iso) return '';
  const a = new Date(iso + 'T12:00:00'); const b = new Date(); b.setHours(12, 0, 0, 0);
  const days = Math.round((b - a) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30.4)} months ago`;
}

/** Strength in newtons per kilogram of bodyweight, per leg, when both can be known. */
function perKgWords(m, legs, p) {
  if (!p.bw || !m.perLeg || !['lb', 'N'].includes(m.unit)) return '';
  const nkg = (r) => (r && typeof r.value === 'number' ? (m.unit === 'lb' ? r.value * N_PER_LB : r.value) / p.bw : null);
  const L = nkg(legs.L); const R = nkg(legs.R);
  if (L == null && R == null) return '';
  const legsTxt = [L != null ? `left ${L.toFixed(2)}` : '', R != null ? `right ${R.toFixed(2)}` : ''].filter(Boolean).join(', ');
  return { k: 'Per kg of bodyweight', v: `${legsTxt} N/kg` };
}

/** VALD percentiles already in his record for the region's tests, one clause per test. */
function pctileWords(region) {
  const bits = [];
  for (const id of region.tests) {
    const m = MEASURE_BY_ID[id];
    if (!m) continue;
    const got = (m.perLeg ? ['L', 'R'] : [null]).map((leg) => ({ leg, r: latest(id, leg) })).filter((x) => x.r && x.r.pctile != null);
    if (!got.length) continue;
    const name = m.label.replace(/, per kg bodyweight$/i, '');
    const text = got.length === 1 && !got[0].leg
      ? `${name}: ${ORD(got[0].r.pctile)} percentile`
      : `${name}: ${got.map((x) => `${x.leg === 'L' ? 'left' : 'right'} ${ORD(x.r.pctile)}`).join(', ')} percentile`;
    bits.push({ text, date: got.map((x) => x.r.date).sort().pop() });
  }
  if (!bits.length) return '';
  // One date when every clause shares it; otherwise each clause carries its
  // own, so no result is stamped with another test's date (2026-09-22 audit).
  const dates = new Set(bits.map((b) => b.date));
  if (dates.size === 1) return { k: `VALD, ${fmtDate(bits[0].date, 'short')}`, v: bits.map((b) => b.text).join(' · ') };
  return { k: 'VALD', v: bits.map((b) => `${b.text}, ${fmtDate(b.date, 'short')}`).join(' · ') };
}

/** The latest manual muscle test grades for the region: the newest session only. */
function mmtWords(region) {
  const rows = [];
  for (const id of REGION_MMT[region.id] || []) {
    const m = MEASURE_BY_ID[id];
    if (!m) continue;
    const L = latest(id, 'L'); const R = latest(id, 'R');
    if (!L && !R) continue;
    rows.push({ m, L, R, date: [L?.date, R?.date].filter(Boolean).sort().pop() });
  }
  if (!rows.length) return '';
  // Only the grades from the newest date: an older test is not re-dated by a
  // newer one printed beside it (2026-09-22 audit).
  const date = rows.map((x) => x.date).sort().pop();
  const bits = rows.filter((x) => x.date === date)
    .map(({ m, L, R }) => `${m.label.toLowerCase()} ${L ? `left ${L.value}` : ''}${L && R ? ', ' : ''}${R ? `right ${R.value}` : ''}`);
  return { k: `Muscle test, ${fmtDate(date, 'short')}`, v: bits.join(' · ') };
}

export function regionCard(region) {
  const p = profile();
  const withData = region.tests.map((id) => MEASURE_BY_ID[id]).filter(Boolean)
    .map((m) => ({ m, legs: latestLegs(m) })).filter((x) => x.legs);
  if (!withData.length) return '';   // nothing measured yet: no card, no grey ring
  // A number heads the card; a grade only when nothing else is measured
  // (2026-09-22 audit: effusion alone put NaN and empty arcs on the card).
  const numeric = (x) => x.m.unit !== 'grade';
  const head = withData.find((x) => x.m.perLeg && numeric(x)) || withData.find(numeric) || withData[0];
  const m = head.m; const legs = head.legs;
  const refs = placedRefs(m, p).sort((a, b) => a.value - b.value);
  const goal = activeGoal(m.id, legs);
  const u = unitOf(m, legs.L || legs.R || legs.B);
  const date = [legs.L?.date, legs.R?.date, legs.B?.date].filter(Boolean).sort().pop();
  const setup = [m.device, m.setup].filter(Boolean).join(', ');
  // The goal is the solid rail; every placeable published reference a thin one.
  const rails = [...(goal ? [{ value: goal.value, cls: 'goal' }] : []), ...refs.map((x) => ({ value: x.value, cls: 'ref' }))];
  let graphic;
  if (region.graphic === 'arcs') {
    const flex = latestLegs(MEASURE_BY_ID.knee_flexion) || {};
    const hyper = latestLegs(MEASURE_BY_ID.knee_hyperextension) || {};
    graphic = gonioArcs(flex, hyper);
  } else if (region.graphic === 'rows') {
    graphic = pairedRows(withData.filter((x) => x.m.perLeg && !x.m.lower).slice(0, 4));
  } else if (region.graphic === 'columns') {
    graphic = countColumns(m, legs, rails);
  } else {
    graphic = bulletBars(m, m.perLeg ? legs : { B: legs.B }, rails);
  }
  // The words: the gap to his clinician's goal first. Without a goal, when both
  // legs sit under every published mark, that is said before any left against
  // right, which alone cannot show a weakness both knees share.
  const sym = m.perLeg ? legWords(legs.L, legs.R, m.lower) : '';
  let words = '';
  let second = '';
  if (goal) {
    words = gapWords(goal, legs, u);
    second = sym;
  } else if (region.cat === 'strength' && m.perLeg && refs.length
    && [legs.L, legs.R].every((r) => r && refs.every((x) => (m.lower ? r.value > x.value : r.value < x.value)))) {
    words = `Both legs below the ${LEVELS[refs[0].r.level].toLowerCase()} mark`;
    second = sym;
  } else {
    words = sym;
  }
  const refLines = [
    ...(goal ? [`<span class="rref-line goal"><i class="rk goal" aria-hidden="true"></i>${esc(goalLabel(goal, u))}, ${esc(goalWho(goal))}</span>`] : []),
    ...refs.map((x) => `<span class="rref-line"><i class="rk" aria-hidden="true"></i>${esc(`${LEVELS[x.r.level]} ${round(x.value, 0)}${/^[°%]/.test(u) ? '' : ' '}${u}${PER_BW.has(x.r.unit) ? ' at your bodyweight' : ''}, ${x.r.source.split(',')[0]}`)}</span>`),
    ...refs.filter((x) => x.r.caveat).map((x) => `<span class="rref-line note">${esc(x.r.caveat)}</span>`),
  ];
  if (!goal && !refs.length && m.perLeg) refLines.push(`<span class="rref-line">No goal or published reference in these units; left against right</span>`);
  const extra = [perKgWords(m, legs, p), pctileWords(region), mmtWords(region)].filter(Boolean);
  const sparks = m.perLeg ? spark(m, 'L', 'L') + spark(m, 'R', 'R') : spark(m, null, 'B');
  const age = ageWords(date);
  return `<article class="rcard" data-region="${esc(region.id)}">
    <header class="rcard-head">
      <span class="rcat" style="--c:${CATEGORIES[region.cat]?.color || 'var(--ink-3)'}">${esc(region.label)}</span>
      <span class="rcard-title">${esc(m.label)}</span>
      <span class="rcard-meta">${date ? esc(`${fmtDate(date, 'short')}${age ? `, ${age}` : ''}`) : ''}${setup ? ` · ${esc(setup)}` : ''}</span>
    </header>
    <div class="rcard-graphic">${graphic}</div>
    <div class="rcard-words">
      ${words ? `<span class="rwords">${esc(words)}</span>` : ''}
      ${second ? `<span class="rsym">${esc(second)}</span>` : ''}
      <span class="rsince">${esc(sinceWords(m, legs))}</span>
      ${sparks ? `<span class="rsparks">${sparks}</span>` : ''}
      ${extra.length ? `<dl class="rfacts">${extra.map((x) => `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join('')}</dl>` : ''}
      ${refLines.length ? `<span class="rref">${refLines.join('')}</span>` : ''}
    </div>
    <button class="btn sm primary rcard-more" data-region-open="${esc(region.id)}">View details</button>
  </article>`;
}

/** LEFS as one wide measure with his goal marks and the healthy reference, plus the latest pain. */
export function functionStrip() {
  const m = MEASURE_BY_ID.lefs;
  const r = latest('lefs', null);
  const ref = r ? placedRef(m) : null;
  const marks = [];
  if (ref) marks.push({ at: ref.value, label: `${LEVELS[ref.r.level]} ${round(ref.value, 0)}`, cls: 'typ' });
  // His clinician's goals on the same bar (2026-09-18): six weeks and discharge.
  for (const g of goalsForStrip()) marks.push({ at: g.value, label: g.stage === 'discharge' ? `Discharge ${g.value}` : `Goal ${g.value}`, cls: 'goal' });
  // Goal labels sit under the bar and reference labels over it, so the two
  // never collide where the marks are close (72 and 80 out of 80).
  const dates = loggedDates();
  let pain = null;
  for (let i = dates.length - 1; i >= 0 && !pain; i--) {
    const c = getDay(dates[i])?.checkin || {};
    if (num(c.painL) != null || num(c.painR) != null) pain = { date: dates[i], L: num(c.painL), R: num(c.painR) };
  }
  if (!r && !pain) return '';
  const pctW = r ? Math.max(0, Math.min(100, (r.value / 80) * 100)) : 0;
  return `<section class="fstrip" aria-label="Function">
    <div class="fstrip-l"><span class="rcat" style="--c:${CATEGORIES.recovery.color}">Function</span><span class="rcard-title">Lower Extremity Functional Scale</span>${r ? `<span class="rcard-meta">${esc(fmtDate(r.date, 'short'))}</span>` : ''}</div>
    ${r ? `<div class="fstrip-bar"><span class="track"><i style="width:${pctW.toFixed(1)}%"></i>${marks.map((k) => `<b class="rrail ${k.cls}" style="left:${((k.at / 80) * 100).toFixed(1)}%"></b>`).join('')}</span>
      <span class="fstrip-marks">${marks.filter((k) => k.cls !== 'goal').map((k) => `<span style="left:${((k.at / 80) * 100).toFixed(1)}%">${esc(k.label)}</span>`).join('')}</span>
      ${marks.some((k) => k.cls === 'goal') ? `<span class="fstrip-marks below">${marks.filter((k) => k.cls === 'goal').map((k) => `<span style="left:${((k.at / 80) * 100).toFixed(1)}%">${esc(k.label)}</span>`).join('')}</span>` : ''}</div>` : '<div></div>'}
    <div class="fstrip-r">${r ? `<span class="fstrip-big">${round(r.value, 0)}<small> of 80</small></span>` : ''}${pain ? `<span class="fstrip-pain">Pain ${pain.L != null ? `<b class="L">L ${pain.L}</b>` : ''} ${pain.R != null ? `<b class="R">R ${pain.R}</b>` : ''}<small> of 10, ${esc(fmtDate(pain.date, 'short'))}</small></span>` : ''}</div>
  </section>`;
}

function goalsForStrip() {
  return (state.data?.caseFile?.goals || []).filter((g) => g && g.measure === 'lefs' && typeof g.value === 'number');
}

const SORT_KEY = 'rehab.board.sort';
export function boardSort() { try { return localStorage.getItem(SORT_KEY) === 'gap' ? 'gap' : 'region'; } catch { return 'region'; } }

/**
 * The weaker leg's share of the target: his clinician's goal when there is
 * one, else the typical mark; null when neither can be placed.
 */
export function regionGap(region) {
  const head = region.tests.map((id) => MEASURE_BY_ID[id]).filter(Boolean).map((m) => ({ m, legs: latestLegs(m) })).filter((x) => x.legs);
  const x = head.find((h) => h.m.perLeg && h.m.unit !== 'grade') || head.find((h) => h.m.unit !== 'grade') || head[0];
  if (!x) return null;
  const goal = activeGoal(x.m.id, x.legs);
  const ref = goal ? { value: goal.value } : placedRef(x.m);
  if (!ref || !ref.value) return null;
  const vals = [x.legs.L?.value, x.legs.R?.value, x.legs.B?.value].filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  const weak = x.m.lower ? Math.max(...vals) : Math.min(...vals);
  return x.m.lower ? ref.value / weak : weak / ref.value;
}

/**
 * The cards rise in the order they are drawn (B5-3, 2026-09-23): each carries
 * its place as --i, capped at 10 so the last starts by 400 ms at 40 ms a step.
 * They all rose at once before, because nothing set --i. Their bars inherit it.
 */
const staggered = (html, i) => html.replace(/^<article class="rcard"/, `<article class="rcard" style="--i:${Math.min(i, 10)}"`);

export function renderBoard() {
  const drawn = REGIONS.map((r) => ({ r, html: regionCard(r) })).filter((x) => x.html);
  if (!drawn.length) return '';
  const sort = boardSort();
  // His fixed order unless he asks for the gap order: furthest from target
  // (his clinician's goal, else typical) first, regions with neither after
  // them in their usual order.
  const list = sort === 'gap'
    ? drawn.map((x, i) => ({ ...x, i, gap: regionGap(x.r) })).sort((a, b) => (a.gap == null) - (b.gap == null) || (a.gap ?? 0) - (b.gap ?? 0) || a.i - b.i)
    : drawn;
  return `${silhouette(drawn.map((x) => x.r.id))}
  <div class="board-bar">
    <span class="board-title">Where you stand</span>
    <span class="seg" role="group" aria-label="Order">
      <button class="${sort === 'region' ? 'on' : ''}" data-board-sort="region" aria-pressed="${sort === 'region'}">By region</button>
      <button class="${sort === 'gap' ? 'on' : ''}" data-board-sort="gap" aria-pressed="${sort === 'gap'}">Furthest from target</button>
    </span>
  </div>
  <section class="board" aria-label="Where you stand, by region">${list.map((x, i) => staggered(x.html, i)).join('')}</section>`;
}

// The silhouette navigator (2026-09-16, ChatGPT's idea, his yes; redrawn the
// same night on his "base it off medical literature"): the lower body from an anatomical line figure on Wikimedia Commons (Cdang, CC0),
// cropped to the waist down with the arms and genitals left out, drawn as a
// background image so the page colours it (inverted in dark mode). Hotspots
// are transparent shapes over the figure's own coordinates, one per region
// that has a card; a chosen one turns turquoise and its card is outlined and
// scrolled to. It carries no result. Hidden on a phone.
// One front view (his ask, the same night): the pelvis is Hips, the outer
// part of each thigh Quads and the inner strip Hamstrings, the knees, the
// lower legs Calves, the feet Balance. Hops and jumps has no hotspot until it
// has a card of its own.
const SIL_VIEW = '364 256 112 250';
// Each hotspot is closed from the figure's own strokes (outer and inner leg
// lines sampled every 3 units), so a selected region IS the body part. The
// thigh is split at 64% from the outer line: outer part Quads, inner strip
// Hamstrings. Built by a script from the asset; regenerate rather than edit.
const HOTS = {
  hips: { label: 'Hips', d: 'M 382.0 258.0 L 381.5 261.0 L 380.8 264.0 L 380.2 267.0 L 379.6 270.0 L 378.7 273.0 L 378.3 276.0 L 378.1 279.0 L 378.0 282.0 L 377.9 285.0 L 377.8 288.0 L 377.4 291.0 L 377.0 294.0 L 376.6 297.0 L 376.2 300.0 L 376.0 303.0 L 376.0 304.0 L 414.9 310.0 L 419.4 306.5 L 423.8 310.0 L 462.6 304.0 L 462.6 303.0 L 462.5 300.0 L 462.2 297.0 L 461.8 294.0 L 461.3 291.0 L 460.9 288.0 L 460.8 285.0 L 460.8 282.0 L 460.7 279.0 L 460.5 276.0 L 460.1 273.0 L 459.6 270.0 L 458.9 267.0 L 457.9 264.0 L 457.3 261.0 L 456.7 258.0 Z' },
  quads: { label: 'Quads', d: 'M 375.9 310.0 L 375.8 313.0 L 375.9 316.0 L 375.9 319.0 L 375.9 322.0 L 375.9 325.0 L 376.1 328.0 L 376.2 331.0 L 376.4 334.0 L 376.5 337.0 L 376.8 340.0 L 377.2 343.0 L 377.5 346.0 L 377.9 349.0 L 378.3 352.0 L 378.8 355.0 L 379.5 358.0 L 379.9 361.0 L 379.9 364.0 L 379.8 367.0 L 379.6 370.0 L 379.4 372.0 L 398.3 372.0 L 398.3 370.0 L 398.4 367.0 L 398.4 364.0 L 398.4 361.0 L 398.3 358.0 L 398.1 355.0 L 398.1 352.0 L 398.3 349.0 L 398.5 346.0 L 398.6 343.0 L 398.9 340.0 L 399.1 337.0 L 399.4 334.0 L 399.8 331.0 L 400.1 328.0 L 400.3 325.0 L 400.5 322.0 L 400.7 319.0 L 400.9 316.0 L 400.8 313.0 L 400.8 310.0 Z M 437.9 310.0 L 437.9 313.0 L 437.9 316.0 L 438.0 319.0 L 438.1 322.0 L 438.2 325.0 L 438.5 328.0 L 438.9 331.0 L 439.3 334.0 L 439.8 337.0 L 440.0 340.0 L 440.2 343.0 L 440.4 346.0 L 440.4 349.0 L 440.6 352.0 L 440.6 355.0 L 440.3 358.0 L 440.2 361.0 L 440.3 364.0 L 440.4 367.0 L 440.4 370.0 L 440.4 372.0 L 459.3 372.0 L 459.2 370.0 L 459.1 367.0 L 458.9 364.0 L 458.8 361.0 L 459.1 358.0 L 459.7 355.0 L 460.4 352.0 L 460.8 349.0 L 461.1 346.0 L 461.4 343.0 L 461.8 340.0 L 462.1 337.0 L 462.4 334.0 L 462.5 331.0 L 462.5 328.0 L 462.6 325.0 L 462.7 322.0 L 462.8 319.0 L 462.9 316.0 L 462.9 313.0 L 462.9 310.0 Z' },
  hamstrings: { label: 'Hamstrings', d: 'M 400.8 310.0 L 400.8 313.0 L 400.9 316.0 L 400.7 319.0 L 400.5 322.0 L 400.3 325.0 L 400.1 328.0 L 399.8 331.0 L 399.4 334.0 L 399.1 337.0 L 398.9 340.0 L 398.6 343.0 L 398.5 346.0 L 398.3 349.0 L 398.1 352.0 L 398.1 355.0 L 398.3 358.0 L 398.4 361.0 L 398.4 364.0 L 398.4 367.0 L 398.3 370.0 L 398.3 372.0 L 408.9 372.0 L 408.8 370.0 L 408.8 367.0 L 408.8 364.0 L 408.8 361.0 L 408.8 358.0 L 409.0 355.0 L 409.3 352.0 L 409.8 349.0 L 410.3 346.0 L 410.7 343.0 L 411.4 340.0 L 411.8 337.0 L 412.3 334.0 L 413.0 331.0 L 413.6 328.0 L 414.1 325.0 L 414.4 322.0 L 414.7 319.0 L 414.9 316.0 L 414.9 313.0 L 414.8 310.0 Z M 423.9 310.0 L 423.8 313.0 L 423.8 316.0 L 424.0 319.0 L 424.3 322.0 L 424.5 325.0 L 425.0 328.0 L 425.6 331.0 L 426.3 334.0 L 427.3 337.0 L 427.7 340.0 L 428.2 343.0 L 428.7 346.0 L 429.0 349.0 L 429.4 352.0 L 429.8 355.0 L 429.8 358.0 L 429.8 361.0 L 429.9 364.0 L 429.9 367.0 L 429.9 370.0 L 429.8 372.0 L 440.4 372.0 L 440.4 370.0 L 440.4 367.0 L 440.3 364.0 L 440.2 361.0 L 440.3 358.0 L 440.6 355.0 L 440.6 352.0 L 440.4 349.0 L 440.4 346.0 L 440.2 343.0 L 440.0 340.0 L 439.8 337.0 L 439.3 334.0 L 438.9 331.0 L 438.5 328.0 L 438.2 325.0 L 438.1 322.0 L 438.0 319.0 L 437.9 316.0 L 437.9 313.0 L 437.9 310.0 Z' },
  knee: { label: 'Knee range', d: 'M 379.3 373.0 L 379.1 376.0 L 379.3 379.0 L 379.4 382.0 L 379.2 385.0 L 378.6 388.0 L 377.9 391.0 L 377.1 394.0 L 376.3 397.0 L 375.6 400.0 L 374.9 403.0 L 374.3 406.0 L 374.0 409.0 L 373.8 412.0 L 373.7 414.0 L 400.9 414.0 L 400.7 412.0 L 400.4 409.0 L 400.4 406.0 L 400.3 403.0 L 400.4 400.0 L 402.5 397.0 L 404.1 394.0 L 405.4 391.0 L 406.6 388.0 L 407.8 385.0 L 409.0 382.0 L 409.2 379.0 L 409.2 376.0 L 408.9 373.0 Z M 429.7 373.0 L 429.6 376.0 L 429.5 379.0 L 430.0 382.0 L 430.9 385.0 L 432.0 388.0 L 433.1 391.0 L 434.5 394.0 L 436.7 397.0 L 438.0 400.0 L 438.4 403.0 L 438.3 406.0 L 438.2 409.0 L 438.0 412.0 L 437.9 414.0 L 465.0 414.0 L 465.0 412.0 L 464.8 409.0 L 464.4 406.0 L 463.8 403.0 L 463.2 400.0 L 462.4 397.0 L 461.6 394.0 L 461.0 391.0 L 460.1 388.0 L 459.4 385.0 L 459.4 382.0 L 459.4 379.0 L 459.5 376.0 L 459.4 373.0 Z' },
  calves: { label: 'Calves', d: 'M 373.6 415.0 L 373.6 418.0 L 373.8 421.0 L 374.1 424.0 L 374.6 427.0 L 374.9 430.0 L 375.2 433.0 L 375.6 436.0 L 376.2 439.0 L 376.7 442.0 L 377.1 445.0 L 377.6 448.0 L 378.4 451.0 L 379.1 454.0 L 379.7 457.0 L 380.0 460.0 L 380.1 463.0 L 380.0 466.0 L 393.5 466.0 L 393.1 463.0 L 392.5 460.0 L 392.3 457.0 L 392.2 454.0 L 392.4 451.0 L 393.0 448.0 L 394.3 445.0 L 395.0 442.0 L 395.5 439.0 L 396.0 436.0 L 396.8 433.0 L 397.8 430.0 L 398.9 427.0 L 399.9 424.0 L 400.8 421.0 L 401.2 418.0 L 401.0 415.0 Z M 437.7 415.0 L 437.5 418.0 L 437.9 421.0 L 438.7 424.0 L 439.7 427.0 L 440.8 430.0 L 441.8 433.0 L 443.0 436.0 L 443.4 439.0 L 444.1 442.0 L 444.9 445.0 L 445.6 448.0 L 446.2 451.0 L 446.6 454.0 L 446.6 457.0 L 446.2 460.0 L 445.9 463.0 L 445.3 466.0 L 458.7 466.0 L 458.6 463.0 L 458.8 460.0 L 459.1 457.0 L 459.7 454.0 L 460.4 451.0 L 461.1 448.0 L 461.7 445.0 L 462.2 442.0 L 462.7 439.0 L 463.1 436.0 L 463.4 433.0 L 463.7 430.0 L 464.0 427.0 L 464.6 424.0 L 464.9 421.0 L 465.2 418.0 L 465.1 415.0 Z' },
  balance: { label: 'Balance', d: 'M 380.0 466.0 L 379.3 469.0 L 378.4 472.0 L 380.9 475.0 L 378.9 478.0 L 377.5 481.0 L 377.0 484.0 L 375.5 487.0 L 372.6 490.0 L 369.6 493.0 L 369.4 496.0 L 369.6 498.0 L 372.9 500.2 L 380.0 501.4 L 386.0 501.2 L 391.7 499.2 L 393.8 497.0 L 394.1 496.0 L 394.0 493.0 L 392.6 490.0 L 392.8 487.0 L 393.4 484.0 L 393.9 481.0 L 394.1 478.0 L 394.4 475.0 L 395.1 472.0 L 393.7 469.0 L 393.5 466.0 Z M 445.3 466.0 L 445.1 469.0 L 443.5 472.0 L 444.2 475.0 L 444.6 478.0 L 444.8 481.0 L 445.4 484.0 L 445.9 487.0 L 446.1 490.0 L 445.0 493.0 L 444.7 496.0 L 444.8 497.0 L 447.5 499.3 L 452.5 501.2 L 459.0 501.4 L 465.9 500.1 L 469.2 498.0 L 469.4 496.0 L 469.1 493.0 L 466.2 490.0 L 463.3 487.0 L 461.9 484.0 L 461.0 481.0 L 459.3 478.0 L 460.0 475.0 L 460.5 472.0 L 459.7 469.0 L 458.7 466.0 Z' },
};
function silhouette(ids) {
  return `<div class="sil" aria-label="Regions">
    <div class="sil-art sil-front" role="img" aria-label="The legs, seen from the front">
      <svg viewBox="${SIL_VIEW}">
        ${Object.entries(HOTS).filter(([id]) => ids.includes(id)).map(([id, h]) =>
          `<path class="sil-hot" data-sil="${id}" d="${h.d}" tabindex="0" role="button" aria-label="${esc(h.label)}"><title>${esc(h.label)}</title></path>`).join('')}
      </svg>
    </div>
  </div>`;
}

/**
 * The marks on the Function strip are placed by value, so two that sit close
 * together print over each other ("Goal 52" under "Discharge 72" at 768 px).
 * After the paint, any label that overlaps the one to its left drops to a
 * second line; the bar makes room for it. Measured, never guessed: the widths
 * depend on the words and the text size.
 */
function fitMarks(root) {
  root.querySelectorAll('.fstrip-marks').forEach((row) => {
    const spans = [...row.children];
    spans.forEach((s) => s.classList.remove('lift'));
    row.classList.remove('has-lift');
    if (spans.length < 2) return;
    const laid = spans.map((s) => ({ s, r: s.getBoundingClientRect() })).sort((a, b) => a.r.left - b.r.left);
    let prev = null;
    let lifted = false;
    for (const o of laid) {
      if (prev && o.r.left < prev.right + 6) { o.s.classList.add('lift'); lifted = true; continue; }
      prev = o.r;
    }
    row.classList.toggle('has-lift', lifted);
  });
}

export function bindBoard(root, ctx, rerender) {
  fitMarks(root);
  root.querySelectorAll('[data-region-open]').forEach((b) => b.addEventListener('click', () => {
    ctx.gtab = 'trends';
    ctx.region = b.dataset.regionOpen;
    rerender();
    window.scrollTo(0, 0);
  }));
  root.querySelectorAll('[data-board-sort]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem(SORT_KEY, b.dataset.boardSort); } catch { /* per device */ }
    rerender();
  }));
  const pick = (id) => {
    root.querySelectorAll('.sil-hot').forEach((p) => p.classList.toggle('on', p.dataset.sil === id));
    root.querySelectorAll('.rcard').forEach((c) => c.classList.toggle('focus', c.dataset.region === id));
    root.querySelector(`.rcard[data-region="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  root.querySelectorAll('.sil-hot').forEach((p) => {
    p.addEventListener('click', () => pick(p.dataset.sil));
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(p.dataset.sil); } });
  });
}
