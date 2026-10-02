// GLP-1 reference points (round 3, 2026-09-30): refs.weight = { iso }, the date he compares his
// weight to (A10.3). Since the web port they sync with the rest of js/rtlocal.js (extras.refs in
// his record), so this file only hands through to it. Setting null clears a value without
// deleting its record.
import { local } from '../rtlocal.js';

/** A value by path ('refs.weight'), or undefined. */
export function localGet(path) {
  try { return local.get(path); } catch { return undefined; }
}

/** Set a value by path. Resolves true when written. */
export async function localSet(path, value) {
  try { return local.set(path, value); } catch { return false; }
}
