/**
 * @usegraft/sdk-vue
 * The Vue client: typed reads (`createGraft`) over the content API, composables
 * that run them (`createGraftComposables`), and `MdxContent`, which renders a
 * body `prepareMdx` compiled on the server. Types come from your own
 * `graft.config.ts` import at compile time, so the wire carries documents and
 * never type information.
 *
 * There is no `db` option here. Holding a database connection is a server job.
 */
export * from "./graft";
export * from "./composables";
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
} from "@usegraft/sdk-core";
// The reader the endpoint shortcut builds, for apps that want to configure it
// themselves and pass it as `index`.
export { createContentApiReader, type ContentApiReaderOptions } from "@usegraft/content-api";
