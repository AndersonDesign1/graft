/**
 * @graft/sdk-next
 * Next.js (RSC) adapter: createGraft → request-deduped, fully typed content
 * reads for Server Components. Live binding + revalidateTag land in Phase 4.
 */
export * from "./graft";
// Re-export the core read surface so apps import one package.
export {
  createClient,
  toDocument,
  type AnyCollection,
  type ClientOptions,
  type Document,
  type GraftClient,
  type ListOptions,
  type ReadOptions,
} from "@graft/sdk-core";
