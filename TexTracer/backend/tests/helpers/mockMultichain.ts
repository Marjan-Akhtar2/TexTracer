import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A tiny in-memory stand-in for a MultiChain node's JSON-RPC (just the calls TexTracer uses). */
export interface MockChain {
  port: number;
  state: { down: boolean; height: number; streams: Set<string>; items: Map<string, { stream: string; key: string; data: string; block: number | null }>; calls: string[] };
  mine(): void;
  /** Overwrite the data of an already published item (simulates tampering with a stored payload). */
  tamper(txid: string, hex: string): void;
  close(): Promise<void>;
}

export async function startMockMultichain(user = "multichainrpc", pass = "secret", port = 0): Promise<MockChain> {
  const state: MockChain["state"] = { down: false, height: 100, streams: new Set(), items: new Map(), calls: [] };
  let n = 0;
  const rpcErr = (code: number, message: string) => ({ result: null, error: { code, message } });
  const handle = (method: string, p: any[]) => {
    state.calls.push(method);
    switch (method) {
      case "getinfo": return { result: { version: "2.3.3", blocks: state.height } };
      case "liststreams": return state.streams.has(p[0]) ? { result: [{ name: p[0] }] } : rpcErr(-708, "Stream with this name, txid or reference not found: " + p[0]);
      case "create": state.streams.add(p[1]); return { result: "a".repeat(64) };
      case "subscribe": return { result: null };
      case "publish": {
        if (!state.streams.has(p[0])) return rpcErr(-708, "Stream with this name, txid or reference not found: " + p[0]);
        const txid = (++n).toString(16).padStart(64, "0");
        state.items.set(txid, { stream: p[0], key: p[1], data: p[2], block: null });
        return { result: txid };
      }
      case "getstreamitem": {
        const it = state.items.get(p[1]);
        if (!it || it.stream !== p[0]) return rpcErr(-717, "Item not found in this stream");
        return { result: { txid: p[1], publishers: [], keys: [it.key], data: it.data, confirmations: it.block ? state.height - it.block + 1 : 0, ...(it.block ? { blocktime: 1_700_000_000 } : {}) } };
      }
      case "getrawtransaction": {
        const it = state.items.get(p[0]);
        return it?.block ? { result: { txid: p[0], blockhash: "b".repeat(58) + String(it.block).padStart(6, "0") } } : { result: { txid: p[0] } };
      }
      case "getblock": return { result: { height: Number(String(p[0]).slice(-6)) } };
      default: return rpcErr(-32601, "Method not found");
    }
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (state.down) return req.socket.destroy();
      if (req.headers.authorization !== "Basic " + Buffer.from(`${user}:${pass}`).toString("base64")) { res.writeHead(401); return res.end("Unauthorized"); }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const out = { ...handle(body.method, body.params ?? []), id: body.id };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    state,
    mine() { state.height++; for (const it of state.items.values()) if (it.block === null) it.block = state.height; },
    tamper(txid, hex) { const it = state.items.get(txid); if (it) it.data = hex; },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}
