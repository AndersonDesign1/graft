/**
 * The framework-agnostic read client over content_index.
 *
 * Fully typed with zero codegen: the client is generic over its collections
 * record, so `client.getDocument("pages", "home")` returns the exact document
 * shape inferred from defineCollection. Reads are branch-aware, exclude
 * soft-deleted rows, and re-validate `data` through the collection's Zod
 * schema — the one-Zod-layer guarantee that the derived index still matches
 * the schema (a mismatch means the index is stale, and the error says so).
 *
 * The cache/invalidation contract (subscribe, revalidateTag) lands in Phase 4.
 */
import { GraftError } from "@graft/contracts";
import type { AnyCollection, DocumentData } from "@graft/core";
import { and, asc, contentIndex, eq, type ContentRow, type Database } from "@graft/db";

export interface ClientOptions<TCollections extends Record<string, AnyCollection>> {
  db: Database;
  collections: TCollections;
  /** Default branch for all reads; per-call `branch` overrides. Defaults to "main". */
  branch?: string;
}

export interface ReadOptions {
  branch?: string;
}

export interface ListOptions extends ReadOptions {
  limit?: number;
  offset?: number;
}

/** A document as served to the frontend: typed data + the authored body. */
export interface Document<TCollection extends AnyCollection = AnyCollection> {
  collection: string;
  slug: string;
  data: DocumentData<TCollection>;
  body: string;
  sourcePath: string;
  updatedAt: Date;
}

export interface GraftClient<TCollections extends Record<string, AnyCollection>> {
  getDocument<K extends keyof TCollections & string>(
    collection: K,
    slug: string,
    options?: ReadOptions,
  ): Promise<Document<TCollections[K]> | null>;
  listDocuments<K extends keyof TCollections & string>(
    collection: K,
    options?: ListOptions,
  ): Promise<Document<TCollections[K]>[]>;
  readonly collections: TCollections;
  readonly branch: string;
}

export function createClient<TCollections extends Record<string, AnyCollection>>(
  options: ClientOptions<TCollections>,
): GraftClient<TCollections> {
  const defaultBranch = options.branch ?? "main";

  function resolve<K extends keyof TCollections & string>(name: K): TCollections[K] {
    const collection = options.collections[name];
    if (!collection) {
      throw new GraftError({
        code: "COLLECTION_NOT_FOUND",
        message: `Collection "${name}" is not registered on this client`,
        fix: `Pass it in createClient({ collections: { ${name}: … } }). Registered: ${Object.keys(options.collections).join(", ") || "(none)"}.`,
        details: { collection: name, registered: Object.keys(options.collections) },
      });
    }
    return collection;
  }

  return {
    collections: options.collections,
    branch: defaultBranch,

    async getDocument(collection, slug, opts) {
      const def = resolve(collection);
      const rows = await options.db
        .select()
        .from(contentIndex)
        .where(
          and(
            eq(contentIndex.branchId, opts?.branch ?? defaultBranch),
            eq(contentIndex.collection, def.name),
            eq(contentIndex.slug, slug),
            eq(contentIndex.deleted, false),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? toDocument(def, row) : null;
    },

    async listDocuments(collection, opts) {
      const def = resolve(collection);
      let query = options.db
        .select()
        .from(contentIndex)
        .where(
          and(
            eq(contentIndex.branchId, opts?.branch ?? defaultBranch),
            eq(contentIndex.collection, def.name),
            eq(contentIndex.deleted, false),
          ),
        )
        .orderBy(asc(contentIndex.slug))
        .$dynamic();
      if (opts?.limit !== undefined) query = query.limit(opts.limit);
      if (opts?.offset !== undefined) query = query.offset(opts.offset);
      const rows = await query;
      return rows.map((row) => toDocument(def, row));
    },
  };
}

/**
 * Shape an index row into a served document, re-validating data against the
 * collection schema. Exported for unit tests; pure of the database.
 */
export function toDocument<TCollection extends AnyCollection>(
  collection: TCollection,
  row: ContentRow,
): Document<TCollection> {
  const parsed = collection.schema.safeParse(row.data);
  if (!parsed.success) {
    throw new GraftError({
      code: "SCHEMA_VALIDATION_FAILED",
      message: `Indexed data for ${row.collection}/${row.slug} no longer matches the "${collection.name}" schema`,
      fix: `The content_index is stale relative to the schema (git is authoritative). Re-run compile() to rebuild the index, or revert the schema change.`,
      details: { collection: row.collection, slug: row.slug, issues: parsed.error.issues },
    });
  }
  return {
    collection: row.collection,
    slug: row.slug,
    data: parsed.data as DocumentData<TCollection>,
    body: row.body,
    sourcePath: row.sourcePath,
    updatedAt: row.updatedAt,
  };
}
