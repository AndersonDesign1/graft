/**
 * Typed operational data — the write/read path for db-authoritative collections.
 *
 * Rows live in @graft/db's `data_records` (Postgres owns them; the invariant:
 * operational data is accessed only through typed functions). These helpers are
 * what function handlers call: they enforce the collection's authority, validate
 * against its Zod schema (the same one Zod layer collections already carry), and
 * stamp actor + correlationId — the pre-audit-log breadcrumb trail.
 */
import { GraftError } from "@graft/contracts";
import { and, dataRecords, desc, eq } from "@graft/db";
import type { AnyCollection, DocumentData } from "./collection";
import type { FunctionContext } from "./function";

/** What records helpers need from the handler context — pass ctx straight through. */
export type RecordContext = Pick<FunctionContext, "db" | "branch" | "actor" | "correlationId">;

export interface DataRecord<TData> {
  id: string;
  branch: string;
  collection: string;
  data: TData;
  actorKind: string;
  actorId: string | null;
  correlationId: string | null;
  createdAt: Date;
}

export interface ListRecordsOptions {
  /** Newest-first row cap. Defaults to 50. */
  limit?: number;
}

function assertDbAuthoritative(collection: AnyCollection, operation: string): void {
  if (collection.authority !== "db-authoritative") {
    throw new GraftError({
      code: "AUTHORITY_MISMATCH",
      message: `${operation} targets "${collection.name}", but that collection is ${collection.authority} — its documents are files, not database rows.`,
      fix: `Author "${collection.name}" content as MDX (write_content or files + compile). Records helpers are only for collections defined with authority: "db-authoritative".`,
      details: { collection: collection.name, authority: collection.authority },
    });
  }
}

/** Validate + insert one record. Returns the stored row with typed data. */
export async function insertRecord<TCollection extends AnyCollection>(
  ctx: RecordContext,
  collection: TCollection,
  data: DocumentData<TCollection>,
): Promise<DataRecord<DocumentData<TCollection>>> {
  assertDbAuthoritative(collection, "insertRecord");

  const parsed = collection.schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new GraftError({
      code: "SCHEMA_VALIDATION_FAILED",
      message: `Record for "${collection.name}" does not satisfy the collection schema.`,
      fix: "Fix the fields listed in details.issues — describe_schema shows exactly what this collection stores.",
      details: { collection: collection.name, issues },
    });
  }

  const [row] = await ctx.db
    .insert(dataRecords)
    .values({
      branchId: ctx.branch,
      collection: collection.name,
      data: parsed.data as Record<string, unknown>,
      actorKind: ctx.actor.kind,
      actorId: ctx.actor.id ?? null,
      correlationId: ctx.correlationId,
    })
    .returning();
  if (!row) throw new Error("insert returned no row"); // unreachable; satisfies noUncheckedIndexedAccess
  return toRecord<DocumentData<TCollection>>(row, parsed.data as DocumentData<TCollection>);
}

/** List records newest-first, re-validated on read (one Zod layer, both directions). */
export async function listRecords<TCollection extends AnyCollection>(
  ctx: RecordContext,
  collection: TCollection,
  options: ListRecordsOptions = {},
): Promise<DataRecord<DocumentData<TCollection>>[]> {
  assertDbAuthoritative(collection, "listRecords");

  const rows = await ctx.db
    .select()
    .from(dataRecords)
    .where(and(eq(dataRecords.branchId, ctx.branch), eq(dataRecords.collection, collection.name)))
    .orderBy(desc(dataRecords.createdAt))
    .limit(options.limit ?? 50);

  return rows.map((row) => {
    const parsed = collection.schema.safeParse(row.data);
    if (!parsed.success) {
      throw new GraftError({
        code: "SCHEMA_VALIDATION_FAILED",
        message: `Stored record ${row.id} in "${collection.name}" no longer satisfies the collection schema.`,
        fix: "The schema changed after this row was written. Migrate or backfill the stored rows to the new shape (data migrations are a Phase 3 unit), or make the changed fields optional.",
        details: { collection: collection.name, id: row.id },
      });
    }
    return toRecord<DocumentData<TCollection>>(row, parsed.data as DocumentData<TCollection>);
  });
}

function toRecord<TData>(
  row: typeof dataRecords.$inferSelect,
  data: TData,
): DataRecord<TData> {
  return {
    id: row.id,
    branch: row.branchId,
    collection: row.collection,
    data,
    actorKind: row.actorKind,
    actorId: row.actorId,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  };
}
