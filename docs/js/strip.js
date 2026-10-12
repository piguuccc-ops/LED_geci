// LED szalag kirajzolása vászonra: a fő "élő szalag" és a kis előnézetek
import { Engine } from './engine.js';
import { displayRgb, dimmed } from './color.js';

function fitCanvas(cv) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const hh = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
  return dpr;
}

// Nagy szalag: 5050-es LED tokok fénylő lencsével, fekete alapon
export class HeroStrip {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.single = false;  // analóg szalag: egy színű az egész
  }

  draw(buf, n, level) {
    const cv = this.cv, ctx = this.ctx;
    const dpr = fitCanvas(cv);
    const W = cv.width, H = cv.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const minPitch = 13 * dpr, maxPitch = 30 * dpr;
    const shown = this.single ? Math.floor(W / (18 * dpr)) : Math.max(1, Math.min(n, Math.floor(W / minPitch)));
    const pitch = Math.min(maxPitch, W / shown);
    const x0 = (W - pitch * shown) / 2 + pitch / 2;
    const cy = H / 2;
    const size = Math.min(pitch * 0.62, H * 0.42);

    // szalag (hordozó)
    ctx.fillStyle = '#0d0f12';
    const tapeH = size * 1.55;
    ctx.fillRect(0, cy - tapeH / 2, W, tapeH);
    ctx.fillStyle = '#16191e';
    ctx.fillRect(0, cy - tapeH / 2, W, Math.max(1, dpr * 0.75));
    ctx.fillRect(0, cy + tapeH / 2 - Math.max(1, dpr * 0.75), W, Math.max(1, dpr * 0.75));

    const colors = new Array(shown);
    for (let k = 0; k < shown; k++) {
      let idx;
      if (this.single) idx = 0;
      else if (shown === n) idx = k;
      else {  // több LED jut egy pontra: a legfényesebbet mutatjuk, hogy a csillogás is látsszon
        const a = Math.floor((k * n) / shown), b = Math.max(a + 1, Math.floor(((k + 1) * n) / shown));
        idx = a;
        let best = -1;
        for (let i = a; i < b; i++) {
          const s = buf[i * 4] + buf[i * 4 + 1] + buf[i * 4 + 2] + buf[i * 4 + 3];
          if (s > best) { best = s; idx = i; }
        }
      }
      colors[k] = dimmed(displayRgb([buf[idx * 4], buf[idx * 4 + 1], buf[idx * 4 + 2], buf[idx * 4 + 3]]), level);
    }

    // tokok
    for (let k = 0; k < shown; k++) {
      const x = x0 + k * pitch;
      ctx.fillStyle = '#23262c';
      roundRect(ctx, x - size / 2, cy - size / 2, size, size, size * 0.14);
      ctx.fill();
      const [r, g, b] = colors[k];
      const lit = Math.max(r, g, b);
      ctx.fillStyle = lit ? `rgb(${r},${g},${b})` : '#101215';
      ctx.beginPath();
      ctx.arc(x, cy, size * 0.36, 0, Math.PI * 2);
      ctx.fill();
    }

    // ragyogás
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < shown; k++) {
      const [r, g, b] = colors[k];
      const lit = Math.max(r, g, b) / 255;
      if (lit < 0.02) continue;
      const x = x0 + k * pitch;
      const rad = pitch * 1.25 + size * 0.6;
      const gr = ctx.createRadialGradient(x, cy, size * 0.2, x, cy, rad);
      gr.addColorStop(0, `rgba(${r},${g},${b},${0.55 * lit})`);
      gr.addColorStop(0.35, `rgba(${r},${g},${b},${0.18 * lit})`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(x - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Kis előnézet: egy sor apró LED, saját motorral
export function drawMini(cv, buf, n) {
  const ctx = cv.getContext('2d');
  const dpr = fitCanvas(cv);
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const pitch = W / n, s = Math.max(1, Math.min(pitch * 0.7, H * 0.8)), cy = H / 2;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = displayRgb([buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2], buf[i * 4 + 3]]);
    ctx.fillStyle = Math.max(r, g, b) ? `rgb(${r},${g},${b})` : '#1c1f25';
    const x = i * pitch + (pitch - s) / 2;
    ctx.fillRect(Math.round(x), Math.round(cy - s / 2), Math.max(1, Math.round(s)), Math.max(1, Math.round(s)));
  }
  return dpr;
}

// Közös animációs ciklus az összes előnézethez
const previews = new Set();
let hero = null;
let running = false;
const visible = new WeakMap();
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => { for (const e of entries) visible.set(e.target, e.isIntersecting); })
  : null;

export function setHeroRenderer(fn) { hero = fn; start(); }

export function addPreview(canvas, mode, n = 24) {
  const eng = new Engine(n, Math.floor(performance.now()));
  if (mode) eng.play(mode, Math.floor(performance.now()), 0);
  const p = { canvas, eng, n };
  previews.add(p);
  io?.observe(canvas);
  start();
  return {
    play(m, fade = 0) { eng.play(m, Math.floor(performance.now()), fade); },
    engine: eng,
    remove() { previews.delete(p); io?.unobserve(canvas); },
  };
}

// Leválasztott vásznak automatikus takarítása
export function prunePreviews() {
  for (const p of previews) if (!p.canvas.isConnected) { previews.delete(p); io?.unobserve(p.canvas); }
}

let lastMini = 0;
function frame() {
  if (document.hidden) { running = false; return; }
  const now = Math.floor(performance.now());
  hero?.(now);
  if (now - lastMini > 33) {
    lastMini = now;
    for (const p of previews) {
      if (!p.canvas.isConnected) { previews.delete(p); continue; }
      if (io && visible.get(p.canvas) === false) continue;
      drawMini(p.canvas, p.eng.render(now), p.n);
    }
  }
  requestAnimationFrame(frame);
}

function start() {
  if (running || document.hidden) return;
  running = true;
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
