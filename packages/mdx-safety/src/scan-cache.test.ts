import { describe, expect, it } from "vitest";
import { mdxScanVersion, scanMdx, type MdxScanCache, type MdxScanResult } from "./index";

function memoryCache(): MdxScanCache & { gets: string[]; sets: string[] } {
  const results = new Map<string, MdxScanResult>();
  const gets: string[] = [];
  const sets: string[] = [];
  return {
    gets,
    sets,
    get(body) {
      gets.push(body);
      return results.get(body);
    },
    set(body, result) {
      sets.push(body);
      results.set(body, result);
    },
  };
}

describe("scanMdx", () => {
  it("scans once, then answers from the cache", () => {
    const cache = memoryCache();
    expect(scanMdx("Plain prose.", cache)).toEqual([]);
    expect(scanMdx("Plain prose.", cache)).toEqual([]);
    expect(cache.sets).toEqual(["Plain prose."]);
    expect(cache.gets).toEqual(["Plain prose.", "Plain prose."]);
  });

  it("caches a refusal as a refusal", () => {
    const cache = memoryCache();
    const first = scanMdx("Run {process.exit(1)} now.", cache);
    expect(scanMdx("Run {process.exit(1)} now.", cache)).toEqual(first);
    expect(first).toEqual([{ kind: "expression", line: 1, snippet: "process.exit(1)" }]);
  });

  it("records a body it cannot parse as uncheckable", () => {
    const result = scanMdx("<Open\n\nnever closed {");
    expect(result).toEqual({ uncheckable: "MDX could not be parsed for safety checking" });
  });

  it("scans without a cache", () => {
    expect(scanMdx("<script>alert(1)</script>")).toEqual([
      { kind: "scripting-element", line: 1, snippet: "<script>" },
    ]);
  });
});

describe("mdxScanVersion", () => {
  it("names this package and every parser it runs, with versions", () => {
    const version = mdxScanVersion() ?? "";
    for (const name of [
      "@usegraft/mdx-safety",
      "remark-parse",
      "remark-gfm",
      "remark-mdx",
      "mdast-util-from-markdown",
      "micromark",
      "micromark-extension-gfm",
      "micromark-extension-mdxjs",
    ]) {
      expect(version).toMatch(new RegExp(`(^| )${name.replace("/", "\\/")}@\\d`));
    }
  });
});
