import { describe, expect, it } from "vitest";
import { lineDiff } from "./line-diff";

describe("lineDiff", () => {
  it("finds a changed line with context and numbers both sides", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "D", "e", "f", "g", "h"].join("\n");
    const diff = lineDiff("x.mdx", before, after);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.lines.map((l) => `${l.kind[0]}${l.text}`)).toEqual([
      "ca",
      "cb",
      "cc",
      "rd",
      "aD",
      "ce",
      "cf",
      "cg",
    ]);
    expect(diff.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, oldLines: 7, newLines: 7 });
    const removedLine = diff.hunks[0]?.lines.find((l) => l.kind === "remove");
    expect(removedLine).toMatchObject({ oldLine: 4 });
    expect(removedLine?.newLine).toBeUndefined();
  });

  it("splits distant edits into separate hunks", () => {
    const base = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const edited = [...base];
    edited[2] = "two";
    edited[25] = "twenty-five";
    const diff = lineDiff("x", base.join("\n"), edited.join("\n"));
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[1]?.oldStart).toBe(23);
  });

  it("treats a new file as all additions and a deletion as all removals", () => {
    expect(lineDiff("x", null, "a\nb\n")).toMatchObject({ added: 2, removed: 0 });
    expect(lineDiff("x", "a\nb\n", null)).toMatchObject({ added: 0, removed: 2 });
    expect(lineDiff("x", "same\n", "same\n").hunks).toEqual([]);
  });

  it("starts an empty side at the line before it, as git does", () => {
    // `@@ -0,0 +1,2 @@` for a new file: there is no old line 1 to start at.
    expect(lineDiff("x", null, "a\nb\n").hunks[0]).toMatchObject({
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
    });
    expect(lineDiff("x", "a\nb\n", null).hunks[0]).toMatchObject({
      oldStart: 1,
      oldLines: 2,
      newStart: 0,
      newLines: 0,
    });
  });

  it("keeps memory flat on a change too large for a minimal diff", () => {
    // Myers keeps a frontier per edit. With the whole frontier copied each
    // step, two 10,000-line files with nothing in common needed gigabytes.
    const before = Array.from({ length: 10_000 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 10_000 }, (_, i) => `new ${i}`).join("\n");
    // Typed-array storage lives outside the JS heap, so count both.
    const used = () => {
      const { heapUsed, arrayBuffers } = process.memoryUsage();
      return heapUsed + arrayBuffers;
    };
    const memoryBefore = used();
    const started = performance.now();
    const diff = lineDiff("x", before, after);
    expect(diff).toMatchObject({ added: 10_000, removed: 10_000, truncated: true });
    expect(used() - memoryBefore).toBeLessThan(200 * 1024 * 1024);
    // The dependable guard: the old trace copied 40,003 entries per edit for
    // 20,000 edits, which takes far longer than this before memory runs out.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("finds a small edit inside a large file cheaply", () => {
    const base = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const edited = [...base];
    edited[10_000] = "changed";
    const diff = lineDiff("x", base.join("\n"), edited.join("\n"));
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.hunks[0]?.oldStart).toBe(9998);
  });

  it("ignores CRLF line endings", () => {
    expect(lineDiff("x", "a\r\nb\r\n", "a\nb\n").hunks).toEqual([]);
  });

  it("caps what it renders on a huge change and says so", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `l${i}`).join("\n");
    const diff = lineDiff("x", null, big);
    expect(diff.added).toBe(2000);
    expect(diff.truncated).toBe(true);
    expect(diff.hunks.flatMap((h) => h.lines)).toHaveLength(600);
  });
});
