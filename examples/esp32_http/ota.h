#pragma once
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Update.h>
#include <mbedtls/sha256.h>
#include <esp_ota_ops.h>
#include <Preferences.h>

// Change for each release. Use the same target in the signed release manifest.
#define FIRMWARE_VERSION "0.3.2"
#define HARDWARE_TARGET "esp32-nano-v1"
// Defer Arduino's startup confirmation until sensor and server checks pass.
extern "C" bool verifyRollbackLater(void) { return true; }
// HTTPS reverse proxy on this Raspberry Pi. Replace URL and CA for another site.
// Always verify the certificate; never use setInsecure().
const char* OTA_BASE_URL = "https://covmalina.local";
// Public root CA from this Raspberry Pi. NTP must be synchronized for TLS.
const char* OTA_CA_CERT = R"COV_CA(-----BEGIN CERTIFICATE-----
MIIBojCCAUmgAwIBAgIQYcrPkR4Ntx1m3J2grh/2YDAKBggqhkjOPQQDAjAwMS4w
LAYDVQQDEyVDYWRkeSBMb2NhbCBBdXRob3JpdHkgLSAyMDI2IEVDQyBSb290MB4X
DTI2MTEwNjA5NDcwMloXDTM2MDkxNDA5NDcwMlowMDEuMCwGA1UEAxMlQ2FkZHkg
TG9jYWwgQXV0aG9yaXR5IC0gMjAyNiBFQ0MgUm9vdDBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABA1yprP/6KvgGGzi9DlveL5/9dMlKcDGOS3TXaXWH3JBCPJIoS4P
3DueSig9GODuQ8Ml/jssPZJJ1SBkioAY9xOjRTBDMA4GA1UdDwEB/wQEAwIBBjAS
BgNVHRMBAf8ECDAGAQH/AgEBMB0GA1UdDgQWBBT3c8XD1KZPkaNcBXdSX+1BWsv+
2DAKBggqhkjOPQQDAgNHADBEAiBNp19Xycu4FtXAebt+KJzGB7JXDYjt+wwBr1mJ
70pXmgIgaOK6tddsa/K+3exAsCbqXBOyvLewoIdgt0wICAARqgE=
-----END CERTIFICATE-----
)COV_CA";
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

void pollFirmware(const char* apiKey, const char* deviceId) {
  if (!String(OTA_BASE_URL).startsWith("https://") || !strlen(OTA_CA_CERT) || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastOtaCheck < 60000) return;
  lastOtaCheck = millis();
  WiFiClientSecure client;
  client.setCACert(OTA_CA_CERT);
  HTTPClient http;
  http.setConnectTimeout(5000); http.setTimeout(10000);
  if (!http.begin(client, String(OTA_BASE_URL) + "/api/v1/device/update?device_id=" + String(deviceId))) return;
  http.addHeader("X-API-Key", apiKey);
  int offerStatus = http.GET();
  Serial.printf("[OTA] Kontrola pres HTTPS: HTTP %d\n", offerStatus);
  if (offerStatus != 200 || http.getSize() > 4096) { http.end(); return; }
  JsonDocument doc;
  auto error = deserializeJson(doc, http.getString());
  http.end();
  if (error) { Serial.println("[OTA] Neplatna odpoved serveru"); return; }
  if (doc["firmware"].isNull()) { Serial.println("[OTA] HTTPS overeno; zadna nabidka firmware"); return; }
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
  bool older = a < x || (a == x && b < y) || (a == x && b == y && c < z);
  bool rollback = doc["firmware"]["rollback"] == true;
  if (older && !rollback) return; // Only an explicit authenticated server offer permits a downgrade.
  if (!http.begin(client, String(OTA_BASE_URL) + "/api/v1/device/firmware?device_id=" + String(deviceId))) return;
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
