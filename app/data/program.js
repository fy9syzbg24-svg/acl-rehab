// The clinician program.
//
// Exercises 1-16 mirror the clinician's PhysiApp program, transcribed from
// the exported PDF. Prescriptions and wording are theirs.

export const THERABAND = [
  { id: 'tan', name: 'Tan', swatch: '#d9c3a5', order: 1 },
  { id: 'yellow', name: 'Yellow', swatch: '#f2d64b', order: 2 },
  { id: 'red', name: 'Red', swatch: '#e0574d', order: 3 },
  { id: 'green', name: 'Green', swatch: '#4ca85f', order: 4 },
  { id: 'blue', name: 'Blue', swatch: '#3d7fd1', order: 5 },
  { id: 'black', name: 'Black', swatch: '#2b2f36', order: 6 },
  { id: 'silver', name: 'Silver', swatch: '#b8bcc4', order: 7 },
  { id: 'gold', name: 'Gold', swatch: '#c9a227', order: 8 },
];

export const BAND_BY_ID = Object.fromEntries(THERABAND.map((b) => [b.id, b]));

// sides: 'both' -> one row · 'each' -> a left row and a right row · 'left' -> left only
export const REHAB_PROGRAM = [
  {
    n: 1, id: 'pa01', ex: 'dl_bridge_band', title: 'Bridge with resisted hip abduction',
    img: 'img/program/ex-01.png', thumb: 'img/program/ex-01-thumb.png',
    sides: 'both', sets: 2, reps: 12, band: 'green',
    steps: [
      'Place a resistance band loop around both thighs, just above your knees.',
      'Lie on your back with your knees bent and feet flat on the floor.',
      'Place legs hips width apart so that there is tension in the band.',
      'Raise your hips up into a bridge, keeping the knees hips width apart.',
      'Control the movement back down to the start position, maintaining constant tension on the band.',
    ],
    progressions: ['Single-leg bridge — exercises 2 and 3 below', 'Add weight over the hips'],
  },
  {
    n: 2, id: 'pa02', ex: 'bridge_band_sl_ext', title: 'Bridge with resisted hip abduction, into single-leg extension',
    img: 'img/program/ex-02.png', thumb: 'img/program/ex-02-thumb.png',
    sides: 'each', sets: 3, reps: 6,
    steps: [
      'Tie a resistance band around both thighs just above your knees.',
      'Lie on your back with your knees bent and legs hips width apart. There should be tension in the band.',
      'Raise your hips up into a bridge, keeping the knees hips width apart.',
      'Maintaining this space, straighten one leg out in front of you.',
      'Bring the leg back to the ground.',
      'Control the movement back down to the start position, maintaining constant tension on the band.',
    ],
  },
  {
    n: 3, id: 'pa03', ex: 'sl_bridge_band_abd', title: 'Single-leg bridge with resisted hip abduction',
    img: 'img/program/ex-03.png', thumb: 'img/program/ex-03-thumb.png',
    sides: 'each', sets: 3, reps: 6, hold: '1s',
    goal: '20 on each side',
    steps: [
      'Lie on your back with your knees bent and feet flat on the floor.',
      'Tie a resistance band around your thighs just above your knees. There should be some tension in the band with your legs and feet hips width apart.',
      'Lift one leg off the floor a little.',
      'Keeping a hips distance between your knees and feet, push through your grounded foot to lift your hips up into the air.',
      'Hold this position, then control the movement as you slowly lower your hips back to the floor.',
      'Check your legs have remained hips distance apart throughout.',
    ],
  },
  {
    n: 4, id: 'pa04', ex: 'bridge_butterfly', title: 'Butterfly gluteal bridge',
    img: 'img/program/ex-04.png', thumb: 'img/program/ex-04-thumb.png',
    sides: 'both', sets: 3, reps: 8,
    steps: [
      'From a crook lying position, bring your heels towards your bottom.',
      'Lift your heels, then elevate your pelvis into a bridge position.',
      'From here, keeping your pelvis stable, take your knees away from each other, then return.',
      'Feel the activity in your gluteals.',
    ],
    notes: [
      'Start at 45 seconds and progress 15 seconds every few days until you reach 2 minutes.',
      'Band around knees.',
    ],
    photoNote: 'Four frames supplied by the user; the PhysiApp export had a close-up of a light ring instead.',
  },
  {
    n: 5, id: 'pa05', ex: 'sts_band_foam', title: 'Sit to stand with resisted hip external rotation, on foam',
    img: 'img/program/ex-05.png', thumb: 'img/program/ex-05-thumb.png',
    sides: 'both', sets: 3, reps: 12,
    steps: [
      'Sit up straight on a chair with a resistance band tied just above your knees.',
      'Keep your legs just wider than hips width apart, with some tension in the band.',
      'Cross your hands over your chest and stand up, pushing your knees outwards against the resistance of the band.',
      'Control the movement as you sit back down.',
    ],
    notes: ['The slower you do this exercise, the harder it is.'],
    progressions: ['Split stance', 'Single leg'],
  },
  {
    n: 6, id: 'pa06', ex: 'seated_knee_ext_band', title: 'Resisted knee extension, seated',
    img: 'img/program/ex-06.png', thumb: 'img/program/ex-06-thumb.png',
    sides: 'each', sets: 3, reps: 15, hold: '1s',
    steps: [
      'Start in a seated position with a band around your ankles.',
      'One leg acts as an anchor while the affected leg does the work.',
      'Straighten the affected leg out in front of you against the resistance of the band.',
      'Control the movement as you return to the start position.',
    ],
  },
  {
    n: 7, id: 'pa07', ex: 'knee_ext_pulses_band', title: 'Knee extension with pulses, Theraband',
    img: 'img/program/ex-07.png', thumb: 'img/program/ex-07-thumb.png',
    sides: 'each', sets: 3, reps: 15, band: 'red',
    steps: [
      'Set up: tie a Theraband to the bottom of a chair in a loop.',
      'Loop the band around your ankle then cross it over so that it stays wrapped around your foot.',
      'Straighten your knee against the resistance of the band and pulse at the range specified by your therapist.',
      'Control your knee as it bends.',
    ],
    progressions: ['Increase the resistance or weight', 'Perform in time to a metronome or song'],
  },
  {
    n: 8, id: 'pa08', ex: 'sl_mini_squat_band', title: 'Knee extension into the band',
    img: 'img/program/ex-08.png', thumb: 'img/program/ex-08-thumb.png',
    sides: 'each', sets: 2, reps: 8,
    steps: [
      'Tie a Theraband in front of you and step into it so that it is looped behind one knee.',
      'Lift the other foot off the floor and hold it clear of the ground and of the other leg.',
      'Bend and straighten the leg in the band so that your knee is pushing into the band when it is straight.',
    ],
    notes: [
      'This one is for endurance: do as many reps as possible until the muscles feel tired, then try to get one more rep than last time.',
    ],
    progressions: ['Increase the hold time at the bottom', 'Perform on a foam mat'],
  },
  {
    n: 9, id: 'pa09', ex: 'sl_calf_band', title: 'Single-leg calf raises with a band on the inside of the ankle',
    img: 'img/program/ex-09.jpeg', thumb: 'img/program/ex-09-thumb.png',
    sides: 'each', sets: 3, reps: 8,
    goal: '20 single-leg calf raises',
    steps: [
      'Have your band tied around a stable structure and then step into it.',
      'Complete calf raises in each direction, keeping weight between the big toe and second toe.',
      'Begin by holding onto the wall or a chair for support.',
    ],
    progressions: ['Increase the hold time at the top', 'No hand support', 'Perform on a foam mat'],
  },
  {
    n: 10, id: 'pa10', ex: 'calf_pulses', title: 'Calf pulses at 120 beats per minute',
    img: 'img/program/ex-10.png', thumb: 'img/program/ex-10-thumb.png',
    sides: 'both', sets: 4, reps: 1, hold: '30s',
    steps: ['Pulse through the calves in time with a 120 bpm metronome or song.'],
    progressions: ['Increase the time', 'Build to 30-second intervals over 3 min 30 s'],
  },
  {
    n: 11, id: 'pa11', ex: 'sl_foam_task', title: 'Single-leg balance with a ball throw, catch, juggling or other dynamic skill',
    img: 'img/program/ex-11.png', thumb: 'img/program/ex-11-thumb.png',
    sides: 'left', sets: 1, reps: 5, hold: '30s',
    steps: [
      'Stand with your working leg on an unstable surface — a pillow, or a folded towel or yoga mat.',
      'Maintain your balance while you throw and catch a ball.',
    ],
    notes: ['Left side only for now.', 'Adding an unstable surface makes it harder.'],
  },
  {
    n: 12, id: 'pa12', ex: 'sebt', title: 'Single-leg star excursion, 8 points',
    img: 'img/program/ex-12.png', thumb: 'img/program/ex-12-thumb.png',
    sides: 'each', sets: 4, reps: 5,
    steps: [
      'Stand up straight on your affected leg.',
      'Place targets around you on the floor at 8 different points, like a star.',
      'Balance on your affected leg while slowly touching your elevated foot to each target.',
      'Keep good control in your stance leg, with the knee travelling directly forwards over your toes rather than inwards.',
    ],
  },
  {
    n: 13, id: 'pa13', ex: 'fwd_stepup', title: 'Step up',
    img: 'img/program/ex-13.png', thumb: 'img/program/ex-13-thumb.png',
    sides: 'each', sets: 2, reps: 8,
    steps: [
      'Stand facing a step and place your affected leg up on it.',
      'Step up bringing your other leg onto the step, then step back down to the start using the same leg.',
      'Make sure your knee travels forwards over your toes.',
      'Your affected leg stays on the step throughout.',
    ],
    progressions: ['Slow the speed down', 'Increase the height of the step'],
  },
  {
    n: 14, id: 'pa14', ex: 'lat_stepup', title: 'Sideways step up',
    img: 'img/program/ex-14.png', thumb: 'img/program/ex-14-thumb.png',
    sides: 'each', sets: 2, reps: 8,
    steps: [
      'Stand up straight, sideways to a step, affected leg closest to it and feet close together.',
      'You may use a handrail or chair for support if needed.',
      'Step your affected leg onto the step.',
      'Step up, pushing through your affected leg, and stand tall with the other leg hovering above the floor.',
      'Return your other leg to the floor, keeping your affected leg on the step.',
    ],
    progressions: ['Slow the speed down', 'Increase the height of the step'],
  },
  {
    n: 15, id: 'pa15', ex: 'jump_prep_step', title: 'Jump preparation off a step',
    img: 'img/program/ex-15.png', thumb: 'img/program/ex-15-thumb.png',
    sides: 'each', sets: 2, reps: 10,
    notYet: true,
    notYetNote: 'Marked to start about two months from 5 Aug 2026, then add small pogos and assisted jumping.',
    steps: [
      'Standing side-on to a step, step up with one leg so your foot is parallel to the edge and your opposite leg is suspended.',
      'Keeping one foot in contact with the step, drop down onto the opposite foot.',
      'Landing focus — cushion your landing by working through the foot and bending the knee as you land.',
      'Push-off focus — spring off the landing leg, pushing through your toes and pointing your foot as you push up.',
    ],
    notes: ['Keep most of your weight on the landing leg, using the leg on the step to assist.'],
  },
  {
    n: 16, id: 'pa16', ex: 'wall_sit_adductor', title: 'Wall squat with a ball squeeze between the knees',
    img: 'img/program/ex-16.png', thumb: 'img/program/ex-16-thumb.png',
    sides: 'both', sets: 2, reps: 3,
    steps: [
      'Lean up against the wall and place the ball between your knees.',
      'Walk your feet forwards, keeping your back and buttocks on the wall.',
      'Squeeze the ball between your knees as hard as you can as you slide down the wall into a squat.',
      'Return to the starting position, keeping the pressure on the ball.',
    ],
    notes: ['Targets the vastus medialis — the inner quad just above the kneecap.'],
  },

  // --- from the user's typed list, not in the PhysiApp program ---------------
  {
    n: 17, id: 'tp17', ex: 'hip_lift_step', title: 'Hip lift and lower off a step', typed: true, sides: 'each',
    img: 'img/program/ex-14.png', thumb: 'img/program/ex-14-thumb.png',
    photoNote: 'Same set-up as exercise 14 — the photo is of the sideways step up.',
    steps: [
      'Stand side-on with one foot on a step and the other hanging free.',
      'Let the free hip drop, then lift it back up by working the leg on the step.',
    ],
    progressions: ['Increase the depth of the hip drop and lift'],
  },
  {
    n: 18, id: 'tl18', ex: 'tendon_load_iso_squat', title: 'Tendon loading mini squat, 20 degrees', typed: true, sides: 'both',
    img: 'img/program/ex-18.png', thumb: 'img/program/ex-18-thumb.png',
    sets: 4, reps: 1, hold: '30s', rest: '2 min',
    pre: 'Collagen 15 g plus vitamin C 100 to 200 mg, mixed into water or juice. Then do this within the hour.',
    steps: [
      'Take the collagen and vitamin C, then start within the hour.',
      'Stand and bend the knees into roughly a 20 degree mini squat.',
      'Keep your torso and shoulders upright. Do not lean forward, or the load comes off the quad tendon.',
      'Hold that position for 30 seconds.',
      'Rest 2 minutes, then repeat. Four holds in total.',
      'Leave 6 hours before any of your other rehab exercises.',
    ],
    notes: [
      'About 20 degrees is the whole range. The point is a good stretch on the quad tendon, not depth and not fatigue.',
      'Torso and shoulders stay up. Leaning forward turns it into a hip exercise.',
      'The 6 hour gap afterwards is your clinician\u2019s instruction, not the handout\u2019s. The handout only uses 6 hours as the minimum gap between repeats of the collagen and loading cycle.',
      'Prescribed at your clinic session, so it is not part of the PhysiApp program.',
    ],
    progressions: ['Hold longer than 30 seconds', 'Add load or go slightly deeper'],
  },
];

export const GYM_PROGRAM = [
  { id: 'g_knee_ext_full', ex: 'sl_full_quad', sides: 'each', sets: 3, reps: 8 },
  { id: 'g_knee_ext_eor', ex: 'sl_inner_quad', sides: 'each', sets: 3, reps: 8 },
  { id: 'g_squat', ex: 'barbell_squat', sides: 'both', sets: 3, reps: 8 },
  { id: 'g_leg_press', ex: 'leg_press', sides: 'each', sets: 3, reps: 8 },
  { id: 'g_calf_straight', ex: 'weighted_calf_straight', sides: 'each', sets: 3, reps: 8 },
  { id: 'g_calf_bent', ex: 'weighted_calf_bent', sides: 'each', sets: 3, reps: 8 },
  // ONE cardio row, not two: the elliptical and a bike count as the same thing
  // and he logs whichever he has. He owns an elliptical. The separate `bike`
  // exercise stays in the library so his August sessions still read correctly.
  { id: 'g_elliptical', ex: 'elliptical', sides: 'both', cardio: true },
];

// Who prescribed this, and the PhysiApp access code, are personal — the code
// is half a login credential — so they live in your synced caseFile, not here.
// These are the neutral defaults a device sees before its first sync.
export let PROGRAM_SOURCE = {
  title: 'Rehab program',
  clinician: 'your clinician',
  updated: '',
  videos: '',
  code: '',
};

export let GYM_SOURCE = 'Gym-based strength. Other variations are fine; these are the main ones.';

/** Repoint the source labels at the synced caseFile. */
export function hydrateProgramSource(doc) {
  const src = doc && doc.caseFile && doc.caseFile.programSource;
  if (src) PROGRAM_SOURCE = { ...PROGRAM_SOURCE, ...src };
  const gym = doc && doc.caseFile && doc.caseFile.gymSource;
  if (gym) GYM_SOURCE = gym;
}

// ------------------------------------------------------------ day sets ----
// Which days of the week each item is planned for. Today shows the day's set
// first and folds the rest away, so "done" can mean finished.
//
// MY DEFAULT, not the clinician's: the PhysiApp export states no frequency.
// Derived from the 6-month plan's Month 2 weekly targets (3 strength · 3
// balance / neuromuscular · 4 aerobic) and the Melbourne guide ("performed
// more than once per week"). It seeds a device ONCE; whatever he sets on the
// Program tab afterwards is the arrangement, and code never overrides it.
export const DAYS = [
  ['mon', 'Monday', 'M'], ['tue', 'Tuesday', 'T'], ['wed', 'Wednesday', 'W'],
  ['thu', 'Thursday', 'T'], ['fri', 'Friday', 'F'], ['sat', 'Saturday', 'S'], ['sun', 'Sunday', 'S'],
];
export const DAY_KEYS = DAYS.map((d) => d[0]);
export const DAY_NAME = Object.fromEntries(DAYS.map((d) => [d[0], d[1]]));

export const DAYS_SOURCE = 'My default from the plan’s weekly targets (3 strength, 3 balance, 4 aerobic) — the program itself gives no frequency. Tap the days on any exercise to change it; what you set is kept.';

// STRENGTH LANDS ON MON, WED, FRI, and that spacing is the whole point: the
// evidence for post-ACLR strength work is 2 to 3 sessions a week with 48 hours
// between them. Mon to Wed is 48h, Wed to Fri is 48h, Fri to Mon is 72h, so no
// heavy day ever follows another. He usually sees his physio Wed and Fri, and
// those sessions are strength heavy (BFR, drills), so they ARE two of the three.
// Monday is the one he does himself.
const STRENGTH = ['mon', 'wed', 'fri'];
const BALANCE = ['tue', 'wed', 'thu', 'fri', 'sat'];      // low load, safe next to anything
const AEROBIC = ['mon', 'tue', 'thu', 'sat', 'sun'];      // 4 real sessions plus an easy Sunday
export const DEFAULT_DAYS = {
  pa01: STRENGTH, pa02: STRENGTH, pa03: STRENGTH, pa04: STRENGTH,
  pa06: STRENGTH, pa07: STRENGTH, pa08: STRENGTH, pa16: STRENGTH,
  pa09: STRENGTH, pa10: STRENGTH,                           // calves on every strength day
  pa05: STRENGTH, pa13: STRENGTH, pa14: STRENGTH, tp17: STRENGTH,
  pa11: BALANCE, pa12: BALANCE,
  pa15: [],                                                 // not yet — see notYetNote
  g_knee_ext_full: STRENGTH, g_knee_ext_eor: STRENGTH, g_squat: STRENGTH,
  g_leg_press: STRENGTH, g_calf_straight: STRENGTH, g_calf_bent: STRENGTH,
  g_elliptical: AEROBIC,
  tl18: DAY_KEYS.slice(),                                   // tendon loading: every day of the week
};

// ------------------------------------------------------------ the day plan --
// What a given day IS, so Today can say it in a line instead of showing a list
// and leaving him to work it out. The weekday entry is the fallback; an actual
// booked clinic day overrides it, because that session is the big workout.
export const WEEK_PLAN = {
  mon: { name: 'Strength', sub: 'your own strength session, 48 hours clear of Wednesday' },
  tue: { name: 'Balance and aerobic', sub: 'easy day between strength sessions' },
  wed: { name: 'Strength', sub: 'usually your clinic day' },
  thu: { name: 'Balance and aerobic', sub: 'easy day between strength sessions' },
  fri: { name: 'Strength', sub: 'usually your clinic day' },
  sat: { name: 'Balance and aerobic', sub: 'add the interval work here' },
  sun: { name: 'Easy aerobic', sub: 'the lightest day of the week' },
};

// On a clinic day these are the only things the app asks of him at home. The
// clinic session already covers the strength work, and doubling it is how you
// end up sore enough to skip the next day.
export const CLINIC_DAY_IDS = ['tl18', 'pa11', 'pa12'];

export const CLINIC_DAY_PLAN = {
  name: 'Clinic day',
  sub: 'the session with your physio is the workout; at home just the tendon loading and balance',
};

/** Has he marked this date as a clinic day? */
export function isClinicDay(doc, iso) {
  return !!doc?.program?.clinicDays?.[iso];
}

/** What today IS: a name, a one line reason, and whether it is a clinic day. */
export function dayPlanFor(doc, iso) {
  if (isClinicDay(doc, iso)) return { ...CLINIC_DAY_PLAN, clinic: true, key: dayKeyOf(iso) };
  const key = dayKeyOf(iso);
  return { ...(WEEK_PLAN[key] || { name: '', sub: '' }), clinic: false, key };
}

/** Weekday key ('mon'…'sun') of an ISO date. */
export function dayKeyOf(iso) {
  const d = new Date(iso + 'T12:00:00');
  return DAY_KEYS[(d.getDay() + 6) % 7];
}

/** Is this program item planned for that date? No entry at all means every day. */
export function plannedOn(doc, pid, iso) {
  if (isClinicDay(doc, iso)) return CLINIC_DAY_IDS.includes(pid);
  const days = doc.program?.days?.[pid];
  if (!Array.isArray(days)) return true;
  return days.includes(dayKeyOf(iso));
}

/**
 * Seed the day sets once. Same contract as the supplement seed: gated on a
 * settings flag, and refuses outright if ANY days exist — a lost flag can never
 * overwrite his arrangement.
 */
export function seedProgramDays(d) {
  if (d.settings?.daysSeeded) return false;
  d.program = d.program || {};
  d.program.days = d.program.days || {};
  if (Object.keys(d.program.days).length) { (d.settings ||= {}).daysSeeded = true; return false; }
  for (const [pid, days] of Object.entries(DEFAULT_DAYS)) d.program.days[pid] = days.slice();
  (d.settings ||= {}).daysSeeded = true;
  return true;
}

export const PROGRAM_BY_ID = Object.fromEntries(
  REHAB_PROGRAM.concat(GYM_PROGRAM).map((p) => [p.id, p]),
);
