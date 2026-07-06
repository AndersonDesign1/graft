/**
 * Next.js (RSC) adapter over @graft/sdk-core.
 *
 * createGraft wraps the read client with React.cache so repeated reads of the
 * same document within one server render are deduped. Server-only by nature
 * (it holds a database handle) — import it from Server Components or route
 * handlers, never from client components.
 *
 * Live binding + revalidateTag integration land in Phase 4.
 */
import { cache } from "react";
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
} from "@graft/sdk-core";

export interface Graft<TCollections extends Record<string, AnyCollection>> {
  /** Request-deduped getDocument. */
  getContent<K extends keyof TCollections & string>(
    collection: K,
    slug: string,
    options?: ReadOptions,
  ): Promise<Document<TCollections[K]> | null>;
  /** Request-deduped listDocuments. */
  listContent<K extends keyof TCollections & string>(
    collection: K,
    options?: ListOptions,
  ): Promise<Document<TCollections[K]>[]>;
  /** Request-deduped searchDocuments (full-text, best-ranked first). */
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

  // React.cache keys by argument identity, so the cached core takes only
  // primitives; the generic wrappers restore the per-collection return types.
  const cachedGet = cache((collection: string, slug: string, branch: string | undefined) =>
    client.getDocument(
      collection as keyof TCollections & string,
      slug,
      branch === undefined ? undefined : { branch },
    ),
  );
  const cachedList = cache(
    (
      collection: string,
      branch: string | undefined,
      limit: number | undefined,
      offset: number | undefined,
    ) => client.listDocuments(collection as keyof TCollections & string, { branch, limit, offset }),
  );
  const cachedSearch = cache(
    (collection: string, query: string, branch: string | undefined, limit: number | undefined) =>
      client.searchDocuments(collection as keyof TCollections & string, query, { branch, limit }),
  );

  return {
    client,
    getContent: (collection, slug, opts) =>
      cachedGet(collection, slug, opts?.branch) as ReturnType<Graft<TCollections>["getContent"]>,
    listContent: (collection, opts) =>
      cachedList(collection, opts?.branch, opts?.limit, opts?.offset) as ReturnType<
        Graft<TCollections>["listContent"]
      >,
    searchContent: (collection, query, opts) =>
      cachedSearch(collection, query, opts?.branch, opts?.limit) as ReturnType<
        Graft<TCollections>["searchContent"]
      >,
  };
}
