// Színkezelő segédfüggvények (RGBW pixel, HSV, keverés, hex)
#pragma once
#include <Arduino.h>

struct Px {
  uint8_t r, g, b, w;
};

static inline Px px(uint8_t r, uint8_t g, uint8_t b, uint8_t w = 0) {
  Px p; p.r = r; p.g = g; p.b = b; p.w = w; return p;
}
static const Px BLACK = {0, 0, 0, 0};

static inline bool isBlack(const Px& c) { return (c.r | c.g | c.b | c.w) == 0; }

// t = 0 -> a, t = 255 -> b
static inline Px blend(const Px& a, const Px& b, uint8_t t) {
  uint16_t it = 255 - t;
  return px((a.r * it + b.r * t + 127) / 255,
            (a.g * it + b.g * t + 127) / 255,
            (a.b * it + b.b * t + 127) / 255,
            (a.w * it + b.w * t + 127) / 255);
}

// s = 255 -> változatlan, 0 -> fekete
static inline Px scale(const Px& c, uint8_t s) {
  return px((c.r * s + 127) / 255, (c.g * s + 127) / 255,
            (c.b * s + 127) / 255, (c.w * s + 127) / 255);
}

static inline uint8_t qadd8(uint8_t a, uint8_t b) { uint16_t s = a + b; return s > 255 ? 255 : s; }
static inline uint8_t qsub8(uint8_t a, uint8_t b) { return a > b ? a - b : 0; }

// 16 bites színárnyalat (0..65535 = egy teljes kör), telítettség, érték
Px hsv16(uint16_t hue, uint8_t sat, uint8_t val);

// 0..255 -> 0..255 szinusz (128 a nullpont)
uint8_t sin8(uint8_t x);
void colorTablesInit();

// Gyors pszeudo-véletlen
uint32_t rnd32();
void rndSeed(uint32_t s);  // teszteléshez
static inline uint8_t rnd8() { return (uint8_t)rnd32(); }
static inline uint32_t rndRange(uint32_t n) { return n ? rnd32() % n : 0; }

// "#RRGGBB", "#RRGGBBWW", "RRGGBB" ...
bool parseHex(const char* s, Px& out);
// -> "#RRGGBB" vagy "#RRGGBBWW" (ha w != 0); out legalább 10 bájt
void toHex(const Px& c, char* out);
