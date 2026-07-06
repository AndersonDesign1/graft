/**
 * Integration: `graft migrate` runs content + data migrations against a live
 * database (opt-in). Run with: RUN_INTEGRATION=1 and DATABASE_URL set
 * (repo-root .env is auto-loaded).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "@graft/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateCommand } from "./commands/migrate";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 60_000;
const BRANCH = "cli-migrate-it";
// Inside the package so the project's @graft/* imports resolve.
const projectDir = resolve(here, "../.test-tmp/migrate-project");

const CONFIG = `
import { defineCollection, field } from "@graft/core";

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
import { defineContentMigration } from "@graft/content-migrations";
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
import { defineDataMigration } from "@graft/core";
import { submissions } from "../graft.config";

export default defineDataMigration({
  collection: submissions,
  description: "Lowercase emails",
  transform: ({ data }) => ({ email: (data.email as string).toLowerCase() }),
});
`;

describe.skipIf(!runIntegration)("graft migrate end to end", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    handle = createDb(process.env.DATABASE_URL as string);
    for (const table of ["content_index", "compilations", "data_records", "migrations_applied"]) {
      await handle.sql.unsafe(`delete from ${table} where branch_id = '${BRANCH}'`);
    }

    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(join(projectDir, "content", "pages"), { recursive: true });
    mkdirSync(join(projectDir, "migrations"), { recursive: true });
    writeFileSync(join(projectDir, "graft.config.ts"), CONFIG);
    writeFileSync(join(projectDir, "content", "pages", "home.mdx"), "---\ntitle: Home\n---\nHi");
    writeFileSync(join(projectDir, "migrations", "0001-pages-description.ts"), CONTENT_MIGRATION);
    writeFileSync(join(projectDir, "migrations", "0002-lowercase-emails.ts"), DATA_MIGRATION);

    await handle.db.insert((await import("@graft/db")).dataRecords).values({
      branchId: BRANCH,
      collection: "submissions",
      data: { email: "ADA@Example.com" },
    });
  }, TEST_TIMEOUT);

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const table of ["content_index", "compilations", "data_records", "migrations_applied"]) {
      await handle.sql.unsafe(`delete from ${table} where branch_id = '${BRANCH}'`);
    }
    await handle.close();
    rmSync(projectDir, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    "dry-run reports both pending migrations and writes nothing",
    async () => {
      const result = await migrateCommand({ cwd: projectDir, branchId: BRANCH });
      expect(result.didApply).toBe(false);
      expect(result.pending.map((p) => p.id)).toEqual([
        "0001-pages-description",
        "0002-lowercase-emails",
      ]);

      expect(readFileSync(join(projectDir, "content", "pages", "home.mdx"), "utf8")).toContain(
        "title: Home",
      );
      const ledger = await handle.sql`
        select * from migrations_applied where branch_id = ${BRANCH}
      `;
      expect(ledger).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "--apply rewrites files, compiles, updates rows, and records the ledger",
    async () => {
      const result = await migrateCommand({ cwd: projectDir, branchId: BRANCH, apply: true });
      expect(result.didApply).toBe(true);
      expect(result.pending).toHaveLength(2);

      // Content: the file gained the backfilled field…
      const home = readFileSync(join(projectDir, "content", "pages", "home.mdx"), "utf8");
      expect(home).toContain("description: About Home");
      // …and the compiled index followed.
      const indexed = await handle.sql`
        select data->>'description' as description from content_index
        where branch_id = ${BRANCH} and slug = 'home'
      `;
      expect(indexed[0]?.description).toBe("About Home");

      // Data: the row was normalized.
      const rows = await handle.sql`
        select data->>'email' as email from data_records where branch_id = ${BRANCH}
      `;
      expect(rows[0]?.email).toBe("ada@example.com");

      // Ledger: both recorded.
      const ledger = await handle.sql`
        select migration_id, kind from migrations_applied
        where branch_id = ${BRANCH} order by migration_id
      `;
      expect(ledger.map((r) => `${r.migration_id}:${r.kind}`)).toEqual([
        "0001-pages-description:content",
        "0002-lowercase-emails:data",
      ]);
    },
    TEST_TIMEOUT,
  );

  it(
    "a rerun finds nothing pending",
    async () => {
      const result = await migrateCommand({ cwd: projectDir, branchId: BRANCH, apply: true });
      expect(result.pending).toEqual([]);
      expect(result.applied).toEqual(["0001-pages-description", "0002-lowercase-emails"]);
    },
    TEST_TIMEOUT,
  );
});
