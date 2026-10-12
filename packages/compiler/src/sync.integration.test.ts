/**
 * Integration: pulling and pushing between a database-sourced project and a
 * checkout, against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@usegraft/core";
import { createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseStore } from "./store/database";
import { pullContent, pushContent, syncStatus } from "./sync";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "sync-it";
const TIMEOUT = 30_000;
const collections = {
  posts: defineCollection({ name: "posts", fields: { title: field.string() } }),
};
const post = (title: string) => `---\ntitle: ${title}\n---\n\nAbout ${title}.\n`;
const ana = { id: "ana", name: "Ana" };
const jo = { id: "jo", name: "Jo" };

describe.skipIf(!runIntegration)("pull and push (integration)", () => {
  let handle: DbHandle;
  let store: DatabaseStore;
  let project: string;
  let contentDir: string;
  let stateFile: string;

  const opts = () => ({ db: handle.db, contentDir, stateFile, branchId: BRANCH });
  const file = (path: string) => join(contentDir, path);
  const publish = async (path: string, raw: string | null) => {
    await store.write(path, raw, { actor: ana });
    await store.drafts.publish({ actor: ana, paths: [path] });
  };
  const live = async () =>
    (
      await handle.sql`select slug, data->>'title' as title from content_index where branch_id = ${BRANCH} and not deleted order by slug`
    ).map((row) => `${row.slug}:${row.title}`);

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
    store = new DatabaseStore({ db: handle.db, collections, branchId: BRANCH });
  }, TIMEOUT);

  beforeEach(async () => {
    for (const table of [
      "content_heads",
      "content_revisions",
      "content_reviews",
      "content_index",
      "compilations",
    ]) {
      await handle.sql`delete from ${handle.sql(table)} where branch_id = ${BRANCH}`;
    }
    project = mkdtempSync(join(tmpdir(), "graft-sync-"));
    contentDir = join(project, "content");
    stateFile = join(project, ".graft", "sync.json");
    mkdirSync(join(contentDir, "posts"), { recursive: true });
  }, TIMEOUT);

  afterAll(async () => {
    await handle.close();
  });

  it("pulls what was published, and then reports everything in sync", async () => {
    await publish("posts/hello.mdx", post("Hello"));
    expect((await syncStatus(opts())).map((e) => [e.path, e.state])).toEqual([
      ["posts/hello.mdx", "behind"],
    ]);
    expect(await pullContent(opts())).toEqual({
      updated: ["posts/hello.mdx"],
      kept: [],
      conflicts: [],
    });
    expect(readFileSync(file("posts/hello.mdx"), "utf8")).toBe(post("Hello"));
    expect((await syncStatus(opts())).map((e) => e.state)).toEqual(["in-sync"]);
  });

  it("pushes a local edit live, and the index follows", async () => {
    await publish("posts/hello.mdx", post("Hello"));
    await pullContent(opts());
    writeFileSync(file("posts/hello.mdx"), post("Hello again"));
    expect((await syncStatus(opts()))[0]?.state).toBe("ahead");
    const result = await pushContent({ ...opts(), collections, actor: jo });
    expect(result).toMatchObject({ pushed: ["posts/hello.mdx"], conflicts: [] });
    expect(await live()).toEqual(["hello:Hello again"]);
    expect((await syncStatus(opts()))[0]?.state).toBe("in-sync");
  });

  it("keeps a local edit when pulling, instead of overwriting it", async () => {
    await publish("posts/a.mdx", post("A"));
    await pullContent(opts());
    writeFileSync(file("posts/a.mdx"), post("Mine"));
    expect(await pullContent(opts())).toMatchObject({ kept: ["posts/a.mdx"], updated: [] });
    expect(readFileSync(file("posts/a.mdx"), "utf8")).toBe(post("Mine"));
  });

  it("refuses to push over an edit published since the last pull", async () => {
    await publish("posts/a.mdx", post("A"));
    await pullContent(opts());
    writeFileSync(file("posts/a.mdx"), post("Jo's"));
    await publish("posts/a.mdx", post("Ana's"));
    expect((await syncStatus(opts()))[0]?.state).toBe("conflict");
    await expect(pushContent({ ...opts(), collections, actor: jo })).rejects.toMatchObject({
      code: "CONTENT_CONFLICT",
    });
    expect(await live()).toEqual(["a:Ana's"]);
    // Pulling reports it and keeps the file.
    expect(await pullContent(opts())).toMatchObject({ conflicts: ["posts/a.mdx"] });
    expect(readFileSync(file("posts/a.mdx"), "utf8")).toBe(post("Jo's"));
    // Forcing the push publishes the file over it.
    await pushContent({ ...opts(), collections, actor: jo, force: true });
    expect(await live()).toEqual(["a:Jo's"]);
  });

  it("pushes a deleted file as a deletion, and pulls one by removing the file", async () => {
    await publish("posts/a.mdx", post("A"));
    await publish("posts/b.mdx", post("B"));
    await pullContent(opts());
    rmSync(file("posts/a.mdx"));
    await pushContent({ ...opts(), collections, actor: jo });
    expect(await live()).toEqual(["b:B"]);
    await publish("posts/b.mdx", null);
    await pullContent(opts());
    expect(existsSync(file("posts/b.mdx"))).toBe(false);
  });

  it("refuses to push a file the schema rejects, and writes nothing", async () => {
    writeFileSync(file("posts/bad.mdx"), "---\nheadline: no title\n---\n");
    await expect(pushContent({ ...opts(), collections, actor: jo })).rejects.toMatchObject({
      code: "SCHEMA_VALIDATION_FAILED",
    });
    expect(await live()).toEqual([]);
  });

  it("pulls only what --only names", async () => {
    await publish("posts/a.mdx", post("A"));
    await publish("posts/b.mdx", post("B"));
    expect(await pullContent({ ...opts(), only: ["posts/b"] })).toMatchObject({
      updated: ["posts/b.mdx"],
    });
    expect(existsSync(file("posts/a.mdx"))).toBe(false);
  });
});
