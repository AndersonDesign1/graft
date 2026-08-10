/**
 * The zero-service quickstart gate (L1).
 *
 * The promise static index mode makes: from an empty directory, with no
 * database and no environment, `graft init` → `graft compile` → typed reads
 * work. This test walks exactly that path through the real command entry
 * points, so a regression that reintroduces a service dependency fails CI.
 *
 * DATABASE_URL is deliberately set to an unreachable value rather than unset:
 * the CLI walks parent directories for a .env (this monorepo has one), so
 * poisoning it is the only way to *prove* nothing connected to a database —
 * any connection attempt would fail the run.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError } from "@usegraft/contracts";
import { openStaticIndex } from "@usegraft/db";
import { createClient } from "@usegraft/sdk-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileCommand } from "./commands/compile";
import { initCommand } from "./commands/init";
import { findConfig, loadConfig } from "./config";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package so the scaffolded config's `@usegraft/core` import resolves
// (same constraint as init.test.ts); own subdir so parallel suites don't collide.
const projectDir = resolve(here, "../.test-tmp/quickstart");
const UNREACHABLE = "postgres://quickstart:nope@127.0.0.1:1/none";

let previousDatabaseUrl: string | undefined;

beforeAll(() => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE;
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
});

afterAll(() => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  rmSync(projectDir, { recursive: true, force: true });
});

describe("zero-service quickstart", () => {
  it("init → compile → typed read, with no reachable database", async () => {
    const started = Date.now();

    // 1. Scaffold. The default is static — that is the adoption promise.
    const init = initCommand({ targetDir: projectDir });
    expect(init.driver).toBe("static");

    // 2. Compile through the real command (config discovery, env walk, driver
    //    routing). Succeeding against an unreachable DATABASE_URL is the proof.
    const result = await compileCommand({ cwd: projectDir });
    expect(result.count).toBe(1);
    expect(result.changes.added).toEqual(["pages/home"]);

    // 3. Read it back the way an app does: open the artifact, hand it to the
    //    framework-agnostic client, get a typed document.
    const config = await loadConfig(findConfig(projectDir));
    expect(config.index).toEqual({
      driver: "static",
      path: join(projectDir, ".graft", "index.db"),
    });
    const index = await openStaticIndex((config.index as { path: string }).path);
    try {
      const client = createClient({ index, collections: config.collections });
      const home = await client.getDocument("pages", "home");
      expect(home?.data.title).toBe("Hello, Graft");
      expect(home?.body).toContain("graft compile");

      const list = await client.listDocuments("pages");
      expect(list).toHaveLength(1);

      // Search works with no service too — it is a property of the artifact.
      const hits = await client.searchDocuments("pages", "compile");
      expect(hits[0]?.slug).toBe("home");
      expect(hits[0]?.snippet).toContain("<b>");
    } finally {
      await index.close();
    }

    // Not a benchmark — a smoke bound. The whole path is file I/O; seconds here
    // would mean something started talking to a network service.
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("recompiles incrementally after an edit, still with no database", async () => {
    writeFileSync(
      join(projectDir, "content", "pages", "about.mdx"),
      "---\ntitle: About\n---\n\nA second page.\n",
      "utf8",
    );
    const result = await compileCommand({ cwd: projectDir });
    expect(result.changes.added).toEqual(["pages/about"]);
    expect(result.changes.unchanged).toBe(1);

    const config = await loadConfig(findConfig(projectDir));
    const index = await openStaticIndex((config.index as { path: string }).path);
    try {
      const client = createClient({ index, collections: config.collections });
      expect((await client.listDocuments("pages")).map((d) => d.slug)).toEqual(["about", "home"]);
    } finally {
      await index.close();
    }
  });

  it("asking for a database feature teaches the upgrade instead of failing obscurely", async () => {
    const error = await compileCommand({ cwd: projectDir, branchId: "preview" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GraftError);
    expect((error as GraftError).code).toBe("NEEDS_DATABASE");
    expect((error as GraftError).fix).toContain('index = "postgres"');
  });
});
