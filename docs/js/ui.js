// Apró felület-segédek: elemkészítés, ikonok, értesítések, párbeszédablakok

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const PATHS = {
  color: 'M12 3.5c3.4 3.8 5.6 6.8 5.6 9.7a5.6 5.6 0 0 1-11.2 0c0-2.9 2.2-5.9 5.6-9.7z',
  effects: 'M3 15c2.1-4.6 4.3-4.6 6.4 0s4.3 4.6 6.4 0c.9-1.9 1.9-2.9 3.2-3.2M5 6.5h.01M12 4.5h.01M19 6.5h.01',
  modes: 'M7 3.5h7l4 4v12.5H7zM14 3.5v4h4M10 12h5M10 15.5h5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  power: 'M12 3.5v8M7.2 6.3a7 7 0 1 0 9.6 0',
  bt: 'M7 7.5l10 9-5 4V3.5l5 4-10 9',
  play: 'M8.5 5.8v12.4L18.5 12z',
  more: 'M5.5 12h.01M12 12h.01M18.5 12h.01',
  upload: 'M12 15V4.5M7.5 9 12 4.5 16.5 9M5 15v4.5h14V15',
  download: 'M12 4.5V15M7.5 10.5 12 15l4.5-4.5M5 15v4.5h14V15',
  folder: 'M3.5 6.5v11.5h17V8.5H12l-2-2z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7',
  edit: 'M4.5 19.5l4-1 10.5-10.5-3-3L5.5 15.5z',
  share: 'M12 4.5V15M8 8.5l4-4 4 4M6 12v7.5h12V12',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  up: 'M6.5 14.5 12 9l5.5 5.5',
  down: 'M6.5 9.5 12 15l5.5-5.5',
  copy: 'M8.5 8.5h10v10h-10zM5.5 15.5v-10h10',
  timer: 'M12 8.5v4.5l2.8 1.8M9.5 2.5h5M12 20.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z',
  chip: 'M7 7h10v10H7zM10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5',
  file: 'M7 3.5h7l4 4v12.5H7zM14 3.5v4h4',
};

export function icon(name, cls = '') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ic ' + cls);
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', PATHS[name] || '');
  if (name === 'play') p.setAttribute('class', 'fill');
  svg.append(p);
  return svg;
}

// ---- értesítések
export function toast(msg, opts = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = h('div', { class: 'toast' + (opts.kind ? ' ' + opts.kind : ''), role: 'status' }, h('span', null, msg));
  let timer;
  const close = () => { clearTimeout(timer); t.classList.add('out'); setTimeout(() => t.remove(), 180); };
  if (opts.action) {
    t.append(h('button', { class: 'toast-act', onclick: () => { opts.onAction?.(); close(); } }, opts.action));
  }
  host.append(t);
  while (host.children.length > 3) host.firstElementChild.remove();
  timer = setTimeout(close, opts.timeout ?? (opts.action ? 6000 : 3200));
  return close;
}

// ---- párbeszédablak (natív <dialog>, mobilon alulról felcsúszó lap)
export function sheet({ title, body, actions = [], cls = '', onClose } = {}) {
  const dlg = h('dialog', { class: 'sheet ' + cls });
  const head = h('div', { class: 'sheet-head' },
    h('h2', null, title || ''),
    h('button', { class: 'icon-btn ghost', 'aria-label': 'Bezárás', onclick: () => close(null) }, icon('close')));
  const foot = actions.length ? h('div', { class: 'sheet-foot' }) : null;
  let result = null;
  const close = (val) => { result = val; dlg.close(); };
  for (const a of actions) {
    foot.append(h('button', {
      class: 'btn ' + (a.kind || ''),
      onclick: async () => {
        if (a.onClick) { const r = await a.onClick(); if (r === false) return; close(r ?? a.value); } else close(a.value);
      },
    }, a.label));
  }
  dlg.append(head, h('div', { class: 'sheet-body' }, body), foot);
  document.body.append(dlg);
  const done = new Promise((resolve) => {
    dlg.addEventListener('close', () => { onClose?.(result); dlg.remove(); resolve(result); });
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); });
  dlg.showModal();
  done.close = close;
  done.dialog = dlg;
  return done;
}

export function promptText({ title, label, value = '', ok = 'Mentés', maxBytes = 47 }) {
  const input = h('input', { class: 'field', type: 'text', value, autocomplete: 'off', spellcheck: 'false' });
  const enc = new TextEncoder();
  input.addEventListener('input', () => {
    while (enc.encode(input.value).length > maxBytes) input.value = [...input.value].slice(0, -1).join('');
  });
  const body = h('label', { class: 'stack' }, h('span', { class: 'lbl' }, label), input);
  const p = sheet({
    title, body, cls: 'small',
    actions: [
      { label: 'Mégse', kind: 'ghost', value: null },
      { label: ok, kind: 'primary', onClick: () => (input.value.trim() ? input.value.trim() : false) },
    ],
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) p.close(input.value.trim()); });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  return p;
}

export function confirmBox({ title, text, ok = 'Rendben', danger = false }) {
  return sheet({
    title, cls: 'small', body: h('p', { class: 'muted' }, text),
    actions: [{ label: 'Mégse', kind: 'ghost', value: false }, { label: ok, kind: danger ? 'danger' : 'primary', value: true }],
  });
}

// Lenyíló menü egy gomb alatt
export function menu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    m.append(h('button', {
      role: 'menuitem', class: it.danger ? 'danger' : '',
      onclick: () => { m.remove(); it.onClick(); },
    }, it.icon ? icon(it.icon) : null, it.label));
  }
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  m.style.left = left + 'px';
  m.style.top = top + 'px';
  m.querySelector('button')?.focus();
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { m.remove(); anchor.focus(); } });
}

export function longPress(el, fn, ms = 550) {
  let t = null, fired = false;
  el.addEventListener('pointerdown', () => { fired = false; t = setTimeout(() => { fired = true; fn(); }, ms); });
  const cancel = () => clearTimeout(t);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); if (!fired) { fired = true; fn(); } });
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
}

export const fmtSec = (ms) => {
  const s = ms / 1000;
  return (Number.isInteger(s) ? s.toString() : s.toFixed(1)).replace('.', ',');
};
export const parseSec = (str) => {
  const v = parseFloat(String(str).replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 1000) : null;
};
