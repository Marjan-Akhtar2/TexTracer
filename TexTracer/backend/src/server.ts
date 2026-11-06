import { networkInterfaces } from "node:os";
import { createApp } from "./app";
import { loadConfig } from "./config/env";
import { createLogger } from "./core/logger";
import { createDb, describeDbTarget, isLocalDbUrl } from "./db/pool";
import { startAnchorWorker } from "./modules/blockchain";

/** IPv4 addresses of this computer on the local network: the value the ESP32 needs as BACKEND_HOST. */
function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  }
  return out;
}

function main() {
  const config = loadConfig();
  if (config.databaseUrl && /\*\*\*|YOUR_|<password>|\[YOUR/i.test(config.databaseUrl)) {
    console.warn("WARNING: the database URL in backend/.env still contains a placeholder (\"***\" / YOUR_...). Put the REAL password there, otherwise NO scan can be saved.");
  }
  if (config.databaseUrl) {
    const where = isLocalDbUrl(config.databaseUrl) ? "LOCAL (this laptop, no internet needed)" : "CLOUD (needs internet)";
    console.log(`Database mode: ${config.dbMode} -> ${where}  target: ${describeDbTarget(config.databaseUrl)}`);
  }
  const db = config.databaseUrl ? createDb(config.databaseUrl) : undefined;
  const server = createApp({ config, db });

  server.listen(config.port, () => {
    console.log(`TexTracer API listening on http://localhost:${config.port}  (${config.nodeEnv})`);
    console.log(`Health check:  http://localhost:${config.port}/api/health`);
    const lan = lanAddresses();
    if (lan.length) {
      console.log("ESP32 readers must use one of these as BACKEND_HOST in firmware config.h (same Wi-Fi network as this laptop):");
      for (const a of lan) console.log(`   BACKEND_HOST "${a}"   BACKEND_PORT ${config.port}   ->  test from a phone: http://${a}:${config.port}/api/health`);
    } else console.warn("No LAN IPv4 address found - connect this laptop to the same Wi-Fi as the ESP32.");
    if (!db) console.warn("WARNING: no database URL is configured - the API starts but database calls will fail (check DB_MODE / DATABASE_URL_LOCAL / DATABASE_URL in backend/.env).");
    else if (db.diagnose) {
      db.diagnose().then((d) => {
        if (d.ok) return console.log("Database: connected");
        console.error(`Database: UNREACHABLE [${d.code}] ${d.message}`);
        console.error(`          Fix: ${d.hint}`);
      });
    } else db.ping().then((okay) => console.log(okay ? "Database: connected" : "Database: UNREACHABLE (check the database URL and password)"));
  });

  // Blockchain layer: publishes queued gate decisions (chain_anchors outbox) to MultiChain in the background.
  const mc = config.multichain;
  let worker: ReturnType<typeof startAnchorWorker>;
  if (db && mc?.enabled) {
    worker = startAnchorWorker(config, db, createLogger(true));
    console.log(`Blockchain:    MultiChain ${mc.host}:${mc.port} chain "${mc.chainName}" stream "${mc.streamName}" (worker running)`);
  } else {
    console.warn(`Blockchain:    DISABLED (${mc?.enabled ? "no database configured" : "set MULTICHAIN_RPC_PASSWORD in backend/.env to enable"}) - gate decisions are queued in chain_anchors but not published`);
  }

  const shutdown = () => {
    worker?.stop();
    server.close(() => (db?.close() ?? Promise.resolve()).finally(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
