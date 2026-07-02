/**
 * @graft/sdk-core
 * Framework-agnostic, fully typed read client over the content_index.
 * The cache/invalidation contract (subscribe, revalidateTag) lands in Phase 4.
 */
export * from "./client";
// Convenience re-exports so consumers can type helpers without importing @graft/core.
export type { AnyCollection, DocumentData } from "@graft/core";
