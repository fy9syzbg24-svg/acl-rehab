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

/** Call from a tap. Safe to call repeatedly. */
export function unlockAudio() {
  if (!audioAvailable()) return false;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    // iOS: without this the ring/silent switch mutes Web Audio. Where the
    // Audio Session API exists, ask for playback; where it does not, the
    // visual cues still work.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function tone(at, freq, dur = 0.09, gain = 0.25) {
  if (!ctx) return;
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
export function scheduleCues(remaining) {
  if (!ctx || remaining == null) return;
  const t0 = ctx.currentTime;
  for (const k of [3, 2, 1]) {
    const at = remaining - k;
    if (at > 0.05) tone(t0 + at, 880, 0.08, 0.22);
  }
  if (remaining > 0.05) tone(t0 + remaining, 523, 0.32, 0.3);
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
