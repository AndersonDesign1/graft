import { describe, expect, it } from "vitest";
import { nextRow } from "./row-focus";

describe("nextRow", () => {
  it("moves down with ArrowDown or j, up with ArrowUp or k, and stays in bounds", () => {
    expect(nextRow("ArrowDown", -1, 3)).toBe(0);
    expect(nextRow("j", 0, 3)).toBe(1);
    expect(nextRow("j", 2, 3)).toBe(2);
    expect(nextRow("k", 1, 3)).toBe(0);
    expect(nextRow("ArrowUp", 0, 3)).toBe(0);
    expect(nextRow("k", -1, 3)).toBe(0);
  });

  it("jumps with Home and End, and ignores other keys and empty lists", () => {
    expect(nextRow("End", 0, 5)).toBe(4);
    expect(nextRow("Home", 4, 5)).toBe(0);
    expect(nextRow("x", 0, 5)).toBeNull();
    expect(nextRow("j", -1, 0)).toBeNull();
  });
});
