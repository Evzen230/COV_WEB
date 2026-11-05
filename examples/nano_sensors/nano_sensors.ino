// Nano R3 ATmega328P, 5 V. Libraries: OneWire, DallasTemperature.
#include <OneWire.h>
#include <DallasTemperature.h>
#include <SoftwareSerial.h>

const uint8_t TRIG_PIN = 4, ECHO_PIN = 5, TEMPERATURE_PIN = 2;
SoftwareSerial link(8, 9); // RX unused, TX D9 -> divider -> ESP32 GPIO16
OneWire oneWire(TEMPERATURE_PIN);
DallasTemperature thermometer(&oneWire);
uint32_t sequence = 0;

uint16_t crc16(const char* data) {
  uint16_t crc = 0xFFFF;
  while (*data) {
    crc ^= (uint16_t)(uint8_t)*data++ << 8;
    for (uint8_t i = 0; i < 8; i++)
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return crc;
}

long distanceMm() {
  long readings[5];
  uint8_t count = 0;
  for (uint8_t i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW); delayMicroseconds(5);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(20);
    digitalWrite(TRIG_PIN, LOW);
    unsigned long duration = pulseIn(ECHO_PIN, HIGH, 40000UL);
    long mm = (duration * 343UL + 1000UL) / 2000UL;
    if (duration && mm >= 210 && mm <= 6000) readings[count++] = mm;
    delay(80);
  }
  if (count < 3) return -1;
  for (uint8_t i = 1; i < count; i++) {
    long value = readings[i];
    uint8_t j = i;
    while (j && readings[j - 1] > value) { readings[j] = readings[j - 1]; j--; }
    readings[j] = value;
  }
  return readings[count / 2];
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  link.begin(9600);
  thermometer.begin();
  thermometer.setResolution(12);
}

void loop() {
  thermometer.requestTemperatures(); // Wait for a completed conversion, never startup scratchpad.
  float temperature = thermometer.getTempCByIndex(0);
  long centiC = -32768;
  if (isfinite(temperature) && temperature != DEVICE_DISCONNECTED_C &&
      temperature >= -55 && temperature <= 125 && temperature != 85.0f)
    centiC = lround(temperature * 100.0f);
  long mm = distanceMm();
  char payload[72], frame[84];
  snprintf(payload, sizeof(payload), "COV1,%lu,%ld,%ld",
           (unsigned long)sequence++, centiC, mm);
  snprintf(frame, sizeof(frame), "$%s*%04X\n", payload, crc16(payload));
  link.print(frame);
  Serial.print(frame); // USB diagnostics: exactly the same frame as on D9.
  delay(750); // A fresh frame approximately every two seconds.
}
