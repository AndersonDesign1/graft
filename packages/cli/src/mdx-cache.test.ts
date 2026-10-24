/**
 * The safety-scan cache graft check and graft compile keep between runs: it
 * saves the parse for a body seen before, and never changes the verdict.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mdxScanVersion } from "@usegraft/mdx-safety";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli";
import { mdxCacheFile, openMdxCache } from "./mdx-cache";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package so the fixture config's `@usegraft/core` import resolves.
const project = resolve(here, "../.test-tmp/mdx-cache");
let cacheHome: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  cacheHome = mkdtempSync(join(tmpdir(), "graft-mdx-cache-"));
  env = { XDG_CACHE_HOME: cacheHome };
  vi.stubEnv("XDG_CACHE_HOME", cacheHome);
  rmSync(project, { recursive: true, force: true });
  cpSync(resolve(here, "../test/fixtures/static-basic"), project, { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(cacheHome, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("openMdxCache", () => {
  it("keeps results between runs, for the bodies the last run used", async () => {
    const first = await openMdxCache("/site/content", env);
    first?.set("Kept.", []);
    first?.set("Dropped.", []);
    first?.save();

    const second = await openMdxCache("/site/content", env);
    expect(second?.get("Kept.")).toEqual([]);
    second?.save();

    const third = await openMdxCache("/site/content", env);
    expect(third?.get("Kept.")).toEqual([]);
    expect(third?.get("Dropped.")).toBeUndefined();
  });

  it("lives under the user's cache directory, one file per content directory", () => {
    const file = mdxCacheFile("/site/content", env);
    expect(file.startsWith(join(cacheHome, "graft", "mdx-safety"))).toBe(true);
    expect(mdxCacheFile("/other/content", env)).not.toBe(file);
  });

  it("drops every entry when the scanner or a parser changes version", async () => {
    const cache = await openMdxCache("/site/content", env);
    cache?.set("Body.", []);
    cache?.save();
    const file = mdxCacheFile("/site/content", env);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.version).toBe(mdxScanVersion());
    writeFileSync(file, JSON.stringify({ ...saved, version: "remark-mdx@0.0.0" }));
    expect((await openMdxCache("/site/content", env))?.get("Body.")).toBeUndefined();
  });

  it("treats a corrupt file, or a malformed entry, as nothing cached", async () => {
    const file = mdxCacheFile("/site/content", env);
    const cache = await openMdxCache("/site/content", env);
    cache?.set("Body.", []);
    cache?.save();
    writeFileSync(file, "{ not json");
    expect((await openMdxCache("/site/content", env))?.get("Body.")).toBeUndefined();
    writeFileSync(
      file,
      JSON.stringify({ version: mdxScanVersion(), results: { x: [{ kind: 1 }], y: "nope" } }),
    );
    const read = await openMdxCache("/site/content", env);
    expect(read?.get("x")).toBeUndefined();
  });
});

describe("graft check with the cache", () => {
  it("still refuses an executable body when its result comes from the cache", async () => {
    writeFileSync(
      join(project, "content/pages/run.mdx"),
      "---\ntitle: Run\n---\n\nRun {process.exit(1)} now.\n",
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await run(["check", "--json"], { cwd: project })).toBe(1);
    const saved = JSON.parse(readFileSync(mdxCacheFile(join(project, "content"), env), "utf8"));
    expect(Object.keys(saved.results)).toHaveLength(2);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await run(["check", "--json"], { cwd: project })).toBe(1);
    const result = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(result.problems[0]).toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
  }, 30_000);
});
