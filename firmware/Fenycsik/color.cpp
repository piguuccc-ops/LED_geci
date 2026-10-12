#include "color.h"
#include <math.h>

// round(127.5 + 127.5 * sin(i * 2π / 256)) – ugyanez a tábla van az app js/engine.js fájljában is,
// így a telefonos előnézet pixelre megegyezik a szalaggal.
static const uint8_t SIN8[256] = {
  128,131,134,137,140,143,146,149,152,155,158,162,165,167,170,173,176,179,182,185,188,190,193,196,198,201,203,206,208,211,213,215,
  218,220,222,224,226,228,230,232,234,235,237,238,240,241,243,244,245,246,248,249,250,250,251,252,253,253,254,254,254,255,255,255,
  255,255,255,255,254,254,254,253,253,252,251,250,250,249,248,246,245,244,243,241,240,238,237,235,234,232,230,228,226,224,222,220,
  218,215,213,211,208,206,203,201,198,196,193,190,188,185,182,179,176,173,170,167,165,162,158,155,152,149,146,143,140,137,134,131,
  127,124,121,118,115,112,109,106,103,100,97,93,90,88,85,82,79,76,73,70,67,65,62,59,57,54,52,49,47,44,42,40,
  37,35,33,31,29,27,25,23,21,20,18,17,15,14,12,11,10,9,7,6,5,5,4,3,2,2,1,1,1,0,0,0,
  0,0,0,0,1,1,1,2,2,3,4,5,5,6,7,9,10,11,12,14,15,17,18,20,21,23,25,27,29,31,33,35,
  37,40,42,44,47,49,52,54,57,59,62,65,67,70,73,76,79,82,85,88,90,93,97,100,103,106,109,112,115,118,121,124};
static uint32_t rngState = 0x9E3779B9u;

void colorTablesInit() {
  rngState ^= esp_random();
  if (!rngState) rngState = 1;
}

void rndSeed(uint32_t s) { rngState = s ? s : 1; }

uint8_t sin8(uint8_t x) { return SIN8[x]; }

uint32_t rnd32() {
  uint32_t x = rngState;
  x ^= x << 13; x ^= x >> 17; x ^= x << 5;
  rngState = x;
  return x;
}

Px hsv16(uint16_t hue, uint8_t sat, uint8_t val) {
  uint8_t r, g, b;
  uint32_t h = ((uint32_t)hue * 1530u + 32768u) / 65536u;
  if (h < 510) {
    b = 0;
    if (h < 255) { r = 255; g = h; } else { r = 510 - h; g = 255; }
  } else if (h < 1020) {
    r = 0;
    if (h < 765) { g = 255; b = h - 510; } else { g = 1020 - h; b = 255; }
  } else if (h < 1530) {
    g = 0;
    if (h < 1275) { r = h - 1020; b = 255; } else { r = 255; b = 1530 - h; }
  } else {
    r = 255; g = b = 0;
  }
  uint32_t v1 = 1 + val;
  uint16_t s1 = 1 + sat;
  uint8_t s2 = 255 - sat;
  r = ((((r * s1) >> 8) + s2) * v1) >> 8;
  g = ((((g * s1) >> 8) + s2) * v1) >> 8;
  b = ((((b * s1) >> 8) + s2) * v1) >> 8;
  return px(r, g, b);
}

static int hexVal(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool parseHex(const char* s, Px& out) {
  if (!s) return false;
  if (*s == '#') s++;
  size_t n = strlen(s);
  if (n != 6 && n != 8) return false;
  uint8_t v[4] = {0, 0, 0, 0};
  for (size_t i = 0; i < n; i += 2) {
    int hi = hexVal(s[i]), lo = hexVal(s[i + 1]);
    if (hi < 0 || lo < 0) return false;
    v[i / 2] = (uint8_t)(hi * 16 + lo);
  }
  out = px(v[0], v[1], v[2], v[3]);
  return true;
}

void toHex(const Px& c, char* out) {
  if (c.w) snprintf(out, 10, "#%02X%02X%02X%02X", c.r, c.g, c.b, c.w);
  else     snprintf(out, 10, "#%02X%02X%02X", c.r, c.g, c.b);
}
