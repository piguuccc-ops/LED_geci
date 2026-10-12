// Web Bluetooth kapcsolat az ESP32-vel.
// Események: 'state' (detail: 'idle' | 'connecting' | 'connected' | 'reconnecting'),
//            'message' (detail: üzenet objektum), 'lost' (nem sikerült visszacsatlakozni)
import { SVC_UUID, RX_UUID, TX_UUID, frameJson, Reassembler } from './protocol.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BleLink extends EventTarget {
  constructor() {
    super();
    this.kind = 'ble';
    this.device = null;
    this.rx = null;
    this.tx = null;
    this.state = 'idle';
    this.queue = [];
    this.busy = false;
    this.asm = new Reassembler();
    this.want = false;
    this.onDisconnected = this.onDisconnected.bind(this);
    this.onNotify = this.onNotify.bind(this);
  }

  static supported() { return typeof navigator !== 'undefined' && !!navigator.bluetooth; }

  get name() { return this.device?.name || ''; }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent('state', { detail: s }));
  }

  // Eszközválasztó ablak (felhasználói kattintásból kell hívni)
  async request() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SVC_UUID] }],
      optionalServices: [SVC_UUID],
    });
    await this.attach(device);
  }

  // Korábban engedélyezett eszközhöz csatlakozás választó nélkül (ha a böngésző tudja)
  async tryKnown(preferredName) {
    if (!navigator.bluetooth?.getDevices) return false;
    let devices = [];
    try { devices = await navigator.bluetooth.getDevices(); } catch { return false; }
    if (!devices.length) return false;
    const d = devices.find((x) => x.name === preferredName) || devices[0];
    if (d.watchAdvertisements) {
      const ac = new AbortController();
      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 6000);
          d.addEventListener('advertisementreceived', () => { clearTimeout(t); resolve(); }, { once: true });
          d.watchAdvertisements({ signal: ac.signal }).catch((e) => { clearTimeout(t); reject(e); });
        });
      } catch { ac.abort(); return false; }
      ac.abort();
    }
    try { await this.attach(d); return true; } catch { this.setState('idle'); return false; }
  }

  async attach(device) {
    if (this.device && this.device !== device) this.device.removeEventListener('gattserverdisconnected', this.onDisconnected);
    this.device = device;
    device.addEventListener('gattserverdisconnected', this.onDisconnected);
    this.want = true;
    try {
      await this.connectGatt();
    } catch (e) {
      this.want = false;
      this.setState('idle');
      throw e;
    }
  }

  async connectGatt() {
    this.setState(this.state === 'reconnecting' ? 'reconnecting' : 'connecting');
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService(SVC_UUID);
    this.rx = await svc.getCharacteristic(RX_UUID);
    this.tx = await svc.getCharacteristic(TX_UUID);
    this.tx.removeEventListener('characteristicvaluechanged', this.onNotify);
    this.tx.addEventListener('characteristicvaluechanged', this.onNotify);
    await this.tx.startNotifications();
    this.asm.reset();
    this.setState('connected');
    this.sendJson({ t: 'hello' }).catch(() => {});
  }

  onDisconnected() {
    this.rx = this.tx = null;
    this.failQueue(new Error('disconnected'));
    if (this.want) this.reconnect();
    else this.setState('idle');
  }

  async reconnect() {
    this.setState('reconnecting');
    const waits = [400, 800, 1500, 2500, 4000, 5000, 5000, 5000];
    for (const w of waits) {
      if (!this.want) return;
      await sleep(w);
      if (!this.want) return;
      try { await this.connectGatt(); return; } catch { /* újrapróbáljuk */ }
    }
    this.want = false;
    this.setState('idle');
    this.dispatchEvent(new Event('lost'));
  }

  async disconnect() {
    this.want = false;
    this.failQueue(new Error('disconnected'));
    try { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); } catch { /* már nincs kapcsolat */ }
    this.rx = this.tx = null;
    this.setState('idle');
  }

  onNotify(e) {
    const v = e.target.value;
    const msg = this.asm.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    if (msg) this.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }

  failQueue(err) {
    for (const it of this.queue) it.reject?.(err);
    this.queue.length = 0;
  }

  // Gyors parancs: azonos kulcsú, még el nem küldött parancsot lecserél (a legfrissebb érték számít)
  sendFast(key, bytes) {
    if (!this.rx) return;
    const i = this.queue.findIndex((q) => q.key === key);
    if (i >= 0) this.queue.splice(i, 1);
    this.queue.push({ key, bytes });
    this.pump();
  }

  sendJson(obj) {
    return new Promise((resolve, reject) => {
      if (!this.rx) { reject(new Error('not_connected')); return; }
      this.queue.push({ packets: frameJson(obj), resolve, reject });
      this.pump();
    });
  }

  async write(bytes, withResponse) {
    const c = this.rx;
    if (!c) throw new Error('not_connected');
    if (withResponse) return c.writeValueWithResponse ? c.writeValueWithResponse(bytes) : c.writeValue(bytes);
    return c.writeValueWithoutResponse ? c.writeValueWithoutResponse(bytes) : c.writeValue(bytes);
  }

  // A Web Bluetooth egyszerre csak egy GATT műveletet enged: sorban küldünk
  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length && this.rx) {
        const it = this.queue.shift();
        try {
          if (it.packets) {
            for (const p of it.packets) await this.write(p, true);
            it.resolve();
          } else {
            await this.write(it.bytes, false);
            await sleep(14);
          }
        } catch (e) {
          it.reject?.(e);
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
