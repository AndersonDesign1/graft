/**
 * Integration: copy-on-write branch overlay against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env is auto-loaded).
 *
 * Proves the Spike B overlay end-to-end: a child branch inherits the parent's
 * content with zero copy, a branch override wins over the inherited doc, a
 * branch tombstone hides an inherited doc, and the parent stays isolated.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countBranchRows,
  createBranch,
  dropBranch,
  getBranch,
  listBranches,
  moveDataRecords,
  readContent,
  resolveBranchScope,
  scopeChain,
} from "./branch";
import { createDb, type DbHandle } from "./client";
import { projectBranchContent } from "./content";
import { branches, dataRecords, migrationsApplied } from "./schema";
import { searchContent } from "./search";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const PARENT = "it-branch-parent";
const CHILD = "it-branch-child";
const SCRATCH = "it-branch-scratch";

const doc = (slug: string, title: string, body: string, hash: string) => ({
  collection: "pages",
  slug,
  data: { title },
  body,
  contentHash: hash,
  sourcePath: `pages/${slug}.mdx`,
});

describe.skipIf(!runIntegration)("branch overlay (live)", () => {
  let handle: DbHandle;

  async function cleanup() {
    for (const branch of [SCRATCH, CHILD, PARENT]) {
      await handle.sql`delete from content_index where branch_id = ${branch}`;
      await handle.sql`delete from compilations where branch_id = ${branch}`;
      await handle.sql`delete from data_records where branch_id = ${branch}`;
      await handle.sql`delete from migrations_applied where branch_id = ${branch}`;
      await handle.sql`delete from branches where name = ${branch}`;
    }
    await handle.sql`delete from data_records where collection = 'it-branch-things'`;
  }

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    await cleanup();
    // The parent is its own root (chain of one → the fast, non-overlay path).
    await handle.db.insert(branches).values({ name: PARENT, parent: null, backend: "overlay" });
    await projectBranchContent(
      handle.db,
      [
        doc("home", "Home (parent)", "Parent home body.", "p-home"),
        doc("about", "About (parent)", "Parent about body.", "p-about"),
        doc("pricing", "Pricing (parent)", "Parent pricing body about tracing.", "p-pricing"),
      ],
      { branchId: PARENT },
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await cleanup();
    await handle.close();
  }, TEST_TIMEOUT);

  it(
    "createBranch registers a child; resolveBranchScope walks the chain leaf-first",
    async () => {
      const meta = await createBranch(handle.db, { name: CHILD, from: PARENT });
      expect(meta).toMatchObject({ name: CHILD, parent: PARENT, backend: "overlay" });

      const scope = await resolveBranchScope(handle.db, CHILD);
      expect(scope).toEqual({ kind: "overlay", chain: [CHILD, PARENT], writeBranch: CHILD });
    },
    TEST_TIMEOUT,
  );

  it(
    "a fresh child inherits every parent doc with zero rows copied",
    async () => {
      const scope = await resolveBranchScope(handle.db, CHILD);
      const rows = await readContent(handle.db, scope, { collection: "pages" });
      expect(rows.map((r) => r.slug)).toEqual(["about", "home", "pricing"]);

      const [copied] = await handle.sql`
        select count(*)::int as count from content_index where branch_id = ${CHILD}
      `;
      expect(copied?.count).toBe(0); // pure overlay — nothing was duplicated
    },
    TEST_TIMEOUT,
  );

  it(
    "a branch override wins over the inherited doc, leaving the parent untouched",
    async () => {
      await projectBranchContent(
        handle.db,
        [doc("home", "Home (child override)", "Child home body.", "c-home")],
        { branchId: CHILD },
      );

      const scope = await resolveBranchScope(handle.db, CHILD);
      const home = await readContent(handle.db, scope, { collection: "pages", slug: "home" });
      expect(home).toHaveLength(1);
      expect(home[0]?.data).toMatchObject({ title: "Home (child override)" });

      // about + pricing still inherited; the collection view is complete.
      const all = await readContent(handle.db, scope, { collection: "pages" });
      expect(all.map((r) => r.slug)).toEqual(["about", "home", "pricing"]);

      const parentScope = await resolveBranchScope(handle.db, PARENT);
      const parentHome = await readContent(handle.db, parentScope, {
        collection: "pages",
        slug: "home",
      });
      expect(parentHome[0]?.data).toMatchObject({ title: "Home (parent)" });
    },
    TEST_TIMEOUT,
  );

  it(
    "a branch tombstone hides an inherited doc; the parent still has it live",
    async () => {
      // Write 'about' onto the child, then re-project without it → soft-deleted there.
      await projectBranchContent(
        handle.db,
        [
          doc("home", "Home (child override)", "Child home body.", "c-home"),
          doc("about", "About (child)", "Child about body.", "c-about"),
        ],
        { branchId: CHILD },
      );
      await projectBranchContent(
        handle.db,
        [doc("home", "Home (child override)", "Child home body.", "c-home")],
        { branchId: CHILD },
      );

      const scope = await resolveBranchScope(handle.db, CHILD);
      const all = await readContent(handle.db, scope, { collection: "pages" });
      expect(all.map((r) => r.slug)).toEqual(["home", "pricing"]); // 'about' hidden by the tombstone

      const parentScope = await resolveBranchScope(handle.db, PARENT);
      const parentAll = await readContent(handle.db, parentScope, { collection: "pages" });
      expect(parentAll.map((r) => r.slug)).toEqual(["about", "home", "pricing"]);
    },
    TEST_TIMEOUT,
  );

  it(
    "overlay search reflects the child's effective content (inherited match found, tombstone hidden)",
    async () => {
      const scope = await resolveBranchScope(handle.db, CHILD);

      // 'tracing' lives only in the inherited parent 'pricing' body → found via the chain.
      const tracing = await searchContent(handle.db, {
        query: "tracing",
        chain: scopeChain(scope),
      });
      expect(tracing.map((h) => h.row.slug)).toContain("pricing");

      // The tombstoned 'about' slug must never surface, even though a parent row exists.
      const about = await searchContent(handle.db, { query: "about", chain: scopeChain(scope) });
      expect(about.map((h) => h.row.slug)).not.toContain("about");
    },
    TEST_TIMEOUT,
  );

  it(
    "registry guards reject duplicate names, unknown parents, and dropping a parent with children",
    async () => {
      await expect(createBranch(handle.db, { name: CHILD, from: PARENT })).rejects.toMatchObject({
        code: "BRANCH_EXISTS",
      });
      await expect(
        createBranch(handle.db, { name: "it-branch-orphan", from: "no-such-parent" }),
      ).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND" });
      await expect(dropBranch(handle.db, PARENT)).rejects.toMatchObject({ code: "BRANCH_INVALID" });

      const names = (await listBranches(handle.db)).map((b) => b.name);
      expect(names).toEqual(expect.arrayContaining([PARENT, CHILD]));
    },
    TEST_TIMEOUT,
  );

  it(
    "getBranch returns the registry row; unregistered names are BRANCH_NOT_FOUND",
    async () => {
      const meta = await getBranch(handle.db, CHILD);
      expect(meta).toMatchObject({ name: CHILD, parent: PARENT, backend: "overlay" });
      await expect(getBranch(handle.db, "it-branch-nope")).rejects.toMatchObject({
        code: "BRANCH_NOT_FOUND",
      });
    },
    TEST_TIMEOUT,
  );

  it(
    "moveDataRecords folds a branch's rows onto the target (the merge data-delta step)",
    async () => {
      await createBranch(handle.db, { name: SCRATCH, from: PARENT });
      await handle.db.insert(dataRecords).values([
        { branchId: SCRATCH, collection: "it-branch-things", data: { n: 1 } },
        { branchId: SCRATCH, collection: "it-branch-things", data: { n: 2 } },
      ]);

      const before = await countBranchRows(handle.db, SCRATCH);
      expect(before.data).toBe(2);

      const moved = await moveDataRecords(handle.db, { from: SCRATCH, into: PARENT });
      expect(moved).toBe(2);

      const after = await countBranchRows(handle.db, SCRATCH);
      expect(after.data).toBe(0);
      const parent = await countBranchRows(handle.db, PARENT);
      expect(parent.data).toBe(2);
    },
    TEST_TIMEOUT,
  );

  it(
    "dropBranch with purgeRows deletes the branch's data-plane rows atomically",
    async () => {
      // Give the scratch branch one row in each purged table.
      await projectBranchContent(
        handle.db,
        [doc("scratch-only", "Scratch", "Scratch body.", "s-1")],
        { branchId: SCRATCH },
      );
      await handle.db
        .insert(dataRecords)
        .values({ branchId: SCRATCH, collection: "it-branch-things", data: { n: 3 } });
      await handle.db.insert(migrationsApplied).values({
        branchId: SCRATCH,
        migrationId: "0001-it-branch-test",
        kind: "data",
        collection: "it-branch-things",
        docCount: 1,
      });

      const result = await dropBranch(handle.db, SCRATCH, { purgeRows: true });
      expect(result.purged).toEqual({ content: 1, data: 1, ledger: 1 });

      const counts = await countBranchRows(handle.db, SCRATCH);
      expect(counts).toEqual({ content: 0, data: 0, ledger: 0 });
      await expect(getBranch(handle.db, SCRATCH)).rejects.toMatchObject({
        code: "BRANCH_NOT_FOUND",
      });
      // The rows moved onto the parent in the previous test are untouched.
      const parent = await countBranchRows(handle.db, PARENT);
      expect(parent.data).toBe(2);
    },
    TEST_TIMEOUT,
  );
});
