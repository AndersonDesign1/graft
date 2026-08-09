/**
 * @usegraft/sdk-astro
 * Astro adapter: typed reads (`createGraft`) + endpoint mounts (`graftRoute`)
 * over the same stateless handlers every other surface serves. Cache
 * invalidation is the sdk-core tag contract mapped onto CDN surrogate keys.
 * MDX bodies come back as authored source — render with Astro's own MDX
 * pipeline (a React `MdxBody` equivalent is deliberately not shipped here).
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
