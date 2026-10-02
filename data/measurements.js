// One shared registry of measurable tests. The 6-month plan goals, the
// Melbourne outcome measures and the VALD reports all read from this same
// store, so a test recorded once shows up everywhere it is relevant.
//
// lower: true  -> a smaller number is a better result (sway, asymmetry)

export const CATEGORIES = {
  // Colours are theme tokens (styles.css), one per category, each with a dark
  // variant. Every use sits in CSS (style attributes, color-mix), so var() works.
  strength: { label: 'Strength', color: 'var(--cat-strength)' },
  balance: { label: 'Balance / proprioception', color: 'var(--cat-balance)' },
  aerobic: { label: 'Aerobic', color: 'var(--cat-aerobic)' },
  impact: { label: 'Impact / plyometrics', color: 'var(--cat-impact)' },
  running: { label: 'Running', color: 'var(--cat-running)' },
  agility: { label: 'Agility / cutting', color: 'var(--cat-agility)' },
  dance: { label: 'Dance-specific', color: 'var(--cat-dance)' },
  show: { label: 'Show run-through', color: 'var(--cat-show)' },
  kneeling: { label: 'Kneeling', color: 'var(--cat-kneeling)' },
  mobility: { label: 'Mobility / range of motion', color: 'var(--cat-mobility)' },
  recovery: { label: 'Recovery', color: 'var(--cat-recovery)' },
};

export const MEASURE_GROUPS = [
  'Strength endurance',
  'Balance',
  'Range of motion',
  'Swelling',
  'Loading',
  'Hop tests',
  'Show',
  'Patient reported',
  'Manual muscle test',
  'Handheld dynamometer (isometric)',
  'VALD Dynamo (isometric)',
  'VALD force plates, balance',
  'VALD force plates, squat',
  'VALD force plates, jump',
];

// unit keys: reps | sec | deg | cm | weight | grade | pct | min | N | mm | mmps | wkg | lb | pts
export const MEASURES = [
  // --- Phase 2 style capacity tests -------------------------------------
  { id: 'sl_calf_raise', label: 'Single-leg calf raises', unit: 'reps', perLeg: true, group: 'Strength endurance',
    how: 'On one foot at the edge of a step, full range, 1 rep every 2 seconds. Stop when you lose range or drop below the cadence.' },
  { id: 'squat_reps_90', label: 'Bodyweight squats to 90 degrees', unit: 'reps', perLeg: false, group: 'Strength endurance',
    how: 'Both feet, arms free. Squat to thighs level (90 degrees at the knee) and stand, weight even on both legs. Count the reps with no sharp pain.' },
  { id: 'sl_squat_reps', label: 'Single-leg rise test, stand up from a chair on one leg', unit: 'reps', perLeg: true, group: 'Strength endurance',
    how: 'Sit on a chair/plinth, test knee at 90°, 10 cm from the edge. Arms crossed. Stand up and sit down as many times as possible.' },
  { id: 'sl_bridge', label: 'Single-leg bridge', unit: 'reps', perLeg: true, group: 'Strength endurance',
    how: 'Lying on your back, heel on a 60 cm box, test knee bent 20°, other hip and knee at 90°, arms crossed. Lift hips as high as possible, repeat to the same height each rep.' },
  { id: 'lateral_step_up', label: 'Lateral step-ups', unit: 'reps', perLeg: true, group: 'Strength endurance' },
  { id: 'plank_hold', label: 'Plank hold', unit: 'sec', perLeg: false, group: 'Strength endurance' },
  { id: 'side_bridge', label: 'Side bridge endurance', unit: 'sec', perLeg: true, group: 'Strength endurance',
    how: 'On your side, legs extended, top foot in front of the lower foot. Lift hips to a straight line; time ends when the hips drop.' },

  // --- Balance -----------------------------------------------------------
  { id: 'sl_foam_task', label: 'Single-leg stance on foam with a task (juggling and similar)', unit: 'sec', perLeg: true, group: 'Balance' },
  { id: 'balance_eyes_open', label: 'Single-leg stance, eyes open', unit: 'sec', perLeg: true, group: 'Balance',
    how: 'Stand on one leg, other leg raised, arms crossed. Stop on arm use, foot touch-down, stance-foot movement, or 45 s.' },
  { id: 'balance_eyes_closed', label: 'Single-leg stance, eyes closed', unit: 'sec', perLeg: true, group: 'Balance' },
  { id: 'sebt_composite', label: 'Star Excursion Balance, composite', unit: 'cm', perLeg: true, group: 'Balance',
    how: 'Sum of the anterior, posteromedial and posterolateral reach distances for that leg.' },
  { id: 'ybt_anterior', label: 'Y Balance Test, anterior reach', unit: 'cm', perLeg: true, group: 'Balance',
    how: 'Stand on the test leg at the centre of the Y and reach straight ahead with the other foot as far as you can while keeping your balance. A difference of 4 cm or more between legs is clinically meaningful.' },

  // --- Range of motion / swelling ---------------------------------------
  { id: 'knee_flexion', label: 'Passive knee flexion', unit: 'deg', perLeg: true, group: 'Range of motion',
    how: 'Lying on your back, measured with a long-arm goniometer. Landmarks: greater trochanter, lateral femoral condyle, lateral malleolus.' },
  { id: 'knee_extension', label: 'Passive knee extension', unit: 'deg', perLeg: true, group: 'Range of motion', lower: true,
    how: '0° = full extension. Record a flexion deficit as a positive number.' },
  { id: 'extension_lag', label: 'Extension lag', unit: 'deg', perLeg: true, group: 'Range of motion', lower: true,
    how: 'Active extension deficit against a fully passively extended knee.' },
  { id: 'prone_hang', label: 'Prone hang, heel height difference', unit: 'cm', perLeg: false, group: 'Range of motion', lower: true,
    how: 'Lie prone with the lower legs off the end of the bed. Measure the heel-height difference between sides (approx 1 cm = 1°).' },
  { id: 'knee_flexion_arom', label: 'Active knee flexion', unit: 'deg', perLeg: true, group: 'Range of motion',
    how: 'Bending the knee under your own power, measured with a goniometer.' },
  { id: 'knee_extension_arom', label: 'Active knee extension', unit: 'deg', perLeg: true, group: 'Range of motion', lower: true,
    how: '0° = full extension under your own power. A clinic chart writes a deficit as a negative angle (-12°); it is recorded here as a positive deficit (12).' },
  { id: 'knee_hyperextension', label: 'Knee hyperextension, degrees past straight', unit: 'deg', perLeg: true, group: 'Range of motion',
    how: 'How far the knee goes beyond 0° when pushed straight. A goniometer reading of 5-0-140 means 5° here, 0 extension deficit and 140° of flexion.' },
  { id: 'hip_flexion', label: 'Hip flexion', unit: 'deg', perLeg: true, group: 'Range of motion' },
  { id: 'hip_ir', label: 'Hip internal rotation', unit: 'deg', perLeg: true, group: 'Range of motion' },
  { id: 'hip_er', label: 'Hip external rotation', unit: 'deg', perLeg: true, group: 'Range of motion' },
  { id: 'hamstring_9090', label: '90/90 hamstring test, degrees short of straight', unit: 'deg', perLeg: true, group: 'Range of motion', lower: true,
    how: 'On your back with the hip at 90°, straighten the knee as far as it goes. Record how many degrees short of straight it stops.' },
  { id: 'effusion', label: 'Effusion, stroke test', unit: 'grade', perLeg: true, group: 'Swelling', lower: true,
    options: ['Zero', 'Trace', '1+', '2+', '3+'],
    how: 'Zero: no wave on downstroke. Trace: small medial wave. 1+: large medial bulge. 2+: effusion returns spontaneously. 3+: cannot move the fluid out of the medial side.' },
  { id: 'girth_midpatella', label: 'Girth at the middle of the kneecap', unit: 'cm', perLeg: true, group: 'Swelling', lower: true,
    how: 'Tape around the knee at the middle of the kneecap. More than the other side usually means swelling.' },
  { id: 'girth_suprapatella', label: 'Girth at the top of the kneecap', unit: 'cm', perLeg: true, group: 'Swelling', lower: true },
  { id: 'girth_infrapatella', label: 'Girth at the bottom of the kneecap', unit: 'cm', perLeg: true, group: 'Swelling', lower: true },
  { id: 'girth_thigh_10', label: 'Thigh girth, 10 cm up from the kneecap', unit: 'cm', perLeg: true, group: 'Swelling',
    how: 'Tape around the thigh 10 cm above the top of the kneecap. Muscle, so more is better; the chart may just say 10 cm.' },
  { id: 'girth_thigh_20', label: 'Thigh girth, 20 cm up from the kneecap', unit: 'cm', perLeg: true, group: 'Swelling',
    how: 'Tape around the thigh 20 cm above the top of the kneecap. Muscle, so more is better; the chart may just say 20 cm.' },

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

  // --- Patient reported --------------------------------------------------
  { id: 'pain_now', label: 'Pain at the start of a session', unit: 'of10', perLeg: false, group: 'Patient reported', lower: true,
    how: '0 means no pain, 10 the worst imaginable. As rated at the start of a clinic session.' },
  { id: 'pain_best', label: 'Pain at its best', unit: 'of10', perLeg: false, group: 'Patient reported', lower: true },
  { id: 'pain_worst', label: 'Pain at its worst', unit: 'of10', perLeg: false, group: 'Patient reported', lower: true },
  { id: 'pain_after', label: 'Pain after a session', unit: 'of10', perLeg: false, group: 'Patient reported', lower: true },
  { id: 'lefs', label: 'Lower Extremity Functional Scale, out of 80', unit: 'pts', perLeg: false, group: 'Patient reported',
    how: '20 questions on everyday and sporting tasks, each scored 0 to 4. 80 means no difficulty with anything. A change of 9 points is clinically meaningful.' },

  // --- Manual muscle test (a clinician's graded push against your resistance) --
  // Grades, not numbers: shown in tables, never drawn on a chart.
  { id: 'mmt_hip_flex', label: 'Hip flexion', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_hip_ext', label: 'Hip extension', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_hip_abd', label: 'Hip abduction', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_hip_add', label: 'Hip adduction', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_hip_er', label: 'Hip external rotation', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_hip_ir', label: 'Hip internal rotation', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_knee_flex', label: 'Knee flexion', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_knee_ext', label: 'Knee extension', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_ankle_df', label: 'Ankle dorsiflexion', unit: 'grade', perLeg: true, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },
  { id: 'mmt_core', label: 'Core', unit: 'grade', perLeg: false, group: 'Manual muscle test', options: ['0/5', '1/5', '2-/5', '2/5', '2+/5', '3-/5', '3/5', '3+/5', '4-/5', '4/5', '4+/5', '5-/5', '5/5'] },

  // --- Handheld dynamometer (a clinic device that reads in pounds) --------
  // Kept apart from the VALD Dynamo numbers above: a different device and
  // different test positions, so the two are never compared as one test.
  { id: 'hhd_knee_ext', label: 'Knee extension, seated', unit: 'lb', perLeg: true, group: 'Handheld dynamometer (isometric)', family: 'knee_ext', device: 'Handheld dynamometer', setup: 'seated',
    how: 'Seated, knee bent, the dynamometer held against the front of the shin. Maximal push.' },
  { id: 'hhd_hamstring_30', label: 'Hamstring, prone at 30°', unit: 'lb', perLeg: true, group: 'Handheld dynamometer (isometric)', family: 'knee_flex', device: 'Handheld dynamometer', setup: 'prone, knee at 30°',
    how: 'Face down, knee bent 30°, the dynamometer held behind the ankle. Maximal pull.' },
  { id: 'hhd_hip_flex', label: 'Hip flexion, seated', unit: 'lb', perLeg: true, group: 'Handheld dynamometer (isometric)' },
  { id: 'hhd_hip_add', label: 'Hip adduction, on the back', unit: 'lb', perLeg: true, group: 'Handheld dynamometer (isometric)' },
  { id: 'hhd_hip_abd', label: 'Hip abduction, side lying', unit: 'lb', perLeg: true, group: 'Handheld dynamometer (isometric)', family: 'hip_abd', device: 'Handheld dynamometer', setup: 'side lying' },
  { id: 'hhd_hip_er', label: 'Hip external rotation, prone', unit: 'lb', perLeg: true, group: 'Handheld dynamometer (isometric)' },

  // --- VALD Dynamo -------------------------------------------------------
  { id: 'dyno_knee_ext', label: 'Knee extension, peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true, family: 'knee_ext', device: 'VALD Dynamo', setup: 'seated, hip and knee at 90°',
    how: 'Seated, hip and knee at 90°. Dynamometer on the front of the shank just above the ankle. Maximal isometric push.' },
  { id: 'dyno_knee_flex', label: 'Knee flexion, peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true, family: 'knee_flex', device: 'VALD Dynamo', setup: 'seated, hip and knee at 90°',
    how: 'Seated, hip and knee at 90°. Dynamometer behind the shank just above the ankle. Maximal isometric pull.' },
  { id: 'dyno_hip_abd', label: 'Hip abduction, peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true, family: 'hip_abd', device: 'VALD Dynamo', setup: 'position not recorded' },
  { id: 'dyno_hip_ext', label: 'Hip extension, peak force', unit: 'N', perLeg: true, group: 'VALD Dynamo (isometric)', vald: true },

  // --- VALD force plates: balance ---------------------------------------
  { id: 'fp_sls_excursion', label: 'Single-leg stand, total sway path', unit: 'mm', perLeg: true, lower: true, group: 'VALD force plates, balance', vald: true,
    how: 'Total path the centre of pressure travels during the single-leg stand trial. Less sway is better.' },
  { id: 'fp_sls_velocity', label: 'Single-leg stand, average sway speed', unit: 'mmps', perLeg: true, lower: true, group: 'VALD force plates, balance', vald: true },
  { id: 'fp_qs_excursion', label: 'Quiet stand, total sway path (both legs)', unit: 'mm', perLeg: false, lower: true, group: 'VALD force plates, balance', vald: true },
  { id: 'fp_qs_velocity', label: 'Quiet stand, average sway speed (both legs)', unit: 'mmps', perLeg: false, lower: true, group: 'VALD force plates, balance', vald: true },

  // --- VALD force plates: squat -----------------------------------------
  { id: 'fp_squat_peak_force', label: 'Squat, peak force pushing up', unit: 'N', perLeg: true, group: 'VALD force plates, squat', vald: true },
  { id: 'fp_squat_depth', label: 'Squat, average depth', unit: 'cm', perLeg: false, group: 'VALD force plates, squat', vald: true },
  { id: 'fp_squat_con_power', label: 'Squat, average power pushing up, per kg bodyweight', unit: 'wkg', perLeg: false, group: 'VALD force plates, squat', vald: true },
  { id: 'fp_squat_ecc_power', label: 'Squat, peak power lowering down, per kg bodyweight', unit: 'wkg', perLeg: false, group: 'VALD force plates, squat', vald: true },

  // --- VALD force plates: jump (not tested yet, here for when you are) ---
  { id: 'fp_cmj_height', label: 'Countermovement jump, height', unit: 'cm', perLeg: false, group: 'VALD force plates, jump', vald: true, future: true },
  { id: 'fp_cmj_power_bm', label: 'Countermovement jump, peak power per kg bodyweight', unit: 'wkg', perLeg: false, group: 'VALD force plates, jump', vald: true, future: true },
  { id: 'fp_cmj_asym', label: 'Countermovement jump, left/right push-off imbalance', unit: 'pct', perLeg: false, lower: true, group: 'VALD force plates, jump', vald: true, future: true },
  { id: 'fp_slcmj_height', label: 'Single-leg countermovement jump, height', unit: 'cm', perLeg: true, group: 'VALD force plates, jump', vald: true, future: true },
  { id: 'fp_imtp_peak', label: 'Isometric mid-thigh pull, peak force', unit: 'N', perLeg: false, group: 'VALD force plates, jump', vald: true, future: true },
];

export const MEASURE_BY_ID = Object.fromEntries(MEASURES.map((m) => [m.id, m]));

// The same movement measured on two devices (2026-09-16). A family lets the
// Tests view put a VALD Dynamo result and a handheld dynamometer result on one
// row in one unit. It never joins them into one series: a different device,
// tester and position is a different test, so each keeps its own chart.
export const FAMILIES = {
  knee_ext: 'Knee extension strength',
  knee_flex: 'Hamstring strength',
  hip_abd: 'Hip abduction strength',
};

// Force units. A pound of force is 4.448 newtons exactly enough for a chart.
const N_PER_LB = 4.4482216153;
export function toN(value, unit) { return unit === 'lb' ? value * N_PER_LB : value; }
export function fromN(value, unit) { return unit === 'lb' ? value / N_PER_LB : value; }

export const UNIT_LABEL = {
  reps: 'reps', sec: 's', deg: '°', cm: 'cm', weight: '', grade: '', pct: '%',
  min: 'min', N: 'N', mm: 'mm', mmps: 'mm/s', wkg: 'W/kg', lb: 'lb', pts: 'pts', of10: '/10',
};
