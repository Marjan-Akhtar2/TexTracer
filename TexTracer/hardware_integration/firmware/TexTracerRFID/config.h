// ===========================================================================
// TexTracer ESP32 - user settings (edit these three things, nothing else)
// ===========================================================================
#pragma once

// 1) Wi-Fi the ESP32 joins (2.4 GHz only - the ESP32 cannot use 5 GHz).
#define WIFI_SSID      "jiaaaaaa"
#define WIFI_PASSWORD  "jiaaaaaa"

// 2) The laptop that runs the TexTracer backend (`npm run dev`, port 5000).
//    Use the laptop's LAN IPv4 address (Windows: `ipconfig`, Linux/macOS: `ip a` / `ifconfig`),
//    NOT "localhost" - on the ESP32, localhost means the ESP32 itself.
#define BACKEND_HOST   "10.98.190.14"
#define BACKEND_PORT   5000

// 3) Optional tuning (defaults are fine)
#define HTTP_TIMEOUT_MS      5000    // give up on one HTTP request after this long
#define REPEAT_IGNORE_MS     2000    // same tag on same reader within this window = ignored (hand jitter)
#define QUEUE_SIZE           30      // scans kept in RAM while Wi-Fi / backend is down
#define MAX_SEND_ATTEMPTS    40      // per queued scan (backoff 2s..30s) before it is reported as LOST
#define READER_RECHECK_MS    30000   // how often reader chips are health-checked / re-initialised
