// The workout's Live Activity (Lock Screen and Dynamic Island), Rehab Test v3.
//
// The page keeps the workout clock (engine.js); this file only tells the native
// app what the clock is doing, through native-bridge.js (design-pass/v3/CONTRACT.md):
//   live.start   when a workout opens (never when Settings > Rehab Test turned it off:
//                localStorage 'rt.live.off' = '1')
//   live.update  at every change of step, leg, set, pause or resume; never on a tick,
//                because the countdown itself runs natively from phaseEnd
//                (Text(timerInterval:)), so nothing is sent every second
//   live.plan    the timed steps ahead of a running clock, so Swift can move the
//                activity through them while the page sleeps; rest end alerts ride
//                on it only when 'rt.notify.restEnd' is '1' (off until he says)
//   live.end     with the finished state when the workout ends or is left
// And back: a Live Activity button (Pause or Next) reaches the page as a window
// 'rt-live' event while the page is alive, or waits in live.pending until the app
// wakes ('rt-wake'); each is handed to the player with the wall time it was pressed,
// and the player replays it through the engine at that time.
//
// His rules this keeps: no medicine name, dose, level or weight ever goes on a Live
// Activity (a workout carries only exercise words, legs, sets and times). One
// activity at a time, replaced as the exercise changes, never stacked. Every call
// resolves to null without the app or on an older build, and then nothing happens:
// the player works exactly as before.

import { call, liveStart, liveUpdate, liveEnd, livePending, liveAck, pref, PREF_LIVE, PREF_REST_END } from '../native-bridge.js';

const ID_KEY = 'rt.live.id';
const ACK_KEY = 'rt.live.acked';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* per device */ } },
};

/** On unless he turned it off in Settings (default on, CONTRACT.md). */
export const liveOn = () => !pref(PREF_LIVE);

let id = store.get(ID_KEY);          // the running activity, kept across a reload
let starting = null;                 // a start in flight, so two syncs never start two
let last = null;                     // the state last sent
let lastPlan = null;                 // the plan last sent, as a key

/** Same state, give or take the clock's own drift: nothing new to show. */
function sameState(a, b) {
  if (!a || !b) return false;
  for (const k of Object.keys({ ...a, ...b })) {
    if (k === 'phaseEnd' || k === 'phaseStart') {
      const x = a[k]; const y = b[k];
      if ((x == null) !== (y == null)) return false;
      if (x != null && Math.abs(x - y) > 1500) return false;
    } else if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Bring the activity in line with the player. `spec` is
 *   { title, accent, state, plan: [{ kind, secs, exercise, leg, set, sets, reps }] | null }
 * built by player.js from the engine. Safe to call as often as the screen refreshes.
 */
export async function sync(spec) {
  if (!spec?.state) return;
  if (!liveOn()) { if (id) await end(spec.state, 0); return; }
  if (!id) {
    if (starting) { await starting; }
    else {
      starting = liveStart({ kind: 'workout', title: spec.title, accent: spec.accent, state: spec.state })
        .then((r) => {
          if (r && r.id) { id = String(r.id); store.set(ID_KEY, id); last = spec.state; lastPlan = null; }
          return r;
        })
        .finally(() => { starting = null; });
      await starting;
      if (id) await plan(spec);
      return;
    }
  }
  if (!id) return;
  if (!sameState(last, spec.state)) {
    last = spec.state;
    const ok = await liveUpdate(id, spec.state);
    // The system ended it (eight hours, or he swiped it away): start again next sync.
    if (ok === false) { id = null; store.set(ID_KEY, null); last = null; return; }
  }
  await plan(spec);
}

async function plan(spec) {
  if (!id) return;
  const steps = spec.plan || [];
  const key = JSON.stringify(steps.map((s) => [s.kind, Math.round(s.secs), s.leg, s.set]));
  // A plan is re-sent when its steps change; the first step's length drifts with
  // the clock, so a resend is also due once it moved more than a second and a half.
  const endsAt = steps.length ? Date.now() + steps[0].secs * 1000 : 0;
  if (lastPlan && lastPlan.key === key && Math.abs(lastPlan.endsAt - endsAt) < 1500) return;
  lastPlan = { key, endsAt };
  await call('live.plan', { id, steps, fromWallMs: Date.now(), notifyRestEnd: pref(PREF_REST_END) });
}

/** The workout ended or was left: the finished state, then gone after `dismissAfterSec`. */
export async function end(state, dismissAfterSec = 900) {
  if (starting) await starting;
  if (!id) return;
  const was = id;
  id = null;
  last = null;
  lastPlan = null;
  store.set(ID_KEY, null);
  await liveEnd(was, state || { phase: 'done' }, dismissAfterSec);
}

/**
 * The player's handler for a Live Activity button: fn(cmd, wallMs), cmd 'toggle'
 * (Pause or Resume) or 'next'. Commands pressed while the page slept are drained
 * on wake, oldest first, and each is applied once (acknowledged by its time).
 */
export function onCommand(fn) {
  let acked = Number(store.get(ACK_KEY)) || 0;
  const take = (cmd, wallMs) => {
    const t = Number(wallMs) || Date.now();
    if (t <= acked) return;
    acked = t;
    store.set(ACK_KEY, t);
    try { fn(String(cmd || ''), t); } catch (err) { console.warn('[live] command', cmd, err); }
  };
  window.addEventListener('rt-live', (e) => take(e.detail?.cmd, e.detail?.wallMs));
  const drain = async () => {
    const list = await livePending();
    if (!Array.isArray(list) || !list.length) return;
    let upTo = 0;
    for (const c of list.slice().sort((a, b) => (a.wallMs || 0) - (b.wallMs || 0))) {
      take(c.cmd, c.wallMs);
      upTo = Math.max(upTo, Number(c.wallMs) || 0);
    }
    if (upTo) await liveAck(upTo);
  };
  window.addEventListener('rt-wake', drain);
  // A command pressed before this page loaded at all.
  setTimeout(drain, 800);
}

/** A CSS colour (any form, var() included) as #rrggbb for the native side, or null. */
export function hexOf(css, host = document.body) {
  try {
    const probe = document.createElement('i');
    probe.style.cssText = `position:absolute;visibility:hidden;color:${css}`;
    host.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    // rgb(r, g, b) in 0 to 255, or color(srgb r g b) in 0 to 1 (a color-mix result).
    const unit = /^color\(/.test(rgb);
    const m = rgb.replace(/^color\(\s*[a-z0-9-]+/i, '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    const c = (n) => Math.max(0, Math.min(255, Math.round(Number(n) * (unit ? 255 : 1))));
    return `#${m.slice(0, 3).map((n) => c(n).toString(16).padStart(2, '0')).join('')}`;
  } catch { return null; }
}
