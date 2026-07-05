/**
 * Database schema (Drizzle).
 *
 * `content_index` is the projection target for authored content (Spike A): git is
 * authoritative, this is a derived, queryable index. `branch_id` + `deleted` make the
 * table forward-compatible with row-level branching (Spike B, self-host overlay); for
 * now every row lives on the implicit "main" branch.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const contentIndex = pgTable(
  "content_index",
  {
    branchId: text("branch_id").notNull().default("main"),
    collection: text("collection").notNull(),
    slug: text("slug").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    body: text("body").notNull(),
    contentHash: text("content_hash").notNull(),
    sourcePath: text("source_path").notNull(),
    deleted: boolean("deleted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.collection, t.slug] }),
    index("content_index_lookup").on(t.collection, t.slug, t.branchId),
  ],
);

export type ContentRow = typeof contentIndex.$inferSelect;
export type NewContentRow = typeof contentIndex.$inferInsert;

/**
 * One row per projection run — the audit trail that makes "git is authoritative"
 * checkable: which commit produced the index, on which branch, and what changed.
 * uuid (not serial) so rows stay branch-clone-safe (Spike B sequence gotcha).
 */
export const compilations = pgTable(
  "compilations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull(),
    /** Git commit SHA the content tree was compiled from; null when unresolvable. */
    gitSha: text("git_sha"),
    docCount: integer("doc_count").notNull(),
    added: integer("added").notNull(),
    changed: integer("changed").notNull(),
    removed: integer("removed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("compilations_branch_created").on(t.branchId, t.createdAt)],
);

export type CompilationRow = typeof compilations.$inferSelect;

/**
 * Operational data for db-authoritative collections (Phase 3): rows Postgres
 * owns, written only through typed functions — never projected from files.
 * One shared table (like content_index), collection-typed via jsonb `data`
 * validated at the function boundary. Actor + correlation columns are the
 * pre-audit-log breadcrumb trail; uuid keys stay branch-clone-safe.
 */
export const dataRecords = pgTable(
  "data_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull().default("main"),
    collection: text("collection").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    actorKind: text("actor_kind").notNull().default("anonymous"),
    actorId: text("actor_id"),
    correlationId: text("correlation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("data_records_lookup").on(t.branchId, t.collection, t.createdAt)],
);

export type DataRecordRow = typeof dataRecords.$inferSelect;
export type NewDataRecordRow = typeof dataRecords.$inferInsert;

/**
 * One row per function invocation (P3.4) — the runtime audit trail pairing
 * `compilations` (who changed content) with "who ran what, as whom, and how it
 * went". Rate limiting rides this table too: a limit check is a count of
 * recent rows for the caller's rate key — no in-memory state, so handlers stay
 * stateless (the Phase 3 invariant).
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    correlationId: text("correlation_id").notNull(),
    branchId: text("branch_id").notNull().default("main"),
    functionName: text("function_name").notNull(),
    functionKind: text("function_kind").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    /** Who the caller is for rate limiting: actor id when known, else client IP. */
    rateKey: text("rate_key").notNull(),
    /** "ok" or the GraftError code the invocation failed with. */
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    /** Git commit SHA of the serving code; null when unresolvable. */
    gitSha: text("git_sha"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_rate").on(t.rateKey, t.functionName, t.createdAt),
    index("audit_log_branch_created").on(t.branchId, t.createdAt),
    index("audit_log_correlation").on(t.correlationId),
  ],
);

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

/**
 * Human-gated approvals for destructive ops (P3.4). A destructive invocation
 * without an approval creates a `pending` row and fails self-teachingly; a
 * human decides (`graft approve`/`graft deny`); the caller retries with the
 * approval id. Consumption is one-shot and bound to the exact function +
 * canonical input the approval was requested for — approve A, execute A.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull().default("main"),
    functionName: text("function_name").notNull(),
    /** The requested input, for the human to review before deciding. */
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    /** Canonical (sorted-keys) JSON of `input` — the equality the consume binds to. */
    inputCanonical: text("input_canonical").notNull(),
    requestedByKind: text("requested_by_kind").notNull(),
    requestedById: text("requested_by_id"),
    correlationId: text("correlation_id").notNull(),
    status: text("status").notNull().default("pending"),
    /** Who decided (OS user / operator handle) — set on approve/deny. */
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_status_created").on(t.status, t.createdAt)],
);

export type ApprovalRow = typeof approvals.$inferSelect;
export type ApprovalStatus = "pending" | "approved" | "denied" | "consumed";
