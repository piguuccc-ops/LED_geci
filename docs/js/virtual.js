// Virtuális ESP32: a firmware üzenetkezelésének JS mása.
// A bemutató módhoz és a teszteléshez kell; ugyanazt a bájt-protokollt beszéli, mint a valódi eszköz.
import { PKT, CMD } from './protocol.js';
import { compileMode, modeToJson } from './modes.js';
import { emptyMode } from './engine.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const EXAMPLES = [
  { name: 'Szivárvány', effect: 'rainbow', speed: 110, intensity: 60 },
  { name: 'Tábortűz', effect: 'fire', speed: 128, intensity: 140 },
  { name: 'Naplemente', effect: 'keyframes', frames: [{ color: '#FF5A00', fade: 4000, hold: 3000 }, { color: '#FF1E3C', fade: 4000, hold: 3000 }, { color: '#7A1FA2', fade: 4000, hold: 3000 }, { color: '#2A0A6E', fade: 4000, hold: 3000 }] },
  { name: 'Csillagos ég', effect: 'twinkle', speed: 70, intensity: 110, colors: ['#FFFFFF', '#9EC8FF', '#FFE6B0'] },
  { name: 'Óceán', effect: 'wave', speed: 70, intensity: 48, colors: ['#00A0FF', '#001850'] },
];

const PINS = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];

export class VirtualFirmware {
  constructor({ name = 'Fenycsik-DEMO', mtu = 23, onNotify } = {}) {
    this.mtu = mtu;
    this.onNotify = onNotify || (() => {});
    this.cfg = { type: 'rgb', order: 'GRB', count: 60, pin: 4, apins: [25, 26, 27, -1], maxmA: 1500, gamma: true, autoWhite: true, name };
    this.on = true;
    this.bri = 160;
    this.sleepAt = 0;
    this.mode = compileMode({ name: 'Szivárvány', effect: 'rainbow' });
    this.lib = new Map();
    for (const e of EXAMPLES) this.lib.set(e.name, modeToJson(compileMode(e)));
    this.asm = null;
    this.timer = null;
  }

  // ---- bejövő bájtok (mint a ble.cpp handlePacket)
  receive(bytes) {
    const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const t = d[0];
    if (t >= 0x10) { this.onFast(d); return; }
    if (t === PKT.SINGLE) { this.onJson(dec.decode(d.slice(1))); return; }
    if (t === PKT.START) { this.asm = [d.slice(1)]; return; }
    if ((t === PKT.CONT || t === PKT.END) && this.asm) {
      this.asm.push(d.slice(1));
      if (t === PKT.END) {
        const total = this.asm.reduce((s, p) => s + p.length, 0);
        if (total > 8192) { this.asm = null; this.err('rx', 'too_large'); return; }
        const all = new Uint8Array(total);
        let o = 0;
        for (const p of this.asm) { all.set(p, o); o += p.length; }
        this.asm = null;
        this.onJson(dec.decode(all));
      }
    }
  }

  // ---- kimenő üzenet csomagokra bontva, a megadott MTU szerint
  send(obj) {
    const bytes = enc.encode(JSON.stringify(obj));
    const chunk = Math.min(244, this.mtu > 24 ? this.mtu - 4 : 19);
    const pkt = (type, part) => { const p = new Uint8Array(part.length + 1); p[0] = type; p.set(part, 1); return p; };
    if (bytes.length <= chunk) { this.onNotify(pkt(PKT.SINGLE, bytes)); return; }
    for (let off = 0; off < bytes.length; off += chunk) {
      const n = Math.min(chunk, bytes.length - off);
      const type = off === 0 ? PKT.START : off + n >= bytes.length ? PKT.END : PKT.CONT;
      this.onNotify(pkt(type, bytes.subarray(off, off + n)));
    }
  }

  err(op, msg) { this.send({ t: 'err', op, msg }); }

  info() {
    this.send({
      t: 'info', fw: '1.0.0', chip: 'ESP32', model: 'Bemutató (virtuális)', cfg: { ...this.cfg },
      pins: PINS, limits: { rgb: 1000, rgbw: 750, modes: 60, colors: 8, frames: 48, steps: 16, msg: 8192 },
      heap: 182000, fsUsed: 24576, fsTotal: 1441792, saved: this.lib.size,
    });
  }
  state() { this.send({ t: 'state', on: this.on, bri: this.bri, timer: this.sleepAt ? Math.max(0, Math.round((this.sleepAt - Date.now()) / 1000)) : 0, mA: 0 }); }
  cur() { this.send({ t: 'cur', mode: modeToJson(this.mode) }); }
  list() { this.send({ t: 'list', modes: [...this.lib.values()].map((m) => ({ name: m.name, effect: m.effect })).sort((a, b) => (a.name < b.name ? -1 : 1)) }); }

  scheduleBroadcast(mode) {
    this.pendingMode = this.pendingMode || mode;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.pendingMode) this.cur();
      this.state();
      this.pendingMode = false;
    }, 300);
  }

  play(m) {
    this.mode = m;
    if (m.brightness >= 0) this.bri = m.brightness;
    this.on = true;
    this.scheduleBroadcast(true);
  }

  onFast(d) {
    switch (d[0]) {
      case CMD.COLOR:
        if (this.mode.p.fx !== 0) this.mode = emptyMode();
        this.mode.p.col[0] = [d[1], d[2], d[3], d[4] || 0];
        this.on = true;
        this.scheduleBroadcast(true);
        break;
      case CMD.BRI: this.bri = d[1]; this.scheduleBroadcast(false); break;
      case CMD.POWER: this.on = !!d[1]; this.scheduleBroadcast(false); break;
      case CMD.SPEED: this.mode.p.speed = d[1]; this.scheduleBroadcast(true); break;
      case CMD.INTENS: this.mode.p.intensity = d[1]; this.scheduleBroadcast(true); break;
      case CMD.PCOLOR: {
        const i = d[1];
        if (i < 8) {
          while (this.mode.p.col.length < i) this.mode.p.col.push([0, 0, 0, 0]);
          this.mode.p.col[i] = [d[2], d[3], d[4], d[5] || 0];
        }
        this.scheduleBroadcast(true);
        break;
      }
    }
  }

  onJson(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { this.err('?', 'parse'); return; }
    const t = msg.t || '';
    try {
      switch (t) {
        case 'hello': this.info(); this.state(); this.cur(); this.list(); break;
        case 'play': {
          let m;
          if (msg.mode) m = compileMode(msg.mode);
          else {
            const j = this.lib.get(msg.name || '');
            if (!j) { this.err('play', 'not_found'); return; }
            m = compileMode(j);
          }
          this.play(m);
          break;
        }
        case 'save': {
          const m = compileMode(msg.mode);
          if (!m.name) { this.err('save', 'no_name'); return; }
          if (!this.lib.has(m.name) && this.lib.size >= 60) { this.err('save', 'full'); return; }
          this.lib.set(m.name, modeToJson(m));
          this.send({ t: 'ok', op: 'save', name: m.name });
          this.list();
          if (msg.play) this.play(m);
          break;
        }
        case 'del':
          if (!this.lib.delete(msg.name || '')) { this.err('del', 'not_found'); return; }
          this.send({ t: 'ok', op: 'del', name: msg.name });
          this.list();
          break;
        case 'list': this.list(); break;
        case 'get': {
          const j = this.lib.get(msg.name || '');
          if (!j) { this.err('get', 'not_found'); return; }
          this.send({ t: 'mode', mode: j });
          break;
        }
        case 'cfg': this.applyCfg(msg.cfg || {}); break;
        case 'timer': {
          const min = Number.isInteger(msg.min) ? msg.min : 0;
          this.sleepAt = min > 0 ? Date.now() + Math.min(min, 1440) * 60000 : 0;
          this.state();
          break;
        }
        case 'power': this.on = msg.on !== false; this.scheduleBroadcast(false); break;
        case 'reboot': this.reboot(); break;
        default: this.err(t, 'unknown_cmd');
      }
    } catch (e) {
      this.err(t, e.code || 'bad_mode');
    }
  }

  applyCfg(c) {
    const n = { ...this.cfg, apins: [...this.cfg.apins] };
    if (c.type !== undefined) {
      if (!['rgb', 'rgbw', 'analog'].includes(c.type)) { this.err('cfg', 'bad_type'); return; }
      n.type = c.type;
    }
    if (typeof c.order === 'string') n.order = c.order.toUpperCase();
    if (n.type !== 'analog') {
      const want = n.type === 'rgbw' ? 'RGBW' : 'RGB';
      const ok = n.order.length === want.length && [...want].every((ch) => n.order.includes(ch));
      if (!ok) {
        if (typeof c.order === 'string') { this.err('cfg', 'bad_order'); return; }
        n.order = n.type === 'rgbw' ? 'GRBW' : 'GRB';
      }
    }
    const max = n.type === 'rgbw' ? 750 : 1000;
    if (Number.isInteger(c.count)) n.count = Math.max(1, Math.min(max, c.count));
    n.count = Math.min(n.count, max);
    if (Number.isInteger(c.pin)) { if (!PINS.includes(c.pin)) { this.err('cfg', 'bad_pin'); return; } n.pin = c.pin; }
    if (Array.isArray(c.apins)) {
      for (let k = 0; k < 4; k++) {
        const p = Number.isInteger(c.apins[k]) ? c.apins[k] : -1;
        if ((k < 3 || p >= 0) && !PINS.includes(p)) { this.err('cfg', 'bad_pin'); return; }
        n.apins[k] = p;
      }
      const used = n.apins.filter((p) => p >= 0);
      if (new Set(used).size !== used.length) { this.err('cfg', 'dup_pin'); return; }
    }
    if (Number.isInteger(c.maxmA)) n.maxmA = Math.max(0, Math.min(60000, c.maxmA));
    if (typeof c.gamma === 'boolean') n.gamma = c.gamma;
    if (typeof c.autoWhite === 'boolean') n.autoWhite = c.autoWhite;
    if (typeof c.name === 'string') { if (!c.name) { this.err('cfg', 'bad_name'); return; } n.name = c.name.slice(0, 24); }
    const reboot = n.type !== this.cfg.type || n.order !== this.cfg.order || n.pin !== this.cfg.pin ||
      n.apins.join() !== this.cfg.apins.join() || n.name !== this.cfg.name;
    this.cfg = n;
    this.info();
    if (reboot) { this.send({ t: 'reboot' }); this.reboot(); }
  }

  reboot() { this.onReboot?.(); }
}

// A bemutató mód "kapcsolata": ugyanaz a felület, mint a BleLink
export class DemoLink extends EventTarget {
  constructor() {
    super();
    this.kind = 'demo';
    this.state = 'idle';
    this.name = 'Bemutató szalag';
    this.fw = null;
  }
  static supported() { return true; }
  setState(s) { this.state = s; this.dispatchEvent(new CustomEvent('state', { detail: s })); }

  async request() {
    this.setState('connecting');
    await new Promise((r) => setTimeout(r, 350));
    if (!this.fw) {
      const parts = [];
      this.fw = new VirtualFirmware({
        name: 'Bemutató szalag',
        mtu: 23,
        onNotify: (p) => {
          const t = p[0];
          if (t === PKT.SINGLE) { this.emit(JSON.parse(dec.decode(p.slice(1)))); return; }
          if (t === PKT.START) parts.length = 0;
          parts.push(p.slice(1));
          if (t === PKT.END) {
            const all = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
            let o = 0;
            for (const x of parts) { all.set(x, o); o += x.length; }
            this.emit(JSON.parse(dec.decode(all)));
          }
        },
      });
      this.fw.onReboot = () => {
        this.setState('reconnecting');
        setTimeout(() => { this.setState('connected'); this.fw.onJson('{"t":"hello"}'); }, 1500);
      };
    }
    this.setState('connected');
    setTimeout(() => this.fw.onJson('{"t":"hello"}'), 0);
  }
  async tryKnown() { return false; }
  emit(msg) { setTimeout(() => this.dispatchEvent(new CustomEvent('message', { detail: msg })), 15); }
  async disconnect() { this.setState('idle'); }
  sendFast(key, bytes) { if (this.state === 'connected') this.fw.receive(bytes); }
  async sendJson(obj) {
    if (this.state !== 'connected') throw new Error('not_connected');
    const { frameJson } = await import('./protocol.js');
    for (const p of frameJson(obj)) this.fw.receive(p);
  }
}

