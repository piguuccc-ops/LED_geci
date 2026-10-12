// Szín segédfüggvények a felülethez (HSV a csúszkákhoz, Kelvin a fehérekhez)

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 };
}

export function hsvToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Tanner Helland közelítés, 1000–40000 K
export function kelvinToRgb(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [c(r), c(g), c(b)];
}

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const unlin = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

// RGBW szín képernyőre: a fehér csatornát melegfehérként hozzáadjuk
export function displayRgb(c) {
  const w = c[3] || 0;
  if (!w) return [c[0], c[1], c[2]];
  const ww = [255, 236, 210];
  return [0, 1, 2].map((i) => Math.min(255, c[i] + Math.round((ww[i] * w) / 255)));
}

// Fényerővel (0..1) arányosan sötétített szín lineáris térben – így néz ki a LED a képernyőn
export function dimmed(rgb, f) {
  return rgb.map((v) => Math.round(Math.max(0, Math.min(1, unlin(lin(v) * f))) * 255));
}

export const css = ([r, g, b], a = 1) => (a === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`);

// A felület kiemelő színe az aktuális fényből: ugyanaz az árnyalat, de mindig jól látható
export function uiAccent(rgb) {
  const { h, s, v } = rgbToHsv(...rgb);
  if (s < 12 || v < 8) return [236, 238, 242];
  return hsvToRgb(h, Math.min(s, 85), Math.max(v, 92));
}

export const textOn = (rgb) => (luminance(rgb) > 0.36 ? '#000000' : '#FFFFFF');

export const PRESETS = [
  { name: 'Piros', hex: '#FF0000' },
  { name: 'Narancs', hex: '#FF5A00' },
  { name: 'Borostyán', hex: '#FFA200' },
  { name: 'Sárga', hex: '#FFE000' },
  { name: 'Lime', hex: '#8CFF00' },
  { name: 'Zöld', hex: '#00FF30' },
  { name: 'Türkiz', hex: '#00FFC0' },
  { name: 'Égkék', hex: '#00A8FF' },
  { name: 'Kék', hex: '#0028FF' },
  { name: 'Ibolya', hex: '#7A1CFF' },
  { name: 'Bíbor', hex: '#FF00D4' },
  { name: 'Rózsa', hex: '#FF2E6E' },
];

export const WHITES = [
  { name: 'Gyertyafény 1900 K', k: 1900 },
  { name: 'Meleg fehér 2700 K', k: 2700 },
  { name: 'Semleges 4000 K', k: 4000 },
  { name: 'Hideg fehér 6500 K', k: 6500 },
];
