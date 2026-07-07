/**
 * @graft/sdk-next
 * Next.js (RSC) adapter: createGraft → request-deduped (or Data-Cached), fully
 * typed content reads for Server Components, plus revalidateContent — the
 * cache-tag write side over Next's revalidateTag.
 */
export * from "./graft";
// Re-export the core read + cache-tag surface so apps import one package.
export {
  createClient,
  toDocument,
  collectionTag,
  documentTag,
  tagsFor,
  tagsForChanges,
  TAG_NAMESPACE,
  type AnyCollection,
  type ChangeSet,
  type ClientOptions,
  type Document,
  type GraftClient,
  type ListOptions,
  type ReadOptions,
  type SearchHit,
  type SearchOptions,
} from "@graft/sdk-core";
