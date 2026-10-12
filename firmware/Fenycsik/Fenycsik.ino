// =====================================================================
//  Fénycsík – ESP32 LED szalag vezérlő Bluetooth LE-n keresztül
//
//  Könyvtárak (Arduino IDE > Könyvtárkezelő):
//    - NimBLE-Arduino  (h2zero)       2.x
//    - Adafruit NeoPixel               1.12+
//    - ArduinoJson     (Benoit Blanchon) 7.x
//  Alaplap: esp32 by Espressif, 3.x (ESP32 / ESP32-S3 / ESP32-C3)
//
//  BOOT gomb: rövid nyomás = ki/be, hosszú nyomás = következő mentett mód
// =====================================================================
#include <ArduinoJson.h>
#include "config.h"
#include "color.h"
#include "effects.h"
#include "modejson.h"
#include "storage.h"
#include "output.h"
#include "ble.h"

static const int8_t kAllowedPins[] = ALLOWED_PINS;

static LedConfig cfg;
static Engine engine;
static Output out;
static Px frame[MAX_LEDS];
static Mode tmpMode;
static JsonDocument rxDoc;
static JsonDocument txDoc;
static String txBuf;

static bool powerOn = true;
static uint8_t brightness = DEFAULT_BRIGHTNESS;
static float curBri = 0;         // simított, ténylegesen kiadott fényerő
static uint32_t lastFrame = 0;
static uint32_t sleepAt = 0;    // elalvás időzítő (0 = nincs)
static uint32_t rebootAt = 0;

// Flash mentés és állapot-szétküldés késleltetve (ne írjuk a flash-t csúszkázás közben)
static bool persistDirty = false, modeDirty = false;
static uint32_t dirtyAt = 0;
static bool bcastState = false, bcastMode = false;
static uint32_t bcastAt = 0;

static void markState() {
  persistDirty = true;
  dirtyAt = millis();
  bcastState = true;
  bcastAt = millis();
}
static void markMode() {
  modeDirty = true;
  bcastMode = true;
  markState();
}

static bool pinAllowed(int p) {
  for (int8_t a : kAllowedPins)
    if (a == p) return true;
  return false;
}

// ---------------------------------------------------------------- küldés

static void sendDoc() {
  txBuf = "";
  serializeJson(txDoc, txBuf);
  bleSend(txBuf.c_str(), txBuf.length());
}

static void sendState() {
  txDoc.clear();
  txDoc["t"] = "state";
  txDoc["on"] = powerOn;
  txDoc["bri"] = brightness;
  txDoc["timer"] = sleepAt ? (uint32_t)((sleepAt - millis()) / 1000) : 0;
  txDoc["mA"] = out.lastCurrent();
  sendDoc();
}

static void sendCur() {
  txDoc.clear();
  txDoc["t"] = "cur";
  modeToJson(engine.mode(), txDoc["mode"].to<JsonObject>());
  sendDoc();
}

static void sendList() {
  txDoc.clear();
  txDoc["t"] = "list";
  JsonArray a = txDoc["modes"].to<JsonArray>();
  for (uint8_t i = 0; i < libCount(); i++) {
    const LibEntry& e = libEntry(i);
    JsonObject o = a.add<JsonObject>();
    o["name"] = (char*)e.name;
    o["effect"] = FX_NAMES[e.fx];
  }
  sendDoc();
}

static const char* typeName(uint8_t t) {
  return t == STRIP_RGBW ? "rgbw" : (t == STRIP_ANALOG ? "analog" : "rgb");
}

static void sendInfo() {
  txDoc.clear();
  txDoc["t"] = "info";
  txDoc["fw"] = FW_VERSION;
  txDoc["chip"] = CHIP_FAMILY;
  txDoc["model"] = ESP.getChipModel();
  JsonObject c = txDoc["cfg"].to<JsonObject>();
  c["type"] = typeName(cfg.type);
  c["order"] = (char*)cfg.order;
  c["count"] = cfg.count;
  c["pin"] = cfg.pin;
  JsonArray ap = c["apins"].to<JsonArray>();
  for (int k = 0; k < 4; k++) ap.add(cfg.apin[k]);
  c["maxmA"] = cfg.maxmA;
  c["gamma"] = cfg.gamma;
  c["autoWhite"] = cfg.autoWhite;
  c["name"] = (char*)cfg.name;
  JsonArray pins = txDoc["pins"].to<JsonArray>();
  for (int8_t p : kAllowedPins) pins.add(p);
  JsonObject lim = txDoc["limits"].to<JsonObject>();
  lim["rgb"] = MAX_LEDS_RGB;
  lim["rgbw"] = MAX_LEDS_RGBW;
  lim["modes"] = MAX_SAVED_MODES;
  lim["colors"] = MAX_COLORS;
  lim["frames"] = MAX_FRAMES;
  lim["steps"] = MAX_STEPS;
  lim["msg"] = MAX_MSG_SIZE;
  txDoc["heap"] = ESP.getFreeHeap();
  txDoc["fsUsed"] = fsUsed();
  txDoc["fsTotal"] = fsTotal();
  txDoc["saved"] = libCount();
  sendDoc();
}

static void sendOk(const char* op, const char* name) {
  txDoc.clear();
  txDoc["t"] = "ok";
  txDoc["op"] = op;
  if (name) txDoc["name"] = (char*)name;
  sendDoc();
}

static void sendErr(const char* op, const char* msg) {
  txDoc.clear();
  txDoc["t"] = "err";
  txDoc["op"] = (char*)op;
  txDoc["msg"] = msg ? msg : "error";
  sendDoc();
}

// ---------------------------------------------------------------- műveletek

static void playMode(const Mode& m, uint16_t fade) {
  engine.play(m, millis(), fade);
  if (m.brightness >= 0) brightness = (uint8_t)m.brightness;
  powerOn = true;  // mód indításakor be is kapcsolunk
  markMode();
}

static void nextSavedMode() {
  static int idx = -1;
  if (!libCount()) return;
  idx = (idx + 1) % libCount();
  if (libLoadIndex(idx, tmpMode)) playMode(tmpMode, 500);
}

static void persist() {
  stateSave(powerOn, brightness);
  if (modeDirty) currentSave(engine.mode());
  modeDirty = false;
  persistDirty = false;
}

static void applyConfig(JsonObjectConst c) {
  if (c.isNull()) { sendErr("cfg", "bad_cfg"); return; }
  LedConfig n = cfg;

  if (c["type"].is<const char*>()) {
    const char* t = c["type"];
    if (!strcmp(t, "rgb")) n.type = STRIP_RGB;
    else if (!strcmp(t, "rgbw")) n.type = STRIP_RGBW;
    else if (!strcmp(t, "analog")) n.type = STRIP_ANALOG;
    else { sendErr("cfg", "bad_type"); return; }
  }
  if (c["order"].is<const char*>()) strlcpy(n.order, c["order"], sizeof(n.order));
  if (n.type != STRIP_ANALOG) {
    bool ok;
    neoTypeFromOrder(n.order, n.type == STRIP_RGBW, &ok);
    if (!ok) {
      if (c["order"].is<const char*>()) { sendErr("cfg", "bad_order"); return; }
      strlcpy(n.order, n.type == STRIP_RGBW ? "GRBW" : "GRB", sizeof(n.order));
    }
  }
  uint16_t maxCount = n.type == STRIP_RGBW ? MAX_LEDS_RGBW : MAX_LEDS_RGB;
  if (c["count"].is<long>()) n.count = (uint16_t)constrain(c["count"].as<long>(), 1L, (long)maxCount);
  if (n.count > maxCount) n.count = maxCount;
  if (c["pin"].is<long>()) {
    int p = c["pin"].as<int>();
    if (!pinAllowed(p)) { sendErr("cfg", "bad_pin"); return; }
    n.pin = (int8_t)p;
  }
  if (c["apins"].is<JsonArrayConst>()) {
    JsonArrayConst a = c["apins"].as<JsonArrayConst>();
    for (int k = 0; k < 4; k++) {
      int p = k < (int)a.size() ? (a[k] | -1) : -1;
      if ((k < 3 || p >= 0) && !pinAllowed(p)) { sendErr("cfg", "bad_pin"); return; }
      n.apin[k] = (int8_t)p;
    }
    for (int i = 0; i < 4; i++)
      for (int j = i + 1; j < 4; j++)
        if (n.apin[i] >= 0 && n.apin[i] == n.apin[j]) { sendErr("cfg", "dup_pin"); return; }
  }
  if (c["maxmA"].is<long>()) n.maxmA = (uint16_t)constrain(c["maxmA"].as<long>(), 0L, 60000L);
  if (c["gamma"].is<bool>()) n.gamma = c["gamma"].as<bool>();
  if (c["autoWhite"].is<bool>()) n.autoWhite = c["autoWhite"].as<bool>();
  if (c["name"].is<const char*>()) {
    const char* nm = c["name"];
    if (!nm || !*nm) { sendErr("cfg", "bad_name"); return; }
    utf8Copy(n.name, nm, sizeof(n.name));
  }

  bool reboot = n.type != cfg.type || strcmp(n.order, cfg.order) != 0 || n.pin != cfg.pin ||
                memcmp(n.apin, cfg.apin, sizeof(n.apin)) != 0 || strcmp(n.name, cfg.name) != 0;
  bool lenChanged = n.count != cfg.count;
  cfg = n;
  configSave(cfg);
  if (!reboot) {
    out.applyLive(cfg);
    if (lenChanged) engine.setLength(out.length());
  }
  sendInfo();
  if (reboot) {
    txDoc.clear();
    txDoc["t"] = "reboot";
    sendDoc();
    rebootAt = millis() + 800;
  }
}

// ---------------------------------------------------------------- bejövő

static void onFast(const uint8_t* d, size_t n) {
  uint32_t now = millis();
  switch (d[0]) {
    case CMD_COLOR:
      if (n >= 4) {
        engine.setSolid(px(d[1], d[2], d[3], n >= 5 ? d[4] : 0), now);
        powerOn = true;
        markMode();
      }
      break;
    case CMD_BRI:
      if (n >= 2) { brightness = d[1]; markState(); }
      break;
    case CMD_POWER:
      if (n >= 2) { powerOn = d[1] != 0; markState(); }
      break;
    case CMD_SPEED:
      if (n >= 2) { engine.setSpeed(d[1]); markMode(); }
      break;
    case CMD_INTENS:
      if (n >= 2) { engine.setIntensity(d[1]); markMode(); }
      break;
    case CMD_PCOLOR:
      if (n >= 5) { engine.setColor(d[1], px(d[2], d[3], d[4], n >= 6 ? d[5] : 0)); markMode(); }
      break;
  }
}

static void onJson(const char* s, size_t n) {
  rxDoc.clear();
  if (deserializeJson(rxDoc, s, n)) { sendErr("?", "parse"); return; }
  const char* t = rxDoc["t"] | "";
  const char* err = nullptr;

  if (!strcmp(t, "hello")) {
    sendInfo();
    sendState();
    sendCur();
    sendList();
  } else if (!strcmp(t, "play")) {
    JsonObjectConst mo = rxDoc["mode"].as<JsonObjectConst>();
    if (!mo.isNull()) {
      if (!modeFromJson(mo, tmpMode, err)) { sendErr("play", err); return; }
    } else if (!libLoad(rxDoc["name"] | "", tmpMode)) {
      sendErr("play", "not_found");
      return;
    }
    long fade = rxDoc["fade"] | 400L;
    playMode(tmpMode, (uint16_t)constrain(fade, 0L, 5000L));
  } else if (!strcmp(t, "save")) {
    if (!modeFromJson(rxDoc["mode"].as<JsonObjectConst>(), tmpMode, err)) { sendErr("save", err); return; }
    if (!libSave(tmpMode, err)) { sendErr("save", err); return; }
    sendOk("save", tmpMode.name);
    sendList();
    if (rxDoc["play"] | false) playMode(tmpMode, 400);
  } else if (!strcmp(t, "del")) {
    const char* name = rxDoc["name"] | "";
    if (!libDelete(name)) { sendErr("del", "not_found"); return; }
    sendOk("del", name);
    sendList();
  } else if (!strcmp(t, "list")) {
    sendList();
  } else if (!strcmp(t, "get")) {
    if (!libLoad(rxDoc["name"] | "", tmpMode)) { sendErr("get", "not_found"); return; }
    txDoc.clear();
    txDoc["t"] = "mode";
    modeToJson(tmpMode, txDoc["mode"].to<JsonObject>());
    sendDoc();
  } else if (!strcmp(t, "cfg")) {
    applyConfig(rxDoc["cfg"].as<JsonObjectConst>());
  } else if (!strcmp(t, "timer")) {
    long min = rxDoc["min"] | 0L;
    sleepAt = min > 0 ? millis() + (uint32_t)constrain(min, 1L, 1440L) * 60000UL : 0;
    if (min > 0 && !sleepAt) sleepAt = 1;
    sendState();
  } else if (!strcmp(t, "power")) {
    powerOn = rxDoc["on"] | true;
    markState();
  } else if (!strcmp(t, "bri")) {
    brightness = (uint8_t)constrain(rxDoc["v"] | (long)brightness, 0L, 255L);
    markState();
  } else if (!strcmp(t, "reboot")) {
    rebootAt = millis() + 300;
  } else {
    sendErr(t, "unknown_cmd");
  }
}

// ---------------------------------------------------------------- gomb

static void handleButton(uint32_t now) {
  static bool lastLevel = HIGH, stable = HIGH, longDone = false;
  static uint32_t changeAt = 0, pressAt = 0;
  bool level = digitalRead(BOOT_BUTTON_PIN);
  if (level != lastLevel) { lastLevel = level; changeAt = now; return; }
  if (now - changeAt < 30 || level == stable) {
    if (stable == LOW && !longDone && now - pressAt > 800) { longDone = true; nextSavedMode(); }
    return;
  }
  stable = level;
  if (stable == LOW) {
    pressAt = now;
    longDone = false;
  } else if (!longDone) {
    powerOn = !powerOn;
    markState();
  }
}

// ---------------------------------------------------------------- setup / loop

void setup() {
#ifdef FENYCSIK_SERIAL_TEST
  Serial.setRxBufferSize(MAX_MSG_SIZE);  // teszt módban egész JSON sorok jönnek a soros porton
#endif
  Serial.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT && ARDUINO_USB_MODE
  Serial.setTxTimeoutMs(0);  // natív USB: ne akadjon meg, ha a gépen senki nem olvassa a soros portot
#endif
  delay(50);
  Serial.printf("\nFenycsik %s (%s)\n", FW_VERSION, CHIP_FAMILY);

  colorTablesInit();
  storageBegin();
  configLoad(cfg);
  if (!pinAllowed(cfg.pin)) cfg.pin = DEFAULT_DATA_PIN;
  for (int k = 0; k < 3; k++)
    if (!pinAllowed(cfg.apin[k])) {
      cfg.apin[0] = DEFAULT_APIN_R; cfg.apin[1] = DEFAULT_APIN_G;
      cfg.apin[2] = DEFAULT_APIN_B; cfg.apin[3] = DEFAULT_APIN_W;
      break;
    }

  out.begin(cfg);
  engine.begin(out.length());
  stateLoad(powerOn, brightness);

  libSeedExamples();
  libScan();
  if (!currentLoad(tmpMode)) {
    tmpMode.clear();
    tmpMode.p.reset(FX_RAINBOW);
    utf8Copy(tmpMode.name, "Szivárvány", sizeof(tmpMode.name));
  }
  engine.play(tmpMode, millis(), 0);

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  bleBegin(cfg.name, onFast, onJson);
  Serial.printf("[cfg] tipus=%s sorrend=%s led=%u lab=%d\n", typeName(cfg.type), cfg.order, cfg.count, cfg.pin);
  lastFrame = millis();
}

void loop() {
  uint32_t now = millis();
  bleLoop();
  handleButton(now);

  if (sleepAt && (int32_t)(now - sleepAt) >= 0) {
    sleepAt = 0;
    powerOn = false;
    markState();
  }
  if (rebootAt && (int32_t)(now - rebootAt) >= 0) {
    if (persistDirty) persist();
    ESP.restart();
  }

  if (now - lastFrame >= FRAME_MS) {
    uint32_t dt = now - lastFrame;
    lastFrame = now;
    float target = powerOn ? brightness : 0;
    float k = dt / 120.0f;
    if (k > 1) k = 1;
    curBri += (target - curBri) * k;
    if (fabsf(target - curBri) < 0.4f) curBri = target;
    engine.render(now, frame);
    out.show(frame, curBri);
  }

  if (persistDirty && now - dirtyAt > PERSIST_DELAY_MS) persist();
  if ((bcastState || bcastMode) && now - bcastAt > 300) {
    if (bcastMode) sendCur();
    if (bcastState) sendState();
    bcastState = bcastMode = false;
  }
  delay(1);
}
