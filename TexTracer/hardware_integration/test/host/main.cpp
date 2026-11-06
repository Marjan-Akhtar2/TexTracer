// Host driver: runs the REAL firmware (TexTracerRFID.ino) against a scripted reader timeline.
#include "Arduino.h"
#include "sim.h"
#include "WiFi.h"
#include <fstream>
#include <sstream>
#include <vector>
#include <map>
#include <set>
SerialStub Serial;
static auto T0 = std::chrono::steady_clock::now();
unsigned long millis() { return (unsigned long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - T0).count(); }
void delay(unsigned long ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

struct Ev { long at; std::string kind; int pin; std::string arg; bool done = false; };
static std::vector<Ev> evs;
static std::set<int> chipDown;
static bool wifiUp = true;
static long runStart = -1;
static long nowRel() { return runStart < 0 ? -1 : (long)millis() - runStart; }
bool sim_chip_up(int ss) { return !chipDown.count(ss); }
static void applyEvents();
bool sim_wifi_up() { applyEvents(); return wifiUp; }
static void applyEvents() {
  long t = nowRel();
  for (auto& e : evs) if (!e.done && e.kind != "TAG" && t >= e.at) {
    e.done = true;
    if (e.kind == "CHIPDOWN") chipDown.insert(e.pin);
    else if (e.kind == "CHIPUP") chipDown.erase(e.pin);
    else if (e.kind == "WIFI") wifiUp = (e.arg == "1");
  }
}
bool sim_next_tag(int ss, std::string& raw) {
  applyEvents();
  long t = nowRel();
  for (auto& e : evs) if (!e.done && e.kind == "TAG" && e.pin == ss && t >= e.at) {
    e.done = true; raw.clear();
    for (size_t i = 0; i + 1 < e.arg.size(); i += 2) raw += (char)strtol(e.arg.substr(i, 2).c_str(), nullptr, 16);
    return true;
  }
  return false;
}
#include "TexTracerRFID.ino"
int main(int argc, char** argv) {
  if (argc < 2) { fprintf(stderr, "usage: sim <script> \n"); return 1; }
  std::ifstream f(argv[1]); std::string line; long endAt = 20000;
  while (std::getline(f, line)) {
    if (line.empty() || line[0] == '#') continue;
    std::istringstream is(line); Ev e; std::string kind;
    if (line.rfind("END", 0) == 0) { is >> kind >> endAt; continue; }
    is >> e.at >> kind;
    e.kind = kind;
    if (kind == "WIFI") is >> e.arg; else { is >> e.pin; if (kind == "TAG") is >> e.arg; }
    evs.push_back(e);
  }
  setup();
  runStart = (long)millis();
  while (nowRel() < endAt) { loop(); delay(2); }
  printf("\n[SIM] script finished\n");
  return 0;
}
