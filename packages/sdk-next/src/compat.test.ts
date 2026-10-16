/**
 * The compat apps (compat/next14, compat/next15, compat/next16) are generated
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

/** The one Next.js 14 release the repo installs: the last one, for the compat app. */
const ACCEPTED_14 = "14.2.35";

describe("the committed compat apps", () => {
  it("match what compat/write-apps.mjs generates", () => {
    const result = spawnSync(process.execPath, [generator, "--check"], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

// Dependency review allows the Next.js 14 advisories by ID (security.yml),
// and most of them affect early 15 and 16 releases too. This keeps that
// allowance from letting one of those in anywhere else in the workspace.
describe("the Next.js releases in the lockfile", () => {
  const versions = [
    ...new Set(
      [...readFileSync(lockfile, "utf8").matchAll(/^ {2}next@(\d+\.\d+\.\d+)/gm)].map((m) => m[1]),
    ),
  ];

  it("include the compat app's 14.2.35", () => {
    expect(versions).toContain(ACCEPTED_14);
  });

  it("are all patched, apart from that one", () => {
    const unpatched = versions.filter(
      (version) => version !== ACCEPTED_14 && nextVersionAdvice(version) !== null,
    );
    expect(unpatched).toEqual([]);
  });
});
