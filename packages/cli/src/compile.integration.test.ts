/**
 * Integration: `graft init` → `graft compile` projects into a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env is auto-loaded).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { compileCommand } from "./commands/compile";
import { initCommand } from "./commands/init";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
// Each compile loads the config via jiti and opens a fresh connection to the
// live database — well past the default 5s on a cold run.
const TEST_TIMEOUT = 30_000;
const BRANCH = "cli-it";
// Inside the package so the scaffolded config's `@usegraft/core` import resolves.
const projectDir = resolve(here, "../.test-tmp/it-project");

describe.skipIf(!runIntegration)("graft compile projects a scaffolded project", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    handle = createDb(process.env.DATABASE_URL as string);
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(projectDir, { recursive: true });
    initCommand({ targetDir: projectDir });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    vi.restoreAllMocks();
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.close();
    rmSync(projectDir, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    "compiles the scaffold and reports the ChangeSet",
    async () => {
      const result = await compileCommand({ cwd: projectDir, branchId: BRANCH });
      expect(result.count).toBe(1);
      expect(result.changes.added).toEqual(["pages/home"]);

      const rows = await handle.sql`
      select slug from content_index
      where branch_id = ${BRANCH} and collection = 'pages' and deleted = false
    `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.slug).toBe("home");
    },
    TEST_TIMEOUT,
  );

  it(
    "is idempotent on recompile",
    async () => {
      const result = await compileCommand({ cwd: projectDir, branchId: BRANCH });
      expect(result.changes.added).toEqual([]);
      expect(result.changes.changed).toEqual([]);
      expect(result.changes.unchanged).toBe(1);
    },
    TEST_TIMEOUT,
  );

  it(
    "adds and soft-removes documents as files come and go",
    async () => {
      const aboutPath = join(projectDir, "content", "pages", "about.mdx");
      writeFileSync(aboutPath, "---\ntitle: About\n---\n\nAbout page.\n", "utf8");
      const added = await compileCommand({ cwd: projectDir, branchId: BRANCH });
      expect(added.changes.added).toEqual(["pages/about"]);

      rmSync(aboutPath);
      const removed = await compileCommand({ cwd: projectDir, branchId: BRANCH });
      expect(removed.changes.removed).toEqual(["pages/about"]);
    },
    TEST_TIMEOUT,
  );
});
