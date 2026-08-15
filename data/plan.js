// The 6-month goal-based protocol, transcribed from
// the six-month rehab plan document.
//
// `src` on a weekly target / checklist item marks where it came from:
//   'plan'   - the number is written in the document
//   'derived'- I set a sensible starting number; the document gives the
//              activity but no frequency. Edit these freely in the app.

export const PLAN_MONTHS = [
  {
    id: 'm1',
    n: 1,
    name: 'Month 1',
    monthLabel: "August '26",
    start: '2026-08-01',
    end: '2026-08-31',
    title: 'Complete Phase 2 foundations: strength, range of motion and neuromuscular control',
    melbournePhase: 2,
    goals: [
      { id: 'm1g1', text: '10x single-leg calf raises', kind: 'metric', measure: 'sl_calf_raise', target: 10 },
      { id: 'm1g2', text: '5x single-leg squats', kind: 'metric', measure: 'sl_squat_reps', target: 5 },
      { id: 'm1g3', text: '15x single-leg bridge', kind: 'metric', measure: 'sl_bridge', target: 15 },
      { id: 'm1g4', text: '8x lateral step-ups', kind: 'metric', measure: 'lateral_step_up', target: 8 },
      { id: 'm1g5', text: 'Single-leg stance on foam with juggling: 15 seconds', kind: 'metric', measure: 'sl_foam_task', target: 15 },
    ],
    focus: [
      {
        heading: 'Knee response to load',
        items: [
          { t: 'Ongoing tracking of knee response to load: watch for pain, effusion, swelling and next-day symptoms.', auto: 'checkin' },
          { t: 'If any swelling, regress as tolerated.' },
        ],
      },
      {
        heading: 'Strength — bilateral and unilateral lower limb (quads, hamstrings, glutes, calf)',
        items: [
          { t: 'As tolerated: high sit-to-stand → low sit-to-stand → double-leg squat → split squat → single-leg squat', ex: ['sts_high', 'sts_low', 'dl_squat', 'split_squat', 'sl_squat', 'sts_band_foam', 'sl_mini_squat_band'] },
          { t: 'As tolerated: double-leg bridge → single-leg bridge', ex: ['dl_bridge', 'sl_bridge', 'dl_bridge_band', 'bridge_band_sl_ext', 'sl_bridge_band_abd', 'sl_glute_bridge', 'dl_glute_bridge_chair', 'bridge_butterfly'] },
          { t: 'As tolerated: Forward and lateral step-ups / step-downs', ex: ['fwd_stepup', 'lat_stepup', 'fwd_stepdown', 'lat_stepdown', 'step_down_backward', 'hip_lift_step'] },
          { t: 'As tolerated: double-leg calf raises → single-leg calf raises → foam → add coordination tasks (ball catch, juggling, card deck shuffling)', ex: ['dl_calf', 'sl_calf', 'sl_calf_foam', 'sl_calf_coord', 'sl_calf_band', 'calf_pulses', 'dl_calf_raise_band', 'seated_calf_raise', 'standing_calf_raise_load'] },
        ],
      },
      {
        heading: 'Balance and proprioception',
        items: [{ t: 'Progressing from stable → unstable surfaces (foam / pillow)', ex: ['sl_stance', 'sl_stance_ec', 'sl_foam', 'sl_foam_task', 'sl_balance_clock', 'sebt'] }],
      },
      {
        heading: 'Low-impact aerobic capacity',
        items: [
          { t: 'Stationary bike / elliptical', ex: ['bike', 'elliptical', 'airbike'] },
          { t: 'Progressive daily walks', ex: ['walk', 'brisk_walk'] },
          { t: 'Hydrotherapy if you have pool access — walking / leg swings → build to light swimming', ex: ['pool', 'swim'] },
        ],
      },
    ],
    weeklyTargets: [
      { id: 'm1w1', label: 'Strength sessions', target: 3, cats: ['strength'], src: 'derived' },
      { id: 'm1w2', label: 'Balance / proprioception sessions', target: 4, cats: ['balance'], src: 'derived' },
      { id: 'm1w3', label: 'Aerobic sessions (bike / elliptical / walk / pool)', target: 5, cats: ['aerobic'], src: 'derived' },
      { id: 'm1w4', label: 'Days logged', target: 6, cats: ['*'], src: 'derived' },
    ],
    checklist: [
      { id: 'm1c1', text: 'Knee check-in logged (pain, swelling, next-day symptoms)', src: 'plan' },
      { id: 'm1c2', text: 'Progressive walk', src: 'plan' },
      { id: 'm1c3', text: 'Range of motion / knee extension work', src: 'derived' },
    ],
  },

  {
    id: 'm2',
    n: 2,
    name: 'Month 2',
    monthLabel: 'September',
    start: '2026-09-01',
    end: '2026-09-30',
    title: 'Consolidate Phase 2 and prepare for impact',
    melbournePhase: 2,
    note: 'Target ≥85–90% limb symmetry, recognising that bilateral ACL reconstruction makes the uninvolved limb a less reliable "normal" reference.',
    goals: [
      { id: 'm2g1', text: '20x single-leg calf raises', kind: 'metric', measure: 'sl_calf_raise', target: 20 },
      { id: 'm2g2', text: '10x single-leg squats', kind: 'metric', measure: 'sl_squat_reps', target: 10 },
      { id: 'm2g3', text: '15x lateral step-ups, L = R', kind: 'metric', measure: 'lateral_step_up', target: 15 },
      { id: 'm2g4', text: 'Single-leg stance on foam with juggling or another task: 30 seconds', kind: 'metric', measure: 'sl_foam_task', target: 30 },
      { id: 'm2g5', text: '1.5x bodyweight squat', kind: 'ratio', measure: 'squat_1rm', target: 1.5 },
      { id: 'm2g6', text: '1.5x bodyweight incline leg press', kind: 'ratio', measure: 'leg_press_1rm', target: 1.5 },
    ],
    focus: [
      { heading: 'Overall', items: [{ t: 'Reducing reliance on bilateral exercises' }] },
      {
        heading: 'Strength and movement control',
        items: [
          { t: 'Progress single-leg squat depth and quality, focusing on: knee-over-2nd-toe alignment, pelvic control, trunk stability', ex: ['sl_squat', 'sl_mini_squat_band'] },
        ],
      },
      {
        heading: 'Dynamic neuromuscular exercises',
        items: [
          { t: 'Lateral step-downs with weight', ex: ['lat_stepdown'] },
          { t: 'Multidirectional lunges with weight', ex: ['multi_lunge'] },
          { t: 'Controlled lateral loading (side steps with weight / band → lateral step with speed)', ex: ['lateral_load', 'side_step'] },
        ],
      },
      {
        heading: 'Aerobic conditioning',
        items: [
          { t: 'Increase aerobic conditioning as tolerated (build to 30 mins minimum)', cat: 'aerobic' },
          { t: 'Introduce interval-based conditioning to begin developing the capacity required for a 1-hour show', ex: ['intervals', 'hi_bouts'] },
        ],
      },
      {
        heading: 'Impact preparation — only if knee discomfort is <2/10 with the above',
        items: [
          { t: 'Jump board reformer (if you have access) → double-leg plyometrics, building towards single leg', ex: ['reformer_jump', 'dl_plyo'] },
          { t: 'Double-leg drop landings, starting with a small box', ex: ['dl_drop_land'] },
          { t: 'Assisted double-leg pogos (heavy band or hands on barre)', ex: ['assisted_pogo'] },
          { t: 'Step-ups with a small hop', ex: ['stepup_hop'] },
        ],
      },
    ],
    weeklyTargets: [
      { id: 'm2w1', label: 'Strength sessions', target: 3, cats: ['strength'], src: 'derived' },
      { id: 'm2w2', label: 'Aerobic sessions ≥30 min', target: 4, cats: ['aerobic'], src: 'plan', note: '"build to 30 mins min" is from the plan; 4x/week is my starting number' },
      { id: 'm2w3', label: 'Interval conditioning sessions', target: 2, cats: ['aerobic'], src: 'derived', tagged: 'interval' },
      { id: 'm2w4', label: 'Impact-prep sessions', target: 2, cats: ['impact'], src: 'derived' },
      { id: 'm2w5', label: 'Balance / neuromuscular sessions', target: 3, cats: ['balance'], src: 'derived' },
    ],
    checklist: [
      { id: 'm2c1', text: 'Knee check-in logged', src: 'plan' },
      { id: 'm2c2', text: 'Discomfort <2/10 before any impact work', src: 'plan' },
    ],
  },

  {
    id: 'm3',
    n: 3,
    name: 'Month 3',
    monthLabel: 'October',
    start: '2026-10-01',
    end: '2026-10-31',
    title: 'Transition into Phase 3: Running, landing and agility',
    melbournePhase: 3,
    goals: [
      {
        id: 'm3g1',
        text: 'Tolerate progressive brisk walking speed/volume and introductory hopping/landing without increased effusion, significant pain or deterioration in movement quality',
        kind: 'check',
      },
      { id: 'm3g2', text: 'Progress from planned to more reactive movement', kind: 'check' },
      { id: 'm3g3', text: 'Maintain progressive loading alongside increased impact exposure', kind: 'check' },
    ],
    focus: [
      { heading: 'Strength', items: [{ t: 'Continue 2–3 strength sessions/week to maintain progressive loading alongside increased impact exposure', cat: 'strength' }] },
      {
        heading: 'Landing',
        items: [
          { t: 'Bilateral then unilateral landing drills', ex: ['dl_land_drill', 'alt_land_drill', 'sl_land_drill'] },
          { t: 'Soft, controlled landings and appropriate hip/knee/trunk mechanics' },
          { t: 'Double leg → alternating → single leg, initially forward and back only', ex: ['dl_land_drill', 'alt_land_drill', 'sl_land_drill'] },
        ],
      },
      {
        heading: 'Dance-specific movement',
        items: [
          { t: 'Introduce low-level dance-specific movement patterns (mark show choreography as tolerated, no jumping or running)', ex: ['marking', 'dance_sagittal'] },
          { t: 'Initially without maximal speed or rapid cutting' },
          { t: 'Sagittal plane' },
          { t: 'Coordinated upper-limb movements', ex: ['dance_ul'] },
        ],
      },
      {
        heading: 'Running and agility',
        items: [
          { t: 'Integrate walk-jog or higher-speed walking intervals on a predictable surface (treadmill)', ex: ['walk_jog', 'brisk_walk'] },
          { t: 'Lateral movement and side-stepping (can make choreography specific)', ex: ['side_step', 'lateral_load'] },
          { t: 'Progress from planned to more reactive movement', ex: ['reactive_cod'] },
        ],
      },
    ],
    weeklyTargets: [
      { id: 'm3w1', label: 'Strength sessions', target: 3, cats: ['strength'], src: 'plan', note: 'Plan says 2–3/week' },
      { id: 'm3w2', label: 'Landing / impact sessions', target: 2, cats: ['impact'], src: 'derived' },
      { id: 'm3w3', label: 'Walk-jog / treadmill interval sessions', target: 2, cats: ['running'], src: 'derived' },
      { id: 'm3w4', label: 'Dance-specific sessions', target: 2, cats: ['dance'], src: 'derived' },
      { id: 'm3w5', label: 'Agility sessions', target: 2, cats: ['agility'], src: 'derived' },
    ],
    checklist: [
      { id: 'm3c1', text: 'Knee check-in logged', src: 'plan' },
      { id: 'm3c2', text: 'No increased effusion after yesterday', src: 'plan' },
    ],
  },

  {
    id: 'm4',
    n: 4,
    name: 'Month 4',
    monthLabel: 'November',
    start: '2026-11-01',
    end: '2026-11-30',
    title: 'Progress Phase 3: Agility, cutting and dance-specific conditioning',
    melbournePhase: 3,
    goals: [
      {
        id: 'm4g1',
        text: 'Complete progressively more complex but planned jumping, landing, agility and dance tasks with good mechanics and no reactive knee swelling',
        kind: 'check',
      },
      { id: 'm4g2', text: '1.8x bodyweight one-rep-max single-leg press', kind: 'ratio', measure: 'leg_press_1rm', target: 1.8 },
      { id: 'm4g3', text: '1.8x bodyweight one-rep-max squat', kind: 'ratio', measure: 'squat_1rm', target: 1.8 },
    ],
    focus: [
      {
        heading: 'Conditioning',
        items: [
          { t: 'Progress conditioning towards repeated high-intensity bouts with reduced recovery period to replicate the intermittent demands of performing', ex: ['hi_bouts', 'intervals'] },
        ],
      },
      {
        heading: 'Running and agility',
        items: [
          { t: 'Progress brisk walking to jogging intervals (treadmill)', ex: ['jog_intervals', 'walk_jog'] },
          { t: 'Introduce structured agility drills (sagittal + frontal planes)', ex: ['ladder', 'planned_cod'] },
          { t: 'Shuttle jogs, figure-8s', ex: ['shuttle', 'figure8'] },
        ],
      },
      {
        heading: 'Plyometrics',
        items: [
          { t: 'Progress planned hopping and plyometrics as tolerated', ex: ['sl_hop', 'repeated_hops', 'dl_jump', 'dl_plyo', 'jump_prep_step'] },
          { t: 'Double-leg jumps, single-leg hops, repeated hops, lateral hops and multidirectional landing tasks', ex: ['dl_jump', 'sl_hop', 'repeated_hops', 'lateral_hops', 'multidir_land'] },
        ],
      },
      {
        heading: 'Dance-specific exposure',
        items: [
          { t: 'Introduce dance-specific jumping and dynamic movement, initially at min–mod intensity', ex: ['dance_jump'] },
        ],
      },
      {
        heading: 'Kneeling',
        items: [
          { t: 'Continue graded kneeling exposure', ex: ['kneel_hold', 'kneel_reps'] },
          { t: 'Progress from short-duration kneeling to repeated kneeling transitions and performance-specific positions, while monitoring knee symptoms', ex: ['kneel_reps', 'kneel_floor_stand', 'kneel_perf'] },
        ],
      },
      {
        heading: 'Deceleration',
        items: [
          { t: 'Develop planned deceleration capacity, particularly important given the demands of running around a stage and rapidly changing direction', ex: ['decel'] },
        ],
      },
    ],
    weeklyTargets: [
      { id: 'm4w1', label: 'Strength sessions', target: 3, cats: ['strength'], src: 'derived' },
      { id: 'm4w2', label: 'Plyometric sessions', target: 2, cats: ['impact'], src: 'derived' },
      { id: 'm4w3', label: 'Agility / deceleration sessions', target: 2, cats: ['agility'], src: 'derived' },
      { id: 'm4w4', label: 'Jogging interval sessions', target: 2, cats: ['running'], src: 'derived' },
      { id: 'm4w5', label: 'Dance-specific sessions', target: 2, cats: ['dance'], src: 'derived' },
      { id: 'm4w6', label: 'Kneeling exposure sessions', target: 3, cats: ['kneeling'], src: 'derived' },
    ],
    checklist: [
      { id: 'm4c1', text: 'Knee check-in logged', src: 'plan' },
      { id: 'm4c2', text: 'No reactive knee swelling', src: 'plan' },
    ],
  },

  {
    id: 'm5',
    n: 5,
    name: 'Month 5',
    monthLabel: 'December',
    start: '2026-12-01',
    end: '2026-12-31',
    title: 'Phase 4: Return-to-performance preparation',
    melbournePhase: 4,
    goals: [
      { id: 'm5g1', text: 'Tolerate moderate-intensity rehearsal sessions with <2/10 discomfort or effusion', kind: 'check' },
      {
        id: 'm5g2',
        text: 'Demonstrate adequate strength, hop (min x10 bilat) and agility for >50% show run-through',
        kind: 'metric',
        measure: 'repeated_hops',
        target: 10,
        caution: 'The plan writes "hop (min x10 bilat)". I read that as 10 repeated hops on each leg — worth confirming with your physio.',
      },
      { id: 'm5g3', text: '>50% show run-through completed', kind: 'metric', measure: 'show_runthrough_pct', target: 50, unitless: true },
    ],
    focus: [
      {
        heading: 'Strength',
        items: [
          { t: 'Continue strength training with emphasis on maintaining high force capacity, eccentric strength and unilateral control', cat: 'strength' },
        ],
      },
      {
        heading: 'Dance and performance-specific training',
        items: [
          { t: 'Transition from isolated rehabilitation drills towards integrated dance and performance-specific training', ex: ['dance_sagittal', 'dance_jump', 'show_section'] },
          { t: 'Begin rehearsing full sections of the actual show, progressively increasing duration, speed, complexity and movement density', ex: ['show_section'] },
          { t: 'Progress side-stepping and cutting to multidirectional and performance-specific movement', ex: ['side_step', 'cutting'] },
        ],
      },
      {
        heading: 'Show exposure',
        items: [{ t: 'Begin partial run-throughs of the show, initially in 20% increments, with planned recovery periods', ex: ['partial_run'] }],
      },
      {
        heading: 'Kneeling',
        items: [{ t: 'Progress to repeated and prolonged performance-specific kneeling, including transitions floor → kneeling → standing', ex: ['kneel_perf', 'kneel_floor_stand'] }],
      },
    ],
    weeklyTargets: [
      { id: 'm5w1', label: 'Strength sessions', target: 3, cats: ['strength'], src: 'derived' },
      { id: 'm5w2', label: 'Dance / rehearsal sessions', target: 3, cats: ['dance'], src: 'derived' },
      { id: 'm5w3', label: 'Show run-through sessions', target: 2, cats: ['show'], src: 'derived' },
      { id: 'm5w4', label: 'Kneeling sessions', target: 3, cats: ['kneeling'], src: 'derived' },
      { id: 'm5w5', label: 'Agility / cutting sessions', target: 2, cats: ['agility'], src: 'derived' },
    ],
    checklist: [
      { id: 'm5c1', text: 'Knee check-in logged', src: 'plan' },
      { id: 'm5c2', text: 'Discomfort / effusion <2/10 after rehearsal', src: 'plan' },
      { id: 'm5c3', text: 'Planned recovery period taken after show exposure', src: 'plan' },
    ],
  },

  {
    id: 'm6',
    n: 6,
    name: 'Month 6',
    monthLabel: 'January',
    start: '2027-01-01',
    end: '2027-01-31',
    title: 'Full performance-specific return and show preparation',
    melbournePhase: 4,
    goals: [
      {
        id: 'm6g1',
        text: 'Complete final objective reassessment: strength, hop testing (distance and dynamic), single-leg squat quality, balance, agility, running tolerance and patient-reported confidence/readiness',
        kind: 'check',
      },
      { id: 'm6g2', text: 'Establish a performance-day load management strategy', kind: 'check' },
      {
        id: 'm6g3',
        text: 'Complete the full 1-hour show at the required intensity with no significant pain, effusion or functional limitation',
        kind: 'metric',
        measure: 'show_runthrough_pct',
        target: 100,
        unitless: true,
      },
      { id: 'm6g4', text: 'Build to 2x full show runs in one day by end of January', kind: 'check' },
    ],
    focus: [
      {
        heading: 'Strength maintenance',
        items: [{ t: 'Continue 1–2 weekly strength sessions to maintain quadriceps, hamstring, gluteal and calf capacity', cat: 'strength' }],
      },
      {
        heading: 'Neuromuscular maintenance',
        items: [{ t: 'Continue neuromuscular / landing and cutting drills as part of the warm-up or maintenance program', ex: ['warmup', 'sl_land_drill', 'cutting'] }],
      },
      {
        heading: 'Show-specific conditioning',
        items: [
          { t: 'Progress to full or near-full show run-throughs, building towards the required 1-hour performance duration', ex: ['full_run', 'partial_run'] },
          { t: 'Replicate the demands of the show: running, dynamic dance, jumping, side-stepping, cutting, kneeling and rapid transitions', ex: ['full_run', 'stage_env'] },
        ],
      },
      {
        heading: 'Performance environment',
        items: [
          { t: 'Progress from controlled rehearsal conditions to the full performance environment, including stage surface, footwear, props/costumes and other relevant demands where possible', ex: ['stage_env'] },
        ],
      },
      {
        heading: 'Performance-day preparation',
        items: [
          { t: 'Warm-up and recovery', ex: ['warmup', 'cooldown'] },
          { t: 'Appropriate post-performance management (ice as needed, cool-down stretches, self-release exercises)', ex: ['ice', 'cooldown', 'release', 'stretch'] },
        ],
      },
    ],
    weeklyTargets: [
      { id: 'm6w1', label: 'Strength sessions', target: 2, cats: ['strength'], src: 'plan', note: 'Plan says 1–2/week' },
      { id: 'm6w2', label: 'Show run-throughs', target: 2, cats: ['show'], src: 'derived' },
      { id: 'm6w3', label: 'Neuromuscular warm-up / maintenance', target: 3, cats: ['balance', 'impact', 'agility'], src: 'plan', note: 'Plan says "as part of the warm-up"; frequency is mine' },
      { id: 'm6w4', label: 'Dance / rehearsal sessions', target: 3, cats: ['dance'], src: 'derived' },
    ],
    checklist: [
      { id: 'm6c1', text: 'Knee check-in logged', src: 'plan' },
      { id: 'm6c2', text: 'Warm-up completed', src: 'plan' },
      { id: 'm6c3', text: 'Post-performance management (ice / cool-down / self-release)', src: 'plan' },
    ],
  },
];

export function monthForDate(iso) {
  return PLAN_MONTHS.find((m) => iso >= m.start && iso <= m.end) || null;
}

export const PLAN_START = PLAN_MONTHS[0].start;
export const PLAN_END = PLAN_MONTHS[PLAN_MONTHS.length - 1].end;
