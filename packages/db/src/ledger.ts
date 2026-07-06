/**
 * The migrations ledger — which content/data migrations have been applied to
 * which branch. Content migrations land in git (the files are the history);
 * this ledger exists so runners can skip applied migrations and so `graft
 * merge` (Phase 4) knows what a branch still owes its target.
 */
import { asc, eq } from "drizzle-orm";
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
