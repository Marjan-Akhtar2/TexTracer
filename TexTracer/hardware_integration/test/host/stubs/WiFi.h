#pragma once
#include "Arduino.h"
#include "sim.h"
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
#define WL_NO_SSID_AVAIL 1
#define WL_CONNECT_FAILED 4
#define WL_CONNECTION_LOST 5
typedef int wl_status_t;
#define WIFI_STA 1
struct WiFiStub {
  void mode(int) {}
  void setAutoReconnect(bool) {}
  void begin(const char*, const char*) {}
  void disconnect() {}
  int status() { return sim_wifi_up() ? WL_CONNECTED : WL_DISCONNECTED; }
  IPAddress localIP() { return IPAddress(); }
};
static WiFiStub WiFi;
