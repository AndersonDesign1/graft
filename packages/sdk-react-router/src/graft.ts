/**
 * React Router v7 (framework mode) adapter over @usegraft/sdk-core — the same
 * `getContent` / `listContent` / `searchContent` surface as
 * @usegraft/sdk-next, so a schema types every read identically across
 * frameworks.
 *
 * No request-level memo here (sdk-next's React.cache has no React Router
 * equivalent): reads go straight to the index from `loader` and `action`,
 * which is the right default — a route makes a handful of reads and its loader
 * runs once per request.
 *
 * Server-only by nature (it holds a database handle). `loader` and `action`
 * run on the server and React Router strips them from the browser bundle, but
 * build the handle in a `.server.ts` module anyway: that turns a stray client
 * import into a build error instead of a database URL in a bundle.
 *
 * Caching: React Router has no tag-based data cache, so the Phase 4 tag
 * contract maps onto HTTP — stamp `tagsFor(...)` into a CDN surrogate-key
 * header (`Cache-Tag` / `Surrogate-Key`) from the route's `headers` export,
 * and purge `tagsForChanges(branch, changeSet)` from your compile webhook.
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
