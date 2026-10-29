// Arduino ESP32 + OneWire + DallasTemperature.
// Komunikační příklad; ověřte zapojení a GPIO před nahráním.
#include <WiFi.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <esp_system.h>
#include "ota.h"
#include <Preferences.h>

String WIFI_SSID, WIFI_PASSWORD, SERVER_URL, API_KEY;
bool validSample = false;
const int SENSOR_PIN = 4;
OneWire oneWire(SENSOR_PIN);
DallasTemperature thermometer(&oneWire);
String bootId;
String pending;
uint32_t sequence = 0;
unsigned long lastSample = 0;
unsigned long lastAttempt = 0;
bool firstSample = true;

void setup() {
  Serial.begin(115200);
  Preferences preferences;
  preferences.begin("cov", true);
  WIFI_SSID = preferences.getString("ssid", "");
  WIFI_PASSWORD = preferences.getString("password", "");
  SERVER_URL = preferences.getString("server", "");
  API_KEY = preferences.getString("key", "");
  preferences.end();
  if (WIFI_SSID.isEmpty() || SERVER_URL.isEmpty() || API_KEY.isEmpty()) {
    Serial.println("Missing NVS configuration: run esp32_provision first.");
    while (true) { checkFirmwareTrial(); delay(100); }
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID.c_str(), WIFI_PASSWORD.c_str());
  WiFi.setAutoReconnect(true);
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  thermometer.begin();
  char id[26];
  snprintf(id, sizeof(id), "%08lx-%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  bootId = String(id);
}

void loop() {
  checkFirmwareTrial();
  unsigned long now = millis();
  // Jedna čekající zpráva v RAM; opakované pokusy mají stejné sample_id a obsah.
  if (pending.isEmpty() && WiFi.status() == WL_CONNECTED && (firstSample || now-lastSample >= 60000)) {
    firstSample = false;
    thermometer.requestTemperatures();
    float temperature = thermometer.getTempCByIndex(0);
    validSample = temperature != DEVICE_DISCONNECTED_C && isfinite(temperature);
    String measured = (temperature == DEVICE_DISCONNECTED_C || !isfinite(temperature)) ? "null" : String(temperature, 2);
    pending = "{\"device_id\":\"cov-monitor-01\",\"sample_id\":\"" + bootId + "-" + String(sequence++) + "\",\"measurements\":{\"temperature\":" + measured + "},\"rssi\":" + String(WiFi.RSSI()) + "}";
    pending.remove(pending.length() - 1);
    pending += String(",\"firmware_version\":\"") + FIRMWARE_VERSION + "\",\"hardware\":\"" + HARDWARE_TARGET + "\"}";
    // Bez timestamp použije server čas přijetí. Pro offline historii přidejte NTP/RTC a frontu.
    lastSample = now;
  }
  if (!pending.isEmpty() && WiFi.status() == WL_CONNECTED && now-lastAttempt >= 5000) {
    lastAttempt = now;
    WiFiClient client;
    HTTPClient http;
    if (http.begin(client, SERVER_URL)) {
      http.setConnectTimeout(3000);
      http.setTimeout(5000);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-API-Key", API_KEY);
      int code = http.POST(pending);
      Serial.printf("HTTP %d\n", code);
      if (code == 200 || code == 201) { pending = ""; if (validSample) confirmFirmware(); }
      else if (code >= 400 && code < 500 && code != 429) {
        Serial.println(http.getString()); // Chybný vzorek neopakujeme donekonečna.
        pending = "";
      }
      http.end();
    }
  }
  if (pending.isEmpty()) pollFirmware(API_KEY.c_str());
  delay(20);
}
