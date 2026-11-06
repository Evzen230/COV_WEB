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
void line(int y, String value, uint16_t color=ILI9341_WHITE, int size=2) {
  tft.setTextColor(color); tft.setTextSize(size); tft.setCursor(8,y);
  value=asciiText(value); size_t limit=304/(6*size);
  if(value.length()>limit) value=value.substring(0,limit-1)+"~";
  tft.print(value);
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
void paintOverview() {
  tft.fillScreen(ILI9341_BLACK);
  if(setupActive) {
    line(8,"Nastaveni displeje",ILI9341_CYAN);
    line(40,WiFi.softAPSSID(),ILI9341_WHITE,1);
    line(62,"Heslo: "+apPassword,ILI9341_WHITE,1);
    line(90,"V mobilu otevrete:",ILI9341_WHITE,1);
    line(112,"http://192.168.4.1",ILI9341_CYAN,1);
    line(150,"Wi-Fi + server + klic",ILI9341_WHITE,1);
    return;
  }
  line(6,haveData ? snapshot["name"].as<String>() : "COV Monitor",ILI9341_CYAN);
  if(!haveData) { line(55,"Cekam na data"); line(92,linked?"Nacitam prehled":"Bez spojeni",ILI9341_YELLOW); line(170,"Nastaveni: drzte tlacitko 5 s",ILI9341_WHITE,1); return; }
  bool stale = sensorAge(snapshot["temperature"])>snapshot["stale_after_ms"].as<double>() || sensorAge(snapshot["level"])>snapshot["stale_after_ms"].as<double>();
  bool online = snapshot["online"] | false;
  line(32,!linked?"ZTRATA SPOJENI":stale?"NEAKTUALNI DATA":!online?"STANICE NEDOSTUPNA":"Spojeni v poradku",(!linked||stale||!online)?ILI9341_YELLOW:ILI9341_GREEN,1);
  JsonVariantConst level=snapshot["level"], temp=snapshot["temperature"];
  line(58,"Hladina: "+(level["value"].isNull()?String("--"):String(level["value"].as<float>(),1))+" %");
  line(88,"Teplota: "+(temp["value"].isNull()?String("--"):String(temp["value"].as<float>(),1))+" C");
  line(119,"Hladina: "+ageText(sensorAge(level)),ILI9341_LIGHTGREY,1);
  line(135,"Teplota: "+ageText(sensorAge(temp)),ILI9341_LIGHTGREY,1);
  JsonArrayConst alarms=snapshot["alarms"].as<JsonArrayConst>();
  if(alarms.size()) {
    size_t index=(millis()/5000)%alarms.size();
    line(164,"ALARM "+String(index+1)+"/"+String(alarms.size()),ILI9341_ORANGE,1);
    String title=asciiText(alarms[index]["title"].as<String>());
    line(182,title.substring(0,50),ILI9341_ORANGE,1);
    line(198,title.substring(50,100),ILI9341_ORANGE,1);
  } else line(178,"Zadne aktivni alarmy",ILI9341_GREEN,1);
  line(223,"Obnova 15 s | nastaveni: tlacitko 5 s",ILI9341_LIGHTGREY,1);
}

#include "display_setup.h"

void fetchOverview() {
  if(WiFi.status()!=WL_CONNECTED) {linked=false;return;}
  WiFiClient client; HTTPClient http;
  http.setConnectTimeout(1500); http.setTimeout(2000);
  if(!http.begin(client,resolveDisplayUrl(serverUrl)+"/api/v1/display")) {linked=false;return;}
  http.addHeader("X-API-Key",displayKey);
  int code=http.GET(); linked=false;
  if(code==200 && (http.getSize()<0 || http.getSize()<=16384)) {
    // Bound read size even when a server uses chunked transfer.
    DisplayBuffer buffer;
    int copied=http.writeToStream(&buffer);
    JsonDocument next;
    if(copied>=0 && !deserializeJson(next,buffer.data) && next["version"]==1 &&
       next["server_time"].is<double>() && next["stale_after_ms"].is<double>() &&
       next["temperature"].is<JsonObject>() && next["level"].is<JsonObject>() && next["alarms"].is<JsonArray>()) {
      snapshot=next; receivedAt=millis(); haveData=true; linked=true;
    }
  }
  http.end();
}
void setup() {
  Serial.begin(115200); pinMode(SETUP_PIN,INPUT_PULLUP);
  // Future touch controller must stay deselected on the shared bus.
  pinMode(32,OUTPUT); digitalWrite(32,HIGH);
  SPI.begin(18,19,23,TFT_CS); tft.begin(); tft.setRotation(1); tft.setTextWrap(false);
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
    if(now-setupStarted>=900000UL && !ssid.isEmpty() && !serverUrl.isEmpty() && !displayKey.isEmpty()) {
      web.stop();dns.stop();WiFi.softAPdisconnect(true);WiFi.mode(WIFI_STA);setupActive=false;
      WiFi.begin(ssid.c_str(),password.c_str()); lastFetch=now-15000UL;
    }
  } else {
    if(WiFi.status()!=WL_CONNECTED) {
      linked=false;
      if(now-lastWifiAttempt>=30000UL){lastWifiAttempt=now;WiFi.disconnect(false,false);WiFi.begin(ssid.c_str(),password.c_str());}
    }
    if(now-lastFetch>=15000UL) {lastFetch=now;fetchOverview();}
  }
  if(now-lastPaint>=1000UL){lastPaint=now;paintOverview();}
  delay(10);
}
