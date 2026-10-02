// Voices and sound sets (Rehab Test round 3, 2026-09-30).
//
// His asks that night: "make 2 more voice options for the voice prompts", "re do
// alice", "generate better sound effects for the workouts". The audio builder writes
// the files; this module only finds them and remembers his choice, per device
// (CONTRACT.md "Round 3 additions"):
//
//   audio/voice/voices.json   { default, voices: [{ id, name, desc, keys? }] }
//   audio/voice/<id>/<key>.mp3, optionally audio/voice/<id>/lines.json { lines: { key: text } }
//   audio/sfx/sfx.json        { default, sets: [{ id, name, desc?, files: { <soundMapKey>: file } }] }
//   localStorage 'rt.voice'   the chosen voice id (default: voices.json's default)
//   localStorage 'rt.sfx'     the chosen sound set ('classic' = the synthesized tones, no files)
//
// Nothing here is required. No voices.json: the original recordings in audio/voice/
// (the 2026-09-23 Alice, kept on disk, never overwritten) are the voice. No sfx.json,
// a set without a file for a moment, or a file that will not decode: that moment
// plays its classic synthesized tone, which is always the fallback. A sound never
// changes meaning between sets: every key below is ONE row of the sound map
// (README "The sound map"), and a set that has no file for a row falls back to the
// classic tone for THAT row, never to another row's sample.

export const VOICE_KEY = 'rt.voice';
export const SFX_KEY = 'rt.sfx';
export const CLASSIC = 'classic';

import * as Prefs from '../rtprefs.js';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* per device */ } };

async function json(url) {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ----------------------------------------------------------------- voices ----
let voicesDoc = null;       // voices.json, or { voices: [] } when there is none
let voicesLoad = null;

/** voices.json once (null-safe). */
export function loadVoices() {
  if (voicesDoc) return Promise.resolve(voicesDoc);
  if (!voicesLoad) {
    voicesLoad = json('./audio/voice/voices.json').then((d) => {
      const list = Array.isArray(d?.voices) ? d.voices.filter((v) => v && /^[a-z0-9_-]+$/i.test(String(v.id || ''))) : [];
      voicesDoc = { default: d?.default && list.some((v) => v.id === d.default) ? d.default : (list[0]?.id || null), voices: list };
      return voicesDoc;
    }).finally(() => { voicesLoad = null; });
  }
  return voicesLoad;
}

/** The voices on offer, [{ id, name, desc }], empty before voices.json exists. */
export function voiceList() { return voicesDoc?.voices || []; }

/** The chosen voice id, or null for the original recordings (no voices.json). */
export function voiceId() {
  const list = voiceList();
  if (!list.length) return null;
  // Read the way Settings reads it (rtprefs.js), so the check he sees is the voice he hears.
  const want = Prefs.voice() || get(VOICE_KEY);
  return list.some((v) => v.id === want) ? want : voicesDoc.default;
}

export function setVoiceId(id) { put(VOICE_KEY, id || null); }

// "Alice (classic)": the 2026-09-23 recordings, where they have always been (the audio
// builder's voices.json lists them as 'alice-classic', with no folder of their own).
export const ORIGINAL_VOICE = 'alice-classic';
const original = (id) => !id || id === ORIGINAL_VOICE;

/** Where a line's recording lives for a voice (the original folder for the classic one). */
export const voiceDir = (id) => (original(id) ? './audio/voice/' : `./audio/voice/${encodeURIComponent(id)}/`);

/**
 * A voice's lines: its own lines.json, else the keys voices.json lists for it,
 * else the original lines.json (the same keys, re-recorded).
 */
const textsOf = {};   // voice id (or '' for the originals) -> { key: its direction and words }
export async function voiceKeys(id) {
  if (!original(id)) {
    const own = await json(`${voiceDir(id)}lines.json`);
    if (own?.lines) { textsOf[id] = own.lines; return Object.keys(own.lines); }
    const meta = voiceList().find((v) => v.id === id);
    if (Array.isArray(meta?.keys) && meta.keys.length) return meta.keys.slice();
  }
  const base = await json('./audio/voice/lines.json');
  if (base?.lines) textsOf[original(id) ? '' : id] = base.lines;
  return base?.lines ? Object.keys(base.lines) : null;
}

/** Each line's text as lines.json writes it ("[exhales] [warm, easy] Rest."), once voiceKeys has read it. */
export const voiceTexts = (id) => textsOf[original(id) ? '' : id] || {};

/**
 * Where a missing line may come from instead: the original recordings, and only for
 * the voice they were made in (Alice). Another voice never borrows her clip for one
 * line: it falls back to the device's speech like any missing line.
 */
export const borrowsOriginal = (id) => !original(id) && /alice/i.test(id);

// ------------------------------------------------------------- sound sets ----
let sfxDoc = null;
let sfxLoad = null;

export function loadSfx() {
  if (sfxDoc) return Promise.resolve(sfxDoc);
  if (!sfxLoad) {
    sfxLoad = json('./audio/sfx/sfx.json').then((d) => {
      const sets = Array.isArray(d?.sets) ? d.sets.filter((s) => s && s.id && s.id !== CLASSIC && s.files && typeof s.files === 'object') : [];
      sfxDoc = { default: d?.default && sets.some((s) => s.id === d.default) ? d.default : CLASSIC, sets };
      return sfxDoc;
    }).finally(() => { sfxLoad = null; });
  }
  return sfxLoad;
}

/** The sets on offer: Classic first (always), then the generated ones. */
export function sfxList() {
  return [{ id: CLASSIC, name: 'Classic', desc: 'The original tones' }, ...(sfxDoc?.sets || []).map((s) => ({ id: s.id, name: s.name || s.id, desc: s.desc || '' }))];
}

/**
 * The chosen set id, read the way Settings reads it (rtprefs.js sfx(): 'classic' until he
 * picks one), so the set checked in Settings is always the set he hears. A pick whose
 * files are not on this device plays Classic.
 */
export function sfxId() {
  const want = Prefs.sfx();
  const sets = sfxDoc?.sets || [];
  return want && sets.some((s) => s.id === want) ? want : CLASSIC;
}

export function setSfxId(id) { put(SFX_KEY, id || null); }

/**
 * The rows of the sound map a set may carry, each with the file names the audio
 * builder might have used for it. One row, one meaning (README "The sound map").
 * Rows added in round 3: 'rest' (a rest begins) and 'restend' (a rest is over): a
 * set that has them plays them in place of the plain "now" tone at THOSE edges only;
 * one without them keeps "now". 'tick' and 'logsaved' are for other pages
 * (a supplement ticked, a log saved), reached through feedback.js sfx().
 */
export const SOUND_ROWS = {
  pip: ['pip', 'pips', 'countdown', 'count'],             // counting down to a change
  now: ['now', 'transition', 'change', 'step'],            // now: a step ends
  countin: ['countin', 'count-in', 'backin', 'back-in'],   // counting back in after a pause
  rest: ['rest', 'rest-start', 'reststart'],               // a rest begins (round 3)
  restend: ['restend', 'rest-end', 'restover'],            // a rest is over (round 3)
  saved: ['saved', 'save', 'exercise', 'exdone', 'exercise-done'],   // an exercise saved
  set: ['set', 'setdone', 'set-done', 'bell'],             // a set closed, with Gold Echo
  day: ['day', 'finish', 'dayfinish', 'day-finish'],       // the plan complete (gold)
  paused: ['paused', 'pause'],                             // paused
  halfway: ['halfway', 'half'],                            // halfway, where the voice does not say it
  metro: ['metro', 'metronome', 'beat'],                   // the metronome he chose
  goal: ['goal'],                                          // an open hold reached its goal
  check: ['check', 'soundcheck', 'test'],                  // the sound test
  tick: ['tick', 'supp', 'supplement'],                    // a supplement ticked (other pages)
  logsaved: ['logsaved', 'log', 'logged'],                 // a log saved (other pages)
};

/** { row: url } for the chosen set; empty for Classic. */
export function sfxFiles(id = sfxId()) {
  const set = (sfxDoc?.sets || []).find((s) => s.id === id);
  if (!set) return {};
  const out = {};
  for (const [row, names] of Object.entries(SOUND_ROWS)) {
    const name = names.find((n) => typeof set.files[n] === 'string' && set.files[n]);
    if (name) {
      const f = set.files[name];
      out[row] = /^(\.|\/|https?:)/.test(f) ? f : `./audio/sfx/${f.split('/').map(encodeURIComponent).join('/')}`;
    }
  }
  return out;
}
