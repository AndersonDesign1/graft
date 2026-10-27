/**
 * Integration: database-sourced content against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { projectPublishedContent } from "./content";
import { runMigrations } from "./migrate";
import {
  createReview,
  currentFiles,
  discardDrafts,
  draftHeads,
  importPublished,
  mirroredVersions,
  openReviews,
  publishedSince,
  recordMirrored,
  withMirrorLock,
  publishDrafts,
  publishedFiles,
  publishedHistory,
  readHead,
  readPublishedRevision,
  recentlyPublished,
  writeDraft,
  type RevisionActor,
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

  it("builds the index rows from what is live once the lock is held, and a refusal publishes nothing", async () => {
    const first = doc("First");
    await save("posts/first.mdx", first);
    await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/first.mdx", version: sha(first) }],
      actor: ana,
      index: { upserts: [row("first", first)], removals: [] },
    });

    const second = doc("Second");
    await save("posts/second.mdx", second);
    const seen: string[][] = [];
    const refused = publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/second.mdx", version: sha(second) }],
      actor: ana,
      index: (live) => {
        seen.push(live.map((doc) => `${doc.collection}/${doc.slug}`));
        throw new Error("refused by the caller's check");
      },
    });
    await expect(refused).rejects.toThrow("refused by the caller's check");
    // It saw the publish that landed before it.
    expect(seen).toEqual([["posts/first"]]);
    // And published nothing: the draft is still a draft.
    expect((await draftHeads(handle.db, BRANCH)).map((head) => head.path)).toEqual([
      "posts/second.mdx",
    ]);
    expect((await publishedFiles(handle.db, BRANCH)).map((file) => file.path)).toEqual([
      "posts/first.mdx",
    ]);
  });

  it("refuses a draft claiming a slug another live document holds, and publishes nothing", async () => {
    await save("posts/home.mdx", doc("Home"));
    await publishDrafts(handle.db, {
      branchId: BRANCH,
      drafts: [{ path: "posts/home.mdx", version: sha(doc("Home")) }],
      actor: ana,
      index: { upserts: [row("home", doc("Home"))], removals: [] },
    });
    await save("posts/other.mdx", doc("Other"));
    await expect(
      publishDrafts(handle.db, {
        branchId: BRANCH,
        drafts: [{ path: "posts/other.mdx", version: sha(doc("Other")) }],
        actor: ana,
        index: {
          upserts: [{ ...row("home", doc("Other")), sourcePath: "posts/other.mdx" }],
          removals: [],
        },
      }),
    ).rejects.toMatchObject({ code: "SLUG_NOT_UNIQUE" });
    expect((await draftHeads(handle.db, BRANCH)).map((h) => h.path)).toEqual(["posts/other.mdx"]);
  });

  it("projects the published revisions into the index under the content lock", async () => {
    const actor = { id: "jo" };
    await importPublished(handle.db, {
      branchId: BRANCH,
      files: ["a", "b"].map((slug) => ({
        path: `posts/${slug}.mdx`,
        raw: doc(slug),
        version: sha(doc(slug)),
      })),
      actor,
    });
    const changes = await projectPublishedContent(
      handle.db,
      (files) => files.map((file) => row(file.path.slice(6, -4), file.raw)),
      { branchId: BRANCH },
    );
    expect(changes).toEqual({
      added: ["posts/a", "posts/b"],
      changed: [],
      removed: [],
      unchanged: 0,
    });
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
      ok: true,
      imported: ["posts/a.mdx", "posts/b.mdx"],
      unchanged: [],
      kept: [],
    });
    expect((await publishedFiles(handle.db, BRANCH)).map((f) => f.path)).toEqual([
      "posts/a.mdx",
      "posts/b.mdx",
    ]);
    expect(await importPublished(handle.db, { branchId: BRANCH, files, actor })).toEqual({
      ok: true,
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
      ok: true,
      imported: [],
      unchanged: [],
      kept: ["posts/a.mdx"],
    });
    expect((await readHead(handle.db, BRANCH, "posts/a.mdx"))?.published?.raw).toBe(doc("Live"));
  });

  it("refuses a push based on a version someone else replaced, writing nothing", async () => {
    const actor = { id: "jo" };
    const v1 = { path: "posts/a.mdx", raw: doc("V1"), version: sha(doc("V1")) };
    await importPublished(handle.db, { branchId: BRANCH, files: [v1], actor });
    // Ana publishes over it in Studio.
    await importPublished(handle.db, {
      branchId: BRANCH,
      files: [
        { path: "posts/a.mdx", raw: doc("Ana"), version: sha(doc("Ana")), expected: v1.version },
      ],
      actor: ana,
    });
    const result = await importPublished(handle.db, {
      branchId: BRANCH,
      files: [
        { path: "posts/a.mdx", raw: doc("Jo"), version: sha(doc("Jo")), expected: v1.version },
        { path: "posts/b.mdx", raw: doc("B"), version: sha(doc("B")), expected: null },
      ],
      actor,
    });
    expect(result).toEqual({
      ok: false,
      stale: [{ path: "posts/a.mdx", expected: v1.version, current: sha(doc("Ana")) }],
    });
    expect((await publishedFiles(handle.db, BRANCH)).map((f) => f.raw)).toEqual([doc("Ana")]);
  });

  it("overwrites what is published when a push is forced", async () => {
    const actor = { id: "jo" };
    const file = (title: string) => ({
      path: "posts/a.mdx",
      raw: doc(title),
      version: sha(doc(title)),
    });
    await importPublished(handle.db, { branchId: BRANCH, files: [file("Live")], actor });
    expect(
      await importPublished(handle.db, {
        branchId: BRANCH,
        files: [file("Mine")],
        actor,
        replace: true,
      }),
    ).toMatchObject({ ok: true, imported: ["posts/a.mdx"], kept: [] });
    expect((await readHead(handle.db, BRANCH, "posts/a.mdx"))?.published?.raw).toBe(doc("Mine"));
  });

  it("publishes a pushed deletion, and lists what was published since a moment", async () => {
    const before = new Date(Date.now() - 1000);
    const a = { path: "posts/a.mdx", raw: doc("A"), version: sha(doc("A")) };
    await importPublished(handle.db, { branchId: BRANCH, files: [a], actor: ana });
    await importPublished(handle.db, {
      branchId: BRANCH,
      files: [{ path: "posts/a.mdx", raw: null, version: null, expected: a.version }],
      actor: ana,
    });
    expect(await publishedFiles(handle.db, BRANCH)).toEqual([]);
    const since = await publishedSince(handle.db, BRANCH, before);
    expect(since.map((c) => [c.path, c.version, c.publishedBy])).toEqual([
      ["posts/a.mdx", a.version, "Ana"],
      ["posts/a.mdx", null, "Ana"],
    ]);
  });

  it("lets one mirror run at a time per branch", async () => {
    // The first run signals once it holds the lock and then waits to be
    // released, so the second always arrives while the lock is held. No
    // timing guess: the order is the test's, not the scheduler's.
    let entered!: () => void;
    let release!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const first = withMirrorLock(handle.db, BRANCH, async () => {
      entered();
      await released;
      return "first";
    });
    await inside;
    const second = await withMirrorLock(handle.db, BRANCH, async () => "second");
    release();
    expect([await first, second]).toEqual(["first", undefined]);
    await recordMirrored(handle.db, BRANCH, [{ path: "posts/a.mdx", version: "abc" }], "c0ffee");
    expect(await mirroredVersions(handle.db, BRANCH)).toEqual(new Map([["posts/a.mdx", "abc"]]));
    await handle.sql`delete from content_mirror where branch_id = ${BRANCH}`;
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

  it("keeps every published revision as history, newest first, and reads any of them", async () => {
    const publish = async (raw: string, actor: RevisionActor = ana) => {
      await save("posts/h.mdx", raw, { actor });
      await publishDrafts(handle.db, {
        branchId: BRANCH,
        drafts: [{ path: "posts/h.mdx", version: sha(raw) }],
        actor: ana,
        index: { upserts: [{ ...row("h", raw), sourcePath: "posts/h.mdx" }], removals: [] },
      });
    };
    await publish(doc("One"));
    await publish(doc("Two"), { ...ben, kind: "agent" });
    // A draft is not history until it is published.
    await save("posts/h.mdx", doc("Three"));

    const history = await publishedHistory(handle.db, BRANCH, "posts/h.mdx");
    expect(history.map((r) => [r.actorName, r.actorKind, r.publishedBy])).toEqual([
      ["Ben", "agent", "Ana"],
      ["Ana", "human", "Ana"],
    ]);
    const first = history[1]?.id as string;
    expect(await readPublishedRevision(handle.db, BRANCH, "posts/h.mdx", first)).toEqual({
      raw: doc("One"),
      version: sha(doc("One")),
    });
    // Another path's revision, and an id that isn't one, are not found.
    expect(await readPublishedRevision(handle.db, BRANCH, "posts/x.mdx", first)).toBeUndefined();
    expect(await readPublishedRevision(handle.db, BRANCH, "posts/h.mdx", "nope")).toBeUndefined();

    expect((await recentlyPublished(handle.db, BRANCH, 1)).map((r) => r.version)).toEqual([
      sha(doc("Two")),
    ]);
  });
});
