/**
 * Typed operational data — the write/read path for db-authoritative collections.
 *
 * Rows live in @usegraft/db's `data_records` (Postgres owns them; the invariant:
 * operational data is accessed only through typed functions). These helpers are
 * what function handlers call: they enforce the collection's authority, validate
 * against its Zod schema (the same one Zod layer collections already carry), and
 * stamp actor + correlationId — the pre-audit-log breadcrumb trail.
 */
import { GraftError } from "@usegraft/contracts";
import { and, dataRecords, desc, eq, searchData, sql } from "@usegraft/db";
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

/** Hard ceiling on rows any single read may scan. */
export const MAX_RECORD_LIMIT = 500;

export interface ListRecordsOptions {
  /**
   * Newest-first row cap. Defaults to 50, clamped to {@link MAX_RECORD_LIMIT}.
   *
   * Clamped rather than trusted: this value routinely comes from a function
   * input, and an unclamped one reached Postgres directly — so a public query
   * could ask for a billion rows and have every one of them read into memory
   * and re-validated through Zod.
   */
  limit?: number;
  /**
   * Equality filters on `data` fields, applied in SQL.
   *
   * Filtering after the fact is a correctness bug, not just a slow path: the
   * cap applies to the scan, so rows that do not match still consume the
   * window. A public "list approved comments for this page" that filtered in
   * JavaScript could be emptied site-wide by posting enough newer unapproved
   * rows to fill it.
   */
  match?: Record<string, string | number | boolean>;
}

/**
 * A caller-supplied row cap, made safe: positive, integral, and bounded.
 * Nonsense values fall back to the default rather than failing the call, since
 * the cap is a performance hint and not part of the query's meaning.
 */
function safeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_RECORD_LIMIT);
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
    .where(
      and(
        eq(dataRecords.branchId, ctx.branch),
        eq(dataRecords.collection, collection.name),
        // Filter in SQL, not after the cap. Values are parameterised, and the
        // key rides `->>` as a bound argument too, so neither is interpolated.
        ...Object.entries(options.match ?? {}).map(
          ([key, value]) => sql`${dataRecords.data}->>${key} = ${String(value)}`,
        ),
      ),
    )
    .orderBy(desc(dataRecords.createdAt))
    .limit(safeLimit(options.limit));

  return rows.map((row) => parseStoredRow(collection, row));
}

/** Re-validate a stored row on read (one Zod layer, both directions). */
function parseStoredRow<TCollection extends AnyCollection>(
  collection: TCollection,
  row: typeof dataRecords.$inferSelect,
): DataRecord<DocumentData<TCollection>> {
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
}

export interface SearchRecordsOptions {
  /** Max hits, best-ranked first. Defaults to 20. */
  limit?: number;
}

/** A search hit: the typed record plus its full-text rank. */
export interface DataRecordHit<TData> extends DataRecord<TData> {
  rank: number;
}

/**
 * Full-text search over one collection's records (every string value in
 * `data`), best-ranked first. Same authority + validation rules as
 * listRecords — search is a read, so it stays behind the typed-function
 * boundary and re-validates rows on the way out. Query is websearch syntax:
 * words, "quoted phrases", `or`, -exclusions.
 */
export async function searchRecords<TCollection extends AnyCollection>(
  ctx: RecordContext,
  collection: TCollection,
  query: string,
  options: SearchRecordsOptions = {},
): Promise<DataRecordHit<DocumentData<TCollection>>[]> {
  assertDbAuthoritative(collection, "searchRecords");

  const hits = await searchData(ctx.db, {
    query,
    collection: collection.name,
    branchId: ctx.branch,
    limit: options.limit,
  });

  return hits.map(({ row, rank }) => ({ ...parseStoredRow(collection, row), rank }));
}

/**
 * Delete one record by id. Hard delete — Postgres owns operational data, and
 * gone is gone; this is exactly why functions calling it should be marked
 * `destructive: true` (human-gated). Returns the deleted row's raw data.
 */
export async function deleteRecord(
  ctx: RecordContext,
  collection: AnyCollection,
  id: string,
): Promise<{ id: string; data: Record<string, unknown> }> {
  assertDbAuthoritative(collection, "deleteRecord");

  const [row] = await ctx.db
    .delete(dataRecords)
    .where(
      and(
        eq(dataRecords.id, id),
        eq(dataRecords.branchId, ctx.branch),
        eq(dataRecords.collection, collection.name),
      ),
    )
    .returning({ id: dataRecords.id, data: dataRecords.data });
  if (!row) {
    throw new GraftError({
      code: "DOCUMENT_NOT_FOUND",
      message: `No record "${id}" exists in "${collection.name}" on branch "${ctx.branch}".`,
      fix: "List the collection's records to find a valid id — it may already have been deleted.",
      details: { collection: collection.name, id, branch: ctx.branch },
    });
  }
  return row;
}

/**
 * Update one record by id: merge `patch` over the stored data, re-validate the
 * WHOLE document against the collection schema (one Zod layer, both
 * directions), and write it back. Missing id → DOCUMENT_NOT_FOUND. A partial
 * update that would violate the schema → SCHEMA_VALIDATION_FAILED, nothing
 * written. This is the moderation/status-change primitive (approve a comment,
 * advance an order) db-authoritative collections were missing.
 */
export async function updateRecord<TCollection extends AnyCollection>(
  ctx: RecordContext,
  collection: TCollection,
  id: string,
  patch: Partial<DocumentData<TCollection>>,
): Promise<DataRecord<DocumentData<TCollection>>> {
  assertDbAuthoritative(collection, "updateRecord");

  const [existing] = await ctx.db
    .select()
    .from(dataRecords)
    .where(
      and(
        eq(dataRecords.id, id),
        eq(dataRecords.branchId, ctx.branch),
        eq(dataRecords.collection, collection.name),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new GraftError({
      code: "DOCUMENT_NOT_FOUND",
      message: `No record "${id}" exists in "${collection.name}" on branch "${ctx.branch}".`,
      fix: "List the collection's records to find a valid id — it may already have been deleted.",
      details: { collection: collection.name, id, branch: ctx.branch },
    });
  }

  const merged = { ...(existing.data as Record<string, unknown>), ...patch };
  const parsed = collection.schema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new GraftError({
      code: "SCHEMA_VALIDATION_FAILED",
      message: `Updated record ${id} in "${collection.name}" does not satisfy the collection schema.`,
      fix: "Fix the fields listed in details.issues — describe_schema shows exactly what this collection stores.",
      details: { collection: collection.name, id, issues },
    });
  }

  const [row] = await ctx.db
    .update(dataRecords)
    .set({ data: parsed.data as Record<string, unknown> })
    .where(
      and(
        eq(dataRecords.id, id),
        eq(dataRecords.branchId, ctx.branch),
        eq(dataRecords.collection, collection.name),
      ),
    )
    .returning();
  if (!row) throw new Error("update returned no row"); // unreachable; satisfies noUncheckedIndexedAccess
  return toRecord<DocumentData<TCollection>>(row, parsed.data as DocumentData<TCollection>);
}

function toRecord<TData>(row: typeof dataRecords.$inferSelect, data: TData): DataRecord<TData> {
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
