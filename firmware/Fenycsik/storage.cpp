#include "storage.h"
#include "modejson.h"
#include <Preferences.h>
#include <LittleFS.h>

#define CFG_VERSION 1

static Preferences prefs;
static LibEntry s_lib[MAX_SAVED_MODES];
static uint8_t s_libCount = 0;
static bool s_fsOk = false;
static JsonDocument s_doc;  // közös munkadokumentum (csak a fő ciklusból hívjuk)

// Gyárilag felkerülő példa módok (első indításkor)
static const char* const EXAMPLES[] = {
  R"({"name":"Szivárvány","effect":"rainbow","speed":110,"intensity":60})",
  R"({"name":"Tábortűz","effect":"fire","speed":128,"intensity":140})",
  R"({"name":"Naplemente","effect":"keyframes","frames":[{"color":"#FF5A00","fade":4000,"hold":3000},{"color":"#FF1E3C","fade":4000,"hold":3000},{"color":"#7A1FA2","fade":4000,"hold":3000},{"color":"#2A0A6E","fade":4000,"hold":3000}]})",
  R"({"name":"Csillagos ég","effect":"twinkle","speed":70,"intensity":110,"colors":["#FFFFFF","#9EC8FF","#FFE6B0"]})",
  R"({"name":"Óceán","effect":"wave","speed":70,"intensity":48,"colors":["#00A0FF","#001850"]})",
  R"({"name":"Buli","effect":"playlist","steps":[{"effect":"rainbow","speed":170,"duration":15000},{"effect":"chase","speed":160,"colors":["#FF0040","#00FF80","#4000FF"],"duration":12000},{"effect":"comet","speed":180,"intensity":80,"colors":["#FF00FF","#00FFFF"],"duration":12000},{"effect":"twinkle","speed":180,"intensity":200,"colors":["#FF0000","#00FF00","#0000FF","#FFFF00"],"duration":12000}]})",
};

void storageBegin() {
  prefs.begin("fenycsik", false);
  s_fsOk = LittleFS.begin(true);
  if (!s_fsOk) Serial.println("[fs] LittleFS nem indult");
  else if (!LittleFS.exists("/m")) LittleFS.mkdir("/m");
}

void configDefaults(LedConfig& c) {
  memset(&c, 0, sizeof(c));
  c.version = CFG_VERSION;
  c.type = DEFAULT_TYPE;
  strlcpy(c.order, DEFAULT_ORDER, sizeof(c.order));
  c.count = DEFAULT_COUNT;
  c.pin = DEFAULT_DATA_PIN;
  c.apin[0] = DEFAULT_APIN_R;
  c.apin[1] = DEFAULT_APIN_G;
  c.apin[2] = DEFAULT_APIN_B;
  c.apin[3] = DEFAULT_APIN_W;
  c.maxmA = DEFAULT_MAX_MA;
  c.gamma = true;
  c.autoWhite = true;
  uint64_t mac = ESP.getEfuseMac();
  snprintf(c.name, sizeof(c.name), "%s-%02X%02X", DEFAULT_NAME_PREFIX,
           (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
}

void configLoad(LedConfig& c) {
  configDefaults(c);
  if (prefs.getBytesLength("cfg") == sizeof(LedConfig)) {
    LedConfig t;
    prefs.getBytes("cfg", &t, sizeof(t));
    if (t.version == CFG_VERSION) c = t;
  }
  c.name[sizeof(c.name) - 1] = 0;
  c.order[sizeof(c.order) - 1] = 0;
}

void configSave(const LedConfig& c) { prefs.putBytes("cfg", &c, sizeof(c)); }

void stateLoad(bool& on, uint8_t& bri) {
  on = prefs.getBool("on", true);
  bri = prefs.getUChar("bri", DEFAULT_BRIGHTNESS);
}

void stateSave(bool on, uint8_t bri) {
  if (prefs.getBool("on", !on) != on) prefs.putBool("on", on);
  if (prefs.getUChar("bri", bri ^ 1) != bri) prefs.putUChar("bri", bri);
}

static bool loadFile(const char* path, Mode& m) {
  if (!s_fsOk) return false;
  File f = LittleFS.open(path, "r");
  if (!f) return false;
  s_doc.clear();
  DeserializationError e = deserializeJson(s_doc, f);
  f.close();
  if (e) return false;
  const char* err;
  return modeFromJson(s_doc.as<JsonObjectConst>(), m, err);
}

static bool saveFile(const char* path, const Mode& m) {
  if (!s_fsOk) return false;
  s_doc.clear();
  modeToJson(m, s_doc.to<JsonObject>());
  File f = LittleFS.open("/tmp.json", "w");
  if (!f) return false;
  size_t len = measureJson(s_doc);
  size_t w = serializeJson(s_doc, f);
  f.close();
  if (w != len) { LittleFS.remove("/tmp.json"); return false; }
  LittleFS.remove(path);
  return LittleFS.rename("/tmp.json", path);
}

bool currentLoad(Mode& m) { return loadFile("/cur.json", m); }
void currentSave(const Mode& m) { saveFile("/cur.json", m); }

static uint32_t fnv1a(const char* s) {
  uint32_t h = 2166136261u;
  while (*s) { h ^= (uint8_t)*s++; h *= 16777619u; }
  return h;
}

void libScan() {
  s_libCount = 0;
  if (!s_fsOk) return;
  File dir = LittleFS.open("/m");
  if (!dir || !dir.isDirectory()) return;
  JsonDocument filter;
  filter["name"] = true;
  filter["effect"] = true;
  for (File f = dir.openNextFile(); f && s_libCount < MAX_SAVED_MODES; f = dir.openNextFile()) {
    if (!f.isDirectory()) {
      s_doc.clear();
      if (!deserializeJson(s_doc, f, DeserializationOption::Filter(filter))) {
        LibEntry& e = s_lib[s_libCount];
        utf8Copy(e.name, s_doc["name"] | "", sizeof(e.name));
        int fx = fxFromName(s_doc["effect"] | "solid");
        e.fx = fx < 0 ? FX_SOLID : (uint8_t)fx;
        strlcpy(e.path, f.path(), sizeof(e.path));
        if (e.name[0]) s_libCount++;
      }
    }
    f.close();
  }
  // név szerinti rendezés (beszúrásos)
  for (int i = 1; i < s_libCount; i++) {
    LibEntry t = s_lib[i];
    int j = i - 1;
    while (j >= 0 && strcmp(s_lib[j].name, t.name) > 0) { s_lib[j + 1] = s_lib[j]; j--; }
    s_lib[j + 1] = t;
  }
}

uint8_t libCount() { return s_libCount; }
const LibEntry& libEntry(uint8_t i) { return s_lib[i < s_libCount ? i : 0]; }

int libFind(const char* name) {
  if (!name) return -1;
  for (int i = 0; i < s_libCount; i++)
    if (!strcmp(s_lib[i].name, name)) return i;
  return -1;
}

bool libSave(const Mode& m, const char*& err) {
  if (!m.name[0]) { err = "no_name"; return false; }
  if (libFind(m.name) < 0 && s_libCount >= MAX_SAVED_MODES) { err = "full"; return false; }
  char path[20];
  snprintf(path, sizeof(path), "/m/%08lx.json", (unsigned long)fnv1a(m.name));
  if (!saveFile(path, m)) { err = "fs"; return false; }
  libScan();
  return true;
}

bool libDelete(const char* name) {
  int i = libFind(name);
  if (i < 0) return false;
  LittleFS.remove(s_lib[i].path);
  libScan();
  return true;
}

bool libLoad(const char* name, Mode& m) {
  int i = libFind(name);
  return i >= 0 && loadFile(s_lib[i].path, m);
}

bool libLoadIndex(uint8_t i, Mode& m) { return i < s_libCount && loadFile(s_lib[i].path, m); }

void libSeedExamples() {
  if (prefs.getBool("seeded", false)) return;
  static Mode m;
  for (const char* js : EXAMPLES) {
    s_doc.clear();
    if (deserializeJson(s_doc, js)) continue;
    const char* err;
    if (modeFromJson(s_doc.as<JsonObjectConst>(), m, err)) libSave(m, err);
  }
  prefs.putBool("seeded", true);
}

size_t fsUsed() { return s_fsOk ? LittleFS.usedBytes() : 0; }
size_t fsTotal() { return s_fsOk ? LittleFS.totalBytes() : 0; }
