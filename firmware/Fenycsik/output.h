// LED kimenet: címezhető szalag (NeoPixel/RMT) vagy analóg PWM (LEDC)
#pragma once
#include "storage.h"

class Output {
 public:
  void begin(const LedConfig& c);
  void applyLive(const LedConfig& c);   // LED-szám, áramkorlát, gamma, autoWhite
  uint16_t length() const;               // logikai pixelszám (analóg: 1)
  // bri: 0..255 (lebegőpontos a simításhoz)
  void show(const Px* buf, float bri);
  uint16_t lastCurrent() const { return lastmA_; }

 private:
  void buildGamma(bool on);
  LedConfig cfg_;
  bool wasBlack_ = false;
  uint16_t lastmA_ = 0;
};

uint16_t neoTypeFromOrder(const char* order, bool rgbw, bool* ok);
