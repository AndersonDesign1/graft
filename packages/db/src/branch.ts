/**
 * Branching abstraction (Phase 4, Spike B) — the one place overlay logic lives.
 *
 * A branch handle is a `Database` + a `BranchScope`: the scope says how reads
 * filter. `overlay` (self-host default) resolves an ancestor chain and reads the
 * winning, non-tombstoned row per (collection, slug); `physical` (the `neon`
 * backend, P4.3) needs no query scoping because each branch is its own Postgres.
 * Callers never hand-write the overlay SQL — they call `readContent`/`searchContent`
 * with a scope and get rows back. See docs/design-notes/branching.md.
 */
import { GraftError } from "@usegraft/contracts";
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { createDb, type Database } from "./client";
import {
  branches,
  contentIndex,
  dataRecords,
  migrationsApplied,
  type BranchBackendKind,
  type ContentRow,
} from "./schema";

/** Branch names: kebab segments, optionally slash-separated (e.g. `preview/checkout`). */
const BRANCH_NAME = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/;

/**
 * How reads scope to a branch. `overlay` carries the ancestor chain (leaf-first)
 * and the branch writes land on; `physical` is a self-contained Postgres — a
 * storage fork whose rows keep the DEFAULT branch id (`main`), because the
 * database itself IS the branch. `branch` is the registry name, kept for
 * labeling; queries against a physical scope always read and write `main`.
 */
export type BranchScope =
  | { kind: "overlay"; chain: string[]; writeBranch: string }
  | { kind: "physical"; branch: string };

/** The branch chain (leaf-first) a scope reads across — one element when there's no overlay. */
export function scopeChain(scope: BranchScope): string[] {
  return scope.kind === "overlay" ? scope.chain : ["main"];
}

/** The branch id writes stamp under this scope (a physical fork keeps the default id). */
export function scopeWriteBranch(scope: BranchScope): string {
  return scope.kind === "overlay" ? scope.writeBranch : "main";
}

export interface BranchMeta {
  name: string;
  parent: string | null;
  backend: BranchBackendKind;
  status: string;
  createdAt: Date;
  /** neon: the branch's compute host; null for overlay. */
  endpointHost: string | null;
  /** neon: the Neon API branch id used to reset/drop; null for overlay. */
  neonBranchId: string | null;
}

/**
 * Resolve a branch name to its read scope by walking the registry parent chain
 * (leaf-first). Tolerant by design: a name with no registry row resolves to a
 * self-chain `[name]`, so projecting into an unregistered branch id keeps
 * working — registering a branch with a parent is what enables overlay reads.
 */
export async function resolveBranchScope(db: Database, branch: string): Promise<BranchScope> {
  const chain: string[] = [branch];
  const seen = new Set<string>([branch]);
  let current = branch;

  for (;;) {
    const [row] = await db
      .select({ parent: branches.parent })
      .from(branches)
      .where(eq(branches.name, current))
      .limit(1);
    const parent = row?.parent;
    if (!parent || seen.has(parent)) break; // root reached, unregistered, or cycle guard
    chain.push(parent);
    seen.add(parent);
    current = parent;
  }

  return { kind: "overlay", chain, writeBranch: branch };
}

export interface CreateBranchInput {
  name: string;
  /** The branch to fork from. Defaults to "main". */
  from?: string;
  backend?: BranchBackendKind;
}

/**
 * The shared create-side guards: name shape, self-parenting, parent existence,
 * duplicate name. Returns the parent's registry row (backends fork differently
 * depending on what the parent is). Used by `createBranch` and the neon backend.
 */
export async function assertBranchCreatable(
  db: Database,
  input: { name: string; from: string },
): Promise<BranchMeta> {
  if (!BRANCH_NAME.test(input.name)) {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `"${input.name}" is not a valid branch name.`,
      fix: 'Use lowercase letters, digits, single hyphens, and optional "/" segments (e.g. "preview/checkout").',
      details: { name: input.name },
    });
  }
  if (input.name === input.from) {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `A branch cannot be its own parent ("${input.name}").`,
      fix: "Fork from a different branch, or omit --from to fork from main.",
      details: { name: input.name },
    });
  }

  const parent = await getBranch(db, input.from);

  const existing = await db
    .select({ name: branches.name })
    .from(branches)
    .where(eq(branches.name, input.name))
    .limit(1);
  if (existing.length > 0) {
    throw new GraftError({
      code: "BRANCH_EXISTS",
      message: `Branch "${input.name}" already exists.`,
      fix: "Pick a different name, or drop the existing branch first (graft branch will list them).",
      details: { name: input.name },
    });
  }
  return parent;
}

/**
 * Register an overlay branch in the topology. Instant — one row insert, no
 * data copied (Spike B). The neon backend has its own create (`createNeonBranch`).
 */
export async function createBranch(db: Database, input: CreateBranchInput): Promise<BranchMeta> {
  const from = input.from ?? "main";
  await assertBranchCreatable(db, { name: input.name, from });

  const [row] = await db
    .insert(branches)
    .values({ name: input.name, parent: from, backend: input.backend ?? "overlay" })
    .returning();
  if (!row) throw new Error("insert returned no row"); // unreachable; satisfies noUncheckedIndexedAccess
  return toMeta(row);
}

export async function listBranches(db: Database): Promise<BranchMeta[]> {
  const rows = await db.select().from(branches).orderBy(asc(branches.createdAt));
  return rows.map(toMeta);
}

/** The registry row for one branch; `BRANCH_NOT_FOUND` when unregistered. */
export async function getBranch(db: Database, name: string): Promise<BranchMeta> {
  const [row] = await db.select().from(branches).where(eq(branches.name, name)).limit(1);
  if (!row) {
    throw new GraftError({
      code: "BRANCH_NOT_FOUND",
      message: `Branch "${name}" is not registered.`,
      fix: 'Register it first (createBranch / graft branch create). "main" is seeded; fork previews from it.',
      details: { name },
    });
  }
  return toMeta(row);
}

/** Rows an overlay branch owns per table — what a purge would (or did) delete. */
export interface BranchRowCounts {
  content: number;
  data: number;
  ledger: number;
}

export interface DropBranchOptions {
  /**
   * Also delete the branch's `content_index`, `data_records`, and
   * `migrations_applied` rows, atomically with the registry row. Without this
   * the rows are orphaned but harmless (tolerant resolution still reads them
   * if the same id is ever compiled into again). Audit/compilation rows are
   * history and are never purged.
   */
  purgeRows?: boolean;
}

export interface DropBranchResult {
  /** Set when `purgeRows` was requested. */
  purged?: BranchRowCounts;
}

/**
 * Remove a branch from the registry, optionally purging its data-plane rows in
 * the same transaction. Refuses to drop `main` or a branch that still has
 * children (drop those first). Neon-endpoint teardown is the `neon` backend's
 * job (P4.3).
 */
/**
 * The shared drop-side guards: not `main`, registered, and childless. Returns
 * the registry row. Used by `dropBranch` and the neon backend.
 */
export async function assertBranchDroppable(db: Database, name: string): Promise<BranchMeta> {
  if (name === "main") {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: "The main branch cannot be dropped.",
      fix: "main is the root of the topology; create and drop preview branches off it instead.",
      details: { name },
    });
  }
  const meta = await getBranch(db, name);

  const children = await db
    .select({ name: branches.name })
    .from(branches)
    .where(eq(branches.parent, name))
    .limit(1);
  if (children.length > 0) {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `Branch "${name}" still has child branches.`,
      fix: "Drop the child branches first — the topology is a tree and parents outlive their children.",
      details: { name },
    });
  }
  return meta;
}

export async function dropBranch(
  db: Database,
  name: string,
  options: DropBranchOptions = {},
): Promise<DropBranchResult> {
  await assertBranchDroppable(db, name);

  if (!options.purgeRows) {
    await db.delete(branches).where(eq(branches.name, name));
    return {};
  }

  return db.transaction(async (tx) => {
    const content = await tx
      .delete(contentIndex)
      .where(eq(contentIndex.branchId, name))
      .returning({ slug: contentIndex.slug });
    const data = await tx
      .delete(dataRecords)
      .where(eq(dataRecords.branchId, name))
      .returning({ id: dataRecords.id });
    const ledger = await tx
      .delete(migrationsApplied)
      .where(eq(migrationsApplied.branchId, name))
      .returning({ id: migrationsApplied.id });
    await tx.delete(branches).where(eq(branches.name, name));
    return { purged: { content: content.length, data: data.length, ledger: ledger.length } };
  });
}

/** How many rows a branch owns per table — the dry-run side of purge/merge. */
export async function countBranchRows(db: Database, name: string): Promise<BranchRowCounts> {
  const [[content], [data], [ledger]] = await Promise.all([
    db.select({ n: count() }).from(contentIndex).where(eq(contentIndex.branchId, name)),
    db.select({ n: count() }).from(dataRecords).where(eq(dataRecords.branchId, name)),
    db.select({ n: count() }).from(migrationsApplied).where(eq(migrationsApplied.branchId, name)),
  ]);
  return { content: content?.n ?? 0, data: data?.n ?? 0, ledger: ledger?.n ?? 0 };
}

export interface MoveDataRecordsInput {
  from: string;
  into: string;
}

/**
 * Fold a branch's operational rows onto the target by rewriting `branch_id` —
 * the `graft merge` data-delta step. Today a branch's `data_records` rows are
 * exactly the rows created on it (data reads are exact-branch until the
 * tombstone/inheritance decision lands), so the delta is a pure move: uuid
 * keys can't collide and parent-owned rows can't have been edited from the
 * branch. Returns the number of rows moved.
 */
export async function moveDataRecords(db: Database, input: MoveDataRecordsInput): Promise<number> {
  if (input.from === input.into) return 0;
  const moved = await db
    .update(dataRecords)
    .set({ branchId: input.into })
    .where(eq(dataRecords.branchId, input.from))
    .returning({ id: dataRecords.id });
  return moved.length;
}

function toMeta(row: typeof branches.$inferSelect): BranchMeta {
  return {
    name: row.name,
    parent: row.parent,
    backend: row.backend as BranchBackendKind,
    status: row.status,
    createdAt: row.createdAt,
    endpointHost: row.endpointHost,
    neonBranchId: row.neonBranchId,
  };
}

/**
 * A branch's connection URL: the configured URL with the branch endpoint's
 * host swapped in wholesale. Neon branch hosts live on their own cell domain
 * (e.g. `ep-….c-4.eu-central-1.aws.neon.tech`), so never derive them by
 * editing the parent's host — always use the host the API returned.
 * Credentials carry over: Neon branches inherit the parent's roles.
 */
export function neonBranchUrl(databaseUrl: string, endpointHost: string): string {
  const url = new URL(databaseUrl);
  url.hostname = endpointHost;
  return url.toString();
}

/**
 * The resolved seam every branch-aware caller runs through: which database to
 * talk to, and how queries scope inside it. Overlay branches share the control
 * connection; neon branches get their own (close() releases it — a no-op for
 * overlay, where the caller still owns the control handle).
 */
export interface BranchHandle {
  name: string;
  db: Database;
  scope: BranchScope;
  close(): Promise<void>;
}

/**
 * Resolve a branch name to the connection + scope to run against. Overlay
 * resolution stays tolerant (an unregistered id is a self-chain on the shared
 * db, so "compile into any branch id" keeps working); a registered `neon`
 * branch opens its own connection against the branch endpoint.
 */
export async function resolveBranchHandle(
  controlDb: Database,
  branch: string,
  options: { databaseUrl: string },
): Promise<BranchHandle> {
  const [row] = await controlDb.select().from(branches).where(eq(branches.name, branch)).limit(1);

  if (row?.backend === "neon") {
    if (!row.endpointHost) {
      throw new GraftError({
        code: "BRANCH_BACKEND_FAILED",
        message: `Branch "${branch}" is registered as neon but has no endpoint host.`,
        fix: "The registry row is incomplete (a create likely failed partway). Drop the branch and recreate it.",
        details: { name: branch },
      });
    }
    const handle = createDb(neonBranchUrl(options.databaseUrl, row.endpointHost));
    return {
      name: branch,
      db: handle.db,
      scope: { kind: "physical", branch },
      close: handle.close,
    };
  }

  const scope = await resolveBranchScope(controlDb, branch);
  return { name: branch, db: controlDb, scope, close: async () => {} };
}

/**
 * Additive cross-database sibling of `moveDataRecords` — the merge data step
 * when source and target live in different databases (a neon fork merging
 * into the control db, or vice versa). Copies the source branch's rows under
 * the target's id; `onConflictDoNothing` on the uuid key makes reruns
 * idempotent. The source keeps its rows (a merged fork is dropped anyway).
 */
export async function copyDataRecords(
  fromDb: Database,
  intoDb: Database,
  input: { fromBranch: string; intoBranch: string },
): Promise<number> {
  const rows = await fromDb
    .select()
    .from(dataRecords)
    .where(eq(dataRecords.branchId, input.fromBranch))
    .orderBy(asc(dataRecords.createdAt));
  let copied = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map(({ search: _search, ...row }) => ({
      ...row,
      branchId: input.intoBranch,
    }));
    const inserted = await intoDb
      .insert(dataRecords)
      .values(values)
      .onConflictDoNothing({ target: dataRecords.id })
      .returning({ id: dataRecords.id });
    copied += inserted.length;
  }
  return copied;
}

export interface ReadContentOptions {
  collection: string;
  /** When set, read a single document; otherwise the whole collection. */
  slug?: string;
  limit?: number;
  offset?: number;
}

/**
 * Read content rows through a branch scope — the overlay-aware replacement for
 * hand-written `where(eq(branch_id, …))`. For a single-branch scope this is the
 * plain indexed read (no overhead, no behaviour change); for a real overlay
 * chain it returns the winning, non-tombstoned row per (collection, slug):
 * branch rows beat ancestors, a branch tombstone hides a parent's live row.
 */
export async function readContent(
  db: Database,
  scope: BranchScope,
  options: ReadContentOptions,
): Promise<ContentRow[]> {
  const chain = scopeChain(scope);

  // Fast path: no overlay to resolve — the common case (main, or an unregistered
  // branch). Byte-identical to the pre-Phase-4 read, and keeps the GIN/PK indexes.
  if (chain.length === 1) {
    const filters = [
      eq(contentIndex.branchId, chain[0]),
      eq(contentIndex.collection, options.collection),
      eq(contentIndex.deleted, false),
    ];
    if (options.slug !== undefined) filters.push(eq(contentIndex.slug, options.slug));
    let query = db
      .select()
      .from(contentIndex)
      .where(and(...filters))
      .orderBy(asc(contentIndex.slug))
      .$dynamic();
    if (options.limit !== undefined) query = query.limit(options.limit);
    if (options.offset !== undefined) query = query.offset(options.offset);
    return query;
  }

  // Overlay path: pick the branch-winning row per (collection, slug) across the
  // chain, THEN drop tombstones (a branch `deleted` must win the pick before it
  // hides the ancestor's live row — so the deleted filter is outside the pick).
  const overlay = overlaySubquery(db, chain, { collection: options.collection });
  const outer = [eq(overlay.deleted, false)];
  if (options.slug !== undefined) outer.push(eq(overlay.slug, options.slug));
  let query = db
    .select()
    .from(overlay)
    .where(and(...outer))
    .orderBy(asc(overlay.slug))
    .$dynamic();
  if (options.limit !== undefined) query = query.limit(options.limit);
  if (options.offset !== undefined) query = query.offset(options.offset);
  const rows = await query;
  return rows as ContentRow[];
}

/**
 * The overlay pick as a subquery: `DISTINCT ON (collection, slug)` ordered so the
 * lowest-position branch in the chain (the leaf) wins. Tombstones are included
 * here and filtered by the caller. Shared by content reads and search so the
 * ordering/priority rule lives in exactly one place.
 */
export function overlaySubquery(
  db: Database,
  chain: string[],
  filter: { collection?: string; collections?: string[] } = {},
) {
  const priority = chainPriority(chain);
  const filters: SQL[] = [inArray(contentIndex.branchId, chain)];
  // Pushing the collection filter into the pick is safe: the winner for a given
  // (collection, slug) is chosen among rows of that same collection.
  if (filter.collection !== undefined) filters.push(eq(contentIndex.collection, filter.collection));
  if (filter.collections !== undefined)
    filters.push(inArray(contentIndex.collection, filter.collections));

  return db
    .selectDistinctOn([contentIndex.collection, contentIndex.slug])
    .from(contentIndex)
    .where(and(...filters))
    .orderBy(
      asc(contentIndex.collection),
      asc(contentIndex.slug),
      asc(sql`array_position(${priority}, ${contentIndex.branchId})`),
    )
    .as("overlay");
}

/** `array['leaf', …, 'main']::text[]` — array_position gives the leaf the lowest index. */
export function chainPriority(chain: string[]): SQL {
  return sql`array[${sql.join(
    chain.map((b) => sql`${b}`),
    sql`, `,
  )}]::text[]`;
}
