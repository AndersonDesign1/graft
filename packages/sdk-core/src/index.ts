/**
 * @usegraft/sdk-core
 * Framework-agnostic, fully typed read client over the content_index, plus the
 * Phase 4 cache-tag contract (./tags). `@usegraft/sdk-next` binds the tags to
 * Next's revalidateTag; `subscribe`/SWR for live previews layer on top later.
 */
export * from "./client";
export * from "./tags";
// Convenience re-exports so consumers can type helpers without importing @usegraft/core or @usegraft/db.
export type { AnyCollection, DocumentData } from "@usegraft/core";
export type { ChangeSet } from "@usegraft/db";
