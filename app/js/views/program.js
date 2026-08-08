// The clinician program: pictures, written steps, prescriptions, progressions,
// and your current working resistance for the gym lifts.

import { esc, fmtDate, round, fmtDateNum } from '../util.js';
import { state, update, maxLoad, loadSeries } from '../store.js';
import { REHAB_PROGRAM, GYM_PROGRAM, PROGRAM_SOURCE, GYM_SOURCE, THERABAND, BAND_BY_ID } from '../../data/program.js';
import { exerciseById, loadBars, prescriptionPills, openPicture, iconTile } from '../components.js';

export function renderProgram(ctx) {
  const tab = ctx.ptab || 'rehab';
  return `
  <div class="stack">
    <section class="card">
      <header>
        <div>
          <h2>${esc(PROGRAM_SOURCE.title)}</h2>
          <div class="sub">${esc(PROGRAM_SOURCE.clinician)} · updated ${esc(fmtDate(PROGRAM_SOURCE.updated))}</div>
        </div>
        <div class="row" style="gap:.25rem">
          <button class="btn sm ${tab === 'rehab' ? 'primary' : ''}" data-ptab="rehab">Rehab program</button>
          <button class="btn sm ${tab === 'gym' ? 'primary' : ''}" data-ptab="gym">Gym strength</button>
        </div>
      </header>
      <div class="card-body">
        <div class="callout small">
          Videos of every exercise are at <strong>${esc(PROGRAM_SOURCE.videos)}</strong>,
          code <strong class="mono">${esc(PROGRAM_SOURCE.code)}</strong>.
          Tap any picture here to see it big with the full instructions.
        </div>
      </div>
    </section>

    ${tab === 'rehab' ? REHAB_PROGRAM.map(exerciseCard).join('') : gymTab()}
  </div>`;
}

function exerciseCard(p) {
  const ex = exerciseById(p.ex);
  const stage = state.data.program.stage[p.id] || 0;
  const band = state.data.program.band[p.id] ?? p.band ?? '';
  const usesBand = ex?.usesBand;

  return `
  <section class="card exercise-card ${p.notYet ? 'not-yet' : ''}">
    <div class="excard">
      <button class="exshot" data-bigpic="${esc(p.id)}" title="Show it bigger">
        ${p.thumb ? `<img src="${esc(p.thumb)}" alt="${esc(p.title)}" decoding="async">` : iconTile(p.ex, 117)}
        <span class="exshot-zoom">⤢</span>
      </button>
      <div class="exbody">
        <div class="row between" style="align-items:flex-start;gap:.5rem">
          <h3 style="font-size:.95rem">
            <span class="muted mono" style="font-size:.78rem">${p.n}.</span> ${esc(p.title)}
          </h3>
          ${p.typed ? '<span class="pill" title="From your typed list, not the PhysiApp program">typed list</span>' : ''}
          ${p.notYet ? '<span class="pill warn">not yet</span>' : ''}
        </div>
        ${prescriptionPills(p)}
        ${p.notYet ? `<div class="callout warn small">${esc(p.notYetNote)}</div>` : ''}
        ${p.notes?.length ? `<div class="callout small" style="margin-bottom:.5rem">${p.notes.map(esc).join('<br>')}</div>` : ''}
        ${p.photoNote ? `<div class="tiny muted" style="margin:-.2rem 0 .5rem">${esc(p.photoNote)}</div>` : ''}

        <details class="disc"><summary>How to do it</summary>
          <ol class="steps">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        </details>

        ${usesBand ? `<div class="row" style="margin-top:.5rem;gap:.4rem;align-items:center">
          <span class="tiny muted">Theraband</span>
          <select data-pband="${esc(p.id)}" style="width:auto">
            <option value="">none</option>
            ${THERABAND.map((b) => `<option value="${b.id}" ${band === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
          ${band && BAND_BY_ID[band] ? `<i class="swatch big" style="background:${BAND_BY_ID[band].swatch}"></i>` : ''}
          ${p.band && band !== p.band ? `<span class="tiny muted">prescribed: ${esc(BAND_BY_ID[p.band]?.name || p.band)}</span>` : ''}
        </div>` : ''}

        ${p.progressions?.length ? `
          <div style="margin-top:.6rem">
            <div class="section-title">Where you are</div>
            <div class="stagebar">
              ${['Base'].concat(p.progressions).map((label, i) => `
                <button class="stagestep ${i === stage ? 'on' : ''} ${i < stage ? 'past' : ''}"
                  data-pstage="${esc(p.id)}" data-i="${i}">${esc(label)}</button>`).join('')}
            </div>
          </div>` : ''}
      </div>
    </div>
  </section>`;
}

function gymTab() {
  const unit = state.data.settings.weightUnit;
  return `
  <section class="card">
    <header><h2>Working resistance</h2><span class="sub">updates every time you record a load</span></header>
    <div class="card-body">
      <div class="callout small" style="margin-bottom:.9rem">${esc(GYM_SOURCE)}</div>
      ${GYM_PROGRAM.map((item) => {
        const ex = exerciseById(item.ex);
        const cardio = !!ex?.cardio;
        const field = cardio ? 'resistance' : 'load';
        const sides = item.sides === 'each' ? ['L', 'R'] : ['B'];
        return `
        <div class="gymrow">
          <div class="row between" style="align-items:flex-start;gap:.5rem;margin-bottom:.4rem">
            <div>
              <div class="pname">${esc(ex?.name || item.ex)}</div>
              ${ex?.aka ? `<div class="tiny muted"><em>${esc(ex.aka)}</em></div>` : ''}
            </div>
            <span class="pill">${item.sets
              ? `${item.sets} × ${item.reps}${item.sides === 'each' ? ' each side' : ''}`
              : 'minutes · level 1–20 · calories'}</span>
          </div>
          <div class="boards">
            ${sides.map((s) => {
              const key = s === 'B' ? null : s;
              const mx = maxLoad(item.ex, key, field);
              const series = loadSeries(item.ex, key, 12, field);
              const last = series.length ? series[series.length - 1] : null;
              return `<div class="board">
                <div class="row between" style="gap:.4rem">
                  <span class="sidetag ${s}">${cardio ? 'best level' : s === 'L' ? 'Left' : s === 'R' ? 'Right' : 'both legs'}</span>
                  <span class="mono board-max">${mx ? (cardio ? `L${round(mx.load, 0)}` : `${round(mx.load, 2)} ${esc(mx.loadUnit || unit)}`) : '—'}</span>
                </div>
                ${loadBars(series, 34)}
                <div class="tiny muted">${last
                  ? cardio
                    ? `last ${esc(fmtDateNum(last.date))} · level ${round(last.load, 0)}${last.time ? ` · ${round(last.time, 0)} min` : ''}${last.calories ? ` · ${last.calories} cal` : ''}`
                    : `last ${esc(fmtDateNum(last.date))} · ${round(last.load, 2)} ${esc(last.unit)}${last.sets ? ` · ${last.sets} × ${last.reps ?? '?'}` : ''}`
                  : 'nothing logged yet'}</div>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
      <div class="tiny muted" style="margin-top:.6rem">
        The big number is your heaviest ever on that side. Bars are your top load in each of the last twelve sessions,
        oldest on the left. Log loads on the Today tab and these move on their own.
      </div>
    </div>
  </section>`;
}

export function bindProgram(root, ctx, rerender) {
  root.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => {
    ctx.ptab = b.dataset.ptab;
    rerender();
  }));
  root.querySelectorAll('[data-bigpic]').forEach((b) => b.addEventListener('click', () => openPicture(b.dataset.bigpic)));
  root.querySelectorAll('[data-pband]').forEach((sel) => sel.addEventListener('change', () => {
    update((d) => { d.program.band[sel.dataset.pband] = sel.value; });
    rerender();
  }));
  root.querySelectorAll('[data-pstage]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.i);
    update((d) => { d.program.stage[b.dataset.pstage] = i; });
    rerender();
  }));
}
