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
import { GraftError } from "@graft/contracts";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import { branches, contentIndex, type BranchBackendKind, type ContentRow } from "./schema";

/** Branch names: kebab segments, optionally slash-separated (e.g. `preview/checkout`). */
const BRANCH_NAME = /^[a-z0-9]+(?:[-/][a-z0-9]+)*$/;

/**
 * How reads scope to a branch. `overlay` carries the ancestor chain (leaf-first)
 * and the branch writes land on; `physical` is a self-contained Postgres.
 */
export type BranchScope =
  | { kind: "overlay"; chain: string[]; writeBranch: string }
  | { kind: "physical"; branch: string };

/** The branch chain (leaf-first) a scope reads across — one element when there's no overlay. */
export function scopeChain(scope: BranchScope): string[] {
  return scope.kind === "overlay" ? scope.chain : [scope.branch];
}

export interface BranchMeta {
  name: string;
  parent: string | null;
  backend: BranchBackendKind;
  status: string;
  createdAt: Date;
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
 * Register a branch in the topology. Overlay branches are instant — this is one
 * row insert, no data copied (Spike B). Validates the name is URL-safe and the
 * parent exists; a duplicate name is `BRANCH_EXISTS`.
 */
export async function createBranch(db: Database, input: CreateBranchInput): Promise<BranchMeta> {
  const from = input.from ?? "main";

  if (!BRANCH_NAME.test(input.name)) {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `"${input.name}" is not a valid branch name.`,
      fix: 'Use lowercase letters, digits, single hyphens, and optional "/" segments (e.g. "preview/checkout").',
      details: { name: input.name },
    });
  }
  if (input.name === from) {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `A branch cannot be its own parent ("${input.name}").`,
      fix: "Fork from a different branch, or omit --from to fork from main.",
      details: { name: input.name },
    });
  }

  await assertBranchExists(db, from);

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

/**
 * Remove a branch from the registry. Refuses to drop `main` or a branch that
 * still has children (drop those first). Does not delete the branch's rows —
 * that (and the neon-endpoint teardown) is `graft branch --delete`'s job in P4.2.
 */
export async function dropBranch(db: Database, name: string): Promise<void> {
  if (name === "main") {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: "The main branch cannot be dropped.",
      fix: "main is the root of the topology; create and drop preview branches off it instead.",
      details: { name },
    });
  }
  await assertBranchExists(db, name);

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

  await db.delete(branches).where(eq(branches.name, name));
}

async function assertBranchExists(db: Database, name: string): Promise<void> {
  const rows = await db
    .select({ name: branches.name })
    .from(branches)
    .where(eq(branches.name, name))
    .limit(1);
  if (rows.length === 0) {
    throw new GraftError({
      code: "BRANCH_NOT_FOUND",
      message: `Branch "${name}" is not registered.`,
      fix: 'Register it first (createBranch / graft branch). "main" is seeded; fork previews from it.',
      details: { name },
    });
  }
}

function toMeta(row: typeof branches.$inferSelect): BranchMeta {
  return {
    name: row.name,
    parent: row.parent,
    backend: row.backend as BranchBackendKind,
    status: row.status,
    createdAt: row.createdAt,
  };
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
