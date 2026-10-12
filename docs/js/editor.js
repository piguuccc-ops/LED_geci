// Paraméter vezérlők (effekt fül és szerkesztő) + a teljes mód szerkesztő
import { h, icon, sheet, toast, fmtSec, parseSec } from './ui.js';
import { EFFECTS, effectLabel, normalizeMode, compileMode, parseHex, toHex, templateFor, errorText, utf8Truncate } from './modes.js';
import { FX } from './engine.js';
import { addPreview } from './strip.js';
import { pickColor } from './picker.js';
import { displayRgb, css } from './color.js';

const BASIC = FX.filter((f) => f !== 'keyframes' && f !== 'playlist');
let uid = 0;

export function faderRow(label, value, { onInput, onCommit, max = 255, fmt = (v) => `${Math.round((v / 255) * 100)}%` } = {}) {
  const id = `fd-${++uid}`;
  const out = h('output', { class: 'val', for: id }, fmt(value));
  const r = h('input', { id, class: 'fader', type: 'range', min: '0', max: String(max), step: '1', value: String(value) });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); onInput?.(+r.value); });
  r.addEventListener('change', () => onCommit?.(+r.value));
  const row = h('div', { class: 'f-row' }, h('label', { for: id, class: 'lbl' }, label), r, out);
  row.set = (v) => { r.value = v; out.textContent = fmt(v); };
  return row;
}

export function toggleRow(label, checked, onChange, hint) {
  const id = `tg-${++uid}`;
  const inp = h('input', { id, type: 'checkbox', class: 'switch', checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('div', { class: 't-row' },
    h('label', { for: id }, h('span', null, label), hint ? h('small', { class: 'muted' }, hint) : null), inp);
}

function chip(hex, title, onClick) {
  const c = parseHex(hex) || [0, 0, 0, 0];
  const shown = displayRgb(c);
  return h('button', { type: 'button', class: 'swatch sm', title, 'aria-label': title, onclick: onClick },
    h('span', { class: 'lens', style: { background: css(shown), '--glow': css(shown, 0.55) } }));
}

// p: { effect, speed, intensity, reverse, colors: ['#..'] } – helyben módosul
// onChange(kind, extra): kind = speed | intensity | reverse | colors | color (extra: {idx, c, live})
export function paramEditor(p, { onChange = () => {}, withW = false, favorites = [], compact = false } = {}) {
  const meta = EFFECTS[p.effect] || {};
  const wrap = h('div', { class: 'params' + (compact ? ' compact' : '') });
  if (p.effect !== 'solid' && meta.speed !== false) {
    wrap.append(faderRow('Sebesség', p.speed ?? 128, {
      onInput: (v) => { p.speed = v; onChange('speed', { live: true }); },
      onCommit: () => onChange('speed', { live: false }),
    }));
  }
  if (meta.intensity) {
    wrap.append(faderRow(meta.intensity, p.intensity ?? 128, {
      onInput: (v) => { p.intensity = v; onChange('intensity', { live: true }); },
      onCommit: () => onChange('intensity', { live: false }),
    }));
  }
  if (meta.reverse) wrap.append(toggleRow('Visszafelé', !!p.reverse, (v) => { p.reverse = v; onChange('reverse'); }));
  if (meta.colors) {
    const [min, max] = meta.colors;
    if (!Array.isArray(p.colors)) p.colors = [];
    const row = h('div', { class: 'chips' });
    const render = () => {
      row.replaceChildren(...p.colors.map((hex, idx) => chip(hex, `${idx + 1}. szín: ${hex}`, async () => {
        const orig = hex;
        const res = await pickColor(parseHex(hex), {
          title: `${idx + 1}. szín`, withW, favorites, canDelete: p.colors.length > min,
          onLive: (c) => { p.colors[idx] = toHex(c); onChange('color', { idx, c, live: true }); },
        });
        if (res === 'delete') { p.colors.splice(idx, 1); render(); onChange('colors'); return; }
        if (!res) { p.colors[idx] = orig; onChange('color', { idx, c: parseHex(orig), live: true }); return; }
        p.colors[idx] = toHex(res);
        render();
        onChange('color', { idx, c: res, live: false });
      })));
      if (p.colors.length < max) {
        row.append(h('button', {
          type: 'button', class: 'swatch sm add', 'aria-label': 'Szín hozzáadása',
          onclick: async () => {
            const res = await pickColor(p.colors.length ? parseHex(p.colors[p.colors.length - 1]) : [255, 255, 255, 0], { title: 'Új szín', withW, favorites });
            if (!res) return;
            p.colors.push(toHex(res));
            render();
            onChange('colors');
          },
        }, icon('plus')));
      }
    };
    render();
    wrap.append(h('div', { class: 'c-row' }, h('span', { class: 'lbl' }, p.effect === 'fire' ? 'Lángszínek' : 'Színek'), row));
    if (p.effect === 'fire' && !p.colors.length) wrap.append(h('p', { class: 'hint' }, 'Szín nélkül a klasszikus vörös-sárga lángot kapod.'));
  }
  return wrap;
}

function numField(label, valueMs, onChange, { min = 0, max = 86400, suffix = 's' } = {}) {
  const inp = h('input', { class: 'num', type: 'text', inputmode: 'decimal', value: fmtSec(valueMs), 'aria-label': label });
  inp.addEventListener('change', () => {
    let v = parseSec(inp.value);
    if (v == null) v = valueMs;
    v = Math.max(min * 1000, Math.min(max * 1000, v));
    valueMs = v;
    inp.value = fmtSec(v);
    onChange(v);
  });
  return h('label', { class: 'mini-field' }, h('span', { class: 'lbl' }, label), h('span', { class: 'numbox' }, inp, h('span', { class: 'unit' }, suffix)));
}

function moveBtns(list, i, rerender) {
  return h('span', { class: 'move' },
    h('button', { type: 'button', class: 'icon-btn ghost sm', 'aria-label': 'Feljebb', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; rerender(); } }, icon('up')),
    h('button', { type: 'button', class: 'icon-btn ghost sm', 'aria-label': 'Lejjebb', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; rerender(); } }, icon('down')),
    h('button', { type: 'button', class: 'icon-btn ghost sm', 'aria-label': 'Törlés', disabled: list.length <= 1, onclick: () => { list.splice(i, 1); rerender(); } }, icon('trash')));
}

// ------------------------------------------------------------------ teljes szerkesztő

export function openEditor(initial, { title = 'Mód szerkesztése', withW = false, favorites = [], onTry, onSave } = {}) {
  const m = structuredClone(initial);
  if (m.effect === 'keyframes' && !m.frames) Object.assign(m, templateFor('keyframes'), { name: m.name });
  const canvas = h('canvas', { class: 'mini big', 'aria-label': 'Előnézet' });
  const preview = addPreview(canvas, null, 48);
  let previewTimer = null;
  const refresh = () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      try { preview.play(compileMode(m), 250); errBox.textContent = ''; } catch (e) { errBox.textContent = errorText(e.code); }
    }, 60);
  };
  const errBox = h('p', { class: 'err-text', role: 'alert' });

  const nameInput = h('input', { class: 'field', type: 'text', value: m.name || '', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Név' });
  nameInput.addEventListener('input', () => { const t = utf8Truncate(nameInput.value); if (t !== nameInput.value) nameInput.value = t; m.name = t; });
  const effSel = h('select', { class: 'field', 'aria-label': 'Effekt' },
    FX.map((f) => h('option', { value: f, selected: f === m.effect }, effectLabel(f))));
  const descInput = h('input', { class: 'field', type: 'text', value: m.description || '', placeholder: 'Nem kötelező', autocomplete: 'off', 'aria-label': 'Megjegyzés' });
  descInput.addEventListener('input', () => { m.description = descInput.value; });

  const section = h('div', { class: 'ed-section' });
  const descText = h('p', { class: 'muted fx-desc' });

  const renderSection = () => {
    descText.textContent = EFFECTS[m.effect]?.desc || '';
    const parts = [];
    if (m.effect === 'keyframes') parts.push(framesEditor());
    else if (m.effect === 'playlist') parts.push(stepsEditor());
    else parts.push(paramEditor(m, { withW, favorites, onChange: refresh }));
    parts.push(brightnessEditor());
    section.replaceChildren(...parts);
    refresh();
  };

  effSel.addEventListener('change', () => {
    const keep = { name: m.name, description: m.description };
    for (const k of Object.keys(m)) delete m[k];
    Object.assign(m, templateFor(effSel.value), keep);
    if (!keep.description) delete m.description;
    renderSection();
  });

  function brightnessEditor() {
    const has = Number.isInteger(m.brightness);
    const fader = faderRow('Fényerő', has ? m.brightness : 180, { onInput: (v) => { m.brightness = v; } });
    fader.hidden = !has;
    const t = toggleRow('Saját fényerő', has, (on) => {
      if (on) m.brightness = 180; else delete m.brightness;
      fader.hidden = !on;
      fader.set(180);
    }, 'Indításkor erre a fényerőre áll a szalag.');
    return h('div', { class: 'ed-group' }, t, fader);
  }

  function framesEditor() {
    if (!Array.isArray(m.frames) || !m.frames.length) m.frames = templateFor('keyframes').frames;
    const list = h('ol', { class: 'frames' });
    const render = () => {
      list.replaceChildren(...m.frames.map((f, i) => h('li', { class: 'frame' },
        chip(f.color, `${i + 1}. szín`, async () => {
          const res = await pickColor(parseHex(f.color), { title: `${i + 1}. szín`, withW, favorites });
          if (res) { f.color = toHex(res); render(); refresh(); }
        }),
        numField('Átúszás', f.fade ?? 1000, (v) => { f.fade = v; refresh(); }, { max: 3600 }),
        numField('Kitartás', f.hold ?? 1000, (v) => { f.hold = v; refresh(); }, { max: 86400 }),
        moveBtns(m.frames, i, () => { render(); refresh(); }))));
    };
    render();
    const add = h('button', {
      type: 'button', class: 'btn ghost',
      onclick: () => {
        if (m.frames.length >= 48) { toast('Legfeljebb 48 szín lehet egy színsorban.'); return; }
        const last = m.frames[m.frames.length - 1];
        m.frames.push({ color: last?.color || '#FFFFFF', fade: last?.fade ?? 1000, hold: last?.hold ?? 1000 });
        render();
        refresh();
      },
    }, icon('plus'), 'Szín hozzáadása');
    return h('div', { class: 'ed-group' },
      faderRow('Tempó', m.speed ?? 128, {
        onInput: (v) => { m.speed = v; refresh(); },
        fmt: (v) => (v === 0 ? 'áll' : `${(((v * v) / 128 + 1) / 129).toFixed(2).replace('.', ',')}×`),
      }),
      toggleRow('Ismétlés', m.loop !== false, (on) => { if (on) delete m.loop; else m.loop = false; refresh(); }, 'Kikapcsolva az utolsó színnél megáll.'),
      list, add);
  }

  function stepsEditor() {
    if (!Array.isArray(m.steps) || !m.steps.length) m.steps = templateFor('playlist').steps;
    const list = h('ol', { class: 'steps' });
    const render = () => {
      list.replaceChildren(...m.steps.map((s, i) => {
        const sel = h('select', { class: 'field', 'aria-label': `${i + 1}. lépés effektje` },
          BASIC.map((f) => h('option', { value: f, selected: f === s.effect }, effectLabel(f))));
        sel.addEventListener('change', () => {
          const t = templateFor(sel.value);
          m.steps[i] = { effect: t.effect, speed: t.speed, intensity: t.intensity, colors: t.colors, duration: s.duration ?? 10000 };
          if (!m.steps[i].colors) delete m.steps[i].colors;
          render();
          refresh();
        });
        return h('li', { class: 'step' },
          h('div', { class: 'step-head' }, h('span', { class: 'step-no' }, String(i + 1)), sel,
            numField('Időtartam', s.duration ?? 10000, (v) => { s.duration = v; refresh(); }, { min: 0.5, max: 86400 }),
            moveBtns(m.steps, i, () => { render(); refresh(); })),
          paramEditor(s, { withW, favorites, compact: true, onChange: refresh }));
      }));
    };
    render();
    const add = h('button', {
      type: 'button', class: 'btn ghost',
      onclick: () => {
        if (m.steps.length >= 16) { toast('Legfeljebb 16 lépés lehet egy listában.'); return; }
        const t = templateFor('colorloop');
        m.steps.push({ effect: t.effect, speed: t.speed, intensity: t.intensity, duration: 10000 });
        render();
        refresh();
      },
    }, icon('plus'), 'Lépés hozzáadása');
    return h('div', { class: 'ed-group' },
      toggleRow('Ismétlés', m.loop !== false, (on) => { if (on) delete m.loop; else m.loop = false; refresh(); }, 'Kikapcsolva az utolsó lépésnél marad.'),
      numField('Átúszás lépések között', m.transition ?? 600, (v) => { m.transition = v; refresh(); }, { max: 10 }),
      list, add);
  }

  const body = h('div', { class: 'editor-body' },
    h('div', { class: 'ed-preview' }, canvas),
    errBox,
    h('div', { class: 'ed-grid' },
      h('label', { class: 'stack' }, h('span', { class: 'lbl' }, 'Név'), nameInput),
      h('label', { class: 'stack' }, h('span', { class: 'lbl' }, 'Effekt'), effSel)),
    descText,
    section,
    h('label', { class: 'stack' }, h('span', { class: 'lbl' }, 'Megjegyzés'), descInput));

  renderSection();

  const validate = () => {
    if (!m.name?.trim()) { toast(errorText('no_name')); nameInput.focus(); return null; }
    if (m.description !== undefined && !m.description.trim()) delete m.description;
    try { return normalizeMode(m); } catch (e) { toast(errorText(e.code)); return null; }
  };

  return sheet({
    title, body, cls: 'editor',
    onClose: () => preview.remove(),
    actions: [
      { label: 'Kipróbálás', kind: 'ghost', onClick: () => { const v = validate(); if (v) onTry?.(v); return false; } },
      { label: 'Mentés', kind: 'primary', onClick: async () => { const v = validate(); if (!v) return false; await onSave?.(v); return v; } },
    ],
  });
}
