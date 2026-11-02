/**
 * Server-rendered content for pages, auto-imported.
 *
 * ```vue
 * <script setup lang="ts">
 * const route = useRoute();
 * const { data: post } = await useGraftContent("posts", () => String(route.params.slug));
 * </script>
 * ```
 *
 * Each composable is `useAsyncData` over an `@usegraft/sdk-vue` handle that
 * reads the content API. During server rendering the read goes through
 * Nuxt's request fetch, which answers a same-origin path in-process, and the
 * result rides the payload into hydration, so the browser does not fetch it
 * again. On client-side navigation the same code reads over HTTP. A getter
 * argument becomes part of the key, so the read follows the route.
 *
 * Documents are re-validated against your collections, as every Graft client
 * does, so the collections ship to the browser. Keep graft.config.ts free of
 * server-only imports.
 */
import { collections } from "#graft/config";
import { useAsyncData, useRequestFetch, useRequestURL } from "#imports";
import { createGraft, type Graft, type ListOptions, type SearchOptions } from "@usegraft/sdk-vue";
import { toValue, type MaybeRefOrGetter } from "vue";
import { fetchVia } from "./fetch";

type Collections = typeof collections;
type CollectionName = keyof Collections & string;

function graftFor(): Graft<Collections> {
  return createGraft({
    endpoint: new URL("/api/content/v1", useRequestURL()),
    collections,
    fetch: fetchVia(useRequestFetch()),
  });
}

/** One document by slug, or `null` when there is none. */
export function useGraftContent<K extends CollectionName>(
  collection: K,
  slug: MaybeRefOrGetter<string>,
) {
  const graft = graftFor();
  return useAsyncData(
    () => `graft:content:${collection}:${toValue(slug)}`,
    () => graft.getContent(collection, toValue(slug)),
  );
}

/** A collection's documents, as the content API orders them. */
export function useGraftList<K extends CollectionName>(
  collection: K,
  options?: MaybeRefOrGetter<ListOptions | undefined>,
) {
  const graft = graftFor();
  return useAsyncData(
    () => `graft:list:${collection}:${JSON.stringify(toValue(options) ?? {})}`,
    () => graft.listContent(collection, toValue(options)),
  );
}

/** Full-text search in one collection. A blank query answers `[]` without a request. */
export function useGraftSearch<K extends CollectionName>(
  collection: K,
  query: MaybeRefOrGetter<string>,
  options?: MaybeRefOrGetter<SearchOptions | undefined>,
) {
  const graft = graftFor();
  return useAsyncData(
    () => `graft:search:${collection}:${toValue(query)}:${JSON.stringify(toValue(options) ?? {})}`,
    () => graft.searchContent(collection, toValue(query), toValue(options)),
  );
}
