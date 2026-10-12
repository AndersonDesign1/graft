/**
 * Integration: the editor API over HTTP on a database-sourced project, against
 * a live database (opt-in). Saves are drafts in Postgres, publishing puts them
 * live with no rebuild, and nothing touches the content directory.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseStore } from "@usegraft/compiler";
import { defineCollection, field } from "@usegraft/core";
import { createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createStudioApiHandler } from "../api";
import type {
  DraftsDto,
  EntryDto,
  EntryList,
  PublishResultDto,
  SaveEntryResult,
  WorkspaceDto,
} from "../editor-types";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "studio-db-it";
const TIMEOUT = 30_000;
const ORIGIN = "http://localhost";

const collections = {
  posts: defineCollection({
    name: "posts",
    fields: { title: field.string({ label: "Title" }), summary: field.text({ optional: true }) },
  }),
};

describe.skipIf(!runIntegration)("editor API on the database store (integration)", () => {
  let handle: DbHandle;
  const contentDir = join(mkdtempSync(join(tmpdir(), "graft-studio-db-")), "content");

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

  const handlerFor = (scopes: string[]) =>
    createStudioApiHandler({
      db: handle.db,
      collections,
      contentDir,
      defaultBranch: BRANCH,
      store: new DatabaseStore({ db: handle.db, collections, branchId: BRANCH }),
      authenticate: () => ({ kind: "human", id: "ana", name: "Ana", scopes }),
    });

  async function call<T>(
    handler: ReturnType<typeof createStudioApiHandler>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: T }> {
    const response = await handler(
      new Request(`${ORIGIN}/api/studio/v1${path}`, {
        method,
        headers: { "content-type": "application/json", origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, json: (await response.json()) as T };
  }

  const live = async () =>
    (
      await handle.sql`select slug, data->>'title' as title from content_index where branch_id = ${BRANCH} and not deleted order by slug`
    ).map((row) => ({ ...row }));

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
  }, TIMEOUT);
  beforeEach(reset, TIMEOUT);
  afterAll(async () => {
    await reset();
    await handle.close();
  }, TIMEOUT);

  it("says where saves land, and what Publish does", async () => {
    const handler = handlerFor(["studio:read", "studio:write", "studio:publish"]);
    const workspace = await call<WorkspaceDto>(handler, "GET", "/workspace");
    expect(workspace.json).toMatchObject({ storage: "database", publish: "publish" });
  });

  it("creates, edits and publishes an entry straight onto the live site", async () => {
    const handler = handlerFor(["studio:read", "studio:write", "studio:publish"]);
    const created = await call<SaveEntryResult>(handler, "POST", "/entry", {
      collection: "posts",
      data: { title: "Hello there" },
      body: "First post.",
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ slug: "hello-there", status: "new" });

    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=posts&slug=hello-there");
    const saved = await call<SaveEntryResult>(handler, "PUT", "/entry", {
      collection: "posts",
      slug: "hello-there",
      data: { ...opened.json.data, title: "Hello, world" },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
    expect(saved.json.status).toBe("new");
    expect(await live()).toEqual([]);

    const list = await call<EntryList>(handler, "GET", "/entries?collection=posts");
    expect(list.json.items.map((item) => [item.slug, item.status])).toEqual([
      ["hello-there", "new"],
    ]);

    const drafts = await call<DraftsDto>(handler, "GET", "/drafts");
    expect(drafts.json.changes.map((change) => change.path)).toEqual(["posts/hello-there.mdx"]);

    const published = await call<PublishResultDto>(handler, "POST", "/drafts/publish", {
      paths: ["posts/hello-there.mdx"],
    });
    expect(published.json).toMatchObject({
      action: "publish",
      live: true,
      published: ["posts/hello-there.mdx"],
      commit: null,
    });
    expect(await live()).toEqual([{ slug: "hello-there", title: "Hello, world" }]);
    expect(existsSync(contentDir)).toBe(false);
  });

  it("refuses a save made from a version someone else replaced", async () => {
    const handler = handlerFor(["studio:read", "studio:write", "studio:publish"]);
    await call(handler, "POST", "/entry", { collection: "posts", data: { title: "Shared" } });
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=posts&slug=shared");
    await call(handler, "PUT", "/entry", {
      collection: "posts",
      slug: "shared",
      data: { title: "First tab" },
      baseVersion: opened.json.version,
    });
    const stale = await call<{ error: string }>(handler, "PUT", "/entry", {
      collection: "posts",
      slug: "shared",
      data: { title: "Second tab" },
      baseVersion: opened.json.version,
    });
    expect([stale.status, stale.json.error]).toEqual([409, "CONTENT_CONFLICT"]);
  });

  it("submits for review instead when the person may not publish", async () => {
    const handler = handlerFor(["studio:read", "studio:write"]);
    await call(handler, "POST", "/entry", { collection: "posts", data: { title: "Sale" } });
    const result = await call<PublishResultDto>(handler, "POST", "/drafts/publish", {
      paths: ["posts/sale.mdx"],
      message: "Spring sale",
    });
    expect(result.json).toMatchObject({ action: "review", review: { title: "Spring sale" } });
    expect(result.json.review?.url).toBeUndefined();
    expect(await live()).toEqual([]);
    const drafts = await call<DraftsDto>(handler, "GET", "/drafts");
    expect(drafts.json.reviews.map((review) => review.title)).toEqual(["Spring sale"]);
  });

  it("compiles the live index from the revisions", async () => {
    const handler = handlerFor(["studio:read", "studio:write", "studio:publish"]);
    await call(handler, "POST", "/entry", { collection: "posts", data: { title: "One" } });
    await call(handler, "POST", "/drafts/publish", { paths: ["posts/one.mdx"] });
    const compiled = await call<{ docCount: number; gitSha: string | null }>(
      handler,
      "POST",
      "/compile",
      {},
    );
    expect(compiled.json).toMatchObject({ docCount: 1, gitSha: null });
  });

  it("refuses to revert to a commit, since there is none", async () => {
    const handler = handlerFor(["studio:read", "studio:write", "studio:publish"]);
    const refused = await call<{ error: string }>(handler, "POST", "/compilations/c1/revert", {});
    expect(refused.json.error).toBe("CONTENT_SOURCE_MISMATCH");
  });
});
