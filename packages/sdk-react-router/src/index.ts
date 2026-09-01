/**
 * @usegraft/sdk-react-router
 * React Router v7 (framework mode) adapter: typed reads (`createGraft`) +
 * loader/action mounts (`graftRoute`) over the same stateless handlers every
 * other surface serves. Cache invalidation is the sdk-core tag contract mapped
 * onto CDN surrogate keys. MDX bodies come back as authored source — render
 * with your own pipeline (a React `MdxBody` equivalent is deliberately not
 * shipped here; @usegraft/sdk-next has one for React Server Components).
 */
export * from "./graft";
export * from "./routes";
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
} from "@usegraft/sdk-core";
