// Mód fájlok (.ledmode): ellenőrzés, normalizálás, effekt leírások.
// A compileMode() a firmware modeFromJson() függvényének mása.
import { FX, FX_ID, defaultParams, emptyMode, MAX_COLORS, MAX_FRAMES, MAX_STEPS } from './engine.js';

export const NAME_MAX_BYTES = 47;

// Effektek magyar nevei, leírásai, paraméter címkéi
export const EFFECTS = {
  solid: { label: 'Egyszínű', desc: 'Az egész szalag egy színben világít.', colors: [1, 1], speed: false, intensity: null },
  breathe: { label: 'Lélegzés', desc: 'Lassan elhalványul, majd újra felerősödik. Több színnél minden lélegzetnél vált.', colors: [1, 8], intensity: 'Mélység' },
  rainbow: { label: 'Szivárvány', desc: 'Vándorló szivárvány a szalag mentén.', colors: null, intensity: 'Sűrűség', reverse: true },
  colorloop: { label: 'Színkör', desc: 'Az egész szalag együtt halad körbe a színeken.', colors: null, intensity: null, reverse: true },
  gradient: { label: 'Színátmenet', desc: 'Átmenet a színeid között. Nulla sebességnél áll, különben lassan úszik.', colors: [2, 8], intensity: 'Ismétlés', reverse: true },
  chase: { label: 'Futófény', desc: 'Világító blokkok futnak végig. Több színnél a blokkok váltakoznak.', colors: [1, 8], intensity: 'Blokkméret', reverse: true },
  comet: { label: 'Üstökös', desc: 'Fényes fej halványuló csóvával. Minden körben a következő színre vált.', colors: [1, 8], intensity: 'Csóva hossza', reverse: true },
  scanner: { label: 'Pásztázó', desc: 'Ide-oda futó fénypont, minden fordulónál színt válthat.', colors: [1, 8], intensity: 'Szélesség' },
  twinkle: { label: 'Csillogás', desc: 'Véletlenszerűen felvillanó, lassan kihunyó pontok.', colors: [1, 8], intensity: 'Sűrűség' },
  fire: { label: 'Tűz', desc: 'Lobogó láng. Ha megadsz színeket, azokból lesz a láng.', colors: [0, 8], intensity: 'Lánghossz', reverse: true },
  strobe: { label: 'Villogás', desc: 'Gyors villogás, legfeljebb 10 Hz. Fényérzékenység esetén kerüld.', colors: [1, 8], intensity: 'Kitöltés' },
  wave: { label: 'Hullám', desc: 'Fényhullámok futnak végig. A második szín a háttér.', colors: [1, 2], intensity: 'Hullámok', reverse: true },
  keyframes: { label: 'Színsor', desc: 'Saját színek egymás után, megadott átúszással és kitartással.', editor: 'frames' },
  playlist: { label: 'Lejátszási lista', desc: 'Effektek egymás után, mindegyik a megadott ideig.', editor: 'steps' },
};

export const effectLabel = (name) => EFFECTS[name]?.label ?? name;

// ------------------------------------------------------------------ színek

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp8 = (v) => clamp(Number.isInteger(v) ? v : 0, 0, 255);

export function parseHex(s) {
  if (typeof s !== 'string') return null;
  s = s.trim();
  if (s[0] === '#') s = s.slice(1);
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return null;
  const v = [0, 0, 0, 0];
  for (let i = 0; i < s.length; i += 2) v[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return v;
}

export function toHex(c) {
  const h = (x) => x.toString(16).padStart(2, '0').toUpperCase();
  return '#' + h(c[0]) + h(c[1]) + h(c[2]) + (c[3] ? h(c[3]) : '');
}

export function parseColor(v) {
  if (typeof v === 'string') return parseHex(v);
  if (Array.isArray(v)) {
    if (v.length < 3) return null;
    return [clamp8(v[0]), clamp8(v[1]), clamp8(v[2]), clamp8(v.length > 3 ? v[3] : 0)];
  }
  if (v && typeof v === 'object') return [clamp8(v.r), clamp8(v.g), clamp8(v.b), clamp8(v.w)];
  return null;
}

// ------------------------------------------------------------------ név

const enc = new TextEncoder();
export function utf8Truncate(s, maxBytes = NAME_MAX_BYTES) {
  s = String(s ?? '');
  if (enc.encode(s).length <= maxBytes) return s;
  let out = '';
  for (const ch of s) {
    if (enc.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

export function fileNameFor(name) {
  const base = (name || 'mod').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) || 'mod';
  return base + '.ledmode';
}

// ------------------------------------------------------------------ JSON -> motor

class ModeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function parseParams(o, top) {
  const name = typeof o.effect === 'string' ? o.effect : 'solid';
  const id = FX_ID[name];
  if (id === undefined) throw new ModeError('unknown_effect');
  if (!top && (id === 13 || id === 12)) throw new ModeError('nested');
  const p = defaultParams(id);
  if (Number.isInteger(o.speed)) p.speed = clamp(o.speed, 0, 255);
  if (Number.isInteger(o.intensity)) p.intensity = clamp(o.intensity, 0, 255);
  if (typeof o.reverse === 'boolean') p.reverse = o.reverse;
  if (Number.isInteger(o.duration)) p.duration = clamp(o.duration, 500, 86400000);
  if (Array.isArray(o.colors)) {
    const cols = [];
    for (const v of o.colors) {
      if (cols.length >= MAX_COLORS) break;
      const c = parseColor(v);
      if (!c) throw new ModeError('bad_color');
      cols.push(c);
    }
    p.col = cols;
    if (!cols.length && id === 0) p.col = [[0, 0, 0, 0]];
  }
  return p;
}

// Visszaad: motor-mód; hibánál ModeError-t dob (code mezővel)
export function compileMode(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new ModeError('bad_mode');
  const m = emptyMode();
  m.name = utf8Truncate(typeof o.name === 'string' ? o.name : '');
  m.p = parseParams(o, true);
  if (Number.isInteger(o.brightness)) m.brightness = clamp(o.brightness, 0, 255);
  if (typeof o.loop === 'boolean') m.loop = o.loop;
  if (Number.isInteger(o.transition)) m.transition = clamp(o.transition, 0, 10000);
  if (m.p.fx === 12) {
    if (!Array.isArray(o.frames) || !o.frames.length) throw new ModeError('no_frames');
    for (const f of o.frames) {
      if (m.frames.length >= MAX_FRAMES) break;
      const c = parseColor(f?.color);
      if (!c) throw new ModeError('bad_color');
      m.frames.push({
        c,
        fade: clamp(Number.isInteger(f.fade) ? f.fade : 1000, 0, 3600000),
        hold: clamp(Number.isInteger(f.hold) ? f.hold : 1000, 0, 86400000),
      });
    }
  }
  if (m.p.fx === 13) {
    if (!Array.isArray(o.steps) || !o.steps.length) throw new ModeError('no_steps');
    for (const s of o.steps) {
      if (m.steps.length >= MAX_STEPS) break;
      if (!s || typeof s !== 'object') throw new ModeError('bad_mode');
      m.steps.push(parseParams(s, false));
    }
  }
  return m;
}

// ------------------------------------------------------------------ motor -> JSON (firmware formátum)

function paramsToJson(p, o, withDuration) {
  o.effect = FX[p.fx];
  if (p.fx !== 0 && p.fx !== 13) {
    o.speed = p.speed;
    o.intensity = p.intensity;
  }
  if (p.reverse) o.reverse = true;
  if (p.col.length) o.colors = p.col.map(toHex);
  if (withDuration) o.duration = p.duration;
  return o;
}

export function modeToJson(m) {
  const o = { ledmode: 1, name: m.name };
  paramsToJson(m.p, o, false);
  if (m.brightness >= 0) o.brightness = m.brightness;
  if (!m.loop) o.loop = false;
  if (m.p.fx === 13 && m.transition !== 600) o.transition = m.transition;
  if (m.p.fx === 12) o.frames = m.frames.map((f) => ({ color: toHex(f.c), fade: f.fade, hold: f.hold }));
  if (m.p.fx === 13) o.steps = m.steps.map((s) => paramsToJson(s, {}, true));
  return o;
}

// Bármilyen bejövő mód -> kanonikus JSON (+ megtartott leírás). Hibánál ModeError.
export function normalizeMode(o) {
  const out = modeToJson(compileMode(o));
  if (typeof o.description === 'string' && o.description.trim()) out.description = o.description.trim().slice(0, 300);
  return out;
}

// A készüléknek küldött változat: a leírás nélkül
export function deviceJson(mode) {
  const { description, ...rest } = mode;
  return rest;
}

export const sameMode = (a, b) => JSON.stringify(deviceJson(a)) === JSON.stringify(deviceJson(b));

// Egy .ledmode fájl tartalma lehet egy mód, módok tömbje, vagy {"ledmodes":[...]}
export function parseModeFile(text) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return { modes: [], errors: ['parse'] }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.ledmodes) ? data.ledmodes : [data];
  const modes = [], errors = [];
  for (const item of list) {
    try {
      const m = normalizeMode(item);
      if (!m.name) m.name = effectLabel(m.effect);
      modes.push(m);
    } catch (e) { errors.push(e.code || 'bad_mode'); }
  }
  return { modes, errors };
}

export function isModeFileName(name) {
  return /\.ledmode(\.json|\.txt)?$/i.test(name) || /\.ledmode \(\d+\)$/i.test(name);
}

export const ERROR_TEXT = {
  parse: 'A fájl nem érvényes JSON.',
  bad_mode: 'A fájlban nincs érvényes mód.',
  unknown_effect: 'Ismeretlen effekt a fájlban.',
  nested: 'Lejátszási listában nem lehet színsor vagy másik lista.',
  bad_color: 'Hibás szín a fájlban (pl. #FF8800 formátum kell).',
  no_frames: 'A színsorban nincs egyetlen szín sem.',
  no_steps: 'A lejátszási listában nincs egyetlen lépés sem.',
  no_name: 'Adj nevet a módnak.',
  full: 'Az eszköz tárhelye megtelt (legfeljebb 60 mód). Törölj néhányat.',
  fs: 'Az eszköz nem tudta elmenteni a fájlt.',
  not_found: 'Ez a mód nincs az eszközön.',
  too_large: 'Az üzenet túl nagy az eszköznek.',
  bad_cfg: 'Hibás beállítás.',
  bad_type: 'Ismeretlen szalagtípus.',
  bad_order: 'Hibás színsorrend.',
  bad_pin: 'Ez a láb nem használható ezen a lapkán.',
  dup_pin: 'Két csatorna nem kaphatja ugyanazt a lábat.',
  bad_name: 'Az eszköz neve nem lehet üres.',
  unknown_cmd: 'Az eszköz nem ismeri ezt a parancsot (régi firmware?).',
};
export const errorText = (code) => ERROR_TEXT[code] || `Hiba: ${code}`;

// Új mód sablonok a szerkesztőhöz
export function templateFor(effect) {
  if (effect === 'keyframes') {
    return {
      ledmode: 1, name: 'Új színsor', effect: 'keyframes', speed: 128, intensity: 128,
      frames: [
        { color: '#FF5A00', fade: 2000, hold: 2000 },
        { color: '#B0128C', fade: 2000, hold: 2000 },
        { color: '#2A3CFF', fade: 2000, hold: 2000 },
      ],
    };
  }
  if (effect === 'playlist') {
    return {
      ledmode: 1, name: 'Új lejátszási lista', effect: 'playlist',
      steps: [
        { effect: 'rainbow', speed: 128, intensity: 60, duration: 15000 },
        { effect: 'twinkle', speed: 128, intensity: 128, colors: ['#FFFFFF', '#FFC864', '#64B4FF'], duration: 15000 },
      ],
    };
  }
  return modeToJson({ ...emptyMode(), name: effectLabel(effect), p: defaultParams(FX_ID[effect] ?? 0) });
}
