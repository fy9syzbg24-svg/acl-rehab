// Rehab Test v3 (2026-09-30): one menu for the whole page, the iOS way.
//
//   menu(spec, anchorEl)  -> Promise<chosen id | null>
//     spec = { title?, items: [{ id, title, checked?, destructive?, symbol?, group? }] }
//     In the app: a native menu springing from the element (native-bridge actions()).
//     Without it (a browser, or a native build that does not know actions.show yet): a
//     web menu drawn the same way, glass over the page, springing from the element.
//
//   enhanceSelects(root)  turns every <select> under root into a menu button. The select
//     stays in the DOM, hidden, and keeps its value; a pick sets it and fires `change`,
//     so every existing reader and listener works unchanged (07 4.4: "27 selects -> a
//     Menu button with the value as its label").
//
// Apple (navigation-and-flow 7): short labels, a checkmark on what is in effect,
// destructive last and red, the menu closes on a pick or an outside tap.
// Owned by the global builder; other builders import it.

import { actions, isNative } from './native-bridge.js';

let nativeMenus = null;   // null: not known yet; false: this build has no actions.show

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function menu(spec, anchorEl) {
  const items = (spec.items || []).filter((x) => x && x.title);
  if (!items.length) return null;
  if (isNative() && nativeMenus !== false) {
    const t0 = performance.now();
    const got = await actions({ ...spec, items }, anchorEl);
    if (got != null) { nativeMenus = true; return got; }
    // An unknown call is refused within a few milliseconds; nobody closes a real
    // menu that fast. So a quick null means "not in this build": draw the web one.
    if (nativeMenus === true || performance.now() - t0 > 250) return null;
    nativeMenus = false;
  }
  return webMenu({ ...spec, items }, anchorEl);
}

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 7.5"/></svg>';

function webMenu(spec, anchorEl) {
  return new Promise((resolve) => {
    document.querySelector('.rt-menu-back')?.dispatchEvent(new Event('rt-close'));
    const back = document.createElement('div');
    back.className = 'rt-menu-back';
    const plain = spec.items.filter((x) => !x.destructive);
    const danger = spec.items.filter((x) => x.destructive);
    const groups = [];
    for (const x of plain) {
      const g = x.group ?? 0;
      let last = groups[groups.length - 1];
      if (!last || last.g !== g) { last = { g, rows: [] }; groups.push(last); }
      last.rows.push(x);
    }
    if (danger.length) groups.push({ g: 'danger', rows: danger });
    const anyCheck = spec.items.some((x) => x.checked !== undefined);
    back.innerHTML = `<div class="rt-menu" role="menu" aria-label="${esc(spec.title || 'Options')}">
      ${spec.title ? `<div class="rt-menu-title">${esc(spec.title)}</div>` : ''}
      ${groups.map((g) => `<div class="rt-menu-group">${g.rows.map((x) => `
        <button type="button" role="menuitem" class="rt-menu-item ${x.destructive ? 'bad' : ''}" data-i="${spec.items.indexOf(x)}">
          ${anyCheck ? `<span class="rt-menu-check">${x.checked ? CHECK : ''}</span>` : ''}
          <span class="rt-menu-label">${esc(x.title)}</span>
        </button>`).join('')}</div>`).join('')}
    </div>`;
    document.body.appendChild(back);
    const box = back.querySelector('.rt-menu');
    // Place it under the element (above it when there is no room), inside the screen.
    const r = anchorEl?.getBoundingClientRect?.() || { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2, width: 0 };
    const w = Math.min(250, innerWidth - 32);
    box.style.width = `${w}px`;
    const h = box.offsetHeight;
    let left = Math.min(Math.max(16, r.right - w), innerWidth - 16 - w);
    if (r.width > w * 0.8) left = Math.min(Math.max(16, r.left), innerWidth - 16 - w);
    const below = r.bottom + 8 + h < innerHeight - 90;
    const top = below ? r.bottom + 8 : Math.max(56, r.top - 8 - h);
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.transformOrigin = `${Math.round((r.left + r.right) / 2 - left)}px ${below ? 0 : h}px`;
    requestAnimationFrame(() => back.classList.add('in'));
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      back.classList.remove('in');
      back.classList.add('out');
      setTimeout(() => back.remove(), 180);
      resolve(val);
    };
    back.addEventListener('rt-close', () => finish(null));
    back.addEventListener('click', (e) => {
      const b = e.target.closest('.rt-menu-item');
      if (b) { finish(spec.items[Number(b.dataset.i)].id); return; }
      if (!e.target.closest('.rt-menu')) finish(null);
    });
    const key = (e) => { if (e.key === 'Escape') { finish(null); document.removeEventListener('keydown', key); } };
    document.addEventListener('keydown', key);
    box.tabIndex = -1;
    try { box.focus({ preventScroll: true }); } catch { /* ignore */ }
  });
}

const CHEVRONS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';

/** One select as a menu button: the value is the label, a tap opens the menu. */
export function enhanceSelect(sel) {
  if (!sel || sel.dataset.rtMenu) return;
  sel.dataset.rtMenu = '1';
  sel.classList.add('rt-select-hidden');
  sel.tabIndex = -1;
  sel.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rt-menubtn';
  const paint = () => {
    const o = sel.options[sel.selectedIndex];
    btn.innerHTML = `<span class="rt-menubtn-v">${esc(o ? o.textContent.trim() : '')}</span>${CHEVRONS}`;
    btn.disabled = sel.disabled;
    const lab = sel.closest('label')?.childNodes[0]?.textContent?.trim();
    btn.setAttribute('aria-label', `${lab ? `${lab}: ` : ''}${o ? o.textContent.trim() : ''}`);
  };
  paint();
  sel.after(btn);
  // A label around the select would forward the tap to the hidden select too.
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const items = [...sel.options].filter((o) => !o.disabled && !o.hidden).map((o) => ({
      id: o.value, title: o.textContent.trim(), checked: o.selected,
    }));
    const got = await menu({ items }, btn);
    if (got == null || got === sel.value) return;
    sel.value = got;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    paint();
  });
  sel.addEventListener('change', paint);
}

export function enhanceSelects(root) {
  root?.querySelectorAll?.('select').forEach(enhanceSelect);
}
