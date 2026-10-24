/**
 * The compat apps (compat/next15, compat/next16) are generated
 * by compat/write-apps.mjs and committed. CI's smoke runs whatever is
 * committed, so a pin edited in the generator but never regenerated would be
 * tested at its old version without anyone noticing. This fails instead.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { nextVersionAdvice } from "./next-config";

const generator = resolve(import.meta.dirname, "../compat/write-apps.mjs");
const lockfile = resolve(import.meta.dirname, "../../../pnpm-lock.yaml");

describe("the committed compat apps", () => {
  it("match what compat/write-apps.mjs generates", () => {
    const result = spawnSync(process.execPath, [generator, "--check"], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

// The compat apps and the examples install real Next.js releases. None may
// carry the critical advisories withGraft warns about.
describe("the Next.js releases in the lockfile", () => {
  const versions = [
    ...new Set(
      [
        ...readFileSync(lockfile, "utf8").matchAll(
          /^ {2}next@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)[:(]/gm,
        ),
      ].map((m) => m[1]),
    ),
  ];

  it("are all patched", () => {
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((version) => nextVersionAdvice(version) !== null)).toEqual([]);
  });
});
