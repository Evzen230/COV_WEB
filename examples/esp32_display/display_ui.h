#pragma once
// Compose a changed region in RAM, then send its finished pixels. Never clear
// the visible panel between frames. 64 kB instead of a full 154 kB framebuffer.
GFXcanvas16 displayCanvas(320, 100);
const uint16_t UI_BG = 0x08C4, UI_PANEL = 0x1126, UI_TEXT = 0xEF7D;
const uint16_t UI_MUTED = 0x8C93, UI_TEAL = 0x4E16, UI_WARN = 0xF5C9;
String displayRegions[6];

void uiText(int x, int y, String text, int size = 1, uint16_t color = UI_TEXT, int characters = 50) {
  text = asciiText(text);
  if (text.length() > (size_t)characters) text = text.substring(0, characters - 1) + "~";
  displayCanvas.setCursor(x, y);
  displayCanvas.setTextSize(size);
  displayCanvas.setTextColor(color);
  displayCanvas.setTextWrap(false);
  displayCanvas.print(text);
}
bool uiChanged(int region, const String& value) {
  if (displayRegions[region] == value) return false;
  displayRegions[region] = value;
  displayCanvas.fillScreen(UI_BG);
  return true;
}
void uiCommit(int y, int height) {
  tft.drawRGBBitmap(0, y, displayCanvas.getBuffer(), 320, height);
}
void uiValue(int x, String label, String value, String unit, bool missing, bool stale) {
  displayCanvas.fillRoundRect(x, 3, 148, 94, 8, UI_PANEL);
  uiText(x + 12, 14, label, 1, UI_MUTED, 20);
  uiText(x + 12, 35, value, 3, missing || stale ? UI_WARN : UI_TEXT, 7);
  uiText(x + 119, 46, unit, 1, UI_MUTED, 3);
  uiText(x + 12, 76, missing ? "Bez mereni" : stale ? "Stara hodnota" : "Posledni mereni", 1, missing || stale ? UI_WARN : UI_MUTED, 20);
}
void paintOverview() {
  if (!displayCanvas.getBuffer()) return;
  const String mode = setupActive ? "setup:" : "view:";
  String title = setupActive ? "Nastaveni displeje" : haveData ? snapshot["name"].as<String>() : "COV Monitor";
  if (uiChanged(0, mode + title)) {
    uiText(10, 8, title, 2, UI_TEXT, 25);
    displayCanvas.drawFastHLine(8, 31, 304, UI_PANEL);
    uiCommit(0, 32);
  }
  if (setupActive) {
    if (uiChanged(1, mode)) {
      displayCanvas.fillCircle(13, 12, 4, UI_TEAL);
      uiText(25, 8, "1. Pripojte mobil k teto Wi-Fi", 1, UI_TEAL);
      uiCommit(32, 24);
    }
    if (uiChanged(2, mode + WiFi.softAPSSID() + apPassword)) {
      displayCanvas.fillRoundRect(8, 3, 304, 94, 8, UI_PANEL);
      uiText(20, 13, "NAZEV SITE", 1, UI_MUTED);
      uiText(20, 30, WiFi.softAPSSID(), 2, UI_TEXT, 23);
      uiText(20, 57, "HESLO", 1, UI_MUTED);
      uiText(20, 73, apPassword, 2, UI_TEAL, 23);
      uiCommit(56, 100);
    }
    if (uiChanged(3, mode)) {
      uiText(10, 8, "2. Otevrete v prohlizeci mobilu:", 1, UI_MUTED);
      uiCommit(156, 24);
    }
    if (uiChanged(4, mode)) {
      uiText(10, 2, "http://192.168.4.1", 2, UI_TEAL, 25);
      uiText(10, 28, "Wi-Fi i server se vyhledaji automaticky", 1, UI_MUTED);
      uiCommit(180, 44);
    }
  } else {
    JsonVariantConst level = snapshot["level"], temp = snapshot["temperature"];
    double limit = snapshot["stale_after_ms"] | 900000.0;
    bool levelMissing = !haveData || level["value"].isNull();
    bool tempMissing = !haveData || temp["value"].isNull();
    bool levelStale = haveData && sensorAge(level) > limit;
    bool tempStale = haveData && sensorAge(temp) > limit;
    bool online = snapshot["online"] | false;
    JsonArrayConst alarms = snapshot["alarms"].as<JsonArrayConst>();
    String state = !linked ? "Bez spojeni se serverem" : !haveData ? "Cekam na prvni data" : !online ? "Stanice je nedostupna" : levelStale || tempStale ? "Neaktualni mereni" : alarms.size() ? "Provoz vyzaduje pozornost" : "Provoz v poradku";
    uint16_t stateColor = linked && haveData && online && !levelStale && !tempStale && !alarms.size() ? UI_TEAL : UI_WARN;
    if (uiChanged(1, mode + state)) {
      displayCanvas.fillCircle(13, 12, 4, stateColor);
      uiText(25, 8, state, 1, stateColor, 47);
      uiCommit(32, 24);
    }
    String levelText = levelMissing ? "--" : String(level["value"].as<float>(), 1);
    String tempText = tempMissing ? "--" : String(temp["value"].as<float>(), 1);
    String valuesKey = mode + levelText + ":" + tempText + ":" + String(levelStale) + String(tempStale);
    if (uiChanged(2, valuesKey)) {
      uiValue(8, "HLADINA NADRZE", levelText, "%", levelMissing, levelStale);
      uiValue(164, "TEPLOTA VODY", tempText, "C", tempMissing, tempStale);
      if (!levelMissing) {
        displayCanvas.fillRoundRect(20, 88, 124, 3, 1, UI_BG);
        int width = (int)(constrain(level["value"].as<float>(), 0.0f, 100.0f) * 1.24f);
        if (width) displayCanvas.fillRect(20, 88, width, 3, levelStale ? UI_WARN : UI_TEAL);
      }
      uiCommit(56, 100);
    }
    String levelAge = haveData ? ageText(sensorAge(level)) : "--";
    String tempAge = haveData ? ageText(sensorAge(temp)) : "--";
    if (uiChanged(3, mode + levelAge + ":" + tempAge)) {
      uiText(12, 8, "Pred " + levelAge, 1, UI_MUTED, 23);
      uiText(168, 8, "Pred " + tempAge, 1, UI_MUTED, 23);
      uiCommit(156, 24);
    }
    size_t alarmIndex = alarms.size() ? (millis() / 5000) % alarms.size() : 0;
    String alarmTitle = alarms.size() ? asciiText(alarms[alarmIndex]["title"].as<String>()) : "";
    String alarmKey = mode + String(alarms.size()) + ":" + String(alarmIndex) + ":" + alarmTitle + ":" + String(haveData);
    if (uiChanged(4, alarmKey)) {
      displayCanvas.fillRoundRect(8, 0, 304, 42, 6, UI_PANEL);
      uiText(16, 5, alarms.size() ? "ALARM " + String(alarmIndex + 1) + " / " + String(alarms.size()) : haveData ? "ZADNE AKTIVNI ALARMY" : "CEKAM NA DATA ZE SERVERU", 1, alarms.size() ? UI_WARN : UI_MUTED);
      if (alarms.size()) {
        uiText(16, 18, alarmTitle.substring(0, 47), 1, UI_TEXT, 47);
        uiText(16, 29, alarmTitle.substring(47), 1, UI_TEXT, 47);
      } else uiText(16, 23, haveData ? "Prehled se obnovuje automaticky" : "Nastaveni otevrene drzenim tlacitka 5 s", 1, UI_MUTED, 47);
      uiCommit(180, 44);
    }
  }
  if (uiChanged(5, mode)) {
    uiText(10, 5, setupActive ? "Po ulozeni se displej sam restartuje" : "Obnova 15 s                 Nastaveni: drzet 5 s", 1, UI_MUTED, 50);
    uiCommit(224, 16);
  }
}
