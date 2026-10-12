# Fénycsík – ESP32 LED szalag vezérlő Bluetooth-on

Egy ESP32-re töltött firmware és egy hozzá tartozó app, ami **Androidon és Windowson is** ugyanúgy fut. Az app Bluetooth-on csatlakozik az ESP32-höz, és onnan állítod:

- a színt csúszkákkal (HSV vagy RGB), pontos **hex** kóddal vagy **R/G/B számokkal**,
- a fényerőt és a ki/be kapcsolást,
- az automatikus módokat: 12 beépített effekt, saját színsorok és lejátszási listák,
- a módokat **fájlként** (`.ledmode`): letöltheted, megoszthatod, és egy figyelt mappából az app magától beolvassa őket.

A módok az ESP32-re is felkerülnek, így app nélkül is futnak (a BOOT gombbal lapozhatók), és áramszünet után is onnan folytatja, ahol abbahagyta.

> **Miért webes app és nem APK?** A Mi 11 Pro HyperOS-a minden oldalról telepített APK-t elutasít. Ez az app ezért úgy készült, mint a számológéped: Chrome-ból telepíted a telefonra, Edge-ből vagy Chrome-ból a laptopra, és mindkettőn rendes alkalmazásként jelenik meg (saját ikon, saját ablak, offline is indul). Bluetooth-ot a Chrome/Edge „Web Bluetooth” funkciójával használ.

---

## Mi van a csomagban

```
fenycsik/
├── firmware/Fenycsik/     ESP32 forráskód (Arduino)
└── docs/                  ez megy fel a GitHub Pages-re
    ├── index.html         az app
    ├── flash.html         firmware feltöltése böngészőből
    ├── firmware/          lefordított firmware ESP32, ESP32-S3 és ESP32-C3 lapkára
    ├── modes/             példa .ledmode fájlok
    └── js/, app.css, …    az app többi része
```

---

## 1. Bekötés

### Címezhető szalag (WS2812B, SK6812, WS2811) – ajánlott

```
 5 V táp (+) ──────────────┬──────────────────────── szalag +5V
                           │
                         1000 µF
                           │
 5 V táp (−) ──────────────┴───────┬──────────────── szalag GND
                                   │
 ESP32 GND ────────────────────────┘   (közös föld, enélkül villog!)

 ESP32 GPIO 4 ──── 330 Ω ─────────────────────────── szalag DIN
```

- Az ESP32-t mehet USB-ről, de a **szalag ne az ESP32 5 V lábáról** kapja az áramot, ha 10–15 LED-nél több van.
- Egy LED teljes fehéren kb. 60 mA. 60 LED → kb. 3,6 A. Az app *Áramkorlát* beállítása ennél kisebbre korlátozza a fényerőt (alapból 1500 mA), hogy a táp ne essen össze.
- Hosszabb (1 m-nél hosszabb) adatkábelnél vagy villogásnál tegyél 74AHCT125 szintillesztőt a GPIO és a DIN közé.

### Sima 12 V-os RGB szalag (4 vezetékes, nem címezhető)

Csatornánként egy logikai szintű N-csatornás MOSFET kell (pl. IRLZ44N vagy AO3400 modul):

```
 ESP32 GPIO (R) ── 100 Ω ── MOSFET gate      (gate–GND között 10 kΩ)
                            MOSFET drain ─── szalag R vezeték
                            MOSFET source ── GND
 12 V táp (+) ───────────────────────────── szalag +12V
 12 V táp (−) ── GND ── ESP32 GND
```

Ugyanígy a G és B csatornára (RGBW szalagnál a W-re is). Az ESP32-t a 12 V-ról egy 5 V-os step-down modullal vagy USB-ről táplálhatod.

### Alapértelmezett lábak

|                    | ESP32 (DevKit) | ESP32-S3 | ESP32-C3 |
|--------------------|----------------|----------|----------|
| Címezhető szalag   | GPIO 4         | GPIO 4   | GPIO 4   |
| Sima RGB: R / G / B | 25 / 26 / 27  | 5 / 6 / 7 | 5 / 6 / 7 |
| BOOT gomb          | GPIO 0         | GPIO 0   | GPIO 9   |

Mindet átállíthatod az appban (*Beállítás* fül), újrafordítás nélkül. Az app csak azokat a lábakat kínálja fel, amik az adott lapkán biztonságosan használhatók.

---

## 2. Az app közzététele GitHub Pages-en

A Bluetooth csak HTTPS-ről működik, ezért az appot a GitHub Pages szolgálja ki (ingyenes).

1. Hozz létre egy új repót, pl. `fenycsik` néven.
2. Töltsd fel a teljes `fenycsik` mappa tartalmát (a `docs` mappával együtt).
3. *Settings → Pages → Build and deployment*: Source **Deploy from a branch**, Branch **main**, mappa **/docs** → Save.
4. Egy-két perc múlva elérhető: `https://piguuccc-ops.github.io/fenycsik/`

Privát repóból a Pages csak GitHub Pro-val működik; ebben a kódban nincs titok, nyugodtan lehet nyilvános.

---

## 3. Firmware feltöltése az ESP32-re

### A) Böngészőből (legegyszerűbb)

1. A laptopon Chrome-ban vagy Edge-ben nyisd meg: `https://piguuccc-ops.github.io/fenycsik/flash.html`
2. Dugd be az ESP32-t USB-adatkábellel, kattints a **Connect** gombra, válaszd ki a portot.
3. Első alkalommal pipáld be az **Erase device**-t. Később frissítésnél hagyd üresen, így megmaradnak a beállítások és a módok.

A lapka típusát magától felismeri (ESP32, ESP32-S3, ESP32-C3). Ha „Connecting…”-nél elakad, tartsd nyomva a BOOT gombot az írás elindulásáig.

### B) Arduino IDE-vel

1. *Eszközök → Alaplap → Alaplapkezelő*: **esp32 by Espressif**, 3.x verzió.
2. *Könyvtárkezelő*: **NimBLE-Arduino** (h2zero, 2.x), **Adafruit NeoPixel**, **ArduinoJson** (7.x).
3. Nyisd meg a `firmware/Fenycsik/Fenycsik.ino` fájlt, válaszd ki a lapkát (pl. *ESP32 Dev Module*), és töltsd fel.
   ESP32-C3 SuperMini lapkánál kapcsold be: *USB CDC On Boot: Enabled*.

A soros monitoron (115200) látszik az indulás és a Bluetooth események.

---

## 4. Az app telepítése

**Telefonon (Chrome):** nyisd meg a `https://piguuccc-ops.github.io/fenycsik/` címet → ⋮ menü → **Alkalmazás telepítése**. Első csatlakozáskor a Chrome engedélyt kér a közeli eszközökhöz; ha nem kérdezi és nem talál semmit: *Beállítások → Alkalmazások → Chrome → Engedélyek → Közeli eszközök* (régebbi rendszeren *Helymeghatározás*), és legyen bekapcsolva a Bluetooth.

**Laptopon (Edge vagy Chrome):** nyisd meg ugyanezt a címet → a címsor jobb oldalán a telepítés ikon → **Telepítés**. Ezután a Start menüből indul, saját ablakban.

**Első csatlakozás:** *Csatlakozás* → a listában válaszd a `Fenycsik-XXXX` eszközt. Utána a *Beállítás* fülön add meg a szalag típusát, a LED-ek számát és az adatlábat, majd *Mentés az eszközre*. Ha piros helyett zöldet látsz, állítsd át a *Színsorrendet*.

Az ESP32-höz egyszerre három eszköz is csatlakozhat (pl. telefon és laptop): mindegyik látja, amit a másik állít.

---

## 5. Használat röviden

- **Felül mindig ott van:** az élő szalag (ugyanazzal a számítással animál, mint az ESP32, tehát azt látod, ami a szalagon van), a ki/be gomb és a fényerő.
- **Szín:** HSV vagy RGB csúszkák, hex mező, R/G/B számok, fehér árnyalatok (1900–6500 K), színek, kedvencek (*Mostani szín* gombbal, hosszú nyomással törölhető). RGBW szalagnál külön *Fehér LED* csúszka is van.
- **Effektek:** koppintásra indul, a csúszkák élőben hatnak. *Mentés módként* a beállított effektet a könyvtárba teszi.
- **Módok:** saját könyvtár, szerkesztő (*Színsor*: saját színek átúszással és kitartással; *Lejátszási lista*: effektek egymás után), feltöltés az eszközre, letöltés fájlként, megosztás, példák.
- **Elalvás időzítő** a *Beállítás* fülön (15 perc – 4 óra).
- **BOOT gomb az ESP32-n:** rövid nyomás ki/be, hosszú nyomás a következő mentett mód.

---

## 6. Mód fájlok és automatikus import

Egy mód egy `.ledmode` kiterjesztésű JSON fájl. Így kerülhet be az appba:

| Hogyan | Hol működik |
|--------|-------------|
| **Figyelt mappa:** *Módok → Mappa kiválasztása*. Ami oda kerül, néhány másodpercen belül magától bekerül. | Windows (Chrome/Edge), Android (Chrome 132+) |
| **Dupla kattintás** egy `.ledmode` fájlra (a telepített app megnyitja és importálja) | Windows |
| **Megosztás → Fénycsík** a Fájlok appból, Messengerből, Gmailből… | Android |
| **Importálás** gomb, vagy fájl behúzása az ablakba | mindenhol |
| **Vágólapról** (ha valaki szövegként küldte a JSON-t) | mindenhol |

**Windowson** érdemes a *Letöltések* mappát választani: amit a böngészőben letöltesz, az rögtön megjelenik a könyvtárban. A böngésző egyszer rákérdez a mappa olvasására; ha felajánlja, válaszd a „minden alkalommal” engedélyt, különben induláskor egy koppintással kell újra engedélyezni.

**Androidon** a rendszer nem engedi a *Download* mappa gyökerét kiválasztani, csak egy almappát (pl. `Download/Telegram` vagy egy saját `Download/Fénycsík` mappa). A böngészőből letöltött fájl viszont a gyökérbe kerül, ezért ott a legkényelmesebb a **Megosztás → Fénycsík**: a letöltés értesítésében vagy a Fájlok appban hosszan nyomd meg a fájlt, Megosztás, Fénycsík – és már bent is van.

Ha be van kapcsolva *(Beállítás → Új módok feltöltése az eszközre)*, minden importált mód rögtön az ESP32-re is felkerül.

Ugyanaz a fájl kétszer nem kerül be; ha egy azonos nevű, de módosított mód érkezik, az frissíti a régit.

### A fájl formátuma

```json
{
  "ledmode": 1,
  "name": "Naplemente",
  "effect": "keyframes",
  "speed": 128,
  "loop": true,
  "frames": [
    { "color": "#FF5A00", "fade": 4000, "hold": 3000 },
    { "color": "#7A1FA2", "fade": 4000, "hold": 3000 }
  ],
  "description": "Narancsból lilába, körbe-körbe."
}
```

| Mező | Jelentés |
|------|----------|
| `name` | a mód neve (legfeljebb 47 bájt, ékezet mehet) |
| `effect` | lásd a táblázatot lent |
| `speed` | 0–255, 0 = áll; színsornál 128 = valós idő |
| `intensity` | 0–255, effektenként mást jelent (lásd lent) |
| `reverse` | `true`: fordított irány |
| `colors` | színek: `"#RRGGBB"`, RGBW szalaghoz `"#RRGGBBWW"`, vagy `[r, g, b]` |
| `brightness` | 0–255, nem kötelező: indításkor erre áll a fényerő |
| `frames` | színsor: `color`, `fade` (átúszás ms), `hold` (kitartás ms), legfeljebb 48 |
| `loop` | színsornál és listánál: `false` esetén a végén megáll |
| `steps` | lejátszási lista lépései: egy-egy effekt saját mezőkkel + `duration` (ms), legfeljebb 16 |
| `transition` | listánál a lépések közti átúszás (ms, alap 600) |
| `description` | megjegyzés, csak az app mutatja |

Egy fájlban lehet egy mód, módok tömbje (`[ {...}, {...} ]`), vagy `{"ledmodes": [...]}`. Az *Összes exportálása* így ír ki mindent egyetlen fájlba.

| `effect` | Név az appban | `intensity` jelentése | Színek |
|----------|---------------|-----------------------|--------|
| `solid` | Egyszínű | – | 1 |
| `breathe` | Lélegzés | mélység | 1–8, lélegzetenként vált |
| `rainbow` | Szivárvány | sűrűség | – |
| `colorloop` | Színkör | – | – |
| `gradient` | Színátmenet | ismétlés | 2–8 |
| `chase` | Futófény | blokkméret | 1–8 |
| `comet` | Üstökös | csóva hossza | 1–8, körönként vált |
| `scanner` | Pásztázó | szélesség | 1–8 |
| `twinkle` | Csillogás | sűrűség | 1–8 |
| `fire` | Tűz | lánghossz | 0–8 (saját lángszínek) |
| `strobe` | Villogás (max. 10 Hz) | kitöltés | 1–8 |
| `wave` | Hullám | hullámok száma | 1–2 (2. = háttér) |
| `keyframes` | Színsor | – | `frames` mezőben |
| `playlist` | Lejátszási lista | – | `steps` mezőben |

Sima (nem címezhető) szalagon minden effekt az egész szalagra hat: a szivárványból színkör lesz, a tűzből lobogó fény.

---

## 7. Hibaelhárítás

- **Nem látszik a listában:** kap-e áramot az ESP32; nincs-e már három eszköz csatlakozva; telefonon van-e engedélye a Chrome-nak a közeli eszközökhöz.
- **Rossz színek (piros helyett zöld):** *Beállítás → Színsorrend*.
- **Villog, véletlen színek:** hiányzik a közös GND, vagy kell a 330 Ω ellenállás / szintillesztő.
- **Fehérnél újraindul vagy elsötétül:** gyenge a táp. Csökkentsd az *Áramkorlátot*, vagy használj erősebb tápot.
- **Windows firmware-frissítés után nem csatlakozik:** a Windows Bluetooth beállításaiban távolítsd el az eszközt, majd csatlakozz újra az appból.
- **Frissítetted a fájlokat a GitHubon, de az app a régit mutatja:** az app offline is működik, ezért a frissítést a második megnyitáskor tölti be.

---

## 8. Fejlesztőknek: Bluetooth protokoll

Szolgáltatás `f3c10001-6a2e-4b1d-9c58-2d7e0a4b9e17`, írás `…0002`, értesítés `…0003`. Minden csomag első bájtja a típus:

| Bájt | Tartalom |
|------|----------|
| `0x01` / `0x02` / `0x03` | JSON üzenet eleje / folytatása / vége (tetszőleges MTU-val működik) |
| `0x04` | egy csomagba férő teljes JSON |
| `0x10 r g b [w]` | szín (egyszínű módra vált, azonnal) |
| `0x11 v` | fényerő 0–255 |
| `0x12 0/1` | ki / be |
| `0x13 v`, `0x14 v` | sebesség, intenzitás élőben |
| `0x15 i r g b [w]` | az aktuális effekt i-edik színe |

JSON parancsok (`"t"` mező): `hello`, `play` (`mode` vagy `name`), `save`, `del`, `list`, `get`, `cfg`, `timer`, `power`, `reboot`. Az ESP32 válaszai: `info`, `state`, `cur`, `list`, `mode`, `ok`, `err`, `reboot`. A firmware `ble.cpp` és az app `js/protocol.js` fájlja a részleteket tartalmazza.

A firmware `-DFENYCSIK_SERIAL_TEST` kapcsolóval fordítva Bluetooth helyett a soros porton fogadja ugyanezeket a JSON parancsokat (soronként egy), ami hibakereséshez hasznos.
