/**
 * @graft/sdk-core
 * Framework-agnostic, fully typed read client over the content_index, plus the
 * Phase 4 cache-tag contract (./tags). `@graft/sdk-next` binds the tags to
 * Next's revalidateTag; `subscribe`/SWR for live previews layer on top later.
 */
export * from "./client";
export * from "./tags";
// Convenience re-exports so consumers can type helpers without importing @graft/core or @graft/db.
export type { AnyCollection, DocumentData } from "@graft/core";
export type { ChangeSet } from "@graft/db";
