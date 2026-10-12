#include "output.h"
#include <Adafruit_NeoPixel.h>
#include <math.h>

#if ESP_ARDUINO_VERSION_MAJOR < 3
#error "Az ESP32 Arduino core 3.x vagy újabb kell (Eszközök > Alaplapkezelő > esp32 3.x)"
#endif

static Adafruit_NeoPixel strip(0, -1, NEO_GRB + NEO_KHZ800);
static uint16_t g16[256];  // gamma tábla 0..255 -> 0..65535

uint16_t neoTypeFromOrder(const char* order, bool rgbw, bool* ok) {
  *ok = false;
  size_t n = order ? strlen(order) : 0;
  if (n != (rgbw ? 4u : 3u)) return rgbw ? NEO_GRBW : NEO_GRB;
  int r = -1, g = -1, b = -1, w = -1;
  for (size_t i = 0; i < n; i++) {
    int* slot = nullptr;
    switch (toupper((unsigned char)order[i])) {
      case 'R': slot = &r; break;
      case 'G': slot = &g; break;
      case 'B': slot = &b; break;
      case 'W': slot = rgbw ? &w : nullptr; break;
    }
    if (!slot || *slot >= 0) return rgbw ? NEO_GRBW : NEO_GRB;
    *slot = (int)i;
  }
  if (!rgbw) w = r;  // Adafruit kódolás: 3 csatornánál W == R
  *ok = true;
  return (uint16_t)((w << 6) | (r << 4) | (g << 2) | b);
}

void Output::buildGamma(bool on) {
  for (int i = 0; i < 256; i++)
    g16[i] = on ? (uint16_t)lroundf(powf(i / 255.0f, 2.2f) * 65535.0f) : (uint16_t)(i * 257);
}

void Output::begin(const LedConfig& c) {
  cfg_ = c;
  buildGamma(c.gamma);
  if (c.type == STRIP_ANALOG) {
    for (int k = 0; k < 4; k++) {
      if (c.apin[k] < 0) continue;
      if (!ledcAttach(c.apin[k], ANALOG_PWM_FREQ, ANALOG_PWM_BITS))
        Serial.printf("[out] PWM hiba a %d. lábon\n", c.apin[k]);
      ledcWrite(c.apin[k], 0);
    }
  } else {
    bool ok;
    uint16_t t = neoTypeFromOrder(c.order, c.type == STRIP_RGBW, &ok);
    strip.updateType(t + NEO_KHZ800);
    strip.updateLength(c.count);
    strip.setPin(c.pin);
#ifndef FENYCSIK_SERIAL_TEST
    strip.begin();
    strip.clear();
    strip.show();
#endif
  }
  wasBlack_ = false;
}

void Output::applyLive(const LedConfig& c) {
  if (c.gamma != cfg_.gamma) buildGamma(c.gamma);
  if (c.type != STRIP_ANALOG && c.count != cfg_.count) {
    strip.clear();
#ifndef FENYCSIK_SERIAL_TEST
    strip.show();  // a régi hossz végén lévő LED-ek is kialszanak
#endif
    strip.updateLength(c.count);
    wasBlack_ = false;
  }
  cfg_.count = c.count;
  cfg_.maxmA = c.maxmA;
  cfg_.gamma = c.gamma;
  cfg_.autoWhite = c.autoWhite;
}

uint16_t Output::length() const { return cfg_.type == STRIP_ANALOG ? 1 : cfg_.count; }

static inline uint8_t to8(uint16_t g, uint32_t b) {
  uint32_t v = (uint32_t)g * b / 255;  // 0..65535
  return (uint8_t)((v + 128) / 257);
}

void Output::show(const Px* buf, float bri) {
  uint32_t b = bri <= 0 ? 0 : (bri >= 255 ? 255 : (uint32_t)lroundf(bri));
  const bool hasW = cfg_.type == STRIP_RGBW || (cfg_.type == STRIP_ANALOG && cfg_.apin[3] >= 0);

  if (cfg_.type == STRIP_ANALOG) {
    Px c = buf[0];
    if (hasW && cfg_.autoWhite && c.w == 0) {
      uint8_t m = min(c.r, min(c.g, c.b));
      c.w = m; c.r -= m; c.g -= m; c.b -= m;
    } else if (!hasW && c.w) {
      c.r = qadd8(c.r, c.w); c.g = qadd8(c.g, c.w); c.b = qadd8(c.b, c.w);
    }
    const uint8_t ch[4] = {c.r, c.g, c.b, c.w};
    for (int k = 0; k < 4; k++) {
      if (cfg_.apin[k] < 0) continue;
      uint32_t v = (uint32_t)g16[ch[k]] * b / 255;  // 0..65535
      ledcWrite(cfg_.apin[k], v >> (16 - ANALOG_PWM_BITS));
    }
    lastmA_ = 0;
    return;
  }

  const uint16_t n = cfg_.count;
  uint32_t sum = 0;
  bool black = true;
  for (uint16_t i = 0; i < n; i++) {
    Px c = buf[i];
    if (hasW && cfg_.autoWhite && c.w == 0) {
      uint8_t m = min(c.r, min(c.g, c.b));
      c.w = m; c.r -= m; c.g -= m; c.b -= m;
    } else if (!hasW && c.w) {
      c.r = qadd8(c.r, c.w); c.g = qadd8(c.g, c.w); c.b = qadd8(c.b, c.w);
    }
    uint8_t r = to8(g16[c.r], b), g = to8(g16[c.g], b), bl = to8(g16[c.b], b), w = to8(g16[c.w], b);
    sum += (uint32_t)r + g + bl + w;
    if (r | g | bl | w) black = false;
    strip.setPixelColor(i, r, g, bl, w);
  }

  // Becsült áramfelvétel: csatornánként ~20 mA teljes fényerőn + ~1 mA/LED alapjárat
  uint32_t mA = sum * 20 / 255 + n;
  if (cfg_.maxmA && mA > cfg_.maxmA && sum > 0) {
    uint64_t avail = cfg_.maxmA > n ? cfg_.maxmA - n : 0;
    uint32_t sc = (uint32_t)(avail * 255ull * 256ull / ((uint64_t)sum * 20ull));  // 8.8 fixpontos szorzó
    if (sc > 256) sc = 256;
    uint8_t* p = strip.getPixels();
    size_t bytes = (size_t)n * (hasW ? 4 : 3);
    for (size_t k = 0; k < bytes; k++) p[k] = (uint8_t)((p[k] * sc) >> 8);
    mA = cfg_.maxmA;
  }
  lastmA_ = (uint16_t)min<uint32_t>(mA, 65535);

  if (black && wasBlack_) return;  // sötét és már az is volt: nem küldjük újra
  wasBlack_ = black;
#ifndef FENYCSIK_SERIAL_TEST  // QEMU-ban nincs RMT periféria
  strip.show();
#endif
}
