#!/bin/bash
mkdir -p "${RUN_DIR:-/tmp/textracer_hwtest}"
S=$(cd "$(dirname "$0")/../../.." && pwd)
[ -f backend.pid ] && kill $(cat backend.pid) 2>/dev/null; sleep 1
cd ${RUN_DIR:-/tmp/textracer_hwtest}
NODE_PATH=/opt/npm-tools/node_modules:$S/hardware_integration/test/shims PORT=5055 DATABASE_URL=postgresql://x@localhost/x JWT_SECRET=test-secret-test-secret-123 MULTICHAIN_ENABLED=false NODE_ENV=development nohup /opt/npm-tools/node_modules/.bin/tsx $S/backend/src/server.ts > backend.log 2>&1 & echo $! > backend.pid
sleep 6; curl -s localhost:5055/api/health; echo
