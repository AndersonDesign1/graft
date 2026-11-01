import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Every package a runtime file loads at run time, following its relative imports. */
function packagesLoadedBy(file: string, seen = new Set<string>()): Set<string> {
  const packages = new Set<string>();
  if (seen.has(file)) return packages;
  seen.add(file);
  const source = readFileSync(join(here, file), "utf8");
  // Value imports only: `import type` is erased before anything runs.
  for (const [, specifier] of source.matchAll(/^import (?!type )[^;]*?from "([^"]+)";/gms)) {
    if (specifier === undefined) continue;
    if (specifier.startsWith("./")) {
      for (const name of packagesLoadedBy(`${specifier.slice(2)}.ts`, seen)) packages.add(name);
    } else {
      packages.add(specifier);
    }
  }
  return packages;
}

describe("the content API route", () => {
  it("never loads the optional peers only the functions and MCP routes need", () => {
    // A content-only app installs none of these, and Nitro fails the build on
    // an import it cannot resolve.
    const loaded = packagesLoadedBy("content.ts");
    expect(loaded).toContain("@usegraft/content-api");
    for (const peer of ["@usegraft/auth", "@usegraft/core", "@usegraft/mcp"]) {
      expect(loaded).not.toContain(peer);
    }
  });
});
