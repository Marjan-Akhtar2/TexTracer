/**
 * Minimal MultiChain JSON-RPC client (ported from the standalone blockchain module's
 * config/multichain.js, but dependency-free: it uses Node 22's built-in fetch instead of axios).
 */
export interface MultichainConfig {
  /** false -> the whole blockchain layer is switched off; the rest of the app is unaffected. */
  enabled: boolean;
  host: string;
  port: number;
  rpcUser: string;
  rpcPassword: string;
  chainName: string;
  streamName: string;
  /** Value written to chain_anchors.chain_code (must exist, and be active, in the `chains` table). */
  anchorChainCode: string;
  autoCreateStream: boolean;
  workerIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  minConfirmations: number;
  rpcTimeoutMs: number;
}

export class MultichainRpcError extends Error {
  constructor(message: string, public readonly rpcCode?: number) {
    super(message);
    this.name = "MultichainRpcError";
  }
}

export interface RpcClient {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}

type FetchLike = typeof fetch;

export function createRpcClient(cfg: Pick<MultichainConfig, "host" | "port" | "rpcUser" | "rpcPassword" | "chainName" | "rpcTimeoutMs">, fetchImpl: FetchLike = fetch): RpcClient {
  const url = `http://${cfg.host}:${cfg.port}`;
  const auth = "Basic " + Buffer.from(`${cfg.rpcUser}:${cfg.rpcPassword}`).toString("base64");
  let id = 0;
  return {
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({ chain_name: cfg.chainName, version: "1.0", id: ++id, method, params }),
          signal: AbortSignal.timeout(cfg.rpcTimeoutMs),
        });
      } catch (err) {
        throw new MultichainRpcError(`MultiChain node unreachable at ${url} (${(err as Error).message})`);
      }
      const text = await res.text();
      let json: { result?: T; error?: { code?: number; message?: string } | null } | undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        /* non-JSON body (e.g. 401 text) handled below */
      }
      if (res.status === 401) throw new MultichainRpcError("MultiChain RPC rejected the credentials (check MULTICHAIN_RPC_USER / MULTICHAIN_RPC_PASSWORD)");
      if (json?.error) throw new MultichainRpcError(`MultiChain RPC error: ${json.error.message ?? JSON.stringify(json.error)}`, json.error.code);
      if (!res.ok || !json) throw new MultichainRpcError(`MultiChain RPC HTTP ${res.status}`);
      return json.result as T;
    },
  };
}
