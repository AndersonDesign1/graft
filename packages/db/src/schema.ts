/**
 * Database schema (Drizzle).
 *
 * `content_index` is the projection target for authored content (Spike A): git is
 * authoritative, this is a derived, queryable index. `branch_id` + `deleted` make the
 * table forward-compatible with row-level branching (Spike B, self-host overlay); for
 * now every row lives on the implicit "main" branch.
 */
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
