import { createHash } from "node:crypto";
import { createRpcClient, MultichainRpcError, type MultichainConfig, type RpcClient } from "./multichain.client";

/** What is written (as hex-encoded JSON) into the MultiChain stream for every anchored gate decision. */
export interface AnchorPayload {
  schema: "texchain.anchor.v1";
  anchorId: number;
  inspectionId: number;
  productUid: string; // also the stream key -> a product's whole trail is one liststreamkeyitems call
  chain: string;
  /** sha256 (hex) of metadataText == chain_anchors.metadata_hash in the database */
  metadataHash: string;
  /** Exact text of the database's jsonb value that was hashed (so the hash can be re-checked byte for byte). */
  metadataText: string;
  metadata: unknown;
  publishedAt: string;
}

export interface ChainItem {
  txid: string;
  confirmations: number;
  blocktime: number | null;
  payload: AnchorPayload | null;
}

export type OnChainState = "verified" | "mismatch" | "not_found" | "pending_confirmation" | "unavailable";

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const toHex = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("hex");
export function fromHex(hex: unknown): AnchorPayload | null {
  if (typeof hex !== "string") return null; // offchain / json-format items are not produced by this app
  try {
    const parsed = JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as AnchorPayload) : null;
  } catch {
    return null;
  }
}

export interface MultichainService {
  readonly enabled: boolean;
  readonly config: MultichainConfig;
  /** Connectivity + node/stream details, never throws. */
  status(): Promise<{ reachable: boolean; chainName: string; stream: string; streamExists: boolean | null; blocks: number | null; nodeVersion: string | null; error?: string }>;
  ping(): Promise<boolean>;
  /** Creates + subscribes the stream if missing (when autoCreateStream). Throws if it cannot be made usable. */
  ensureStream(): Promise<void>;
  publish(payload: AnchorPayload): Promise<string>;
  getItem(txid: string): Promise<ChainItem | null>;
  /** Block height of the block that contains txid (null while unconfirmed / unknown). */
  blockHeight(txid: string): Promise<number | null>;
  /** Compare an on-chain item against what the database holds for the same anchor. */
  compare(item: ChainItem | null, db: { metadataHash: string; metadataText: string; productUid: string }): { state: OnChainState; reasons: string[] };
}

export function createMultichainService(config: MultichainConfig, rpc: RpcClient = createRpcClient(config)): MultichainService {
  const stream = config.streamName;
  return {
    enabled: config.enabled,
    config,

    async ping() {
      try {
        await rpc.call("getinfo");
        return true;
      } catch {
        return false;
      }
    },

    async status() {
      const base = { chainName: config.chainName, stream };
      try {
        const info = await rpc.call<{ version?: string; blocks?: number }>("getinfo");
        let streamExists: boolean | null = null;
        try {
          const list = await rpc.call<unknown[]>("liststreams", [stream]);
          streamExists = Array.isArray(list) && list.length > 0;
        } catch {
          streamExists = false; // MultiChain errors when the stream does not exist
        }
        return { reachable: true, ...base, streamExists, blocks: info.blocks ?? null, nodeVersion: info.version ?? null };
      } catch (err) {
        return { reachable: false, ...base, streamExists: null, blocks: null, nodeVersion: null, error: (err as Error).message };
      }
    },

    async ensureStream() {
      let exists = false;
      try {
        const list = await rpc.call<unknown[]>("liststreams", [stream]);
        exists = Array.isArray(list) && list.length > 0;
      } catch {
        exists = false;
      }
      if (!exists) {
        if (!config.autoCreateStream) throw new MultichainRpcError(`Stream "${stream}" does not exist (create it with: create stream ${stream} true, or set MULTICHAIN_AUTO_CREATE_STREAM=true)`);
        await rpc.call("create", ["stream", stream, true]);
      }
      try {
        await rpc.call("subscribe", [stream]); // needed before liststream* calls work on this node; harmless if already subscribed
      } catch {
        /* already subscribed */
      }
    },

    async publish(payload) {
      // publish <stream> <key> <data-hex>   (same call shape as the original module: key = product UID)
      return rpc.call<string>("publish", [stream, payload.productUid, toHex(payload)]);
    },

    async getItem(txid) {
      try {
        const it = await rpc.call<{ txid: string; confirmations?: number; blocktime?: number; data?: unknown }>("getstreamitem", [stream, txid, true]);
        if (!it) return null;
        return { txid: it.txid, confirmations: it.confirmations ?? 0, blocktime: it.blocktime ?? null, payload: fromHex(it.data) };
      } catch (err) {
        if (err instanceof MultichainRpcError && err.rpcCode !== undefined) return null; // RPC says: no such item
        throw err; // node unreachable / bad credentials: caller decides, we must not claim "not found"
      }
    },

    async blockHeight(txid) {
      try {
        const tx = await rpc.call<{ blockhash?: string }>("getrawtransaction", [txid, 1]);
        if (!tx?.blockhash) return null;
        const block = await rpc.call<{ height?: number }>("getblock", [tx.blockhash]);
        return typeof block?.height === "number" ? block.height : null;
      } catch {
        return null;
      }
    },

    compare(item, db) {
      if (!item) return { state: "not_found", reasons: ["Transaction was not found in the blockchain stream"] };
      const reasons: string[] = [];
      const p = item.payload;
      if (!p) reasons.push("On-chain data could not be decoded");
      else {
        if (p.metadataHash !== db.metadataHash) reasons.push("On-chain metadata hash differs from the database record");
        if (sha256Hex(p.metadataText ?? "") !== p.metadataHash) reasons.push("On-chain payload does not hash to its own metadata hash");
        if (p.productUid !== db.productUid) reasons.push("On-chain product UID differs from the database record");
        if (typeof p.metadataText === "string" && p.metadataText !== db.metadataText) reasons.push("On-chain metadata text differs from the database record");
      }
      if (reasons.length) return { state: "mismatch", reasons };
      if (item.confirmations < config.minConfirmations) return { state: "pending_confirmation", reasons: [] };
      return { state: "verified", reasons: [] };
    },
  };
}
