#include "ble.h"
#include "config.h"
#include <NimBLEDevice.h>
#include "freertos/ringbuf.h"
#include <string>
#include <vector>

#ifdef FENYCSIK_SERIAL_TEST
// ---------------------------------------------------------------------
// Teszt mód (QEMU / soros monitor): Bluetooth helyett soros port.
//   {"t":"hello"}        -> JSON parancs, a válasz "[TX] {...}" sorokban jön
//   F 10 FF 00 00        -> gyors parancs hexa bájtokkal
// Bekapcsolás: fordításkor -DFENYCSIK_SERIAL_TEST
// ---------------------------------------------------------------------
static FastCmdHandler t_onFast = nullptr;
static JsonMsgHandler t_onJson = nullptr;
static std::string t_line;

void bleBegin(const char* name, FastCmdHandler onFast, JsonMsgHandler onJson) {
  t_onFast = onFast;
  t_onJson = onJson;
  Serial.printf("[test] soros teszt mód, név: %s\n", name);
}

void bleLoop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c != '\n' && c != '\r') { if (t_line.size() < MAX_MSG_SIZE) t_line += c; continue; }
    if (t_line.empty()) continue;
    if (t_line[0] == '{') {
      t_onJson(t_line.data(), t_line.size());
    } else if (t_line[0] == 'F') {
      uint8_t buf[16];
      size_t n = 0;
      const char* p = t_line.c_str() + 1;
      while (*p && n < sizeof(buf)) {
        while (*p == ' ') p++;
        if (!*p) break;
        buf[n++] = (uint8_t)strtoul(p, (char**)&p, 16);
      }
      if (n) t_onFast(buf, n);
    }
    t_line.clear();
  }
}

void bleSend(const char* json, size_t len) {
  Serial.print("[TX] ");
  Serial.write((const uint8_t*)json, len);
  Serial.println();
}

uint8_t bleClients() { return 1; }

#else

// A BLE visszahívások a NimBLE taszkban futnak: csak bemásolják a csomagot
// egy gyűrűs pufferbe, a feldolgozás a fő ciklusban (bleLoop) történik.
// Elem formátum: [típus 'P' vagy 'D'][conn lo][conn hi][adat...]

static RingbufHandle_t s_rb = nullptr;
static NimBLEServer* s_server = nullptr;
static NimBLECharacteristic* s_tx = nullptr;
static FastCmdHandler s_onFast = nullptr;
static JsonMsgHandler s_onJson = nullptr;

struct Assembly {
  uint16_t h;
  bool active;
  std::string buf;
};
static Assembly s_asm[CONFIG_BT_NIMBLE_MAX_CONNECTIONS + 1];

class ServerCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& ci) override {
    // gyorsabb kapcsolati intervallum (10-20 ms) a fürge csúszkákért
    s->updateConnParams(ci.getConnHandle(), 8, 16, 0, 400);
    if (s->getConnectedCount() < CONFIG_BT_NIMBLE_MAX_CONNECTIONS) NimBLEDevice::startAdvertising();
    Serial.printf("[ble] csatlakozott (%u)\n", s->getConnectedCount());
  }
  void onDisconnect(NimBLEServer* s, NimBLEConnInfo& ci, int reason) override {
    uint16_t h = ci.getConnHandle();
    uint8_t item[3] = {'D', (uint8_t)(h & 0xFF), (uint8_t)(h >> 8)};
    if (s_rb) xRingbufferSend(s_rb, item, sizeof(item), 0);
    Serial.printf("[ble] lecsatlakozott (ok: %d)\n", reason);
  }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo& ci) override {
    Serial.printf("[ble] MTU: %u\n", mtu);
  }
};

class RxCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo& ci) override {
    static uint8_t item[3 + 512];  // a NimBLE taszk egyszálú, a statikus puffer biztonságos
    NimBLEAttValue v = c->getValue();
    size_t n = v.size();
    if (n == 0 || n > 512 || !s_rb) return;
    uint16_t h = ci.getConnHandle();
    item[0] = 'P';
    item[1] = (uint8_t)(h & 0xFF);
    item[2] = (uint8_t)(h >> 8);
    memcpy(item + 3, v.data(), n);
    if (xRingbufferSend(s_rb, item, n + 3, pdMS_TO_TICKS(50)) != pdTRUE)
      Serial.println("[ble] puffer tele, csomag eldobva");
  }
};

static Assembly* findAssembly(uint16_t h, bool create) {
  for (auto& a : s_asm)
    if (a.active && a.h == h) return &a;
  if (!create) return nullptr;
  for (auto& a : s_asm)
    if (!a.active) { a.h = h; a.buf.clear(); return &a; }
  return nullptr;
}

static void sendError(const char* msg) {
  char js[64];
  int n = snprintf(js, sizeof(js), "{\"t\":\"err\",\"op\":\"rx\",\"msg\":\"%s\"}", msg);
  bleSend(js, n);
}

static void handlePacket(uint16_t h, const uint8_t* d, size_t n) {
  uint8_t t = d[0];
  if (t >= 0x10) {
    if (s_onFast) s_onFast(d, n);
    return;
  }
  if (t == PKT_SINGLE) {
    if (s_onJson) s_onJson((const char*)d + 1, n - 1);
    return;
  }
  if (t == PKT_START) {
    Assembly* a = findAssembly(h, true);
    if (!a) return;
    a->buf.assign((const char*)d + 1, n - 1);
    a->active = true;
    return;
  }
  if (t == PKT_CONT || t == PKT_END) {
    Assembly* a = findAssembly(h, false);
    if (!a) return;
    if (a->buf.size() + n - 1 > MAX_MSG_SIZE) {
      a->active = false;
      a->buf.clear();
      a->buf.shrink_to_fit();
      sendError("too_large");
      return;
    }
    a->buf.append((const char*)d + 1, n - 1);
    if (t == PKT_END) {
      std::string msg;
      msg.swap(a->buf);
      a->active = false;
      if (s_onJson) s_onJson(msg.data(), msg.size());
    }
  }
}

void bleBegin(const char* name, FastCmdHandler onFast, JsonMsgHandler onJson) {
  s_onFast = onFast;
  s_onJson = onJson;
  s_rb = xRingbufferCreate(16384, RINGBUF_TYPE_NOSPLIT);

  NimBLEDevice::init(name);
  NimBLEDevice::setMTU(517);
  NimBLEDevice::setPower(9);

  s_server = NimBLEDevice::createServer();
  s_server->setCallbacks(new ServerCb());
  s_server->advertiseOnDisconnect(true);

  NimBLEService* svc = s_server->createService(BLE_SVC_UUID);
  NimBLECharacteristic* rx =
      svc->createCharacteristic(BLE_RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCb());
  s_tx = svc->createCharacteristic(BLE_TX_UUID, NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
  s_tx->setValue("{\"fw\":\"" FW_VERSION "\"}");

  // Hirdetés: a szolgáltatás UUID a fő csomagban (erre szűr az app), a név a scan válaszban
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  NimBLEAdvertisementData ad, sd;
  ad.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  ad.setCompleteServices(NimBLEUUID(BLE_SVC_UUID));
  sd.setName(name);
  adv->enableScanResponse(true);
  adv->setAdvertisementData(ad);
  adv->setScanResponseData(sd);
  adv->start();
  Serial.printf("[ble] hirdetés indult: %s\n", name);
}

void bleLoop() {
  if (!s_rb) return;
  for (int k = 0; k < 24; k++) {
    size_t sz = 0;
    uint8_t* it = (uint8_t*)xRingbufferReceive(s_rb, &sz, 0);
    if (!it) break;
    uint16_t h = it[1] | (it[2] << 8);
    if (it[0] == 'D') {
      Assembly* a = findAssembly(h, false);
      if (a) { a->active = false; a->buf.clear(); a->buf.shrink_to_fit(); }
    } else if (sz > 3) {
      handlePacket(h, it + 3, sz - 3);
    }
    vRingbufferReturnItem(s_rb, it);
  }
}

static bool notifyRetry(const uint8_t* d, size_t n, uint16_t h) {
  for (int i = 0; i < 40; i++) {
    if (s_tx->notify(d, n, h)) return true;
    delay(5);  // elfogyott a NimBLE puffer: kicsit várunk
  }
  return false;
}

void bleSend(const char* json, size_t len) {
  if (!s_server || !s_tx || !len) return;
  std::vector<uint16_t> peers = s_server->getPeerDevices();
  if (peers.empty()) return;
  uint16_t mtu = 517;
  for (uint16_t h : peers) {
    uint16_t m = s_server->getPeerMTU(h);
    if (m && m < mtu) mtu = m;
  }
  size_t chunk = mtu > 24 ? mtu - 4 : 19;
  if (chunk > 244) chunk = 244;
  static uint8_t pkt[1 + 244];
  for (uint16_t h : peers) {
    if (len <= chunk) {
      pkt[0] = PKT_SINGLE;
      memcpy(pkt + 1, json, len);
      notifyRetry(pkt, len + 1, h);
      continue;
    }
    for (size_t off = 0; off < len;) {
      size_t n = min(chunk, len - off);
      pkt[0] = off == 0 ? PKT_START : (off + n >= len ? PKT_END : PKT_CONT);
      memcpy(pkt + 1, json + off, n);
      if (!notifyRetry(pkt, n + 1, h)) break;
      off += n;
    }
  }
}

uint8_t bleClients() { return s_server ? s_server->getConnectedCount() : 0; }

#endif  // FENYCSIK_SERIAL_TEST
