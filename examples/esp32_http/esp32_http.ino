// ESP32 gateway for Nano R3 + JSN-SR04T V3 + DS18B20.
// Komunikační příklad; ověřte zapojení a GPIO před nahráním.
#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_system.h>
#include <time.h>
#include "ota.h"
#include <Preferences.h>

String WIFI_SSID, WIFI_PASSWORD, SERVER_URL, API_KEY, DEVICE_ID;
#include "provisioning.h"
bool validSample = false;
#include "nano_link.h"
#include "status_leds.h"
String bootId;
String pending;
uint32_t sequence = 0;
unsigned long lastSample = 0;
unsigned long lastAttempt = 0;
unsigned long pendingCreatedAt = 0;
bool firstSample = true;
unsigned long lastWifiAttempt = 0;
bool wifiWasConnected = false;

void maintainCovWifi() {
  if (setupActive || WIFI_SSID.isEmpty()) return;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wifiWasConnected) {
    wifiWasConnected = connected;
    // Recreate mDNS on the new network interface, including after DHCP recovery.
    if (mdnsReady) MDNS.end();
    mdnsReady = false;
    if (connected) {
      Serial.println("[WiFi] Connected; resuming telemetry");
      pending = "";
      firstSample = true;
    } else {
      covNetworkFailed = true;
      Serial.println("[WiFi] Disconnected; waiting to reconnect");
      lastWifiAttempt = millis();
    }
  }
  unsigned long now = millis();
  if (!connected && now - lastWifiAttempt >= 30000UL) {
    lastWifiAttempt = now;
    Serial.println("[WiFi] Retrying saved network");
    // Keep saved credentials and allow a slow router 30 seconds per attempt.
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID.c_str(), WIFI_PASSWORD.c_str());
  }
}

void setup() {
  Serial.begin(115200);
  Preferences preferences;
  preferences.begin("cov", true);
  WIFI_SSID = preferences.getString("ssid", "");
  WIFI_PASSWORD = preferences.getString("password", "");
  SERVER_URL = preferences.getString("server", "");
  API_KEY = preferences.getString("key", "");
  DEVICE_ID = preferences.getString("device_id", "cov-monitor-01");
  String savedConfig = preferences.getString("config", "");
  if (!savedConfig.isEmpty()) {
    JsonDocument config;
    if (!deserializeJson(config, savedConfig)) {
      WIFI_SSID = config["ssid"] | ""; WIFI_PASSWORD = config["password"] | "";
      SERVER_URL = config["server"] | ""; API_KEY = config["key"] | "";
      DEVICE_ID = config["device_id"] | "cov-monitor-01";
    }
  }
  preferences.end();
  pinMode(COV_SETUP_PIN, INPUT_PULLUP);
  WiFi.persistent(false);
  if (WIFI_SSID.isEmpty() || SERVER_URL.isEmpty() || API_KEY.isEmpty()) {
    startCovSetup();
  }
  if (!setupActive) WiFi.mode(WIFI_STA);
  if (!WIFI_SSID.isEmpty()) WiFi.begin(WIFI_SSID.c_str(), WIFI_PASSWORD.c_str());
  WiFi.setAutoReconnect(true);
  lastWifiAttempt = millis();
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
  nanoLink.setRxBufferSize(2048);
  nanoLink.begin(9600, SERIAL_8N1, 16, -1);
  beginCovService();
  char id[26];
  snprintf(id, sizeof(id), "%08lx-%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
  bootId = String(id);
}

void loop() {
  checkFirmwareTrial();
  maintainCovWifi();
  handleCovSetup();
  if (setupActive || API_KEY.isEmpty()) { delay(10); return; }
  rotateCovKey();
  unsigned long now = millis();
  // Do not submit an old measurement as fresh after a long network outage.
  if (!pending.isEmpty() && now - pendingCreatedAt >= 60000) {
    pending = "";
    firstSample = true;
  }
  // Jedna čekající zpráva v RAM; opakované pokusy mají stejné sample_id a obsah.
  // On boot allow Nano to finish its first sensor conversion before reporting missing data.
  NanoSnapshot nano = currentNano();
  bool startupReady = nano.seen || now >= 10000;
  if (pending.isEmpty() && WiFi.status() == WL_CONNECTED && startupReady && (firstSample || now-lastSample >= 60000)) {
    firstSample = false;
    bool fresh = nano.seen && millis() - nano.receivedAt <= 10000;
    validSample = fresh && (nano.temperature != -32768 || nano.distance != -1);
    String measured = fresh && nano.temperature != -32768 ? String(nano.temperature / 100.0f, 2) : "null";
    String distance = fresh && nano.distance != -1 ? String(nano.distance / 10.0f, 1) : "null";
    Serial.printf("[Telemetry] device=%s temperature_C=%s distance_cm=%s\n", DEVICE_ID.c_str(), measured.c_str(), distance.c_str());
    pending = "{\"device_id\":\"" + DEVICE_ID + "\",\"sample_id\":\"" + bootId + "-" + String(sequence++) + "\",\"measurements\":{\"temperature\":" + measured + ",\"distance_cm\":" + distance + "},\"rssi\":" + String(WiFi.RSSI()) + "}";
    pending.remove(pending.length() - 1);
    time_t sampledAt = time(nullptr);
    if (sampledAt >= 1704067200) {
      struct tm utc;
      gmtime_r(&sampledAt, &utc);
      char timestamp[25];
      strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
      pending += String(",\"timestamp\":\"") + timestamp + "\"";
    }
    pending += String(",\"firmware_version\":\"") + FIRMWARE_VERSION + "\",\"hardware\":\"" + HARDWARE_TARGET + "\",\"ota_rollback\":true}";
    // Until NTP sync, the server uses arrival time. No persistent offline archive.
    pendingCreatedAt = now;
    lastSample = now;
  }
  if (!pending.isEmpty() && WiFi.status() == WL_CONNECTED && now-lastAttempt >= 5000) {
    lastAttempt = now;
    WiFiClient client;
    HTTPClient http;
    if (http.begin(client, resolveCovUrl(SERVER_URL))) {
      http.setConnectTimeout(3000);
      http.setTimeout(5000);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-API-Key", API_KEY);
      int code = http.POST(pending);
      Serial.printf("HTTP %d\n", code);
      covNetworkFailed = code != 200 && code != 201;
      if (code == 200 || code == 201) { covServerReached = true; pending = ""; if (validSample) confirmFirmware(); }
      else if (code >= 400 && code < 500 && code != 429) {
        Serial.println(http.getString()); // Chybný vzorek neopakujeme donekonečna.
        pending = "";
      }
      http.end();
    } else covNetworkFailed = true;
  }
  if (pending.isEmpty()) pollFirmware(API_KEY.c_str(), DEVICE_ID.c_str());
  delay(20);
}
