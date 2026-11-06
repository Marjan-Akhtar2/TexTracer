#pragma once
#include "Arduino.h"
struct SPIStub { void begin(int, int, int) {} };
static SPIStub SPI;
