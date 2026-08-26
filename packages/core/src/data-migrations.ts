/**
 * Data migrations — backfills over db-authoritative collections.
 *
 * The mirror of @usegraft/content-migrations for rows Postgres owns: the
 * transform receives each record's OLD `data` shape (untyped) and returns the
 * NEW shape, validated against the collection's current schema. A run is one
 * transaction — every row transforms and validates before anything is
 * updated, and the ledger row (migrations_applied) commits with the updates,
 * so a migration either fully happened and is recorded, or neither.
 */
import { GraftError } from "@usegraft/contracts";
import { and, asc, dataRecords, eq, migrationsApplied, type Database } from "@usegraft/db";
import type { AnyCollection, DocumentData } from "./collection";
import { canonicalJson } from "./functions-handler";

/**
 * What a migration step runs against: the pool, or a transaction opened on it.
 * Derived from `Database` so the two can never drift apart.
 */
type MigrationDb = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/** What the transform sees per record: the old, pre-migration shape. */
export interface DataMigrationRow {
  id: string;
  /** Stored `data` as written — the OLD shape, so untyped. */
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface DataMigrationOptions<TCollection extends AnyCollection> {
  collection: TCollection;
  /** One line for `graft migrate` listings: what this migration does and why. */
  description: string;
  transform: (
    row: DataMigrationRow,
  ) => DocumentData<TCollection> | Promise<DocumentData<TCollection>>;
}

export interface DataMigration<TCollection extends AnyCollection = AnyCollection> {
  readonly kind: "data";
  readonly collection: TCollection;
  readonly description: string;
  readonly transform: DataMigrationOptions<TCollection>["transform"];
}

export type AnyDataMigration = DataMigration<AnyCollection>;

export function defineDataMigration<TCollection extends AnyCollection>(
  options: DataMigrationOptions<TCollection>,
): DataMigration<TCollection> {
  if (options.collection.authority !== "db-authoritative") {
    throw new GraftError({
      code: "AUTHORITY_MISMATCH",
      message: `Data migrations transform Postgres rows, but collection "${options.collection.name}" is ${options.collection.authority} — its documents are files.`,
      fix: `Use defineContentMigration from "@usegraft/content-migrations" for file-authoritative collections; defineDataMigration is only for collections defined with authority: "db-authoritative".`,
      details: { collection: options.collection.name, authority: options.collection.authority },
    });
  }
  return {
    kind: "data",
    collection: options.collection,
    description: options.description,
    transform: options.transform,
  };
}

export interface RunDataMigrationOptions {
  db: Database;
  migration: AnyDataMigration;
  /** Ledger identity — the migration's file name stem under migrations/. */
  migrationId: string;
  branchId?: string;
  /** Git commit recorded in the ledger; resolvable by the CLI. */
  gitSha?: string | null;
  /** Update the rows and record the ledger entry. Defaults to false — report only. */
  apply?: boolean;
}

export interface DataMigrationReport {
  collection: string;
  rows: number;
  changed: number;
  unchanged: number;
  /** True when the updates + ledger row were committed (apply mode). */
  applied: boolean;
}

export async function runDataMigration(
  options: RunDataMigrationOptions,
): Promise<DataMigrationReport> {
  const { migration } = options;
  const collection = migration.collection;
  const branchId = options.branchId ?? "main";

  const execute = async (tx: MigrationDb): Promise<DataMigrationReport> => {
    const rows = await tx
      .select({
        id: dataRecords.id,
        data: dataRecords.data,
        createdAt: dataRecords.createdAt,
      })
      .from(dataRecords)
      .where(and(eq(dataRecords.branchId, branchId), eq(dataRecords.collection, collection.name)))
      .orderBy(asc(dataRecords.createdAt));

    const failures: { id: string; reason: string }[] = [];
    const updates: { id: string; data: Record<string, unknown> }[] = [];
    let unchanged = 0;

    for (const row of rows) {
      let next: Record<string, unknown>;
      try {
        next = (await migration.transform(row)) as Record<string, unknown>;
      } catch (error) {
        failures.push({
          id: row.id,
          reason: `transform threw: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      const validated = collection.schema.safeParse(next);
      if (!validated.success) {
        const issues = validated.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        failures.push({ id: row.id, reason: `transformed data fails the schema — ${issues}` });
        continue;
      }
      // Persist what the SCHEMA produced, not the raw transform output: Zod
      // defaults, coercions and transforms are part of the new shape, and
      // storing `next` meant migrated rows never actually reached it.
      //
      // Compare canonically too. JSON.stringify is key-order sensitive, and
      // Postgres jsonb normalises key order on write — so a transform that
      // rebuilt an object in authoring order compared unequal to the identical
      // round-tripped row and was rewritten for nothing.
      const validatedData = validated.data as Record<string, unknown>;
      if (canonicalJson(validatedData) === canonicalJson(row.data)) unchanged++;
      else updates.push({ id: row.id, data: validatedData });
    }

    if (failures.length > 0) {
      throw new GraftError({
        code: "MIGRATION_FAILED",
        message: `Data migration "${options.migrationId}" for "${collection.name}" failed on ${failures.length} of ${rows.length} row(s); nothing was updated.`,
        fix: `Fix the transform so every output satisfies the current "${collection.name}" schema, then re-run. Failures: ${failures.map((f) => `${f.id}: ${f.reason}`).join(" | ")}`,
        details: { collection: collection.name, migrationId: options.migrationId, failures },
      });
    }

    if (options.apply) {
      for (const update of updates) {
        await tx
          .update(dataRecords)
          .set({ data: update.data })
          .where(eq(dataRecords.id, update.id));
      }
      await tx.insert(migrationsApplied).values({
        branchId,
        migrationId: options.migrationId,
        kind: "data",
        collection: collection.name,
        docCount: updates.length,
        gitSha: options.gitSha ?? null,
      });
    }

    return {
      collection: collection.name,
      rows: rows.length,
      changed: updates.length,
      unchanged,
      applied: options.apply === true,
    };
  };

  // Dry-run reads outside a transaction; apply commits updates + ledger together.
  return options.apply ? options.db.transaction((tx) => execute(tx)) : execute(options.db);
}
