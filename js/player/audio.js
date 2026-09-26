// Sound for the workout player: transition cues and the metronome.
//
// Web Audio, started by a tap (Safari allows audio only after one), and every
// sound SCHEDULED on the audio clock rather than fired from a timer callback,
// so beats stay even when the page is busy. Everything scheduled is tracked
// and cancelled on pause, a step change, close or interruption, and nothing
// missed is ever replayed: a resume schedules from now.
//
// Sound is never required. If audio is unavailable or muted, the player's
// phase labels and countdown carry everything.

import { featureOn } from '../defaults.js';

let ctx = null;
let nodes = [];          // scheduled oscillators, so they can be stopped
let metroTimer = null;   // the look-ahead loop, only while beats are due
let metroNext = 0;

export function audioAvailable() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

/**
 * What the page's audio does to other apps' audio (the Audio Session API,
 * Safari only; elsewhere this does nothing).
 *
 * MEASURED on his iPhone 15 Pro, iOS 27, 2026-09-15, on an isolated page with
 * the type set once before any audio (app/audio-probe.html):
 *
 *   type            Spotify            Silent switch      Screen locked
 *   transient       keeps playing      no sound           NO sound
 *   transient-solo  (not tested fg)    (not tested)       NO sound
 *   playback        PAUSED at once     sound plays        6 of 6 beeps heard
 *
 * Two things that were believed before and are not true. `transient` was never
 * broken: it maps to the ambient category and honours the Silent switch, which
 * is what the earlier "no sound" reports were. And Web Audio scheduled ahead on
 * the audio clock DOES keep sounding with the screen locked, on a playback
 * session, so no pre-rendered media file is needed.
 *
 * The hard one: holding a playback session pauses Spotify for as long as it is
 * held, not just while a sound plays. Spotify stopped the instant the context
 * started, with nothing scheduled. So a session that can cue him while he is
 * away is a session that has stopped his music the whole time it waited.
 *
 * HIS RULE, 2026-09-15: "I don't want this app ever pausing my music. Except
 * for when I'm playing the 120 BPM songs."
 *
 * So the type follows who owns the sound, is decided by what he does, and only
 * ever moves one way:
 *
 *   - Cues alone (Spotify or nothing playing): `transient`. It ducks under his
 *     music and hands it straight back, and his music is never touched. The
 *     costs he accepted: no cues while the app is in the background, and none
 *     at all with the phone on Silent.
 *   - One of his own songs plays: `playback`, once, for the rest of the page's
 *     life. The app owns the sound anyway, so there is nothing to mix with, and
 *     cues then survive the screen going off.
 *
 * It is never set back down. WebKit's own guidance is to set the type once per
 * session and not flip it, so the single promotion when a song starts is the
 * only change, and it happens at the moment audio ownership really changes.
 */
// How cues behave when his phone is on Silent (his ask, 2026-09-15, after
// starting an exercise on Silent and hearing nothing). No web API reports the
// Silent switch, so the app cannot react to it; he chooses instead.
//
//   duck     the default. Cues duck under his music and his music is never
//            touched, which is his standing rule. On Silent there are no cues,
//            because a ducking session follows that switch.
//   through  cues play on Silent. This takes the playback session, which pauses
//            other music for as long as the workout holds it, not just while a
//            tone sounds. Measured on his phone: Spotify stopped the instant the
//            context started, with nothing scheduled.
//   buzz     cues duck as in `duck`, and the phone also buzzes at every moment
//            it would have beeped, so on Silent the countdown is felt.
//
// Buzz only where a timer can buzz (his probe, 23 Sep 2026): on his iPhone only a
// finger on a real switch is felt, never a script, so there Buzz was a countdown
// with nothing in it. navigator.vibrate on a touch phone is the one route; on
// every other device Buzz is not offered and a stored 'buzz' reads as 'duck'.
export function buzzCan() {
  try { return typeof navigator.vibrate === 'function' && !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; }
}
export const SILENT_KEY = 'rehab.audio.silent';
export function silentMode() {
  try {
    const v = localStorage.getItem(SILENT_KEY);
    return v === 'through' || (v === 'buzz' && buzzCan()) ? v : 'duck';
  } catch { return 'duck'; }
}
export function setSilentMode(v) {
  try { localStorage.setItem(SILENT_KEY, v); } catch { /* per device */ }
}

let sessionType = null;
export function setSession(mode) {
  try {
    if (!navigator.audioSession) return;
    // Promote for a song; never demote afterwards. pauseSong() asks for 'cues'
    // when a song stops, and honouring that would flip the type mid workout.
    if (sessionType === 'playback') return;
    // 'through' means he has asked to hear cues on Silent and accepted that it
    // pauses other music for the workout.
    const want = (mode === 'song' || silentMode() === 'through') ? 'playback' : 'transient';
    if (want === sessionType) return;
    navigator.audioSession.type = want;
    sessionType = want;
  } catch { /* not supported */ }
}

/** Which session this page took, or null before any audio. For Settings. */
export function sessionKind() { return sessionType; }

/** 'running', 'suspended', 'blocked' (a resume was refused) or 'unavailable'. */
let cueState = 'suspended';
export function cuesState() {
  if (!audioAvailable()) return 'unavailable';
  if (ctx && ctx.state === 'running') return 'running';
  return cueState;
}

/** Call from a tap. Safe to call repeatedly. */
/**
 * Build the audio context ahead of the tap that starts sound (Fable B6):
 * called on the first finger down in the player, so Start itself only has to
 * resume it. Creating one cost about 90 ms of that tap at 6x CPU.
 */
export function prepareAudio() {
  if (ctx || !audioAvailable()) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    cueState = ctx.state;
  } catch { /* unlockAudio tries again on the tap */ }
}

// The resume asked for by the last tap, while it is still on its way (B1-2,
// 2026-09-23). The first line of a workout waits on it rather than falling back
// to the device's robotic speech.
let resuming = null;

export function unlockAudio() {
  if (!audioAvailable()) return false;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    // Only the first time: a tap during a song must not hand the speaker back.
    // Take a session the first time only. setSession promotes to playback when
    // a song starts and never steps back down, so asking for cues again here is
    // safe: it is ignored once a song has claimed the speaker.
    setSession('cues');
    // Anything but running is resumed, inside this tap: 'suspended', and the
    // iOS 'interrupted' state (a call, Siri, another app's audio), which the old
    // check never resumed, so the cues stayed silent until a reload.
    if (ctx.state !== 'running') {
      const p = ctx.resume();
      resuming = p;
      p.then(() => { cueState = ctx.state === 'running' ? 'running' : cueState; }, () => { cueState = 'blocked'; })
        .finally(() => { if (resuming === p) resuming = null; });
    } else {
      cueState = 'running';
    }
    return true;
  } catch {
    return false;
  }
}

/** True while a tap's resume or the voice's first load is still on its way. */
export function audioPending() {
  return !!resuming || voiceLoading;
}

// How loud the cues are, his to set (B4, 2026-09-15). The tones were fixed,
// which is loud over music and quiet in a gym. Per device, like every other
// sound choice. Applied inside tone(), the one place every sound goes through,
// so a new cue cannot forget it.
export const VOLUME_KEY = 'rehab.audio.volume';
export function cueVolume() {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(1, Math.max(0.2, v)) : 1;
  } catch { return 1; }
}
export function setCueVolume(v) {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* per device */ }
}

// How loud the coach is against the cues (B6-4, 2026-09-23), his to set, per
// device: 0.2 to 1, 1 by default, so at the default nothing changes. It
// multiplies the cue volume in voiceSource, the one place every line goes
// through.
export const VOICEVOL_KEY = 'rehab.audio.voicevol';
export function voiceVolume() {
  try {
    const v = Number(localStorage.getItem(VOICEVOL_KEY));
    return Number.isFinite(v) && v > 0 ? Math.min(1, Math.max(0.2, v)) : 1;
  } catch { return 1; }
}
export function setVoiceVolume(v) {
  try { localStorage.setItem(VOICEVOL_KEY, String(v)); } catch { /* per device */ }
}

/** The last tones scheduled, newest last, for tests (nothing in the app reads it). */
export const toneLog = [];

function tone(at, freq, dur = 0.09, gain = 0.25, keep = false) {
  if (!ctx) return;
  const logged = { freq, at: Math.round(at * 1000) / 1000, keep };
  toneLog.push(logged);
  if (toneLog.length > 40) toneLog.shift();
  gain = Math.max(0.0002, gain * cueVolume());
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
  o._at = at;   // when it sounds, so a cancel can let one already sounding ring out
  o._log = logged;
  // A kept tone (the saved chime) is not a cue: stopping the step's cues must
  // not cut it off, and every save but a full finish stops them straight after.
  if (keep) return o;
  nodes.push(o);
  o.onended = () => { nodes = nodes.filter((n) => n !== o); };
  return o;
}

// The tone that means "now" at the end of a step or a count in (B1-4): when it
// finishes, so the next line can follow it instead of landing on it.
let endTone = null;   // { node, end }

/**
 * Stop the scheduled cues and the metronome loop.
 *
 * ringOut (B1-4, 2026-09-23): a step change, a pause or a save used to cut
 * every cue at once, which clipped the end tone the loop noticed a moment after
 * it began. With ringOut only cues still more than 0.06 s in the future are
 * stopped, so a tone already sounding ends by itself, while a future cue can
 * never play into a paused run. Closing the player stops everything.
 *
 * Only TONES ring out. A scheduled voice line ("Ten seconds!", "Halfway there",
 * "That's the goal!", "Last set next") is stopped whatever ringOut says: a tap
 * during one otherwise left it talking under the next line, or on into a
 * paused run (review, 2026-09-23). The count in's own "now" tone is claimed at
 * zero (claimCountInTone) and rings out even when the audio clock runs late.
 */
export function cancelAll({ ringOut = false } = {}) {
  const now = ctx ? ctx.currentTime : 0;
  const keepNodes = [];
  for (const n of nodes) {
    // A claim covers the one cancel it was made for; a tap after it treats the
    // tone like any other (a future cue never plays into a paused run).
    const claimed = !!n._claimed;
    n._claimed = false;
    if (ringOut && !n._voice && (claimed || (n._at != null && n._at <= now + 0.06))) { keepNodes.push(n); continue; }
    try { n.stop(); } catch { /* already done */ }
    // For tests: a tone stopped before it sounded is marked in toneLog.
    if (n._log && n._at > now) n._log.cut = true;
    if (endTone && endTone.node === n) endTone = null;
  }
  nodes = keepNodes;
  stopMetronome();
}

/** Seconds until the last end tone finishes sounding, 0 when none is due. */
export function endToneLeft() {
  if (!ctx || !endTone) return 0;
  return Math.max(0, endTone.end - ctx.currentTime);
}

/**
 * The count in reached zero and the run is running: its "now" tone belongs to
 * this moment and rings out, even when the audio clock is behind the wall
 * clock (iOS resuming a suspended context late), which otherwise left it more
 * than 0.06 s in the future and cut it (review, 2026-09-23). Closing the player
 * still stops it.
 */
export function claimCountInTone() {
  if (endTone?.countIn && nodes.includes(endTone.node)) endTone.node._claimed = true;
}

/**
 * Cues for a timed step with `remaining` seconds left: a short pip at 3, 2
 * and 1 seconds to go, and a longer, lower tone at the end. Only cues still in
 * the future are scheduled.
 */
// A hold long enough that the middle is worth marking (B3, 2026-09-15).
const HALFWAY_OVER_SECS = 60;

export function scheduleCues(remaining, { halfwayAt } = {}) {
  if (!ctx || remaining == null) return;
  const t0 = ctx.currentTime;
  // Halfway through a long one, a single soft low tone: low and quiet on
  // purpose, so it reads as information and never as the end. The player
  // passes halfwayAt, seconds from now to the step's real middle, or null when
  // the voice says "Halfway there" instead (never both) or the middle has
  // passed; placed from the time left, it moved later on every +30 s or return
  // to the app (review, 2026-09-23). Left out (the custom workout), the old
  // rule stands: the middle of what is left.
  const half = halfwayAt === undefined ? (remaining > HALFWAY_OVER_SECS ? remaining / 2 : null) : halfwayAt;
  if (half != null && half > 0.05) tone(t0 + half, 392, 0.15, 0.14);
  for (const k of [3, 2, 1]) {
    const at = remaining - k;
    if (at > 0.05) tone(t0 + at, 880, 0.08, 0.22);
  }
  if (remaining > 0.05) endTone = { node: tone(t0 + remaining, 523, 0.32, 0.3), end: t0 + remaining + 0.32 };
}

/**
 * Pips as a step BEGINS (B2, 2026-09-15). There were pips before a step ended
 * and nothing before one started, so when the player advanced by itself a hold
 * simply began. Used for the get-ready step only: putting it before work or a
 * hold directly would give him two countdowns running at once.
 */
export function scheduleCountIn(secs) {
  if (!ctx || !(secs > 0)) return;
  const t0 = ctx.currentTime;
  for (const k of [3, 2, 1]) {
    const at = secs - k;
    if (at > 0.05) tone(t0 + at, 660, 0.07, 0.18);
  }
  // And the tone that means "now" at zero (B1-6): the count in used to end in
  // silence. The same 523 Hz end tone every step ends on, a cue like the pips,
  // so a Pause during the five stops it before it sounds.
  endTone = { node: tone(t0 + secs, 523, 0.32, 0.3), end: t0 + secs + 0.32, countIn: true };
}

/**
 * The workout is saved (B1, 2026-09-15). Three rising tones, and deliberately
 * called where the save is durable rather than where the sets end, so what it
 * means is "it is written down", not "you stopped".
 */
export function scheduleFinish() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.05;
  tone(t0, 523, 0.12, 0.26, true);
  tone(t0 + 0.13, 659, 0.12, 0.26, true);
  tone(t0 + 0.26, 784, 0.2, 0.3, true);
}

/**
 * Paused (B1-7): a falling E then C, soft, kept like the saved chime so the
 * pause's own cancel never cuts it. Its one meaning in the sound map.
 */
export function schedulePause() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  tone(t0, 659, 0.1, 0.2, true);
  tone(t0 + 0.11, 523, 0.1, 0.2, true);
}

/**
 * A set closed (B2-7), with Gold Echo: one bell, a high C (1046.5 Hz), 8 ms
 * in and half a second to fade, soft. Kept, so the step change's cancel never
 * cuts it. Its one meaning in the sound map: a whole set finished, never
 * effort, never a partial set.
 */
export function goldBell(at = null) {
  if (!ctx) return;
  tone(at ?? ctx.currentTime + 0.01, 1046.5, 0.5, 0.16, true);
}
/**
 * The plan complete (B3-5), the day finish's own music, with Constellation
 * Close: five rising sines, C E G C E (523 to 1318.5 Hz), at 420, 550, 680, 810
 * and 940 ms as the gold trace climbs round the ring, 0.14 s each; then C, G
 * and C together at 1020 ms with the burst, ringing out over 0.9 s. Soft, and
 * kept, so no cancel cuts it. Its one meaning in the sound map: the whole plan
 * of the day is logged.
 */
export function scheduleDay() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [523, 659, 784, 1046.5, 1318.5].forEach((f, i) => tone(t0 + 0.42 + i * 0.13, f, 0.14, 0.12, true));
  for (const f of [523, 784, 1046.5]) tone(t0 + 1.02, f, 0.9, 0.1, true);
}

/**
 * Seconds from the bell until it has rung: 38 dB down by then, only its tail
 * left. The step's line waits this long after a set closes, so the line
 * follows the bell instead of landing on it (B1-4's rule, review 2026-09-23).
 */
export const BELL_RUNG = 0.3;

/** One tone as a step ends, no countdown: the switch inside a continuous exercise. */
export function scheduleSwitch(remaining) {
  if (!ctx || remaining == null || remaining <= 0.05) return;
  tone(ctx.currentTime + remaining, 660, 0.22, 0.3);
}

/**
 * Two quick tones, for the sound check. Kept, like the saved chime: the Cues
 * button cancels the step's cues straight after it, which cut the second tone
 * (and before B1-4 both of them).
 */
export function soundCheck() {
  if (!unlockAudio() || !ctx) return false;
  const t = ctx.currentTime + 0.05;
  tone(t, 660, 0.12, 0.3, true);
  tone(t + 0.22, 880, 0.12, 0.3, true);
  return true;
}

/** A soft tick at a given pace, for `forSecs` seconds from now at most. */
export function startMetronome(bpm, forSecs) {
  stopMetronome();
  if (!ctx || !bpm || !(forSecs > 0)) return;
  const gap = 60 / bpm;
  const end = ctx.currentTime + forSecs;
  metroNext = ctx.currentTime + 0.05;
  // Look ahead a little on a coarse timer; the audio clock does the timing.
  const pump = () => {
    if (!ctx) return;
    while (metroNext < ctx.currentTime + 0.25 && metroNext < end - 0.02) {
      tone(metroNext, 1320, 0.03, 0.14);
      metroNext += gap;
    }
    if (metroNext >= end - 0.02) stopMetronome();
  };
  pump();
  metroTimer = setInterval(pump, 100);
}

export function stopMetronome() {
  if (metroTimer) clearInterval(metroTimer);
  metroTimer = null;
}

// ------------------------------------------------------------ the voice ----
// Recorded lines instead of the device's robotic speech (his ask, 2026-09-23;
// his pick of voice). app/audio/voice/<key>.mp3, listed in lines.json and made
// by tools/make_voice.py. Played through this same context, so the voice
// follows exactly the same session rules as the beeps: it ducks under his
// music, never pauses it, and his volume setting applies.
//
// A line said now is not a scheduled cue: stopping the step's cues (every step
// change does) must not cut off the line that announced the step, so it is
// kept apart and only a newer line or hush() stops it. A line scheduled for
// later in the step ("Ten seconds") is a cue and is cancelled with the rest.
const voiceBufs = {};
let voiceLoad = null;
let voiceLoading = false;
let voiceFailAt = 0;
let speaking = [];   // lines said or waiting: { src, key, start, end, completion }
/** The last lines said or scheduled, newest last, for tests (nothing reads it in the app).
 *  at: seconds from the call (0 for a line said now); t: the audio clock time it starts. */
export const voiceLog = [];
const logVoice = (key, at, t, pan = 0) => { voiceLog.push({ key, at, t: Math.round(t * 1000) / 1000, pan }); if (voiceLog.length > 30) voiceLog.shift(); };

// Stereo sides (B6-3, 2026-09-23): left on the left, right on the right, now in
// sound too. A line that names a side comes from that side, 0.35 of the way
// over, so with headphones the leg is heard before a word of it; a phrase that
// begins with one ("Left leg. Balance!") keeps that side for every clip, so the
// cue word follows the leg. The iPhone speaker in portrait is one speaker, where
// it is only a slight change of level. Per device, ON unless he turned it off
// (featureOn). Where StereoPannerNode is missing the line plays from the
// centre, as before. Same context, same session: nothing here can pause his music.
export const STEREO_KEY = 'rehab.audio.stereo';
export const stereoOn = () => featureOn(STEREO_KEY);
export function setStereo(on) {
  try { localStorage.setItem(STEREO_KEY, on ? 'on' : 'off'); } catch { /* per device */ }
}
/** True where a line can be placed left or right (Settings hides the switch elsewhere). */
export function stereoAvailable() {
  if (!audioAvailable()) return false;
  const AC = window.AudioContext || window.webkitAudioContext;
  return typeof AC?.prototype?.createStereoPanner === 'function';
}
const SIDE_PAN = 0.35;
const SIDE = {
  left: -1, 'left-tap': -1, 'left-next': -1, 'left-first': -1,
  right: 1, 'right-tap': 1, 'right-next': 1, 'right-first': 1,
};
/** Where a line (or a phrase, by its first clip) is heard: its side's pan, or 0. */
export function panFor(key) {
  const side = SIDE[key];
  return side && stereoOn() ? side * SIDE_PAN : 0;
}

// The lines a workout says first, decoded before anything else (B1-2): the
// step words, the sides, the counts and the finish. The exercise names and the
// cue words follow, the ones this session needs first (preferVoice), then the
// rest in small batches so no one decode holds the page up.
const CORE = ['ready', 'go', 'go2', 'go3', 'hold', 'hold2', 'rest', 'rest2', 'switch', 'left', 'right', 'both',
  'lastset', 'paused', 'backin', 'ten', 'five', 'halfway', 'exdone', 'alldone'];
const CHUNK = 8;
let pendingKeys = [];      // not yet decoded, in the order they will be
let preferred = [];        // asked for before the list was known

/** Move these lines to the front of what is still to decode (the session's own exercises). */
export function preferVoice(keys) {
  const want = (keys || []).filter((k) => k && !voiceBufs[k]);
  if (!want.length) return;
  preferred = [...new Set([...want, ...preferred])];
  if (pendingKeys.length) pendingKeys = [...want.filter((k) => pendingKeys.includes(k)), ...pendingKeys.filter((k) => !want.includes(k))];
}

async function decodeOne(k) {
  if (voiceBufs[k] || !ctx) return;
  try {
    const r = await fetch(`./audio/voice/${encodeURIComponent(k)}.mp3`);
    if (!r.ok) return;
    const data = await r.arrayBuffer();
    voiceBufs[k] = await new Promise((ok, no) => ctx.decodeAudioData(data, ok, no));
  } catch { /* that line falls back to speech */ }
}

/**
 * Decode every line once. Safe to call repeatedly; a failure leaves the
 * device's own speech as the fallback. A failed list is tried again, but not
 * within 20 s of the last failure, so a flaky connection is not hammered.
 */
export function loadVoice() {
  if (voiceLoad) return voiceLoad;
  if (!audioAvailable()) return Promise.resolve(false);
  if (voiceFailAt && Date.now() - voiceFailAt < 20000) return Promise.resolve(false);
  prepareAudio();
  if (!ctx) return Promise.resolve(false);
  voiceLoading = true;
  const failed = () => { voiceLoad = null; voiceFailAt = Date.now(); return false; };
  voiceLoad = (async () => {
    try {
      const res = await fetch('./audio/voice/lines.json');
      if (!res.ok) return failed();
      const keys = Object.keys((await res.json()).lines || {});
      voiceFailAt = 0;
      const core = CORE.filter((k) => keys.includes(k));
      const first = preferred.filter((k) => keys.includes(k) && !core.includes(k));
      pendingKeys = keys.filter((k) => !core.includes(k) && !first.includes(k));
      pendingKeys = [...first, ...pendingKeys];
      await Promise.all(core.map(decodeOne));
      while (pendingKeys.length) {
        const batch = pendingKeys.splice(0, CHUNK);
        await Promise.all(batch.map(decodeOne));
        // Safari has no requestIdleCallback: a task boundary between batches.
        if (pendingKeys.length) await new Promise((r) => setTimeout(r, 0));
      }
      return true;
    } catch { return failed(); } finally { voiceLoading = false; }
  })();
  return voiceLoad;
}

/**
 * Resolves true once `key` is decoded and the context is running, false after
 * `ms`. The first line of a workout waits here for the tap's resume and its own
 * clip, instead of being said in the robotic device voice.
 */
export function whenVoiceReady(key, ms = 1200) {
  const ready = () => !!(ctx && voiceBufs[key] && ctx.state === 'running');
  if (ready()) return Promise.resolve(true);
  return new Promise((done) => {
    const until = Date.now() + ms;
    const poll = () => {
      if (ready()) { done(true); return; }
      if (Date.now() >= until) { done(false); return; }
      setTimeout(poll, 40);
    };
    setTimeout(poll, 40);
  });
}
export function hasVoice(key) { return !!voiceBufs[key]; }

/**
 * One clip, through its gain, and through a stereo panner when it names a side
 * (B6-3). `src._pan` is the pan it really got: 0 where there is no panner.
 */
function voiceSource(key, pan = 0) {
  const src = ctx.createBufferSource();
  src.buffer = voiceBufs[key];
  const g = ctx.createGain();
  g.gain.value = Math.min(1, 0.95 * cueVolume() * voiceVolume());
  src.connect(g);
  src._pan = 0;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    try {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(ctx.destination);
      src._pan = pan;
      return src;
    } catch { /* played from the centre */ }
  }
  g.connect(ctx.destination);
  return src;
}

// A line that closes something (B1-4): never cut by the next line, which waits
// for it instead. "Exercise done!" is followed by "Next up", not talked over.
const COMPLETION = new Set(['exdone', 'alldone', 'setsdone', 'workout-done']);

/**
 * Start `keys` one after the other from audio time `at`, each in the speaking
 * list. `pending` marks a line held for later (sayLineAt), the only kind a tap
 * drops before it starts (cancelPendingVoice).
 */
function chain(keys, at, gap, pending = false) {
  let t = at;
  // A phrase that starts with a side keeps that side throughout (B6-3).
  const pan = panFor(keys[0]);
  for (const k of keys) {
    const src = voiceSource(k, pan);
    src.start(t);
    const e = { src, key: k, start: t, end: t + voiceBufs[k].duration, completion: COMPLETION.has(k), pending };
    src.onended = () => { speaking = speaking.filter((x) => x !== e); };
    speaking.push(e);
    logVoice(k, Math.max(0, Math.round((t - ctx.currentTime) * 10) / 10), t, src._pan);
    t = e.end + gap;
  }
}

/**
 * Say `keys` (one key or a phrase of several) starting `delay` seconds from
 * now, cutting off any other line from the moment it starts. False when it
 * cannot (no context, not running, not loaded), so the caller falls back to
 * speech; true when it was placed, or deliberately dropped behind a completion
 * line more than 2 s from its end.
 */
function place(keyOrKeys, delay = 0, gap = 0.08, pending = false) {
  if (!ctx || ctx.state !== 'running') return false;
  const keys = [].concat(keyOrKeys).filter((k) => k && voiceBufs[k]);   // members with no clip are skipped
  if (!keys.length) return false;
  try {
    const now = ctx.currentTime;
    let at = now + Math.max(0.02, delay || 0);
    const done = speaking.filter((e) => e.completion && e.end > now);
    if (done.length) {
      const after = Math.max(...done.map((e) => e.end)) + 0.12;
      if (after - now > 2) return true;
      at = Math.max(at, after);
    }
    // Only the current line is ever said: the others stop where this one starts,
    // and so does a scheduled voice cue ("Ten seconds!") that would still be
    // talking then (review, 2026-09-23: two coach lines at once).
    for (const e of speaking) if (!e.completion) { try { e.src.stop(at); } catch { /* ended */ } }
    speaking = speaking.filter((e) => e.completion);
    for (const n of nodes) if (n._voice && n._at < at) { try { n.stop(at); } catch { /* ended */ } }
    chain(keys, at, gap, pending);
    return true;
  } catch { return false; }
}

/** Say a line (or a phrase) now. False when it cannot (not loaded, no context). */
export function playVoice(keyOrKeys) {
  // Not yet unlocked by a tap: say nothing here, so the caller falls back to speech.
  return place(keyOrKeys, 0);
}

/**
 * Say a line (or a phrase) `delay` seconds from now, on the audio clock, as a
 * line rather than a cue. Held for later, so a tap before it starts drops it.
 */
export function playVoiceAt(keyOrKeys, delay) {
  return place(keyOrKeys, delay, 0.08, true);
}

/**
 * A phrase (B1-5): each clip starts at the end of the one before, plus `gap`,
 * on the audio clock, from `at` (audio time; now when left out). The whole
 * chain is in the speaking list, so stopVoice() stops all of it.
 */
export function playPhrase(keys, { at = null, gap = 0.08 } = {}) {
  if (!ctx) return false;
  return place(keys, at == null ? 0 : at - ctx.currentTime, gap);
}

/** Say a line `delay` seconds from now, as one of the step's cues (cancelled with them). */
export function scheduleVoice(key, delay) {
  if (!ctx || !voiceBufs[key] || !(delay > 0.05)) return false;
  try {
    const src = voiceSource(key, panFor(key));
    src.start(ctx.currentTime + delay);
    src._at = ctx.currentTime + delay;
    // A voice, not a tone: it never rings out past a cancel (cancelAll).
    src._voice = true;
    logVoice(key, Math.round(delay * 10) / 10, ctx.currentTime + delay, src._pan);
    nodes.push(src);
    src.onended = () => { nodes = nodes.filter((n) => n !== src); };
    return true;
  } catch { return false; }
}

/** Stop every line said or waiting; with keepCompletion a completion line plays out. */
export function stopVoice({ keepCompletion = false } = {}) {
  const keep = [];
  for (const e of speaking) {
    if (keepCompletion && e.completion) { keep.push(e); continue; }
    try { e.src.stop(); } catch { /* already ended */ }
  }
  speaking = keep;
}

/**
 * Drop a line held for later (sayLineAt: a step line waiting for its end tone,
 * "Paused.") that has not started, never a completion line, and never a line
 * said now: Start on a ready screen says "Get ready" a moment before its own
 * act() runs this, and dropping it left that Start silent (review, 2026-09-23).
 */
export function cancelPendingVoice() {
  if (!ctx) return;
  const now = ctx.currentTime;
  speaking = speaking.filter((e) => {
    if (!e.pending || e.completion || e.start <= now + 0.005) return true;
    try { e.src.stop(); } catch { /* ended */ }
    return false;
  });
}

/** Seconds until the last line said or waiting ends, 0 when silent. */
export function speakingLeft() {
  if (!ctx || !speaking.length) return 0;
  return Math.max(0, Math.max(...speaking.map((e) => e.end)) - ctx.currentTime);
}

// ------------------------------------------------------ hear the coach ----
// Settings' "Hear the coach" (B6-4, 2026-09-23): the moments of a workout in
// order, on the audio clock, so he hears the whole voice and every sound once
// before a workout needs them. Only on his tap, through the same context and
// session as everything else (transient: his music is never paused). Nothing
// new is said or rung: each sound keeps its one meaning from the sound map.
//
//   0      "Get ready!"
//   1.6    880 Hz pips at 1.6, 2.1 and 2.6 (counting down)
//   3.1    the 523 Hz tone (now)
//   3.5    "Left leg! Balance!", from the left with Stereo sides on
//   6.0    the 1046.5 Hz bell (a set closed), after "Balance!" ends at 5.83
//   6.6    "That's everything for today!"
export const COACH_HITS = [0, 1.6, 2.1, 2.6, 3.1, 3.5, 6.0, 6.6];
export const COACH_LINES = ['ready', 'left', 'cue-balance', 'alldone'];
let demoUntil = 0;

/**
 * A line or phrase at audio time `at`. A clip still decoding is waited for up to
 * its moment and never played late: what is there by then is said, in order.
 */
function sayAtClock(keys, at) {
  const missing = keys.filter((k) => !voiceBufs[k]);
  const go = () => {
    if (!ctx || at < ctx.currentTime + 0.01) return;
    const ks = keys.filter((k) => voiceBufs[k]);
    if (ks.length) chain(ks, at, 0.08);
  };
  if (!missing.length) { go(); return Promise.resolve(); }
  const wait = Math.max(0, (at - ctx.currentTime - 0.1) * 1000);
  return Promise.all(missing.map((k) => whenVoiceReady(k, wait))).then(go);
}

/**
 * Play the demo. Returns the seconds from now to its zero (for the tile's pops),
 * or null when there is no running context or one is still playing.
 */
export function coachDemo() {
  if (!ctx || ctx.state !== 'running') return null;
  const now = ctx.currentTime;
  if (now < demoUntil) return null;
  const t0 = now + 0.05;
  demoUntil = t0 + 8.8;
  for (const s of [1.6, 2.1, 2.6]) tone(t0 + s, 880, 0.08, 0.22, true);
  tone(t0 + 3.1, 523, 0.32, 0.3, true);
  goldBell(t0 + 6.0);
  // The lines one after another, so they are logged and said in their order
  // even when a clip is still decoding.
  sayAtClock(['ready'], t0)
    .then(() => sayAtClock(['left', 'cue-balance'], t0 + 3.5))
    .then(() => sayAtClock(['alldone'], t0 + 6.6));
  return t0 - now;
}
