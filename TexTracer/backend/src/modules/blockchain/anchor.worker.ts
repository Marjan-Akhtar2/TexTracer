import type { Logger } from "../../core/logger";
import type { AnchorsRepo } from "./anchors.repo";
import type { AnchorPayload, MultichainService } from "./multichain.service";
import { sha256Hex } from "./multichain.service";

/** A submitted anchor whose tx cannot be found on the chain for this long is re-queued. */
const LOST_TX_AFTER_SECONDS = 10 * 60;
/** A claimed anchor that never got a tx (crash) is re-queued after this many minutes. */
const STALE_CLAIM_MINUTES = 5;

export interface AnchorWorker {
  start(): void;
  stop(): void;
  /** One full cycle (publish pending, then confirm submitted). Exposed for tests and manual runs. */
  runOnce(): Promise<{ published: number; confirmed: number; failed: number; skipped?: string }>;
}

/**
 * Transactional-outbox worker (NFR-5). record_decision() queues a chain_anchors row in the SAME
 * database transaction as the decision; this worker publishes it to MultiChain afterwards, so a
 * blockchain outage can never block or roll back a gate decision.
 *   pending --claim--> submitted (+tx_hash after publish) --confirmations>=N--> confirmed
 *   any error -> fail_anchor_job(): back to pending with exponential back-off, or 'failed' after maxAttempts
 */
export function createAnchorWorker(repo: AnchorsRepo, chain: MultichainService, logger: Logger): AnchorWorker {
  const cfg = chain.config;
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let stopped = true;
  let streamReady = false;
  let lastProblem = "";

  const problem = (msg: string) => {
    if (msg !== lastProblem) logger.warn(`[blockchain] ${msg}`); // log a repeating problem once, not every tick
    lastProblem = msg;
  };

  async function runOnce() {
    const out: { published: number; confirmed: number; failed: number; skipped?: string } = { published: 0, confirmed: 0, failed: 0 };

    // Do not claim jobs while the node is down: that would burn their retry attempts for nothing.
    if (!(await chain.ping())) {
      out.skipped = "node unreachable";
      problem(`MultiChain node unreachable (${cfg.host}:${cfg.port}); anchors stay queued and will be retried`);
      return out;
    }
    if (!streamReady) {
      try {
        await chain.ensureStream();
        streamReady = true;
        logger.info(`[blockchain] stream "${cfg.streamName}" ready on chain "${cfg.chainName}"`);
      } catch (err) {
        out.skipped = "stream not ready";
        problem(`stream "${cfg.streamName}" is not usable: ${(err as Error).message}`);
        return out;
      }
    }
    lastProblem = "";

    await repo.recoverStale(cfg.anchorChainCode, STALE_CLAIM_MINUTES);

    // ---- 1. publish pending anchors -------------------------------------------------------
    for (const job of await repo.claim(cfg.anchorChainCode, cfg.batchSize)) {
      try {
        if (!job.hashOk || sha256Hex(job.metadataText) !== job.metadataHash) {
          // Never anchor data that no longer matches its own recorded hash.
          throw new Error("metadata no longer matches its stored hash (possible tampering); not published");
        }
        const payload: AnchorPayload = {
          schema: "texchain.anchor.v1",
          anchorId: job.id,
          inspectionId: job.inspectionId,
          productUid: job.productUid,
          chain: cfg.anchorChainCode,
          metadataHash: job.metadataHash,
          metadataText: job.metadataText,
          metadata: JSON.parse(job.metadataText),
          publishedAt: new Date().toISOString(),
        };
        const txid = await chain.publish(payload);
        await repo.markSubmitted(job.id, txid);
        out.published++;
        logger.info(`[blockchain] anchor ${job.id} (inspection ${job.inspectionId}) published: ${txid}`);
      } catch (err) {
        out.failed++;
        logger.warn(`[blockchain] anchor ${job.id} publish failed (attempt ${job.attempts}/${cfg.maxAttempts}): ${(err as Error).message}`);
        await repo.fail(job.id, (err as Error).message, cfg.maxAttempts);
      }
    }

    // ---- 2. confirm submitted anchors -----------------------------------------------------
    for (const a of await repo.awaitingConfirmation(cfg.anchorChainCode, 50)) {
      let item;
      try {
        item = await chain.getItem(a.txHash);
      } catch (err) {
        problem(`could not check confirmations: ${(err as Error).message}`);
        break; // node trouble: try again next tick
      }
      if (item && item.confirmations >= cfg.minConfirmations) {
        await repo.confirm(a.id, a.txHash, await chain.blockHeight(a.txHash), item.confirmations);
        out.confirmed++;
        logger.info(`[blockchain] anchor ${a.id} confirmed (${item.confirmations} confirmation(s))`);
      } else if (!item && a.ageSeconds > LOST_TX_AFTER_SECONDS) {
        await repo.fail(a.id, "transaction not found on the chain; re-queued", cfg.maxAttempts);
        out.failed++;
      }
    }
    return out;
  }

  const loop = async () => {
    if (stopped) return;
    if (!running) {
      running = true;
      try {
        await runOnce();
      } catch (err) {
        problem(`worker cycle failed: ${(err as Error).message}`);
      } finally {
        running = false;
      }
    }
    if (!stopped) {
      timer = setTimeout(loop, cfg.workerIntervalMs);
      timer.unref();
    }
  };

  return {
    runOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      logger.info(`[blockchain] anchor worker started (every ${cfg.workerIntervalMs} ms, chain code "${cfg.anchorChainCode}")`);
      void loop();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
