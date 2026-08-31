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
import { GraftError, type ContentIndexReader, type ContentRow } from "@usegraft/contracts";
import type { AnyCollection, DocumentData } from "@usegraft/core";

export interface ClientOptions<TCollections extends Record<string, AnyCollection>> {
  /**
   * Where reads come from: `await openStaticIndex(path)` for a static project,
   * `createDbIndexReader(db)` for Postgres, `createContentApiReader({endpoint})`
   * for a remote `graft serve`, or any driver implementing the interface.
   *
   * This entry point deliberately does not take a `db` handle. Doing so meant
   * importing `@usegraft/db` for its value, which put `postgres` and
   * `drizzle-orm` into the dependency graph of every consumer — including
   * `@usegraft/sdk-react`, whose entire premise is that a database never
   * reaches the browser. Pass a `db` to `createDbClient` from
   * `@usegraft/sdk-core/db` instead, which is where that edge now lives.
   */
  index: ContentIndexReader;
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

export interface SearchOptions extends ReadOptions {
  /** Max hits, best-ranked first. Defaults to 20. */
  limit?: number;
}

/** A full-text hit: the document plus its rank and a highlighted body snippet. */
export interface SearchHit<
  TCollection extends AnyCollection = AnyCollection,
> extends Document<TCollection> {
  /** ts_rank over the weighted vector: slug (A) > frontmatter (B) > body (C). */
  rank: number;
  /** Body fragment(s) with matches wrapped in <b>…</b>. */
  snippet: string;
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
  /**
   * Full-text search within one collection (websearch syntax: words, "quoted
   * phrases", `or`, -exclusions), best-ranked first. Searches the compiled
   * index — results are as fresh as the last compile.
   */
  searchDocuments<K extends keyof TCollections & string>(
    collection: K,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchHit<TCollections[K]>[]>;
  readonly collections: TCollections;
  readonly branch: string;
}

export function createClient<TCollections extends Record<string, AnyCollection>>(
  options: ClientOptions<TCollections>,
): GraftClient<TCollections> {
  const defaultBranch = options.branch ?? "main";

  const reader = options.index;
  // Types stop a missing `index` at compile time; this catches the runtime
  // shapes they cannot — untyped JavaScript, and a config object that arrived
  // as JSON with the reader dropped.
  if (reader === undefined || reader === null) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "createClient needs an `index` to read from.",
      fix: 'Pass `index`: `await openStaticIndex(".graft/index.db")` for static mode, `createContentApiReader({ endpoint })` for a remote `graft serve`, or use `createDbClient` from "@usegraft/sdk-core/db" to pass a Postgres handle directly.',
    });
  }

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
      const rows = await reader.readContent({
        collection: def.name,
        slug,
        limit: 1,
        branch: opts?.branch ?? defaultBranch,
      });
      const row = rows[0];
      return row ? toDocument(def, row) : null;
    },

    async listDocuments(collection, opts) {
      const def = resolve(collection);
      const rows = await reader.readContent({
        collection: def.name,
        limit: opts?.limit,
        offset: opts?.offset,
        branch: opts?.branch ?? defaultBranch,
      });
      return rows.map((row) => toDocument(def, row));
    },

    async searchDocuments(collection, query, opts) {
      const def = resolve(collection);
      const hits = await reader.searchContent({
        query,
        collections: [def.name],
        limit: opts?.limit,
        branch: opts?.branch ?? defaultBranch,
      });
      return hits.map(({ row, rank, snippet }) => ({
        ...toDocument(def, row),
        rank,
        snippet,
      }));
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
