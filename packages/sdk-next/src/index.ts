/**
 * @graft/sdk-next
 * Next.js (RSC) adapter: createGraft → request-deduped (or Data-Cached), fully
 * typed content reads for Server Components, revalidateContent (cache-tag write
 * side), and MdxBody (real MDX evaluation for authored bodies + block components).
 */
export * from "./graft";
export * from "./mdx";
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
