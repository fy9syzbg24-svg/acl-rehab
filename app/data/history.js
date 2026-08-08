// Public stub — deliberately contains no clinical detail.
//
// Everything personal (surgeries, complications, clinician and clinic names,
// seeded clinic sessions and VALD results) lives in your SYNCED data, under
// `state.data.caseFile`, which only ever exists in the private repo and on
// your own devices.
//
// This repo is public so GitHub Pages can serve the app, and the app shell has
// to be downloadable before you are authenticated. So nothing identifying may
// live here. The Mac seeds `caseFile` once from data/case.local.js (gitignored,
// never published); the iPhone receives the same content over sync.
//
// The exports below are LIVE BINDINGS. `hydrateCase()` repoints them whenever
// the document changes, so every existing importer keeps working unmodified.

const EMPTY_CASE = {
  injuryDate: null,
  injuryNote: '',
  legs: {
    left: { date: null, procedure: '', weightBearing: '', complication: '' },
    right: { date: null, procedure: '', weightBearing: '', complication: '' },
  },
  protocolNote: '',
  rtsMinimumMonths: 9,
  flags: [],
  clearances: [],
  management: [],
  showDemands: '',
  sources: [],
};

export let CASE = EMPTY_CASE;
export let CLINIC_TIMELINE = [];
export let CLINIC_HEP = { label: '', entries: [] };

// Only ever used to seed a brand-new document on the Mac. A device that syncs
// receives the real days and measurements as ordinary records, so these stay
// empty everywhere else — seeding from here on a second device would duplicate
// what sync is already delivering.
export let SEED_DAYS = {};
export let SEED_MEASUREMENTS = [];

/** Point the exports at the case file carried in the synced document. */
export function hydrateCase(doc) {
  const cf = doc && doc.caseFile;
  CASE = (cf && cf.case) || EMPTY_CASE;
  CLINIC_TIMELINE = (cf && cf.timeline) || [];
  CLINIC_HEP = (cf && cf.hep) || { label: '', entries: [] };
}

/**
 * Load the Mac's local clinical file, if this device has one.
 *
 * Present only on the Mac and gitignored, so on the iPhone (and on any fresh
 * clone) the import simply fails and we fall back to whatever sync provides.
 * A missing file is a normal outcome here, not an error.
 */
export async function loadLocalCase() {
  try {
    const m = await import('./case.local.js');
    return {
      case: m.CASE,
      timeline: m.CLINIC_TIMELINE,
      hep: m.CLINIC_HEP,
      seedDays: m.SEED_DAYS,
      seedMeasurements: m.SEED_MEASUREMENTS,
      programSource: m.PROGRAM_SOURCE,
      gymSource: m.GYM_SOURCE,
    };
  } catch {
    return null;
  }
}
