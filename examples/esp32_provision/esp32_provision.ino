// One-time provisioning over USB Serial, 115200 baud, newline line endings.
// Upload this sketch first. Then upload esp32_http WITHOUT erasing all flash.
#include <Preferences.h>
String prompt(const char* label, bool required = true) {
  Serial.println(label);
  while (true) {
    while (!Serial.available()) delay(20);
    String value = Serial.readStringUntil('\n');
    if (value.endsWith("\r")) value.remove(value.length() - 1);
    if (!required || value.length()) return value;
  }
}
void setup() {
  Serial.begin(115200); Serial.setTimeout(120000); delay(2000);
  Serial.println("COV provisioning. Values are not echoed by this sketch.");
  String ssid = prompt("Wi-Fi SSID:");
  String password = prompt("Wi-Fi password (empty allowed):", false);
  String url = prompt("Telemetry URL, e.g. http://192.168.1.100:4173/api/v1/telemetry:");
  String key = prompt("Station API key:");
  if (!url.startsWith("http://")) { Serial.println("Use the local HTTP telemetry URL."); return; }
  Preferences preferences;
  if (!preferences.begin("cov", false)) { Serial.println("Cannot open NVS"); return; }
  preferences.putString("ssid", ssid);
  preferences.putString("password", password);
  preferences.putString("server", url);
  preferences.putString("key", key);
  preferences.end();
  Serial.println("Saved to NVS. Upload the monitoring firmware without erasing flash.");
}
void loop() { delay(1000); }
