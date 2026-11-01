/**
 * Nitro adapter over @usegraft/sdk-core: the same `getContent` /
 * `listContent` / `searchContent` surface as @usegraft/sdk-next, so a schema
 * types every read identically across frameworks.
 *
 * Nitro is the server under Nuxt, Analog and standalone Nitro apps, so this
 * one handle serves all of them. It holds a database handle, so it is
 * server-only: build it in `server/utils/` (Nuxt) or beside your routes
 * (Nitro), never in code that reaches the browser. A Nuxt page's
 * `<script setup>` runs in the browser on client-side navigation.
 *
 * No request-level memo (sdk-next's React.cache has no Nitro equivalent):
 * reads go straight to the index.
 *
 * Caching: the Phase 4 tag contract maps onto HTTP. Stamp `tagsFor(...)` into
 * a CDN surrogate-key header (`Cache-Tag` / `Surrogate-Key`) on the responses
 * you serve, and purge `tagsForChanges(branch, changeSet)` from your own route,
 * called with a compile's change list. `graft compile --json` prints
 * `{ branch, gitSha, changes }`: pass its `branch` and `changes`.
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
