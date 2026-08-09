/**
 * Integration: `graft merge` folds a branch into a target against a live
 * database (opt-in). Run with: RUN_INTEGRATION=1 and DATABASE_URL set
 * (repo-root .env is auto-loaded).
 *
 * Simulates the real workflow with scratch branches (never the real main):
 * the branch applied two migrations (ledger rows) and created a data record;
 * the working tree is the already-git-merged tree (content rewritten,
 * migrations/ files present). Merge must replay the ledger onto the target
 * (running the data migration for real, recording the content one), move the
 * branch's data_records rows, and recompile the tree into the target.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBranch, createDb, dataRecords, migrationsApplied, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mergeCommand } from "./commands/merge";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
// 120s: three integration suites share the Neon pooler when the whole package
// runs — a merge step that takes ~8s alone can triple under that contention.
const TEST_TIMEOUT = 120_000;
const TARGET = "cli-merge-it-target";
const SRC = "cli-merge-it-preview";
// Inside the package so the project's @usegraft/* imports resolve.
const projectDir = resolve(here, "../.test-tmp/merge-project");

const CONFIG = `
import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: { title: field.string(), description: field.string() },
});

export const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  fields: { email: field.string() },
});

export const collections = { pages, submissions };
`;

const CONTENT_MIGRATION = `
import { defineContentMigration } from "@usegraft/content-migrations";
import { pages } from "../graft.config";

export default defineContentMigration({
  collection: pages,
  description: "Backfill description from the title",
  transform: ({ data }) => ({
    data: { ...(data as { title: string }), description: (data.description as string | undefined) ?? \`About \${data.title}\` },
  }),
});
`;

const DATA_MIGRATION = `
import { defineDataMigration } from "@usegraft/core";
import { submissions } from "../graft.config";

export default defineDataMigration({
  collection: submissions,
  description: "Lowercase emails",
  transform: ({ data }) => ({ email: (data.email as string).toLowerCase() }),
});
`;

describe.skipIf(!runIntegration)("graft merge end to end", () => {
  let handle: DbHandle;

  async function cleanupDb() {
    for (const branch of [SRC, TARGET]) {
      for (const table of ["content_index", "compilations", "data_records", "migrations_applied"]) {
        await handle.sql.unsafe(`delete from ${table} where branch_id = '${branch}'`);
      }
    }
    await handle.sql`delete from branches where name = ${SRC}`;
    await handle.sql`delete from branches where name = ${TARGET}`;
  }

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    handle = createDb(process.env.DATABASE_URL as string);
    await cleanupDb();

    // Topology: TARGET is its own root; SRC forked from it.
    await handle.db
      .insert((await import("@usegraft/db")).branches)
      .values({ name: TARGET, parent: null, backend: "overlay" });
    await createBranch(handle.db, { name: SRC, from: TARGET });

    // The working tree is the already-git-merged state: rewritten content +
    // the branch's migration files.
    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(join(projectDir, "content", "pages"), { recursive: true });
    mkdirSync(join(projectDir, "migrations"), { recursive: true });
    writeFileSync(join(projectDir, "graft.config.ts"), CONFIG);
    writeFileSync(
      join(projectDir, "content", "pages", "home.mdx"),
      "---\ntitle: Home\ndescription: About Home\n---\nHi",
    );
    writeFileSync(join(projectDir, "migrations", "0001-pages-description.ts"), CONTENT_MIGRATION);
    writeFileSync(join(projectDir, "migrations", "0002-lowercase-emails.ts"), DATA_MIGRATION);

    // Branch history: both migrations applied on SRC (ledger rows), and one
    // data record created there post-migration (already lowercase).
    await handle.db.insert(migrationsApplied).values([
      {
        branchId: SRC,
        migrationId: "0001-pages-description",
        kind: "content",
        collection: "pages",
        docCount: 1,
      },
      {
        branchId: SRC,
        migrationId: "0002-lowercase-emails",
        kind: "data",
        collection: "submissions",
        docCount: 1,
      },
    ]);
    await handle.db.insert(dataRecords).values([
      { branchId: SRC, collection: "submissions", data: { email: "bob@example.com" } },
      // The target's pre-existing operational row, still in the old shape —
      // exactly what the ledger replay must transform.
      { branchId: TARGET, collection: "submissions", data: { email: "ADA@Example.com" } },
    ]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupDb();
    await handle.close();
    rmSync(projectDir, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    "rejects an unregistered source branch with BRANCH_NOT_FOUND",
    async () => {
      await expect(
        mergeCommand({ cwd: projectDir, branch: "cli-merge-it-ghost", into: TARGET }),
      ).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND" });
    },
    TEST_TIMEOUT,
  );

  it(
    "dry-run reports the full plan and writes nothing",
    async () => {
      const result = await mergeCommand({ cwd: projectDir, branch: SRC, into: TARGET });
      expect(result.didApply).toBe(false);
      expect(result.replayed).toEqual(["0001-pages-description", "0002-lowercase-emails"]);
      expect(result.dataMoved).toBe(1);

      // Nothing written: target ledger empty, target row untransformed, SRC row in place.
      const ledger = await handle.sql`
        select * from migrations_applied where branch_id = ${TARGET}
      `;
      expect(ledger).toHaveLength(0);
      const rows = await handle.sql`
        select branch_id, data->>'email' as email from data_records
        where collection = 'submissions' and branch_id in (${SRC}, ${TARGET})
      `;
      expect(rows.map((r) => `${r.branch_id}:${r.email}`).sort()).toEqual([
        `${SRC}:bob@example.com`,
        `${TARGET}:ADA@Example.com`,
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    "--apply replays the ledger, moves data rows, and recompiles the target",
    async () => {
      const result = await mergeCommand({
        cwd: projectDir,
        branch: SRC,
        into: TARGET,
        apply: true,
      });
      expect(result.didApply).toBe(true);
      expect(result.replayed).toEqual(["0001-pages-description", "0002-lowercase-emails"]);
      expect(result.dataMoved).toBe(1);
      expect(result.compiled?.added).toContain("pages/home");

      // Ledger replayed onto the target.
      const ledger = await handle.sql`
        select migration_id, kind from migrations_applied
        where branch_id = ${TARGET} order by migration_id
      `;
      expect(ledger.map((r) => `${r.migration_id}:${r.kind}`)).toEqual([
        "0001-pages-description:content",
        "0002-lowercase-emails:data",
      ]);

      // The target's old row was transformed by the replay; the branch's row
      // moved over untouched; the branch owns nothing.
      const rows = await handle.sql`
        select branch_id, data->>'email' as email from data_records
        where collection = 'submissions' and branch_id in (${SRC}, ${TARGET})
        order by data->>'email'
      `;
      expect(rows.map((r) => `${r.branch_id}:${r.email}`)).toEqual([
        `${TARGET}:ada@example.com`,
        `${TARGET}:bob@example.com`,
      ]);

      // The merged tree was projected into the target.
      const indexed = await handle.sql`
        select data->>'description' as description from content_index
        where branch_id = ${TARGET} and slug = 'home' and deleted = false
      `;
      expect(indexed[0]?.description).toBe("About Home");
    },
    TEST_TIMEOUT,
  );

  it(
    "a rerun is a no-op plan (ledger settled, no data to move)",
    async () => {
      const result = await mergeCommand({ cwd: projectDir, branch: SRC, into: TARGET });
      expect(result.replayed).toEqual([]);
      expect(result.dataMoved).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "a ledger id with no migration file fails with MIGRATION_FAILED and a git-merge fix",
    async () => {
      await handle.db.insert(migrationsApplied).values({
        branchId: SRC,
        migrationId: "0003-ghost",
        kind: "data",
        collection: "submissions",
        docCount: 0,
      });
      const err = await mergeCommand({ cwd: projectDir, branch: SRC, into: TARGET }).catch(
        (e) => e,
      );
      expect(err).toMatchObject({ code: "MIGRATION_FAILED" });
      expect((err as { fix: string }).fix).toContain("git-merge the branch first");
    },
    TEST_TIMEOUT,
  );
});
