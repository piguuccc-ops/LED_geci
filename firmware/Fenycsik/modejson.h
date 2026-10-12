// .ledmode JSON <-> Mode
#pragma once
#include <ArduinoJson.h>
#include "effects.h"

// err: rövid hibakód (az app fordítja magyarra)
bool modeFromJson(JsonObjectConst o, Mode& m, const char*& err);
void modeToJson(const Mode& m, JsonObject o);
bool parseColor(JsonVariantConst v, Px& out);

// UTF-8 biztos másolás (nem vág ketté ékezetes betűt)
void utf8Copy(char* dst, const char* src, size_t size);
