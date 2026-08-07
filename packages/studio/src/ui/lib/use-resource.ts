import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Refetch without clearing `data` — avoids a flash back to the skeleton. */
  refresh: () => void;
}

/**
 * Fetch-on-mount with a manual refresh. `data` is deliberately kept across a
 * refresh so a poll or a post-mutation refetch doesn't blank the pane the
 * operator is reading.
 */
export function useResource<T>(path: string, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);

  return { data, error, loading, refresh };
}
