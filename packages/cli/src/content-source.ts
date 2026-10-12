/**
 * What a project's content source decides for the CLI: which store a writing
 * surface mounts, and which commands have nothing to act on.
 */
import { GraftError } from "@usegraft/contracts";
import type { ContentStore } from "@usegraft/compiler";
import type { Database } from "@usegraft/db";
import type { ProjectConfig } from "./config";

/**
 * The database store for a database-sourced project, or undefined when the
 * files in git are the source and today's stores apply.
 */
export async function databaseStoreFor(
  config: ProjectConfig,
  db: Database,
  branchId: string,
): Promise<ContentStore | undefined> {
  if (config.content.source !== "database") return undefined;
  const { DatabaseStore } = await import("@usegraft/compiler");
  return new DatabaseStore({
    db,
    branchId,
    collections: config.collections,
    mdxTrust: config.mdxTrust,
  });
}

/** Refuse a command that reads or rewrites files, in a project whose files are not the source. */
export function assertGitSourced(config: ProjectConfig, what: string, fix: string): void {
  if (config.content.source !== "database") return;
  throw new GraftError({
    code: "CONTENT_SOURCE_MISMATCH",
    message: `This project keeps its content in the database, so ${what} has nothing to act on.`,
    fix,
    details: { source: config.content.source },
  });
}
