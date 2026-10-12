// Tárolás: beállítások és állapot NVS-ben, módok LittleFS-en (/m/*.json)
#pragma once
#include "effects.h"

struct LedConfig {
  uint8_t version;
  uint8_t type;        // STRIP_RGB / STRIP_RGBW / STRIP_ANALOG
  char order[6];       // "GRB", "GRBW" ...
  uint16_t count;
  int8_t pin;          // címezhető szalag adatlába
  int8_t apin[4];      // analóg R, G, B, W (-1 = nincs)
  uint16_t maxmA;      // áramkorlát (0 = nincs)
  bool gamma;          // gamma korrekció (a képernyőn látott színhez közelebb)
  bool autoWhite;      // RGBW: a fehér részt a W LED adja
  char name[25];       // Bluetooth név
};

struct LibEntry {
  char name[MODE_NAME_MAX];
  uint8_t fx;
  char path[20];
};

void storageBegin();
void configDefaults(LedConfig& c);
void configLoad(LedConfig& c);
void configSave(const LedConfig& c);

void stateLoad(bool& on, uint8_t& bri);
void stateSave(bool on, uint8_t bri);
bool currentLoad(Mode& m);
void currentSave(const Mode& m);

// Mód könyvtár az ESP32-n
void libScan();
uint8_t libCount();
const LibEntry& libEntry(uint8_t i);
int libFind(const char* name);
bool libSave(const Mode& m, const char*& err);
bool libDelete(const char* name);
bool libLoad(const char* name, Mode& m);
bool libLoadIndex(uint8_t i, Mode& m);
void libSeedExamples();
size_t fsUsed();
size_t fsTotal();
