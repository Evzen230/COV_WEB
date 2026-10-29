#pragma once
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Update.h>
#include <mbedtls/sha256.h>
#include <esp_ota_ops.h>
#include <Preferences.h>

// Change for each release. Use the same target in the signed release manifest.
#define FIRMWARE_VERSION "0.3.0"
#define HARDWARE_TARGET "esp32-ds18b20-v1"
// Defer Arduino's startup confirmation until sensor and server checks pass.
extern "C" bool verifyRollbackLater(void) { return true; }
// HTTPS reverse proxy on the Raspberry Pi; include the issuing CA below.
// OTA stays disabled until both values are configured. Never use setInsecure().
const char* OTA_BASE_URL = ""; // e.g. https://cov.example.cz
const char* OTA_CA_CERT = ""; // PEM CA certificate; configure NTP in setup for TLS validation.
unsigned long lastOtaCheck = 0;
bool firmwareConfirmed = false;

void checkFirmwareTrial() {
  esp_ota_img_states_t state;
  if (!firmwareConfirmed && millis() > 180000 && esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY)
    esp_ota_mark_app_invalid_rollback_and_reboot();
}

void confirmFirmware() {
  firmwareConfirmed = true;
  esp_ota_img_states_t state;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY)
    esp_ota_mark_app_valid_cancel_rollback();
}

void pollFirmware(const char* apiKey) {
  if (!String(OTA_BASE_URL).startsWith("https://") || !strlen(OTA_CA_CERT) || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastOtaCheck < 60000) return;
  lastOtaCheck = millis();
  WiFiClientSecure client;
  client.setCACert(OTA_CA_CERT);
  HTTPClient http;
  http.setConnectTimeout(5000); http.setTimeout(10000);
  if (!http.begin(client, String(OTA_BASE_URL) + "/api/v1/device/update")) return;
  http.addHeader("X-API-Key", apiKey);
  if (http.GET() != 200 || http.getSize() > 4096) { http.end(); return; }
  JsonDocument doc;
  auto error = deserializeJson(doc, http.getString());
  http.end();
  if (error || doc["firmware"].isNull()) return;
  String version = doc["firmware"]["version"] | "";
  String target = doc["firmware"]["target"] | "";
  String expected = doc["firmware"]["sha256"] | "";
  String offerId = doc["firmware"]["id"] | "";
  if (target != HARDWARE_TARGET || version == FIRMWARE_VERSION || expected.length() != 64 || offerId.isEmpty()) return;
  Preferences attempts;
  if (!attempts.begin("cov-ota", false)) return;
  String tried = attempts.getString("tried", "");
  attempts.end();
  if (tried == offerId) return; // A rolled-back image needs an explicit new offer.
  // Refuse old offers after a newer firmware has been installed.
  int a,b,c,x,y,z;
  if (sscanf(version.c_str(), "%d.%d.%d", &a,&b,&c) != 3 || sscanf(FIRMWARE_VERSION, "%d.%d.%d", &x,&y,&z) != 3) return;
  if (a < x || (a == x && b < y) || (a == x && b == y && c <= z)) return;
  if (!http.begin(client, String(OTA_BASE_URL) + "/api/v1/device/firmware")) return;
  http.addHeader("X-API-Key", apiKey);
  if (http.GET() != 200) { http.end(); return; }
  int size = http.getSize();
  if (size <= 0 || size > 4 * 1024 * 1024 || !Update.begin(size)) { http.end(); return; }
  mbedtls_sha256_context hash;
  mbedtls_sha256_init(&hash); mbedtls_sha256_starts(&hash, 0);
  uint8_t buffer[1024], digest[32];
  int received = 0;
  unsigned long lastData = millis();
  auto stream = http.getStreamPtr();
  while (received < size && millis() - lastData < 15000) {
    int available = stream->available();
    if (available > 0) {
      int count = stream->readBytes(buffer, min((int)sizeof(buffer), min(available, size - received)));
      if (count <= 0 || Update.write(buffer, count) != (size_t)count) break;
      mbedtls_sha256_update(&hash, buffer, count);
      received += count; lastData = millis();
    } else delay(10);
  }
  mbedtls_sha256_finish(&hash, digest); mbedtls_sha256_free(&hash);
  char actual[65];
  for (int i = 0; i < 32; i++) snprintf(actual + i*2, 3, "%02x", digest[i]);
  if (received == size && expected == actual) {
    if (attempts.begin("cov-ota", false)) {
      bool saved = attempts.putString("tried", offerId) > 0;
      attempts.end();
      if (saved && Update.end()) { http.end(); ESP.restart(); }
    }
  }
  Update.abort(); http.end();
}
