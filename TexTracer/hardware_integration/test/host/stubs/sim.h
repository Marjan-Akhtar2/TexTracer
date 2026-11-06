#pragma once
#include <string>
bool sim_chip_up(int ss);
bool sim_next_tag(int ss, std::string& rawUid);
bool sim_wifi_up();
