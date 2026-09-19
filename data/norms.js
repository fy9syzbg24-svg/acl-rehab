// Reference levels drawn beside his own results (2026-09-16), so a test can be
// read against "typical for someone like me" and "college athlete". Every
// entry is a PUBLISHED figure with its source; nothing here is estimated or
// rounded beyond what the paper printed. An empty list for a test means no
// clean reference was found, and the view then shows nothing for it rather
// than a guess.
//
// Fields:
//   measure    the test id in measurements.js
//   level      'typical' (healthy, general population) or 'athlete'
//   sex        'M', 'F' or null (either)
//   age        [from, to] inclusive years, or null (any adult)
//   value      the mean (or the single reference figure)
//   sd         standard deviation when the paper gives one, else undefined
//   unit       EXACTLY the paper's unit: 'lb', 'N', 'kg' (kilogram force),
//              'reps', 'sec', 'deg', 'cm', 'pts', 'pct' (percent of leg length),
//              'N/kg' or 'kg/kg' (per kilogram of bodyweight)
//   population one line: who was measured (n, sport, sex, age)
//   protocol   one line: how, when it differs from the app's method
//   source     authors, year, journal
//   url        DOI or link
import { fromKg } from '../js/util.js';

export const LEVELS = { typical: 'Typical', young: 'Young adults', athlete: 'College athlete' };
// 'young' is for a healthy sample in its late teens or twenties with no age
// split, which is not "someone like me" for an older man and is labelled so.
// 'xBW' is a load as a multiple of body mass, placed by his bodyweight.
// 'also' is a second printed figure that belongs in the words, not on the track.
// 'caveat' is a limit of the paper's sample or method that the card prints under
// the reference (2026-09-18), so a mark is never read as fitting him when it may not.

export const NORMS = [
  // --- strength on a handheld dynamometer ---------------------------------
  { measure: 'hhd_knee_ext', level: 'typical', sex: 'M', age: [30, 39], value: 351, sd: 99, unit: 'N',
    population: 'Healthy Dutch workers, men 30 to 39, dominant leg, n=51',
    protocol: 'Break test (the examiner overpowers you), seated with hip and knee at 90°, dynamometer just above the ankle; a make test like a clinic push reads lower',
    also: 'Bohannon 1997 (USA, make test, gravity neutralised) puts men 30 to 39 at 573 N, as reproduced in the same paper',
    source: 'Douma et al 2014, BMC Sports Sci Med Rehabil 6:10', url: 'https://doi.org/10.1186/2052-1847-6-10' },
  { measure: 'hhd_knee_ext', level: 'athlete', sex: 'M', age: null, value: 4.89, unit: 'N/kg',
    population: 'Healthy collegiate basketball players, men 18 to 24, dominant leg, n=27 (soccer players 5.48)',
    protocol: 'Seated, hips and knees at 90°, make test into a fixed strap; per kilogram of bodyweight, so the mark is scaled by yours',
    source: 'Owoeye et al 2024, Int J Exerc Sci 17(4):768', url: 'https://doi.org/10.70252/kozo5621' },
  { measure: 'hhd_hamstring_30', level: 'typical', sex: 'M', age: [30, 39], value: 262, sd: 60, unit: 'N',
    population: 'Healthy Dutch workers, men 30 to 39, dominant leg, n=51',
    protocol: 'Knee flexion seated with hip and knee at 90°, break test; yours is prone at 30°, a different position',
    source: 'Douma et al 2014, BMC Sports Sci Med Rehabil 6:10', url: 'https://doi.org/10.1186/2052-1847-6-10' },
  { measure: 'hhd_hamstring_30', level: 'athlete', sex: 'M', age: null, value: 2.97, unit: 'N/kg',
    population: 'Healthy collegiate basketball players, men 18 to 24, n=27 (soccer players 3.29)',
    protocol: 'Seated 90/90 make test, per kilogram of bodyweight; yours is prone at 30°',
    source: 'Owoeye et al 2024, Int J Exerc Sci 17(4):768', url: 'https://doi.org/10.70252/kozo5621' },

  // --- heel raises ----------------------------------------------------------
  { measure: 'sl_calf_raise', level: 'typical', sex: 'M', age: [30, 39], value: 33.0, unit: 'reps',
    population: 'Model median for a man aged 30 with a BMI of 24 and moderate activity, right leg (left 32.7), from 566 healthy adults 20 to 81; it falls about half a rep a year and excluded a BMI over 30',
    protocol: 'On a 10° incline, fingertips on a wall, one rise a second to a metronome, to exhaustion; yours is a step edge at one every two seconds',
    also: 'Lunsford and Perry 1995 call 25 reps normal for adults 20 to 59 (n=203, mean 27.9)',
    caveat: 'This reference left out anyone with a BMI over 30, and counts reps to exhaustion with no allowance for bodyweight',
    source: 'Hébert-Losier et al 2017, Physiotherapy 103(4):446', url: 'https://doi.org/10.1016/j.physio.2017.03.002' },

  // --- balance --------------------------------------------------------------
  { measure: 'balance_eyes_open', level: 'typical', sex: 'M', age: [18, 39], value: 43.2, sd: 6.0, unit: 'sec',
    population: 'Healthy men 18 to 39, n=54, mean of three trials (best of three 44.4)',
    protocol: 'Hands on hips, stops when the lifted foot touches down or a hand leaves the hip; the means sit at the 45 s ceiling',
    source: 'Springer et al 2007, J Geriatr Phys Ther 30(1):8', url: 'https://doi.org/10.1519/00139143-200704000-00003' },
  { measure: 'balance_eyes_closed', level: 'typical', sex: 'M', age: [18, 39], value: 10.2, sd: 9.6, unit: 'sec',
    population: 'Healthy men 18 to 39, n=54, mean of three trials (best of three 16.9)',
    protocol: 'Hands on hips, same stop rules',
    source: 'Springer et al 2007, J Geriatr Phys Ther 30(1):8', url: 'https://doi.org/10.1519/00139143-200704000-00003' },

  // --- patient reported -----------------------------------------------------
  { measure: 'lefs', level: 'typical', sex: null, age: [18, 39], value: 80, unit: 'pts',
    population: 'Median of 291 healthy adults 18 to 39 (interquartile 75 to 80); all 1,014 healthy adults median 77, mean 69; men 78',
    protocol: 'The same questionnaire',
    also: 'A change of 9 points is the minimal clinically important difference (Binkley 1999)',
    source: 'Dingemans et al 2017, Acta Orthop 88(4):422', url: 'https://doi.org/10.1080/17453674.2017.1309886' },

  // --- range of motion, young adults ----------------------------------------
  { measure: 'knee_flexion', level: 'young', sex: 'M', age: null, value: 147.1, sd: 6.4, unit: 'deg',
    population: 'Healthy men 20 to 29, n=42, Okinawa', protocol: 'Passive, with a goniometer',
    source: 'Moromizato et al 2016, J Physiol Anthropol 35:23', url: 'https://doi.org/10.1186/s40101-016-0112-8' },
  { measure: 'knee_hyperextension', level: 'young', sex: 'M', age: null, value: 2.0, sd: 3.7, unit: 'deg',
    population: 'Healthy men 20 to 29, n=42, Okinawa', protocol: 'Passive, degrees beyond straight',
    source: 'Moromizato et al 2016, J Physiol Anthropol 35:23', url: 'https://doi.org/10.1186/s40101-016-0112-8' },
  { measure: 'hamstring_9090', level: 'young', sex: 'M', age: null, value: 17.8, sd: 9.1, unit: 'deg',
    population: 'University men 18 to 24, n=61, mean of both legs',
    protocol: 'Active knee extension with the hip at 90°, degrees short of straight',
    also: 'Over 33° counts as hamstring shortness in men',
    source: 'Yildirim et al 2018, Balkan Med J 35:388', url: 'https://doi.org/10.4274/balkanmedj.2017.1517' },

  // --- trunk endurance --------------------------------------------------------
  { measure: 'side_bridge', level: 'young', sex: 'M', age: null, value: 97, sd: 41, unit: 'sec',
    population: 'First year university men, n=82, right side (left 96 ± 39)',
    protocol: 'On the elbow and feet, hips lifted, body straight, held to failure',
    source: 'McGill et al 2010, Occup Ergon 9:55', url: 'https://doi.org/10.3233/OER-2010-0181' },

  // --- hops -------------------------------------------------------------------
  { measure: 'single_hop', level: 'athlete', sex: 'M', age: null, value: 192, sd: 20, unit: 'cm',
    population: 'College basketball and soccer players, men 18 to 24, n=87', protocol: 'Average of three hops, arms free',
    source: 'Myers et al 2014, Int J Sports Phys Ther 9(5):596', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4196324/' },
  { measure: 'triple_hop', level: 'athlete', sex: 'M', age: null, value: 632, sd: 72, unit: 'cm',
    population: 'College basketball and soccer players, men 18 to 24, n=87', protocol: 'Average of three, arms free',
    source: 'Myers et al 2014, Int J Sports Phys Ther 9(5):596', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4196324/' },
  { measure: 'triple_crossover_hop', level: 'athlete', sex: 'M', age: null, value: 570, sd: 75, unit: 'cm',
    population: 'College basketball and soccer players, men 18 to 24, n=87', protocol: 'Average of three, arms free',
    source: 'Myers et al 2014, Int J Sports Phys Ther 9(5):596', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4196324/' },
  { measure: 'side_hop', level: 'typical', sex: 'M', age: null, value: 52.57, sd: 16.74, unit: 'reps',
    population: 'Healthy recreationally active men, mean age 33.5 (SD 10.9), dominant leg, n=30 (other leg 50.5)',
    protocol: 'One 30 s trial per leg counted by an infrared system; yours is two tapes 40 cm apart with hands behind the back',
    source: 'Legnani et al 2025, Front Sports Act Living 7:1545226', url: 'https://doi.org/10.3389/fspor.2025.1545226' },

  // --- force plates -------------------------------------------------------------
  { measure: 'fp_cmj_height', level: 'athlete', sex: 'M', age: null, value: 42.6, sd: 4.75, unit: 'cm',
    population: 'NCAA Division I men, n=79, mean age 19.4 (NAIA men 41.2)', protocol: 'Force platform, hands on hips',
    source: 'Stahl et al 2020, Int J Exerc Sci 13(4):470', url: 'https://doi.org/10.70252/bsqm6356' },
  { measure: 'fp_imtp_peak', level: 'athlete', sex: 'M', age: null, value: 2732.6, sd: 734.2, unit: 'N',
    population: 'Collegiate and semi-professional team sport men, n=38, mean age 21.9, 76.6 kg', protocol: 'Knee at about 138°, hip 145°, 5 s pulls',
    source: 'Comfort et al 2024, PLoS One 19:e0296877', url: 'https://doi.org/10.1371/journal.pone.0296877' },

  // --- loading -------------------------------------------------------------------
  { measure: 'squat_1rm', level: 'athlete', sex: 'M', age: null, value: 2.0, sd: 0.37, unit: 'xBW',
    population: 'Division I football players, n=46, mean age 21.2, 103 kg',
    protocol: 'One repetition maximum back squat, hip crease below the knee; times body mass, so the mark is scaled by your bodyweight',
    also: 'The paper suggests 2.2 times body mass as a screening threshold',
    source: 'Case et al 2020, J Strength Cond Res 34(5):1249', url: 'https://doi.org/10.1519/JSC.0000000000003554' },
];

const N_PER_LB = 4.4482216153;
const N_PER_KGF = 9.80665;

/**
 * Reference entries for a measure. A sex or age band on an entry must be
 * matched by his settings; with sex or date of birth unset, only entries with
 * no such band are offered, never a guessed one.
 */
export function refsFor(measureId, { sex = null, age = null } = {}) {
  return NORMS.filter((r) => r.measure === measureId
    && (!r.sex || (sex && r.sex === sex))
    && (!r.age || (age != null && age >= r.age[0] && age <= r.age[1])));
}

/**
 * A reference value in the measure's own unit, or null when it cannot be
 * placed honestly (a different quantity, or per bodyweight with no weight set).
 * Returns { value, sd, why } where why explains a null.
 */
export function inMeasureUnit(ref, m, bodyweightKg = null, { weightUnit = 'kg' } = {}) {
  const want = m.unit;
  const scale = (k) => ({ value: ref.value * k, sd: ref.sd != null ? ref.sd * k : undefined });
  if (ref.unit === want) return scale(1);
  if (ref.unit === 'xBW') {
    if (!bodyweightKg) return { value: null, why: 'a multiple of bodyweight; set your bodyweight in Settings' };
    if (want !== 'weight') return { value: null, why: 'a multiple of bodyweight, not the same quantity as this test' };
    return scale(fromKg(bodyweightKg, weightUnit));
  }
  const force = { lb: 1, N: 1 / N_PER_LB, kg: N_PER_KGF / N_PER_LB };   // to lb
  if (want === 'lb' && force[ref.unit] != null) return scale(force[ref.unit]);
  if (want === 'N' && force[ref.unit] != null) return scale(force[ref.unit] * N_PER_LB);
  if (ref.unit === 'N/kg' || ref.unit === 'kg/kg') {
    if (!bodyweightKg) return { value: null, why: 'per kilogram of bodyweight; set your bodyweight in Settings' };
    const newtons = ref.unit === 'N/kg' ? ref.value * bodyweightKg : ref.value * bodyweightKg * N_PER_KGF;
    const sdN = ref.sd != null ? (ref.unit === 'N/kg' ? ref.sd * bodyweightKg : ref.sd * bodyweightKg * N_PER_KGF) : undefined;
    if (want === 'N') return { value: newtons, sd: sdN };
    if (want === 'lb') return { value: newtons / N_PER_LB, sd: sdN != null ? sdN / N_PER_LB : undefined };
  }
  return { value: null, why: `reported in ${ref.unit}, not the same quantity as this test` };
}

/** Age in whole years from an ISO date of birth, or null. */
export function ageFrom(dob, today = new Date()) {
  if (!dob) return null;
  const d = new Date(dob + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return null;
  let a = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) a -= 1;
  return a;
}
