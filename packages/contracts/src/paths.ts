/**
 * Well-known paths shared across packages.
 */

/**
 * Where a static-tier project's compiled index lives, relative to the project
 * root.
 *
 * Here rather than in @usegraft/db because the CLI resolves it while loading a
 * config and deliberately lazy-loads the database package — a static import
 * just to read one string would pull Postgres into every `graft` invocation.
 */
export const STATIC_INDEX_DEFAULT_PATH = ".graft/index.db";
