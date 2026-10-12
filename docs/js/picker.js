// Színválasztó: HSV vagy RGB csúszkák, hex mező, opcionális fehér (W) csatorna
import { h, sheet, longPress } from './ui.js';
import { rgbToHsv, hsvToRgb, kelvinToRgb, displayRgb, css, PRESETS, WHITES } from './color.js';
import { parseHex, toHex } from './modes.js';

let uid = 0;
const HUE_TRACK = 'linear-gradient(90deg,#f00 0%,#ff0 16.7%,#0f0 33.3%,#0ff 50%,#00f 66.7%,#f0f 83.3%,#f00 100%)';

export class ColorPicker {
  constructor({ value = [255, 90, 0, 0], withW = false, segment = 'hsv', onInput, onChange, onSegment } = {}) {
    this.c = value.slice(0, 4);
    while (this.c.length < 4) this.c.push(0);
    this.hsv = rgbToHsv(this.c[0], this.c[1], this.c[2]);
    this.withW = withW;
    this.segment = segment;
    this.onInput = onInput || (() => {});
    this.onChange = onChange || (() => {});
    this.onSegment = onSegment || (() => {});
    this.id = ++uid;
    this.build();
    this.sync();
  }

  build() {
    const hexId = `pk-hex-${this.id}`;
    this.lens = h('span', { class: 'lens' });
    this.hex = h('input', { id: hexId, class: 'pk-hex', type: 'text', inputmode: 'text', spellcheck: 'false', autocomplete: 'off', maxlength: '9', 'aria-label': 'Hex színkód' });
    this.rgbText = h('div', { class: 'pk-rgb muted' });
    this.hex.addEventListener('input', () => {
      const v = parseHex(this.hex.value);
      if (!v) { this.hex.classList.add('bad'); return; }
      this.hex.classList.remove('bad');
      this.setRgbw(v, 'hex');
      this.onInput(this.c.slice());
    });
    this.hex.addEventListener('change', () => { this.sync(); this.onChange(this.c.slice()); });
    this.hex.addEventListener('focus', () => this.hex.select());

    this.segBtns = {};
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Csúszkák' },
      ['hsv', 'rgb'].map((k) => (this.segBtns[k] = h('button', {
        type: 'button', 'aria-pressed': String(this.segment === k),
        onclick: () => { this.segment = k; this.onSegment(k); this.renderRows(); },
      }, k.toUpperCase()))));

    this.rowsEl = h('div', { class: 'pk-rows' });
    this.root = h('div', { class: 'picker' },
      h('div', { class: 'pk-top' },
        h('div', { class: 'lamp' }, this.lens),
        h('div', { class: 'pk-read' }, h('label', { for: hexId, class: 'lbl' }, 'Hex'), this.hex, this.rgbText)),
      seg, this.rowsEl);
    this.renderRows();
  }

  row(key, label, max, unit, get, set) {
    const id = `pk-${this.id}-${key}`;
    const range = h('input', { id, class: 'fader', type: 'range', min: '0', max: String(max), step: '1' });
    const num = h('input', { class: 'num', type: 'number', min: '0', max: String(max), step: '1', inputmode: 'numeric', 'aria-label': label });
    range.addEventListener('input', () => { set(+range.value); this.onInput(this.c.slice()); });
    range.addEventListener('change', () => this.onChange(this.c.slice()));
    num.addEventListener('input', () => {
      if (num.value === '') return;
      const v = Math.max(0, Math.min(max, Math.round(+num.value)));
      if (Number.isFinite(v)) { set(v, 'num'); this.onInput(this.c.slice()); }
    });
    num.addEventListener('change', () => { this.sync(); this.onChange(this.c.slice()); });
    const el = h('div', { class: 'pk-row' }, h('label', { for: id, class: 'lbl' }, label), range, h('span', { class: 'numbox' }, num, unit ? h('span', { class: 'unit' }, unit) : null));
    el._update = (skipNum) => {
      const v = Math.round(get());
      range.value = v;
      if (!skipNum && document.activeElement !== num) num.value = v;
    };
    el._range = range;
    el._key = key;
    return el;
  }

  renderRows() {
    for (const [k, b] of Object.entries(this.segBtns)) b.setAttribute('aria-pressed', String(k === this.segment));
    const rows = [];
    if (this.segment === 'hsv') {
      rows.push(
        this.row('h', 'Árnyalat', 359, '°', () => this.hsv.h, (v) => { this.hsv.h = v; this.fromHsv(); }),
        this.row('s', 'Telítettség', 100, '%', () => this.hsv.s, (v) => { this.hsv.s = v; this.fromHsv(); }),
        this.row('v', 'Erősség', 100, '%', () => this.hsv.v, (v) => { this.hsv.v = v; this.fromHsv(); }));
    } else {
      rows.push(
        this.row('r', 'Piros', 255, '', () => this.c[0], (v) => this.setChannel(0, v)),
        this.row('g', 'Zöld', 255, '', () => this.c[1], (v) => this.setChannel(1, v)),
        this.row('b', 'Kék', 255, '', () => this.c[2], (v) => this.setChannel(2, v)));
    }
    if (this.withW) rows.push(this.row('w', 'Fehér LED', 255, '', () => this.c[3], (v) => { this.c[3] = v; this.sync('w'); }));
    this.rows = rows;
    this.rowsEl.replaceChildren(...rows);
    this.sync();
  }

  fromHsv() {
    const [r, g, b] = hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
    this.c[0] = r; this.c[1] = g; this.c[2] = b;
    this.sync('hsv');
  }

  setChannel(i, v) {
    this.c[i] = v;
    this.updateHsvFromRgb();
    this.sync('rgb');
  }

  updateHsvFromRgb() {
    const n = rgbToHsv(this.c[0], this.c[1], this.c[2]);
    if (n.v > 0 && n.s > 0) this.hsv.h = n.h;
    if (n.v > 0) this.hsv.s = n.s;
    this.hsv.v = n.v;
  }

  setRgbw(c, from) {
    this.c = [c[0], c[1], c[2], this.withW ? (c[3] || 0) : 0];
    this.updateHsvFromRgb();
    this.sync(from);
  }

  // Kívülről beállítás (nem hív visszahívást)
  set value(c) { this.setRgbw(c, null); }
  get value() { return this.c.slice(); }

  setWithW(on) {
    if (this.withW === on) return;
    this.withW = on;
    if (!on) this.c[3] = 0;
    this.renderRows();
  }

  sync(from) {
    const [r, g, b] = this.c;
    const shown = displayRgb(this.c);
    this.root.style.setProperty('--pick', css(shown));
    this.lens.style.background = css(shown);
    if (from !== 'hex' && document.activeElement !== this.hex) { this.hex.value = toHex(this.c); this.hex.classList.remove('bad'); }
    this.rgbText.textContent = `R ${r}  G ${g}  B ${b}` + (this.withW ? `  W ${this.c[3]}` : '');
    const { h: hh, s, v } = this.hsv;
    for (const row of this.rows || []) {
      row._update(from === 'num');
      const t = row._range;
      switch (row._key) {
        case 'h': t.style.setProperty('--track', HUE_TRACK); break;
        case 's': t.style.setProperty('--track', `linear-gradient(90deg,${css(hsvToRgb(hh, 0, v))},${css(hsvToRgb(hh, 100, v))})`); break;
        case 'v': t.style.setProperty('--track', `linear-gradient(90deg,#000,${css(hsvToRgb(hh, s, 100))})`); break;
        case 'r': t.style.setProperty('--track', `linear-gradient(90deg,rgb(0 ${g} ${b}),rgb(255 ${g} ${b}))`); break;
        case 'g': t.style.setProperty('--track', `linear-gradient(90deg,rgb(${r} 0 ${b}),rgb(${r} 255 ${b}))`); break;
        case 'b': t.style.setProperty('--track', `linear-gradient(90deg,rgb(${r} ${g} 0),rgb(${r} ${g} 255))`); break;
        case 'w': t.style.setProperty('--track', 'linear-gradient(90deg,#000,#fff3df)'); break;
      }
    }
  }
}

// LED-tok formájú színminta gomb
export function swatch(c, title, onPick, opts = {}) {
  const shown = displayRgb(c);
  const b = h('button', { type: 'button', class: 'swatch' + (opts.cls ? ' ' + opts.cls : ''), title, 'aria-label': title },
    h('span', { class: 'lens', style: { background: css(shown), '--glow': css(shown, 0.55) } }));
  b.addEventListener('click', () => onPick(c.slice()));
  if (opts.onLong) longPress(b, opts.onLong);
  return b;
}

export function presetSwatches(onPick, { withW = false } = {}) {
  const whites = WHITES.map((w) => swatch([...kelvinToRgb(w.k), 0], w.name, onPick));
  if (withW) whites.push(swatch([0, 0, 0, 255], 'Fehér LED (W csatorna)', onPick, { cls: 'wled' }));
  const colors = PRESETS.map((p) => swatch(parseHex(p.hex), p.name, onPick));
  return { whites, colors };
}

// Felugró színválasztó (paletta színekhez, kulcskockákhoz)
export function pickColor(initial, { title = 'Szín', withW = false, onLive, favorites = [], segment = 'hsv', canDelete = false } = {}) {
  const picker = new ColorPicker({ value: initial || [255, 255, 255, 0], withW, segment, onInput: (c) => onLive?.(c) });
  const apply = (c) => { picker.value = c; onLive?.(picker.value); };
  const { whites, colors } = presetSwatches(apply, { withW });
  const favs = favorites.map((hex) => swatch(parseHex(hex), hex, apply));
  const body = h('div', { class: 'pick-dialog' }, picker.root,
    h('div', { class: 'swatches' }, ...whites, ...colors, ...favs));
  const actions = [];
  if (canDelete) actions.push({ label: 'Törlés', kind: 'ghost danger-text', value: 'delete' });
  actions.push({ label: 'Mégse', kind: 'ghost', value: null }, { label: 'Kész', kind: 'primary', onClick: () => picker.value });
  return sheet({ title, body, cls: 'color-sheet', actions });
}
