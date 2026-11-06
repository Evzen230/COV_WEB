// ESP32 DevKit V1 + ILI9341 SPI, landscape 320x240. Read-only monitor.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <SPI.h>

// Shared SPI reserved for future touch: T_CLK18, T_DIN23, T_DO19,
// T_CS32, T_IRQ33. Touch is intentionally not initialized in v1.
constexpr int TFT_CS = 5, TFT_DC = 21, TFT_RST = 22, SETUP_PIN = 27;
Adafruit_ILI9341 tft(TFT_CS, TFT_DC, TFT_RST);
WebServer web(80);
DNSServer dns;
String ssid, password, serverUrl, displayKey, apPassword, setupToken;
bool setupActive = false, mdnsReady = false, haveData = false, linked = false;
unsigned long setupStarted = 0, buttonSince = 0, lastFetch = 0, lastPaint = 0, receivedAt = 0, lastWifiAttempt = 0;
JsonDocument snapshot;
// HTTPClient decodes chunked transfer into this bounded buffer.
class DisplayBuffer : public Stream {
public:
  String data;
  size_t write(uint8_t value) override { if(data.length()>=16384)return 0; data+=(char)value;return 1; }
  size_t write(const uint8_t* bytes,size_t length) override {
    size_t accepted=min(length,(size_t)(16384-data.length()));
    if(accepted)data.concat((const char*)bytes,accepted);
    return accepted;
  }
  int available() override {return 0;}
  int read() override {return -1;}
  int peek() override {return -1;}
  void flush() override {}
};

String randomToken(size_t count) {
  const char* hex = "0123456789abcdef"; String out;
  for (size_t i=0; i<count; i++) { uint8_t b=esp_random(); out+=hex[b>>4]; out+=hex[b&15]; }
  return out;
}
String asciiText(String value) {
  const char* from[] = {"á","č","ď","é","ě","í","ň","ó","ř","š","ť","ú","ů","ý","ž","Á","Č","Ď","É","Ě","Í","Ň","Ó","Ř","Š","Ť","Ú","Ů","Ý","Ž","°","–","—","µ"};
  const char* to[] = {"a","c","d","e","e","i","n","o","r","s","t","u","u","y","z","A","C","D","E","E","I","N","O","R","S","T","U","U","Y","Z","deg","-","-","u"};
  for (size_t i=0;i<sizeof(from)/sizeof(from[0]);i++) value.replace(from[i],to[i]);
  return value;
}
String ageText(double milliseconds) {
  if(milliseconds<0) return "nezname";
  unsigned long seconds=(unsigned long)(milliseconds/1000);
  if(seconds<60) return String(seconds)+" s";
  if(seconds<3600) return String(seconds/60)+" min";
  return String(seconds/3600)+" h";
}
double sensorAge(JsonVariantConst sensor) {
  if(sensor["measured_at"].isNull()) return -1;
  return max(0.0, snapshot["server_time"].as<double>()-sensor["measured_at"].as<double>()) + (unsigned long)(millis()-receivedAt);
}
#include "display_ui.h"
#include "display_setup.h"

bool readDisplayOverview(const String& url, const String& key, JsonDocument& next) {
  if(WiFi.status()!=WL_CONNECTED) return false;
  WiFiClient client; HTTPClient http;
  http.setConnectTimeout(1500); http.setTimeout(2000);
  if(!http.begin(client,resolveDisplayUrl(url)+"/api/v1/display")) return false;
  http.addHeader("X-API-Key",key);
  int code=http.GET(); bool valid=false;
  if(code==200 && (http.getSize()<0 || http.getSize()<=16384)) {
    // Bound read size even when a server uses chunked transfer.
    DisplayBuffer buffer;
    int copied=http.writeToStream(&buffer);
    if(copied>=0 && !deserializeJson(next,buffer.data) && next["version"]==1 &&
       next["server_time"].is<double>() && next["stale_after_ms"].is<double>() &&
       next["temperature"].is<JsonObject>() && next["level"].is<JsonObject>() && next["alarms"].is<JsonArray>()) {
      valid=true;
    }
  }
  http.end();
  return valid;
}
void fetchOverview() {
  JsonDocument next;
  linked=readDisplayOverview(serverUrl,displayKey,next);
  if(linked){snapshot=next;receivedAt=millis();haveData=true;}
}
void setup() {
  Serial.begin(115200); pinMode(SETUP_PIN,INPUT_PULLUP);
  // Future touch controller must stay deselected on the shared bus.
  pinMode(32,OUTPUT); digitalWrite(32,HIGH);
  SPI.begin(18,19,23,TFT_CS); tft.begin(); tft.setRotation(1); tft.setTextWrap(false);
  if(!displayCanvas.getBuffer()){tft.fillScreen(ILI9341_BLACK);tft.setCursor(8,8);tft.setTextColor(ILI9341_WHITE);tft.print("Nedostatek pameti pro UI");while(true)delay(1000);}
  loadDisplayConfig();
  WiFi.persistent(false); WiFi.setAutoReconnect(true);
  if(ssid.isEmpty()||serverUrl.isEmpty()||displayKey.isEmpty()) startDisplaySetup();
  else { WiFi.mode(WIFI_STA); WiFi.begin(ssid.c_str(),password.c_str()); }
  paintOverview(); lastFetch=millis()-15000UL;
}
void loop() {
  unsigned long now=millis();
  if(digitalRead(SETUP_PIN)==LOW) { if(!buttonSince)buttonSince=now; if(now-buttonSince>=5000)startDisplaySetup(); } else buttonSince=0;
  if(setupActive) {
    dns.processNextRequest(); web.handleClient();
    if(millis()-setupStarted>=900000UL && !ssid.isEmpty() && !serverUrl.isEmpty() && !displayKey.isEmpty()) {
      web.stop();dns.stop();WiFi.softAPdisconnect(true);WiFi.mode(WIFI_STA);setupActive=false;
      if(mdnsReady){MDNS.end();mdnsReady=false;}
      candidatePassword="";
      WiFi.begin(ssid.c_str(),password.c_str()); lastFetch=millis()-15000UL;
    }
  } else {
    if(WiFi.status()!=WL_CONNECTED) {
      linked=false;
      if(mdnsReady){MDNS.end();mdnsReady=false;}
      if(now-lastWifiAttempt>=30000UL){lastWifiAttempt=now;WiFi.disconnect(false,false);WiFi.begin(ssid.c_str(),password.c_str());}
    }
    if(now-lastFetch>=15000UL) {lastFetch=now;fetchOverview();}
  }
  if(now-lastPaint>=1000UL){lastPaint=now;paintOverview();}
  delay(10);
}
