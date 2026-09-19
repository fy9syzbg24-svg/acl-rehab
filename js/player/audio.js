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
export const SILENT_KEY = 'rehab.audio.silent';
export function silentMode() {
  try {
    const v = localStorage.getItem(SILENT_KEY);
    return v === 'through' || v === 'buzz' ? v : 'duck';
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
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => { cueState = 'running'; }).catch(() => { cueState = 'blocked'; });
    } else {
      cueState = ctx.state;
    }
    return true;
  } catch {
    return false;
  }
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

function tone(at, freq, dur = 0.09, gain = 0.25) {
  if (!ctx) return;
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
  nodes.push(o);
  o.onended = () => { nodes = nodes.filter((n) => n !== o); };
}

/** Stop every scheduled sound and the metronome loop. */
export function cancelAll() {
  for (const n of nodes) { try { n.stop(); } catch { /* already done */ } }
  nodes = [];
  stopMetronome();
}

/**
 * Cues for a timed step with `remaining` seconds left: a short pip at 3, 2
 * and 1 seconds to go, and a longer, lower tone at the end. Only cues still in
 * the future are scheduled.
 */
// A hold long enough that the middle is worth marking (B3, 2026-09-15).
const HALFWAY_OVER_SECS = 60;

export function scheduleCues(remaining) {
  if (!ctx || remaining == null) return;
  const t0 = ctx.currentTime;
  // Halfway through a long one, a single soft low tone: low and quiet on
  // purpose, so it reads as information and never as the end.
  if (remaining > HALFWAY_OVER_SECS) tone(t0 + remaining / 2, 392, 0.15, 0.14);
  for (const k of [3, 2, 1]) {
    const at = remaining - k;
    if (at > 0.05) tone(t0 + at, 880, 0.08, 0.22);
  }
  if (remaining > 0.05) tone(t0 + remaining, 523, 0.32, 0.3);
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
}

/**
 * The workout is saved (B1, 2026-09-15). Three rising tones, and deliberately
 * called where the save is durable rather than where the sets end, so what it
 * means is "it is written down", not "you stopped".
 */
export function scheduleFinish() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.05;
  tone(t0, 523, 0.12, 0.26);
  tone(t0 + 0.13, 659, 0.12, 0.26);
  tone(t0 + 0.26, 784, 0.2, 0.3);
}

/** One tone as a step ends, no countdown: the switch inside a continuous exercise. */
export function scheduleSwitch(remaining) {
  if (!ctx || remaining == null || remaining <= 0.05) return;
  tone(ctx.currentTime + remaining, 660, 0.22, 0.3);
}

/** Two quick tones, for the sound check. */
export function soundCheck() {
  if (!unlockAudio() || !ctx) return false;
  const t = ctx.currentTime + 0.05;
  tone(t, 660, 0.12, 0.3);
  tone(t + 0.22, 880, 0.12, 0.3);
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
