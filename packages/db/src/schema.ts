import type { ContentRow } from "@usegraft/contracts";
/**
 * Database schema (Drizzle).
 *
 * `content_index` is the projection target for authored content (Spike A): git is
 * authoritative, this is a derived, queryable index. `branch_id` + `deleted` make the
 * table forward-compatible with row-level branching (Spike B, self-host overlay); for
 * now every row lives on the implicit "main" branch.
 */
import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector` — drizzle has no built-in type for it. Search columns are
 * GENERATED ALWAYS ... STORED, so Postgres owns indexing: every write path
 * (projection, insertRecord, hand-run SQL) is searchable with zero app-side
 * bookkeeping, and the column can never drift from the row it derives from.
 * The text-search config is hardcoded to 'english' for now (i18n is an open
 * decision); it must match the config used in queries (see search.ts).
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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
    /**
     * FTS document, weighted so where a term appears matters: slug (A) beats
     * frontmatter strings (B) beats body prose (C). Kebab-case slugs are
     * split so "pricing" matches the pricing page by name alone.
     */
    search: tsvector("search").generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', replace(${contentIndex.slug}, '-', ' ')), 'A') || setweight(jsonb_to_tsvector('english', ${contentIndex.data}, '["string"]'), 'B') || setweight(to_tsvector('english', ${contentIndex.body}), 'C')`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.collection, t.slug] }),
    index("content_index_lookup").on(t.collection, t.slug, t.branchId),
    index("content_index_search").using("gin", t.search),
  ],
);

/**
 * The published row shape lives in `@usegraft/contracts` so a consumer can
 * describe a row without installing a database driver. This asserts the table
 * still produces it — if a column changes type, this line fails rather than the
 * contract silently drifting from its only implementation.
 */
type InferredContentRow = typeof contentIndex.$inferSelect;
const _tableMatchesContract: (row: InferredContentRow) => ContentRow = (row) => row;
void _tableMatchesContract;
export type { ContentRow };
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
    /** FTS over every string value in `data` — records have no body or slug. */
    search: tsvector("search").generatedAlwaysAs(
      (): SQL => sql`jsonb_to_tsvector('english', ${dataRecords.data}, '["string"]')`,
    ),
  },
  (t) => [
    index("data_records_lookup").on(t.branchId, t.collection, t.createdAt),
    index("data_records_search").using("gin", t.search),
  ],
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
    /**
     * Who decided — derived from the verified actor at the deciding surface,
     * never from caller input. `decided_by` is the identity the
     * separation-of-duties predicate compares against `requested_by_id`, so a
     * caller-supplied value would make that check meaningless.
     */
    decidedBy: text("decided_by"),
    decidedByKind: text("decided_by_kind"),
    /**
     * Postgres role the decision ran as (`current_user`), stamped inside the
     * UPDATE itself — unlike `decided_by` it cannot be self-reported.
     */
    decidedRole: text("decided_role"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_status_created").on(t.status, t.createdAt)],
);

export type ApprovalRow = typeof approvals.$inferSelect;
export type ApprovalStatus = "pending" | "approved" | "denied" | "consumed";

/**
 * One row per applied migration (content codemod or data backfill) per branch —
 * the bookkeeping `graft merge` (Phase 4) replays against. Migration identity
 * is the file name stem under migrations/ (drizzle-style): renaming a file
 * makes it a new migration. The unique index is what makes application
 * idempotent — a concurrent second apply loses the insert race and fails.
 */
export const migrationsApplied = pgTable(
  "migrations_applied",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull().default("main"),
    migrationId: text("migration_id").notNull(),
    kind: text("kind").notNull(),
    collection: text("collection").notNull(),
    /** Files rewritten (content) or rows updated (data). */
    docCount: integer("doc_count").notNull(),
    /** Git commit of the checkout at apply time; null when unresolvable. */
    gitSha: text("git_sha"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("migrations_applied_branch_migration").on(t.branchId, t.migrationId)],
);

export type MigrationAppliedRow = typeof migrationsApplied.$inferSelect;
export type MigrationKind = "content" | "data";

/**
 * Branch registry (Phase 4) — the control-plane topology for copy-on-write
 * previews. A branch is a `name` + a `parent` pointer; reads overlay the
 * ancestor chain (branch rows win over ancestors, `deleted` tombstones hide a
 * parent's live row) so a preview sees its parent's content plus its own edits
 * with zero copy (Spike B, self-host default). `main` is the seeded root
 * (`parent` null). Rows not registered here still work — they resolve to a
 * self-chain — so "compile into any branch id" keeps working; registering a
 * branch with a parent is what turns overlay on. The `neon` backend (P4.3)
 * records its per-branch compute endpoint here; `overlay` needs only name +
 * parent. The self-FK keeps the topology referentially intact.
 */
export const branches = pgTable(
  "branches",
  {
    name: text("name").primaryKey(),
    /** Null only for a root branch (`main`); otherwise the branch this forked from. */
    parent: text("parent"),
    /** 'overlay' (shared DB, branch_id) or 'neon' (per-branch compute endpoint). */
    backend: text("backend").notNull().default("overlay"),
    /** neon: the branch's compute host, spliced into the parent's connection string. */
    endpointHost: text("endpoint_host"),
    /** neon: the API handle used to reset/drop the branch. */
    neonBranchId: text("neon_branch_id"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.parent], foreignColumns: [t.name], name: "branches_parent_fk" }),
  ],
);

export type BranchRow = typeof branches.$inferSelect;
export type BranchBackendKind = "overlay" | "neon";

/**
 * Authored content in a database-sourced project (`content.source:
 * "database"`), where Postgres is authoritative and files are a checkout.
 *
 * A revision is one immutable version of one file: the exact MDX bytes, so a
 * `graft pull` writes what was published byte for byte, and the version is the
 * git blob SHA of those bytes on every store. `raw` null is a deletion. An
 * unpublished revision is a draft; publishing stamps `published_at` and moves
 * the head. Rows are never deleted by publishing, which is what history and
 * restore read.
 */
export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull().default("main"),
    /** Relative to the content directory: `<collection>/<slug>.mdx`. */
    path: text("path").notNull(),
    raw: text("raw"),
    version: text("version"),
    /** The revision this one was written on top of, for history. */
    parentId: uuid("parent_id"),
    actorKind: text("actor_kind").notNull().default("human"),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Autosaves by one person in one sitting update the draft in place. */
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedById: text("published_by_id"),
    publishedByName: text("published_by_name"),
  },
  (t) => [index("content_revisions_path").on(t.branchId, t.path, t.createdAt)],
);

export type ContentRevisionRow = typeof contentRevisions.$inferSelect;

/**
 * Where each path stands: the live revision and the draft, if any. One row
 * per path, locked for the length of a write, so two saves of one document
 * are serialised and the version check in between is a real compare-and-swap.
 */
export const contentHeads = pgTable(
  "content_heads",
  {
    branchId: text("branch_id").notNull().default("main"),
    path: text("path").notNull(),
    publishedId: uuid("published_id"),
    draftId: uuid("draft_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.path] }),
    foreignKey({
      columns: [t.publishedId],
      foreignColumns: [contentRevisions.id],
      name: "content_heads_published_fk",
    }),
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [contentRevisions.id],
      name: "content_heads_draft_fk",
    }),
  ],
);

export type ContentHeadRow = typeof contentHeads.$inferSelect;

/**
 * Drafts submitted for review by someone who may not publish. A person who
 * may publish decides it, in Studio's inbox or over MCP; the drafts stay
 * drafts until then.
 */
export const contentReviews = pgTable(
  "content_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: text("branch_id").notNull().default("main"),
    paths: jsonb("paths").$type<string[]>().notNull(),
    title: text("title").notNull(),
    requestedById: text("requested_by_id").notNull(),
    requestedByName: text("requested_by_name"),
    status: text("status").notNull().default("open"),
    decidedById: text("decided_by_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_reviews_open").on(t.branchId, t.status, t.createdAt)],
);

export type ContentReviewRow = typeof contentReviews.$inferSelect;
export type ContentReviewStatus = "open" | "published" | "closed";

/**
 * What a database-sourced project has copied to git, per path: the version
 * the mirror last committed. The next run commits only paths whose live
 * version differs, so a batch of a day's publishes becomes one commit.
 */
export const contentMirror = pgTable(
  "content_mirror",
  {
    branchId: text("branch_id").notNull().default("main"),
    path: text("path").notNull(),
    /** Null: the mirror committed this path's deletion. */
    version: text("version"),
    commitSha: text("commit_sha"),
    mirroredAt: timestamp("mirrored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.path] })],
);

export type ContentMirrorRow = typeof contentMirror.$inferSelect;

/* ---- Studio accounts ------------------------------------------------------ */

/**
 * A person who signs in to Studio with an email and password. Accounts belong
 * to the project, not a branch. The first one is created on first visit and
 * is the owner; everyone after is invited. `role` is one of the Studio roles
 * (viewer, contributor, editor, admin), each a name for a set of scopes.
 */
export const studioUsers = pgTable(
  "studio_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull(),
    /** scrypt, with its parameters and salt: `scrypt$N$r$p$salt$hash`. */
    passwordHash: text("password_hash").notNull(),
    owner: boolean("owner").notNull().default(false),
    failedSignIns: integer("failed_sign_ins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("studio_users_email").on(sql`lower(${t.email})`)],
);

export type StudioUserRow = typeof studioUsers.$inferSelect;

/**
 * A signed-in browser. The cookie holds a random token; only its SHA-256 is
 * stored, so a leaked table cannot be replayed. A row is what makes a session
 * revocable: signing out, removing a person or changing their role takes
 * effect on their next request.
 */
export const studioSessions = pgTable(
  "studio_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => studioUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("studio_sessions_user").on(t.userId)],
);

/** An invitation an admin sent from Settings: one use, until it expires or is revoked. */
export const studioInvites = pgTable(
  "studio_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedById: uuid("invited_by_id").references(() => studioUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("studio_invites_email").on(sql`lower(${t.email})`)],
);

export type StudioInviteRow = typeof studioInvites.$inferSelect;
