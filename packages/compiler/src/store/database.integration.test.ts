/**
 * Integration: the database content store against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@usegraft/core";
import { createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compile } from "../compile";
import { DatabaseStore } from "./database";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = `store-db-it-${randomUUID().slice(0, 8)}`;
const TIMEOUT = 30_000;
const collections = {
  posts: defineCollection({ name: "posts", fields: { title: field.string() } }),
};
const linked = {
  topics: defineCollection({ name: "topics", fields: { title: field.string() } }),
  notes: defineCollection({
    name: "notes",
    fields: { title: field.string(), topic: field.reference({ to: "topics" }) },
  }),
};
const ana = { id: "ana@example.com", name: "Ana" };
const post = (title: string, body = "Hello.") => `---\ntitle: ${title}\n---\n\n${body}\n`;

describe.skipIf(!runIntegration)("DatabaseStore (integration)", () => {
  let handle: DbHandle;
  let store: DatabaseStore;

  const reset = async () => {
    for (const table of [
      "content_heads",
      "content_revisions",
      "content_reviews",
      "content_index",
      "compilations",
    ]) {
      await handle.sql`delete from ${handle.sql(table)} where branch_id = ${BRANCH}`;
    }
  };

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
    store = new DatabaseStore({ db: handle.db, collections, branchId: BRANCH });
  }, TIMEOUT);
  beforeEach(reset, TIMEOUT);
  afterAll(async () => {
    await reset();
    await handle.close();
  }, TIMEOUT);

  const liveSlugs = async () =>
    (
      await handle.sql`select slug from content_index where branch_id = ${BRANCH} and not deleted order by slug`
    ).map((r) => r.slug as string);

  it("keeps a draft off the live site until it is published", async () => {
    await store.write("posts/hello.mdx", post("Hello"), { actor: ana, baseVersion: null });
    expect(await store.read("posts/hello.mdx", ana)).toMatchObject({ raw: post("Hello") });
    expect(await store.read("posts/hello.mdx")).toBeNull();
    expect(await liveSlugs()).toEqual([]);
    expect(await store.drafts.changes(ana)).toEqual([
      { path: "posts/hello.mdx", kind: "added", version: expect.any(String), conflict: false },
    ]);

    const result = await store.drafts.publish({ actor: ana, paths: ["posts/hello.mdx"] });
    expect(result).toMatchObject({
      mode: "direct",
      commit: null,
      published: ["posts/hello.mdx"],
      changes: { added: ["posts/hello"], changed: [], removed: [], unchanged: 0 },
    });
    expect(await liveSlugs()).toEqual(["hello"]);
    expect(await store.drafts.changes(ana)).toEqual([]);
  });

  it("refuses to publish a draft the schema rejects, and leaves it a draft", async () => {
    await store.write("posts/bad.mdx", "---\nheadline: no title\n---\n", { actor: ana });
    await expect(
      store.drafts.publish({ actor: ana, paths: ["posts/bad.mdx"] }),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
    expect(await liveSlugs()).toEqual([]);
    expect((await store.drafts.changes(ana)).map((c) => c.path)).toEqual(["posts/bad.mdx"]);
  });

  it("refuses executable MDX at publish, as compile does", async () => {
    await store.write("posts/x.mdx", post("X", "{process.exit(1)}"), { actor: ana });
    await expect(
      store.drafts.publish({ actor: ana, paths: ["posts/x.mdx"] }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
  });

  it("refuses a slug another live entry already holds", async () => {
    await store.write("posts/home.mdx", post("Home"), { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["posts/home.mdx"] });
    await store.write("posts/other.mdx", "---\ntitle: Other\nslug: home\n---\n", { actor: ana });
    await expect(
      store.drafts.publish({ actor: ana, paths: ["posts/other.mdx"] }),
    ).rejects.toMatchObject({ code: "SLUG_NOT_UNIQUE" });
    expect(await liveSlugs()).toEqual(["home"]);
  });

  it("refuses a reference to a document that isn't live, and one a publish would break", async () => {
    const linkedStore = new DatabaseStore({ db: handle.db, collections: linked, branchId: BRANCH });
    const note = (topic: string) => `---\ntitle: Note\ntopic: ${topic}\n---\n`;
    await linkedStore.write("topics/wool.mdx", "---\ntitle: Wool\n---\n", { actor: ana });
    await linkedStore.drafts.publish({ actor: ana, paths: ["topics/wool.mdx"] });

    // A draft naming a topic only another draft holds can't go live alone.
    await linkedStore.write("notes/a.mdx", note("linen"), { actor: ana });
    await linkedStore.write("topics/linen.mdx", "---\ntitle: Linen\n---\n", { actor: ana });
    await expect(
      linkedStore.drafts.publish({ actor: ana, paths: ["notes/a.mdx"] }),
    ).rejects.toMatchObject({
      code: "CONTENT_REFERENCE_NOT_FOUND",
      details: { references: [{ sourcePath: "notes/a.mdx", field: "topic", slug: "linen" }] },
    });
    expect(await liveSlugs()).toEqual(["wool"]);
    // Published together, it resolves.
    await linkedStore.drafts.publish({ actor: ana, paths: ["notes/a.mdx", "topics/linen.mdx"] });
    expect(await liveSlugs()).toEqual(["a", "linen", "wool"]);

    // Deleting the topic a live note points at would leave the note pointing at nothing.
    await linkedStore.write("topics/linen.mdx", null, { actor: ana });
    await expect(
      linkedStore.drafts.publish({ actor: ana, paths: ["topics/linen.mdx"] }),
    ).rejects.toMatchObject({ code: "CONTENT_REFERENCE_NOT_FOUND" });
    expect(await liveSlugs()).toEqual(["a", "linen", "wool"]);
    // With the note moved to another topic in the same publish, it goes.
    await linkedStore.write("notes/a.mdx", note("wool"), { actor: ana });
    await linkedStore.drafts.publish({ actor: ana, paths: ["topics/linen.mdx", "notes/a.mdx"] });
    expect(await liveSlugs()).toEqual(["a", "wool"]);
  });

  it("refuses a stale save with CONTENT_CONFLICT", async () => {
    const { version } = await store.write("posts/a.mdx", post("A"), { actor: ana });
    await store.write("posts/a.mdx", post("A2"), { actor: { id: "ben" }, baseVersion: version });
    await expect(
      store.write("posts/a.mdx", post("A3"), { actor: ana, baseVersion: version }),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
  });

  it("publishes a deletion as a removal from the live site", async () => {
    await store.write("posts/gone.mdx", post("Gone"), { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["posts/gone.mdx"] });
    await store.write("posts/gone.mdx", null, { actor: ana });
    expect(await store.drafts.changes(ana)).toMatchObject([
      { path: "posts/gone.mdx", kind: "deleted" },
    ]);
    const result = await store.drafts.publish({ actor: ana, paths: ["posts/gone.mdx"] });
    expect(result.changes?.removed).toEqual(["posts/gone"]);
    expect(await liveSlugs()).toEqual([]);
  });

  it("takes the old slug off the live site when a published file changes its slug", async () => {
    await store.write("posts/moved.mdx", post("Moved"), { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["posts/moved.mdx"] });
    await store.write("posts/moved.mdx", "---\ntitle: Moved\nslug: elsewhere\n---\n", {
      actor: ana,
    });
    const result = await store.drafts.publish({ actor: ana, paths: ["posts/moved.mdx"] });
    expect(result.changes).toMatchObject({ added: ["posts/elsewhere"], removed: ["posts/moved"] });
    expect(await liveSlugs()).toEqual(["elsewhere"]);
  });

  it("files a review instead of publishing for someone who may not publish", async () => {
    await store.write("posts/sale.mdx", post("Sale"), { actor: ana });
    const result = await store.drafts.publish({
      actor: ana,
      paths: ["posts/sale.mdx"],
      mode: "review",
      message: "Spring sale",
    });
    expect(result).toMatchObject({
      mode: "review",
      published: ["posts/sale.mdx"],
      review: { title: "Spring sale" },
    });
    expect(await liveSlugs()).toEqual([]);
    expect((await store.drafts.reviews(ana)).map((r) => r.title)).toEqual(["Spring sale"]);
  });

  it("keeps every published version of a document, and reads any of them", async () => {
    const jo = { id: "jo", name: "Jo", kind: "agent" as const };
    await store.write("posts/h.mdx", post("One"), { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["posts/h.mdx"] });
    await store.write("posts/h.mdx", post("Two"), { actor: jo });
    await store.write("posts/other.mdx", post("Other"), { actor: jo });
    await store.drafts.publish({ actor: ana, paths: ["posts/h.mdx", "posts/other.mdx"] });
    // A draft is not history until it is published.
    await store.write("posts/h.mdx", post("Three"), { actor: ana });

    const history = await store.history("posts/h.mdx");
    expect(history.map((entry) => [entry.by, entry.byKind])).toEqual([
      ["Jo", "agent"],
      ["Ana", "human"],
    ]);
    expect((await store.readVersion("posts/h.mdx", history[1]?.id as string))?.raw).toBe(
      post("One"),
    );
    await expect(
      store.readVersion("posts/other.mdx", history[1]?.id as string),
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });

    // One publish of two documents is one entry in the activity feed.
    const activity = await store.activity();
    expect(activity.map((entry) => entry.paths?.sort())).toEqual([
      ["posts/h.mdx", "posts/other.mdx"],
      ["posts/h.mdx"],
    ]);
    expect(activity[0]?.by).toBe("Ana");
  });

  it("lists what an editor sees, and what the live site holds", async () => {
    await store.write("posts/live.mdx", post("Live"), { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["posts/live.mdx"] });
    await store.write("posts/draft.mdx", post("Draft"), { actor: ana });
    expect((await store.entries("posts/", ana)).map((f) => f.path)).toEqual([
      "posts/draft.mdx",
      "posts/live.mdx",
    ]);
    expect((await store.entries("posts/")).map((f) => f.path)).toEqual(["posts/live.mdx"]);
  });

  it("compiles the index from published revisions and never from files", async () => {
    await store.write("posts/one.mdx", post("One"), { actor: ana });
    await store.drafts.publish({ actor: ana, paths: ["posts/one.mdx"] });
    await store.write("posts/two.mdx", post("Two"), { actor: ana });
    await handle.sql`update content_index set deleted = true where branch_id = ${BRANCH}`;

    const result = await compile({
      db: handle.db,
      contentDir: "/nonexistent/content",
      collections,
      branchId: BRANCH,
      source: "database",
    });
    expect(result.count).toBe(1);
    expect(result.gitSha).toBeNull();
    expect(await liveSlugs()).toEqual(["one"]);
  });
});
