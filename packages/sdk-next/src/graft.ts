/**
 * Next.js (RSC) adapter over @usegraft/sdk-core.
 *
 * `createGraft` wraps the read client with React.cache so repeated reads of the
 * same document within one server render are deduped. Server-only by nature (it
 * holds a database handle) — import from Server Components or route handlers,
 * never client components.
 *
 * Caching + invalidation (Phase 4) is the cache-tag contract, not a wrapper:
 * Next 16's `'use cache'` is a compile-time directive an app authors, so this
 * package can't generate it. Instead it ships the tag helpers (re-exported from
 * sdk-core — `tagsFor`, `documentTag`, `collectionTag`) that an app drops into
 * `cacheTag(...)` inside its own `'use cache'` functions, plus the write side:
 * `revalidateContent` / `updateContent`, which turn a compile's `ChangeSet`
 * into the exact `revalidateTag` / `updateTag` calls that refresh only the
 * changed pages. See the example app's llms.txt for the composition.
 */
import { revalidateTag, updateTag } from "next/cache";
import { cache } from "react";
import {
  createClient,
  tagsForChanges,
  type AnyCollection,
  type ChangeSet,
  type ClientOptions,
  type Document,
  type GraftClient,
  type ListOptions,
  type ReadOptions,
  type SearchHit,
  type SearchOptions,
} from "@usegraft/sdk-core";

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

/** How long a background-revalidated tag may keep serving stale before it hard-expires. */
export type RevalidateProfile = string | { expire?: number };

/**
 * Background-invalidate the Data Cache for everything a compile changed, on
 * `branch`. Call it from a **route handler** (a compile webhook): the next
 * request triggers a background refresh (stale-while-revalidate). Refreshes
 * only the changed pages — per-doc + per-collection tags — and returns them.
 *
 * `profile` is Next 16's required cache-life argument to `revalidateTag`
 * (a built-in name like `"max"`/`"hours"` or `{ expire }`); defaults to `"max"`.
 * A no-op unless the reads were cached with `'use cache'` + `cacheTag`, but
 * always safe to call.
 */
export function revalidateContent(
  branch: string,
  changes: ChangeSet,
  profile: RevalidateProfile = "max",
): string[] {
  const tags = tagsForChanges(branch, changes);
  for (const tag of tags) revalidateTag(tag, profile);
  return tags;
}

/**
 * Immediately invalidate the Data Cache for a compile's changes, with
 * read-your-own-writes semantics. Call it from a **Server Action** (e.g. an
 * in-app "publish" that compiles then updates): the same request sees fresh
 * content. Returns the tags it hit. Like `revalidateContent`, a no-op unless
 * the reads were cached with `'use cache'` + `cacheTag`.
 */
export function updateContent(branch: string, changes: ChangeSet): string[] {
  const tags = tagsForChanges(branch, changes);
  for (const tag of tags) updateTag(tag);
  return tags;
}
