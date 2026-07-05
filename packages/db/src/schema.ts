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
