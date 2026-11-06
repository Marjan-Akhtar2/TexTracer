#!/bin/bash
# Rebuilds the throwaway test DB from the project's own SQL files, starts the real backend, provisions keys, seeds test tags via the API.
H=$(cd "$(dirname "$0")/../../.." && pwd); P="psql -h /tmp -p 5433 -U postgres -q"
(fuser -k 5055/tcp >/dev/null 2>&1 || true); sleep 1
$P -c "drop database if exists textracer_test" -c "create database textracer_test" 2>&1 | grep -v NOTICE
for f in 01_schemas 02_views 03_functions 04_security 05_seed 06_multichain_chain; do $P -d textracer_test -f $H/database/$f.sql 2>&1 | grep -i error; done
"$H/hardware_integration/test/local_env/start_backend.sh" >/dev/null
rm -f $H/hardware_integration/test/host/reader_keys.h
ADMIN_EMAIL=admin@texchain.local ADMIN_PASSWORD='ChangeMe!123' node $H/hardware_integration/tools/provision_reader_keys.mjs --api http://localhost:5055/api --out $H/hardware_integration/test/host/reader_keys.h | tail -3
A=http://localhost:5055/api; J='Content-Type: application/json'
tok(){ curl -s -X POST $A/auth/login -H "$J" -d "{\"email\":\"$1\",\"password\":\"ChangeMe!123\"}" | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).data.token))'; }
id(){ node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);console.log(j.data?j.data.id:"ERR "+d)})'; }
HW="Authorization: Bearer $(tok warehouse@texchain.local)"
POID=$(curl -s -X POST $A/purchase-orders -H "$HW" -H "$J" -d '{"poNumber":"HW-TEST-1","supplierName":"Test Supplier","materialDescription":"Hardware integration test cotton","quantity":100}' | id)
echo "PO id=$POID"
for U in A1B2C3D4 04A1B2C3D4E5F6 DEADBEEF; do
  PID=$(curl -s -X POST $A/products -H "$HW" -H "$J" -d "{\"rfidUid\":\"$U\",\"poId\":$POID,\"receivedQty\":10}" | id)
  echo "registered tag $U -> product $PID"
  curl -s -X POST $A/approvals/$PID/decisions -H "$HW" -H "$J" -d '{"gate":"gate1_intake","decision":"approved"}' | cut -c1-90; echo
done
