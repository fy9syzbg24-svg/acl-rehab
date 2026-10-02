// Rehab Test v3 (2026-09-30): the exercise sheet. One tap from a Today row's picture, and
// from the player (openExerciseSheet is exported for it).
//
// Why it looks like this (design-pass/v3/DESIGN-LANGUAGE.md, research 09 and 07):
// - The picture beats the name for recognising an exercise (M1, his words 2026-09-30:
//   "I could just recognize what it is"). The sheet opens on the SAME single frame the row
//   shows, grown big; the other frames are a swipe away, so the whole picture is one tap from
//   the list. Frames are crop viewports onto the original file; the file is never touched (K20).
// - The prescription as a few filled facts, the TheraBand as its drawn loop (K1, "things I
//   love"), never a paragraph.
// - Guided (ruling K10): the steps and instructions sit behind one switch that is OFF for
//   exercises he knows ("I probably know how to use most of these exercises now"). It comes on
//   by itself ONCE for an exercise he has never logged, or once when its progression changed.
//   His switch is remembered per exercise on this device (a view preference, never his record).
// - A progression is offered with its source (his rule: every progression names its source);
//   Try it and Not yet are the same two writes Today's open row always made.
// - Motion: where WebKit has View Transitions, the row's picture grows into the sheet and back
//   (shared element); the rest of the sheet rises. Otherwise, and under Reduce Motion or light
//   motion, the ordinary iOS sheet rises. Never a crossfade between screens.

import { switchSupported } from '../feedback.js';
import { esc, todayIso, addDays, durWords } from '../util.js';
import { state, update } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, BAND_BY_ID } from '../../data/program.js';
import { CATEGORIES } from '../../data/measurements.js';
import { exerciseById, pictureFor, openModal, closeModal, toast } from '../components.js';
import { frameOf } from '../frames.js';
import { bandSvg } from '../ptmark.js';
import { catGlyph, catWord } from '../glyphs.js';
import { stepsFor, stepHtml, stageOf } from '../progressions.js';
import { levelOf } from '../logging.js';
import { withGoals } from '../stopwatch.js';
import { loadVideos, videoFor, mountVideo, fillPoster } from '../videos.js';
import { liteMotion } from '../motion.js';
import { reducedMotion } from '../fold.js';
import * as N from '../native-bridge.js';
import { vtStart, vtSupported, vtActive } from '../vt.js';
import { askAtClinic } from '../clinic.js';
import { renderHistory, bindHistory } from './exhistory.js';

const ALL = REHAB_PROGRAM.concat(GYM_PROGRAM);
const itemOf = (pid) => ALL.find((p) => p.id === pid) || null;

// ------------------------------------------------------------ the frames ---
// How each program picture is laid out (measured 2026-09-29, research 07 section 4.3):
// a 2 x 2 grid of numbered steps, or two frames side by side; everything else is one frame.
const GRID = new Set(['01', '03', '04', '07', '08', '09', '10', '11', '12', '13', '15', '16']);
const PAIR = new Set(['02', '05', '06', '14']);
// Pixel width over height of the originals (sips, read only). The program's are 1280 x 720.
const ASPECT = { 'img/program/ex-04.png': 1292 / 975 };
const SLIDE_ASPECT = 1.35;   // the carousel's box, width over height

const baseOf = (src) => {
  const s = String(src || '').split('?')[0];
  const at = s.indexOf('img/');
  return (at >= 0 ? s.slice(at) : s).replace(/-thumb(\.[a-z]+)$/i, '$1');
};

/** The frames of a picture as crops of the file, and which one the row shows. */
export function framesOf(src) {
  const path = baseOf(src);
  const m = /img\/program\/ex-(\d+)\./.exec(path);
  const num = m ? m[1] : null;
  const f = frameOf(src);
  const W = ASPECT[path] || 16 / 9;
  if (num && GRID.has(num)) {
    const crops = [0, 1, 2, 3].map((i) => {
      const qx = i % 2;
      const qy = Math.floor(i / 2);
      // Inset past the printed step number: the full height is kept and the left edge starts
      // past the number's box (up to 0.08 of the file's width in ex-10, audit T25); the
      // bottom stops short of the grid's white margin (ex-04 is white from 0.975, audit T7).
      // Checked on a contact sheet of all 48 quadrants: no number box, no white band.
      const cx = 0.085;
      const cy = 0.02;
      const w = 0.5 - cx - 0.012;
      const h = 0.5 - cy - 0.03;
      return { x: qx * 0.5 + cx, y: qy * 0.5 + cy, w, h, aspect: (W * w) / h };
    });
    const at = f ? ((f.y + f.h / 2) >= 0.5 ? 2 : 0) + ((f.x + f.w / 2) >= 0.5 ? 1 : 0) : 0;
    return { path, crops, at };
  }
  if (num && PAIR.has(num) && f) {
    // A little off the outer edge of each: the clinic's corner logo sits there.
    const w = f.w - 0.02;
    const right = { ...f, w, aspect: f.aspect * (w / f.w) };
    const left = { ...right, x: Math.max(0, f.x - 0.5 + 0.02) };
    return { path, crops: [left, right], at: (f.x + f.w / 2) >= 0.5 ? 1 : 0 };
  }
  // One frame: the trimmed content box when there is one, else the whole picture.
  return { path, crops: [f || null], at: 0 };
}

const pct = (n) => `${Math.round(n * 1e4) / 1e4}%`;
/**
 * A crop shown in a box of aspect A: an inner window the crop's shape, centred, clipped, so
 * nothing outside the crop (the next frame, a printed number) ever shows. Close to the box's
 * shape it fills the box edge to edge; far from it (a tall standing figure) it sits contained
 * on the white tile. Returns { win, img } inline styles.
 */
export function cropStyle(c, A = SLIDE_ASPECT, fill = 0.94) {
  const img = 'position:absolute;max-width:none;max-height:none;border:0;margin:0;pointer-events:none;user-select:none;-webkit-user-drag:none;';
  if (!c) return { win: 'position:absolute;inset:3%;overflow:hidden;', img: `${img}left:0;top:0;width:100%;height:100%;object-fit:contain;` };
  let cw;
  let ch;
  const r = c.aspect / A;
  if (r > 0.8 && r < 1.25) { cw = 100; ch = 100; }
  else if (c.aspect >= A) { cw = 100 * fill; ch = (100 * fill * A) / c.aspect; } else { ch = 100 * fill; cw = (100 * fill * c.aspect) / A; }
  // Filling a box of a slightly different shape: the window is the box, the crop is scaled to cover it.
  let sx = 1 / c.w;
  let sy = 1 / c.h;
  let ox = -c.x / c.w;
  let oy = -c.y / c.h;
  if (cw === 100 && ch === 100) {
    const k = Math.max(1, 1 / r) >= 1 && r < 1 ? 1 / r : r;   // how much wider (or taller) the cover needs
    if (r >= 1) { sx *= r; ox = ox * r - (r - 1) / 2; } else { sy *= k; oy = oy * k - (k - 1) / 2; }
  }
  return {
    win: `position:absolute;overflow:hidden;left:${pct((100 - cw) / 2)};top:${pct((100 - ch) / 2)};width:${pct(cw)};height:${pct(ch)};`,
    img: `${img}left:${pct(ox * 100)};top:${pct(oy * 100)};width:${pct(sx * 100)};height:${pct(sy * 100)};`,
  };
}

// --------------------------------------------------------------- guided ---
const G_ON = 'rt.guided';        // { pid: '1' | '0' } his switch, per exercise
const G_SEEN = 'rt.guided.seen'; // { pid: levelKey } the progression he has already been shown
const readMap = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch { return {}; } };
const writeMap = (k, m) => { try { localStorage.setItem(k, JSON.stringify(m)); } catch { /* a view preference only */ } };

function everLogged(pid) {
  for (const d of Object.values(state.data.days || {})) {
    if ((d.entries || []).some((e) => e.pid === pid && e.logged)) return true;
  }
  return false;
}

/**
 * Guided on or off for this opening, and why. His switch wins. Otherwise ON once for an
 * exercise he has never logged, or once when its progression moved since he last saw it.
 */
function guidedFor(item) {
  const mine = readMap(G_ON)[item.id];
  const level = levelOf(state.data, item) || `stage ${stageOf(item, state.data)}`;
  const seen = readMap(G_SEEN);
  let auto = null;
  if (!everLogged(item.id)) auto = 'new';
  else if (seen[item.id] != null && seen[item.id] !== level) auto = 'changed';
  if (seen[item.id] !== level) { seen[item.id] = level; writeMap(G_SEEN, seen); }
  if (mine === '1') return { on: true, why: null };
  if (mine === '0') return { on: false, why: null };
  return { on: !!auto, why: auto };
}

// --------------------------------------------------------------- facts ----
function factsOf(item, iso) {
  const p = withGoals(state.data, item, iso);
  const out = [];
  // "each side" belongs to the sets, never a fact alone on its own line (audit T8, C4).
  const each = p.sides === 'each' ? ' each side' : '';
  if (p.sets && p.reps && !(p.reps === 1 && p.hold)) out.push(`<b>${p.sets} × ${p.reps}</b>${each}`);
  else if (p.sets) out.push(`<b>${p.sets}</b> set${p.sets === 1 ? '' : 's'}${each}`);
  else if (p.reps) out.push(`<b>${p.reps}</b> reps${each}`);
  else if (each) out.push('Each side');
  if (p.hold) out.push(`Hold <b>${esc(durWords(p.hold))}</b>`);
  if (p.rest) out.push(`Rest <b>${esc(durWords(p.rest))}</b>`);
  if (p.sides === 'left') out.push('<span class="exs-left">Left only</span>');
  else if (p.sides === 'right') out.push('<span class="exs-right">Right only</span>');
  if (p.pace) out.push(`<b>${esc(String(p.pace))}</b> bpm`);
  if (p.goal) out.push(`Goal <b>${esc(String(p.goal))}</b>`);
  const bandId = state.data.program?.band?.[item.id] ?? item.band ?? '';
  const band = bandId ? BAND_BY_ID[bandId] : null;
  if (band) out.push(`<span class="band-mark">${bandSvg(band.swatch)}</span>${esc(band.name)} band`);
  return out;
}

// ------------------------------------------------------ the progression ---
const SNOOZE_DAYS = 7;
function offerFor(item, iso) {
  const sg = item.suggest;
  if (!sg || iso < sg.from) return null;
  const step = stepsFor(item, state.data)[sg.stage - 1];
  if (!step || step.n !== sg.stage - 1) return null;
  if (stageOf(item, state.data) >= sg.stage) return null;
  const snoozed = state.data.program?.seen?.[`suggest:${item.id}:${sg.stage}`];
  if (snoozed && iso < addDays(snoozed, SNOOZE_DAYS)) return null;
  return { sg, step };
}

// ---------------------------------------------------------------- body ----
function slidesHtml(item, pic, label) {
  const fr = framesOf(pic);
  const slides = fr.crops.map((c, i) => `
    <div class="exs-slide" data-i="${i}" role="group" aria-roledescription="slide" aria-label="${esc(fr.crops.length > 1 ? `Step ${i + 1} of ${fr.crops.length}` : label)}">
      <span class="exs-tile">${((st) => `<span style="${st.win}"><img src="${esc(fr.path)}" alt="" draggable="false" decoding="sync" style="${st.img}"></span>`)(cropStyle(c))}</span>
    </div>`);
  return { html: slides.join(''), count: fr.crops.length, at: fr.at };
}

function bodyHtml(item, iso, opts, g) {
  const ex = exerciseById(item.ex);
  const cat = CATEGORIES[ex?.cat];
  const name = item.title || ex?.name || item.ex;
  const pic = item.img || pictureFor(item.ex)?.img || null;
  const vid = videoFor(item.id);
  const s = pic ? slidesHtml(item, pic, name) : { html: '', count: 0, at: 0 };
  const videoSlide = vid ? `<div class="exs-slide exs-vid" data-i="${s.count}" role="group" aria-label="Video">
      <span class="exs-tile dark"><img data-vidposter alt="" class="vid-poster"></span></div>` : '';
  const total = s.count + (vid ? 1 : 0);
  const facts = factsOf(item, iso);
  const steps = stepsFor(item, state.data);
  const stage = stageOf(item, state.data);
  const now = stage > 0 ? steps[stage - 1] : null;
  const offer = offerFor(item, iso);
  const hasGuide = !!((item.steps && item.steps.length) || item.pre || (item.notes && item.notes.length) || item.note);

  return `
    ${total ? `<div class="exs-car" data-exs-car tabindex="0" aria-label="Pictures">${s.html}${videoSlide}</div>
      ${total > 1 ? `<div class="exs-dots" role="tablist">${Array.from({ length: total }, (_, i) => `
        <button type="button" role="tab" data-exs-dot="${i}" class="${i === s.at ? 'on' : ''}${vid && i === s.count ? ' vid' : ''}"
          aria-label="${vid && i === s.count ? 'Video' : `Step ${i + 1}`}" aria-selected="${i === s.at}"></button>`).join('')}</div>` : ''}` : ''}
    <div class="exs-head">
      ${cat ? `<span class="exs-cat" style="--cat:${cat.color}">${catGlyph(ex.cat, 17)}${esc(catWord(ex.cat))}</span>` : ''}
      <h3 class="exs-title">${esc(name)}</h3>
    </div>
    ${facts.length ? `<div class="exs-facts">${facts.map((f) => `<span class="exs-fact">${f}</span>`).join('')}</div>` : ''}
    ${opts.pane && opts.onBegin && !item.notYet ? '<button type="button" class="btn primary big exs-begin exs-begin-pane" data-exs-begin>Begin</button>' : ''}
    ${now ? `<div class="exs-level"><span class="exs-k">Your step</span><span class="exs-v">${stepHtml(now)}</span></div>` : ''}
    ${offer ? `<div class="exs-offer" data-step-key="${esc(`${item.id}:${offer.sg.stage}`)}">
        <span class="exs-k">Next step</span>
        <span class="exs-v">${stepHtml(offer.step)}</span>
        <span class="exs-offer-btns">
          <button type="button" class="btn sm" data-exs-not>Not yet</button>
          <button type="button" class="btn sm primary" data-exs-try>Try it</button>
        </span>
      </div>` : ''}
    ${opts.pane ? `<section class="exs-hist" data-exs-hist>${renderHistory(state.data, item, iso)}</section>` : ''}
    ${hasGuide ? `<div class="exs-guide ${g.on ? 'on' : ''}">
      <label class="exs-switch">
        <span class="exs-sw-t">Guided${g.on && g.why === 'new' ? '<span class="exs-new">New</span>' : ''}${g.on && g.why === 'changed' ? '<span class="exs-new">New step</span>' : ''}</span>
        <input type="checkbox" ${switchSupported() ? 'switch' : 'switch class="sw-knob"'} data-exs-guided ${g.on ? 'checked' : ''} aria-label="Guided: steps and instructions">
      </label>
      ${g.on ? guideHtml(item) : ''}
    </div>` : ''}
    <button type="button" class="exs-ask" data-exs-ask>${ASK_GLYPH}<span>Ask at the clinic</span></button>`;
}

// A speech bubble with a question mark: his questions for the clinic (round 3, A9).
const ASK_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/><path d="M10.2 9.4a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M12 14.6v.1"/></svg>';

// ------------------------------------------------ the next step turns face up ---
// Round 3, A12 (research 11c 22): the first time a sourced next step is offered for an
// exercise, its card arrives face down and turns face up (rotateY 180 to 0, a 500 ms spring)
// with a short rising haptic. Later openings show it face up at once. No sparkle, no gold:
// nothing is finished yet. "Not yet" and "Try it" are unchanged and stay his decision.
// Which steps he has seen turn over is a view preference on this device ('rt.stepseen').
const STEP_SEEN = 'rt.stepseen';
export function revealStep(el, key) {
  if (!el || !key) return false;
  const seen = readMap(STEP_SEEN);
  if (seen[key]) return false;
  seen[key] = todayIso();
  writeMap(STEP_SEEN, seen);
  N.hapticScore([
    { t: 0, type: 'tap', intensity: 0.35, sharpness: 0.3 },
    { t: 0.12, type: 'tap', intensity: 0.55, sharpness: 0.45 },
    { t: 0.26, type: 'tap', intensity: 0.85, sharpness: 0.7 },
  ]);
  if (reducedMotion() || liteMotion() || !el.animate) return true;
  el.style.transformOrigin = '50% 50%';
  el.animate([
    { transform: 'perspective(700px) rotateY(180deg)', filter: 'brightness(.6)', offset: 0 },
    { transform: 'perspective(700px) rotateY(90deg)', filter: 'brightness(.8)', offset: 0.45 },
    { transform: 'perspective(700px) rotateY(-8deg)', filter: 'none', offset: 0.8 },
    { transform: 'perspective(700px) rotateY(0deg)', filter: 'none' },
  ], { duration: 520, easing: 'cubic-bezier(.2, .9, .3, 1)' });
  return true;
}

function guideHtml(item) {
  return `<div class="exs-guide-body">
    ${item.pre ? `<p class="exs-pre">${esc(item.pre)}</p>` : ''}
    ${item.steps?.length ? `<ol class="exs-steps">${item.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    ${item.note ? `<p class="exs-note">${esc(item.note)}</p>` : ''}
    ${item.notes?.length ? `<div class="exs-notes">${item.notes.map(esc).join('<br>')}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------- opening ----
let current = null;

/**
 * Open the exercise sheet for a program item.
 *   pid       the program item id (REHAB_PROGRAM or GYM_PROGRAM)
 *   from      the element the picture grows out of (a row's picture, the player's picture)
 *   iso       the day it is read for (goals, offers); today by default
 *   onBegin   when given, a Begin button starts the exercise (Today passes it; the player not)
 *   onChange  called after a write made from the sheet (a progression tried or snoozed)
 */
export function openExerciseSheet(pid, { from = null, iso = todayIso(), onBegin = null, onChange = null } = {}) {
  const item = itemOf(pid);
  if (!item) return null;
  const ex = exerciseById(item.ex);
  const name = item.title || ex?.name || item.ex;
  const g = guidedFor(item);
  const fromTile = from ? (from.matches?.('.frame-tile') ? from : from.querySelector?.('.frame-tile, img')) || from : null;
  // One transition at a time: while another runs (a quick close then open), a plain sheet.
  const canVT = !!(fromTile && fromTile.isConnected && vtSupported() && !vtActive() && !reducedMotion() && !liteMotion());
  document.querySelectorAll('[data-vt="expic"]').forEach((x) => x.removeAttribute('data-vt'));

  let back = null;
  const mount = () => {
    back = openModal({
      title: name,
      body: bodyHtml(item, iso, { onBegin }, g),
      footer: onBegin && !item.notYet ? '<button class="btn primary big exs-begin" data-exs-begin>Begin</button>' : '',
      onMount(root) { root.classList.add('exs-back'); root.querySelector('.modal')?.classList.add('exs'); },
    });
    wire(back, item, iso, { onBegin, onChange, fromTile });
    const car = back.querySelector('[data-exs-car]');
    const at = Number(back.querySelector('.exs-dots .on')?.dataset.exsDot || 0);
    if (car && at) car.scrollLeft = at * car.clientWidth;
    return car?.querySelector(`.exs-slide[data-i="${at}"] .exs-tile`) || null;
  };

  N.haptic('light');
  if (!canVT) { mount(); current = { back, fromTile: null }; return back; }
  // Shared element through js/vt.js (one transition at a time, the page cut, never a
  // crossfade): the row's picture is "expic", the sheet itself "exsheet", which rises.
  document.documentElement.classList.add('exs-vt', 'exs-in');
  const done = () => document.documentElement.classList.remove('exs-vt', 'exs-in');
  vtStart(async () => {
    const tile = mount();
    back.querySelector('.modal')?.setAttribute('data-vt', 'exsheet');
    tile?.setAttribute('data-vt', 'expic');
    // The new picture must be decoded before the new state is captured, or the growing
    // picture is a blank white tile (seen in the simulator). The file is the row's own, so
    // this is quick; never more than 160 ms.
    const img = tile?.querySelector('img');
    if (img && !img.complete) await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 160))]);
    else if (img?.decode) await Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 160))]);
  }, { expic: fromTile, exsheet: null }, { dir: 0 }).then(() => setTimeout(() => {
    back?.querySelectorAll('[data-vt]').forEach((x) => x.removeAttribute('data-vt'));
    done();
  }, 520), done);
  current = { back, fromTile };
  return back;
}

/** Close, the picture shrinking back into the row when it can. */
function closeSheet(back, fromTile) {
  const modal = back?.querySelector('.modal');
  const dragged = !!modal && (modal.classList.contains('dragging') || !!modal.style.transform);
  const car = back?.querySelector('[data-exs-car]');
  const i = car ? Math.round(car.scrollLeft / Math.max(1, car.clientWidth)) : 0;
  const tile = car?.querySelector(`.exs-slide[data-i="${i}"]:not(.exs-vid) .exs-tile`);
  const ok = !dragged && fromTile?.isConnected && tile && vtSupported() && !vtActive() && !reducedMotion() && !liteMotion()
    && (() => { const r = fromTile.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; })();
  if (!ok) { closeModal(); return; }
  document.documentElement.classList.add('exs-vt', 'exs-out');
  const done = () => { fromTile.removeAttribute('data-vt'); document.documentElement.classList.remove('exs-vt', 'exs-out'); };
  vtStart(() => {
    closeModal({ fade: false });
    fromTile.setAttribute('data-vt', 'expic');
  }, { expic: tile, exsheetout: modal }, { dir: 0 }).then(() => setTimeout(done, 520), done);
}

function wire(back, item, iso, { onBegin, onChange, fromTile }) {
  // Close: X, the backdrop, or a drag down (native.js clicks X after the drag).
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) {
      e.stopPropagation();
      e.preventDefault();
      closeSheet(back, fromTile);
    }
  }, true);

  // Focus the sheet itself, not its first control: a focused switch drew a ring he never asked for.
  setTimeout(() => { if (back.isConnected) back.querySelector('.modal')?.focus({ preventScroll: true }); }, 60);

  wireBody(back, item, iso, {
    onChange,
    afterTry: () => { closeModal(); onChange?.(); },
    begin: (ev) => { closeModal({ fade: false }); onBegin?.(ev); },
  });
}

/**
 * The wiring every copy of the exercise body shares: the sheet on a phone and the trailing pane
 * on an iPad (mountExercisePane). `afterTry` is what happens after Try it (the sheet closes, the
 * pane repaints), `begin` what Begin does.
 */
function wireBody(back, item, iso, { onChange, afterTry, begin }) {
  // The carousel: dots follow the swipe; a dot jumps. Selection haptic per step.
  const car = back.querySelector('[data-exs-car]');
  const dots = [...back.querySelectorAll('[data-exs-dot]')];
  if (car && dots.length) {
    let last = Number(back.querySelector('.exs-dots .on')?.dataset.exsDot || 0);
    car.addEventListener('scroll', () => {
      const i = Math.round(car.scrollLeft / Math.max(1, car.clientWidth));
      if (i === last) return;
      last = i;
      dots.forEach((d, k) => { d.classList.toggle('on', k === i); d.setAttribute('aria-selected', String(k === i)); });
      N.haptic('selection');
    }, { passive: true });
    dots.forEach((d) => d.addEventListener('click', () => {
      car.scrollTo({ left: Number(d.dataset.exsDot) * car.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }));
  }
  // The video, when there is one, plays in its slide from its see through play mark.
  loadVideos().then(() => {
    const box = back.querySelector('.exs-vid .exs-tile');
    const img = box?.querySelector('img');
    if (!box || !img) return;
    fillPoster(img, item.id);
    mountVideo(box, img, item.id);
  });

  back.querySelector('[data-exs-guided]')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    const m = readMap(G_ON);
    m[item.id] = on ? '1' : '0';
    writeMap(G_ON, m);
    const wrap = back.querySelector('.exs-guide');
    wrap?.classList.toggle('on', on);
    wrap?.querySelector('.exs-new')?.remove();
    const old = wrap?.querySelector('.exs-guide-body');
    if (on && wrap && !old) {
      wrap.insertAdjacentHTML('beforeend', guideHtml(item));
      const body = wrap.querySelector('.exs-guide-body');
      body?.animate?.([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22, 1.05, .36, 1)' });
    } else if (!on && old) old.remove();
  });

  // The progression offer: the same two writes Today's open row makes.
  back.querySelector('[data-exs-try]')?.addEventListener('click', () => {
    const o = offerFor(item, iso);
    if (!o) return;
    update((d) => { (d.program.stage ||= {})[item.id] = o.sg.stage; });
    toast(`<b>${stepHtml(o.step)}</b>`);
    afterTry();
  });
  back.querySelector('[data-exs-not]')?.addEventListener('click', () => {
    if (!item.suggest) return;
    update((d) => { (d.program.seen ||= {})[`suggest:${item.id}:${item.suggest.stage}`] = iso; });
    back.querySelector('.exs-offer')?.remove();
    onChange?.();
  });
  // The next step turns face up the first time it is offered (A12), once the sheet has risen.
  const offerEl = back.querySelector('.exs-offer[data-step-key]');
  if (offerEl) {
    const seen = readMap(STEP_SEEN)[offerEl.dataset.stepKey];
    if (!seen && !reducedMotion() && !liteMotion()) offerEl.style.transform = 'perspective(700px) rotateY(180deg)';
    setTimeout(() => { offerEl.style.transform = ''; revealStep(offerEl, offerEl.dataset.stepKey); }, 380);
  }
  back.querySelector('[data-exs-ask]')?.addEventListener('click', () => {
    const ex = exerciseById(item.ex);
    askAtClinic({ kind: 'ex', id: item.id, label: item.title || ex?.name || item.ex });
  });
  back.querySelector('[data-exs-begin]')?.addEventListener('click', (ev) => begin(ev));
}

// For the player and for tests: is a sheet open right now.
export const exerciseSheetOpen = () => !!current?.back?.isConnected;

// ------------------------------------------------------------ the pane -----
// iPad (regular width, 2026-09-30, his words: "the iPad layout should probably be a bit more
// robust and capable than the iPhone one, or at least show things at a lot easier flow"): the
// same exercise body, drawn in a trailing pane beside Today's list instead of a sheet over it.
// It holds what the sheet holds (the frames, the prescription, his step, a sourced next step,
// the guided steps behind their one switch, Ask at the clinic) plus Begin, and the exercise's
// own history (Target, this session, last session, best load) that the phone keeps in the
// open row. Nothing is written by drawing it; the two writes it can make (Try it, Not yet)
// are the sheet's own, through the same wiring. Rule: the pane is only ever mounted where the
// page shows it (rt-today.css), and the sheet stays the way in on a phone and in a narrow window.
/**
 * Draw an exercise into `host` (the pane element). Returns true when it drew something.
 *   pid       the program item id
 *   iso       the day it is read for
 *   onBegin   Begin starts the exercise (Today passes it)
 *   onChange  called after a write made here (Try it, Not yet)
 *   animate   settle the new content in (a different exercise was picked)
 */
export function mountExercisePane(host, pid, { iso = todayIso(), onBegin = null, onChange = null, animate = false } = {}) {
  const item = itemOf(pid);
  if (!host || !item) return false;
  const g = guidedFor(item);
  const keepScroll = host.dataset.pid === pid ? host.scrollTop : 0;
  host.dataset.pid = pid;
  host.innerHTML = `<div class="exs-pane-in">${bodyHtml(item, iso, { pane: true, onBegin }, g)}</div>`;
  const inner = host.firstElementChild;
  wireBody(inner, item, iso, {
    onChange,
    afterTry: () => { onChange?.(); mountExercisePane(host, pid, { iso, onBegin, onChange }); },
    begin: (ev) => onBegin?.(ev),
  });
  bindHistory(inner);
  const car = inner.querySelector('[data-exs-car]');
  const at = Number(inner.querySelector('.exs-dots .on')?.dataset.exsDot || 0);
  if (car && at) car.scrollLeft = at * car.clientWidth;
  host.scrollTop = keepScroll;
  if (animate && inner.animate && !reducedMotion() && !liteMotion()) {
    // Transform only, arriving (never a crossfade of two screens): the new exercise settles up.
    inner.animate([{ transform: 'translateY(14px) scale(.985)', opacity: 0.35 }, { transform: 'none', opacity: 1 }],
      { duration: 420, easing: 'cubic-bezier(.22, 1.05, .36, 1)' });
  }
  return true;
}

/** A tick changed today's numbers: repaint only the history block, so the pane keeps its place. */
export function refreshPaneHistory(host, iso = todayIso()) {
  const item = itemOf(host?.dataset?.pid);
  const sec = host?.querySelector('[data-exs-hist]');
  if (!item || !sec) return false;
  sec.innerHTML = renderHistory(state.data, item, iso);
  bindHistory(sec);
  return true;
}
