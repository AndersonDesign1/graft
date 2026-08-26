/**
 * Schema migrations — the DDL that makes a Postgres database a Graft database.
 *
 * The generated SQL in `drizzle/` ships inside this package (see package.json
 * `files`), so a project installed from npm can create its schema without the
 * monorepo's tooling: `graft db migrate` resolves the folder relative to this
 * module, exactly the way @usegraft/registry resolves its bundled primitives.
 *
 * Distinct from the two migration engines in Phase 3.6: `graft migrate` runs
 * *content and data* migrations (user-authored codemods and backfills, dry-run
 * by default because they transform authored bytes and rows). This is
 * generated, additive schema DDL — idempotent, tracked by Drizzle's own ledger,
 * and the prerequisite for anything working at all, so it applies by default
 * (`--dry-run` lists what is pending). The container entrypoint has always run
 * it unattended for the same reason.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError } from "@usegraft/contracts";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { pgOptions } from "./client";

/**
 * Absolute path to the generated SQL that ships with this package. Path-form
 * (not `new URL(…)`) so bundlers don't try to resolve the data directory as a
 * module — the P6.3 registryRoot() lesson.
 */
export function migrationsFolder(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
}

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Migration identities from the shipped journal, in order. */
export function readJournal(folder = migrationsFolder()): JournalEntry[] {
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new GraftError({
      code: "MIGRATION_FAILED",
      message: `No migration journal found at ${journalPath}.`,
      fix: "Reinstall @usegraft/db — the package ships its generated SQL in drizzle/. If you are working in the Graft monorepo, run `pnpm --filter @usegraft/db db:generate` first.",
      details: { folder },
    });
  }
  try {
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries?: JournalEntry[] };
    return [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
  } catch (error) {
    throw new GraftError({
      code: "MIGRATION_FAILED",
      message: `Migration journal at ${journalPath} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Reinstall @usegraft/db; the journal is generated data that ships with the package and should never be hand-edited.",
      details: { journalPath },
    });
  }
}

export interface MigrationStatus {
  /** Migration tags this database has already applied, in order. */
  applied: string[];
  /** Migration tags that would run next, in order. */
  pending: string[];
}

/**
 * Compare the shipped journal against Drizzle's ledger. A database with no
 * ledger table has applied nothing — the first-run case, not an error.
 */
export async function migrationStatus(
  sql: ReturnType<typeof postgres>,
  folder = migrationsFolder(),
): Promise<MigrationStatus> {
  const entries = readJournal(folder);
  let appliedAt = new Set<number>();
  try {
    const rows = await sql<Array<{ created_at: string | number | null }>>`
      SELECT created_at FROM drizzle.__drizzle_migrations
    `;
    appliedAt = new Set(rows.map((row) => Number(row.created_at)));
  } catch {
    // No ledger table yet (fresh database) — everything is pending.
  }
  const applied: string[] = [];
  const pending: string[] = [];
  for (const entry of entries) {
    (appliedAt.has(entry.when) ? applied : pending).push(entry.tag);
  }
  return { applied, pending };
}

export interface RunMigrationsOptions {
  /** Report what would run without touching the database. */
  dryRun?: boolean;
  /** Override the shipped folder (tests, forks with their own generated SQL). */
  folder?: string;
}

export interface RunMigrationsResult {
  applied: string[];
  /** Still pending after the run — empty unless dryRun. */
  pending: string[];
  dryRun: boolean;
}

/**
 * Bring a database's schema up to date. Opens its own single connection: this
 * is DDL run before the app exists, not a request-path operation.
 */
export async function runMigrations(
  url: string,
  options: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const folder = options.folder ?? migrationsFolder();
  // max: 1 — the migrator must run its statements on one session.
  const sql = postgres(url, { ...pgOptions(url), max: 1 });
  try {
    const before = await migrationStatus(sql, folder);
    if (options.dryRun) {
      return { applied: [], pending: before.pending, dryRun: true };
    }
    if (before.pending.length === 0) {
      return { applied: [], pending: [], dryRun: false };
    }
    try {
      await migrate(drizzle(sql), { migrationsFolder: folder });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GraftError({
        code: "MIGRATION_FAILED",
        message: `Schema migration failed: ${message}`,
        fix: "Check that DATABASE_URL points at a database this credential may create tables in (the operator credential, not a hardened runtime role — `graft harden` deliberately withholds DDL). If a previous run failed part-way, resolve the database state before retrying; every migration is a plain SQL file in @usegraft/db's drizzle/ folder.",
        details: { pending: before.pending },
      });
    }
    return { applied: before.pending, pending: [], dryRun: false };
  } finally {
    await sql.end();
  }
}
