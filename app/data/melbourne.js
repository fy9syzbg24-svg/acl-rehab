// Melbourne ACL Rehabilitation Guide 2.0 (Cooper & Hughes) — phase criteria,
// outcome measures and the MRSS2.0 scoring tables.
//
// Test method summaries are condensed; the goal thresholds are exactly as
// printed in the guide. Tracked separately from the 6-month plan.

export const MELBOURNE_PHASES = [
  {
    id: 'preop',
    n: 0,
    name: 'Pre-op',
    title: 'Injury recovery & readiness for surgery',
    archived: true,
    keyGoals: ['Eliminate swelling', 'Regain full range of motion', 'Regain 90% quads and hamstring strength vs the other side'],
    measures: [
      { id: 'p0_ext', label: 'Passive knee extension', measure: 'knee_extension', goal: { kind: 'absolute', target: 0, cmp: '<=' }, goalText: '0°' },
      { id: 'p0_flex', label: 'Passive knee flexion', measure: 'knee_flexion', goal: { kind: 'absolute', target: 125, cmp: '>=' }, goalText: '125°+' },
      { id: 'p0_strength', label: 'Quads & hamstring strength (hand-held dynamometer)', goal: { kind: 'manual' }, goalText: '90% vs other side' },
      { id: 'p0_eff', label: 'Effusion — stroke test', measure: 'effusion', goal: { kind: 'grade', allowed: ['Zero', 'Trace', '1+'] }, goalText: 'Zero – 1+' },
      { id: 'p0_hop', label: 'Single hop test', measure: 'single_hop', goal: { kind: 'lsi', target: 90 }, goalText: '90% vs other side' },
    ],
  },

  {
    id: 'phase1',
    n: 1,
    name: 'Phase 1',
    title: 'Recovery from surgery',
    archived: true,
    keyGoals: ['Get the knee straight (full extension)', 'Settle the swelling down to mild', 'Get the quadriceps firing'],
    measures: [
      { id: 'p1_ext', label: 'Passive knee extension', measure: 'knee_extension', goal: { kind: 'absolute', target: 0, cmp: '<=' }, goalText: '0°' },
      { id: 'p1_flex', label: 'Passive knee flexion', measure: 'knee_flexion', goal: { kind: 'absolute', target: 125, cmp: '>=' }, goalText: '125°+' },
      { id: 'p1_lag', label: 'Quadriceps lag test', goal: { kind: 'manual' }, goalText: '0 to 5° lag',
        how: 'Sitting on the edge of a bed, the knee is taken into full passive extension. Hold full active extension when support is removed.' },
      { id: 'p1_eff', label: 'Effusion — stroke test', measure: 'effusion', goal: { kind: 'grade', allowed: ['Zero', 'Trace', '1+'] }, goalText: 'Zero – 1+' },
    ],
  },

  {
    id: 'phase2',
    n: 2,
    name: 'Phase 2',
    title: 'Strength and neuromuscular control',
    keyGoals: ['Regain most of your single-leg balance', 'Regain most of your muscle strength', 'Single-leg squat with good technique and alignment'],
    measures: [
      { id: 'p2_ext', label: 'Passive knee extension (prone hang)', measure: 'prone_hang',
        goal: { kind: 'absolute', target: 0, cmp: '<=' }, goalText: 'Equal to the other side',
        how: 'Prone with the lower legs off the bed. Measure the heel height difference (approx 1 cm = 1°).' },
      { id: 'p2_flex', label: 'Passive knee flexion', measure: 'knee_flexion', goal: { kind: 'absolute', target: 125, cmp: '>=' }, goalText: '125°+' },
      { id: 'p2_sls', label: 'Functional alignment — single-leg squat test', goal: { kind: 'rating', allowed: ['Good'], options: ['Poor', 'Fair', 'Good'] }, goalText: 'Good',
        how: 'Stand on one leg on a 20 cm box, arms crossed. 5 slow squats (2 s each). "Good" = balance maintained, smooth, ≥60°, no trunk or pelvic movement, no hip adduction/IR, no knee valgus, knee centre stays over the foot centre.' },
      { id: 'p2_eff', label: 'Effusion — stroke test', measure: 'effusion', goal: { kind: 'grade', allowed: ['Zero'] }, goalText: 'Zero' },
      { id: 'p2_bridge', label: 'Single-leg bridges', measure: 'sl_bridge', goal: { kind: 'hurdle_lsi', hurdle: 20, lsi: 85 }, goalText: '>85% vs other side · hurdle >20 reps' },
      { id: 'p2_calf', label: 'Single-leg calf raises', measure: 'sl_calf_raise', goal: { kind: 'hurdle_lsi', hurdle: 20, lsi: 85 }, goalText: '>85% vs other side · hurdle >20 reps' },
      { id: 'p2_sidebridge', label: 'Side bridge endurance', measure: 'side_bridge', goal: { kind: 'hurdle_lsi', hurdle: 30, lsi: 85 }, goalText: '>85% vs other side · hurdle 30 s' },
      { id: 'p2_bal_eo', label: 'Balance — unipedal stance, eyes open', measure: 'balance_eyes_open', goal: { kind: 'absolute', target: 43, cmp: '>=' }, goalText: '43 s (normative, 18–39 yrs)' },
      { id: 'p2_bal_ec', label: 'Balance — unipedal stance, eyes closed', measure: 'balance_eyes_closed', goal: { kind: 'absolute', target: 9, cmp: '>=' }, goalText: '9 s (normative, 18–39 yrs)' },
      { id: 'p2_slrise', label: 'Single-leg rise test', measure: 'sl_squat_reps', goal: { kind: 'hurdle_lsi', hurdle: 10, lsi: 85 }, goalText: '>85% vs other side · hurdle >10 reps each leg' },
    ],
    supplementary: [
      { id: 'p2_press', label: 'One-rep-max single-leg incline press', measure: 'leg_press_1rm', goal: { kind: 'ratio', target: 1.5 }, goalText: '1.5x bodyweight (sled + weight)' },
      { id: 'p2_squat', label: 'One-rep-max squat', measure: 'squat_1rm', goal: { kind: 'ratio', target: 1.5 }, goalText: '1.5x bodyweight' },
    ],
  },

  {
    id: 'phase3',
    n: 3,
    name: 'Phase 3',
    title: 'Running, agility and landings',
    keyGoals: ['Attain excellent hopping performance (technique, distances & endurance)', 'Progress successfully through an agility program and modified game play', 'Regain full strength and balance'],
    hurdles: [
      'Full range of motion (prone hang test and knee flexion)',
      'No effusion / swelling (stroke test)',
      'A "good" rating on the single-leg squat test',
      'No side-to-side difference for the single-leg bridge, single-leg calf raises and side bridge endurance tests',
    ],
    measures: [
      { id: 'p3_single', label: 'Single hop test', measure: 'single_hop', goal: { kind: 'lsi', target: 95 }, goalText: '>95% vs other side, and ≥ your pre-op best' },
      { id: 'p3_triple', label: 'Triple hop test', measure: 'triple_hop', goal: { kind: 'lsi', target: 95 }, goalText: '>95% vs other side' },
      { id: 'p3_cross', label: 'Triple crossover hop test', measure: 'triple_crossover_hop', goal: { kind: 'lsi', target: 95 }, goalText: '>95% vs other side' },
      { id: 'p3_side', label: 'Side hop test', measure: 'side_hop', goal: { kind: 'lsi', target: 95 }, goalText: '>95% vs other side' },
      { id: 'p3_slrise', label: 'Single-leg rise test', measure: 'sl_squat_reps', goal: { kind: 'absolute', target: 22, cmp: '>=' }, goalText: 'Hurdle: >22 reps both limbs' },
      { id: 'p3_sebt', label: 'Star Excursion Balance Test', measure: 'sebt_composite', goal: { kind: 'lsi', target: 95 }, goalText: '>95% vs other side' },
      { id: 'p3_vestib', label: 'Cooper & Hughes vestibular balance test', goal: { kind: 'manual' }, goalText: 'Pass both limbs',
        how: 'Single-leg stance, slight hip, knee and ankle flexion, hands on waist. (1) Head side to side 70–90°, 60 bpm, 15 s. (2) Head up and down, 60 bpm, 15 s. Pass = stance held and hands stay on the waist for both.' },
    ],
    supplementary: [
      { id: 'p3_press', label: 'One-rep-max single-leg incline press', measure: 'leg_press_1rm', goal: { kind: 'ratio', target: 1.8 }, goalText: '1.8x bodyweight (sled + weight)' },
      { id: 'p3_squat', label: 'One-rep-max squat', measure: 'squat_1rm', goal: { kind: 'ratio', target: 1.8 }, goalText: '1.8x bodyweight' },
    ],
  },

  {
    id: 'phase4',
    n: 4,
    name: 'Phase 4',
    title: 'Return to sport',
    keyGoals: [
      'Melbourne Return to Sport Score above 95',
      'Comfortable, confident and eager to return (ACL-RSI and IKDC)',
      'An ACL injury-prevention program discussed, implemented and continued',
    ],
    note: 'The guide states current research suggests a minimum of 9 months post-surgery, and to be guided by your surgeon and sports medicine team.',
    measures: [
      { id: 'p4_mrss', label: 'Melbourne Return to Sport Score 2.0', goal: { kind: 'mrss', target: 95 }, goalText: '95+ / 100' },
      { id: 'p4_ready', label: 'Comfortable, confident and eager to return', goal: { kind: 'manual' }, goalText: 'Yes' },
      { id: 'p4_prevention', label: 'ACL injury-prevention program in place', goal: { kind: 'manual' }, goalText: 'Implemented, ≥15 min before each session' },
    ],
  },

  {
    id: 'phase5',
    n: 5,
    name: 'Phase 5',
    title: 'Prevention of re-injury',
    keyGoals: [
      'Plyometric, balance and strengthening exercises',
      'Performed more than once per week',
      'Continued for at least 6 weeks, then ongoing',
    ],
    measures: [
      { id: 'p5_program', label: 'Prevention program chosen', goal: { kind: 'manual' }, goalText: 'e.g. Sportsmetrics, The 11+, PEP, KNEE Program, FootyFirst' },
      { id: 'p5_before', label: 'Performed ≥10 min before every training session and show', goal: { kind: 'manual' }, goalText: 'Ongoing' },
    ],
  },
];

export const MELBOURNE_BY_ID = Object.fromEntries(MELBOURNE_PHASES.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------
// MRSS 2.0
// ---------------------------------------------------------------------------

export const MRSS_PART_A = [
  { id: 'effusion', label: 'Effusion', options: [['Absent', 5], ['Present', 0]] },
  { id: 'stability', label: 'Stability (pivot shift test)', options: [['Nil', 5], ['Grade I', 3], ['Grade II', 1], ['Grade III–IV', 0]] },
  { id: 'flexion', label: 'Flexion', options: [['0–5° deficit', 5], ['5–20° deficit', 3], ['20°+ deficit', 0]] },
  { id: 'extension', label: 'Extension (prone hang test)', options: [['0–1 cm deficit', 5], ['1–5 cm deficit', 3], ['5 cm+ deficit', 0]] },
];

// LSI -> points. `full` is 10 or 5 depending on the item.
// Bands read low-to-high; the first band that contains the value wins, and
// boundaries that appear in two bands in the printed table resolve to the
// higher-scoring band.
const LSI_BANDS_DOMINANT = [
  { lo: 97, hi: 105, pts: 1.0 },
  { lo: 90, hi: 110, pts: 0.8 },
  { lo: 80, hi: 120, pts: 0.6 },
  { lo: 70, hi: 130, pts: 0.4 },
  { lo: 60, hi: 140, pts: 0.2 },
];
const LSI_BANDS_NONDOMINANT = [
  { lo: 95, hi: 103, pts: 1.0 },
  { lo: 85, hi: 110, pts: 0.8 },
  { lo: 75, hi: 120, pts: 0.6 },
  { lo: 65, hi: 130, pts: 0.4 },
  { lo: 55, hi: 140, pts: 0.2 },
];

export function lsiPoints(lsi, full, dominant = true) {
  if (lsi === null || lsi === undefined || Number.isNaN(lsi)) return null;
  const bands = dominant ? LSI_BANDS_DOMINANT : LSI_BANDS_NONDOMINANT;
  for (const b of bands) {
    if (lsi >= b.lo && lsi <= b.hi) return Math.round(b.pts * full * 10) / 10;
  }
  return 0;
}

export const MRSS_PART_D = [
  { id: 'sebt', label: 'Star Excursion Balance Test', full: 10, measure: 'sebt_composite' },
  { id: 'vestibular', label: 'Vestibular balance (side-to-side /5, up-and-down /5)', full: 10, manual: true },
  { id: 'single_hop', label: 'Single hop', full: 5, measure: 'single_hop' },
  { id: 'triple_hop', label: 'Triple hop', full: 5, measure: 'triple_hop' },
  { id: 'triple_crossover', label: 'Triple crossover hop', full: 5, measure: 'triple_crossover_hop' },
  { id: 'side_hop', label: 'Side hop', full: 5, measure: 'side_hop' },
  { id: 'sl_rise', label: 'Single-leg rise', full: 10, measure: 'sl_squat_reps' },
];

export const MRSS_PART_F = [
  { id: 'f_single_hop', label: 'Single hop (fatigued)', full: 5 },
  { id: 'f_triple_hop', label: 'Triple hop (fatigued)', full: 5 },
  { id: 'f_triple_crossover', label: 'Triple crossover hop (fatigued)', full: 5 },
  { id: 'f_side_hop', label: 'Side hop (fatigued)', full: 5 },
];
