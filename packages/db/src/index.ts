/**
 * @graft/db
 * Postgres + Drizzle client and schema. The Phase 4 branching abstraction lives in
 * ./branch: `resolveBranchScope` + overlay-aware `readContent`/`searchContent`.
 */
export * from "./approvals";
export * from "./audit";
export * from "./branch";
export * from "./client";
export * from "./content";
export * from "./diff";
export * from "./harden";
export * from "./ledger";
export * from "./neon";
export * from "./schema";
export * from "./search";

// Re-export the query operators consumers need, so downstream packages (sdk-core,
// functions) never depend on drizzle-orm directly — one drizzle version, owned here.
export { and, asc, count, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
