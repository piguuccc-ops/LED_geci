// Bluetooth LE kapcsolat (NimBLE)
//
// Protokoll (az app js/protocol.js fájljával egyezik):
//   Szolgáltatás  f3c10001-6a2e-4b1d-9c58-2d7e0a4b9e17
//   RX (írás)     f3c10002-...  app -> ESP32
//   TX (értesít)  f3c10003-...  ESP32 -> app
//
// Minden csomag első bájtja a típus:
//   0x01 JSON eleje, 0x02 folytatás, 0x03 vége, 0x04 egész JSON egy csomagban
//   0x10 r g b [w]      szín (egyszínű mód, azonnal)
//   0x11 b              fényerő 0..255
//   0x12 0|1            ki / be
//   0x13 s              sebesség
//   0x14 i              intenzitás
//   0x15 idx r g b [w]  az aktuális effekt idx-edik színe
#pragma once
#include <Arduino.h>

#define BLE_SVC_UUID "f3c10001-6a2e-4b1d-9c58-2d7e0a4b9e17"
#define BLE_RX_UUID  "f3c10002-6a2e-4b1d-9c58-2d7e0a4b9e17"
#define BLE_TX_UUID  "f3c10003-6a2e-4b1d-9c58-2d7e0a4b9e17"

#define PKT_START  0x01
#define PKT_CONT   0x02
#define PKT_END    0x03
#define PKT_SINGLE 0x04
#define CMD_COLOR  0x10
#define CMD_BRI    0x11
#define CMD_POWER  0x12
#define CMD_SPEED  0x13
#define CMD_INTENS 0x14
#define CMD_PCOLOR 0x15

typedef void (*FastCmdHandler)(const uint8_t* data, size_t len);
typedef void (*JsonMsgHandler)(const char* json, size_t len);

void bleBegin(const char* name, FastCmdHandler onFast, JsonMsgHandler onJson);
void bleLoop();                         // a fő ciklusból: beérkezett csomagok feldolgozása
void bleSend(const char* json, size_t len);
uint8_t bleClients();
