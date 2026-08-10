/**
 * Integration: schema migrations against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 *
 * Safe to run against the dev database: the ledger makes migration application
 * idempotent, so this asserts the "already up to date" path rather than
 * mutating a schema that other suites depend on.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { pgOptions } from "./client";
import { migrationStatus, runMigrations } from "./migrate";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const url = process.env.DATABASE_URL ?? "";

let sql: ReturnType<typeof postgres> | undefined;

afterAll(async () => {
  await sql?.end();
});

describe.runIf(runIntegration)("runMigrations (live)", () => {
  it(
    "reports the dev database as fully migrated",
    async () => {
      sql = postgres(url, { ...pgOptions(url), max: 1 });
      const status = await migrationStatus(sql);
      expect(status.applied.length).toBeGreaterThan(0);
      expect(status.pending).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    "dry-run touches nothing and applying again is a no-op",
    async () => {
      const dry = await runMigrations(url, { dryRun: true });
      expect(dry.dryRun).toBe(true);
      expect(dry.applied).toEqual([]);

      const applied = await runMigrations(url);
      expect(applied.applied).toEqual([]);
      expect(applied.pending).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
