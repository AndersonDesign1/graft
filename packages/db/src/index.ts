/**
 * @graft/db
 * Postgres + Drizzle client and schema. Branching abstraction (Spike B) lands here
 * in a later phase; for now the schema is branch-ready (branch_id + deleted).
 */
export * from "./client";
export * from "./content";
export * from "./diff";
export * from "./schema";

// Re-export the query operators consumers need, so downstream packages (sdk-core,
// functions) never depend on drizzle-orm directly — one drizzle version, owned here.
export { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
