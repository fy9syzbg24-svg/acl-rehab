// Where each progression step comes from (his rule, 23 Sep 2026).
//
// That day he found steps on the tendon loading that no clinician gave: an
// earlier session had written them with no source. So every step now says who
// set it, as he asked for it: "Hold 4 kg (Name)", and a step made by him and us reads
// "(Ours)". Nothing more on screen: the document and date stay in the code.
//
// One list, two sources:
//   his clinicians' steps, in data/program.js as { t, by, src }. `by` is a code
//     ('pm', 'col'), never a name, because that repo is public. The names come
//     from his synced data, caseFile.sourceNames (a first name per code); a code
//     with no name reads "Physio". An entry with no `by` is dropped here with a
//     console warning, so an unsourced step can never be shown.
//   his own steps, in program.ownSteps[pid] as [{ t, at }], synced (records.js).
//     They come AFTER the clinicians' steps, so program.stage (Base is 0, the
//     first step 1) never shifts when he adds or removes one.
//
// Every place that shows or uses a progression goes through stepsFor. What a
// logged row stores (row.level) stays the plain step text t, without the name,
// so history reads the same as rows saved before this.

import { esc } from './util.js';

export const OURS = 'ours';
const FALLBACK = 'Physio';
const warned = new Set();

/** The name shown for a source code: his synced name for it, "Physio" without one, "Ours" for his own. */
export function sourceName(by, doc) {
  if (by === OURS) return 'Ours';
  const n = doc?.caseFile?.sourceNames?.[by];
  return typeof n === 'string' && n.trim() ? n.trim() : FALLBACK;
}

/**
 * Every step for a program item, in order: [{ t, by, name }]. A clinician's
 * step carries `n`, its place in item.progressions; his own come last and
 * carry `own`, their place in program.ownSteps[pid].
 */
export function stepsFor(item, doc) {
  if (!item) return [];
  const out = [];
  (item.progressions || []).forEach((p, i) => {
    const t = typeof p === 'string' ? p : p?.t;
    const by = p && typeof p === 'object' ? p.by : null;
    if (!t || !by) {
      const k = `${item.id}:${i}`;
      if (!warned.has(k)) {
        warned.add(k);
        console.warn(`Progression ${i + 1} of ${item.id} names no source, so it is not shown:`, p);
      }
      return;
    }
    out.push({ t, by, name: sourceName(by, doc), n: i });
  });
  const own = doc?.program?.ownSteps?.[item.id];
  if (Array.isArray(own)) {
    own.forEach((s, k) => {
      const t = typeof s?.t === 'string' ? s.t.trim() : '';
      if (t) out.push({ t, by: OURS, name: sourceName(OURS, doc), own: k, at: s.at || null });
    });
  }
  return out;
}

/** "Hold 4 kg (Name)". */
export function stepLabel(step) {
  return step ? `${step.t} (${step.name})` : 'Base';
}

/** The same label as markup: the bracket in a quieter weight. */
export function stepHtml(step) {
  // The step in its own span, so a tight button can cut the step and keep
  // its source whole (2026-09-23 audit: "(Name)" was the first thing cut).
  return step ? `<span class="step-t">${esc(step.t)}</span> <span class="step-by">(${esc(step.name)})</span>` : 'Base';
}

/** The step index he is at: 0 is the Base, 1 the first step. */
export function stageOf(item, doc) {
  return doc?.program?.stage?.[item?.id] || 0;
}

/** The step he is at, or null at the Base (or past the end of the list). */
export function currentStep(item, doc) {
  const i = stageOf(item, doc);
  return i > 0 ? stepsFor(item, doc)[i - 1] || null : null;
}
