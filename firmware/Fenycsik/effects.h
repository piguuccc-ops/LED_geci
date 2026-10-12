// Effekt motor: a módot (Mode) képkockánként pixelekre rendereli.
// Ugyanez a logika JavaScriptben is megvan az appban (előnézethez).
#pragma once
#include "color.h"
#include "config.h"

enum FxId : uint8_t {
  FX_SOLID, FX_BREATHE, FX_RAINBOW, FX_COLORLOOP, FX_GRADIENT, FX_CHASE,
  FX_COMET, FX_SCANNER, FX_TWINKLE, FX_FIRE, FX_STROBE, FX_WAVE,
  FX_KEYFRAMES, FX_PLAYLIST, FX_COUNT
};

extern const char* const FX_NAMES[FX_COUNT];
int fxFromName(const char* s);

// Egy effekt paraméterei (a playlist lépései is ilyenek)
struct FxParams {
  uint8_t fx;
  uint8_t speed;       // 0..255 (0 = áll)
  uint8_t intensity;   // 0..255, effektfüggő (méret, sűrűség, mélység...)
  bool reverse;
  uint8_t ncol;
  Px col[MAX_COLORS];
  uint32_t duration;   // ms, csak playlist lépésnél
  void reset(uint8_t effect);   // effekt alapértelmezései (színekkel együtt)
};

struct Keyframe {
  Px c;
  uint32_t fade;   // ms: átúszás az előző színből
  uint32_t hold;   // ms: kitartás
};

struct Mode {
  char name[MODE_NAME_MAX];
  FxParams p;
  int16_t brightness;     // -1 = nem állít fényerőt
  bool loop;
  uint16_t transition;    // ms, playlist lépések közti átúszás
  uint8_t nframes;
  Keyframe frames[MAX_FRAMES];
  uint8_t nsteps;
  FxParams steps[MAX_STEPS];
  void clear();
};

class Engine {
 public:
  void begin(uint16_t n);
  void setLength(uint16_t n);
  uint16_t length() const { return n_; }

  // Új mód indítása fadeMs ms átúszással
  void play(const Mode& m, uint32_t now, uint16_t fadeMs);
  const Mode& mode() const { return mode_; }
  Mode& modeMut() { return mode_; }

  void render(uint32_t now, Px* out);

  // Élő állítás (csúszkák)
  void setSolid(const Px& c, uint32_t now);
  void setSpeed(uint8_t s);
  void setIntensity(uint8_t i);
  void setColor(uint8_t idx, const Px& c);

 private:
  void resetState();
  void startTransition(uint32_t now, uint16_t ms);
  void renderFx(const FxParams& p, Px* out);
  void fill(Px* out, const Px& c);
  Px palCyclic(const FxParams& p, uint16_t pos) const;
  Px palLinear(const FxParams& p, uint16_t pos) const;

  void fxBreathe(const FxParams& p, Px* out);
  void fxRainbow(const FxParams& p, Px* out);
  void fxGradient(const FxParams& p, Px* out);
  void fxChase(const FxParams& p, Px* out);
  void fxComet(const FxParams& p, Px* out);
  void fxScanner(const FxParams& p, Px* out);
  void fxTwinkle(const FxParams& p, Px* out, uint32_t dt, uint32_t rate);
  void fxFire(const FxParams& p, Px* out, uint32_t dt, uint32_t rate);
  void fxStrobe(const FxParams& p, Px* out);
  void fxWave(const FxParams& p, Px* out);
  void fxKeyframes(Px* out);

  Mode mode_;
  uint16_t n_ = 1;
  uint64_t phase_ = 0;
  uint64_t kfAcc_ = 0;
  uint32_t last_ = 0;
  uint32_t acc_ = 0;      // twinkle/fire szimulációs idő
  uint32_t acc2_ = 0;
  uint8_t step_ = 0;
  uint32_t stepStart_ = 0;
  bool inTrans_ = false;
  uint32_t transStart_ = 0;
  uint16_t transDur_ = 0;
};

// Effekt alapértelmezések (az app ugyanezeket használja)
uint8_t fxDefaultSpeed(uint8_t fx);
uint8_t fxDefaultIntensity(uint8_t fx);
