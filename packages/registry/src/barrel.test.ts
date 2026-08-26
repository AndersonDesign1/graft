import { describe, expect, it } from "vitest";
import { barrelSource, moduleIdentifier } from "./barrel";

describe("moduleIdentifier", () => {
  it("camelCases kebab basenames", () => {
    expect(moduleIdentifier("scoped-access")).toBe("scopedAccess");
    expect(moduleIdentifier("comments")).toBe("comments");
    expect(moduleIdentifier("a-b-c")).toBe("aBC");
  });

  it("prefixes an underscore when it would start with a digit", () => {
    expect(moduleIdentifier("2fa")).toBe("_2fa");
  });
});

describe("barrelSource", () => {
  it("imports each module and merges them (sorted, deduped)", () => {
    const src = barrelSource(["comments", "scoped-access", "comments"]);
    expect(src).toContain('import { mergePrimitives } from "@usegraft/core";');
    expect(src).toContain('import * as comments from "./comments";');
    expect(src).toContain('import * as scopedAccess from "./scoped-access";');
    expect(src).toContain(
      "export const { collections, functions } = mergePrimitives([comments, scopedAccess]);",
    );
    // Deduped: only one comments import despite the repeat.
    expect(src.match(/from "\.\/comments"/g)).toHaveLength(1);
  });

  it("handles an empty registry", () => {
    expect(barrelSource([])).toContain("mergePrimitives([]);");
  });
});

describe("identifier collisions", () => {
  it("refuses filenames that collapse onto one identifier", () => {
    // `my-mod.ts` and `myMod.ts` both become `myMod`, and the barrel emitted
    // two imports binding the same name — a syntax error in a file marked
    // "do not edit", so the operator had no sanctioned way out.
    expect(() => barrelSource(["my-mod", "myMod"])).toThrowError(/collide/i);
    expect(() => barrelSource(["a_b", "aB"])).toThrowError(/collide/i);
  });

  it("names both offenders so the operator knows what to rename", () => {
    let message = "";
    try {
      barrelSource(["my-mod", "myMod"]);
    } catch (err) {
      message = (err as { message: string }).message;
    }
    expect(message).toContain("my-mod.ts");
    expect(message).toContain("myMod.ts");
  });

  it("leaves distinct identifiers alone", () => {
    expect(() => barrelSource(["comments", "commerce"])).not.toThrow();
  });
});
