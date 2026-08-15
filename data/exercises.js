// Exercise library. Names are written out in full — no abbreviations.
//
//   months     which months suggest this first on the Today tab
//   track      what the quick-log row asks for: 'setsreps' | 'time' | 'pct'
//   chain      'open' = the foot moves freely, so the load sits on the quad
//   usesBand   show the Theraband colour picker on the log row
//   gym        appears on the Open chain tab with a resistance history board
//   cardio     logs minutes, a 1-20 machine level and calories instead of
//              sets/reps/load
//   secs       a hold or balance time — logged in seconds, not minutes
//   aka        what a clinic called it, when that differs

export const EXERCISES = [
  // ---- Squat pattern ----------------------------------------------------
  { id: 'sts_high', name: 'High sit-to-stand', cat: 'strength', months: [1], track: 'setsreps' },
  { id: 'sts_low', name: 'Low sit-to-stand', cat: 'strength', months: [1, 2], track: 'setsreps' },
  { id: 'dl_squat', name: 'Double-leg squat', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'split_squat', name: 'Split squat', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'sl_squat', name: 'Single-leg squat', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', measure: 'sl_squat_reps' },
  { id: 'sl_mini_squat_band', name: 'Knee extension into the band', cat: 'strength', months: [1, 2, 3], track: 'setsreps', usesBand: true, clinic: true },
  { id: 'barbell_squat', name: 'Double-leg weighted squat', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', measure: 'squat_1rm', gym: true, clinic: true },
  { id: 'leg_press', name: 'Single-leg leg press', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', measure: 'leg_press_1rm', gym: true, clinic: true },
  { id: 'multi_lunge', name: 'Multidirectional lunge, weighted', cat: 'strength', months: [2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'wall_sit_adductor', name: 'Wall squat with a ball squeeze between the knees', cat: 'strength', months: [1, 2, 3], track: 'time', clinic: true, secs: true },

  // ---- Knee extension (open chain) --------------------------------------
  { id: 'sl_full_quad', name: 'Single-leg knee extension — full range', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', chain: 'open', gym: true, clinic: true,
    aka: 'also called "single-leg full-range quads"' },
  { id: 'sl_inner_quad', name: 'Single-leg knee extension — end of range', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', chain: 'open', gym: true, clinic: true,
    aka: 'also called "single-leg inner-range quads"' },
  { id: 'seated_knee_ext_band', name: 'Resisted knee extension, seated', cat: 'strength', months: [1, 2, 3], track: 'setsreps', chain: 'open', usesBand: true, clinic: true },
  { id: 'tke', name: 'Terminal knee extension', cat: 'strength', months: [1, 2, 3], track: 'setsreps', chain: 'open', usesBand: true, clinic: true,
    note: 'Also prescribed as five-second maximal isometric holds.' },
  { id: 'slr', name: 'Straight leg raise', cat: 'strength', months: [1, 2], track: 'setsreps', chain: 'open' },

  // ---- Bridges and posterior chain --------------------------------------
  { id: 'dl_bridge_band', name: 'Bridge with resisted hip abduction', cat: 'strength', months: [1, 2, 3], track: 'setsreps', usesBand: true, clinic: true },
  { id: 'bridge_butterfly', name: 'Butterfly gluteal bridge', cat: 'strength', months: [1, 2, 3], track: 'setsreps', clinic: true },
  { id: 'dl_bridge', name: 'Double-leg bridge', cat: 'strength', months: [1], track: 'setsreps' },
  { id: 'sl_bridge', name: 'Single-leg bridge', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', measure: 'sl_bridge' },
  { id: 'sl_glute_bridge', name: 'Single-leg glute bridge', cat: 'strength', months: [1, 2, 3], track: 'setsreps', clinic: true },
  { id: 'dl_glute_bridge_chair', name: 'Double-leg glute bridge on a chair', cat: 'strength', months: [1, 2], track: 'setsreps', clinic: true },
  { id: 'ham_curl', name: 'Hamstring curl', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', chain: 'open', gym: true },
  { id: 'nordic', name: 'Nordic hamstring curl', cat: 'strength', months: [2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'rdl', name: 'Romanian deadlift', cat: 'strength', months: [2, 3, 4, 5, 6], track: 'setsreps', gym: true },

  // ---- Steps ------------------------------------------------------------
  { id: 'fwd_stepup', name: 'Forward step-up', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', clinic: true },
  { id: 'lat_stepup', name: 'Lateral step-up', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', measure: 'lateral_step_up', clinic: true },
  { id: 'fwd_stepdown', name: 'Forward step-down', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'lat_stepdown', name: 'Lateral step-down, weighted', cat: 'strength', months: [2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'hip_lift_step', name: 'Hip lift and lower off a step', cat: 'strength', months: [1, 2, 3], track: 'setsreps', clinic: true },
  { id: 'step_down_backward', name: 'Backward step-down', cat: 'balance', months: [1, 2, 3], track: 'setsreps', clinic: true },

  // ---- Calf -------------------------------------------------------------
  { id: 'dl_calf_raise_band', name: 'Double-leg standing calf raise', cat: 'strength', months: [1, 2, 3], track: 'setsreps', usesBand: true, clinic: true },
  { id: 'calf_pulses', name: 'Calf pulses at 120 beats per minute', cat: 'strength', months: [1, 2, 3], track: 'time', clinic: true, secs: true },
  { id: 'dl_calf', name: 'Double-leg calf raise', cat: 'strength', months: [1], track: 'setsreps' },
  { id: 'sl_calf', name: 'Single-leg calf raise', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', measure: 'sl_calf_raise' },
  { id: 'sl_calf_foam', name: 'Single-leg calf raise on foam', cat: 'strength', months: [1, 2, 3], track: 'setsreps' },
  { id: 'sl_calf_coord', name: 'Single-leg calf raise with a coordination task', cat: 'strength', months: [1, 2, 3], track: 'setsreps' },
  { id: 'weighted_calf_straight', name: 'Weighted calf raise — straight knee', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', gym: true, clinic: true },
  { id: 'weighted_calf_bent', name: 'Weighted calf raise — bent knee', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', gym: true, clinic: true },
  { id: 'seated_calf_raise', name: 'Seated calf raise, loaded', cat: 'strength', months: [1, 2, 3], track: 'setsreps', clinic: true },
  { id: 'standing_calf_raise_load', name: 'Standing calf raise, loaded', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', clinic: true },

  // ---- Hip and trunk ----------------------------------------------------
  { id: 'sidelying_hip_abd', name: 'Side-lying hip abduction', cat: 'strength', months: [1, 2, 3], track: 'setsreps', chain: 'open', clinic: true },
  { id: 'standing_band_hip_abd', name: 'Standing hip abduction with a band', cat: 'strength', months: [1, 2, 3], track: 'setsreps', chain: 'open', usesBand: true, clinic: true },
  { id: 'hip_abd', name: 'Hip abduction (glute medius)', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', chain: 'open' },
  { id: 'side_bridge', name: 'Side bridge', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'time', measure: 'side_bridge', secs: true },
  { id: 'core', name: 'Core work', cat: 'strength', months: [1, 2, 3, 4, 5, 6], track: 'time', secs: true },
  { id: 'high_sts_band', name: 'High sit-to-stand with band and forearm raise', cat: 'strength', months: [1, 2], track: 'setsreps', usesBand: true, clinic: true },

  // ---- clinician's PhysiApp program movements ---------------------------
  { id: 'bridge_band_sl_ext', name: 'Bridge with resisted hip abduction, into single-leg extension', cat: 'strength', months: [1, 2, 3], track: 'setsreps', usesBand: true, clinic: true },
  { id: 'sl_bridge_band_abd', name: 'Single-leg bridge with resisted hip abduction', cat: 'strength', months: [1, 2, 3, 4], track: 'setsreps', usesBand: true, clinic: true, measure: 'sl_bridge' },
  { id: 'sts_band_foam', name: 'Sit to stand with resisted hip external rotation, on foam', cat: 'strength', months: [1, 2, 3], track: 'setsreps', usesBand: true, clinic: true },
  { id: 'knee_ext_pulses_band', name: 'Knee extension with pulses, Theraband', cat: 'strength', months: [1, 2, 3], track: 'setsreps', chain: 'open', usesBand: true, clinic: true },
  { id: 'sl_calf_band', name: 'Single-leg calf raises with a band at the ankle', cat: 'strength', months: [1, 2, 3, 4], track: 'setsreps', usesBand: true, clinic: true, measure: 'sl_calf_raise' },
  { id: 'jump_prep_step', name: 'Jump preparation off a step', cat: 'impact', months: [3, 4, 5, 6], track: 'setsreps', clinic: true },

  // ---- Balance ----------------------------------------------------------
  { id: 'sl_stance', name: 'Single-leg stance on the floor', cat: 'balance', months: [1, 2], track: 'time', measure: 'balance_eyes_open', secs: true },
  { id: 'sl_stance_ec', name: 'Single-leg stance, eyes closed', cat: 'balance', months: [1, 2, 3], track: 'time', measure: 'balance_eyes_closed', secs: true },
  { id: 'sl_foam', name: 'Single-leg stance on foam', cat: 'balance', months: [1, 2, 3], track: 'time', secs: true },
  { id: 'sl_balance_clock', name: 'Single-leg balance on foam with clock-face taps', cat: 'balance', months: [1, 2, 3], track: 'time', clinic: true, secs: true },
  { id: 'sl_foam_task', name: 'Single-leg balance on foam with juggling or a dynamic skill', cat: 'balance', months: [1, 2, 3, 4], track: 'time', measure: 'sl_foam_task', clinic: true, secs: true },
  { id: 'sebt', name: 'Single-leg star excursion, 8 points', cat: 'balance', months: [2, 3, 4, 5, 6], track: 'setsreps', measure: 'sebt_composite' },
  { id: 'vestib_balance', name: 'Vestibular balance drill with head turns', cat: 'balance', months: [3, 4, 5, 6], track: 'time', secs: true },

  // ---- Aerobic ----------------------------------------------------------
  { id: 'airbike', name: 'Air bike', cat: 'aerobic', months: [1, 2, 3, 4, 5, 6], track: 'time', cardio: true, clinic: true, note: 'Clinic prescription: 30 seconds on, 15 seconds off, for 10 minutes.' },
  { id: 'bike', name: 'Exercise bike', cat: 'aerobic', months: [1, 2, 3, 4, 5, 6], track: 'time', cardio: true, gym: true },
  { id: 'rowing', name: 'Rowing machine', cat: 'aerobic', months: [1, 2, 3, 4, 5, 6], track: 'time', cardio: true, clinic: true, note: 'Cleared 24 July 2026.' },
  { id: 'elliptical', name: 'Elliptical', cat: 'aerobic', months: [1, 2, 3, 4, 5, 6], track: 'time', cardio: true, gym: true },
  { id: 'walk', name: 'Walk', cat: 'aerobic', months: [1, 2, 3], track: 'time' },
  { id: 'brisk_walk', name: 'Brisk walk', cat: 'aerobic', months: [2, 3, 4], track: 'time' },
  { id: 'pool', name: 'Pool work', cat: 'aerobic', months: [1, 2, 3], track: 'time' },
  { id: 'swim', name: 'Light swimming', cat: 'aerobic', months: [1, 2, 3], track: 'time' },
  { id: 'intervals', name: 'Interval conditioning', cat: 'aerobic', months: [2, 3, 4, 5, 6], track: 'time', tag: 'interval' },
  { id: 'hi_bouts', name: 'Repeated high-intensity bouts, short recovery', cat: 'aerobic', months: [4, 5, 6], track: 'time', tag: 'interval' },

  // ---- Impact and plyometrics -------------------------------------------
  { id: 'reformer_jump', name: 'Jump board reformer', cat: 'impact', months: [2, 3], track: 'setsreps' },
  { id: 'dl_plyo', name: 'Double-leg plyometrics', cat: 'impact', months: [2, 3, 4], track: 'setsreps' },
  { id: 'dl_drop_land', name: 'Double-leg drop landing from a box', cat: 'impact', months: [2, 3, 4], track: 'setsreps' },
  { id: 'assisted_pogo', name: 'Assisted double-leg pogos', cat: 'impact', months: [2, 3], track: 'setsreps' },
  { id: 'stepup_hop', name: 'Step-up with a small hop', cat: 'impact', months: [2, 3], track: 'setsreps' },
  { id: 'dl_land_drill', name: 'Double-leg landing drill', cat: 'impact', months: [3, 4], track: 'setsreps' },
  { id: 'alt_land_drill', name: 'Alternating landing drill', cat: 'impact', months: [3, 4], track: 'setsreps' },
  { id: 'sl_land_drill', name: 'Single-leg landing drill', cat: 'impact', months: [3, 4, 5, 6], track: 'setsreps' },
  { id: 'dl_jump', name: 'Double-leg jumps', cat: 'impact', months: [4, 5, 6], track: 'setsreps' },
  { id: 'sl_hop', name: 'Single-leg hops', cat: 'impact', months: [4, 5, 6], track: 'setsreps' },
  { id: 'repeated_hops', name: 'Repeated hops', cat: 'impact', months: [4, 5, 6], track: 'setsreps', measure: 'repeated_hops' },
  { id: 'lateral_hops', name: 'Lateral hops', cat: 'impact', months: [4, 5, 6], track: 'setsreps' },
  { id: 'multidir_land', name: 'Multidirectional landing tasks', cat: 'impact', months: [4, 5, 6], track: 'setsreps' },

  // ---- Running ----------------------------------------------------------
  { id: 'walk_jog', name: 'Walk-jog intervals on a treadmill', cat: 'running', months: [3, 4], track: 'time' },
  { id: 'jog_intervals', name: 'Jogging intervals on a treadmill', cat: 'running', months: [4, 5, 6], track: 'time' },
  { id: 'run', name: 'Continuous running', cat: 'running', months: [5, 6], track: 'time' },

  // ---- Agility ----------------------------------------------------------
  { id: 'side_step', name: 'Side-stepping', cat: 'agility', months: [3, 4, 5, 6], track: 'setsreps' },
  { id: 'lateral_load', name: 'Weighted or banded side steps', cat: 'agility', months: [2, 3, 4], track: 'setsreps', usesBand: true },
  { id: 'shuttle', name: 'Shuttle jogs', cat: 'agility', months: [4, 5, 6], track: 'setsreps' },
  { id: 'figure8', name: 'Figure-of-eight runs', cat: 'agility', months: [4, 5, 6], track: 'setsreps' },
  { id: 'ladder', name: 'Ladder drills', cat: 'agility', months: [3, 4, 5, 6], track: 'setsreps' },
  { id: 'planned_cod', name: 'Planned change of direction', cat: 'agility', months: [3, 4, 5, 6], track: 'setsreps' },
  { id: 'reactive_cod', name: 'Reactive change of direction', cat: 'agility', months: [3, 4, 5, 6], track: 'setsreps', tag: 'reactive' },
  { id: 'decel', name: 'Deceleration drills', cat: 'agility', months: [4, 5, 6], track: 'setsreps' },
  { id: 'cutting', name: 'Cutting, multidirectional', cat: 'agility', months: [4, 5, 6], track: 'setsreps' },

  // ---- Dance and show ---------------------------------------------------
  { id: 'marking', name: 'Marking choreography, no jumping or running', cat: 'dance', months: [3, 4], track: 'time' },
  { id: 'dance_sagittal', name: 'Dance-specific movement, forward and back only', cat: 'dance', months: [3, 4], track: 'time' },
  { id: 'dance_ul', name: 'Coordinated arm work with dance', cat: 'dance', months: [3, 4], track: 'time' },
  { id: 'dance_jump', name: 'Dance-specific jumping', cat: 'dance', months: [4, 5, 6], track: 'time' },
  { id: 'bbb', name: "'Bye Bye Bye' run", cat: 'dance', months: [4, 5, 6], track: 'setsreps' },
  { id: 'show_section', name: 'Show section rehearsal', cat: 'dance', months: [5, 6], track: 'time' },
  { id: 'partial_run', name: 'Partial show run-through', cat: 'show', months: [5, 6], track: 'pct', measure: 'show_runthrough_pct' },
  { id: 'full_run', name: 'Full show run-through', cat: 'show', months: [6], track: 'time', measure: 'show_minutes' },
  { id: 'stage_env', name: 'Full performance environment — stage, shoes, costume', cat: 'show', months: [6], track: 'time' },

  // ---- Kneeling ---------------------------------------------------------
  { id: 'kneel_floor_transfer', name: 'Stand to sit on the ground through kneeling, then back up', cat: 'kneeling', months: [1, 2, 3, 4, 5, 6], track: 'setsreps', clinic: true },
  { id: 'kneel_hold', name: 'Short kneeling hold', cat: 'kneeling', months: [4, 5, 6], track: 'time', secs: true },
  { id: 'kneel_reps', name: 'Repeated kneeling transitions', cat: 'kneeling', months: [4, 5, 6], track: 'setsreps' },
  { id: 'kneel_floor_stand', name: 'Floor to kneel to stand transitions', cat: 'kneeling', months: [5, 6], track: 'setsreps' },
  { id: 'kneel_perf', name: 'Performance-specific kneeling', cat: 'kneeling', months: [5, 6], track: 'time', secs: true },

  // ---- Mobility ---------------------------------------------------------
  { id: 'ext_prop', name: 'Knee extension stretch — heel prop or prone hang', cat: 'mobility', months: [1, 2, 3, 4, 5, 6], track: 'time', secs: true },
  { id: 'flexion', name: 'Knee bending work', cat: 'mobility', months: [1, 2, 3, 4, 5, 6], track: 'setsreps' },
  { id: 'quad_sets', name: 'Quad sets', cat: 'mobility', months: [1, 2], track: 'setsreps' },
  { id: 'patella', name: 'Kneecap mobilisation', cat: 'mobility', months: [1, 2], track: 'time', secs: true },
  { id: 'calf_stretch', name: 'Calf stretch', cat: 'mobility', months: [1, 2, 3, 4, 5, 6], track: 'time', clinic: true, secs: true },
  { id: 'stretch', name: 'Stretching', cat: 'mobility', months: [1, 2, 3, 4, 5, 6], track: 'time' },
  { id: 'release', name: 'Foam rolling or self-release', cat: 'mobility', months: [1, 2, 3, 4, 5, 6], track: 'time' },

  // ---- Recovery ---------------------------------------------------------
  { id: 'ice', name: 'Ice', cat: 'recovery', months: [1, 2, 3, 4, 5, 6], track: 'time' },
  { id: 'compression', name: 'Compression', cat: 'recovery', months: [1, 2, 3, 4, 5, 6], track: 'time' },
  { id: 'cooldown', name: 'Cool-down', cat: 'recovery', months: [1, 2, 3, 4, 5, 6], track: 'time' },
  { id: 'warmup', name: 'Warm-up / injury-prevention routine', cat: 'recovery', months: [1, 2, 3, 4, 5, 6], track: 'time' },
];

/** Loaded through a freely moving foot — the quad-specific resistance numbers. */
export const OPEN_CHAIN = new Set(EXERCISES.filter((e) => e.chain === 'open').map((e) => e.id));

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));
