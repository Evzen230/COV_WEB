#pragma once
#include <errno.h>
#include <stdlib.h>

HardwareSerial nanoLink(2);
char nanoFrame[84];
size_t nanoLength = 0;
bool nanoReceiving = false, nanoSeen = false;
unsigned long nanoReceivedAt = 0;
long nanoTemperature = -32768, nanoDistance = -1;
uint32_t nanoBytes = 0, nanoValidFrames = 0, nanoRejectedFrames = 0;

uint16_t nanoCrc16(const char* data) {
  uint16_t crc = 0xFFFF;
  while (*data) {
    crc ^= (uint16_t)(uint8_t)*data++ << 8;
    for (uint8_t i = 0; i < 8; i++)
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return crc;
}

bool nanoNumber(char* value, long minimum, long maximum, long& result) {
  if (!value || !*value) return false;
  char* end;
  errno = 0;
  result = strtol(value, &end, 10);
  return !errno && !*end && result >= minimum && result <= maximum;
}

bool decodeNanoFrame() {
  char* star = strchr(nanoFrame, '*');
  if (!star || strlen(star + 1) != 4) return false;
  for (char* p = star + 1; *p; p++) if (!isxdigit((unsigned char)*p)) return false;
  uint16_t expected = strtoul(star + 1, nullptr, 16);
  *star = 0;
  if (nanoCrc16(nanoFrame) != expected) return false;
  char* state;
  char* version = strtok_r(nanoFrame, ",", &state);
  char* seq = strtok_r(nullptr, ",", &state);
  char* temp = strtok_r(nullptr, ",", &state);
  char* distance = strtok_r(nullptr, ",", &state);
  if (!version || strcmp(version, "COV1") || !seq || !*seq ||
      strtok_r(nullptr, ",", &state)) return false;
  for (char* p = seq; *p; p++) if (*p < '0' || *p > '9') return false;
  char* end;
  errno = 0;
  strtoul(seq, &end, 10);
  if (errno || *end) return false;
  long t, d;
  if (!nanoNumber(temp, -32768, 12500, t) ||
      (t != -32768 && t < -5500) ||
      !nanoNumber(distance, -1, 6000, d) || (d != -1 && d < 210)) return false;
  nanoTemperature = t;
  nanoDistance = d;
  nanoReceivedAt = millis();
  nanoSeen = true;
  return true;
}

void readNano() {
  while (nanoLink.available()) {
    char c = nanoLink.read();
    nanoBytes++;
    if (c == '$') { nanoReceiving = true; nanoLength = 0; continue; }
    if (!nanoReceiving) continue;
    if (c == '\n') {
      nanoFrame[nanoLength] = 0;
      if (decodeNanoFrame()) nanoValidFrames++;
      else nanoRejectedFrames++;
      nanoReceiving = false;
    } else if (nanoLength < sizeof(nanoFrame) - 1 && c >= 32 && c <= 126) {
      nanoFrame[nanoLength++] = c;
    } else { nanoRejectedFrames++; nanoReceiving = false; nanoLength = 0; }
  }
}

void reportNano() {
  static unsigned long lastReport = 0;
  if (millis() - lastReport < 5000) return;
  lastReport = millis();
  bool fresh = nanoSeen && millis() - nanoReceivedAt <= 10000;
  const char* state = !nanoSeen ? (nanoBytes ? "INVALID_DATA" : "NO_DATA") : (fresh ? "OK" : "STALE");
  String temperature = fresh && nanoTemperature != -32768 ? String(nanoTemperature / 100.0f, 2) : "null";
  String distance = fresh && nanoDistance != -1 ? String(nanoDistance / 10.0f, 1) : "null";
  Serial.printf("[Nano] state=%s bytes=%lu valid=%lu rejected=%lu temperature_C=%s distance_cm=%s\n",
    state, (unsigned long)nanoBytes, (unsigned long)nanoValidFrames, (unsigned long)nanoRejectedFrames,
    temperature.c_str(), distance.c_str());
}
