// One word that tells him what to do, shown either side of the leg in the
// player (his ask, 2026-09-18: "Balance!" for the balance, not "Hold"). Rules
// are read in order against the exercise id and name; the first match wins.
// Rest, get ready and switch keep their plain words: they are not a prompt.

const RULES = [
  [/pulse/, 'Pulse'],
  [/stretch|ext_prop|flexion/, 'Stretch'],
  [/dance|marking/, 'Dance'],
  [/knee extension|knee_ext|full_quad|inner_quad|tke|quad_sets/, 'Extend'],
  [/balance|stance|sebt|star excursion|vestib/, 'Balance'],
  [/wall_sit|ball squeeze/, 'Squeeze'],
  [/sit.to.stand|sts_/, 'Stand'],
  [/lunge/, 'Lunge'],
  [/squat|leg_press/, 'Squat'],
  [/side_bridge/, 'Brace'],
  [/bridge/, 'Bridge'],
  [/pulse/, 'Pulse'],
  [/calf/, 'Raise'],
  [/slr|hip_abd|hip_lift|sidelying/, 'Lift'],
  [/nordic|ham_curl/, 'Curl'],
  [/rdl/, 'Hinge'],
  [/step(up|down)|step_down|stepup/, 'Step'],
  [/pogo|jump|plyo/, 'Jump'],
  [/hop/, 'Hop'],
  [/land/, 'Land'],
  [/core/, 'Brace'],
  [/kneel/, 'Kneel'],
  [/walk_jog|jog|run$|^run/, 'Run'],
  [/walk/, 'Walk'],
  [/bike|elliptical/, 'Ride'],
  [/rowing/, 'Row'],
  [/swim|pool/, 'Swim'],
  [/side_step|lateral_load|shuttle|figure8|ladder|cod|decel|cutting/, 'Move'],
  [/show|full_run|partial_run|stage_env/, 'Perform'],
  [/release/, 'Roll'],
];

/** "Balance", "Squat"... or null when nothing specific fits. */
export function cueWord(ex) {
  if (!ex || ex.id === 'custom_workout') return null;
  const key = `${ex.id} ${String(ex.name || '').toLowerCase()}`;
  for (const [re, w] of RULES) if (re.test(key)) return w;
  return null;
}
