// One shared registry of measurable tests. The 6-month plan goals, the
// Melbourne outcome measures and the VALD reports all read from this same
// store, so a test recorded once shows up everywhere it is relevant.
//
// lower: true  -> a smaller number is a better result (sway, asymmetry)

export const CATEGORIES = {
  strength: { label: 'Strength', color: '#e0603a' },
  balance: { label: 'Balance / proprioception', color: '#2f9e8f' },
  aerobic: { label: 'Aerobic', color: '#3d7fd1' },
  impact: { label: 'Impact / plyometrics', color: '#b4529e' },
  running: { label: 'Running', color: '#4c9a3f' },
  agility: { label: 'Agility / cutting', color: '#d4a017' },
  dance: { label: 'Dance-specific', color: '#8a5cd6' },
  show: { label: 'Show run-through', color: '#c0392b' },
  kneeling: { label: 'Kneeling', color: '#7a6a55' },
  mobility: { label: 'Mobility / range of motion', color: '#5d8aa8' },
  recovery: { label: 'Recovery', color: '#6b7280' },
};

export const MEASURE_GROUPS = [
  'Strength endurance',
  'Balance',
  'Range of motion',
  'Swelling',
  'Loading',
  'Hop tests',
  'Show',
  'VALD Dynamo (isometric)',
  'VALD force plates — balance',
  'VALD force plates — squat',
  'VALD force plates — jump',
];

// unit keys: reps | sec | deg | cm | weight | grade | pct | min | N | mm | mmps | wkg
export const MEASURES = [
  // --- Phase 2 style capacity tests -------------------------------------
  { id: 'sl_calf_raise', label: 'Single-leg calf raises', unit: 'reps', perLeg: true, group: 'Strength endurance',
    how: 'On one foot at the edge of a step, full range, 1 rep every 2 seconds. Stop when you lose range or drop below the cadence.' },
  { id: 'sl_squat_reps', label: 'Single-leg rise test — stand up from a chair on one leg', unit: 'reps', perLeg: true, group: 'Strength endurance',
    how: 'Sit on a chair/plinth, test knee at 90°, 10 cm from the edge. Arms crossed. Stand up and sit down as many times as possible.' },
  { id: 'sl_bridge', label: 'Single-leg bridge', unit: 'reps', perLeg: true, group: 'Strength endurance',
    how: 'Lying on your back, heel on a 60 cm box, test knee bent 20°, other hip and knee at 90°, arms crossed. Lift hips as high as possible, repeat to the same height each rep.' },
  { id: 'lateral_step_up', label: 'Lateral step-ups', unit: 'reps', perLeg: true, group: 'Strength endurance' },
  { id: 'side_bridge', label: 'Side bridge endurance', unit: 'sec', perLeg: true, group: 'Strength endurance',
    how: 'On your side, legs extended, top foot in front of the lower foot. Lift hips to a straight line; time ends when the hips drop.' },

  // --- Balance -----------------------------------------------------------
  { id: 'sl_foam_task', label: 'Single-leg stance on foam with a task (juggling and similar)', unit: 'sec', perLeg: true, group: 'Balance' },
  { id: 'balance_eyes_open', label: 'Single-leg stance — eyes open', unit: 'sec', perLeg: true, group: 'Balance',
    how: 'Stand on one leg, other leg raised, arms crossed. Stop on arm use, foot touch-down, stance-foot movement, or 45 s.' },
  { id: 'balance_eyes_closed', label: 'Single-leg stance — eyes closed', unit: 'sec', perLeg: true, group: 'Balance' },
  { id: 'sebt_composite', label: 'Star Excursion Balance — composite', unit: 'cm', perLeg: true, group: 'Balance',
    how: 'Sum of the anterior, posteromedial and posterolateral reach distances for that leg.' },

  // --- Range of motion / swelling ---------------------------------------
  { id: 'knee_flexion', label: 'Passive knee flexion', unit: 'deg', perLeg: true, group: 'Range of motion',
    how: 'Lying on your back, measured with a long-arm goniometer. Landmarks: greater trochanter, lateral femoral condyle, lateral malleolus.' },
  { id: 'knee_extension', label: 'Passive knee extension', unit: 'deg', perLeg: true, group: 'Range of motion', lower: true,
    how: '0° = full extension. Record a flexion deficit as a positive number.' },
  { id: 'extension_lag', label: 'Extension lag', unit: 'deg', perLeg: true, group: 'Range of motion', lower: true,
    how: 'Active extension deficit against a fully passively extended knee.' },
  { id: 'prone_hang', label: 'Prone hang — heel height difference', unit: 'cm', perLeg: false, group: 'Range of motion', lower: true,
    how: 'Lie prone with the lower legs off the end of the bed. Measure the heel-height difference between sides (approx 1 cm = 1°).' },
  { id: 'effusion', label: 'Effusion — stroke test', unit: 'grade', perLeg: true, group: 'Swelling', lower: true,
    options: ['Zero', 'Trace', '1+', '2+', '3+'],
    how: 'Zero: no wave on downstroke. Trace: small medial wave. 1+: large medial bulge. 2+: effusion returns spontaneously. 3+: cannot move the fluid out of the medial side.' },

  // --- Loading -----------------------------------------------------------
  { id: 'bodyweight', label: 'Bodyweight', unit: 'weight', perLeg: false, group: 'Loading' },
  { id: 'squat_1rm', label: 'One-rep-max squat', unit: 'weight', perLeg: false, group: 'Loading',
    how: 'Any squat variation. Down to ~90° knee flexion, up to full knee and hip extension. Warm up properly and use a spotter.' },
  { id: 'leg_press_1rm', label: 'One-rep-max single-leg incline press', unit: 'weight', perLeg: true, group: 'Loading',
    how: '45° incline press, seat at 90° to the slide, hip flexed to 90°. Lower to 90° knee flexion, extend fully. Record sled + weight.' },

  // --- Hop / impact ------------------------------------------------------
  { id: 'single_hop', label: 'Single hop for distance', unit: 'cm', perLeg: true, group: 'Hop tests',
    how: 'Hop as far forward as possible and land on the same leg. Toe at take-off to heel at landing. Record the mean of 2 valid hops.' },
  { id: 'triple_hop', label: 'Triple hop for distance', unit: 'cm', perLeg: true, group: 'Hop tests',
    how: 'Three consecutive hops forward on one foot. Total distance, mean of 2 valid tests.' },
  { id: 'triple_crossover_hop', label: 'Triple crossover hop', unit: 'cm', perLeg: true, group: 'Hop tests',
    how: 'Three consecutive hops on one foot crossing a 15 cm strip medial → lateral → medial. Total distance, mean of 2 valid tests.' },
  { id: 'side_hop', label: 'Side hop test (30 s)', unit: 'reps', perLeg: true, group: 'Hop tests',
    how: 'Hands behind back, hop side to side between two tapes 40 cm apart. Count successful jumps in 30 s without touching the tape.' },
  { id: 'repeated_hops', label: 'Repeated hops', unit: 'reps', perLeg: true, group: 'Hop tests' },

  // --- Show --------------------------------------------------------------
  { id: 'show_runthrough_pct', label: 'Show run-through completed', unit: 'pct', perLeg: false, group: 'Show' },
  { id: 'show_minutes', label: 'Continuous show minutes', unit: 'min', perLeg: false, group: 'Show' },

  // --- VALD Dynamo -------------------------------------------------------
  { id: 'dyno_knee_ext', label: 'Knee extension — peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true,
    how: 'Seated, hip and knee at 90°. Dynamometer on the front of the shank just above the ankle. Maximal isometric push.' },
  { id: 'dyno_knee_flex', label: 'Knee flexion — peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true,
    how: 'Seated, hip and knee at 90°. Dynamometer behind the shank just above the ankle. Maximal isometric pull.' },
  { id: 'dyno_hip_abd', label: 'Hip abduction — peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true },
  { id: 'dyno_hip_ext', label: 'Hip extension — peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true },

  // --- VALD force plates: balance ---------------------------------------
  { id: 'fp_sls_excursion', label: 'Single-leg stand — total sway path', unit: 'mm', perLeg: true, lower: true, group: 'VALD force plates — balance', vald: true,
    how: 'Total path the centre of pressure travels during the single-leg stand trial. Less sway is better.' },
  { id: 'fp_sls_velocity', label: 'Single-leg stand — average sway speed', unit: 'mmps', perLeg: true, lower: true, group: 'VALD force plates — balance', vald: true },
  { id: 'fp_qs_excursion', label: 'Quiet stand — total sway path (both legs)', unit: 'mm', perLeg: false, lower: true, group: 'VALD force plates — balance', vald: true },
  { id: 'fp_qs_velocity', label: 'Quiet stand — average sway speed (both legs)', unit: 'mmps', perLeg: false, lower: true, group: 'VALD force plates — balance', vald: true },

  // --- VALD force plates: squat -----------------------------------------
  { id: 'fp_squat_peak_force', label: 'Squat — peak force pushing up', unit: 'N', perLeg: true, group: 'VALD force plates — squat', vald: true },
  { id: 'fp_squat_depth', label: 'Squat — average depth', unit: 'cm', perLeg: false, group: 'VALD force plates — squat', vald: true },
  { id: 'fp_squat_con_power', label: 'Squat — average power pushing up, per kg bodyweight', unit: 'wkg', perLeg: false, group: 'VALD force plates — squat', vald: true },
  { id: 'fp_squat_ecc_power', label: 'Squat — peak power lowering down, per kg bodyweight', unit: 'wkg', perLeg: false, group: 'VALD force plates — squat', vald: true },

  // --- VALD force plates: jump (not tested yet — here for when you are) ---
  { id: 'fp_cmj_height', label: 'Countermovement jump — height', unit: 'cm', perLeg: false, group: 'VALD force plates — jump', vald: true, future: true },
  { id: 'fp_cmj_power_bm', label: 'Countermovement jump — peak power per kg bodyweight', unit: 'wkg', perLeg: false, group: 'VALD force plates — jump', vald: true, future: true },
  { id: 'fp_cmj_asym', label: 'Countermovement jump — left/right push-off imbalance', unit: 'pct', perLeg: false, lower: true, group: 'VALD force plates — jump', vald: true, future: true },
  { id: 'fp_slcmj_height', label: 'Single-leg countermovement jump — height', unit: 'cm', perLeg: true, group: 'VALD force plates — jump', vald: true, future: true },
  { id: 'fp_imtp_peak', label: 'Isometric mid-thigh pull — peak force', unit: 'N', perLeg: false, group: 'VALD force plates — jump', vald: true, future: true },
];

export const MEASURE_BY_ID = Object.fromEntries(MEASURES.map((m) => [m.id, m]));

export const UNIT_LABEL = {
  reps: 'reps', sec: 's', deg: '°', cm: 'cm', weight: '', grade: '', pct: '%',
  min: 'min', N: 'N', mm: 'mm', mmps: 'mm/s', wkg: 'W/kg',
};
