/**
 * PACKAGE_KNOWLEDGE has to stay in lockstep with what actually ships, the same
 * way ERROR_KNOWLEDGE does with ErrorCodes. A package added without an entry is
 * a package no agent will ever suggest, and nothing else would catch that.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_KNOWLEDGE, allPackages, packageForFramework, type PackageGuide } from "./packages";

const workspace = resolve(import.meta.dirname, "..", "..");

/** Every publishable @usegraft package in packages/. */
function publishedPackages(): string[] {
  const manifests = readdirSync(workspace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(workspace, entry.name, "package.json"))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => JSON.parse(readFileSync(manifest, "utf8")))
    .filter((pkg) => !pkg.private && typeof pkg.name === "string");

  // SAFETY: narrowing-only. The filter above keeps only entries whose `name` is
  // typeof "string", so this states what that check already established.
  return manifests.map((pkg) => pkg.name as string);
}

describe("PACKAGE_KNOWLEDGE", () => {
  it("describes every published package", () => {
    const missing = publishedPackages().filter((name) => !(name in PACKAGE_KNOWLEDGE));
    expect(missing, `add these to PACKAGE_KNOWLEDGE: ${missing.join(", ")}`).toEqual([]);
  });

  it("describes no package that does not ship", () => {
    const published = new Set(publishedPackages());
    const extra = Object.keys(PACKAGE_KNOWLEDGE).filter((name) => !published.has(name));
    expect(extra, `these are described but not published: ${extra.join(", ")}`).toEqual([]);
  });

  it("keys match their own name field", () => {
    for (const [key, guide] of Object.entries<PackageGuide>(PACKAGE_KNOWLEDGE)) {
      expect(guide.name).toBe(key);
    }
  });

  it("gives every framework exactly one adapter", () => {
    // Two packages claiming the same framework would make packageForFramework
    // return whichever came first, which is a coin toss dressed as advice.
    const byFramework = new Map<string, string[]>();
    for (const guide of allPackages()) {
      if (!guide.framework) continue;
      byFramework.set(guide.framework, [...(byFramework.get(guide.framework) ?? []), guide.name]);
    }
    for (const [framework, names] of byFramework) {
      expect(names, `${framework} has more than one adapter`).toHaveLength(1);
    }
  });

  it("answers the question it exists for", () => {
    expect(packageForFramework("next")?.name).toBe("@usegraft/sdk-next");
    expect(packageForFramework("sveltekit")?.name).toBe("@usegraft/sdk-sveltekit");
    expect(packageForFramework("vue")).toBeUndefined();
  });

  it("never points a static project at a Postgres-only package", () => {
    // The tier filter in list_packages is only as good as these values, and
    // telling a static project to install @usegraft/db is advice that cannot work.
    for (const guide of allPackages()) {
      expect(["static", "postgres", "either"]).toContain(guide.tier);
    }
    expect(PACKAGE_KNOWLEDGE["@usegraft/db"]?.tier).toBe("postgres");
    expect(PACKAGE_KNOWLEDGE["@usegraft/studio"]?.tier).toBe("postgres");
  });
});
