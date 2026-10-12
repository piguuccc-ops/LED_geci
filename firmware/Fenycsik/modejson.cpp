#include "modejson.h"

void utf8Copy(char* dst, const char* src, size_t size) {
  if (!size) return;
  size_t n = src ? strlen(src) : 0;
  if (n >= size) {
    n = size - 1;
    while (n > 0 && ((uint8_t)src[n] & 0xC0) == 0x80) n--;  // folytató bájt -> visszalépünk
  }
  if (n) memcpy(dst, src, n);
  dst[n] = 0;
}

static uint8_t clamp8(long v) { return v < 0 ? 0 : (v > 255 ? 255 : (uint8_t)v); }
static uint32_t clampU32(long long v, uint32_t lo, uint32_t hi) {
  if (v < (long long)lo) return lo;
  if (v > (long long)hi) return hi;
  return (uint32_t)v;
}

bool parseColor(JsonVariantConst v, Px& out) {
  if (v.is<const char*>()) return parseHex(v.as<const char*>(), out);
  if (v.is<JsonArrayConst>()) {
    JsonArrayConst a = v.as<JsonArrayConst>();
    if (a.size() < 3) return false;
    out = px(clamp8(a[0] | 0), clamp8(a[1] | 0), clamp8(a[2] | 0), clamp8(a.size() > 3 ? (a[3] | 0) : 0));
    return true;
  }
  if (v.is<JsonObjectConst>()) {
    JsonObjectConst o = v.as<JsonObjectConst>();
    out = px(clamp8(o["r"] | 0), clamp8(o["g"] | 0), clamp8(o["b"] | 0), clamp8(o["w"] | 0));
    return true;
  }
  return false;
}

static bool parseParams(JsonObjectConst o, FxParams& p, bool top, const char*& err) {
  const char* fxName = o["effect"] | "solid";
  int id = fxFromName(fxName);
  if (id < 0) { err = "unknown_effect"; return false; }
  if (!top && (id == FX_PLAYLIST || id == FX_KEYFRAMES)) { err = "nested"; return false; }
  p.reset((uint8_t)id);
  if (o["speed"].is<long>()) p.speed = clamp8(o["speed"].as<long>());
  if (o["intensity"].is<long>()) p.intensity = clamp8(o["intensity"].as<long>());
  if (o["reverse"].is<bool>()) p.reverse = o["reverse"].as<bool>();
  if (o["duration"].is<long>()) p.duration = clampU32(o["duration"].as<long>(), 500, 86400000UL);
  JsonArrayConst cols = o["colors"].as<JsonArrayConst>();
  if (!cols.isNull()) {
    uint8_t k = 0;
    for (JsonVariantConst v : cols) {
      if (k >= MAX_COLORS) break;
      Px c;
      if (!parseColor(v, c)) { err = "bad_color"; return false; }
      p.col[k++] = c;
    }
    p.ncol = k;
    if (k == 0 && id == FX_SOLID) { p.col[0] = BLACK; p.ncol = 1; }
  }
  return true;
}

bool modeFromJson(JsonObjectConst o, Mode& m, const char*& err) {
  err = nullptr;
  m.clear();
  if (o.isNull()) { err = "bad_mode"; return false; }
  utf8Copy(m.name, o["name"] | "", sizeof(m.name));
  if (!parseParams(o, m.p, true, err)) return false;
  if (o["brightness"].is<long>()) m.brightness = clamp8(o["brightness"].as<long>());
  if (o["loop"].is<bool>()) m.loop = o["loop"].as<bool>();
  if (o["transition"].is<long>()) m.transition = (uint16_t)clampU32(o["transition"].as<long>(), 0, 10000);

  if (m.p.fx == FX_KEYFRAMES) {
    JsonArrayConst fr = o["frames"].as<JsonArrayConst>();
    if (fr.isNull() || fr.size() == 0) { err = "no_frames"; return false; }
    for (JsonObjectConst f : fr) {
      if (m.nframes >= MAX_FRAMES) break;
      Keyframe k;
      if (!parseColor(f["color"], k.c)) { err = "bad_color"; return false; }
      k.fade = clampU32(f["fade"] | 1000L, 0, 3600000UL);
      k.hold = clampU32(f["hold"] | 1000L, 0, 86400000UL);
      m.frames[m.nframes++] = k;
    }
  }
  if (m.p.fx == FX_PLAYLIST) {
    JsonArrayConst st = o["steps"].as<JsonArrayConst>();
    if (st.isNull() || st.size() == 0) { err = "no_steps"; return false; }
    for (JsonObjectConst s : st) {
      if (m.nsteps >= MAX_STEPS) break;
      FxParams sp;
      if (!parseParams(s, sp, false, err)) return false;
      m.steps[m.nsteps++] = sp;
    }
  }
  return true;
}

static void paramsToJson(const FxParams& p, JsonObject o, bool withDuration) {
  o["effect"] = FX_NAMES[p.fx];
  if (p.fx != FX_SOLID && p.fx != FX_PLAYLIST) {
    o["speed"] = p.speed;
    o["intensity"] = p.intensity;
  }
  if (p.reverse) o["reverse"] = true;
  if (p.ncol) {
    JsonArray a = o["colors"].to<JsonArray>();
    for (uint8_t k = 0; k < p.ncol; k++) {
      char hex[10];
      toHex(p.col[k], hex);
      a.add((char*)hex);  // char* -> az ArduinoJson lemásolja
    }
  }
  if (withDuration) o["duration"] = p.duration;
}

void modeToJson(const Mode& m, JsonObject o) {
  o["ledmode"] = 1;
  o["name"] = (char*)m.name;
  paramsToJson(m.p, o, false);
  if (m.brightness >= 0) o["brightness"] = m.brightness;
  if (!m.loop) o["loop"] = false;
  if (m.p.fx == FX_PLAYLIST && m.transition != 600) o["transition"] = m.transition;
  if (m.p.fx == FX_KEYFRAMES) {
    JsonArray fr = o["frames"].to<JsonArray>();
    for (uint8_t k = 0; k < m.nframes; k++) {
      JsonObject f = fr.add<JsonObject>();
      char hex[10];
      toHex(m.frames[k].c, hex);
      f["color"] = (char*)hex;
      f["fade"] = m.frames[k].fade;
      f["hold"] = m.frames[k].hold;
    }
  }
  if (m.p.fx == FX_PLAYLIST) {
    JsonArray st = o["steps"].to<JsonArray>();
    for (uint8_t k = 0; k < m.nsteps; k++) paramsToJson(m.steps[k], st.add<JsonObject>(), true);
  }
}
