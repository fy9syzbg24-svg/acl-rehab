// Rehab Test round 3 (2026-09-30): the clinic day card, "Since the last visit" and his
// questions for the clinic. design-pass/research/11-features-to-build.md A9.
//
// Why: the clinic twice a week in October, the physio's review on 23 Oct. The questions that are "his
// to ask" lived in Claude's files, not in his pocket at the clinic. This only helps HIM ask:
// Claude never contacts his clinicians, and nothing here is sent anywhere.
//
// Rules kept here:
//   - "Since the last visit" is only his record, each line dated, numbers exactly as logged
//     (never rounded, never estimated). Nothing about supplements, GLP-1, weight, cravings or
//     the ring: he chooses what a clinician sees.
//   - His questions live in rtlocal.js 'asks' (extras.asks in his synced record since 2026-09-30).
//     Nothing is deleted: a swipe hides a question, with Undo.
//   - An answer is his words. Nothing is changed from the answer text; a new step or load goes
//     in through the program's own entry, with its source, as always.
//   - Show hands the phone across: the "since" part big, his questions left out, the tab bar
//     hidden (the shell hides it while a sheet is up).

import { esc, todayIso, addDays, fmtDateShort, fmtDate, uid } from './util.js';
import { state } from './store.js';
import { local } from './rtlocal.js';
import { REHAB_PROGRAM, GYM_PROGRAM, isClinicDay } from '../data/program.js';
import { MEASURE_BY_ID } from '../data/measurements.js';
import { FIRST_ITEMS, anchorFirst } from './firstup.js';
import { exerciseById, pictureFor, openModal, closeModal, actionToast, fmtMeasure } from './components.js';
import { frameHtml } from './frames.js';
import { bandMark } from './ptmark.js';
import { onSwipe } from './swipe.js';
import * as N from './native-bridge.js';

const ALL = REHAB_PROGRAM.concat(GYM_PROGRAM);
const FIRST_IDS = new Set(FIRST_ITEMS.map((p) => p.id));

// ------------------------------------------------------------------ asks ---
/** His questions, open first (oldest first), then asked (newest answer first). Hidden ones left out. */
export function openAsks() {
  const all = local.list('asks');
  return all.filter((a) => !a.askedIso).concat(all.filter((a) => a.askedIso).sort((a, b) => (a.askedIso < b.askedIso ? 1 : -1)));
}
const openCount = () => local.list('asks').filter((a) => !a.askedIso).length;

function allAsks() { return local.get('asks', []) || []; }
function saveAsks(list) { return local.set('asks', list); }
function patchAsk(id, patch) {
  const list = allAsks();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return false;
  list[i] = { ...list[i], ...patch };
  return saveAsks(list);
}

/** Add one question. `ref` ties it to an exercise, a test or a plan marker: { kind, id, label }. */
export function addAsk(text, ref = null) {
  const t = String(text || '').trim();
  if (!t) return null;
  const a = { id: uid(), text: t, ref: ref || null, createdMs: Date.now(), askedIso: null, answer: '', hidden: false };
  return saveAsks(allAsks().concat(a)) ? a : null;
}

/**
 * "Ask at the clinic" from anywhere (the exercise sheet, a plan marker, a region sheet): a
 * one line field, prefilled with nothing, tied to that item. "Added · Undo" on return.
 */
export function askAtClinic(ref = null, { onDone = null } = {}) {
  const back = openModal({
    title: 'Ask at the clinic',
    body: `<div class="ask-new">
      ${ref?.label ? `<div class="ask-ref">${refPic(ref, 36)}<span>${esc(ref.label)}</span></div>` : ''}
      <input type="text" class="ask-field" data-ask-text maxlength="200" enterkeyhint="done" aria-label="Your question" autocomplete="off">
    </div>`,
    footer: '<button class="btn primary big ask-add" data-ask-add>Add</button>',
    onMount(root) { root.querySelector('.modal')?.classList.add('ask-modal'); },
  });
  const field = back.querySelector('[data-ask-text]');
  const add = () => {
    const a = addAsk(field.value, ref);
    if (!a) { field.focus(); return; }
    closeModal();
    N.haptic('success');
    actionToast('<b>Added</b>', 'Undo', () => { patchAsk(a.id, { hidden: true, hiddenMs: Date.now() }); onDone?.(); }, { key: 'ask-undo' });
    onDone?.();
  };
  back.querySelector('[data-ask-add]')?.addEventListener('click', add);
  field?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  setTimeout(() => field?.focus(), 80);
}

function refPic(ref, size = 40) {
  if (!ref || ref.kind !== 'ex') return '';
  const item = ALL.find((p) => p.id === ref.id);
  const src = item?.img || pictureFor(item?.ex)?.img;
  return src ? frameHtml(src, { size, radius: 10 }) : '';
}

// -------------------------------------------------------- the last visit ---
/** The clinic day before `iso`, looking back at most 120 days, or null. */
export function prevClinicDay(iso) {
  for (let i = 1; i <= 120; i++) {
    const d = addDays(iso, -i);
    if (isClinicDay(state.data, d)) return d;
  }
  return null;
}

/** Everything in his record from the day after the last visit to the day before this one. */
export function sinceLastVisit(iso) {
  const prev = prevClinicDay(iso);
  const from = prev ? addDays(prev, 1) : addDays(iso, -14);
  const to = addDays(iso, -1);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const doc = state.data;
  const tendonDays = days.filter((d) => anchorFirst(doc, d)).length;

  // Every other exercise logged in the span: the latest time it was done, as logged.
  const byKey = new Map();
  for (const d of days) {
    for (const e of doc.days?.[d]?.entries || []) {
      if (!e.logged || !e.ex || FIRST_IDS.has(e.pid)) continue;
      const key = e.pid || `ex:${e.ex}`;
      const cur = byKey.get(key) || { key, pid: e.pid || null, ex: e.ex, days: new Set(), last: null, rows: [] };
      cur.days.add(d);
      if (!cur.last || d >= cur.last) {
        if (cur.last !== d) cur.rows = [];
        cur.last = d;
        cur.rows.push(e);
      }
      byKey.set(key, cur);
    }
  }
  const exercises = [...byKey.values()].sort((a, b) => (a.last < b.last ? 1 : -1));

  const tests = (doc.measurements || [])
    .filter((m) => m.date >= from && m.date <= to && m.measure !== 'bodyweight' && MEASURE_BY_ID[m.measure])
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const notes = days.filter((d) => (doc.days?.[d]?.notes || '').trim()).map((d) => ({ iso: d, text: doc.days[d].notes.trim() })).reverse();
  return { prev, from, to, days: days.length, tendonDays, exercises, tests, notes };
}

/** "3 × 10 · 12 lb · hold 30 s", exactly as logged, one side or both. */
function asLogged(rows) {
  const e = rows.find((r) => r.side === 'B') || rows[0];
  const bits = [];
  if (e.sets && e.reps) bits.push(`${e.sets} × ${e.reps}`);
  else if (e.reps) bits.push(`${e.reps} reps`);
  else if (e.sets) bits.push(`${e.sets} sets`);
  if (e.load) bits.push(`${e.load} ${e.loadUnit || state.data.settings?.weightUnit || ''}`.trim());
  if (e.secs) bits.push(`hold ${e.secs} s`);
  if (e.time) bits.push(`${e.time} min`);
  const sides = new Set(rows.map((r) => r.side || 'B'));
  if (sides.has('L') && !sides.has('R')) bits.push('<span class="cl-l">L</span>');
  if (sides.has('R') && !sides.has('L')) bits.push('<span class="cl-r">R</span>');
  return bits.map((b) => `<span class="td-nw">${b.startsWith('<') ? b : esc(b)}</span>`).join(' · ');
}

function sinceHtml(s, big = false) {
  const span = s.prev ? `Since ${fmtDateShort(s.prev)}` : 'Last 14 days';
  const ex = s.exercises.map((x) => {
    const item = x.pid ? ALL.find((p) => p.id === x.pid) : null;
    const exo = exerciseById(x.ex);
    const name = item?.title || exo?.name || x.ex;
    const src = item?.img || pictureFor(x.ex)?.img;
    const band = bandMark(x.rows.find((r) => r.band || r.bands) || null, { usesBand: false });
    return `<li class="cl-ex">
      ${src ? frameHtml(src, { size: big ? 56 : 40, radius: 10 }) : '<span class="cl-nopic"></span>'}
      <span class="cl-ext"><span class="cl-exn">${esc(name)}${band ? `<span class="rt-nw">${band}</span>` : ''}</span>
        <span class="cl-exs">${asLogged(x.rows)}${asLogged(x.rows) ? ' · ' : ''}<span class="td-nw">${esc(fmtDateShort(x.last))}</span>${x.days.size > 1 ? ` · <span class="td-nw">${x.days.size} days</span>` : ''}</span></span>
    </li>`;
  }).join('');
  const tests = s.tests.map((m) => {
    const def = MEASURE_BY_ID[m.measure];
    const leg = m.leg === 'L' ? '<span class="cl-l">L</span>' : m.leg === 'R' ? '<span class="cl-r">R</span>' : '';
    return `<li class="cl-test"><span class="cl-testn">${esc(def.label)}</span>
      <span class="cl-tests">${leg}<b>${esc(fmtMeasure(m))}</b> · ${esc(fmtDateShort(m.date))}${m.src ? ` · ${esc(m.src)}` : ''}</span></li>`;
  }).join('');
  const notes = s.notes.map((n) => `<li class="cl-note"><span class="cl-noted">${esc(fmtDateShort(n.iso))}</span><q>${esc(n.text)}</q></li>`).join('');
  const nothing = !s.exercises.length && !s.tests.length && !s.notes.length && !s.tendonDays;
  return `<section class="cl-since${big ? ' big' : ''}">
    <h3 class="cl-h">${esc(span)}</h3>
    ${nothing ? '<p class="cl-empty">Nothing logged</p>' : `
    <div class="cl-tendon"><b>${s.tendonDays}</b><span>of ${s.days} day${s.days === 1 ? '' : 's'}</span><small>Tendon loading</small></div>
    ${ex ? `<ul class="cl-list">${ex}</ul>` : ''}
    ${tests ? `<h4 class="cl-sub">Tests</h4><ul class="cl-list">${tests}</ul>` : ''}
    ${notes ? `<h4 class="cl-sub">Your notes</h4><ul class="cl-list">${notes}</ul>` : ''}`}
  </section>`;
}

// ---------------------------------------------------------------- strip ---
/** The slim clinic row under Today's head, on a clinic day only. */
export function clinicStripHtml(iso) {
  if (!isClinicDay(state.data, iso)) return '';
  const prev = prevClinicDay(iso);
  const n = openCount();
  return `<button class="td-clinic" data-clinic="${esc(iso)}" aria-label="Clinic visit: since ${esc(prev ? fmtDateShort(prev) : 'the last 14 days')}${n ? `, ${n} to ask` : ''}">
    <span class="tdc-glyph" aria-hidden="true">${CLIPBOARD}</span>
    <span class="tdc-t">${esc(prev ? `Since ${fmtDateShort(prev)}` : 'Last 14 days')}</span>
    ${n ? `<span class="tdc-ask">${n} to ask</span>` : '<span class="tdc-ask plain">Ask at the clinic</span>'}
    <svg class="tdc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
  </button>`;
}

/**
 * r3fix TS-09 (2026-09-30): on a clinic day with home exercises left, the hero's own headline
 * "Clinic day" is the way in, so the slim row no longer pushes the list down 52 pt (the list
 * starts where it does on any day, DESIGN-LANGUAGE "first exercise row at or above y 230").
 * The words stay the headline; a small count of open questions (or a chevron) trails them,
 * the Apple title-with-chevron pattern. The slim row stays for a finished or rest clinic day.
 */
export function clinicHeadHtml(iso) {
  if (!isClinicDay(state.data, iso)) return '';
  const prev = prevClinicDay(iso);
  const n = openCount();
  const trail = n
    ? `<span class="tdc-n"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/></svg>${n}</span>`
    : '<svg class="tdc-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  return `<button type="button" class="td-clinicword" data-clinic="${esc(iso)}" aria-label="Clinic day. Since ${esc(prev ? fmtDateShort(prev) : 'the last 14 days')}${n ? `, ${n} to ask` : ''}. Open the clinic visit">Clinic day${trail}</button>`;
}

const CLIPBOARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 13.5h7M8.5 17h4"/></svg>';

// ---------------------------------------------------------------- sheet ---
function asksHtml() {
  const list = openAsks();
  return `<section class="cl-asks">
    <h3 class="cl-h">To ask</h3>
    <input type="text" class="ask-field" data-ask-quick maxlength="200" enterkeyhint="done" placeholder="A question for the clinic" aria-label="Add a question" autocomplete="off">
    <ul class="cl-alist">${list.map((a) => `
      <li class="cl-ask${a.askedIso ? ' asked' : ''}" data-ask="${esc(a.id)}">
        <input type="checkbox" class="tick" data-ask-tick ${a.askedIso ? 'checked' : ''} aria-label="Asked: ${esc(a.text)}">
        <span class="cl-askt">
          <span class="cl-askq">${refPic(a.ref, 30)}<span>${esc(a.text)}</span></span>
          ${a.askedIso ? `<input type="text" class="cl-ans" data-ask-answer value="${esc(a.answer || '')}" placeholder="Answer" aria-label="Answer, in your words" maxlength="300">` : ''}
        </span>
      </li>`).join('')}</ul>
  </section>`;
}

/** The clinic sheet: since the last visit, and his questions. */
export function openClinicSheet(iso, { repaint = null } = {}) {
  const s = sinceLastVisit(iso);
  const back = openModal({
    title: iso === todayIso() ? 'Clinic visit' : `Clinic visit, ${fmtDate(iso, 'dow')}`,
    body: `<button type="button" class="cl-showbtn" data-cl-show>Show</button>${sinceHtml(s)}<div data-cl-asks>${asksHtml()}</div>`,
    onMount(root) {
      const m = root.querySelector('.modal');
      m?.classList.add('cl-modal');
      // r3fix TS-06: the sheet opens for reading. The sheet itself takes focus (as the show
      // sheet does), so the "To ask" field never raises the keyboard over the since list.
      m?.focus({ preventScroll: true });
      // Show sits in the sheet's own header, trailing, where iOS puts a sheet's action.
      const btn = root.querySelector('[data-cl-show]');
      const head = root.querySelector('.modal > header');
      if (btn && head) head.appendChild(btn);
    },
  });
  const wireAsks = () => {
    const box = back.querySelector('[data-cl-asks]');
    if (!box) return;
    const redraw = () => { box.innerHTML = asksHtml(); wireAsks(); repaint?.(); };
    box.querySelector('[data-ask-quick]')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (addAsk(e.target.value)) { N.haptic('light'); redraw(); box.querySelector('[data-ask-quick]')?.focus(); }
    });
    box.querySelectorAll('[data-ask]').forEach((li) => {
      const id = li.dataset.ask;
      li.querySelector('[data-ask-tick]')?.addEventListener('change', (e) => {
        patchAsk(id, { askedIso: e.target.checked ? todayIso() : null });
        N.haptic(e.target.checked ? 'success' : 'light');
        redraw();
      });
      li.querySelector('[data-ask-answer]')?.addEventListener('change', (e) => patchAsk(id, { answer: e.target.value.trim() }));
      // A swipe hides the question (never deleted), with Undo.
      onSwipe(li, {
        left: () => {
          if (!patchAsk(id, { hidden: true, hiddenMs: Date.now() })) return;
          redraw();
          actionToast('<b>Question hidden</b>', 'Undo', () => { patchAsk(id, { hidden: false, hiddenMs: null }); redraw(); }, { key: 'ask-undo' });
        },
      });
    });
  };
  wireAsks();
  back.querySelector('[data-cl-show]')?.addEventListener('click', () => showToClinician(iso, { repaint }));
}

/** Full screen, for handing the phone across: the record since the last visit, big. */
function showToClinician(iso, { repaint }) {
  const s = sinceLastVisit(iso);
  const back = openModal({
    title: 'Clinic visit',
    body: sinceHtml(s, true),
    onMount(root) { root.classList.add('cl-showback'); root.querySelector('.modal')?.classList.add('cl-showmodal'); },
  });
  N.haptic('medium');
  // Closing returns to the clinic sheet, where he was.
  back.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { e.stopPropagation(); e.preventDefault(); openClinicSheet(iso, { repaint }); }
  }, true);
}
