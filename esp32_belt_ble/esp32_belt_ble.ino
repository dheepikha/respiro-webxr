// Respiratory belt -> phone over Bluetooth LE (Nordic UART service), for Respiro VR.
// Board: any ESP32 (Arduino core 2.x or 3.x). Belt amplifier output -> GPIO34 (ADC1).
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"   // notify: device -> phone
const int PIN_BELT = 34;
const int SEND_HZ  = 25;

BLECharacteristic *tx;
bool connected = false;

class Cb : public BLEServerCallbacks {
  void onConnect(BLEServer *) { connected = true; }
  void onDisconnect(BLEServer *s) { connected = false; s->getAdvertising()->start(); }
};

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  BLEDevice::init("Respiro-Belt");
  BLEServer *srv = BLEDevice::createServer();
  srv->setCallbacks(new Cb());
  BLEService *svc = srv->createService(SERVICE_UUID);
  tx = svc->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  tx->addDescriptor(new BLE2902());
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();
}

void loop() {
  // average a few ADC samples to tame noise, then send one number per line
  long sum = 0;
  for (int i = 0; i < 8; i++) sum += analogRead(PIN_BELT);
  float v = sum / 8.0f;
  if (connected) {
    char buf[24];
    int n = snprintf(buf, sizeof(buf), "%.1f\n", v);
    tx->setValue((uint8_t *)buf, n);
    tx->notify();
  }
  delay(1000 / SEND_HZ);
}
