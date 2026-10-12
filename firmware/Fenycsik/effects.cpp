#include "effects.h"
#include <math.h>

const char* const FX_NAMES[FX_COUNT] = {
  "solid", "breathe", "rainbow", "colorloop", "gradient", "chase",
  "comet", "scanner", "twinkle", "fire", "strobe", "wave",
  "keyframes", "playlist"};

//                                    sol brt rnb clp grd chs cmt scn twk fir stb wav key pls
static const uint8_t DEF_SPEED[FX_COUNT] = {128, 100, 128, 100, 50, 128, 128, 128, 128, 128, 128, 100, 128, 128};
static const uint8_t DEF_INT[FX_COUNT]   = {128, 200,  60, 128,  0,   0, 100,  60, 128, 128,  30,  64, 128, 128};

// Belső pufferek (statikusak, hogy ne a heapről menjenek)
static Px s_prev[MAX_LEDS];      // átúszás kiinduló képe
static Px s_last[MAX_LEDS];      // utoljára renderelt kép
static uint8_t s_heat[MAX_LEDS]; // tűz
static uint8_t s_tw[MAX_LEDS];   // csillogás fényereje
static uint8_t s_twc[MAX_LEDS];  // csillogás színindexe
static uint64_t s_spawnAcc = 0;

int fxFromName(const char* s) {
  if (!s) return -1;
  for (int i = 0; i < FX_COUNT; i++)
    if (!strcmp(s, FX_NAMES[i])) return i;
  return -1;
}

uint8_t fxDefaultSpeed(uint8_t fx) { return fx < FX_COUNT ? DEF_SPEED[fx] : 128; }
uint8_t fxDefaultIntensity(uint8_t fx) { return fx < FX_COUNT ? DEF_INT[fx] : 128; }

// Sebesség -> fázis egység / ms (négyzetes, hogy lassú tartományban finomabb legyen)
static inline uint32_t speedRate(uint8_t s) { return s ? ((uint32_t)s * s) / 128u + 1u : 0u; }

void FxParams::reset(uint8_t effect) {
  fx = effect < FX_COUNT ? effect : FX_SOLID;
  speed = DEF_SPEED[fx];
  intensity = DEF_INT[fx];
  reverse = false;
  duration = 10000;
  ncol = 0;
  memset(col, 0, sizeof(col));
  switch (fx) {
    case FX_SOLID:    col[0] = px(255, 255, 255); ncol = 1; break;
    case FX_BREATHE:  col[0] = px(0x3C, 0x8C, 0xFF); ncol = 1; break;
    case FX_GRADIENT: col[0] = px(0xFF, 0x40, 0x00); col[1] = px(0xFF, 0x00, 0xA0);
                      col[2] = px(0x40, 0x00, 0xFF); ncol = 3; break;
    case FX_CHASE:    col[0] = px(0xFF, 0x00, 0x00); ncol = 1; break;
    case FX_COMET:    col[0] = px(0x00, 0xC8, 0xFF); ncol = 1; break;
    case FX_SCANNER:  col[0] = px(0xFF, 0x00, 0x00); ncol = 1; break;
    case FX_TWINKLE:  col[0] = px(0xFF, 0xFF, 0xFF); col[1] = px(0xFF, 0xC8, 0x64);
                      col[2] = px(0x64, 0xB4, 0xFF); ncol = 3; break;
    case FX_STROBE:   col[0] = px(0xFF, 0xFF, 0xFF); ncol = 1; break;
    case FX_WAVE:     col[0] = px(0x00, 0x64, 0xFF); ncol = 1; break;
    default: break;  // rainbow, colorloop, fire, keyframes, playlist
  }
}

void Mode::clear() {
  memset(this, 0, sizeof(Mode));
  p.reset(FX_SOLID);
  brightness = -1;
  loop = true;
  transition = 600;
}

// ---------------------------------------------------------------------

void Engine::begin(uint16_t n) {
  mode_.clear();
  setLength(n);
  last_ = millis();
}

void Engine::setLength(uint16_t n) {
  if (n < 1) n = 1;
  if (n > MAX_LEDS) n = MAX_LEDS;
  n_ = n;
  memset(s_last, 0, sizeof(s_last));
  memset(s_prev, 0, sizeof(s_prev));
  inTrans_ = false;
  resetState();
}

void Engine::resetState() {
  phase_ = 0;
  kfAcc_ = 0;
  acc_ = acc2_ = 0;
  s_spawnAcc = 0;
  memset(s_heat, 0, sizeof(s_heat));
  memset(s_tw, 0, sizeof(s_tw));
  memset(s_twc, 0, sizeof(s_twc));
}

void Engine::startTransition(uint32_t now, uint16_t ms) {
  if (!ms) { inTrans_ = false; return; }
  memcpy(s_prev, s_last, n_ * sizeof(Px));
  transStart_ = now;
  transDur_ = ms;
  inTrans_ = true;
}

void Engine::play(const Mode& m, uint32_t now, uint16_t fadeMs) {
  startTransition(now, fadeMs);
  mode_ = m;
  step_ = 0;
  stepStart_ = now;
  resetState();
}

void Engine::setSolid(const Px& c, uint32_t now) {
  if (mode_.p.fx != FX_SOLID) {
    startTransition(now, 150);
    mode_.clear();
    resetState();
  }
  mode_.p.col[0] = c;
  if (mode_.p.ncol < 1) mode_.p.ncol = 1;
}

void Engine::setSpeed(uint8_t s) { mode_.p.speed = s; }
void Engine::setIntensity(uint8_t i) { mode_.p.intensity = i; }
void Engine::setColor(uint8_t idx, const Px& c) {
  if (idx >= MAX_COLORS) return;
  mode_.p.col[idx] = c;
  if (idx >= mode_.p.ncol) mode_.p.ncol = idx + 1;
}

void Engine::fill(Px* out, const Px& c) {
  for (uint16_t i = 0; i < n_; i++) out[i] = c;
}

Px Engine::palCyclic(const FxParams& p, uint16_t pos) const {
  if (p.ncol == 0) return BLACK;
  if (p.ncol == 1) return p.col[0];
  uint32_t s = (uint32_t)pos * p.ncol;
  uint8_t seg = s >> 16;
  uint8_t frac = (s & 0xFFFF) >> 8;
  return blend(p.col[seg], p.col[(seg + 1) % p.ncol], frac);
}

Px Engine::palLinear(const FxParams& p, uint16_t pos) const {
  if (p.ncol == 0) return BLACK;
  if (p.ncol == 1) return p.col[0];
  uint32_t s = (uint32_t)pos * (p.ncol - 1);
  uint8_t seg = s >> 16;
  if (seg >= p.ncol - 1) return p.col[p.ncol - 1];
  uint8_t frac = (s & 0xFFFF) >> 8;
  return blend(p.col[seg], p.col[seg + 1], frac);
}

void Engine::render(uint32_t now, Px* out) {
  uint32_t dt = now - last_;
  if (dt > 100) dt = 100;
  last_ = now;

  const FxParams* p = &mode_.p;
  if (mode_.p.fx == FX_PLAYLIST) {
    if (mode_.nsteps == 0) { fill(out, BLACK); goto done; }
    if (step_ >= mode_.nsteps) step_ = 0;
    if (now - stepStart_ >= mode_.steps[step_].duration) {
      bool lastStep = step_ + 1 >= mode_.nsteps;
      if (!lastStep || mode_.loop) {
        startTransition(now, mode_.transition);
        step_ = lastStep ? 0 : step_ + 1;
        stepStart_ = now;
        resetState();
      }
    }
    p = &mode_.steps[step_];
  }

  {
    uint32_t rate = speedRate(p->speed);
    if (p->fx == FX_STROBE && rate > 256) rate = 256;  // max ~10 Hz villogás
    phase_ += (uint64_t)dt * rate;
    if (p->fx == FX_KEYFRAMES) kfAcc_ += (uint64_t)dt * rate;
    if (p->fx == FX_TWINKLE) fxTwinkle(*p, out, dt, rate);
    else if (p->fx == FX_FIRE) fxFire(*p, out, dt, rate);
    else renderFx(*p, out);
  }

done:
  if (inTrans_) {
    uint32_t el = now - transStart_;
    if (el >= transDur_) {
      inTrans_ = false;
    } else {
      uint8_t t = (uint8_t)(el * 255u / transDur_);
      for (uint16_t i = 0; i < n_; i++) out[i] = blend(s_prev[i], out[i], t);
    }
  }
  memcpy(s_last, out, n_ * sizeof(Px));
}

void Engine::renderFx(const FxParams& p, Px* out) {
  switch (p.fx) {
    case FX_SOLID:     fill(out, p.ncol ? p.col[0] : BLACK); break;
    case FX_BREATHE:   fxBreathe(p, out); break;
    case FX_RAINBOW:   fxRainbow(p, out); break;
    case FX_COLORLOOP: {
      uint16_t h = (uint16_t)(phase_ >> 3);
      fill(out, hsv16(p.reverse ? (uint16_t)(0 - h) : h, 255, 255));
      break;
    }
    case FX_GRADIENT:  fxGradient(p, out); break;
    case FX_CHASE:     fxChase(p, out); break;
    case FX_COMET:     fxComet(p, out); break;
    case FX_SCANNER:   fxScanner(p, out); break;
    case FX_STROBE:    fxStrobe(p, out); break;
    case FX_WAVE:      fxWave(p, out); break;
    case FX_KEYFRAMES: fxKeyframes(out); break;
    default:           fill(out, BLACK); break;
  }
}

void Engine::fxBreathe(const FxParams& p, Px* out) {
  const uint64_t C = 1ull << 19;  // ~4 s alapsebességen
  uint32_t cyc = (uint32_t)(phase_ / C);
  uint8_t a = (uint8_t)(((phase_ % C) * 256 / C + 64) & 255);  // koszinusz a szinusz táblából
  uint8_t v = 255 - sin8(a);                                    // 0 -> 255 -> 0 egy ciklus alatt
  uint8_t inv = 255 - p.intensity;
  uint8_t minv = (uint8_t)(((uint16_t)inv * inv) >> 8);
  uint8_t lvl = minv + (uint8_t)((uint32_t)(255 - minv) * v / 255);
  Px c = p.ncol ? p.col[cyc % p.ncol] : px(255, 255, 255);
  fill(out, scale(c, lvl));
}

void Engine::fxRainbow(const FxParams& p, Px* out) {
  uint16_t off = (uint16_t)(phase_ >> 3);
  uint32_t reps88 = 64 + (uint32_t)p.intensity * 960 / 255;  // 0.25 .. 4 szivárvány
  uint32_t step = (uint32_t)(((uint64_t)65536 * reps88) / (256u * n_));
  for (uint16_t i = 0; i < n_; i++) {
    uint16_t h = p.reverse ? (uint16_t)(i * step + off) : (uint16_t)(i * step - off);
    out[i] = hsv16(h, 255, 255);
  }
}

void Engine::fxGradient(const FxParams& p, Px* out) {
  if (p.ncol <= 1) { fill(out, p.ncol ? p.col[0] : BLACK); return; }
  if (p.speed == 0) {  // álló színátmenet: első színtől az utolsóig
    for (uint16_t i = 0; i < n_; i++) {
      uint16_t pos = n_ > 1 ? (uint32_t)i * 65535u / (n_ - 1) : 0;
      out[p.reverse ? n_ - 1 - i : i] = palLinear(p, pos);
    }
    return;
  }
  uint16_t off = (uint16_t)(phase_ >> 3);
  uint32_t reps88 = 256 + (uint32_t)p.intensity * 768 / 255;  // 1 .. 4 ismétlés
  uint32_t step = (uint32_t)(((uint64_t)65536 * reps88) / (256u * n_));
  for (uint16_t i = 0; i < n_; i++) {
    uint16_t pos = p.reverse ? (uint16_t)(i * step + off) : (uint16_t)(i * step - off);
    out[i] = palCyclic(p, pos);
  }
}

void Engine::fxChase(const FxParams& p, Px* out) {
  int32_t size = 1 + p.intensity / 32;  // 1..8 LED-es blokkok
  int32_t period = size * 3;
  int64_t off = (int64_t)(phase_ / 16384);
  int32_t nc = p.ncol ? p.ncol : 1;
  for (int32_t i = 0; i < n_; i++) {
    int64_t x = p.reverse ? (int64_t)i + off : (int64_t)i - off;
    int64_t m = x % period;
    if (m < 0) m += period;
    int64_t blk = (x - m) / period;
    int64_t ci = blk % nc;
    if (ci < 0) ci += nc;
    out[i] = (m < size) ? (p.ncol ? p.col[ci] : px(255, 255, 255)) : BLACK;
  }
}

void Engine::fxComet(const FxParams& p, Px* out) {
  uint32_t span = (uint32_t)n_ * 256;
  uint64_t pos = phase_ / 16;
  uint32_t head = (uint32_t)(pos % span);
  uint32_t lap = (uint32_t)(pos / span);
  uint32_t L = 512 + (uint32_t)p.intensity * (n_ > 2 ? n_ - 2 : 0) * 256 / 510;  // csóva hossza
  Px c = p.ncol ? p.col[lap % p.ncol] : px(255, 255, 255);
  for (uint16_t i = 0; i < n_; i++) {
    int32_t d = (int32_t)head - (int32_t)i * 256;
    if (d < 0) d += span;
    uint8_t v = 0;
    if ((uint32_t)d < L) {
      uint32_t f = 255 - (uint32_t)d * 255 / L;
      v = (uint8_t)(f * f / 255);
    }
    out[p.reverse ? n_ - 1 - i : i] = scale(c, v);
  }
}

void Engine::fxScanner(const FxParams& p, Px* out) {
  if (n_ < 2) { fxBreathe(p, out); return; }
  uint32_t span = (uint32_t)(n_ - 1) * 256;
  uint64_t t = phase_ / 16;
  uint32_t m = (uint32_t)(t % (2ull * span));
  uint32_t pos = m < span ? m : 2 * span - m;
  uint32_t bounces = (uint32_t)(t / span);
  uint32_t W = 256 + (uint32_t)p.intensity * n_ / 4;
  Px c = p.ncol ? p.col[bounces % p.ncol] : px(255, 0, 0);
  for (uint16_t i = 0; i < n_; i++) {
    int32_t d = (int32_t)i * 256 - (int32_t)pos;
    if (d < 0) d = -d;
    uint8_t v = 0;
    if ((uint32_t)d < W) {
      uint32_t f = 255 - (uint32_t)d * 255 / W;
      v = (uint8_t)(f * f / 255);
    }
    out[i] = scale(c, v);
  }
}

void Engine::fxTwinkle(const FxParams& p, Px* out, uint32_t dt, uint32_t rate) {
  acc_ += dt * rate;  // halványodás: 256 egység = 1 fényerő lépés
  uint32_t d = acc_ >> 8;
  acc_ &= 255;
  uint8_t dec = d > 255 ? 255 : (uint8_t)d;
  for (uint16_t i = 0; i < n_; i++) s_tw[i] = qsub8(s_tw[i], dec);

  const uint64_t SPAWN = 1ull << 27;
  s_spawnAcc += (uint64_t)dt * rate * (p.intensity + 1u) * n_;
  uint16_t spawns = 0;
  while (s_spawnAcc >= SPAWN && spawns < 64) { s_spawnAcc -= SPAWN; spawns++; }
  if (s_spawnAcc >= SPAWN) s_spawnAcc = 0;
  for (uint16_t k = 0; k < spawns; k++) {
    uint16_t i = rndRange(n_);
    if (s_tw[i] < 64) {
      s_tw[i] = 255;
      s_twc[i] = p.ncol ? rndRange(p.ncol) : 0;
    }
  }
  for (uint16_t i = 0; i < n_; i++) {
    Px c = p.ncol ? p.col[s_twc[i] % p.ncol] : px(255, 255, 255);
    out[i] = scale(c, s_tw[i]);
  }
}

static Px heatColor(uint8_t h, const FxParams& p) {
  if (p.ncol == 0) {  // klasszikus tűz paletta: fekete-piros-narancs-sárga-fehér
    uint8_t t192 = (uint16_t)h * 191 / 255;
    uint8_t ramp = (t192 & 0x3F) << 2;
    if (t192 & 0x80) return px(255, 255, ramp);
    if (t192 & 0x40) return px(255, ramp, 0);
    return px(ramp, 0, 0);
  }
  uint8_t nst = p.ncol + 1;  // fekete + saját színek
  uint32_t s = (uint32_t)h * 257u * (nst - 1);
  uint8_t seg = s >> 16;
  if (seg >= nst - 1) return p.col[p.ncol - 1];
  uint8_t frac = (s & 0xFFFF) >> 8;
  Px a = seg == 0 ? BLACK : p.col[seg - 1];
  return blend(a, p.col[seg], frac);
}

void Engine::fxFire(const FxParams& p, Px* out, uint32_t dt, uint32_t rate) {
  const uint32_t STEP = 2064;  // ~16 ms szimulációs lépés alapsebességen
  acc_ += dt * rate;
  uint8_t steps = 0;
  while (acc_ >= STEP && steps < 4) {
    acc_ -= STEP;
    steps++;
    if (n_ < 8) {  // rövid / analóg szalag: lobogó fényerő
      uint8_t target = 110 + rndRange(146);
      s_heat[0] = (uint8_t)(((uint16_t)s_heat[0] * 3 + target) / 4);
      continue;
    }
    uint8_t cooling = 100 - (uint16_t)p.intensity * 80 / 255;
    for (uint16_t i = 0; i < n_; i++) {
      uint32_t c = rndRange((uint32_t)cooling * 10 / n_ + 2);
      s_heat[i] = qsub8(s_heat[i], c > 255 ? 255 : (uint8_t)c);
    }
    for (int k = n_ - 1; k >= 2; k--)
      s_heat[k] = ((uint16_t)s_heat[k - 1] + s_heat[k - 2] + s_heat[k - 2]) / 3;
    if (rnd8() < 120) {
      uint16_t y = rndRange(7);
      s_heat[y] = qadd8(s_heat[y], 160 + rndRange(96));
    }
  }
  if (acc_ >= STEP) acc_ = 0;
  if (n_ < 8) { fill(out, heatColor(s_heat[0], p)); return; }
  for (uint16_t i = 0; i < n_; i++) out[p.reverse ? n_ - 1 - i : i] = heatColor(s_heat[i], p);
}

void Engine::fxStrobe(const FxParams& p, Px* out) {
  const uint64_t P = 26214;
  uint32_t cyc = (uint32_t)(phase_ / P);
  uint32_t pos = (uint32_t)(phase_ % P);
  uint32_t duty = (uint32_t)(P * (10 + (uint32_t)p.intensity * 200 / 255) / 256);
  fill(out, pos < duty ? (p.ncol ? p.col[cyc % p.ncol] : px(255, 255, 255)) : BLACK);
}

void Engine::fxWave(const FxParams& p, Px* out) {
  uint16_t off = (uint16_t)(phase_ >> 2);
  uint8_t waves = 1 + p.intensity / 32;
  uint32_t step = (uint32_t)((65536ull * waves) / n_);
  Px fg = p.ncol ? p.col[0] : px(0, 100, 255);
  Px bg = p.ncol >= 2 ? p.col[1] : BLACK;
  for (uint16_t i = 0; i < n_; i++) {
    uint16_t a = p.reverse ? (uint16_t)(i * step + off) : (uint16_t)(i * step - off);
    out[i] = blend(bg, fg, sin8(a >> 8));
  }
}

void Engine::fxKeyframes(Px* out) {
  if (mode_.nframes == 0) { fill(out, BLACK); return; }
  uint64_t t = kfAcc_ / 129;  // 128-as sebességnél valós ms
  uint64_t total = 0;
  for (uint8_t k = 0; k < mode_.nframes; k++) total += mode_.frames[k].fade + mode_.frames[k].hold;
  const Px& lastC = mode_.frames[mode_.nframes - 1].c;
  if (total == 0 || (!mode_.loop && t >= total)) { fill(out, lastC); return; }
  uint64_t tt = mode_.loop ? t % total : t;
  Px prev = mode_.loop ? lastC : BLACK;
  for (uint8_t k = 0; k < mode_.nframes; k++) {
    const Keyframe& f = mode_.frames[k];
    if (tt < f.fade) { fill(out, blend(prev, f.c, (uint8_t)(tt * 255 / f.fade))); return; }
    tt -= f.fade;
    if (tt < f.hold) { fill(out, f.c); return; }
    tt -= f.hold;
    prev = f.c;
  }
  fill(out, lastC);
}
