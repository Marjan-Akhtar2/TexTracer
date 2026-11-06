export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/** Never logs request bodies, tokens or passwords - only method, path, status and timing. */
export function createLogger(enabled: boolean): Logger {
  const stamp = () => new Date().toISOString();
  return {
    info: (m) => enabled && console.log(`${stamp()} INFO  ${m}`),
    warn: (m) => enabled && console.warn(`${stamp()} WARN  ${m}`),
    error: (m, err) => enabled && console.error(`${stamp()} ERROR ${m}`, err instanceof Error ? err.stack : err ?? ""),
  };
}
