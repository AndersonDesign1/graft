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
