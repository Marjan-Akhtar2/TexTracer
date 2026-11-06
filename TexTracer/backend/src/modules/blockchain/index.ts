import type { Config } from "../../config/env";
import type { Logger } from "../../core/logger";
import type { Db } from "../../db/pool";
import { createAnchorWorker, type AnchorWorker } from "./anchor.worker";
import { createAnchorsRepo } from "./anchors.repo";
import type { MultichainConfig } from "./multichain.client";
import { createMultichainService, type MultichainService } from "./multichain.service";

export { createBlockchainRouter } from "./blockchain.routes";
export type { MultichainConfig, MultichainService, AnchorWorker };

/** Used when no multichain settings are present (tests, or the blockchain layer not configured yet). */
export const DISABLED_MULTICHAIN: MultichainConfig = {
  enabled: false, host: "127.0.0.1", port: 7758, rpcUser: "multichainrpc", rpcPassword: "", chainName: "chain1",
  streamName: "gate_scans", anchorChainCode: "multichain", autoCreateStream: true, workerIntervalMs: 5000,
  batchSize: 10, maxAttempts: 8, minConfirmations: 1, rpcTimeoutMs: 10000,
};

export const createBlockchain = (config: Config): MultichainService =>
  createMultichainService(config.multichain ?? DISABLED_MULTICHAIN);

/** Starts the outbox worker when the layer is enabled; returns undefined otherwise. */
export function startAnchorWorker(config: Config, db: Db, logger: Logger): AnchorWorker | undefined {
  const chain = createBlockchain(config);
  if (!chain.enabled) return undefined;
  const worker = createAnchorWorker(createAnchorsRepo(db), chain, logger);
  worker.start();
  return worker;
}
