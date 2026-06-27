/**
 * @graft/db
 * Postgres + Drizzle client and schema. Branching abstraction (Spike B) lands here
 * in a later phase; for now the schema is branch-ready (branch_id + deleted).
 */
export * from "./client";
export * from "./schema";
