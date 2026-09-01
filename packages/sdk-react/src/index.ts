/**
 * @usegraft/sdk-react
 * The browser client: typed reads (`createGraft`) over the content API, plus a
 * provider and hooks (`createGraftHooks`) that run them. Types come from your
 * own `graft.config.ts` import at compile time, so the wire carries documents
 * and never type information.
 *
 * There is no `graftRoute` here and no `db` option. Mounting handlers and
 * holding a database connection are server jobs — see @usegraft/sdk-next,
 * sdk-astro, sdk-sveltekit, sdk-react-router and sdk-tanstack-start.
 */
export * from "./graft";
export * from "./hooks";
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
