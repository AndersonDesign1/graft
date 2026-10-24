import { describe, expect, it } from "vitest";
import { closest, editDistance } from "./suggest";

describe("editDistance", () => {
  it.each([
    ["compile", "compile", 0],
    ["complie", "compile", 1],
    ["comple", "compile", 1],
    ["xompile", "compile", 1],
    ["branch", "merge", 6],
  ])("%s to %s is %i", (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe("closest", () => {
  const commands = ["compile", "compilations", "content", "check", "create"];

  it("finds the word a typo was meant to be", () => {
    expect(closest("complie", commands)).toBe("compile");
    expect(closest("--jsno", ["--json", "--branch"])).toBe("--json");
  });

  it("finds a word by its start", () => {
    expect(closest("compilat", commands)).toBe("compilations");
  });

  it("suggests nothing when no word is close", () => {
    expect(closest("frobnicate", commands)).toBeUndefined();
    expect(closest("x", [])).toBeUndefined();
  });
});
