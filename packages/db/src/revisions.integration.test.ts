/**
 * Integration: database-sourced content against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { runMigrations } from "./migrate";
import {
  createReview,
  currentFiles,
  discardDrafts,
  draftHeads,
  importPublished,
  openReviews,
  publishDrafts,
  publishedFiles,
  readHead,
  writeDraft,
} from "./revisions";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const BRANCH = `it-revisions-${randomUUID().slice(0, 8)}`;
const ana = { id: "ana@example.com", name: "Ana" };
const ben = { id: "ben@example.com", name: "Ben" };

const sha = (raw: string): string =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(raw)}\0`)
    .update(raw)
    .digest("hex");

const doc = (title: string): string => `---\ntitle: ${title}\n---\n\nBody of ${title}.\n`;

const row = (slug: string, raw: string) => ({
  collection: "posts",
  slug,
  data: { title: slug },
  body: raw,
  contentHash: sha(raw),
  sourcePath: `posts/${slug}.mdx`,
});

describe.skipIf(!runIntegration)("database-sourced content (live)", () => {
  let handle: DbHandle;

  const reset = async () => {
    await handle.sql`delete from content_heads where branch_id = ${BRANCH}`;
    await handle.sql`delete from content_revisions where branch_id = ${BRANCH}`;
    await handle.sql`delete from content_reviews where branch_id = ${BRANCH}`;
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
  };

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
  }, TEST_TIMEOUT);

  beforeEach(reset, TEST_TIMEOUT);

  afterAll(async () => {
    await reset();
    await handle.close();
  }, TEST_TIMEOUT);

  const save = (
    path: string,
    raw: string | null,
    extra: Partial<Parameters<typeof writeDraft>[1]> = {},
  ) =>
    writeDraft(handle.db, {
      branchId: BRANCH,
      path,
      raw,
      version: raw === null ? null : sha(raw),
      actor: ana,
      ...extra,
    });

  it("saves a new entry as a draft that nothing live can see", async () => {
    const raw = doc("Hello");
    expect(await save("posts/hello.mdx", raw, { baseVersion: null })).toEqual({
      ok: true,
      version: sha(raw),
    });
    expect(await currentFiles(handle.db, BRANCH, "posts/")).toEqual([
      { path: "posts/hello.mdx", raw, version: sha(raw) },
    ]);
    expect(await publishedFiles(handle.db, BRANCH)).toEqual([]);
  });

  it("refuses a save from a stale version and writes nothing", async () => {
    const first = doc("One");
    await save("posts/a.mdx", first, { baseVersion: null });
    const result = await save("posts/a.mdx", doc("Two"), { baseVersion: "not-the-version" });
    expect(result).toEqual({ ok: false, current: sha(first) });
    expect((await readHead(handle.db, BRANCH, "posts/a.mdx"))?.draft?.raw).toBe(first);
  });

  it("refuses a create when the path already exists", async () => {
    await save("posts/a.mdx", doc("One"), { baseVersion: null });
    expect(await save("posts/a.mdx", doc("Again"), { baseVersion: null })).toEqual({
      ok: false,
      current: sha(doc("One")),
    });
  });

  it("keeps one revision per sitting, and a new one when someone else edits", async () => {
    await save("posts/a.mdx", doc("One"));
    await save("posts/a.mdx", doc("One, edited"));
    const [{ n: afterAna }] =
      await handle.sql`select count(*)::int as n from content_revisions where branch_id = ${BRANCH}`;
    expect(afterAna).toBe(1);
    await save("posts/a.mdx", doc("Ben's"), { actor: ben });
    const [{ n: afterBen }] =
      await handle.sql`select count(*)::int as n from content_revisions where branch_id = ${BRANCH}`;
    expect(afterBen).toBe(2);
  });

  it("publishes drafts into the index in one step, and clears them", async () => {
    const raw = doc("Live");
    await save("posts/live.mdx", raw);
    const result = await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/live.mdx", version: sha(raw) }],
      actor: ana,
      index: { upserts: [row("live", raw)], removals: [] },
    });
    expect(result).toEqual({
      ok: true,
      published: ["posts/live.mdx"],
      changes: { added: ["posts/live"], changed: [], removed: [], unchanged: 0 },
    });
    expect(await publishedFiles(handle.db, BRANCH)).toEqual([
      { path: "posts/live.mdx", raw, version: sha(raw) },
    ]);
    expect(await draftHeads(handle.db, BRANCH)).toEqual([]);
    const indexed =
      await handle.sql`select slug, deleted from content_index where branch_id = ${BRANCH}`;
    expect(indexed.map((r) => ({ ...r }))).toEqual([{ slug: "live", deleted: false }]);
    const [compiled] =
      await handle.sql`select git_sha, doc_count, added from compilations where branch_id = ${BRANCH}`;
    expect({ ...compiled }).toEqual({ git_sha: null, doc_count: 1, added: 1 });
  });

  it("publishes nothing when one of the drafts changed since it was checked", async () => {
    await save("posts/a.mdx", doc("A"));
    await save("posts/b.mdx", doc("B"));
    const result = await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [
        { path: "posts/a.mdx", version: sha(doc("A")) },
        { path: "posts/b.mdx", version: "stale" },
      ],
      actor: ana,
      index: { upserts: [row("a", doc("A")), row("b", doc("B"))], removals: [] },
    });
    expect(result).toEqual({ ok: false, stale: ["posts/b.mdx"] });
    expect(await publishedFiles(handle.db, BRANCH)).toEqual([]);
    const indexed = await handle.sql`select 1 from content_index where branch_id = ${BRANCH}`;
    expect(indexed.length).toBe(0);
  });

  it("treats a draft that matches the live version as no draft", async () => {
    const raw = doc("Live");
    await save("posts/live.mdx", raw);
    await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/live.mdx", version: sha(raw) }],
      actor: ana,
      index: { upserts: [row("live", raw)], removals: [] },
    });
    await save("posts/live.mdx", doc("Changed"));
    expect((await draftHeads(handle.db, BRANCH)).map((h) => h.path)).toEqual(["posts/live.mdx"]);
    await save("posts/live.mdx", raw);
    expect(await draftHeads(handle.db, BRANCH)).toEqual([]);
  });

  it("publishes a deletion as a removal from the index, keeping the revisions", async () => {
    const raw = doc("Gone soon");
    await save("posts/gone.mdx", raw);
    await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/gone.mdx", version: sha(raw) }],
      actor: ana,
      index: { upserts: [row("gone", raw)], removals: [] },
    });
    await save("posts/gone.mdx", null);
    expect(await currentFiles(handle.db, BRANCH)).toEqual([]);
    const result = await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/gone.mdx", version: null }],
      actor: ana,
      index: { upserts: [], removals: [{ collection: "posts", slug: "gone" }] },
    });
    expect(result.ok && result.changes.removed).toEqual(["posts/gone"]);
    expect(await publishedFiles(handle.db, BRANCH)).toEqual([]);
    const [{ n }] =
      await handle.sql`select count(*)::int as n from content_revisions where branch_id = ${BRANCH}`;
    expect(n).toBe(2);
  });

  it("discards a draft, and a never-published entry with it", async () => {
    const live = doc("Live");
    await save("posts/live.mdx", live);
    await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/live.mdx", version: sha(live) }],
      actor: ana,
      index: { upserts: [row("live", live)], removals: [] },
    });
    await save("posts/live.mdx", doc("Edit"));
    await save("posts/new.mdx", doc("New"));
    await discardDrafts(handle.db, {
      branchId: BRANCH,
      paths: ["posts/live.mdx", "posts/new.mdx"],
    });
    expect(await currentFiles(handle.db, BRANCH)).toEqual([
      { path: "posts/live.mdx", raw: live, version: sha(live) },
    ]);
    expect(await readHead(handle.db, BRANCH, "posts/new.mdx")).toBeUndefined();
  });

  it("serialises two saves of one entry from the same starting version", async () => {
    await save("posts/race.mdx", doc("Start"), { baseVersion: null });
    const base = sha(doc("Start"));
    const results = await Promise.all([
      save("posts/race.mdx", doc("Tab one"), { baseVersion: base }),
      save("posts/race.mdx", doc("Tab two"), { baseVersion: base, actor: ben }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("imports files as live revisions, and a second import changes nothing", async () => {
    const files = [
      { path: "posts/a.mdx", raw: doc("A"), version: sha(doc("A")) },
      { path: "posts/b.mdx", raw: doc("B"), version: sha(doc("B")) },
    ];
    const actor = { id: "jo", name: "Jo", kind: "human" as const };
    expect(await importPublished(handle.db, { branchId: BRANCH, files, actor })).toEqual({
      imported: ["posts/a.mdx", "posts/b.mdx"],
      unchanged: [],
      kept: [],
    });
    expect((await publishedFiles(handle.db, BRANCH)).map((f) => f.path)).toEqual([
      "posts/a.mdx",
      "posts/b.mdx",
    ]);
    expect(await importPublished(handle.db, { branchId: BRANCH, files, actor })).toEqual({
      imported: [],
      unchanged: ["posts/a.mdx", "posts/b.mdx"],
      kept: [],
    });
  });

  it("never overwrites a document that is already published", async () => {
    const actor = { id: "jo" };
    const file = (title: string) => ({
      path: "posts/a.mdx",
      raw: doc(title),
      version: sha(doc(title)),
    });
    await importPublished(handle.db, { branchId: BRANCH, files: [file("Live")], actor });
    expect(
      await importPublished(handle.db, { branchId: BRANCH, files: [file("Old file")], actor }),
    ).toEqual({
      imported: [],
      unchanged: [],
      kept: ["posts/a.mdx"],
    });
    expect((await readHead(handle.db, BRANCH, "posts/a.mdx"))?.published?.raw).toBe(doc("Live"));
  });

  it("keeps a draft on top of an imported revision", async () => {
    await save("posts/a.mdx", doc("Draft"));
    await importPublished(handle.db, {
      branchId: BRANCH,
      files: [{ path: "posts/a.mdx", raw: doc("A"), version: sha(doc("A")) }],
      actor: { id: "jo" },
    });
    const head = await readHead(handle.db, BRANCH, "posts/a.mdx");
    expect([head?.published?.raw, head?.draft?.raw]).toEqual([doc("A"), doc("Draft")]);
  });

  it("records review requests and lists the open ones", async () => {
    await save("posts/a.mdx", doc("A"));
    const review = await createReview(handle.db, {
      branchId: BRANCH,
      paths: ["posts/a.mdx"],
      title: "Spring sale",
      actor: ben,
    });
    expect((await openReviews(handle.db, BRANCH)).map((r) => r.id)).toEqual([review?.id]);
  });

  it("files no review when the drafts are already gone", async () => {
    expect(
      await createReview(handle.db, {
        branchId: BRANCH,
        paths: ["posts/none.mdx"],
        title: "X",
        actor: ben,
      }),
    ).toBeNull();
    expect(await openReviews(handle.db, BRANCH)).toEqual([]);
  });

  it("withdraws a discarded path from its review, and closes an empty one unpublished", async () => {
    await save("posts/a.mdx", doc("A"));
    await save("posts/b.mdx", doc("B"));
    await createReview(handle.db, {
      branchId: BRANCH,
      paths: ["posts/a.mdx", "posts/b.mdx"],
      title: "Both",
      actor: ben,
    });
    await discardDrafts(handle.db, { branchId: BRANCH, paths: ["posts/a.mdx"] });
    expect((await openReviews(handle.db, BRANCH)).map((r) => r.paths)).toEqual([["posts/b.mdx"]]);
    await discardDrafts(handle.db, { branchId: BRANCH, paths: ["posts/b.mdx"] });
    expect(await openReviews(handle.db, BRANCH)).toEqual([]);
    const [row] = await handle.sql`select status from content_reviews where branch_id = ${BRANCH}`;
    expect(row?.status).toBe("closed");
  });

  it("refuses to rewrite a published revision, even by raw SQL", async () => {
    const raw = doc("Live");
    await save("posts/live.mdx", raw);
    await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/live.mdx", version: sha(raw) }],
      actor: ana,
      index: { upserts: [row("live", raw)], removals: [] },
    });
    await expect(
      handle.sql`update content_revisions set raw = 'tampered' where branch_id = ${BRANCH} and published_at is not null`,
    ).rejects.toThrow(/published revision/);
  });

  it("closes a review once everything in it is published", async () => {
    await save("posts/a.mdx", doc("A"));
    await save("posts/b.mdx", doc("B"));
    await createReview(handle.db, {
      branchId: BRANCH,
      paths: ["posts/a.mdx", "posts/b.mdx"],
      title: "Both",
      actor: ben,
    });
    const publish = (path: string, raw: string, slug: string) =>
      publishDrafts(handle.db, {
        branchId: BRANCH,
        drafts: [{ path, version: sha(raw) }],
        actor: ana,
        index: { upserts: [row(slug, raw)], removals: [] },
      });
    await publish("posts/a.mdx", doc("A"), "a");
    expect((await openReviews(handle.db, BRANCH)).map((r) => r.title)).toEqual(["Both"]);
    await publish("posts/b.mdx", doc("B"), "b");
    expect(await openReviews(handle.db, BRANCH)).toEqual([]);
  });
});
