/**
 * TanStack Start adapter over @usegraft/sdk-core — the same `getContent` /
 * `listContent` / `searchContent` surface as @usegraft/sdk-next, so a schema
 * types every read identically across frameworks.
 *
 * No request-level memo here (sdk-next's React.cache has no TanStack Start
 * equivalent): reads go straight to the index. Server-only by nature (it holds
 * a database handle), and TanStack Start makes that sharper than most
 * frameworks do — a route `loader` is isomorphic, so it runs in the browser on
 * client-side navigation. Build this handle in a server-only module and reach
 * it from a `createServerFn` handler or a server route, never from a route
 * loader directly.
 *
 * Caching: TanStack Start has no tag-based data cache, so the Phase 4 tag
 * contract maps onto HTTP — stamp `tagsFor(...)` into a CDN surrogate-key
 * header (`Cache-Tag` / `Surrogate-Key`) on the responses you serve, and purge
 * `tagsForChanges(branch, changeSet)` from your compile webhook.
 */
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

export function createGraft<TCollections extends Record<string, AnyCollection>>(
  options: ClientOptions<TCollections>,
): Graft<TCollections> {
  const client = createClient(options);
  return {
    client,
    getContent: (collection, slug, opts) => client.getDocument(collection, slug, opts),
    listContent: (collection, opts) => client.listDocuments(collection, opts),
    searchContent: (collection, query, opts) => client.searchDocuments(collection, query, opts),
  };
}
