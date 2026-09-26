// Every per device feature arrives ON (his call, 2026-09-23: "default the voice
// ON and any new features so when I force update on my phone, the new features
// happen automatically").
//
// One path for it. A switch reads through featureOn(): missing means ON, and a
// device that cannot read its storage (a private window, blocked site data)
// gets ON too. Only a stored 'off', which he chose, keeps a feature off, so his
// arrangement stays the default after this.
//
// An old stored 'off' that has to be cleared once goes through the one time
// migration below, keyed on rehab.defaults.v, never through a renamed key: a
// new key would forget every other choice he made on that device.
//
// Each step runs only on a device that has not had ITS version yet (had <
// that step's date), never on every later bump: a later version that clears
// some other key must not clear the voice again after he turned it off.
// Add a step as: if (!had || had < 'YYYY-MM-DD') { ... }, and bump
// DEFAULTS_VERSION to that date.
//
// New motion has no switch at all. It follows reduced motion and Low Power
// Mode (lite) only. Nothing here is synced; each device keeps its own.

export const DEFAULTS_VERSION = '2026-09-23';
const VERSION_KEY = 'rehab.defaults.v';

/** True unless he turned this per device feature off. */
export function featureOn(key) {
  try { return localStorage.getItem(key) !== 'off'; } catch { return true; }
}

let toastPending = false;

/**
 * Run once per device per DEFAULTS_VERSION, synchronously, before the first
 * paint and before anything reads a switch. Anything that throws leaves every
 * key as it was, which still reads ON.
 */
export function runDefaultsMigration() {
  try {
    const had = localStorage.getItem(VERSION_KEY);
    if (had && had >= DEFAULTS_VERSION) return;
    // 2026-09-23: the coach voice is on after the update, even where an older
    // build had it switched off. Every other key is left alone.
    if (!had || had < '2026-09-23') {
      if (localStorage.getItem('rehab.feedback.speak') === 'off') localStorage.removeItem('rehab.feedback.speak');
    }
    localStorage.setItem(VERSION_KEY, DEFAULTS_VERSION);
    toastPending = true;
  } catch { /* storage unreadable: nothing to change, and reads default ON */ }
}

/** The one line said after the migration, once, on the first page that is not the player. */
export function takeDefaultsNotice() {
  if (!toastPending) return false;
  toastPending = false;
  return true;
}
