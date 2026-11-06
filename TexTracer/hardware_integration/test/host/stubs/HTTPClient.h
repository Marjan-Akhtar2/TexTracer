// TEST-ONLY HTTPClient: performs REAL HTTP requests (through curl) so the firmware talks to the real backend.
#pragma once
#include "Arduino.h"
#include "sim.h"
#include <vector>
#include <fstream>
#include <sstream>
#include <cstdlib>
class HTTPClient {
 public:
  void setTimeout(int ms) { timeoutS_ = std::max(1, ms / 1000); }
  void begin(const String& url) { url_ = url.s; hdr_.clear(); body_.clear(); respHdr_.clear(); }
  void addHeader(const char* k, const char* v) { hdr_.push_back(std::string(k) + ": " + v); }
  void collectHeaders(const char**, int) {}
  int POST(const String& body) { return run("POST", &body.s); }
  int GET() { return run("GET", nullptr); }
  String getString() { return String(body_); }
  String header(const char* name) {
    std::string want = std::string(name) + ":";
    std::istringstream is(respHdr_); std::string line;
    while (std::getline(is, line)) {
      std::string l = line; std::transform(l.begin(), l.end(), l.begin(), ::tolower);
      std::string w = want; std::transform(w.begin(), w.end(), w.begin(), ::tolower);
      if (l.rfind(w, 0) == 0) { std::string v = line.substr(want.size()); while (!v.empty() && (v[0]==' ')) v.erase(0,1); while (!v.empty() && (v.back()=='\r')) v.pop_back(); return String(v); }
    }
    return String("");
  }
  void end() {}
 private:
  int run(const char* method, const std::string* body) {
    if (!sim_wifi_up()) return -1;
    std::string cmd = std::string("curl -s -i -m ") + std::to_string(timeoutS_) + " -X " + method;
    for (auto& h : hdr_) cmd += " -H '" + h + "'";
    if (body) { std::ofstream("/tmp/hw_sim_body.json") << *body; cmd += " --data-binary @/tmp/hw_sim_body.json"; }
    cmd += " '" + url_ + "'";
    FILE* p = popen(cmd.c_str(), "r");
    std::string out; char buf[4096]; size_t n;
    while (p && (n = fread(buf, 1, sizeof buf, p)) > 0) out.append(buf, n);
    if (p) pclose(p);
    if (out.rfind("HTTP/", 0) != 0) return -1;      // connection refused / timeout => negative like HTTPClient
    size_t sp = out.find(' '); int code = atoi(out.c_str() + sp + 1);
    size_t sep = out.find("\r\n\r\n");
    // skip any 100-continue style interim block
    respHdr_ = out.substr(0, sep); body_ = sep == std::string::npos ? "" : out.substr(sep + 4);
    return code;
  }
  std::string url_, body_, respHdr_; std::vector<std::string> hdr_; int timeoutS_ = 5;
};
