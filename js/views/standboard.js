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
import { activeGoal, gapWords, goalLabel, goalWho, meets, goalsFor } from '../clinicgoals.js';
import { kitChart, bindKitCharts, bulletBar, fitBulletLabels, menu, sheet, nativeSpec, msOf, isoOf, nfmt, CHECK as KCHECK, CHEV } from './pkit.js';
import { closeModal } from '../components.js';
import { isForce, convertForce, FORCE_UNITS } from '../trend.js';
import { figCrop, sheetOrder } from './figure.js';
import { haptic } from '../native-bridge.js';

// One force unit on every Progress screen, the one Trends shows: pounds unless he picked
// another there (04 E2, C52; fix d-progress:d2: the region sheet printed newtons under a
// headline in pounds). The stored value never changes; this is the view only.
export function forceShown() {
  try { const v = localStorage.getItem('rehab.trend.force'); if (FORCE_UNITS.includes(v)) return v; } catch { /* per device */ }
  return 'lb';
}
/** A value of measure m in the unit it is shown in (force converted, everything else as stored). */
export const shownValue = (m, v) => (isForce(m) && typeof v === 'number' ? round(convertForce(v, m.unit, forceShown()), 1) : v);
/** A leg map ({ L, R, B }) with each value in the unit it is shown in. */
const shownLegs = (m, legs) => (legs && isForce(m)
  ? Object.fromEntries(Object.entries(legs).map(([k, r]) => [k, r && { ...r, value: shownValue(m, r.value) }])) : legs);

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
    const d = isForce(m) ? shownValue(m, s.delta) : s.delta;
    const sign = d > 0 ? '+' : '';
    const u = isForce(m) ? forceShown() : unitOf(m, legs[leg || 'B']);
    const val = u === '°' || u === '%' ? `${sign}${d}${u}` : `${sign}${d} ${u}`.trim();
    parts.push({ leg, val, from: s.from });
  }
  if (!parts.length) return '';
  // Each fact once (d22): one "since" date when both legs share it.
  if (parts.length === 2 && parts[0].from === parts[1].from) return `Left ${parts[0].val}, right ${parts[1].val} since ${fmtDate(parts[0].from, 'short')}`;
  return parts.map((x) => `${x.leg === 'L' ? 'Left' : x.leg === 'R' ? 'Right' : ''} ${x.val} since ${fmtDate(x.from, 'short')}`.trim()).join(' · ');
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
export function ageWords(iso) {
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

export function goalsForStrip() {
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

/** The card board of 2026-09-16, kept for a wide layout (iPad) and as the record of the old design. */
export function renderCardBoard() {
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
export const SIL_VIEW = '364 256 112 250';
// Each hotspot is closed from the figure's own strokes (outer and inner leg
// lines sampled every 3 units), so a selected region IS the body part. The
// thigh is split at 64% from the outer line: outer part Quads, inner strip
// Hamstrings. Built by a script from the asset; regenerate rather than edit.
export const HOTS = {
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

export function bindCardBoard(root, ctx, rerender) {
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

// ==================================================================== v3 board ==
// Rehab Test v3 (2026-09-30): "Where you stand" as ONE screen (research 04 E1, 07 4.6 and
// 4.8: every measured region visible at once; a region's chart in two taps). His words:
// "You had to scroll down quite a bit to see each thing." (2026-09-30).
//
// A butterfly stack: one row per region in his fixed anatomical order (never ranked unless
// he picks the gap order), left in blue growing left from the centre, right in orange
// growing right, both on one scale: the result over the row's reference, clipped at 130%.
// ONE goal line runs through every row at 100%, so "which regions are short" is one picture.
//   reference = his clinician's goal (a solid tick, only on the legs the goal names),
//   else the published typical mark (a dashed tick), else the stronger leg (no tick, and the
//   row says it compares the legs). Never mixed silently.
// The printed numbers are the raw results in their unit, the biggest thing in the row. No
// percentage is printed, no verdict, no red, green only on a leg that has met its goal, no
// words over a bar. Population references, per kg figures, percentiles and muscle grades
// live in the region's sheet, never on the first view (his device rule for the iPhone).

export const CLIP = 1.3;
export const SHORT_UNIT = { lb: 'lb', N: 'N', deg: '°', cm: 'cm', sec: 's', mm: 'mm', kg: 'kg', reps: 'reps' };

/** The row a region draws on the board, or null when nothing is measured. */
export function boardRow(region) {
  const withData = region.tests.map((id) => MEASURE_BY_ID[id]).filter(Boolean)
    .map((m) => ({ m, legs: latestLegs(m) })).filter((x) => x.legs);
  if (!withData.length) return null;
  const numeric = (x) => x.m.unit !== 'grade';
  const head = withData.find((x) => x.m.perLeg && numeric(x) && !x.m.lower) || withData.find((x) => x.m.perLeg && numeric(x)) || withData.find(numeric);
  if (!head) return null;
  const { m, legs } = head;
  const goal = activeGoal(m.id, legs);
  const refs = placedRefs(m).sort((a, b) => a.value - b.value);
  const typical = placedRef(m);
  const vals = [legs.L?.value, legs.R?.value, legs.B?.value].filter((v) => typeof v === 'number');
  let scale; let kind;
  if (goal) { scale = goal.value; kind = 'goal'; }
  else if (typical) { scale = typical.value; kind = 'ref'; }
  else { scale = m.lower ? Math.min(...vals) : Math.max(...vals); kind = 'legs'; }
  const frac = (v) => (typeof v !== 'number' || !scale ? null : Math.max(0, Math.min(CLIP, m.lower ? scale / Math.max(v, 1e-9) : v / scale)));
  const goalSides = goal ? (goal.legs || ['L', 'R']) : [];
  // Thin published ticks that fall inside the drawn range, placed on the same scale.
  const refTicks = kind === 'legs' ? [] : refs.map((x) => frac(x.value)).filter((f) => f != null && f <= CLIP && Math.abs(f - 1) > 0.02);
  return { region, m, legs, goal, goalSides, typical, refs, kind, scale, frac, refTicks, unit: isForce(m) ? forceShown() : unitOf(m, legs.L || legs.R || legs.B) };
}

/** The gap to the goal in a few words, each leg's number in its colour. HTML. */
function gapHtml(row) {
  const { m, legs, goal, kind } = row;
  const u = isForce(m) ? forceShown() : (SHORT_UNIT[m.unit] ?? UNIT_LABEL[m.unit] ?? '');
  if (goal) {
    const have = (goal.legs || ['L', 'R']).map((leg) => ({ leg, v: legs[leg]?.value })).filter((x) => typeof x.v === 'number');
    if (!have.length) return '';
    const short = have.filter((x) => !meets(goal, x.v));
    if (!short.length) return `<span class="bf-met">${KCHECK}At the goal</span>`;
    // The unit rides on every number (d20: "11 · 14.8 lb" read as 11 of something else).
    const gap = (v) => `${nfmt(shownValue(m, Math.abs(goal.value - v)), 1)}${u === '°' ? '°' : u ? `<small>\u00a0${esc(u)}</small>` : ''}`;
    const dir = goal.cmp === '<=' || goal.cmp === '<' ? 'to come down' : 'to go';
    return `${short.map((x) => `<b class="${x.leg}">${gap(x.v)}</b>`).join('<i> · </i>')} ${dir}`;
  }
  if (!m.perLeg) return '';
  const w = legWords(legs.L, legs.R, m.lower);
  return kind === 'legs' ? esc(w === 'Even' ? 'Legs even' : w) : esc(w);
}

function halfBar(row, leg) {
  const v = row.legs[leg]?.value;
  const f = row.frac(v);
  const goalHere = row.kind === 'goal' && row.goalSides.includes(leg);
  const met = goalHere && meets(row.goal, v);
  const tick = row.kind === 'goal' ? (goalHere ? 'goal' : '') : row.kind === 'ref' ? 'ref' : '';
  const extra = row.kind === 'goal'
    ? row.refs.map((x) => row.frac(x.value)).filter((q) => q != null && q < CLIP && Math.abs(q - 1) > 0.03).map((q) => `<b class="bf-tick ref" style="--at:${(q / CLIP).toFixed(4)}"></b>`).join('')
    : '';
  return `<span class="bf-half ${leg} ${met ? 'met' : ''}">
    ${f == null ? '<i class="bf-none"></i>' : `<i class="bf-fill" style="--p:${(f / CLIP).toFixed(4)}"></i>`}
    ${tick ? `<b class="bf-tick ${tick}" style="--at:${(1 / CLIP).toFixed(4)}"></b>` : ''}${extra}
  </span>`;
}

function numCell(row, leg) {
  const r = row.legs[leg];
  const u = isForce(row.m) ? forceShown() : SHORT_UNIT[row.m.unit] ?? '';
  return `<span class="bf-num ${leg}">${r ? `${esc(nfmt(shownValue(row.m, r.value), 1))}${u === '°' ? '°' : u ? `<small>${esc(u)}</small>` : ''}` : '<em>none</em>'}</span>`;
}

function fnGap(v) {
  const g = goalsForStrip().slice().sort((a, b) => a.value - b.value).find((x) => v < x.value);
  if (!g) return goalsForStrip().length ? `<span class="bf-met">${KCHECK}At the goal</span>` : 'of 80';
  // Which goal: the gap names it (d19: two unlabelled goal ticks and "12 to the goal").
  return `<b>${nfmt(g.value - v, 0)}</b> to ${g.stage === 'discharge' ? 'discharge' : 'goal'} ${nfmt(g.value, 0)}`;
}

/** LEFS as the eighth row: one bullet bar, 0 to 80, his clinician's marks with labels outside. */
function functionRow(bare = false) {
  const m = MEASURE_BY_ID.lefs;
  const r = m ? latest('lefs', null) : null;
  if (!r) return '';
  const marks = [];
  for (const g of goalsForStrip()) marks.push({ v: g.value, label: g.stage === 'discharge' ? `Discharge ${g.value}` : `Goal ${g.value}`, kind: 'goal' });
  const ref = placedRef(m);
  if (ref) marks.push({ v: ref.value, label: `${LEVELS[ref.r.level]} ${round(ref.value, 0)}`, kind: 'ref' });
  return `<button type="button" class="bf-row bf-fn" data-region-sheet="function" aria-label="Function, Lower Extremity Functional Scale: ${round(r.value, 0)} of 80. Open">
    <span class="bf-name">Function</span>
    <span class="bf-gap">${fnGap(r.value)}</span>
    ${bare ? '' : `<span class="bf-num B">${round(r.value, 0)}</span>`}
    <span class="bf-fnbar">${bulletBar({ value: r.value, max: 80, marks: marks.map((k) => ({ ...k, label: '' })), cls: 'B', label: `Score ${round(r.value, 0)} of 80; ${marks.map((k) => k.label).join(', ')}` })}</span>
  </button>`;
}

/**
 * `bare` (PSP-07, DESIGN-LANGUAGE Never 8): when the Standing Figure is on the page its chips
 * already carry every number and its bar the Function score, so the board keeps only what it
 * adds: the butterfly, the goal ticks, the to-go words and the order button. No number twice.
 */
export function renderBoard({ bare = false } = {}) {
  const rows = REGIONS.map(boardRow).filter(Boolean);
  if (!rows.length) return '';
  const sort = boardSort();
  const list = sort === 'gap'
    ? rows.map((x, i) => ({ x, i, g: regionGap(x.region) })).sort((a, b) => (a.g == null) - (b.g == null) || (a.g ?? 0) - (b.g ?? 0) || a.i - b.i).map((o) => o.x)
    : rows;
  const any = { goal: rows.some((r) => r.kind === 'goal'), ref: rows.some((r) => r.kind === 'ref' || r.refTicks.length || r.refs.length) };
  return `<section class="bf${bare ? ' bare' : ''}" aria-label="Where you stand, by region">
    <div class="bf-head">
      <h2>Every region</h2>
      <button type="button" class="pg-glassbtn" data-board-order aria-label="Order: ${sort === 'gap' ? 'furthest from target first' : 'by region'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg></button>
    </div>
    <div class="bf-rows">
      ${list.map((row, i) => `<button type="button" class="bf-row" data-region-sheet="${esc(row.region.id)}" style="--i:${i}"
          aria-label="${esc(`${row.region.label}, ${row.m.label}: left ${row.legs.L ? nfmt(row.legs.L.value) : 'not tested'}, right ${row.legs.R ? nfmt(row.legs.R.value) : 'not tested'} ${row.unit}. Open`)}">
        <span class="bf-name">${esc(row.region.label)}</span>
        <span class="bf-gap">${gapHtml(row)}</span>
        ${bare ? '' : numCell(row, 'L')}${halfBar(row, 'L')}<span class="bf-axis" aria-hidden="true"></span>${halfBar(row, 'R')}${bare ? '' : numCell(row, 'R')}
      </button>`).join('')}
      ${functionRow(bare)}
    </div>
    <div class="bf-key" aria-hidden="true">
      <span><i class="k-l"></i>Left</span><span><i class="k-r"></i>Right</span>
      ${any.goal ? '<span><i class="k-goal"></i>Goal</span>' : ''}${any.ref ? '<span><i class="k-ref"></i>Typical</span>' : ''}
    </div>
  </section>`;
}

export function bindBoard(root, ctx, rerender, { panel = null } = {}) {
  fitBulletLabels(root);
  // On the iPad a row picks the region in the panel beside the figure (no sheet); anywhere the
  // panel is not showing, it opens the sheet as before. `panel` is overview.js's controller.
  root.querySelectorAll('[data-region-sheet]').forEach((b) => b.addEventListener('click', () => {
    if (panel && panel.live()) panel.pick(b.dataset.regionSheet);
    else openRegionSheet(b.dataset.regionSheet, ctx, rerender);
  }));
  const bf = root.querySelector('.bf');
  if (panel && bf) {
    const mark = (e) => {
      if (!bf.isConnected) { window.removeEventListener('rt-fig-focus', mark); return; }
      bf.querySelectorAll('.bf-row[data-region-sheet]').forEach((r) => r.classList.toggle('on', panel.live() && r.dataset.regionSheet === e.detail));
    };
    window.addEventListener('rt-fig-focus', mark);
  }
  root.querySelector('[data-board-order]')?.addEventListener('click', async (e) => {
    const cur = boardSort();
    const pick = await menu(e.currentTarget, { title: 'Order', items: [
      { id: 'region', title: 'By region', checked: cur === 'region' },
      { id: 'gap', title: 'Furthest from target', checked: cur === 'gap' },
    ] });
    if (!pick || pick === cur) return;
    try { localStorage.setItem(SORT_KEY, pick); } catch { /* per device */ }
    rerender();
  });
}

// ------------------------------------------------------------- region sheet --
// Depth two (research 08 lesson 4): one region, its headline test big, one chart of both
// legs over time with his goal solid and the published marks dashed (labelled at their own
// trailing end), every other test in the region as a row with its sparkline, then the facts
// the board leaves out: per kg, VALD percentiles, muscle grades, and where each line comes from.

function seriesOf(m) {
  const legs = m.perLeg ? ['L', 'R'] : [null];
  return legs.map((leg) => {
    const rows = measurementsFor(m.id, leg).filter((r) => typeof r.value === 'number');
    const byDate = new Map();
    for (const r of rows) byDate.set(r.date, r);   // the last one entered that day
    return { key: leg || 'B', name: leg === 'L' ? 'Left' : leg === 'R' ? 'Right' : 'Result', points: [...byDate.values()].map((r) => ({ t: msOf(r.date), v: shownValue(m, r.value), iso: r.date })) };
  }).filter((s) => s.points.length);
}

function chartRules(m, legs) {
  const u = isForce(m) ? forceShown() : unitOf(m, legs?.L || legs?.R || legs?.B);
  const sv = (v) => shownValue(m, v);
  const goals = goalsFor(m.id).map((g) => ({ v: sv(g.value), label: `${g.stage === 'discharge' ? 'Discharge' : 'Goal'} ${nfmt(sv(g.value), 0)}`, kind: 'goal' }));
  const refs = placedRefs(m).map((p) => ({ v: sv(p.value), label: `${LEVELS[p.r.level]} ${nfmt(sv(p.value), 0)}`, kind: 'ref' }));
  return { rules: goals.concat(refs), u };
}

function testSpark(m, lo, hi) {
  const S = seriesOf(m);
  const ts = [...new Set(S.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
  if (ts.length < 2) return '';
  const W = 72, H = 26;
  const x = (t) => 3 + ((t - ts[0]) / (ts[ts.length - 1] - ts[0])) * (W - 6);
  const y = (v) => H - 3 - ((v - lo) / ((hi - lo) || 1)) * (H - 6);
  return `<svg class="rs-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">${S.filter((s) => s.points.length > 1).sort((a, b) => (a.key === 'R' ? -1 : b.key === 'R' ? 1 : 0)).map((s) =>
    `<polyline class="${s.key}" points="${s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}"/>`).join('')}</svg>`;
}

function regionSheetBody(region, testId, { width = null, fig = true } = {}) {
  const withData = region.tests.map((id) => MEASURE_BY_ID[id]).filter(Boolean).map((m) => ({ m, legs: latestLegs(m) })).filter((x) => x.legs);
  const row = boardRow(region);
  const pick = withData.find((x) => x.m.id === testId) || withData.find((x) => x.m.id === row?.m.id) || withData[0];
  const { m } = pick;
  const raw = pick.legs;
  // Everything on this sheet is in the unit it is shown in (d2): force in the Trends unit.
  const legs = shownLegs(m, raw);
  const p = profile();
  const { rules, u } = chartRules(m, raw);
  const date = [legs.L?.date, legs.R?.date, legs.B?.date].filter(Boolean).sort().pop();
  const setup = [m.device, m.setup].filter(Boolean).join(', ');
  const goalRaw = activeGoal(m.id, raw);
  const goal = goalRaw && isForce(m) ? { ...goalRaw, value: shownValue(m, goalRaw.value) } : goalRaw;
  // "to go" never wraps alone onto a line (d22).
  const words = (goal ? gapWords(goal, legs, u) : (m.perLeg ? legWords(legs.L, legs.R, m.lower) : '')).replace(/ (to go|to come down)$/, (x) => x.replace(/ /g, '\u00a0'));
  const S = seriesOf(m);
  const W = width ?? Math.min(560, (document.getElementById('modal-root')?.clientWidth || window.innerWidth) - 32);
  const many = new Set(S.flatMap((s) => s.points.map((p) => p.t))).size > 1;
  const chart = many ? kitChart({
    series: S, rules, unit: u, width: W, height: width ? 250 : 210, label: m.label,
    native: nativeSpec({ kind: 'strength', title: m.label, takeaway: words, unit: u, series: S, rules }),
  }) : '';
  const hero = (leg, r) => `<span class="rs-big ${leg}" data-rs-leg="${leg}" data-suffix="${u === '°' ? '°' : ''}"><small>${leg === 'L' ? 'Left' : leg === 'R' ? 'Right' : 'Result'}</small><b>${r ? esc(typeof r.value === 'number' ? nfmt(r.value, 1) : String(r.value)) + (u === '°' ? '°' : '') : '<em>none</em>'}</b>${u === '°' ? '' : `<i>${esc(u)}</i>`}</span>`;
  // Other tests in the region: one row each, both legs on a shared scale for that row.
  const others = withData.map((x) => {
    const vs = seriesOf(x.m).flatMap((s) => s.points.map((q) => q.v));
    const lo = Math.min(...vs); const hi = Math.max(...vs);
    const xu = isForce(x.m) ? forceShown() : unitOf(x.m, x.legs.L || x.legs.R || x.legs.B);
    const val = (r) => (r ? esc(typeof r.value === 'number' ? nfmt(shownValue(x.m, r.value), 1) : String(r.value)) : '·');
    return `<button type="button" class="rs-test ${x.m.id === m.id ? 'on' : ''}" data-rs-test="${esc(x.m.id)}" aria-pressed="${x.m.id === m.id}">
      <span class="rs-tname">${esc(x.m.label)}</span>
      ${x.m.unit === 'grade' || !vs.length ? '' : testSpark(x.m, lo, hi)}
      <span class="rs-tval">${x.m.perLeg ? `<b class="L">${val(x.legs.L)}</b><b class="R">${val(x.legs.R)}</b>` : `<b>${val(x.legs.B)}</b>`}<small>${esc(x.m.unit === 'grade' ? '' : xu)}</small></span>
    </button>`;
  }).join('');
  const extra = [perKgWords(m, raw, p), pctileWords(region), mmtWords(region)].filter(Boolean);
  const refs = placedRefs(m, p).sort((a, b) => a.value - b.value).map((x) => ({ ...x, value: shownValue(m, x.value) }));
  const about = [
    ...goalsFor(m.id).map((g) => (isForce(m) ? { ...g, value: shownValue(m, g.value) } : g)).map((g) => `<li><i class="k-goal"></i><span><b>${esc(goalLabel(g, u))}</b>${esc(goalWho(g))}${g.words ? `: "${esc(g.words)}"` : ''}</span></li>`),
    ...refs.map((x) => `<li><i class="k-ref"></i><span><b>${esc(`${LEVELS[x.r.level]} ${round(x.value, 0)}${/^[°%]/.test(u) ? '' : ' '}${u}${PER_BW.has(x.r.unit) ? ' at your bodyweight' : ''}`)}</b>${esc([x.r.population, x.r.protocol].filter(Boolean).join('. '))}${x.r.url ? ` <a href="${esc(x.r.url)}" target="_blank" rel="noopener">${esc(x.r.source)}</a>` : ` ${esc(x.r.source || '')}`}${x.r.caveat ? `. ${esc(x.r.caveat)}` : ''}</span></li>`),
  ];
  // Round 3 (2026-09-30): the region cut from the Standing Figure sits between the two legs'
  // numbers, both legs filled as on the figure; a tap on the figure morphs into it (figure.js).
  // On the iPad the figure stands beside this panel, so the crop would say it twice (fig: false).
  const crop = fig && figCrop(region.id) ? `<span class="rs-fig">${figCrop(region.id)}</span>` : '';
  return `<div class="rs" data-rs-region="${esc(region.id)}">
    <div class="rs-top">
      <div class="rs-title">${esc(m.label)}</div>
      <div class="rs-meta" data-rs-meta>${date ? esc(`${fmtDate(date, 'short')}, ${ageWords(date)}`) : ''}${setup ? ` · ${esc(setup)}` : ''}</div>
    </div>
    <div class="rs-hero ${crop ? 'has-fig' : ''}">${m.perLeg ? hero('L', legs.L) + crop + hero('R', legs.R) : crop + hero('B', legs.B)}</div>
    ${words ? `<div class="rs-words">${esc(words)}</div>` : ''}
    ${chart ? `<div class="rs-chart">${chart}</div>` : ''}
    ${sinceWords(m, legs) ? `<div class="rs-since">${esc(sinceWords(m, legs))}</div>` : ''}
    ${withData.length > 1 ? `<h3 class="rs-h">In ${esc(region.label.toLowerCase())}</h3><div class="rs-tests">${others}</div>` : ''}
    ${extra.length ? `<h3 class="rs-h">More numbers</h3><dl class="rs-facts">${extra.map((x) => `<div><dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd></div>`).join('')}</dl>` : ''}
    ${about.length ? `<h3 class="rs-h">${chart ? 'About these lines' : 'Goal and references'}</h3><ul class="rs-about">${about.join('')}</ul>` : ''}
    ${!goal && !refs.length && m.perLeg ? '<p class="rs-note">No goal or published reference in these units; the board compares the two legs.</p>' : ''}
    <button type="button" class="rs-more" data-rs-trends="${esc(region.id)}">Every ${esc(region.label.toLowerCase())} test${CHEV}</button>
  </div>`;
}

function functionSheetBody({ width = null } = {}) {
  const r = latest('lefs', null);
  const m = MEASURE_BY_ID.lefs;
  const marks = [];
  for (const g of goalsForStrip()) marks.push({ v: g.value, label: g.stage === 'discharge' ? `Discharge ${g.value}` : `Goal ${g.value}`, kind: 'goal' });
  const ref = r ? placedRef(m) : null;
  if (ref) marks.push({ v: ref.value, label: `${LEVELS[ref.r.level]} ${round(ref.value, 0)}`, kind: 'ref' });
  const S = seriesOf(m);
  const W = width ?? Math.min(560, window.innerWidth - 32);
  const many = new Set(S.flatMap((s) => s.points.map((p) => p.t))).size > 1;
  const rules = marks.map((k) => ({ v: k.v, label: k.label, kind: k.kind }));
  const dates = loggedDates();
  let pain = null;
  for (let i = dates.length - 1; i >= 0 && !pain; i--) {
    const c = getDay(dates[i])?.checkin || {};
    if (num(c.painL) != null || num(c.painR) != null) pain = { date: dates[i], L: num(c.painL), R: num(c.painR) };
  }
  return `<div class="rs">
    <div class="rs-top"><div class="rs-title">Lower Extremity Functional Scale</div>
      <div class="rs-meta">${r ? esc(`${fmtDate(r.date, 'short')}, ${ageWords(r.date)}`) : ''}</div></div>
    <div class="rs-hero"><span class="rs-big B"><small>Score</small><b>${r ? round(r.value, 0) : '<em>none</em>'}</b><i>of 80</i></span></div>
    ${r ? `<div class="rs-bullet">${bulletBar({ value: r.value, max: 80, marks, cls: 'B', label: `Score ${round(r.value, 0)} of 80` })}</div>` : ''}
    ${many ? `<div class="rs-chart">${kitChart({ series: S, rules, unit: 'of 80', width: W, height: width ? 230 : 190, label: 'Lower Extremity Functional Scale', native: nativeSpec({ kind: 'function', title: 'Lower Extremity Functional Scale', unit: 'of 80', series: S, rules }) })}</div>` : ''}
    ${pain ? `<div class="rs-pain">Knee pain, ${esc(fmtDate(pain.date, 'short'))}: ${[pain.L != null ? `<b class="L">Left ${pain.L}</b>` : '', pain.R != null ? `<b class="R">Right ${pain.R}</b>` : ''].filter(Boolean).join(', ')} of 10</div>` : ''}
    ${goalsForStrip().length ? `<h3 class="rs-h">${many ? 'About these lines' : 'Goal and references'}</h3><ul class="rs-about">${goalsForStrip().map((g) => `<li><i class="k-goal"></i><span><b>${esc(goalLabel(g, ''))}</b>${esc(goalWho(g))}</span></li>`).join('')}${ref ? `<li><i class="k-ref"></i><span><b>${esc(`${LEVELS[ref.r.level]} ${round(ref.value, 0)}`)}</b>${esc(ref.r.source || '')}</span></li>` : ''}</ul>` : ''}
  </div>`;
}

/**
 * The IPAD asks for the same regions without a sheet (his words: the iPad is "more robust and
 * capable", it should show more at once): a wide screen can afford the detail beside the figure.
 * One test for it, used by Progress > Legs. Wide AND tall, so an iPhone held sideways (852 by 393)
 * never gets it, and a narrow iPad window (Slide Over) keeps the phone's sheet.
 */
export const tablet = () => {
  try { return matchMedia('(min-width: 700px) and (min-height: 560px)').matches; } catch { return false; }
};

/**
 * One region's details with its pager and the swap-in-place tests, shared by the sheet (phone)
 * and the panel beside the figure (iPad, `inline`). The sheet paints into a modal's .mbody; the
 * panel paints into its own host and never opens or closes anything. Both announce the region
 * they are on (window event 'rt-fig-focus'), which the figure and the board outline.
 */
function regionView(ctx, rerender, list, id, { inline = false, host = null, width = () => null } = {}) {
  let cur = id;
  const nameOf = (x) => (x === 'function' ? 'Function' : REGION_BY_ID[x]?.label || x);
  const pager = () => {
    const i = list.indexOf(cur);
    if (i < 0 || list.length < 2) return '';
    const prev = list[i - 1]; const next = list[i + 1];
    return `<div class="rs-pager">
      ${prev ? `<button type="button" class="rs-pg prev" data-rs-go="${esc(prev)}" aria-label="Previous region, ${esc(nameOf(prev))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>${esc(nameOf(prev))}</button>` : '<span></span>'}
      <span class="rs-pgdots" aria-hidden="true">${list.map((x) => `<i class="${x === cur ? 'on' : ''}"></i>`).join('')}</span>
      ${next ? `<button type="button" class="rs-pg next" data-rs-go="${esc(next)}" aria-label="Next region, ${esc(nameOf(next))}">${esc(nameOf(next))}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>` : '<span></span>'}
    </div>`;
  };
  const bodyOf = (el) => (inline ? host : el.querySelector('.mbody'));
  const paint = (el, testId, dir = 0) => {
    const body = bodyOf(el);
    const region = REGION_BY_ID[cur];
    const w = width();
    body.innerHTML = pager() + (region ? regionSheetBody(region, testId, { width: w, fig: !inline }) : functionSheetBody({ width: w }));
    if (!inline) {
      const h = el.querySelector('.modal header h2');
      if (h) h.textContent = nameOf(cur);
    }
    if (dir) {
      const rs = body.querySelector('.rs');
      rs?.classList.add(dir > 0 ? 'in-next' : 'in-prev');
    }
    wire(el);
    window.dispatchEvent(new CustomEvent('rt-fig-focus', { detail: cur }));
  };
  const top0 = (el) => { if (!inline) el.querySelector('.mbody').scrollTop = 0; };
  const go = (el, to) => {
    if (!to || to === cur || !list.includes(to)) return;
    const dir = list.indexOf(to) > list.indexOf(cur) ? 1 : -1;
    cur = to;
    haptic('selection');
    paint(el, null, dir);
    top0(el);
  };
  const wire = (el) => {
    const region = REGION_BY_ID[cur];
    fitBulletLabels(el);
    const heroBig = [...el.querySelectorAll('.rs-big[data-rs-leg]')];
    const meta = el.querySelector('[data-rs-meta]');
    const keep = { big: heroBig.map((b) => b.querySelector('b').innerHTML), meta: meta?.innerHTML };
    bindKitCharts(el, {
      onScrub(t, values) {
        if (t == null) { heroBig.forEach((b, i) => { b.querySelector('b').innerHTML = keep.big[i]; }); if (meta) meta.innerHTML = keep.meta; el.querySelector('.rs-hero')?.classList.remove('scrub'); return; }
        heroBig.forEach((b) => { const v = values[b.dataset.rsLeg]; b.querySelector('b').innerHTML = v == null ? '<em>none</em>' : esc(nfmt(v, 1)) + (b.dataset.suffix || ''); });
        if (meta) meta.textContent = fmtDate(isoOf(t), 'short');
        el.querySelector('.rs-hero')?.classList.add('scrub');
      },
    });
    el.querySelectorAll('[data-rs-test]').forEach((b) => b.addEventListener('click', () => { paint(el, b.dataset.rsTest); top0(el); }));
    el.querySelectorAll('[data-rs-go]').forEach((b) => b.addEventListener('click', () => go(el, b.dataset.rsGo)));
    el.querySelector('[data-rs-trends]')?.addEventListener('click', () => {
      if (!inline) closeModal({ restore: false });
      ctx.gtab = 'trends'; ctx.region = region?.id || cur; rerender(); window.scrollTo(0, 0);
    });
  };
  return { paint, go, wire, current: () => cur };
}

const regionList = (order) => (order && order.length ? order : sheetOrder()).filter((x) => x === 'function' || REGION_BY_ID[x]);

/**
 * The iPad's detail panel (Progress > Legs): the region's numbers, chart, tests and sources in
 * place beside the Standing Figure, no sheet. Returns { select(id), current(), repaint() }.
 * `width` is read at each paint, so a rotation that widens the column redraws the chart to fit.
 */
export function mountRegionPanel(host, id, ctx, rerender, { order = null } = {}) {
  const list = regionList(order);
  const start = list.includes(id) ? id : list[0];
  const v = regionView(ctx, rerender, list, start, { inline: true, host, width: () => Math.max(260, Math.min(640, host.clientWidth - 36)) });
  v.paint(host, null);
  return { select: (to) => v.go(host, to), current: v.current, repaint: () => v.paint(host, null) };
}

/**
 * Open a region's sheet; tapping a test inside swaps the hero in place.
 * Round 3 (2026-09-30, plan 1C): a sideways swipe, or the named arrows at the top, moves to the
 * next region down or up the body (figure.js `sheetOrder`: Function, then hips to feet), and the
 * figure behind outlines the region the sheet is on (window event 'rt-fig-focus').
 */
export function openRegionSheet(id, ctx, rerender, { order = null } = {}) {
  const list = regionList(order);
  const view = regionView(ctx, rerender, list, id);
  sheet({
    title: (id === 'function' ? 'Function' : REGION_BY_ID[id]?.label || id), body: '', cls: 'rs-sheet',
    onMount: (el) => {
      view.paint(el, null);
      // A sideways swipe anywhere on the sheet, but never one that started on a chart (a drag
      // there scrubs) and never a mostly vertical one (that scrolls or pulls the sheet down).
      const body = el.querySelector('.mbody');
      let sx = 0; let sy = 0; let ok = false;
      body.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        ok = !!t && e.touches.length === 1 && !e.target.closest('.kc, .rs-tests');
        if (ok) { sx = t.clientX; sy = t.clientY; }
      }, { passive: true });
      body.addEventListener('touchend', (e) => {
        if (!ok) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx; const dy = t.clientY - sy;
        if (Math.abs(dx) < 56 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
        const i = list.indexOf(view.current());
        view.go(el, list[i + (dx < 0 ? 1 : -1)]);
      }, { passive: true });
    },
  });
}
