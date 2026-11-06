import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/labels";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Runs `fn` on mount and whenever `deps` change; exposes loading / error / reload.
 * Pass `pollMs` to refresh in the background (used for notifications and live dashboards).
 * Stale responses from an older call are ignored.
 */
export function useApi<T>(fn: () => Promise<T>, deps: readonly unknown[], pollMs?: number): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const id = ++seq.current;
    const run = (silent: boolean) => {
      if (!silent) setLoading(true);
      fnRef.current()
        .then((d) => { if (id === seq.current) { setData(d); setError(null); } })
        .catch((e: unknown) => { if (id === seq.current) setError(errorMessage(e)); })
        .finally(() => { if (id === seq.current && !silent) setLoading(false); });
    };
    run(false);
    const timer = pollMs ? window.setInterval(() => run(true), pollMs) : undefined;
    return () => { seq.current++; if (timer) window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs]);

  return { data, loading, error, reload };
}

/** Debounces a fast-changing value (search boxes) so we do not call the API on every keystroke. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}
