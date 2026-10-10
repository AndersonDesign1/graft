import { describe, expect, it } from "vitest";
import { SaveQueue } from "./autosave";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SaveQueue", () => {
  it("settles only after a save marked mid-flight has landed", async () => {
    const calls: ReturnType<typeof deferred>[] = [];
    const queue = new SaveQueue(() => {
      const next = deferred();
      calls.push(next);
      return next.promise;
    });

    queue.mark();
    const first = queue.settle();
    queue.mark(); // a keystroke while the first save is in flight
    let settled = false;
    const flushed = queue.settle().then(() => (settled = true));

    calls[0]?.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(2);
    expect(settled).toBe(false);

    calls[1]?.resolve();
    await Promise.all([first, flushed]);
    expect(settled).toBe(true);
    expect(queue.dirty).toBe(false);
  });

  it("rejects and stays dirty when a save fails", async () => {
    const states: string[] = [];
    const queue = new SaveQueue(
      () => Promise.reject(new Error("Fix 1 field to save")),
      (state) => states.push(state),
    );
    queue.mark();
    await expect(queue.settle()).rejects.toThrow("Fix 1 field to save");
    expect(queue.dirty).toBe(true);
    expect(states).toEqual(["dirty", "saving", "error"]);
  });

  it("does nothing when nothing is pending", async () => {
    let saves = 0;
    const queue = new SaveQueue(async () => {
      saves += 1;
    });
    await queue.settle();
    expect(saves).toBe(0);
  });
});
