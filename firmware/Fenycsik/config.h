// =====================================================================
//  Fénycsík – ESP32 LED szalag vezérlő
//  Alapértelmezések és korlátok.
//
//  Szinte minden (szalag típusa, LED-szám, adatláb, színsorrend,
//  áramkorlát, név) az appból is beállítható, ezt a fájlt csak akkor
//  kell módosítani, ha más gyári alapértelmezést szeretnél.
// =====================================================================
#pragma once
#include <Arduino.h>

#define FW_VERSION "1.0.0"

// ---- Szalag típusok -------------------------------------------------
#define STRIP_RGB    0   // címezhető 3 csatornás (WS2812B, WS2811, SK6812 RGB)
#define STRIP_RGBW   1   // címezhető 4 csatornás (SK6812 RGBW)
#define STRIP_ANALOG 2   // sima 12V/24V RGB(W) szalag MOSFET-ekkel, PWM

// ---- Gyári alapértelmezések -----------------------------------------
#define DEFAULT_TYPE        STRIP_RGB
#define DEFAULT_ORDER       "GRB"     // WS2812B: GRB, SK6812 RGBW: GRBW
#define DEFAULT_COUNT       60
#define DEFAULT_DATA_PIN    4         // ESP32, S3 és C3 lapokon is szabad láb
#define DEFAULT_MAX_MA      1500      // becsült áramkorlát mA-ben (0 = kikapcsolva)
#define DEFAULT_BRIGHTNESS  128
#define DEFAULT_NAME_PREFIX "Fenycsik"

#if CONFIG_IDF_TARGET_ESP32C3
  #define CHIP_FAMILY      "ESP32-C3"
  #define BOOT_BUTTON_PIN  9
  #define DEFAULT_APIN_R   5
  #define DEFAULT_APIN_G   6
  #define DEFAULT_APIN_B   7
  // Használható kimeneti lábak (flash/USB/UART lábak kihagyva)
  #define ALLOWED_PINS { 0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 20, 21 }
#elif CONFIG_IDF_TARGET_ESP32S3
  #define CHIP_FAMILY      "ESP32-S3"
  #define BOOT_BUTTON_PIN  0
  #define DEFAULT_APIN_R   5
  #define DEFAULT_APIN_G   6
  #define DEFAULT_APIN_B   7
  #define ALLOWED_PINS { 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47, 48 }
#else  // klasszikus ESP32 (WROOM / DevKit)
  #define CHIP_FAMILY      "ESP32"
  #define BOOT_BUTTON_PIN  0
  #define DEFAULT_APIN_R   25
  #define DEFAULT_APIN_G   26
  #define DEFAULT_APIN_B   27
  #define ALLOWED_PINS { 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 }
#endif
#define DEFAULT_APIN_W -1             // fehér csatorna (RGBW analóg szalaghoz), -1 = nincs

// ---- Korlátok ------------------------------------------------------
#define MAX_LEDS_RGB     1000
#define MAX_LEDS_RGBW    750
#define MAX_LEDS         1000         // belső pufferek mérete
#define MAX_COLORS       8            // egy effekt színpalettája
#define MAX_FRAMES       48           // kulcskockák egy "keyframes" módban
#define MAX_STEPS        16           // lépések egy "playlist" módban
#define MAX_SAVED_MODES  60           // az ESP32-n tárolható módok
#define MODE_NAME_MAX    48           // bájt (UTF-8)
#define MAX_MSG_SIZE     8192         // egy BLE JSON üzenet maximális mérete

#define ANALOG_PWM_FREQ  5000
#define ANALOG_PWM_BITS  12
#define FRAME_MS         16           // ~60 fps
#define PERSIST_DELAY_MS 2500         // ennyi tétlenség után ment a flash-be
