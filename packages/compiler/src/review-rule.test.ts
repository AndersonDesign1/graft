import { describe, expect, it } from "vitest";
import { changedLines, reviewReason } from "./review-rule";

describe("changedLines", () => {
  it("counts added and removed lines", () => {
    expect(changedLines("a\nb\nc", "a\nB\nc")).toBe(2);
    expect(changedLines(null, "a\nb")).toBe(3);
    expect(changedLines("same", "same")).toBe(0);
  });
});

describe("reviewReason", () => {
  it("lets a small edit through under the default rule", () => {
    expect(reviewReason({}, { path: "posts/a.mdx", before: "a", after: "b" })).toBeNull();
  });

  it("reviews deletions by default, and nothing when the rule is off", () => {
    const change = { path: "posts/a.mdx", before: "a", after: null };
    expect(reviewReason({}, change)).toBe("posts/a.mdx is deleted");
    expect(reviewReason({ deletes: false }, change)).toBeNull();
    expect(reviewReason(false, change)).toBeNull();
  });

  it("reviews changes over 200 lines by default", () => {
    const after = Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n");
    expect(reviewReason({}, { path: "posts/a.mdx", before: "", after })).toMatch(/over 200/);
  });
});
