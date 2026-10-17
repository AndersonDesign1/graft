import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * How many times `value` has changed since it was first non-null. A view that
 * reads on mount and again after every change keys on this, so `value`
 * arriving for the first time is not a change: keyed on `value` itself, a
 * list and the content tree were each fetched twice on opening.
 */
export function useChangesAfterFirst(value: unknown): number {
  const seen = useRef<{ value: unknown; count: number }>({ value: null, count: 0 });
  if (value !== seen.current.value) {
    if (seen.current.value !== null) seen.current.count += 1;
    seen.current.value = value;
  }
  return seen.current.count;
}

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
/** `path: null` skips the request, for a resource only some views need. */
export function useResource<T>(path: string | null, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [activePath, setActivePath] = useState(path);

  // A path that just became non-null is loading from this render on. Set in
  // the effect instead, the first render after the change showed neither a
  // skeleton nor data: loading was still false from the skipped request.
  if (path !== activePath) {
    setActivePath(path);
    if (path !== null) setLoading(true);
  }

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
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
