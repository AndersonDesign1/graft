/**
 * The migrations ledger — which content/data migrations have been applied to
 * which branch. Content migrations land in git (the files are the history);
 * this ledger exists so runners can skip applied migrations and so `graft
 * merge` (Phase 4) knows what a branch still owes its target. Applying runs
 * hold withMigrationLock, so concurrent runs apply each migration once.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { migrationsApplied, type MigrationAppliedRow, type MigrationKind } from "./schema";

export async function listAppliedMigrations(
  db: Database,
  branchId = "main",
): Promise<MigrationAppliedRow[]> {
  return db
    .select()
    .from(migrationsApplied)
    .where(eq(migrationsApplied.branchId, branchId))
    .orderBy(asc(migrationsApplied.appliedAt));
}

export interface RecordMigrationInput {
  branchId: string;
  migrationId: string;
  kind: MigrationKind;
  collection: string;
  docCount: number;
  gitSha?: string | null;
}

/**
 * Record one applied migration. Callers running inside a transaction pass the
 * tx so the ledger row commits atomically with the migration's writes.
 */
export async function recordAppliedMigration(
  db: Database,
  input: RecordMigrationInput,
): Promise<MigrationAppliedRow> {
  const [row] = await db
    .insert(migrationsApplied)
    .values({ ...input, gitSha: input.gitSha ?? null })
    .returning();
  if (!row) throw new Error("insert returned no row"); // unreachable; satisfies noUncheckedIndexedAccess
  return row;
}

export interface MigrationLockOptions {
  /** Called once if another run holds the lock, before waiting for it. */
  onWait?: () => void;
}

/**
 * Run `work` while holding the branch's migration lock, so two `graft migrate
 * --apply` runs against one database cannot both apply a migration. Read the
 * ledger inside `work`: a run that waited sees what the first one recorded and
 * skips it.
 *
 * The lock is a transaction-scoped advisory lock on a transaction held open
 * for the whole run. Transaction scope (not session scope) is what keeps it
 * correct behind a transaction-mode pooler such as Neon's PgBouncer, which
 * pins a server connection only for the length of a transaction. A crashed run
 * drops its connection, which ends the transaction and frees the lock, so
 * there is no stale claim to clear by hand.
 */
export async function withMigrationLock<T>(
  db: Database,
  branchId: string,
  work: () => Promise<T>,
  options: MigrationLockOptions = {},
): Promise<T> {
  const key = sql`hashtextextended(${`graft:migrate:${branchId}`}, 0)`;
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${key}) as locked`,
    );
    if (row?.locked !== true) {
      options.onWait?.();
      await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
    }
    // `work` runs on its own connections; this transaction only holds the lock.
    return work();
  });
}
