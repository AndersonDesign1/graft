/**
 * Integration: data migration apply loop against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env is auto-loaded).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, dataRecords, listAppliedMigrations, type DbHandle } from "@graft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defineCollection } from "./collection";
import { defineDataMigration, runDataMigration } from "./data-migrations";
import { field } from "./field";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const BRANCH = "core-dm-it";

const submissions = defineCollection({
  name: "submissions",
  authority: "db-authoritative",
  fields: { email: field.string() },
});

const lowercaseEmail = defineDataMigration({
  collection: submissions,
  description: "Normalize emails to lowercase",
  transform: ({ data }) => ({ email: (data.email as string).toLowerCase() }),
});

describe.skipIf(!runIntegration)("data migration apply loop (live)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    await handle.sql`delete from data_records where branch_id = ${BRANCH}`;
    await handle.sql`delete from migrations_applied where branch_id = ${BRANCH}`;
    await handle.db.insert(dataRecords).values([
      { branchId: BRANCH, collection: "submissions", data: { email: "ADA@Example.com" } },
      { branchId: BRANCH, collection: "submissions", data: { email: "grace@lower.case" } },
    ]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await handle.sql`delete from data_records where branch_id = ${BRANCH}`;
    await handle.sql`delete from migrations_applied where branch_id = ${BRANCH}`;
    await handle.close();
  }, TEST_TIMEOUT);

  it(
    "dry-run reports, apply updates rows + writes the ledger atomically",
    async () => {
      const dry = await runDataMigration({
        db: handle.db,
        migration: lowercaseEmail,
        migrationId: "0002-lowercase",
        branchId: BRANCH,
      });
      expect(dry).toMatchObject({ rows: 2, changed: 1, unchanged: 1, applied: false });
      expect(await listAppliedMigrations(handle.db, BRANCH)).toHaveLength(0);

      const applied = await runDataMigration({
        db: handle.db,
        migration: lowercaseEmail,
        migrationId: "0002-lowercase",
        branchId: BRANCH,
        gitSha: "it-sha",
        apply: true,
      });
      expect(applied).toMatchObject({ changed: 1, applied: true });

      const rows = await handle.sql`
        select data->>'email' as email from data_records
        where branch_id = ${BRANCH} order by data->>'email'
      `;
      expect(rows.map((r) => r.email)).toEqual(["ada@example.com", "grace@lower.case"]);

      const ledger = await listAppliedMigrations(handle.db, BRANCH);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({
        migrationId: "0002-lowercase",
        kind: "data",
        collection: "submissions",
        docCount: 1,
        gitSha: "it-sha",
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "a second apply of the same id loses the ledger unique race",
    async () => {
      const error = await runDataMigration({
        db: handle.db,
        migration: lowercaseEmail,
        migrationId: "0002-lowercase",
        branchId: BRANCH,
        apply: true,
      }).catch((e) => e);
      // Drizzle wraps the driver error; unique_violation is Postgres code 23505.
      const cause = (error as { cause?: { code?: string } }).cause;
      expect(cause?.code).toBe("23505");
    },
    TEST_TIMEOUT,
  );
});
