// BLE protokoll – a firmware ble.h fájljával egyezik
export const SVC_UUID = 'f3c10001-6a2e-4b1d-9c58-2d7e0a4b9e17';
export const RX_UUID = 'f3c10002-6a2e-4b1d-9c58-2d7e0a4b9e17';
export const TX_UUID = 'f3c10003-6a2e-4b1d-9c58-2d7e0a4b9e17';

export const PKT = { START: 0x01, CONT: 0x02, END: 0x03, SINGLE: 0x04 };
export const CMD = { COLOR: 0x10, BRI: 0x11, POWER: 0x12, SPEED: 0x13, INTENS: 0x14, PCOLOR: 0x15 };

const enc = new TextEncoder();
const dec = new TextDecoder();

// JSON -> csomagok (írás válasszal; a hosszú írást a BLE verem is kezelné, de így kíméletesebb)
export function frameJson(obj, chunk = 180) {
  const bytes = enc.encode(JSON.stringify(obj));
  const pkt = (type, part) => { const p = new Uint8Array(part.length + 1); p[0] = type; p.set(part, 1); return p; };
  if (bytes.length <= chunk) return [pkt(PKT.SINGLE, bytes)];
  const out = [];
  for (let off = 0; off < bytes.length; off += chunk) {
    const part = bytes.subarray(off, off + chunk);
    const type = off === 0 ? PKT.START : off + chunk >= bytes.length ? PKT.END : PKT.CONT;
    out.push(pkt(type, part));
  }
  return out;
}

// Beérkező értesítések összerakása üzenetekké
export class Reassembler {
  constructor() { this.parts = null; }
  reset() { this.parts = null; }
  push(u8) {
    if (!u8.length) return null;
    const t = u8[0], body = u8.slice(1);
    if (t === PKT.SINGLE) return parse(body);
    if (t === PKT.START) { this.parts = [body]; return null; }
    if (!this.parts) return null;
    this.parts.push(body);
    if (t !== PKT.END) return null;
    const total = this.parts.reduce((s, p) => s + p.length, 0);
    const all = new Uint8Array(total);
    let o = 0;
    for (const p of this.parts) { all.set(p, o); o += p.length; }
    this.parts = null;
    return parse(all);
  }
}

function parse(bytes) {
  try { return JSON.parse(dec.decode(bytes)); } catch { return null; }
}

export const fastColor = (c) => Uint8Array.of(CMD.COLOR, c[0], c[1], c[2], c[3] || 0);
export const fastBri = (v) => Uint8Array.of(CMD.BRI, v);
export const fastPower = (on) => Uint8Array.of(CMD.POWER, on ? 1 : 0);
export const fastSpeed = (v) => Uint8Array.of(CMD.SPEED, v);
export const fastIntensity = (v) => Uint8Array.of(CMD.INTENS, v);
export const fastPaletteColor = (i, c) => Uint8Array.of(CMD.PCOLOR, i, c[0], c[1], c[2], c[3] || 0);
