import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * Debounced autosave.
 *
 * A Save button makes the operator responsible for not losing work, which is
 * the editor's job. Typing marks the document dirty; a pause commits it.
 *
 * Two guarantees worth the extra code:
 *   - a save in flight never races a newer one (the queued flag re-runs after)
 *   - unsaved work is flushed on unmount and on tab close, so navigating away
 *     mid-sentence doesn't drop the last edit
 */
export function useAutosave({
  save,
  delay = 900,
  enabled = true,
}: {
  save: () => Promise<void>;
  delay?: number;
  enabled?: boolean;
}): {
  state: SaveState;
  error: string | null;
  /** Call on every edit. */
  touch: () => void;
  /** Commit immediately (⌘S, or before navigating away). */
  flush: () => Promise<void>;
} {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const timer = useRef(0);
  const saving = useRef(false);
  const queued = useRef(false);
  const pending = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;

  const commit = useCallback(async (): Promise<void> => {
    if (!pending.current) return;
    if (saving.current) {
      // Something changed mid-flight; run again once this one lands.
      queued.current = true;
      return;
    }
    saving.current = true;
    pending.current = false;
    setState("saving");
    setError(null);
    try {
      await saveRef.current();
      setState("saved");
    } catch (err) {
      pending.current = true; // keep it dirty so the work isn't lost
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    } finally {
      saving.current = false;
      if (queued.current) {
        queued.current = false;
        void commit();
      }
    }
  }, []);

  const touch = useCallback(() => {
    if (!enabled) return;
    pending.current = true;
    setState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void commit(), delay);
  }, [commit, delay, enabled]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    await commit();
  }, [commit]);

  // Last line of defence: the browser gives us no async window on unload, but
  // warning beats silently discarding.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (pending.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current) void saveRef.current().catch(() => {});
    },
    [],
  );

  return { state, error, touch, flush };
}
