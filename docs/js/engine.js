// Effekt motor – a firmware effects.cpp pontos mása (egész aritmetikával),
// hogy az appban látott előnézet pixelre megegyezzen a szalaggal.
// Színek: [r, g, b, w] tömbök. Kimenet: Uint8Array, pixelenként 4 bájt.

export const FX = ['solid', 'breathe', 'rainbow', 'colorloop', 'gradient', 'chase',
  'comet', 'scanner', 'twinkle', 'fire', 'strobe', 'wave', 'keyframes', 'playlist'];
export const FX_ID = Object.fromEntries(FX.map((n, i) => [n, i]));

//                    sol brt rnb clp grd chs cmt scn twk fir stb wav key pls
const DEF_SPEED = [128, 100, 128, 100, 50, 128, 128, 128, 128, 128, 128, 100, 128, 128];
const DEF_INT = [128, 200, 60, 128, 0, 0, 100, 60, 128, 128, 30, 64, 128, 128];

export const MAX_LEDS = 1000;
export const MAX_COLORS = 8;
export const MAX_FRAMES = 48;
export const MAX_STEPS = 16;

const SIN8 = [
  128, 131, 134, 137, 140, 143, 146, 149, 152, 155, 158, 162, 165, 167, 170, 173, 176, 179, 182, 185, 188, 190, 193, 196, 198, 201, 203, 206, 208, 211, 213, 215,
  218, 220, 222, 224, 226, 228, 230, 232, 234, 235, 237, 238, 240, 241, 243, 244, 245, 246, 248, 249, 250, 250, 251, 252, 253, 253, 254, 254, 254, 255, 255, 255,
  255, 255, 255, 255, 254, 254, 254, 253, 253, 252, 251, 250, 250, 249, 248, 246, 245, 244, 243, 241, 240, 238, 237, 235, 234, 232, 230, 228, 226, 224, 222, 220,
  218, 215, 213, 211, 208, 206, 203, 201, 198, 196, 193, 190, 188, 185, 182, 179, 176, 173, 170, 167, 165, 162, 158, 155, 152, 149, 146, 143, 140, 137, 134, 131,
  127, 124, 121, 118, 115, 112, 109, 106, 103, 100, 97, 93, 90, 88, 85, 82, 79, 76, 73, 70, 67, 65, 62, 59, 57, 54, 52, 49, 47, 44, 42, 40,
  37, 35, 33, 31, 29, 27, 25, 23, 21, 20, 18, 17, 15, 14, 12, 11, 10, 9, 7, 6, 5, 5, 4, 3, 2, 2, 1, 1, 1, 0, 0, 0,
  0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 5, 5, 6, 7, 9, 10, 11, 12, 14, 15, 17, 18, 20, 21, 23, 25, 27, 29, 31, 33, 35,
  37, 40, 42, 44, 47, 49, 52, 54, 57, 59, 62, 65, 67, 70, 73, 76, 79, 82, 85, 88, 90, 93, 97, 100, 103, 106, 109, 112, 115, 118, 121, 124];

export const sin8 = (x) => SIN8[x & 255];
const BLACK = [0, 0, 0, 0];
const WHITE = [255, 255, 255, 0];
const fl = Math.floor;
const u16 = (x) => ((x % 65536) + 65536) % 65536;
const qsub8 = (a, b) => (a > b ? a - b : 0);
const qadd8 = (a, b) => Math.min(255, a + b);

export function blend(a, b, t) {
  const it = 255 - t;
  return [fl((a[0] * it + b[0] * t + 127) / 255), fl((a[1] * it + b[1] * t + 127) / 255),
    fl((a[2] * it + b[2] * t + 127) / 255), fl((a[3] * it + b[3] * t + 127) / 255)];
}

export function scale(c, s) {
  return [fl((c[0] * s + 127) / 255), fl((c[1] * s + 127) / 255),
    fl((c[2] * s + 127) / 255), fl((c[3] * s + 127) / 255)];
}

export function hsv16(hue, sat, val) {
  let r, g, b;
  const h = fl((hue * 1530 + 32768) / 65536);
  if (h < 510) {
    b = 0;
    if (h < 255) { r = 255; g = h; } else { r = 510 - h; g = 255; }
  } else if (h < 1020) {
    r = 0;
    if (h < 765) { g = 255; b = h - 510; } else { g = 1020 - h; b = 255; }
  } else if (h < 1530) {
    g = 0;
    if (h < 1275) { r = h - 1020; b = 255; } else { r = 255; b = 1530 - h; }
  } else { r = 255; g = 0; b = 0; }
  const v1 = 1 + val, s1 = 1 + sat, s2 = 255 - sat;
  r = ((((r * s1) >> 8) + s2) * v1) >> 8;
  g = ((((g * s1) >> 8) + s2) * v1) >> 8;
  b = ((((b * s1) >> 8) + s2) * v1) >> 8;
  return [r & 255, g & 255, b & 255, 0];
}

// xorshift32 – ugyanaz, mint a firmware-ben
let rng = 0x9E3779B9;
export function rndSeed(s) { rng = (s >>> 0) || 1; }
export function rnd32() {
  let x = rng;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  rng = x;
  return x;
}
const rnd8 = () => rnd32() & 255;
const rndRange = (n) => (n ? rnd32() % n : 0);
rndSeed((Math.random() * 0xFFFFFFFF) >>> 0);

export const speedRate = (s) => (s ? fl((s * s) / 128) + 1 : 0);
export const fxDefaultSpeed = (fx) => DEF_SPEED[fx] ?? 128;
export const fxDefaultIntensity = (fx) => DEF_INT[fx] ?? 128;

// Effekt alapértelmezett paraméterei (FxParams::reset)
export function defaultParams(fx) {
  fx = fx >= 0 && fx < FX.length ? fx : 0;
  const p = { fx, speed: DEF_SPEED[fx], intensity: DEF_INT[fx], reverse: false, col: [], duration: 10000 };
  const c = (r, g, b) => [r, g, b, 0];
  switch (fx) {
    case 0: p.col = [c(255, 255, 255)]; break;
    case 1: p.col = [c(0x3C, 0x8C, 0xFF)]; break;
    case 4: p.col = [c(0xFF, 0x40, 0x00), c(0xFF, 0x00, 0xA0), c(0x40, 0x00, 0xFF)]; break;
    case 5: p.col = [c(0xFF, 0, 0)]; break;
    case 6: p.col = [c(0x00, 0xC8, 0xFF)]; break;
    case 7: p.col = [c(0xFF, 0, 0)]; break;
    case 8: p.col = [c(255, 255, 255), c(0xFF, 0xC8, 0x64), c(0x64, 0xB4, 0xFF)]; break;
    case 10: p.col = [c(255, 255, 255)]; break;
    case 11: p.col = [c(0x00, 0x64, 0xFF)]; break;
    default: break;
  }
  return p;
}

export function emptyMode() {
  return { name: '', p: defaultParams(0), brightness: -1, loop: true, transition: 600, frames: [], steps: [] };
}

function heatColor(h, p) {
  if (p.col.length === 0) {
    const t192 = fl((h * 191) / 255);
    const ramp = (t192 & 0x3F) << 2;
    if (t192 & 0x80) return [255, 255, ramp, 0];
    if (t192 & 0x40) return [255, ramp, 0, 0];
    return [ramp, 0, 0, 0];
  }
  const ncol = p.col.length, nst = ncol + 1;
  const s = h * 257 * (nst - 1);
  const seg = fl(s / 65536);
  if (seg >= nst - 1) return p.col[ncol - 1];
  const frac = fl((s % 65536) / 256);
  const a = seg === 0 ? BLACK : p.col[seg - 1];
  return blend(a, p.col[seg], frac);
}

export class Engine {
  constructor(n = 60, now = 0) {
    this.mode = emptyMode();
    this.n = 1;
    this.last = now;
    this.setLength(n);
  }

  setLength(n) {
    n = Math.max(1, Math.min(MAX_LEDS, n | 0));
    this.n = n;
    this.out = new Uint8Array(n * 4);
    this.lastOut = new Uint8Array(n * 4);
    this.prev = new Uint8Array(n * 4);
    this.heat = new Uint8Array(n);
    this.tw = new Uint8Array(n);
    this.twc = new Uint8Array(n);
    this.inTrans = false;
    this.resetState();
  }

  resetState() {
    this.phase = 0;
    this.kfAcc = 0;
    this.acc = 0;
    this.spawnAcc = 0;
    this.heat.fill(0);
    this.tw.fill(0);
    this.twc.fill(0);
  }

  startTransition(now, ms) {
    if (!ms) { this.inTrans = false; return; }
    this.prev.set(this.lastOut);
    this.transStart = now;
    this.transDur = ms;
    this.inTrans = true;
  }

  play(mode, now, fadeMs = 400) {
    this.startTransition(now, fadeMs);
    this.mode = mode;
    this.step = 0;
    this.stepStart = now;
    this.resetState();
  }

  setSolid(c, now) {
    if (this.mode.p.fx !== 0) {
      this.startTransition(now, 150);
      this.mode = emptyMode();
      this.resetState();
    }
    this.mode.p.col[0] = c.slice(0, 4);
  }
  setSpeed(s) { this.mode.p.speed = s; }
  setIntensity(i) { this.mode.p.intensity = i; }
  setColor(idx, c) {
    if (idx >= MAX_COLORS) return;
    const col = this.mode.p.col;
    while (col.length < idx) col.push([0, 0, 0, 0]);
    col[idx] = c.slice(0, 4);
  }

  fill(c) {
    const o = this.out;
    for (let i = 0; i < this.n; i++) { o[i * 4] = c[0]; o[i * 4 + 1] = c[1]; o[i * 4 + 2] = c[2]; o[i * 4 + 3] = c[3]; }
  }
  put(i, c) {
    const o = this.out, k = i * 4;
    o[k] = c[0]; o[k + 1] = c[1]; o[k + 2] = c[2]; o[k + 3] = c[3];
  }

  palCyclic(p, pos) {
    const ncol = p.col.length;
    if (ncol === 0) return BLACK;
    if (ncol === 1) return p.col[0];
    const s = pos * ncol, seg = fl(s / 65536), frac = fl((s % 65536) / 256);
    return blend(p.col[seg], p.col[(seg + 1) % ncol], frac);
  }

  palLinear(p, pos) {
    const ncol = p.col.length;
    if (ncol === 0) return BLACK;
    if (ncol === 1) return p.col[0];
    const s = pos * (ncol - 1), seg = fl(s / 65536);
    if (seg >= ncol - 1) return p.col[ncol - 1];
    return blend(p.col[seg], p.col[seg + 1], fl((s % 65536) / 256));
  }

  // now: egész ms. Visszaad: Uint8Array (n * 4)
  render(now) {
    let dt = now - this.last;
    if (dt > 100) dt = 100;
    if (dt < 0) dt = 0;
    this.last = now;
    const m = this.mode;
    let p = m.p;
    let skip = false;
    if (m.p.fx === 13) {
      if (!m.steps.length) { this.fill(BLACK); skip = true; } else {
        if (this.step >= m.steps.length) this.step = 0;
        if (now - this.stepStart >= m.steps[this.step].duration) {
          const lastStep = this.step + 1 >= m.steps.length;
          if (!lastStep || m.loop) {
            this.startTransition(now, m.transition);
            this.step = lastStep ? 0 : this.step + 1;
            this.stepStart = now;
            this.resetState();
          }
        }
        p = m.steps[this.step];
      }
    }
    if (!skip) {
      let rate = speedRate(p.speed);
      if (p.fx === 10 && rate > 256) rate = 256;
      this.phase += dt * rate;
      if (p.fx === 12) this.kfAcc += dt * rate;
      if (p.fx === 8) this.fxTwinkle(p, dt, rate);
      else if (p.fx === 9) this.fxFire(p, dt, rate);
      else this.renderFx(p);
    }
    const o = this.out, n4 = this.n * 4;
    if (this.inTrans) {
      const el = now - this.transStart;
      if (el >= this.transDur) this.inTrans = false;
      else {
        const t = fl((el * 255) / this.transDur), it = 255 - t, pv = this.prev;
        for (let k = 0; k < n4; k++) o[k] = fl((pv[k] * it + o[k] * t + 127) / 255);
      }
    }
    this.lastOut.set(o);
    return o;
  }

  renderFx(p) {
    switch (p.fx) {
      case 0: this.fill(p.col.length ? p.col[0] : BLACK); break;
      case 1: this.fxBreathe(p); break;
      case 2: this.fxRainbow(p); break;
      case 3: {
        const h = u16(fl(this.phase / 8));
        this.fill(hsv16(p.reverse ? u16(-h) : h, 255, 255));
        break;
      }
      case 4: this.fxGradient(p); break;
      case 5: this.fxChase(p); break;
      case 6: this.fxComet(p); break;
      case 7: this.fxScanner(p); break;
      case 10: this.fxStrobe(p); break;
      case 11: this.fxWave(p); break;
      case 12: this.fxKeyframes(); break;
      default: this.fill(BLACK);
    }
  }

  fxBreathe(p) {
    const C = 524288;
    const cyc = fl(this.phase / C);
    const a = (fl(((this.phase % C) * 256) / C) + 64) & 255;
    const v = 255 - SIN8[a];
    const inv = 255 - p.intensity;
    const minv = (inv * inv) >> 8;
    const lvl = minv + fl(((255 - minv) * v) / 255);
    const c = p.col.length ? p.col[cyc % p.col.length] : WHITE;
    this.fill(scale(c, lvl));
  }

  fxRainbow(p) {
    const off = u16(fl(this.phase / 8));
    const reps88 = 64 + fl((p.intensity * 960) / 255);
    const step = fl((65536 * reps88) / (256 * this.n));
    for (let i = 0; i < this.n; i++) {
      const h = p.reverse ? u16(i * step + off) : u16(i * step - off);
      this.put(i, hsv16(h, 255, 255));
    }
  }

  fxGradient(p) {
    const n = this.n, ncol = p.col.length;
    if (ncol <= 1) { this.fill(ncol ? p.col[0] : BLACK); return; }
    if (p.speed === 0) {
      for (let i = 0; i < n; i++) {
        const pos = n > 1 ? fl((i * 65535) / (n - 1)) : 0;
        this.put(p.reverse ? n - 1 - i : i, this.palLinear(p, pos));
      }
      return;
    }
    const off = u16(fl(this.phase / 8));
    const reps88 = 256 + fl((p.intensity * 768) / 255);
    const step = fl((65536 * reps88) / (256 * n));
    for (let i = 0; i < n; i++) {
      const pos = p.reverse ? u16(i * step + off) : u16(i * step - off);
      this.put(i, this.palCyclic(p, pos));
    }
  }

  fxChase(p) {
    const size = 1 + fl(p.intensity / 32);
    const period = size * 3;
    const off = fl(this.phase / 16384);
    const ncol = p.col.length, nc = ncol || 1;
    for (let i = 0; i < this.n; i++) {
      const x = p.reverse ? i + off : i - off;
      let m = x % period;
      if (m < 0) m += period;
      const blk = (x - m) / period;
      let ci = blk % nc;
      if (ci < 0) ci += nc;
      this.put(i, m < size ? (ncol ? p.col[ci] : WHITE) : BLACK);
    }
  }

  fxComet(p) {
    const n = this.n, span = n * 256;
    const pos = fl(this.phase / 16);
    const head = pos % span;
    const lap = fl(pos / span);
    const L = 512 + fl((p.intensity * (n > 2 ? n - 2 : 0) * 256) / 510);
    const c = p.col.length ? p.col[lap % p.col.length] : WHITE;
    for (let i = 0; i < n; i++) {
      let d = head - i * 256;
      if (d < 0) d += span;
      let v = 0;
      if (d < L) {
        const f = 255 - fl((d * 255) / L);
        v = fl((f * f) / 255);
      }
      this.put(p.reverse ? n - 1 - i : i, scale(c, v));
    }
  }

  fxScanner(p) {
    const n = this.n;
    if (n < 2) { this.fxBreathe(p); return; }
    const span = (n - 1) * 256;
    const t = fl(this.phase / 16);
    const m = t % (2 * span);
    const pos = m < span ? m : 2 * span - m;
    const bounces = fl(t / span);
    const W = 256 + fl((p.intensity * n) / 4);
    const c = p.col.length ? p.col[bounces % p.col.length] : [255, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i * 256 - pos);
      let v = 0;
      if (d < W) {
        const f = 255 - fl((d * 255) / W);
        v = fl((f * f) / 255);
      }
      this.put(i, scale(c, v));
    }
  }

  fxTwinkle(p, dt, rate) {
    const n = this.n, ncol = p.col.length;
    this.acc += dt * rate;
    const d = this.acc >>> 8;
    this.acc &= 255;
    const dec = d > 255 ? 255 : d;
    for (let i = 0; i < n; i++) this.tw[i] = qsub8(this.tw[i], dec);
    const SPAWN = 134217728;
    this.spawnAcc += dt * rate * (p.intensity + 1) * n;
    let spawns = 0;
    while (this.spawnAcc >= SPAWN && spawns < 64) { this.spawnAcc -= SPAWN; spawns++; }
    if (this.spawnAcc >= SPAWN) this.spawnAcc = 0;
    for (let k = 0; k < spawns; k++) {
      const i = rndRange(n);
      if (this.tw[i] < 64) {
        this.tw[i] = 255;
        this.twc[i] = ncol ? rndRange(ncol) : 0;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = ncol ? p.col[this.twc[i] % ncol] : WHITE;
      this.put(i, scale(c, this.tw[i]));
    }
  }

  fxFire(p, dt, rate) {
    const n = this.n, STEP = 2064, heat = this.heat;
    this.acc += dt * rate;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this.acc -= STEP;
      steps++;
      if (n < 8) {
        const target = 110 + rndRange(146);
        heat[0] = fl((heat[0] * 3 + target) / 4);
        continue;
      }
      const cooling = 100 - fl((p.intensity * 80) / 255);
      for (let i = 0; i < n; i++) {
        const c = rndRange(fl((cooling * 10) / n) + 2);
        heat[i] = qsub8(heat[i], c > 255 ? 255 : c);
      }
      for (let k = n - 1; k >= 2; k--) heat[k] = fl((heat[k - 1] + heat[k - 2] + heat[k - 2]) / 3);
      if (rnd8() < 120) {
        const y = rndRange(7);
        heat[y] = qadd8(heat[y], 160 + rndRange(96));
      }
    }
    if (this.acc >= STEP) this.acc = 0;
    if (n < 8) { this.fill(heatColor(heat[0], p)); return; }
    for (let i = 0; i < n; i++) this.put(p.reverse ? n - 1 - i : i, heatColor(heat[i], p));
  }

  fxStrobe(p) {
    const P = 26214;
    const cyc = fl(this.phase / P), pos = this.phase % P;
    const duty = fl((P * (10 + fl((p.intensity * 200) / 255))) / 256);
    this.fill(pos < duty ? (p.col.length ? p.col[cyc % p.col.length] : WHITE) : BLACK);
  }

  fxWave(p) {
    const n = this.n;
    const off = u16(fl(this.phase / 4));
    const waves = 1 + fl(p.intensity / 32);
    const step = fl((65536 * waves) / n);
    const fg = p.col.length ? p.col[0] : [0, 100, 255, 0];
    const bg = p.col.length >= 2 ? p.col[1] : BLACK;
    for (let i = 0; i < n; i++) {
      const a = p.reverse ? u16(i * step + off) : u16(i * step - off);
      this.put(i, blend(bg, fg, SIN8[a >> 8]));
    }
  }

  fxKeyframes() {
    const m = this.mode, fr = m.frames;
    if (!fr.length) { this.fill(BLACK); return; }
    const t = fl(this.kfAcc / 129);
    let total = 0;
    for (const f of fr) total += f.fade + f.hold;
    const lastC = fr[fr.length - 1].c;
    if (total === 0 || (!m.loop && t >= total)) { this.fill(lastC); return; }
    let tt = m.loop ? t % total : t;
    let prev = m.loop ? lastC : BLACK;
    for (const f of fr) {
      if (tt < f.fade) { this.fill(blend(prev, f.c, fl((tt * 255) / f.fade))); return; }
      tt -= f.fade;
      if (tt < f.hold) { this.fill(f.c); return; }
      tt -= f.hold;
      prev = f.c;
    }
    this.fill(lastC);
  }
}
