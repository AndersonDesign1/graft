/**
 * The migrations ledger — which content/data migrations have been applied to
 * which branch. Content migrations land in git (the files are the history);
 * this ledger exists so runners can skip applied migrations and so `graft
 * merge` (Phase 4) knows what a branch still owes its target. Applying runs
 * hold withMigrationLock, so concurrent runs apply each migration once.
 */
import { GraftError } from "@usegraft/contracts";
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

/** How often the lock's transaction pings while `work` runs. */
export const LOCK_KEEPALIVE_MS = 10_000;

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
 *
 * What it costs and assumes:
 * - Two connections at once: the lock's transaction keeps one, and `work` runs
 *   on others from the same pool. A pool capped at one connection would wait
 *   on itself forever, so it is refused up front. `createDb` pools allow ten.
 * - The lock lasts only as long as its connection. The transaction pings every
 *   LOCK_KEEPALIVE_MS so `idle_in_transaction_session_timeout`, or a pooler's
 *   idle-transaction timeout, does not end it while `work` runs, as long as the
 *   timeout is longer than that. If the lock's connection itself is cut, the
 *   lock goes with it, and the commit at the end fails with the connection
 *   error, so the run reports a failure rather than a clean finish.
 */
export async function withMigrationLock<T>(
  db: Database,
  branchId: string,
  work: () => Promise<T>,
  options: MigrationLockOptions = {},
): Promise<T> {
  // SAFETY: drizzle's postgres-js handle carries the client as `$client` at
  // runtime; `Database` does not declare it, and its absence is handled.
  const max = (db as Partial<{ $client: { options?: { max?: number } } }>).$client?.options?.max;
  if (max !== undefined && max < 2) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `The migration lock needs a pool of at least 2 connections; this one allows ${max}.`,
      fix: "Open the database with createDb (10 connections), or raise the pool's `max` to 2 or more.",
      details: { max },
    });
  }

  const key = sql`hashtextextended(${`graft:migrate:${branchId}`}, 0)`;
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${key}) as locked`,
    );
    if (row?.locked !== true) {
      options.onWait?.();
      await tx.execute(sql`select pg_advisory_xact_lock(${key})`);
    }
    // `work` runs on its own connections; this transaction only holds the lock,
    // and pings so it never looks idle long enough to be ended.
    let ping: Promise<unknown> = Promise.resolve();
    const keepalive = setInterval(() => {
      ping = tx.execute(sql`select 1`).catch(() => undefined);
    }, LOCK_KEEPALIVE_MS);
    try {
      return await work();
    } finally {
      clearInterval(keepalive);
      await ping;
    }
  });
}
