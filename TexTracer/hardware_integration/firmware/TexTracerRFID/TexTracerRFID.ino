// ===========================================================================
// TexTracer - ESP32 + 9x MFRC522  ->  existing TexTracer backend (POST /api/scans/device)
//
// Based on the original SupplyEase/TexTracer hardware sketch (same pins, same Facade + Singleton
// structure). Added: Wi-Fi, NTP time, per-reader device keys, HTTP delivery to the backend,
// honest status reporting, retry queue, reader health checks.
//
// Backend contract (read from backend/src/modules/scans/scans.routes.ts - not invented):
//   POST  http://<laptop>:5000/api/scans/device
//   Headers: Content-Type: application/json,  X-Reader-Key: <that reader's key>
//   Body:    {"rfidUid":"A1B2C3D4","readerCode":"RDR-PROD","deviceTimestamp":"2026-11-05T09:40:00Z"}
//   201 accepted | 200 duplicate | 404/422 SCAN_REJECTED | 400 validation | 401 bad key | 429 rate limit
// Every call that reaches record_scan() writes a scan_logs row; only "accepted" moves the product.
//
// Libraries: "MFRC522" (miguelbalboa) from the Arduino Library Manager. WiFi/HTTPClient come with the
// ESP32 Arduino core. No other dependency.
// ===========================================================================
#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <time.h>

#include "config.h"
#include "reader_keys.h"

// ==========================================
// PIN DEFINITIONS (unchanged from the original sketch)
// ==========================================
#define SS_PIN1  27
#define SS_PIN2  12
#define SS_PIN3  15
#define SS_PIN4  2

#define RST_PIN1 26
#define SCK_PIN  18
#define MOSI_PIN 23
#define MISO_PIN 19

// The original sketch listed 10 chip-select pins. The database (and READER_DEFS) define 9 physical
// readers (the "intake" stage is an approval gate with no hardware), so the first 9 pins are used.
// The 10th pin (GPIO 22) is left free; to add a 10th reader, add a row in the backend first.
const byte readers = sizeof(READER_DEFS) / sizeof(READER_DEFS[0]);   // 9
int ss[] = {
  SS_PIN1, SS_PIN2, SS_PIN3, SS_PIN4,
  4, 16, 5, 17, 21, 22
};
static_assert(sizeof(READER_DEFS) / sizeof(READER_DEFS[0]) <= sizeof(ss) / sizeof(ss[0]),
              "more READER_DEFS rows than chip-select pins");

// ==========================================
// DELIVERY RESULT MODEL
// ==========================================
// Four separate facts are tracked and printed, so nothing is ever reported as "saved" too early:
//   1. DETECTED     - a tag was read by a reader
//   2. TRANSMITTED  - the HTTP request got an HTTP answer back
//   3. ACCEPTED     - the backend validated and processed the request (not rejected as bad input / bad key)
//   4. DB SAVED     - the backend says record_scan() ran, i.e. a scan_logs row exists (and, for
//                     "accepted", the product moved to the new stage)
enum Outcome {
  OUT_SAVED_MOVED,       // 201 accepted: scan logged + product advanced
  OUT_SAVED_DUPLICATE,   // 200 duplicate: scan logged, product already at this stage (harmless repeat)
  OUT_SAVED_REJECTED,    // 404/422 SCAN_REJECTED: attempt logged, product not moved (business rule)
  OUT_DROP_BAD_KEY,      // 401: not saved, retrying cannot help
  OUT_DROP_BAD_REQUEST,  // 400 / other 4xx: not saved, retrying cannot help
  OUT_RETRY              // no answer / 429 / 5xx / unreadable answer: NOT saved (or unconfirmed), retry
};

struct HttpResult {
  bool transportOk = false;   // got any HTTP status back
  int  status = 0;            // HTTP status or negative HTTPClient error
  int  retryAfterSec = 0;
  String body;
};

struct PendingScan {
  byte   reader;
  String uid;
  time_t scanEpoch;           // 0 = device clock was not synced when the tag was read
  byte   attempts;
  unsigned long nextTryMs;
};

// ==========================================
// FACADE INTERFACE
// ==========================================
class ISupplyEaseFacade {
  public:
    virtual void initializeSystem() = 0;
    virtual void runSystem() = 0;
};

// ==========================================
// SINGLETON + FACADE IMPLEMENTATION
// ==========================================
class SupplyEaseSystem : public ISupplyEaseFacade {

  private:

    static SupplyEaseSystem* instance;

    MFRC522* mfrc522[readers];
    bool readerOk[readers];
    unsigned long totalScans[readers] = {0};
    String lastUid[readers];
    unsigned long lastUidMs[readers] = {0};

    PendingScan queue[QUEUE_SIZE];
    int qHead = 0;
    int qCount = 0;

    bool wasConnected = false;
    bool ntpStarted = false;
    unsigned long lastWifiTryMs = 0;
    unsigned long wifiDisconnectedSinceMs = 0;
    unsigned long lastWaitMsgMs = 0;
    unsigned long lastReaderCheckMs = 0;

    // ---------- small helpers ----------

    static bool clockValid() { return time(nullptr) > 1700000000; }   // after Nov 2023 = NTP synced

    static String isoUtc(time_t t) {
      struct tm tmv;
      gmtime_r(&t, &tmv);
      char b[32];
      strftime(b, sizeof(b), "%Y-%m-%dT%H:%M:%SZ", &tmv);
      return String(b);
    }

    static String baseUrl() {
      return String("http://") + BACKEND_HOST + ":" + String(BACKEND_PORT) + "/api";
    }

    static bool keyIsPlaceholder(int r) {
      return strncmp(READER_DEFS[r].key, "REPLACE", 7) == 0;
    }

    // Minimal extraction of  "key":"value"  from the backend's compact JSON (no JSON library needed).
    static String jsonStr(const String& body, const char* key) {
      String pat = String("\"") + key + "\":\"";
      int s = body.indexOf(pat);
      if (s < 0) return "";
      s += pat.length();
      String out;
      for (int i = s; i < (int)body.length(); i++) {
        char c = body[i];
        if (c == '\\' && i + 1 < (int)body.length()) { out += body[++i]; continue; }
        if (c == '"') break;
        out += c;
      }
      return out;
    }

    // ======================================
    // Wi-Fi + NTP
    // ======================================

    void maintainWifi() {
      const unsigned long now = millis();
      const bool up = (WiFi.status() == WL_CONNECTED);

      if (up) {
        wifiDisconnectedSinceMs = 0;

        if (!wasConnected) {
          Serial.print("[WIFI] Connected. ESP32 IP: ");
          Serial.println(WiFi.localIP());

          if (!ntpStarted) {
            configTime(0, 0, "pool.ntp.org", "time.google.com");
            ntpStarted = true;
          }
        }

        wasConnected = true;
        return;
      }

      if (wasConnected) {
        Serial.println("[WIFI] Disconnected. RFID scanning will continue; scans will be queued.");
        wifiDisconnectedSinceMs = now;
      } else if (wifiDisconnectedSinceMs == 0) {
        wifiDisconnectedSinceMs = now;
      }

      wasConnected = false;

      // Do not restart Wi-Fi immediately. WL_DISCONNECTED can be a temporary
      // state while the ESP32 is associating with the access point.
      // Let ESP32 auto-reconnect work first, then request a reconnect without
      // explicitly disconnecting or repeatedly calling WiFi.begin().
      const bool disconnectedLongEnough =
          (now - wifiDisconnectedSinceMs) >= 15000UL;
      const bool retryIntervalPassed =
          (now - lastWifiTryMs) >= 20000UL;

      if (disconnectedLongEnough && retryIntervalPassed) {
        lastWifiTryMs = now;
        Serial.print("[WIFI] Still disconnected (status ");
        Serial.print((int)WiFi.status());
        Serial.println("). Requesting reconnect...");
        WiFi.reconnect();
      }
    }

    static const char* wifiStatusText(wl_status_t st) {
      switch (st) {
        case WL_NO_SSID_AVAIL:   return "SSID not found (wrong name, or the router is 5 GHz only - ESP32 needs 2.4 GHz)";
        case WL_CONNECT_FAILED:  return "connect failed (wrong password?)";
        case WL_CONNECTION_LOST: return "connection lost";
        case WL_DISCONNECTED:    return "disconnected / still trying";
        default:                 return "not connected";
      }
    }

    void warnIfPlaceholderConfig() {
      if (strcmp(WIFI_SSID, "YOUR_WIFI_NAME") == 0 || strcmp(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD") == 0)
        Serial.println("!! config.h still has the placeholder Wi-Fi name/password - edit WIFI_SSID / WIFI_PASSWORD and re-upload.");
      if (strcmp(BACKEND_HOST, "localhost") == 0 || strcmp(BACKEND_HOST, "127.0.0.1") == 0)
        Serial.println("!! BACKEND_HOST must be the LAPTOP's LAN IP (e.g. 192.168.1.23), not localhost - on the ESP32 localhost is the ESP32 itself.");
      else
        Serial.println("   (BACKEND_HOST must equal the 'BACKEND_HOST' line the backend prints at start-up.)");
    }

    void connectWifiAtBoot() {
      warnIfPlaceholderConfig();
      WiFi.mode(WIFI_STA);
      WiFi.setAutoReconnect(true);
      Serial.print("[WIFI] Connecting to \"");
      Serial.print(WIFI_SSID);
      Serial.print("\" ");
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      unsigned long t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
        delay(500);
        Serial.print(".");
      }
      Serial.println();
      maintainWifi();
      lastWifiTryMs = millis();
      if (WiFi.status() != WL_CONNECTED) {
        Serial.print("[WIFI] Status: "); Serial.println(wifiStatusText(WiFi.status()));
        Serial.println("[WIFI] Not connected yet. Scanning still works; scans are queued and sent once connected.");
        return;
      }
      // Wait briefly for NTP so the first scans carry a real timestamp.
      t0 = millis();
      while (!clockValid() && millis() - t0 < 5000) delay(100);
      if (clockValid()) {
        Serial.print("[TIME] Clock synced (UTC): ");
        Serial.println(isoUtc(time(nullptr)));
      } else {
        Serial.println("[TIME] NTP not synced yet - scans will be sent without deviceTimestamp (the backend still logs its own time).");
      }
    }

    void checkBackendAtBoot() {
      if (WiFi.status() != WL_CONNECTED) return;
      HTTPClient http;
      http.setConnectTimeout(5000);
      http.setTimeout(HTTP_TIMEOUT_MS);
      http.begin(baseUrl() + "/health");
      int code = http.GET();
      Serial.print("[BACKEND] GET /api/health -> ");
      if (code == 200) {
        String b = http.getString();
        Serial.print("HTTP 200, database=");
        Serial.println(jsonStr(b, "database"));
        if (jsonStr(b, "database") != "connected")
          Serial.println("[BACKEND] WARNING: backend is up but its database is not connected - scans will NOT be saved.");
      } else {
        Serial.print("FAILED (");
        Serial.print(code);
        Serial.println("). Check BACKEND_HOST/PORT, that `npm run dev` is running, that the laptop and ESP32 are on the SAME Wi-Fi, and the laptop firewall (port 5000, see RUN_GUIDE.md step 8).");
      }
      http.end();
    }

    // ======================================
    // INITIALIZE RFID READERS
    // ======================================

    // MFRC522 VersionReg: 0x91/0x92 = real chip. 0x00 / 0xFF = no chip answering (wiring / power / SS pin).
    bool chipAnswers(int i) {
      selectReader(i);
      byte v = mfrc522[i]->PCD_ReadRegister(MFRC522::VersionReg);
      deselectReader(i);
      return v != 0x00 && v != 0xFF;
    }

    byte chipVersion(int i) {
      selectReader(i);
      byte v = mfrc522[i]->PCD_ReadRegister(MFRC522::VersionReg);
      deselectReader(i);
      return v;
    }

    void initializeRFIDReaders() {

      SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN);

      for (int i = 0; i < readers; i++) {
        pinMode(ss[i], OUTPUT);
        digitalWrite(ss[i], HIGH);
        mfrc522[i] = new MFRC522(ss[i], RST_PIN1);
        readerOk[i] = false;
      }

      int ready = 0;
      for (int i = 0; i < readers; i++) {
        mfrc522[i]->PCD_Init();
        delay(50);

        Serial.print("RFID Reader #");
        Serial.print(i + 1);
        Serial.print(" (");
        Serial.print(READER_DEFS[i].code);
        Serial.print(", SS GPIO ");
        Serial.print(ss[i]);
        Serial.print(") ");
        if (chipAnswers(i)) {
          readerOk[i] = true;
          ready++;
          Serial.print("initialized, chip version 0x");
          Serial.println(chipVersion(i), HEX);
        } else {
          Serial.println("FAILED - no answer from the MFRC522 chip (check wiring, 3.3V, SS pin). Will retry automatically.");
        }
        if (keyIsPlaceholder(i)) {
          Serial.print("   !! ");
          Serial.print(READER_DEFS[i].code);
          Serial.println(" has no device key yet - run tools/provision_reader_keys.mjs. Its scans cannot be sent.");
        }
      }

      Serial.println();
      Serial.println("==================================");
      Serial.print(ready);
      Serial.print(" of ");
      Serial.print((int)readers);
      Serial.println(" RFID READERS ARE READY");
      Serial.println("You can scan RFID cards unlimited times.");
      Serial.println("==================================");
      Serial.println();
    }

    // Periodic: confirm every chip still answers; re-initialise any that stopped.
    void maintainReaders() {
      if (millis() - lastReaderCheckMs < READER_RECHECK_MS) return;
      lastReaderCheckMs = millis();
      for (int i = 0; i < readers; i++) {
        bool answering = chipAnswers(i);
        if (readerOk[i] && !answering) {
          readerOk[i] = false;
          Serial.print("[READER] #");
          Serial.print(i + 1);
          Serial.print(" (");
          Serial.print(READER_DEFS[i].code);
          Serial.println(") stopped answering - will keep retrying.");
        }
        if (!readerOk[i]) {
          mfrc522[i]->PCD_Init();
          delay(50);
          if (chipAnswers(i)) {
            readerOk[i] = true;
            Serial.print("[READER] #");
            Serial.print(i + 1);
            Serial.print(" (");
            Serial.print(READER_DEFS[i].code);
            Serial.println(") is back online.");
          }
        }
      }
    }

    // ======================================
    // SELECT / DESELECT READER
    // ======================================

    void selectReader(int reader) {
      for (int i = 0; i < readers; i++) digitalWrite(ss[i], HIGH);
      digitalWrite(ss[reader], LOW);
      delayMicroseconds(100);
    }

    void deselectReader(int reader) {
      digitalWrite(ss[reader], HIGH);
    }

    // ======================================
    // GET RFID UID  (uppercase hex, exactly what the backend validates: 8-20 hex chars)
    // ======================================

    String getUID(int readerIndex) {
      String uid = "";
      for (byte i = 0; i < mfrc522[readerIndex]->uid.size; i++) {
        byte b = mfrc522[readerIndex]->uid.uidByte[i];
        if (b < 0x10) uid += "0";
        uid += String(b, HEX);
      }
      uid.toUpperCase();
      return uid;
    }

    static bool uidValidForBackend(const String& uid) {
      if (uid.length() < 8 || uid.length() > 20) return false;
      for (unsigned i = 0; i < uid.length(); i++) {
        char c = uid[i];
        if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F'))) return false;
      }
      return true;
    }

    // ======================================
    // PRINT SCAN BLOCK
    // ======================================

    void printScanDetected(int r, const String& uid, time_t epoch) {
      Serial.println();
      Serial.println("========== RFID SCAN DETECTED ==========");
      Serial.print("Reader Number : "); Serial.print(r + 1); Serial.print(" of "); Serial.println((int)readers);
      Serial.print("Reader Code   : "); Serial.println(READER_DEFS[r].code);
      Serial.print("Department ID : "); Serial.print(READER_DEFS[r].departmentId);
      Serial.print(" ("); Serial.print(READER_DEFS[r].department); Serial.println(")");
      Serial.print("Tag UID       : "); Serial.println(uid);
      Serial.print("Scan Time     : ");
      if (epoch) { Serial.print(isoUtc(epoch)); Serial.println(" (UTC, device clock)"); }
      else Serial.println("unavailable (clock not synced; backend will stamp its own time)");
      Serial.print("Scans on this reader since boot: "); Serial.println(totalScans[r]);
      Serial.println("----------------------------------------");
    }

    // ======================================
    // QUEUE
    // ======================================

    bool enqueue(int r, const String& uid, time_t epoch) {
      if (qCount >= QUEUE_SIZE) return false;
      PendingScan& p = queue[(qHead + qCount) % QUEUE_SIZE];
      p.reader = r; p.uid = uid; p.scanEpoch = epoch; p.attempts = 0; p.nextTryMs = 0;
      qCount++;
      return true;
    }

    void popQueue() {
      queue[qHead].uid = "";
      qHead = (qHead + 1) % QUEUE_SIZE;
      qCount--;
    }

    // ======================================
    // HTTP POST to /api/scans/device
    // ======================================

    HttpResult postScan(const PendingScan& p) {
      HttpResult res;
      String json = String("{\"rfidUid\":\"") + p.uid + "\",\"readerCode\":\"" + READER_DEFS[p.reader].code + "\"";
      if (p.scanEpoch) json += String(",\"deviceTimestamp\":\"") + isoUtc(p.scanEpoch) + "\"";
      json += "}";

      HTTPClient http;
      http.setConnectTimeout(5000);
      http.setTimeout(HTTP_TIMEOUT_MS);
      http.begin(baseUrl() + "/scans/device");
      http.addHeader("Content-Type", "application/json");
      http.addHeader("X-Reader-Key", READER_DEFS[p.reader].key);
      const char* hdrs[] = {"Retry-After"};
      http.collectHeaders(hdrs, 1);

      int code = http.POST(json);
      res.status = code;
      if (code > 0) {
        res.transportOk = true;
        res.body = http.getString();
        String ra = http.header("Retry-After");
        if (ra.length()) res.retryAfterSec = ra.toInt();
      }
      http.end();
      return res;
    }

    // Turns an HTTP answer into the four honest statuses and prints them.
    Outcome interpret(const PendingScan& p, const HttpResult& h) {
      if (!h.transportOk) {
        Serial.print("[TX]      NOT TRANSMITTED - no HTTP answer (HTTPClient error ");
        Serial.print(h.status);
        Serial.println(": backend unreachable / timeout / Wi-Fi problem).");
        Serial.println("[BACKEND] No response.");
        Serial.println("[DB]      NOT SAVED (nothing reached the backend).");
        return OUT_RETRY;
      }

      Serial.print("[TX]      TRANSMITTED - HTTP ");
      Serial.println(h.status);

      bool success = h.body.indexOf("\"success\":true") >= 0;
      String result = jsonStr(h.body, "result");
      String detail = jsonStr(h.body, "detail");
      String code = jsonStr(h.body, "code");
      String message = jsonStr(h.body, "message");

      if (h.status == 201 && success && result == "accepted") {
        Serial.print("[BACKEND] ACCEPTED - result=accepted  ");
        Serial.print(jsonStr(h.body, "fromStage")); Serial.print(" -> "); Serial.println(jsonStr(h.body, "toStage"));
        Serial.println("[DB]      SAVED - scan logged in scan_logs AND product moved to the new stage.");
        return OUT_SAVED_MOVED;
      }
      if (h.status == 200 && success && result == "duplicate") {
        Serial.println("[BACKEND] ACCEPTED - result=duplicate (product is already at this stage).");
        Serial.println("[DB]      SAVED - scan logged in scan_logs; product unchanged (harmless repeat).");
        return OUT_SAVED_DUPLICATE;
      }
      if ((h.status == 404 || h.status == 422) && code == "SCAN_REJECTED") {
        Serial.print("[BACKEND] PROCESSED but REJECTED by business rule: ");
        Serial.println(result);
        Serial.print("          reason: "); Serial.println(message.length() ? message : detail);
        Serial.println("[DB]      Attempt LOGGED in scan_logs (result above). Product NOT moved.");
        return OUT_SAVED_REJECTED;
      }
      if (h.status == 401) {
        Serial.print("[BACKEND] REFUSED - "); Serial.println(message);
        Serial.println("          The device key for this reader is wrong or not provisioned. Re-run tools/provision_reader_keys.mjs");
        Serial.println("          and re-flash. This scan will NOT be retried.");
        Serial.println("[DB]      NOT SAVED.");
        return OUT_DROP_BAD_KEY;
      }
      if (h.status == 429) {
        Serial.println("[BACKEND] RATE LIMITED (HTTP 429) - will retry.");
        Serial.println("[DB]      NOT SAVED yet.");
        return OUT_RETRY;
      }
      if (h.status >= 500) {
        Serial.print("[BACKEND] SERVER ERROR "); Serial.print(h.status); Serial.print(" "); Serial.println(message);
        Serial.println("[DB]      NOT CONFIRMED - the backend did not confirm a save (will retry; a retry that finds the scan");
        Serial.println("          already stored is reported by the backend as 'duplicate').");
        return OUT_RETRY;
      }
      if (h.status >= 400) {
        Serial.print("[BACKEND] REJECTED REQUEST ("); Serial.print(code); Serial.print("): "); Serial.println(message);
        Serial.println("[DB]      NOT SAVED. This scan will NOT be retried.");
        return OUT_DROP_BAD_REQUEST;
      }
      Serial.println("[BACKEND] UNEXPECTED RESPONSE (not the documented format):");
      Serial.println(h.body.substring(0, 200));
      Serial.println("[DB]      NOT CONFIRMED - will retry.");
      return OUT_RETRY;
    }

    // Sends at most ONE queued scan per call (keeps the readers responsive). force=true ignores the backoff timer.
    void serviceQueue(bool force) {
      if (qCount == 0) return;
      PendingScan& p = queue[qHead];
      if (!force && millis() < p.nextTryMs) return;

      if (WiFi.status() != WL_CONNECTED) {
        if (lastWaitMsgMs == 0 || millis() - lastWaitMsgMs > 10000) {
          lastWaitMsgMs = millis() | 1;   // never 0, so the first notice of every outage prints at once
          Serial.print("[TX]      Waiting for Wi-Fi. Scans queued (not sent, not saved): ");
          Serial.println(qCount);
        }
        return;
      }
      if (keyIsPlaceholder(p.reader)) {
        Serial.print("[TX]      NOT SENT - "); Serial.print(READER_DEFS[p.reader].code);
        Serial.println(" has no device key. Scan DISCARDED. [DB] NOT SAVED.");
        popQueue();
        return;
      }

      p.attempts++;
      Serial.print("[TX]      Sending "); Serial.print(READER_DEFS[p.reader].code); Serial.print(" / "); Serial.print(p.uid);
      Serial.print(" (attempt "); Serial.print(p.attempts); Serial.println(")");

      lastWaitMsgMs = 0;
      HttpResult h = postScan(p);
      Outcome o = interpret(p, h);

      if (o != OUT_RETRY) {
        Serial.println("========================================");
        popQueue();
        return;
      }

      if (p.attempts >= MAX_SEND_ATTEMPTS) {
        Serial.print("[LOST]    Giving up on "); Serial.print(p.uid);
        Serial.println(" after too many attempts. THIS SCAN WAS NOT SAVED.");
        Serial.println("========================================");
        popQueue();
        return;
      }
      unsigned long wait = 2000UL << (p.attempts > 4 ? 4 : p.attempts - 1);   // 2,4,8,16,32s
      if (wait > 30000UL) wait = 30000UL;
      if (h.retryAfterSec > 0 && (unsigned long)h.retryAfterSec * 1000UL > wait) wait = (unsigned long)h.retryAfterSec * 1000UL;
      p.nextTryMs = millis() + wait;
      Serial.print("[TX]      Will retry in "); Serial.print(wait / 1000); Serial.print("s. Scans waiting: "); Serial.println(qCount);
    }

    // ======================================
    // PROCESS INDIVIDUAL RFID READER
    // ======================================

    void processSingleReader(int i) {

      selectReader(i);

      if (mfrc522[i]->PICC_IsNewCardPresent() &&
          mfrc522[i]->PICC_ReadCardSerial()) {

        String uid = getUID(i);

        mfrc522[i]->PICC_HaltA();
        mfrc522[i]->PCD_StopCrypto1();
        deselectReader(i);

        handleTag(i, uid);
        return;
      }

      deselectReader(i);
    }

    void handleTag(int i, const String& uid) {
      if (!uidValidForBackend(uid)) {
        Serial.print("[READER] #"); Serial.print(i + 1);
        Serial.print(" read an unusable tag UID \""); Serial.print(uid);
        Serial.println("\" (backend needs 8-20 hex characters). Ignored - NOT sent, NOT saved.");
        return;
      }
      if (uid == lastUid[i] && millis() - lastUidMs[i] < REPEAT_IGNORE_MS) {
        lastUidMs[i] = millis();
        Serial.print("[READER] #"); Serial.print(i + 1); Serial.print(" same tag "); Serial.print(uid);
        Serial.println(" re-read within the repeat window - ignored.");
        return;
      }
      lastUid[i] = uid;
      lastUidMs[i] = millis();

      totalScans[i]++;
      time_t epoch = clockValid() ? time(nullptr) : 0;
      printScanDetected(i, uid, epoch);

      if (!enqueue(i, uid, epoch)) {
        Serial.println("[QUEUE]   FULL - this scan could NOT be stored. [DB] NOT SAVED. Check Wi-Fi/backend.");
        Serial.println("========================================");
        return;
      }
      serviceQueue(true);
    }

  public:

    static SupplyEaseSystem* getInstance() {
      if (instance == nullptr) instance = new SupplyEaseSystem();
      return instance;
    }

    void initializeSystem() override {

      Serial.begin(115200);
      delay(1000);

      Serial.println();
      Serial.println("Starting TexTracer RFID Hardware -> Backend Integration...");
      Serial.print("Backend: "); Serial.println(baseUrl());
      Serial.println();

      initializeRFIDReaders();
      connectWifiAtBoot();
      checkBackendAtBoot();

      lastReaderCheckMs = millis();
      Serial.println();
      Serial.println("System running. Present a tag to any reader.");
    }

    void runSystem() override {
      maintainWifi();
      for (int i = 0; i < readers; i++) {
        if (readerOk[i]) processSingleReader(i);
      }
      serviceQueue(false);
      maintainReaders();
    }
};

SupplyEaseSystem* SupplyEaseSystem::instance = nullptr;

// ==========================================
// ARDUINO ENTRY POINTS
// ==========================================

void setup() {
  SupplyEaseSystem::getInstance()->initializeSystem();
}

void loop() {
  SupplyEaseSystem::getInstance()->runSystem();
}
