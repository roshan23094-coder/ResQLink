#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <TinyGPSPlus.h>
#include <LovyanGFX.hpp>
#include "MAX30105.h"
#include "spo2_algorithm.h"

// =================================================
// WI-FI / BACKEND CONFIGURATION
// =================================================
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL = "http://10.243.204.27:5000/api/ambulance/update";

const char* AMBULANCE_ID = "A-01";
unsigned long lastUpload = 0;
unsigned long lastWiFiAttempt = 0;
const unsigned long UPLOAD_INTERVAL = 1000;
const unsigned long WIFI_RETRY_INTERVAL = 10000;

// =================================================
// 1. TFT ILI9488 CONFIGURATION
// =================================================

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9488 panel;
  lgfx::Bus_Parallel8 bus;

public:
  LGFX() {
    {
      auto cfg = bus.config();

      cfg.freq_write = 10000000;
      cfg.pin_wr = 4;
      cfg.pin_rd = 2;
      cfg.pin_rs = 15;

      cfg.pin_d0 = 12;
      cfg.pin_d1 = 13;
      cfg.pin_d2 = 26;
      cfg.pin_d3 = 25;
      cfg.pin_d4 = 17;
      cfg.pin_d5 = 16;
      cfg.pin_d6 = 27;
      cfg.pin_d7 = 14;

      bus.config(cfg);
      panel.setBus(&bus);
    }

    {
      auto cfg = panel.config();

      cfg.pin_cs = 33;
      cfg.pin_rst = -1;
      cfg.panel_width = 320;
      cfg.panel_height = 480;

      panel.config(cfg);
    }

    setPanel(&panel);
  }
};

LGFX tft;

// =================================================
// 2. RFID CONFIGURATION
// =================================================

#define RFID_SS 5
#define RFID_RST 32

MFRC522 rfid(RFID_SS, RFID_RST);
bool rfidReaderReady = false;

String patientUID = "NOT SCANNED";
bool rfidDetected = false;

// =================================================
// 3. GPS CONFIGURATION
// =================================================

TinyGPSPlus gps;
HardwareSerial GPS(2);

double latitude = 0;
double longitude = 0;

int satellites = 0;
bool gpsValid = false;
double gpsHdop = 0;
unsigned long gpsLastFixMillis = 0;

// =================================================
// 4. MAX30102 CONFIGURATION
// =================================================

MAX30105 sensor;

bool maxConnected = false;

#define BUFFER_SIZE 100

uint32_t irBuffer[BUFFER_SIZE];
uint32_t redBuffer[BUFFER_SIZE];

int bufferCount = 0;

int32_t spo2 = 0;
int8_t validSpO2 = 0;

int32_t heartRate = 0;
int8_t validHeartRate = 0;

uint32_t lastIR = 0;
uint32_t lastRed = 0;

bool fingerDetected = false;

// Hysteresis reduces repeated finger-present / finger-removed flicker.
const uint32_t FINGER_ON_THRESHOLD = 50000;
const uint32_t FINGER_OFF_THRESHOLD = 45000;
int32_t filteredHeartRate = 0;
int32_t filteredSpO2 = 0;
bool haveFilteredHeartRate = false;
bool haveFilteredSpO2 = false;

// Keep the last five valid estimates and publish their median only after
// three valid windows. This rejects isolated jumps without inventing values.
int32_t hrHistory[5] = {0};
int32_t spo2History[5] = {0};
uint8_t hrHistoryCount = 0;
uint8_t spo2HistoryCount = 0;
uint8_t hrHistoryIndex = 0;
uint8_t spo2HistoryIndex = 0;
unsigned long lastValidHeartRateMillis = 0;
unsigned long lastValidSpO2Millis = 0;
const unsigned long VITALS_STALE_MS = 5000;
unsigned long lastMaxLog = 0;
const unsigned long MAX_LOG_INTERVAL = 3000;

// =================================================
// 5. AD8232 ECG CONFIGURATION
// =================================================

#define ECG_OUTPUT_PIN 35
#define ECG_LO_PLUS_PIN 36
#define ECG_LO_MINUS_PIN 39

int ecgRawValue = 0;
bool ecgLeadOff = true;
bool ecgSignalActive = false;
unsigned long lastECGSample = 0;
unsigned long lastECGLog = 0;

const unsigned long ECG_SAMPLE_INTERVAL = 10;
const int ECG_BATCH_SIZE = 100;

int ecgSamples[ECG_BATCH_SIZE];
int ecgSampleCount = 0;

unsigned long lastDisplay = 0;

// =================================================
// 6. TFT COLOURS
// =================================================

#define BLACK 0x0000
#define WHITE 0xFFFF
#define RED 0xF800
#define GREEN 0x07E0
#define BLUE 0x001F
#define CYAN 0x07FF
#define YELLOW 0xFFE0
#define GREY 0x8410

// =================================================
// 7. SETUP
// =================================================

void setup() {

  Serial.begin(115200);

  Serial.println();
  Serial.println("================================");
  Serial.println("      RESQLINK SYSTEM");
  Serial.println("================================");

  tft.init();
  tft.setRotation(1);
  tft.fillScreen(BLACK);

  Wire.begin(21, 22);

  pinMode(ECG_OUTPUT_PIN, INPUT);
  pinMode(ECG_LO_PLUS_PIN, INPUT);
  pinMode(ECG_LO_MINUS_PIN, INPUT);

  analogReadResolution(12);

  Serial.println("AD8232: INITIALIZED");

  // MFRC522 uses ESP32 VSPI: SCK=18, MISO=19, MOSI=23, SS=5
  pinMode(RFID_SS, OUTPUT);
  digitalWrite(RFID_SS, HIGH);
  SPI.begin(18, 19, 23, RFID_SS);
  rfid.PCD_Init();
  delay(50);
  rfid.PCD_AntennaOn();

  byte rfidVersion = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.print("MFRC522 firmware version: 0x");
  Serial.println(rfidVersion, HEX);

  if (rfidVersion == 0x00 || rfidVersion == 0xFF) {
    rfidReaderReady = false;
    Serial.println("RFID ERROR: MFRC522 not responding on SPI.");
  } else {
    rfidReaderReady = true;
    Serial.println("RFID READER: READY - scan a 13.56 MHz MIFARE card.");
    Serial.print("RFID antenna status register: 0x");
    Serial.println(rfid.PCD_ReadRegister(MFRC522::TxControlReg), HEX);
  }

  GPS.begin(9600, SERIAL_8N1, 34, -1);

  if (sensor.begin(Wire, I2C_SPEED_FAST)) {

    maxConnected = true;

    sensor.setup(
      60,
      4,
      2,
      100,
      411,
      4096);

    sensor.setPulseAmplitudeRed(0x1F);
    sensor.setPulseAmplitudeIR(0x1F);

    Serial.println("MAX30102: CONNECTED");

  } else {

    Serial.println("MAX30102: NOT DETECTED");
  }

  Serial.println("RFID: INITIALIZED");
  Serial.println("GPS: INITIALIZED");
  Serial.println("TFT: INITIALIZED");

  startWiFi();

  drawStaticDashboard();
}

// =================================================
// 8. MAIN LOOP
// =================================================

void loop() {

  readGPS();
  readRFID();
  readMAX30102();
  readAD8232();

  maintainWiFi();

  if (millis() - lastUpload >= UPLOAD_INTERVAL) {
    lastUpload = millis();
    uploadSensorData();
  }

  if (millis() - lastDisplay >= 1000) {
    lastDisplay = millis();
    updateDashboard();
  }
}

// =================================================
// 9. WI-FI AND BACKEND DATA TRANSMISSION
// =================================================

void startWiFi() {

  if (String(WIFI_SSID) == "YOUR_WIFI_NAME") {
    Serial.println("Wi-Fi credentials not set. Update WIFI_SSID and WIFI_PASSWORD.");
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  lastWiFiAttempt = millis();

  Serial.print("Connecting to Wi-Fi");

  unsigned long startTime = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 12000) {

    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println();
    Serial.println("Wi-Fi connected");

    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());

  } else {

    Serial.println();
    Serial.println("Wi-Fi not connected yet. Will retry automatically.");
  }
}

void maintainWiFi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (String(WIFI_SSID) == "YOUR_WIFI_NAME") {
    return;
  }

  if (millis() - lastWiFiAttempt >= WIFI_RETRY_INTERVAL) {

    lastWiFiAttempt = millis();

    Serial.println("Wi-Fi disconnected. Reconnecting...");

    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

void uploadSensorData() {

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Upload skipped: Wi-Fi is not connected.");
    return;
  }

  String payload = "{";

  payload += "\"ambulanceId\":\"" + String(AMBULANCE_ID) + "\",";
  payload += "\"fingerDetected\":" + String(fingerDetected ? "true" : "false") + ",";
  payload += "\"heartRateValid\":" + String((fingerDetected && validHeartRate) ? "true" : "false") + ",";
  payload += "\"spo2Valid\":" + String((fingerDetected && validSpO2) ? "true" : "false") + ",";
  payload += "\"heartRate\":" + String((fingerDetected && validHeartRate) ? heartRate : 0) + ",";
  payload += "\"spo2\":" + String((fingerDetected && validSpO2) ? spo2 : 0) + ",";
  payload += "\"ecgRaw\":" + String(ecgRawValue) + ",";
  payload += "\"ecgLeadOff\":" + String(ecgLeadOff ? "true" : "false") + ",";
  payload += "\"ecgSampleRate\":100,";
  payload += "\"ecgSamples\":[";

  for (int i = 0; i < ecgSampleCount; i++) {

    if (i > 0) payload += ",";

    payload += String(ecgSamples[i]);
  }

  payload += "],";
  payload += "\"emergency\":false,";
  payload += "\"assistanceRequested\":false";

  // Send RFID status and UID on every upload for reliable backend synchronization.
  payload += ",\"rfidDetected\":";
  payload += rfidDetected ? "true" : "false";
  payload += ",\"rfidStatus\":\"";
  payload += rfidDetected ? "IDENTIFIED" : "NOT_SCANNED";
  payload += "\",\"patientId\":";
  if (rfidDetected && patientUID.length() > 0) {
    payload += "\"" + patientUID + "\"";
  } else {
    payload += "null";
  }
  payload += ",\"rfidUid\":";
  if (rfidDetected && patientUID.length() > 0) {
    payload += "\"" + patientUID + "\"";
  } else {
    payload += "null";
  }

  payload += ",\"gpsValid\":";
  payload += gpsValid ? "true" : "false";

  payload += ",\"gpsSatellites\":" + String(satellites);
  payload += ",\"gpsHdop\":" + String(gpsHdop, 1);

  if (gpsValid) {

    payload += ",\"latitude\":" + String(latitude, 6);
    payload += ",\"longitude\":" + String(longitude, 6);
  }

  payload += "}";

  HTTPClient http;
  http.setTimeout(2500);

  if (!http.begin(SERVER_URL)) {
    Serial.println("HTTP setup failed.");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  Serial.print("Uploading RFID status: ");
  Serial.print(rfidDetected ? "IDENTIFIED | UID=" : "NOT_SCANNED");
  if (rfidDetected) Serial.println(patientUID);
  else Serial.println();

  Serial.print("ESP32 JSON payload: ");
  Serial.println(payload);

  int httpCode = http.POST(payload);

  if (httpCode > 0) {

    Serial.print("Backend response: HTTP ");
    Serial.println(httpCode);

    if (httpCode >= 200 && httpCode < 300) {

      Serial.println("Sensor data uploaded successfully.");

      ecgSampleCount = 0;

    } else {

      Serial.println(http.getString());
    }

  } else {

    Serial.print("Upload failed: ");
    Serial.println(http.errorToString(httpCode));
  }

  http.end();
}

// =================================================
// 10. AD8232 ECG READING
// =================================================

void readAD8232() {

  bool loPlus = digitalRead(ECG_LO_PLUS_PIN);
  bool loMinus = digitalRead(ECG_LO_MINUS_PIN);
  ecgLeadOff = (loPlus == HIGH || loMinus == HIGH);

  if (ecgLeadOff) {
    // Prevent floating ADC noise from being drawn as an ECG waveform.
    ecgSignalActive = false;
    ecgRawValue = 0;
    ecgSampleCount = 0;
  } else {
    ecgSignalActive = true;

    if (millis() - lastECGSample >= ECG_SAMPLE_INTERVAL) {
      lastECGSample = millis();
      ecgRawValue = analogRead(ECG_OUTPUT_PIN);

      if (ecgSampleCount < ECG_BATCH_SIZE) {
        ecgSamples[ecgSampleCount++] = ecgRawValue;
      }
    }
  }

  if (millis() - lastECGLog >= 1000) {
    lastECGLog = millis();

    if (ecgLeadOff) {
      Serial.println("AD8232: LEADS OFF - ECG waveform suppressed.");
    } else {
      Serial.print("AD8232 ECG raw: ");
      Serial.print(ecgRawValue);
      Serial.print(" | Samples in batch: ");
      Serial.println(ecgSampleCount);
    }
  }
}

// 11. GPS READING
// =================================================

void readGPS() {

  while (GPS.available()) {
    gps.encode(GPS.read());
  }

  gpsValid = gps.location.isValid() && gps.location.age() < 5000;

  satellites = gps.satellites.isValid()
                 ? gps.satellites.value()
                 : 0;

  gpsHdop = gps.hdop.isValid()
              ? gps.hdop.hdop()
              : 0;

  if (gpsValid) {

    latitude = gps.location.lat();
    longitude = gps.location.lng();

    gpsLastFixMillis = millis();
  }
}

// =================================================
// 12. RFID READING
// =================================================

void readRFID() {

  if (!rfidReaderReady) {
    return;
  }

  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    Serial.println("RFID: Card detected, but UID read failed.");
    return;
  }

  String scannedUID = "";

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      scannedUID += "0";
    }

    scannedUID += String(rfid.uid.uidByte[i], HEX);

    if (i < rfid.uid.size - 1) {
      scannedUID += ":";
    }
  }

  scannedUID.toUpperCase();

  if (scannedUID.length() > 0) {
    patientUID = scannedUID;
    rfidDetected = true;

    Serial.println();
    Serial.println("========== RFID CARD DETECTED ==========");
    Serial.print("Patient RFID UID: ");
    Serial.println(patientUID);
    Serial.println("This UID will be sent to /api/ambulance/update.");
    Serial.println("========================================");
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

// =================================================
// 13. MAX30102 READING AND SPO2 ALGORITHM
// =================================================

int32_t medianOf(const int32_t *source, uint8_t count) {
  int32_t sorted[5];
  for (uint8_t i = 0; i < count; i++) sorted[i] = source[i];
  for (uint8_t i = 0; i < count; i++) {
    for (uint8_t j = i + 1; j < count; j++) {
      if (sorted[j] < sorted[i]) {
        int32_t t = sorted[i]; sorted[i] = sorted[j]; sorted[j] = t;
      }
    }
  }
  return sorted[count / 2];
}

void resetVitalsFilter() {
  hrHistoryCount = 0;
  spo2HistoryCount = 0;
  hrHistoryIndex = 0;
  spo2HistoryIndex = 0;
  haveFilteredHeartRate = false;
  haveFilteredSpO2 = false;
  heartRate = 0;
  spo2 = 0;
  validHeartRate = 0;
  validSpO2 = 0;
  filteredHeartRate = 0;
  filteredSpO2 = 0;
}

void readMAX30102() {
  if (!maxConnected) return;

  sensor.check();
  while (sensor.available()) {
    uint32_t irValue = sensor.getFIFOIR();
    uint32_t redValue = sensor.getFIFORed();
    lastIR = irValue;
    lastRed = redValue;

    // Hysteresis prevents a noisy threshold from rapidly toggling finger state.
    if (!fingerDetected && irValue >= FINGER_ON_THRESHOLD) {
      fingerDetected = true;
      bufferCount = 0;
      resetVitalsFilter();
      Serial.println("MAX30102: Finger detected; stabilising signal...");
    } else if (fingerDetected && irValue < FINGER_OFF_THRESHOLD) {
      fingerDetected = false;
      bufferCount = 0;
      resetVitalsFilter();
      Serial.println("MAX30102: Finger removed; values cleared.");
    }

    if (fingerDetected) {
      if (bufferCount < BUFFER_SIZE) {
        irBuffer[bufferCount] = irValue;
        redBuffer[bufferCount] = redValue;
        bufferCount++;
      }

      if (bufferCount >= BUFFER_SIZE) {
        int32_t calcSpO2 = 0, calcHR = 0;
        int8_t calcSpO2Valid = 0, calcHRValid = 0;
        maxim_heart_rate_and_oxygen_saturation(
          irBuffer, BUFFER_SIZE, redBuffer,
          &calcSpO2, &calcSpO2Valid, &calcHR, &calcHRValid
        );

        // Reject impossible results; a rolling median suppresses isolated jumps
        // without permanently rejecting a genuine change in the patient's rate.
        if (calcHRValid && calcHR >= 40 && calcHR <= 180) {
          hrHistory[hrHistoryIndex] = calcHR;
          hrHistoryIndex = (hrHistoryIndex + 1) % 5;
          if (hrHistoryCount < 5) hrHistoryCount++;
          if (hrHistoryCount >= 3) {
            heartRate = medianOf(hrHistory, hrHistoryCount);
            validHeartRate = 1;
            haveFilteredHeartRate = true;
            lastValidHeartRateMillis = millis();
          }
        }

        if (calcSpO2Valid && calcSpO2 >= 85 && calcSpO2 <= 100) {
          spo2History[spo2HistoryIndex] = calcSpO2;
          spo2HistoryIndex = (spo2HistoryIndex + 1) % 5;
          if (spo2HistoryCount < 5) spo2HistoryCount++;
          if (spo2HistoryCount >= 3) {
            spo2 = medianOf(spo2History, spo2HistoryCount);
            validSpO2 = 1;
            haveFilteredSpO2 = true;
            lastValidSpO2Millis = millis();
          }
        }

        if (millis() - lastMaxLog >= MAX_LOG_INTERVAL) {
          lastMaxLog = millis();
          Serial.println("\nMAX30102 FILTERED RESULT (median of up to 5 valid windows)");
          Serial.print("IR: "); Serial.println(irValue);
          Serial.print("HR: ");
          if (validHeartRate) { Serial.print(heartRate); Serial.println(" BPM"); }
          else Serial.println("WAITING FOR 3 VALID WINDOWS");
          Serial.print("SpO2: ");
          if (validSpO2) { Serial.print(spo2); Serial.println("%"); }
          else Serial.println("WAITING FOR 3 VALID WINDOWS");
        }

        // 75-sample overlap: recalculate with the newest 25 samples next time.
        for (int i = 25; i < BUFFER_SIZE; i++) {
          irBuffer[i - 25] = irBuffer[i];
          redBuffer[i - 25] = redBuffer[i];
        }
        bufferCount = 75;
      }
    }
    sensor.nextSample();
  }

  // Do not keep displaying a once-valid number if fresh valid estimates stop.
  if (fingerDetected && lastValidHeartRateMillis > 0 &&
      millis() - lastValidHeartRateMillis > VITALS_STALE_MS) {
    validHeartRate = 0;
    heartRate = 0;
  }
  if (fingerDetected && lastValidSpO2Millis > 0 &&
      millis() - lastValidSpO2Millis > VITALS_STALE_MS) {
    validSpO2 = 0;
    spo2 = 0;
  }
}

void drawStaticDashboard() {

  tft.fillScreen(BLACK);

  tft.fillRect(0, 0, 480, 48, BLUE);

  tft.setTextColor(WHITE);
  tft.setTextSize(3);

  tft.setCursor(12, 10);
  tft.print("ResQLink");

  tft.setTextSize(1);
  tft.setCursor(370, 18);
  tft.print("AMBULANCE SYSTEM");

  tft.setTextColor(YELLOW);
  tft.setTextSize(2);

  tft.setCursor(12, 62);
  tft.print("PATIENT IDENTIFICATION");

  tft.drawFastHLine(12, 90, 455, GREY);

  tft.setTextColor(RED);
  tft.setCursor(12, 105);
  tft.print("HEART RATE");

  tft.setTextColor(CYAN);
  tft.setCursor(250, 105);
  tft.print("SpO2");

  tft.setTextColor(YELLOW);
  tft.setCursor(12, 205);
  tft.print("GPS LOCATION");

  tft.drawFastHLine(12, 232, 455, GREY);

  tft.setTextColor(YELLOW);
  tft.setCursor(12, 265);
  tft.print("RFID STATUS");

  tft.setTextColor(GREY);
  tft.setTextSize(1);

  tft.setCursor(12, 305);
  tft.print("RESQLINK - PATIENT MONITORING SYSTEM");
}

// =================================================
// 15. UPDATE DASHBOARD
// =================================================

void updateDashboard() {

  tft.fillRect(12, 93, 450, 25, BLACK);

  tft.setCursor(12, 95);
  tft.setTextSize(2);
  tft.setTextColor(WHITE);

  if (rfidDetected) {
    tft.print(patientUID);
  } else {
    tft.print("WAITING FOR CARD");
  }

  tft.fillRect(12, 132, 215, 55, BLACK);

  tft.setCursor(12, 140);
  tft.setTextSize(3);
  tft.setTextColor(WHITE);

  if (fingerDetected && validHeartRate) {

    tft.print(heartRate);
    tft.print(" BPM");

  } else if (!fingerDetected) {

    tft.print("NO FINGER");

  } else {

    tft.print("WAITING");
  }

  tft.fillRect(250, 132, 210, 55, BLACK);

  tft.setCursor(250, 140);
  tft.setTextSize(3);
  tft.setTextColor(WHITE);

  if (fingerDetected && validSpO2) {

    tft.print(spo2);
    tft.print("%");

  } else {

    tft.print("-- %");
  }

  tft.fillRect(12, 185, 450, 16, BLACK);

  tft.setCursor(12, 187);
  tft.setTextSize(1);

  if (maxConnected) {

    tft.setTextColor(GREEN);
    tft.print("MAX30102 CONNECTED");

  } else {

    tft.setTextColor(RED);
    tft.print("MAX30102 DISCONNECTED");
  }

  tft.fillRect(12, 235, 455, 25, BLACK);

  tft.setCursor(12, 238);
  tft.setTextSize(2);

  if (gpsValid) {

    tft.setTextColor(GREEN);
    tft.print("GPS FIXED");

  } else {

    tft.setTextColor(RED);
    tft.print("SEARCHING...");
  }

  tft.fillRect(12, 260, 455, 40, BLACK);

  tft.setTextColor(WHITE);
  tft.setTextSize(1);

  tft.setCursor(12, 266);

  if (gpsValid) {

    tft.print("LAT: ");
    tft.print(latitude, 6);

    tft.setCursor(12, 281);

    tft.print("LON: ");
    tft.print(longitude, 6);

  } else {

    tft.print("Waiting for satellite connection");
  }


  tft.fillRect(12, 290, 455, 15, BLACK);

  tft.setCursor(12, 291);
  tft.setTextSize(1);

  tft.setTextColor(rfidDetected ? GREEN : YELLOW);

  if (rfidDetected) {

    tft.print("RFID: PATIENT DETECTED");

  } else {

    tft.print("RFID: WAITING FOR CARD");
  }

  static unsigned long lastGPSLog = 0;

  if (millis() - lastGPSLog > 5000) {

    lastGPSLog = millis();

    Serial.print("GPS: ");

    if (gpsValid) {

      Serial.print(latitude, 6);
      Serial.print(", ");

      Serial.print(longitude, 6);
      Serial.print(" | Satellites: ");

      Serial.println(satellites);

    } else {

      Serial.println("Searching for GPS fix");
    }
  }
}