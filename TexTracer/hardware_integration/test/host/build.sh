#!/bin/bash
# Compiles the REAL firmware sketch for the PC using the stubs in ./stubs. Usage: build.sh [keys.h]
set -e
D=$(cd "$(dirname "$0")" && pwd); B=${BUILD_DIR:-/tmp/textracer_hwbuild}; mkdir -p $B
cp "$D/../../firmware/TexTracerRFID/TexTracerRFID.ino" $B/
cp "$D/config.h" $B/config.h
cp "${1:-$D/reader_keys.h}" $B/reader_keys.h
g++ -std=c++17 -Wall -Wextra -Wno-unused-parameter -I"$D/stubs" -I$B -o $B/sim "$D/main.cpp"
echo "built $B/sim"
