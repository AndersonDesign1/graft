import { describe, expect, it } from "vitest";
import { describeRequest, inputSummary } from "./approvals";

describe("describeRequest", () => {
  it("names what a delete would remove", () => {
    expect(
      describeRequest("delete_content", { collection: "projects", slug: "welup-digital" }),
    ).toBe("Delete projects/welup-digital");
  });

  it("falls back to the function's name", () => {
    expect(describeRequest("archiveOrder", { id: "row-1" })).toBe("Run archiveOrder");
    expect(describeRequest("delete_content", null)).toBe("Run delete_content");
  });
});

describe("inputSummary", () => {
  it("keeps plain values, at most four, and skips nested ones", () => {
    expect(
      inputSummary({
        id: "row-1",
        force: true,
        count: 3,
        nested: { a: 1 },
        list: [1],
        e: "x",
        f: "y",
      }),
    ).toEqual([
      ["id", "row-1"],
      ["force", "true"],
      ["count", "3"],
      ["e", "x"],
    ]);
    expect(inputSummary("not an object")).toEqual([]);
  });
});
