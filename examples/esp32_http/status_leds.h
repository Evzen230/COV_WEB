#pragma once
// ESP32 DevKit V1: each GPIO -> 470 ohm -> LED anode; cathode -> GND.
// Avoid boot-strapping pins, UART16 and setup button27.
#define COV_LED_BLUE 25
#define COV_LED_RED 26
#define COV_LED_YELLOW 32
#define COV_LED_GREEN 33
#ifndef COV_EXPECT_TEMPERATURE
#define COV_EXPECT_TEMPERATURE 1
#endif
#ifndef COV_EXPECT_DISTANCE
#define COV_EXPECT_DISTANCE 1
#endif

volatile bool covServerReached = false;
volatile bool covNetworkFailed = false;
volatile bool covInternalFailed = false;

void covServiceTask(void*) {
  for (;;) {
    readNano();
    reportNano();
    unsigned long now = millis();
    bool blue = false, red = false, yellow = false, green = false;
    NanoSnapshot nano = currentNano();
    bool fresh = nano.seen && now - nano.receivedAt <= 10000UL;
    if (setupActive) blue = (now / 500) % 2 == 0;
    else if (covInternalFailed || (!fresh && now >= 10000UL)) red = true;
    else if (covNetworkFailed || (WiFi.status() != WL_CONNECTED && now >= 30000UL)) blue = red = true;
    else if (fresh && ((COV_EXPECT_TEMPERATURE && nano.temperature == -32768) ||
                      (COV_EXPECT_DISTANCE && nano.distance == -1))) yellow = true;
    else if (!covServerReached || !fresh) blue = true;
    else green = true;
    digitalWrite(COV_LED_BLUE, blue);
    digitalWrite(COV_LED_RED, red);
    digitalWrite(COV_LED_YELLOW, yellow);
    digitalWrite(COV_LED_GREEN, green);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void beginCovService() {
  for (int pin : {COV_LED_BLUE, COV_LED_RED, COV_LED_YELLOW, COV_LED_GREEN}) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  if (xTaskCreate(covServiceTask, "cov-service", 4096, nullptr, 1, nullptr) != pdPASS) {
    covInternalFailed = true;
    digitalWrite(COV_LED_RED, HIGH);
    // Do not continue without the UART reader.
    while (true) delay(1000);
  }
}
