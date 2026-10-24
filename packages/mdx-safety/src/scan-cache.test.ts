import { describe, expect, it } from "vitest";
import {
  mdxScanPackages,
  mdxScanVersion,
  scanMdx,
  scanVersionOf,
  type MdxScanCache,
  type MdxScanResult,
} from "./index";

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
  it("covers every package the scan runs, down the whole dependency tree", () => {
    const names = (mdxScanPackages() ?? []).map((id) => id.slice(0, id.lastIndexOf("@")));
    expect(names[0]).toBe("@usegraft/mdx-safety");
    expect(names).toEqual(
      expect.arrayContaining([
        "remark-parse",
        "remark-gfm",
        "remark-mdx",
        "micromark",
        "micromark-extension-gfm",
        "micromark-extension-mdxjs",
        // Nested a few levels down, and versioned on their own.
        "micromark-extension-mdx-expression",
        "micromark-extension-mdx-jsx",
        "micromark-extension-mdxjs-esm",
      ]),
    );
    expect(mdxScanVersion()).toBe(scanVersionOf(mdxScanPackages() ?? []));
  });

  it("changes when any package under the scanner changes version, in any order", () => {
    const packages = [
      "@usegraft/mdx-safety@1.0.0",
      "remark-mdx@3.1.1",
      "micromark-extension-mdx-jsx@3.0.2",
    ];
    const nestedBump = [...packages.slice(0, 2), "micromark-extension-mdx-jsx@3.0.3"];
    expect(scanVersionOf(nestedBump)).not.toBe(scanVersionOf(packages));
    expect(scanVersionOf([packages[0] ?? "", ...packages.slice(1).reverse()])).toBe(
      scanVersionOf(packages),
    );
  });
});
