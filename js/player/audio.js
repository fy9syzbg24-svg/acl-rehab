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
import { isNative, call as nativeCall } from '../native-bridge.js';
import * as Pk from './packs.js';

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

// ------------------------------------------------ the native audio session ----
// Rehab Test (round 3, 2026-09-30). The app owns the phone's audio session
// (AVAudioSession, CONTRACT.md audio.session), which a web page never could:
//
//   'songs'  one of HIS songs plays: the session stops being mixable, so Spotify
//            pauses (his rule: "I don't want this app ever pausing my music. Except
//            for when I'm playing the 120 BPM songs.", 2026-09-15)
//   'mix'    cues and the coach mix over his music and never pause it; asked for
//            when a song stops, the app hands the audio back
//            (notifyOthersOnDeactivation), so Spotify carries on by itself
//   'off'    the workout is over: nothing of ours is held
//
// With the app, background audio keeps the cues sounding while the phone is locked
// or he is in another app (his 2026-09-16 ask: "making the metronome sounds if I'm
// in another app. If I force close the app, that's when I don't want those sounds").
// The page's own navigator.audioSession is left alone then: two owners of one
// session would fight. An older build that does not know the call answers null, and
// the page falls back to the web rules below, unchanged.
//
// The hand back after a song waits a moment (SONG_GRACE_MS), so a song that stops
// for a tap, a step change or a Skip and plays again at once never flickers Spotify
// on and off; a rest with the music waiting is long enough to hand it back.
const SONG_GRACE_MS = 1500;
const OFF_GRACE_MS = 4000;       // the saved chime and the day finish ring out first
let nativeOk = null;             // null: not asked yet; true: the app owns the session; false: web rules
let nativeWant = null;           // the mode last asked for
let nativeSent = null;           // the mode the app last confirmed
let nativeTimer = null;
export const sessionLog = [];    // for tests: { mode, at }

// The silent hold (AudioBridge.swift): while a workout RUNS, the app plays silence
// through the same mixing session, so iOS keeps it (and this page's timers) awake with
// the phone locked. Spotify is untouched. Let go on a pause and at the end.
let holdWant = false;
let holdSent = null;

function sendNative(mode, { keepTimer = false } = {}) {
  if (!keepTimer) { clearTimeout(nativeTimer); nativeTimer = null; }
  const hold = mode !== 'off' && holdWant;
  if (mode === nativeSent && hold === holdSent) return;
  const ask = mode;
  // The app answers with its session state ({ mode, category, ... }); an older build
  // that does not know the call answers null.
  nativeCall('audio.session', { mode: ask, hold }).then((r) => {
    const ok = !!r && (r === true || typeof r === 'object');
    sessionLog.push({ mode: ask, hold, ok, state: typeof r === 'object' ? r : null, at: Date.now() });
    if (sessionLog.length > 30) sessionLog.shift();
    if (ok) { nativeOk = true; nativeSent = ask; holdSent = hold; syncQuiet(); return; }
    if (nativeOk === null) { nativeOk = false; webSession(nativeWant === 'songs' ? 'song' : 'cues'); }
  });
}

// ------------------------------------------------ the page's own keep alive ----
// MEASURED 2026-09-30 (build r3native, simulator): the app's silent hold keeps the APP
// alive, but WebKit runs the page in its own process, and that process was suspended
// about 50 s after the app left the screen (the page's ticks stopped at 48 s and came
// back only when the app did, at 197 s). WebKit keeps a page's process running while the
// page is PLAYING AUDIO ("View is playing audio" in its log), so while a workout runs in
// the app the page plays silence.
//
// Round 3 fix (r3fix-player, 2026-09-30): the silence is a looping buffer of zeros on the
// page's own AudioContext, never a media element. The first version was a looping
// <audio> element, and WebKit registers any playing media element as the phone's Now
// Playing: a blank card titled with the page's name sat on the Lock Screen during and
// after every workout, in the slot his Spotify card uses (r3audit PS-01, NW-01). The
// context's silence gives the same "playing audio" to WebKit (measured: the foreground
// assertion is taken) and no card at all. It stays on while one of his songs plays, so
// the page never depends on the song to stay awake, and stops on a pause and at the end.
let quietSrc = null;
let songHasSound = false;   // one of his songs is playing (songs.js); kept for Settings and tests
export const keepAliveLog = [];
function quiet(play) {
  try {
    if (play) {
      if (quietSrc) return;
      prepareAudio();
      if (!ctx) return;
      const buf = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate)), ctx.sampleRate);   // one second of zeros
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(ctx.destination);
      src.start();
      quietSrc = src;
      keepAliveLog.push({ on: true, at: Date.now() });
    } else if (quietSrc) {
      const src = quietSrc;
      quietSrc = null;
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
      keepAliveLog.push({ on: false, at: Date.now() });
    }
  } catch { /* the app's own hold still keeps the app */ }
}
function syncQuiet() {
  quiet(isNative() && nativeOk === true && holdWant);
}
/** songs.js: his song started (true) or stopped (false). The silence carries on either way. */
export function songSounding(on) { songHasSound = !!on; syncQuiet(); }
/** True while the page's silence is playing (tests). */
export const keepAliveOn = () => !!quietSrc;

/** A workout is running (true) or not (false): keep the app awake with silence while it runs. */
export function holdAwake(on) {
  if (holdWant === !!on) return;
  holdWant = !!on;
  syncQuiet();
  if (!isNative() || nativeOk === false || !nativeWant || nativeWant === 'off') return;
  // The mode the app holds now; a hand back still waiting keeps waiting.
  sendNative(nativeSent && nativeSent !== 'off' ? nativeSent : nativeWant, { keepTimer: true });
}

/** Tests only (sim_eval): behave as if the app had answered for the session. Nothing in the app calls it. */
export function testNativeAudio(on) { nativeOk = on ? true : null; nativeSent = on ? 'mix' : null; }

/** True when the app answered for the session (Rehab Test round 3 and later). */
export const nativeAudio = () => nativeOk === true;

function nativeSession(mode) {
  nativeWant = mode;
  if (mode === 'songs' || nativeSent === null || nativeSent === 'off' && mode === 'mix') { sendNative(mode); return; }
  if (mode === nativeSent) { clearTimeout(nativeTimer); nativeTimer = null; return; }
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(() => { if (nativeWant === mode) sendNative(mode); }, mode === 'off' ? OFF_GRACE_MS : SONG_GRACE_MS);
}

/**
 * The workout is over or left: hand everything back (the app deactivates its
 * session, so his music is untouched and nothing of ours runs in the background).
 * Any sound after this asks again through unlockAudio or a song.
 */
export function releaseSession() {
  if (isNative() && nativeOk !== false) nativeSession('off');
}

let sessionType = null;
/**
 * 'song' (one of his songs starts), 'song-off' (it stopped: hand the music back) or
 * 'cues' (a tap that may make sound). A tap during a song never hands the speaker
 * back: only the song stopping does.
 */
export function setSession(mode) {
  if (isNative() && nativeOk !== false) {
    if (mode === 'song') nativeSession('songs');
    else if (mode === 'song-off' || nativeWant !== 'songs') nativeSession('mix');
    return;
  }
  webSession(mode === 'song-off' ? 'cues' : mode);
}
function webSession(mode) {
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
export function sessionKind() { return nativeOk ? (nativeSent === 'songs' ? 'playback' : nativeSent === 'off' ? null : 'mix') : sessionType; }

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
    loadSounds();
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
      loadSounds();
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

// ------------------------------------------------------------ sound sets ----
// Round 3 (2026-09-30, his ask "generate better sound effects for the workouts"):
// a set of recorded sounds he picks in Settings ('rt.sfx', packs.js). Each moment
// asks for its row of the sound map first (sample) and plays its classic tone only
// when the chosen set has no file for that row. Samples go through the same
// context, the same gain rule (his cue volume) and the same bookkeeping as a tone:
// scheduled on the audio clock, tracked, cancelled with the step's cues, kept when
// the moment is a kept one (the saved chime, the bell, the day).
const sfxBufs = {};          // row -> AudioBuffer, for the set in sfxFor
let sfxFor = null;           // the set id those buffers belong to
let sfxLoading = null;

/** Decode the chosen set's files (small, a few kB each). Safe to call repeatedly. */
export function loadSounds() {
  if (!ctx) return Promise.resolve(false);
  if (sfxLoading) return sfxLoading;
  sfxLoading = (async () => {
    try {
      await Pk.loadSfx();
      const id = Pk.sfxId();
      if (id === sfxFor) return true;
      for (const k of Object.keys(sfxBufs)) delete sfxBufs[k];
      sfxFor = id;
      const files = Pk.sfxFiles(id);
      await Promise.all(Object.entries(files).map(async ([row, url]) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return;
          const data = await r.arrayBuffer();
          const buf = await new Promise((ok, no) => ctx.decodeAudioData(data, ok, no));
          if (sfxFor === id) sfxBufs[row] = buf;
        } catch { /* that row keeps its classic tone */ }
      }));
      return true;
    } catch { return false; } finally { sfxLoading = null; }
  })();
  return sfxLoading;
}

// Settings saves a pick through rtprefs.js, which says so with 'rt-prefs': the next line
// is in the new voice, the next sound from the new set.
if (typeof window !== 'undefined') {
  window.addEventListener('rt-prefs', (e) => {
    const k = e.detail?.key;
    if (k === Pk.VOICE_KEY && voiceFor !== undefined) voiceChanged();
    if (k === Pk.SFX_KEY) soundSetChanged();
  });
}

/** His pick of sound set changed (Settings): the next sounds use it. */
export function soundSetChanged() { sfxFor = null; return loadSounds(); }

/** True when the chosen set has a recording for this row of the sound map. */
export const hasSound = (row) => !!sfxBufs[row];

// The recorded sounds are peak normalised to -3 dBFS (0.71; make_audio_rt.py), a sine
// here peaks at its gain. A struck glass is a transient, heard quieter than a sine of
// the same peak, so 1.8 puts a sample a little above the tone it replaces at the same
// cue volume; the row's own gain (pip 0.22, now 0.3, set 0.16...) still sets the balance.
const SAMPLE_LEVEL = 1.8;

function sample(at, row, gain = 0.25, keep = false) {
  if (!ctx || !sfxBufs[row]) return null;
  try {
    const logged = { freq: null, sfx: row, at: Math.round(at * 1000) / 1000, keep };
    toneLog.push(logged);
    if (toneLog.length > 40) toneLog.shift();
    const src = ctx.createBufferSource();
    src.buffer = sfxBufs[row];
    const g = ctx.createGain();
    g.gain.value = Math.min(1, Math.max(0.0002, gain * SAMPLE_LEVEL * cueVolume()));
    src.connect(g).connect(ctx.destination);
    src.start(at);
    src._at = at;
    src._log = logged;
    src._dur = src.buffer.duration;
    if (keep) return src;
    nodes.push(src);
    src.onended = () => { nodes = nodes.filter((n) => n !== src); };
    return src;
  } catch { return null; }
}

/**
 * How long a sample SOUNDS: from its start until its level stays 20 dB under its peak
 * (10 ms windows), cached per buffer. A recorded strike rings far longer than a Classic
 * tone, but only its body is heard over a phone speaker, and the line after it waits for
 * the body, not the silent end of the file (r3fix PS-11, PS-17: the saved chime was waited
 * on for 0.4 s, a Classic figure, while it rang 0.7 s; the rest chime for its whole 1.0 s).
 */
const audibleCache = new WeakMap();
function audibleLen(buf) {
  if (!buf) return 0;
  const hit = audibleCache.get(buf);
  if (hit != null) return hit;
  let out = buf.duration;
  try {
    const x = buf.getChannelData(0);
    const w = Math.max(1, Math.round(buf.sampleRate * 0.01));
    const n = Math.floor(x.length / w);
    const e = new Float32Array(n);
    let pk = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = i * w; j < (i + 1) * w; j++) sum += x[j] * x[j];
      e[i] = Math.sqrt(sum / w);
      if (e[i] > pk) pk = e[i];
    }
    const floor = pk * 0.1;   // -20 dB
    let last = 0;
    for (let i = 0; i < n; i++) if (e[i] >= floor) last = i;
    if (pk > 0) out = Math.min(buf.duration, (last + 1) * w / buf.sampleRate);
  } catch { /* the whole file */ }
  audibleCache.set(buf, out);
  return out;
}

/** A row of the sound map at `at`: its sample from the chosen set, else its classic tone. */
function sound(at, row, freq, dur, gain, keep = false) {
  return sample(at, row, gain, keep) || tone(at, freq, dur, gain, keep);
}
/** How long a row sounds: the sample's audible body, else the classic tone's length. */
const lengthOf = (row, dur) => (sfxBufs[row] ? Math.min(audibleLen(sfxBufs[row]), 1.5) : dur);

/**
 * One sound of the map now, for other pages (a supplement ticked, a log saved) and
 * the Settings sample. Only the chosen set's recording: a page that has no classic
 * tone for a moment stays silent in Classic, as it always was. Kept (nothing cancels it).
 */
export function playSound(row) {
  if (!ctx || ctx.state !== 'running') return false;
  return !!sample(ctx.currentTime + 0.02, row, 0.25, true);
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
    // A line placed ahead for the time away that has already begun is said to its
    // end: the step change that reschedules the rest would otherwise cut it mid word.
    if (ringOut && n._ahead && n._at != null && n._at <= now + 0.02) { keepNodes.push(n); continue; }
    try { n.stop(); } catch { /* already done */ }
    // For tests: a tone stopped before it sounded is marked in toneLog.
    if (n._log && n._at > now) n._log.cut = true;
    if (endTone && endTone.node === n) endTone = null;
  }
  nodes = keepNodes;
  stopMetronome();
  // Every beat laid ahead is stopped above, so the cap counts afresh (r3fix PS-15: a
  // re-lay from a rest or a get ready kept the old count and silenced later bouts).
  aheadBeats = 0;
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

export function scheduleCues(remaining, { halfwayAt, edge = null } = {}) {
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
  if (half != null && half > 0.05) sound(t0 + half, 'halfway', 392, 0.15, 0.14);
  for (const k of [3, 2, 1]) {
    const at = remaining - k;
    if (at > 0.05) sound(t0 + at, 'pip', 880, 0.08, 0.22);
  }
  if (remaining > 0.05) endTone = endOf(t0 + remaining, edge);
}

/**
 * The "now" at the end of a step. With a set that has them, the edge into a rest
 * and the edge out of one have their own sounds (round 3); otherwise, and in
 * Classic, the one 523 Hz tone. `edge` is 'rest' (a rest begins), 'restend' (a rest
 * is over) or null.
 */
function endOf(at, edge = null) {
  const row = edge && sfxBufs[edge] ? edge : 'now';
  const node = sound(at, row, 523, 0.32, 0.3);
  return { node, end: at + lengthOf(row, 0.32) };
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
    if (at > 0.05) sound(t0 + at, 'countin', 660, 0.07, 0.18);
  }
  // And the tone that means "now" at zero (B1-6): the count in used to end in
  // silence. The same 523 Hz end tone every step ends on, a cue like the pips,
  // so a Pause during the five stops it before it sounds.
  endTone = { ...endOf(t0 + secs), countIn: true };
}

/**
 * The workout is saved (B1, 2026-09-15). Three rising tones, and deliberately
 * called where the save is durable rather than where the sets end, so what it
 * means is "it is written down", not "you stopped".
 */
export function scheduleFinish() {
  if (!ctx) return 0;
  const t0 = ctx.currentTime + 0.05;
  // Seconds from now until the chime has rung, for the line that follows it (savedMoment).
  if (sample(t0, 'saved', 0.28, true)) return 0.05 + lengthOf('saved', 0.46);
  tone(t0, 523, 0.12, 0.26, true);
  tone(t0 + 0.13, 659, 0.12, 0.26, true);
  tone(t0 + 0.26, 784, 0.2, 0.3, true);
  return 0.4;   // the Classic figure the 0.45 s line was tuned to (B1-4)
}

/**
 * Paused (B1-7): a falling E then C, soft, kept like the saved chime so the
 * pause's own cancel never cuts it. Its one meaning in the sound map.
 */
export function schedulePause() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  if (sample(t0, 'paused', 0.22, true)) return;
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
  sound(at ?? ctx.currentTime + 0.01, 'set', 1046.5, 0.5, 0.16, true);
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
  // A recorded day finish starts where the classic one lands its first note.
  if (sample(t0 + 0.42, 'day', 0.2, true)) return;
  [523, 659, 784, 1046.5, 1318.5].forEach((f, i) => tone(t0 + 0.42 + i * 0.13, f, 0.14, 0.12, true));
  for (const f of [523, 784, 1046.5]) tone(t0 + 1.02, f, 0.9, 0.1, true);
}

/**
 * Seconds from the bell until it has rung: 38 dB down by then, only its tail
 * left. The step's line waits this long after a set closes, so the line
 * follows the bell instead of landing on it (B1-4's rule, review 2026-09-23).
 */
export const BELL_RUNG = 0.3;
/** The same for the bell he will hear: the chosen set's own bell when it has one (r3fix PS-11). */
export const bellRung = () => (sfxBufs.set ? Math.min(audibleLen(sfxBufs.set), 1.2) : BELL_RUNG);

/** One tone as a step ends, no countdown: the switch inside a continuous exercise. */
export function scheduleSwitch(remaining) {
  if (!ctx || remaining == null || remaining <= 0.05) return;
  sound(ctx.currentTime + remaining, 'goal', 660, 0.22, 0.3);
}

/**
 * Two quick tones, for the sound check. Kept, like the saved chime: the Cues
 * button cancels the step's cues straight after it, which cut the second tone
 * (and before B1-4 both of them).
 */
export function soundCheck() {
  if (!unlockAudio() || !ctx) return false;
  const t = ctx.currentTime + 0.05;
  if (sample(t, 'check', 0.3, true)) return true;
  tone(t, 660, 0.12, 0.3, true);
  tone(t + 0.22, 880, 0.12, 0.3, true);
  return true;
}

/**
 * Settings' sample of a sound set: three pips and the "now", the way a step ends.
 * Kept, like the sound check, so nothing cancels it half way.
 */
export function sampleSounds() {
  if (!unlockAudio() || !ctx) return false;
  const t = ctx.currentTime + 0.08;
  for (const k of [0, 1, 2]) sound(t + k * 0.5, 'pip', 880, 0.08, 0.22, true);
  sound(t + 1.5, 'now', 523, 0.32, 0.3, true);
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
      sound(metroNext, 'metro', 1320, 0.03, 0.14);
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

// Round 3: the voice he picked ('rt.voice', packs.js), each in its own folder; the
// original recordings stay where they were and are the voice when there is no
// voices.json. `voiceFor` is the voice the decoded lines belong to, so a change of
// voice mid decode never mixes two voices in one workout.
let voiceFor;              // undefined: nothing loaded; null: the original folder; else an id
let voiceKeyList = [];     // every line this voice has, for variants (go, go2, go3...)

async function decodeOne(k) {
  if (voiceBufs[k] || !ctx) return;
  const id = voiceFor;
  const from = async (dir) => {
    const r = await fetch(`${dir}${encodeURIComponent(k)}.mp3`);
    if (!r.ok) return null;
    const data = await r.arrayBuffer();
    return new Promise((ok, no) => ctx.decodeAudioData(data, ok, no));
  };
  try {
    let buf = await from(Pk.voiceDir(id)).catch(() => null);
    if (!buf && id && Pk.borrowsOriginal(id)) buf = await from(Pk.voiceDir(null)).catch(() => null);
    if (buf && id === voiceFor) {
      voiceBufs[k] = buf;
      voiceSkip[k] = /^\s*\[exhales?\]/i.test(voiceText[k] || '') ? breathLead(buf) : 0;
    }
  } catch { /* that line falls back to speech */ }
}

// A line directed to open on a breath ("[exhales] Rest.", lines.json) is recorded as the
// breath, about 0.4 s of silence, then the word: the word landed 1.3 s after its start,
// while the other takes of the same line ("Rest now.") land at 0.1 s, so the rotation put
// "Rest." anywhere from 0.7 to 2.4 s after the edge (r3audit PS-17). Such a line starts
// at its word, 60 ms before it, faded in over 15 ms; the rest chime carries the exhale.
// Only lines that say so in their direction: a "Next up:" line has the same kind of
// pause inside it and must be said whole (measured on every clip of all four voices).
const voiceSkip = {};      // key -> seconds skipped at the start
let voiceText = {};        // key -> its direction and words, for the voice in voiceFor
function breathLead(buf) {
  try {
    const x = buf.getChannelData(0);
    const w = Math.max(1, Math.round(buf.sampleRate * 0.02));
    const n = Math.floor(x.length / w);
    const e = new Float32Array(n);
    let pk = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = i * w; j < (i + 1) * w; j++) sum += x[j] * x[j];
      e[i] = Math.sqrt(sum / w);
      if (e[i] > pk) pk = e[i];
    }
    const quietBelow = pk * 0.01;   // -40 dB
    let started = false;
    let run = 0;
    for (let i = 0; i < n && i * 0.02 <= 1.8; i++) {
      if (e[i] >= quietBelow) {
        if (started && run * 0.02 >= 0.25) return Math.max(0, i * 0.02 - 0.06);
        started = true;
        run = 0;
      } else if (started) run++;
    }
  } catch { /* said whole */ }
  return 0;
}
/** Where a line's clip starts, and how long it sounds from there. */
const skipOf = (k) => voiceSkip[k] || 0;
const clipLen = (k) => voiceBufs[k].duration - skipOf(k);
/** Start a clip at audio time `t`, from its word when its breath is skipped. */
function startClip(src, k, t) {
  const skip = skipOf(k);
  if (skip > 0 && src._gain) {
    const full = src._gain.gain.value;
    src._gain.gain.setValueAtTime(0.0001, t);
    src._gain.gain.linearRampToValueAtTime(full, t + 0.015);
  }
  src.start(t, skip);
}

/** The takes of a line this voice has: 'go' gives ['go', 'go2', 'go3', ...] (only those recorded). */
export function takesOf(key) {
  const re = new RegExp(`^${key.replace(/[^a-z0-9-]/gi, '')}\\d+$`);
  const more = voiceKeyList.filter((k) => re.test(k)).sort((a, b) => Number(a.slice(key.length)) - Number(b.slice(key.length)));
  return [key, ...more];
}

/** The voice the lines are in (null: the original recordings). */
export const currentVoice = () => (voiceFor === undefined ? Pk.voiceId() : voiceFor);

/**
 * His pick of voice changed (Settings): drop the decoded lines and load the new
 * voice. A line already sounding plays out.
 */
export function voiceChanged() {
  for (const k of Object.keys(voiceBufs)) delete voiceBufs[k];
  for (const k of Object.keys(voiceSkip)) delete voiceSkip[k];
  voiceText = {};
  voiceLoad = null;
  voiceFailAt = 0;
  voiceFor = undefined;
  pendingKeys = [];
  return loadVoice();
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
      await Pk.loadVoices();
      voiceFor = Pk.voiceId();
      const keys = await Pk.voiceKeys(voiceFor);
      if (!keys) return failed();
      voiceText = Pk.voiceTexts(voiceFor);
      voiceKeyList = keys;
      voiceFailAt = 0;
      // The takes of the lines said most (go2, go3, rest2...) are core too.
      const core = [...new Set(CORE.flatMap((k) => takesOf(k)))].filter((k) => keys.includes(k));
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
  src._gain = g;
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
    startClip(src, k, t);
    const e = { src, key: k, start: t, end: t + clipLen(k), completion: COMPLETION.has(k), pending };
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
    startClip(src, key, ctx.currentTime + delay);
    src._at = ctx.currentTime + delay;
    // A voice, not a tone: it never rings out past a cancel (cancelAll).
    src._voice = true;
    logVoice(key, Math.round(delay * 10) / 10, ctx.currentTime + delay, src._pan);
    nodes.push(src);
    src.onended = () => { nodes = nodes.filter((n) => n !== src); };
    return true;
  } catch { return false; }
}

// ------------------------------------------------------- while he is away ----
// Round 3 (2026-09-30). With the app's background audio the page's audio clock keeps
// running while the phone is locked or he is in another app, but the page's own
// timers may not: iOS slows or stops them. So when the page goes away mid workout the
// player lays the cues of the steps still to come on the audio clock at once (the
// pips, the "now", the step's line, the metronome, the bell of a set that closes):
// the same sounds at the same moments as on screen, placed ahead. Every one is a cue:
// a Pause, a step change or coming back cancels them, and the player lays them again
// from the real clock. Nothing ahead is ever placed past the first step only he can
// end (a set of reps, an open hold), so nothing can sound for a step he is not in.

/** The audio clock now, or null before any sound. */
export const clockNow = () => (ctx ? ctx.currentTime : null);

/**
 * MEASURED in the app, 2026-09-30 (build r3native, simulator): with the silent hold the
 * page's timers keep running in the background (a tick every 2 to 3 s), but WebKit
 * interrupts the Web Audio clock the moment the app leaves the screen: it stood still
 * at the same time for 55 s while the wall clock ran. A resume() from the page, even in
 * the background, starts it again (13.3 s to 15.85 s over 2.5 s of wall time), and an
 * <audio> element (his song) plays in the background too. So while he is away the
 * player asks here on every tick: a clock that is not running, or that has fallen
 * behind the wall clock, is resumed, and true tells it to lay the cues again, because
 * anything laid before the stall would now sound late.
 */
let lastBeat = null;   // { clock, wall }
export function keepClockAlive() {
  if (!ctx) return Promise.resolve(false);
  const wall = performance.now();
  const clock = ctx.currentTime;
  const prev = lastBeat;
  lastBeat = { clock, wall };
  const stalled = !!prev && wall - prev.wall > 1200 && (clock - prev.clock) < (wall - prev.wall) / 1000 * 0.5;
  if (ctx.state === 'running' && !stalled) return Promise.resolve(false);
  return ctx.resume().then(() => { lastBeat = { clock: ctx.currentTime, wall: performance.now() }; return ctx.state === 'running'; }, () => false);
}
export function resetClockWatch() { lastBeat = null; }

/** The edge at `delay` s from now: three pips before it, then its "now" (never the step's own endTone). */
export function scheduleEdgeAhead(delay, { edge = null, pips = true } = {}) {
  if (!ctx || !(delay > 0.05)) return 0;
  const t0 = ctx.currentTime;
  if (pips) for (const k of [3, 2, 1]) { if (delay - k > 0.05) sound(t0 + delay - k, 'pip', 880, 0.08, 0.22); }
  const e = endOf(t0 + delay, edge);
  return e.end - t0;
}

/** The soft halfway tone at `delay` s from now, where the voice does not say it (as scheduleCues). */
export function scheduleHalfwayAhead(delay) {
  if (!ctx || !(delay > 0.05)) return;
  sound(ctx.currentTime + delay, 'halfway', 392, 0.15, 0.14);
}

/** A set closes at `delay` s from now: its bell, a cue here (a Pause before it drops it). */
export function scheduleBellAhead(delay) {
  if (!ctx || !(delay > 0.05)) return;
  sound(ctx.currentTime + delay, 'set', 1046.5, 0.5, 0.16);
}

/** A line or phrase at `delay` s from now, placed ahead: a cue, cancelled with them. */
export function scheduleLineAhead(keys, delay) {
  if (!ctx || !(delay > 0.05)) return false;
  const list = [].concat(keys).filter((k) => k && voiceBufs[k]);
  if (!list.length) return false;
  try {
    const pan = panFor(list[0]);
    let t = ctx.currentTime + delay;
    for (const k of list) {
      const src = voiceSource(k, pan);
      startClip(src, k, t);
      src._at = t;
      src._voice = true;
      src._ahead = true;
      logVoice(k, Math.round((t - ctx.currentTime) * 10) / 10, t, src._pan);
      nodes.push(src);
      src.onended = () => { nodes = nodes.filter((n) => n !== src); };
      t += clipLen(k) + 0.08;
    }
    return true;
  } catch { return false; }
}

/**
 * The metronome's beats for a work bout `from` to `from + secs` s from now, all at
 * once (the look ahead loop needs the page's timers, which may be asleep). At most
 * MAX_AHEAD_BEATS in total, so a long bout never floods the audio graph.
 */
const MAX_AHEAD_BEATS = 600;
let aheadBeats = 0;
export function resetAhead() { aheadBeats = 0; }
export function scheduleBeatsAhead(bpm, from, secs) {
  if (!ctx || !bpm || !(secs > 0)) return;
  const gap = 60 / bpm;
  const t0 = ctx.currentTime;
  for (let t = Math.max(from, 0.05); t < from + secs - 0.02 && aheadBeats < MAX_AHEAD_BEATS; t += gap) {
    sound(t0 + t, 'metro', 1320, 0.03, 0.14);
    aheadBeats++;
  }
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
//   1.6    pips at 1.6, 2.1 and 2.6 (counting down), the chosen set's (880 Hz in Classic)
//   3.1    its "now" (523 Hz in Classic)
//   3.5    "Left leg! Balance!", from the left with Stereo sides on
//   6.0    the bell (a set closed; 1046.5 Hz), after "Balance!" ends at 5.83
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
  // The chosen set's own pips and "now" (r3fix PS-09), Classic tones where it has none.
  for (const s of [1.6, 2.1, 2.6]) sound(t0 + s, 'pip', 880, 0.08, 0.22, true);
  sound(t0 + 3.1, 'now', 523, 0.32, 0.3, true);
  goldBell(t0 + 6.0);
  // The lines one after another, so they are logged and said in their order
  // even when a clip is still decoding.
  sayAtClock(['ready'], t0)
    .then(() => sayAtClock(['left', 'cue-balance'], t0 + 3.5))
    .then(() => sayAtClock(['alldone'], t0 + 6.6));
  return t0 - now;
}
