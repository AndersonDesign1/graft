import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/**
 * The scheduling behind `useAutosave`, without React, so it can be tested.
 *
 * One save runs at a time. Work marked while a save is in flight is saved
 * right after it, and `settle()` resolves only once nothing is pending or in
 * flight, so "save, then publish" never publishes ahead of a queued save.
 */
export class SaveQueue {
  private pending = false;
  private running: Promise<void> | null = null;

  constructor(
    private readonly save: () => Promise<void>,
    private readonly report: (state: SaveState, error: string | null) => void = () => {},
  ) {}

  /** Whether there is unsaved work. */
  get dirty(): boolean {
    return this.pending;
  }

  /** Record an edit. */
  mark(): void {
    this.pending = true;
    this.report("dirty", null);
  }

  /** Save what is pending, after any save in flight. Rejects with a save's error. */
  async settle(): Promise<void> {
    for (;;) {
      if (this.running) {
        await this.running.catch(() => {});
        continue;
      }
      if (!this.pending) return;
      this.pending = false;
      this.report("saving", null);
      const run = this.save();
      this.running = run;
      try {
        await run;
        this.report(this.pending ? "dirty" : "saved", null);
      } catch (error) {
        this.pending = true; // keep it dirty so the work isn't lost
        this.report("error", error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        this.running = null;
      }
    }
  }
}

/**
 * Debounced autosave.
 *
 * A Save button makes the operator responsible for not losing work, which is
 * the editor's job. Typing marks the document dirty; a pause commits it.
 *
 * Two guarantees worth the extra code:
 *   - a save in flight never races a newer one, and `flush()` waits for both
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
  /** Commit now and wait for every queued save (⌘S, before publish or navigation). */
  flush: () => Promise<void>;
} {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const timer = useRef(0);
  const saveRef = useRef(save);
  saveRef.current = save;
  const queue = useRef<SaveQueue | null>(null);
  queue.current ??= new SaveQueue(
    () => saveRef.current(),
    (next, message) => {
      setState(next);
      setError(message);
    },
  );

  const touch = useCallback(() => {
    if (!enabled) return;
    queue.current?.mark();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void queue.current?.settle().catch(() => {}), delay);
  }, [delay, enabled]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    await queue.current?.settle();
  }, []);

  // Last line of defence: the browser gives us no async window on unload, but
  // warning beats silently discarding.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (queue.current?.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (queue.current?.dirty) void queue.current.settle().catch(() => {});
    },
    [],
  );

  return { state, error, touch, flush };
}
