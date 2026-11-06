// TEST-ONLY minimal Arduino core stub so the real firmware compiles and runs on a PC.
#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <string>
#include <chrono>
#include <thread>
#include <type_traits>
#include <algorithm>
typedef uint8_t byte;
#define HEX 16
#define DEC 10
#define OUTPUT 1
#define HIGH 1
#define LOW 0

class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& x) : s(x) {}
  String(char c) : s(1, c) {}
  String(int v, int base = DEC) { fmt((long long)v, base); }
  String(unsigned v, int base = DEC) { fmt((long long)v, base); }
  String(long v, int base = DEC) { fmt(v, base); }
  String(unsigned long v, int base = DEC) { fmt((long long)v, base); }
  String(unsigned char v, int base = DEC) { fmt((long long)v, base); }
  unsigned length() const { return s.size(); }
  int indexOf(const String& p) const { auto i = s.find(p.s); return i == std::string::npos ? -1 : (int)i; }
  String substring(unsigned a, unsigned b = 0xFFFFFFFF) const { return String(s.substr(a, b == 0xFFFFFFFF ? std::string::npos : b - a)); }
  int toInt() const { return atoi(s.c_str()); }
  void toUpperCase() { for (auto& c : s) c = toupper(c); }
  char operator[](unsigned i) const { return s[i]; }
  String& operator+=(const String& o) { s += o.s; return *this; }
  String& operator+=(const char* o) { s += o; return *this; }
  String& operator+=(char c) { s += c; return *this; }
  String operator+(const String& o) const { return String(s + o.s); }
  String operator+(const char* o) const { return String(s + o); }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator!=(const String& o) const { return s != o.s; }
  bool operator==(const char* o) const { return s == o; }
  bool operator!=(const char* o) const { return s != o; }
  const char* c_str() const { return s.c_str(); }
 private:
  void fmt(long long v, int base) { char b[40]; snprintf(b, sizeof b, base == 16 ? "%llx" : "%lld", v); s = b; }
};
inline String operator+(const char* a, const String& b) { return String(std::string(a) + b.s); }

struct IPAddressStub { String toString() const { return "10.0.0.42"; } };
typedef IPAddressStub IPAddress;

struct SerialStub {
  void begin(long) {}
  void print(const String& x) { fputs(x.c_str(), stdout); }
  void print(const char* x) { fputs(x, stdout); }
  void print(const IPAddress& x) { fputs(x.toString().c_str(), stdout); }
  template <class T, class = typename std::enable_if<std::is_integral<T>::value>::type> void print(T v, int base = DEC) { fputs(String(v, base).c_str(), stdout); }
  template <class... A> void println(A... a) { print(a...); fputc('\n', stdout); fflush(stdout); }
  void println() { fputc('\n', stdout); fflush(stdout); }
};
extern SerialStub Serial;

unsigned long millis();
void delay(unsigned long ms);
inline void delayMicroseconds(unsigned us) { std::this_thread::sleep_for(std::chrono::microseconds(us)); }
inline void pinMode(int, int) {}
inline void digitalWrite(int, int) {}
inline void configTime(long, int, const char*, const char* = nullptr) {}
