/**
 * What a Studio without a database says when a view needs one.
 */
import { GraftError } from "@usegraft/contracts";
import type { Database } from "@usegraft/db";

/**
 * The database a feature keeps its data in, or NEEDS_DATABASE saying so in
 * words: a Studio with no database still edits the files, and every view that
 * needs one explains how to add it rather than failing.
 */
export function requireDatabase(
  options: { db?: Database; workspaceDb?: Database },
  feature: string,
  which: "branch" | "workspace" = "branch",
): Database {
  const db = which === "workspace" ? (options.workspaceDb ?? options.db) : options.db;
  if (db) return db;
  throw needsDatabase(feature);
}

export function needsDatabase(feature: string): GraftError {
  return new GraftError({
    code: "NEEDS_DATABASE",
    message: `${feature} ${feature.endsWith("s") ? "are" : "is"} kept in Postgres, and this Studio runs without a database.`,
    fix: NEEDS_DATABASE_FIX,
    details: { feature },
  });
}

/** How to give a Studio a database. Editing content needs none of it. */
export const NEEDS_DATABASE_FIX =
  'Add a Postgres database: set DATABASE_URL in the project\'s .env (a local Postgres or a hosted one such as Neon), remove `export const index = "static"` from graft.config.ts if it is there, run `graft db migrate` and `graft compile`, then restart Studio. Editing and committing content works without it.';
