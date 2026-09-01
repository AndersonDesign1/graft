/**
 * SvelteKit adapter over @usegraft/sdk-core — the same `getContent` /
 * `listContent` / `searchContent` surface as @usegraft/sdk-next, so a schema
 * types every read identically across frameworks.
 *
 * No request-level memo (sdk-next's React.cache has no SvelteKit
 * equivalent): reads go straight to Postgres from server `load` functions
 * and `+server.ts` endpoints. Server-only by nature (it holds a database
 * handle) — construct it in `$lib/server/` so SvelteKit's server-only
 * enforcement guards it, and never import it into client code.
 *
 * Caching: SvelteKit has no tag-based data cache, so the Phase 4 tag
 * contract maps onto HTTP — stamp `tagsFor(...)` into a CDN surrogate-key
 * header (`Cache-Tag` / `Surrogate-Key`) via `setHeaders` in `load`, and
 * purge `tagsForChanges(branch, changeSet)` from your compile webhook.
 */
import { createDbClient, type DbClientOptions } from "@usegraft/sdk-core/db";
import {
  createClient,
  type AnyCollection,
  type ClientOptions,
  type Document,
  type GraftClient,
  type ListOptions,
  type ReadOptions,
  type SearchHit,
  type SearchOptions,
} from "@usegraft/sdk-core";

export interface Graft<TCollections extends Record<string, AnyCollection>> {
  /** Typed getDocument. */
  getContent<K extends keyof TCollections & string>(
    collection: K,
    slug: string,
    options?: ReadOptions,
  ): Promise<Document<TCollections[K]> | null>;
  /** Typed listDocuments. */
  listContent<K extends keyof TCollections & string>(
    collection: K,
    options?: ListOptions,
  ): Promise<Document<TCollections[K]>[]>;
  /** Typed searchDocuments (full-text, best-ranked first). */
  searchContent<K extends keyof TCollections & string>(
    collection: K,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchHit<TCollections[K]>[]>;
  /** The underlying sdk-core client, for anything the helpers don't cover. */
  client: GraftClient<TCollections>;
}

/**
 * Either an index this adapter reads through, or a Postgres handle it builds
 * the reader for. Two shapes rather than one optional field so that neither can
 * be omitted: `createClient` no longer accepts `db`, because taking it there
 * meant every consumer of `@usegraft/sdk-core` — the browser client included —
 * carried a Postgres driver in its dependency graph.
 */
export type GraftOptions<TCollections extends Record<string, AnyCollection>> =
  | ClientOptions<TCollections>
  | DbClientOptions<TCollections>;

export function createGraft<TCollections extends Record<string, AnyCollection>>(
  options: GraftOptions<TCollections>,
): Graft<TCollections> {
  const client = "db" in options ? createDbClient(options) : createClient(options);
  return {
    client,
    getContent: (collection, slug, opts) => client.getDocument(collection, slug, opts),
    listContent: (collection, opts) => client.listDocuments(collection, opts),
    searchContent: (collection, query, opts) => client.searchDocuments(collection, query, opts),
  };
}
