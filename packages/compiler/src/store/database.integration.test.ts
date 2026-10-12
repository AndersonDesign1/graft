/**
 * Integration: the database content store against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
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
const BRANCH = "store-db-it";
const TIMEOUT = 30_000;
const collections = {
  posts: defineCollection({ name: "posts", fields: { title: field.string() } }),
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
      published: [],
      review: { title: "Spring sale" },
    });
    expect(await liveSlugs()).toEqual([]);
    expect((await store.drafts.reviews(ana)).map((r) => r.title)).toEqual(["Spring sale"]);
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
