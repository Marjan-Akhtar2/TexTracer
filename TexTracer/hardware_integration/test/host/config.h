// TEST config (host simulation): backend on this machine, Wi-Fi settings unused.
#pragma once
#define WIFI_SSID      "sim"
#define WIFI_PASSWORD  "sim"
#define BACKEND_HOST "127.0.0.1"
#define BACKEND_PORT   5055
#define HTTP_TIMEOUT_MS      3000
#define REPEAT_IGNORE_MS     2000
#define QUEUE_SIZE           30
#define MAX_SEND_ATTEMPTS    40
#define READER_RECHECK_MS    4000
