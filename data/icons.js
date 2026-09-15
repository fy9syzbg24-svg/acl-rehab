// Line pictograms for the exercises that came with no photograph.
//
// Drawn here rather than sourced, so the whole set shares one visual language
// and there is no licensing question hanging over the app. Each glyph is a
// 48x48 line drawing using currentColor, so it takes the category tint and
// works in both light and dark themes.

const S = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';

export const ICONS = {
  // --- aerobic ------------------------------------------------------------
  bike: `<circle cx="13" cy="33" r="8" ${S}/><circle cx="35" cy="33" r="8" ${S}/>
         <path d="M13 33 L22 18 h8 M22 18 L28 33 M30 14 h6" ${S}/><circle cx="31" cy="12" r="2.4" ${F}/>`,
  elliptical: `<ellipse cx="24" cy="34" rx="15" ry="6" ${S}/><path d="M12 34 L16 14 M36 34 L32 14" ${S}/>
         <path d="M14 12 h5 M29 12 h5" ${S}/>`,
  row: `<path d="M6 38 h36" ${S}/><rect x="16" y="29" width="12" height="6" rx="1.5" ${S}/>
         <path d="M37 26 L42 37" ${S}/><path d="M14 21 h18" ${S}/><path d="M12 17 v9" ${S}/>`,
  walk: `<circle cx="26" cy="9" r="4" ${S}/><path d="M26 14 v10 l-7 14 M26 24 l7 12 M19 20 l-6 5 M26 20 l7 3" ${S}/>`,
  run: `<circle cx="29" cy="9" r="4" ${S}/><path d="M29 14 l-5 9 l8 6 l-2 12 M24 23 l-9 3 M32 18 l7 5" ${S}/>
         <path d="M6 16 h6 M4 24 h7" ${S} opacity=".55"/>`,
  swim: `<circle cx="16" cy="16" r="4" ${S}/><path d="M20 20 l10 -4 l8 6" ${S}/>
         <path d="M6 32 q6 -5 12 0 t12 0 t12 0 M6 40 q6 -5 12 0 t12 0 t12 0" ${S}/>`,
  interval: `<circle cx="24" cy="27" r="14" ${S}/><path d="M24 19 v8 l6 4 M19 6 h10 M24 6 v7" ${S}/>`,

  // --- strength -----------------------------------------------------------
  squat: `<circle cx="24" cy="8" r="4" ${S}/><path d="M8 18 h32" ${S}/>
          <path d="M24 13 v8 M24 21 l-8 8 v10 M24 21 l8 8 v10" ${S}/>`,
  lunge: `<circle cx="22" cy="9" r="4" ${S}/><path d="M22 14 v10 M22 24 l-10 15 M22 24 l10 8 v7" ${S}/>
          <path d="M6 40 h36" ${S} opacity=".45"/>`,
  legpress: `<path d="M6 40 L26 12" ${S}/><path d="M22 8 L34 20" ${S}/>
          <path d="M12 40 h26 M28 40 l6 -8" ${S}/><circle cx="14" cy="34" r="3" ${F}/>`,
  hamcurl: `<path d="M6 33 h22" ${S}/><circle cx="9" cy="29" r="3" ${S}/>
         <path d="M28 33 q11 0 11 -13" ${S}/><path d="M39 20 l-3.5 3.5 M39 20 l3.5 3.5" ${S}/>`,
  deadlift: `<path d="M8 30 h32" ${S}/><rect x="6" y="24" width="5" height="12" rx="1.5" ${S}/>
          <rect x="37" y="24" width="5" height="12" rx="1.5" ${S}/>
          <path d="M24 30 v-14 M24 12 l-4 5 M24 12 l4 5" ${S}/>`,
  hipabd: `<path d="M6 35 h17" ${S}/><circle cx="9" cy="31" r="3" ${S}/>
         <path d="M23 35 h15" ${S}/><path d="M23 35 L38 20" ${S}/>
         <path d="M35 31 a11 11 0 0 0 3.5 -8" ${S} stroke-dasharray="3 3"/>`,
  bandabd: `<path d="M15 9 v13 M33 9 v13" ${S}/>
         <path d="M15 25 l4.5 3.5 4.5 -3.5 4.5 3.5 4.5 -3.5" ${S}/>
         <path d="M15 31 v10 M33 31 v10" ${S}/>`,
  sideplank: `<path d="M8 38 L40 14" ${S}/><circle cx="40" cy="11" r="3.5" ${S}/>
          <path d="M12 38 v-10" ${S}/>`,
  core: `<ellipse cx="24" cy="24" rx="11" ry="15" ${S}/><path d="M24 12 v24 M17 19 h14 M17 29 h14" ${S} opacity=".55"/>`,
  kneeext: `<path d="M10 9 v21 h12" ${S}/><path d="M21 30 L38 25" ${S}/><path d="M38 25 l2.5 4" ${S}/>
         <path d="M25 39 a15 15 0 0 0 12 -12" ${S} stroke-dasharray="3 3"/>`,
  // --- impact -------------------------------------------------------------
  jump: `<circle cx="24" cy="12" r="4" ${S}/><path d="M24 17 v8 M24 25 l-7 12 M24 25 l7 12 M15 20 l-6 -5 M33 20 l6 -5" ${S}/>
          <path d="M10 42 h28" ${S} opacity=".4"/>`,
  dropbox: `<rect x="6" y="26" width="16" height="14" rx="2" ${S}/>
          <path d="M34 10 v16 M34 26 l-5 -5 M34 26 l5 -5" ${S}/><path d="M26 40 h16" ${S}/>`,
  hop: `<path d="M10 38 q14 -26 28 0" ${S} stroke-dasharray="4 4"/>
          <path d="M6 40 h10 M32 40 h10" ${S}/><circle cx="24" cy="16" r="3.5" ${F}/>`,
  latHop: `<path d="M8 24 h32" ${S} stroke-dasharray="4 4"/>
          <path d="M14 18 l-6 6 l6 6 M34 18 l6 6 l-6 6" ${S}/><circle cx="24" cy="38" r="3.5" ${F}/>`,

  // --- agility ------------------------------------------------------------
  cones: `<path d="M8 34 L14 16 L20 34 Z" ${S}/><path d="M28 34 L34 16 L40 34 Z" ${S}/><path d="M4 38 h40" ${S} opacity=".45"/>`,
  ladder: `<path d="M10 8 v32 M38 8 v32 M10 16 h28 M10 24 h28 M10 32 h28" ${S}/>`,
  decel: `<path d="M6 24 h26 M32 24 l-7 -6 M32 24 l-7 6" ${S}/><path d="M40 10 v28" ${S}/>`,
  sidestep: `<circle cx="24" cy="10" r="4" ${S}/><path d="M24 15 v10 M24 25 l-9 13 M24 25 l9 13" ${S}/>
          <path d="M6 22 h6 M36 22 h6" ${S} opacity=".55"/>`,

  // --- dance and show -----------------------------------------------------
  dance: `<circle cx="18" cy="9" r="4" ${S}/><path d="M18 14 l4 10 l-8 15 M22 24 l9 12 M14 19 l-7 6 M20 18 l12 -4" ${S}/>`,
  music: `<path d="M18 34 V10 l16 -4 v24" ${S}/><ellipse cx="14" cy="35" rx="5" ry="4" ${S}/>
          <ellipse cx="30" cy="31" rx="5" ry="4" ${S}/>`,
  stage: `<path d="M6 10 q18 8 36 0 M6 10 v26 M42 10 v26 M6 36 h36" ${S}/>
          <path d="M24 16 l2.4 5 5.6 .6 -4 4 1 5.4 -5-2.8 -5 2.8 1-5.4 -4-4 5.6-.6 Z" ${S}/>`,

  // --- kneeling, mobility, recovery --------------------------------------
  kneel: `<circle cx="18" cy="10" r="4" ${S}/><path d="M18 15 v11 M18 26 L32 34 M18 26 L14 38 h14" ${S}/>
          <path d="M6 40 h36" ${S} opacity=".45"/>`,
  stretch: `<circle cx="14" cy="10" r="4" ${S}/><path d="M14 15 q4 12 16 13 M14 22 v16 M14 38 h10" ${S}/>`,
  foamroll: `<rect x="8" y="20" width="32" height="12" rx="6" ${S}/><path d="M18 20 v12 M28 20 v12" ${S} opacity=".5"/>
          <path d="M14 12 h20 M30 12 l-3 -3 M30 12 l-3 3" ${S}/>`,
  clockface: `<circle cx="24" cy="24" r="15" ${S}/><circle cx="24" cy="24" r="3" ${F}/>
          <path d="M24 9 v3 M39 24 h-3 M24 39 v-3 M9 24 h3 M34 14 l-2 2 M34 34 l-2-2 M14 34 l2-2 M14 14 l2 2" ${S}/>`,
  kneerom: `<path d="M10 12 v16 q0 6 6 6 h16" ${S}/><path d="M22 28 a12 12 0 0 0 6 -10" ${S} stroke-dasharray="3 3"/>
          <circle cx="10" cy="10" r="3" ${F}/><circle cx="34" cy="34" r="3" ${F}/>`,
  ice: `<path d="M24 6 v36 M9 15 l30 18 M39 15 L9 33" ${S}/>
        <path d="M20 10 l4 4 4-4 M20 38 l4-4 4 4" ${S}/>`,
  compress: `<path d="M12 14 h24 M10 22 h28 M12 30 h24 M16 38 h16" ${S}/>`,
  warmup: `<circle cx="24" cy="24" r="8" ${S}/>
        <path d="M24 6 v5 M24 37 v5 M6 24 h5 M37 24 h5 M11 11 l3.5 3.5 M33.5 33.5 L37 37 M37 11 l-3.5 3.5 M14.5 33.5 L11 37" ${S}/>`,
  quadset: `<path d="M8 30 h30" ${S}/><circle cx="12" cy="26" r="3.5" ${S}/>
        <path d="M22 24 v-6 M28 24 v-6 M34 24 v-6" ${S} opacity=".6"/>`,
};

// Which glyph each exercise uses. Anything unlisted falls back to its category.
export const ICON_FOR = {
  // aerobic
  bike: 'bike', airbike: 'bike', elliptical: 'elliptical', rowing: 'row',
  walk: 'walk', brisk_walk: 'walk', pool: 'swim', swim: 'swim',
  intervals: 'interval', hi_bouts: 'interval',
  // running
  walk_jog: 'run', jog_intervals: 'run', run: 'run',
  // strength
  split_squat: 'lunge', multi_lunge: 'lunge', dl_squat: 'squat', barbell_squat: 'squat',
  leg_press: 'legpress', ham_curl: 'hamcurl', nordic: 'hamcurl', rdl: 'deadlift',
  sidelying_hip_abd: 'hipabd', hip_abd: 'hipabd', standing_band_hip_abd: 'bandabd',
  side_bridge: 'sideplank', core: 'core', slr: 'quadset', quad_sets: 'quadset',
  leg_extension: 'kneeext', tke: 'kneeext',
  // impact
  reformer_jump: 'jump', dl_plyo: 'jump', dl_jump: 'jump', assisted_pogo: 'jump',
  dl_drop_land: 'dropbox', dl_land_drill: 'dropbox', alt_land_drill: 'dropbox',
  sl_land_drill: 'hop', sl_hop: 'hop', repeated_hops: 'hop', stepup_hop: 'hop',
  lateral_hops: 'latHop', multidir_land: 'latHop',
  // agility
  side_step: 'sidestep', lateral_load: 'sidestep', cutting: 'cones',
  shuttle: 'cones', figure8: 'cones', planned_cod: 'cones', reactive_cod: 'cones',
  ladder: 'ladder', decel: 'decel',
  // dance and show
  marking: 'dance', dance_sagittal: 'dance', dance_jump: 'dance', bbb: 'dance',
  dance_ul: 'music', show_section: 'stage', partial_run: 'stage',
  full_run: 'stage', stage_env: 'stage',
  // kneeling
  kneel_floor_transfer: 'kneel', kneel_hold: 'kneel', kneel_reps: 'kneel',
  kneel_floor_stand: 'kneel', kneel_perf: 'kneel',
  // balance
  sl_balance_clock: 'clockface', vestib_balance: 'clockface',
  // mobility
  ext_prop: 'kneerom', flexion: 'kneerom', patella: 'kneerom',
  calf_stretch: 'stretch', stretch: 'stretch', release: 'foamroll',
  // recovery
  ice: 'ice', compression: 'compress', cooldown: 'stretch', warmup: 'warmup',
};

/** Last resort, so nothing is ever left blank. */
export const ICON_FOR_CATEGORY = {
  strength: 'squat', balance: 'clockface', aerobic: 'bike', impact: 'jump',
  running: 'run', agility: 'cones', dance: 'dance', show: 'stage',
  kneeling: 'kneel', mobility: 'stretch', recovery: 'warmup',
};

export function iconNameFor(exId, cat) {
  return ICON_FOR[exId] || ICON_FOR_CATEGORY[cat] || 'squat';
}
