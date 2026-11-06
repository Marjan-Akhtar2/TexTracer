// TEST-ONLY MFRC522 stand-in driven by a scripted timeline (see run_host_test.sh). No hardware is touched.
#pragma once
#include "Arduino.h"
#include "sim.h"
class MFRC522 {
 public:
  struct Uid { byte size; byte uidByte[10]; byte sak; } uid;
  enum PCD_Register { VersionReg = 0x37 << 1 };
  MFRC522(byte ss, byte) : ss_(ss) {}
  void PCD_Init() {}
  byte PCD_ReadRegister(PCD_Register) { return sim_chip_up(ss_) ? 0x92 : 0x00; }
  bool PICC_IsNewCardPresent() { return sim_next_tag(ss_, cur_); }
  bool PICC_ReadCardSerial() {
    uid.size = cur_.size();
    for (size_t i = 0; i < cur_.size(); i++) uid.uidByte[i] = cur_[i];
    return true;
  }
  void PICC_HaltA() {}
  void PCD_StopCrypto1() {}
 private:
  byte ss_;
  std::string cur_;
};
