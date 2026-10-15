/**
 * The editor API end to end over HTTP: entries, drafts and publishing, on a
 * real git repository (local Studio) and on the in-memory GitHub (hosted).
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubStore, compileDocuments, tokenAuth } from "@usegraft/compiler";
import { createGitHubFake } from "@usegraft/compiler/testing";
import { defineCollection, field } from "@usegraft/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityDto,
  DraftsDto,
  EntryDto,
  EntryList,
  SaveEntryResult,
  SetFieldResultDto,
  VersionDetailDto,
  VersionListDto,
  WorkspaceDto,
} from "../editor-types";

vi.mock("@usegraft/compiler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/compiler")>();
  return {
    ...actual,
    // Projection has its own integration tests; this suite is about which
    // bytes land where.
    compileDocuments: vi.fn(async () => ({ count: 0, docs: [], changes: {}, gitSha: null })),
    // Reads the index, which these tests have none of. Its refusal is
    // covered against Postgres in the compiler's integration tests.
    checkRemoval: vi.fn(async () => {}),
    fireDeployHooks: vi.fn(async () => []),
  };
});

const { fireDeployHooks } = await import("@usegraft/compiler");

const { createStudioApiHandler } = await import("../api");

const collections = {
  products: defineCollection({
    name: "products",
    fields: {
      title: field.string({ label: "Name", maxLength: 80 }),
      price: field.number({ format: "money", min: 0 }),
      status: field.select({ options: ["draft", "active", "archived"] }),
      category: field.reference({ to: "categories", optional: true }),
      image: field.asset({ optional: true }),
      summary: field.text({ optional: true }),
    },
  }),
  categories: defineCollection({ name: "categories", fields: { title: field.string() } }),
};

const product = (title: string, price: number, status: string, category = "shirts") =>
  `---\ntitle: ${title}\nprice: ${price}\nstatus: ${status}\ncategory: ${category}\n---\n\nAbout ${title}.\n`;

type Handler = ReturnType<typeof createStudioApiHandler>;
const ORIGIN = "http://localhost";

async function call<T>(
  handler: Handler,
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

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function deletionStaysListed(handler: Handler): Promise<void> {
  const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
  await call(handler, "DELETE", "/entry", {
    collection: "products",
    slug: "wool-hat",
    baseVersion: opened.json.version,
  });
  const listed = await call<EntryList>(handler, "GET", "/entries?collection=products");
  expect(listed.json.items.find((item) => item.slug === "wool-hat")).toMatchObject({
    status: "deleted",
    title: "Wool Hat",
  });
  const deleted = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
  expect(deleted.json).toMatchObject({ status: "deleted", version: null });
  expect(deleted.json.data).toMatchObject({ title: "Wool Hat" });
  // Its slug stays taken while the deletion is pending.
  const reused = await call<{ error: string }>(handler, "POST", "/entry", {
    collection: "products",
    slug: "wool-hat",
    data: { title: "Another hat", price: 1, status: "draft" },
  });
  expect([reused.status, reused.json.error]).toEqual([409, "SLUG_NOT_UNIQUE"]);

  await call(handler, "POST", "/drafts/discard", { paths: [opened.json.path] });
  const restored = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
  expect(restored.json).toMatchObject({ status: "published", version: opened.json.version });
}

describe("editor API on a local checkout", () => {
  let contentDir: string;
  let handler: Handler;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), "graft-editor-"));
    contentDir = join(root, "content");
    mkdirSync(join(contentDir, "products"), { recursive: true });
    const catalog: [string, number, string, string][] = [
      ["Linen Shirt", 4500, "active", "shirts"],
      ["Wool Hat", 2500, "active", "hats"],
      ["Old Shirt", 1000, "archived", "shirts"],
    ];
    for (const [title, price, status, category] of catalog) {
      const slug = title.toLowerCase().replace(/ /g, "-");
      writeFileSync(
        join(contentDir, "products", `${slug}.mdx`),
        product(title, price, status, category),
      );
    }
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "dev@example.com");
    git(root, "config", "user.name", "Dev");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "seed");
    handler = createStudioApiHandler({ db: {} as never, collections, contentDir });
  });

  it("describes the workspace in editor terms", async () => {
    const { json } = await call<WorkspaceDto>(handler, "GET", "/workspace");
    expect(json).toMatchObject({
      storage: "local",
      publish: "commit",
      canWrite: true,
      history: true,
    });
  });

  it("shows a document's commits, and restores an old one as a draft", async () => {
    const root = join(contentDir, "..");
    const path = join(contentDir, "products", "wool-hat.mdx");
    const original = readFileSync(path, "utf8");
    writeFileSync(path, product("Wool Hat", 3000, "active", "hats"));
    git(root, "commit", "-qam", "Raise the hat's price");

    const history = await call<VersionListDto>(
      handler,
      "GET",
      "/entry/history?path=products/wool-hat.mdx",
    );
    expect(history.json.available).toBe(true);
    expect(history.json.versions.map((v) => [v.message, v.by])).toEqual([
      ["Raise the hat's price", "Dev"],
      ["seed", "Dev"],
    ]);

    const seed = history.json.versions[1]?.id as string;
    const version = await call<VersionDetailDto>(
      handler,
      "GET",
      `/entry/version?path=products/wool-hat.mdx&id=${seed}`,
    );
    expect(version.json.raw).toBe(original);
    expect(version.json.diff.fields).toEqual([{ field: "price", before: 2500, after: 3000 }]);

    // Restoring is a save of the old bytes: a draft until it is committed.
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    const saved = await call<SaveEntryResult>(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      raw: version.json.raw,
      baseVersion: opened.json.version,
    });
    expect(saved.status).toBe(200);
    expect(readFileSync(path, "utf8")).toBe(original);

    const activity = await call<ActivityDto>(handler, "GET", "/activity?limit=5");
    expect(activity.json.events.map((event) => event.documents.map((doc) => doc.title))).toEqual([
      ["Wool Hat"],
      ["Linen Shirt", "Old Shirt", "Wool Hat"],
    ]);
    expect(activity.json.events[0]?.documents[0]).toMatchObject({
      collection: "products",
      slug: "wool-hat",
    });
  });

  it("says why there is no history outside a repository", async () => {
    const loose = mkdtempSync(join(tmpdir(), "graft-loose-"));
    mkdirSync(join(loose, "products"));
    writeFileSync(join(loose, "products", "a.mdx"), product("A", 1, "draft"));
    const bare = createStudioApiHandler({ db: {} as never, collections, contentDir: loose });
    const history = await call<VersionListDto>(bare, "GET", "/entry/history?path=products/a.mdx");
    expect(history.json).toMatchObject({ available: false, versions: [] });
    expect(history.json.reason).toBeTruthy();
    const activity = await call<ActivityDto>(bare, "GET", "/activity");
    expect(activity.json.available).toBe(false);
  });

  it("publishes or discards a rename from either of its entries", async () => {
    const root = join(contentDir, "..");
    git(root, "mv", "content/products/old-shirt.mdx", "content/products/older-shirt.mdx");
    const drafts = await call<DraftsDto>(handler, "GET", "/drafts");
    expect(drafts.json.changes.map((change) => change.path)).toEqual([
      "products/old-shirt.mdx",
      "products/older-shirt.mdx",
    ]);

    const discarded = await call(handler, "POST", "/drafts/discard", {
      paths: ["products/old-shirt.mdx"],
    });
    expect(discarded.status).toBe(200);
    expect(git(root, "status", "--porcelain")).toBe("");

    git(root, "mv", "content/products/old-shirt.mdx", "content/products/older-shirt.mdx");
    const published = await call(handler, "POST", "/drafts/publish", {
      paths: ["products/old-shirt.mdx", "products/older-shirt.mdx"],
    });
    expect(published.status).toBe(200);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(git(root, "log", "-1", "--name-status", "--format=")).toContain("older-shirt.mdx");
  });

  it("keeps an entry deleted in the draft listed, readable and restorable", async () => {
    await deletionStaysListed(handler);
  });

  it("refuses a deletion other entries point at, and leaves the file", async () => {
    const { checkRemoval } = await import("@usegraft/compiler");
    const { GraftError } = await import("@usegraft/contracts");
    vi.mocked(checkRemoval).mockRejectedValueOnce(
      new GraftError({
        code: "CONTENT_REFERENCE_NOT_FOUND",
        message: "products/wool-hat can't be deleted while 1 reference(s) point at it.",
        fix: "Point those fields at another document, or delete those entries first. Nothing was deleted.",
      }),
    );
    const refused = await call<{ error: string }>(handler, "DELETE", "/entry", {
      collection: "products",
      slug: "wool-hat",
    });
    expect([refused.status, refused.json.error]).toEqual([409, "CONTENT_REFERENCE_NOT_FOUND"]);
    expect(vi.mocked(checkRemoval).mock.lastCall?.[0]).toMatchObject({
      paths: ["products/wool-hat.mdx"],
    });
    expect(readFileSync(join(contentDir, "products", "wool-hat.mdx"), "utf8")).toContain(
      "Wool Hat",
    );
  });

  it("lists, searches, filters and sorts on the server", async () => {
    const all = await call<EntryList>(handler, "GET", "/entries?collection=products");
    expect(all.json.total).toBe(3);
    expect(all.json.items.map((item) => item.title)).toEqual([
      "Linen Shirt",
      "Old Shirt",
      "Wool Hat",
    ]);
    expect(all.json.items[0]).toMatchObject({
      slug: "linen-shirt",
      status: "published",
      fields: { price: 4500, status: "active", category: "shirts" },
    });

    const search = await call<EntryList>(handler, "GET", "/entries?collection=products&q=shirt");
    expect(search.json.items.map((item) => item.slug)).toEqual(["linen-shirt", "old-shirt"]);

    const active = await call<EntryList>(
      handler,
      "GET",
      "/entries?collection=products&where.status=active&sort=price&dir=desc",
    );
    expect(active.json.items.map((item) => item.slug)).toEqual(["linen-shirt", "wool-hat"]);
    expect(active.json.facets.find((facet) => facet.field === "status")?.values).toEqual([
      { value: "active", count: 2 },
      { value: "archived", count: 1 },
    ]);

    // Empty values sort last in either direction.
    writeFileSync(
      join(contentDir, "products", "loose-thread.mdx"),
      "---\ntitle: Loose Thread\nprice: 100\nstatus: draft\n---\n",
    );
    for (const dir of ["asc", "desc"]) {
      const sorted = await call<EntryList>(
        handler,
        "GET",
        `/entries?collection=products&sort=category&dir=${dir}`,
      );
      expect(sorted.json.items.at(-1)?.slug).toBe("loose-thread");
    }
    const nested = await call<{ error: string }>(handler, "PUT", "/entry", {
      collection: "products",
      slug: "shirts/blue",
      data: { title: "Blue", price: 1, status: "draft" },
    });
    expect([nested.status, nested.json.error]).toEqual([400, "INVALID_SLUG"]);
    unlinkSync(join(contentDir, "products", "loose-thread.mdx"));

    // Search reads whole fields, not the table's shortened cells.
    writeFileSync(
      join(contentDir, "products", "wool-hat.mdx"),
      product("Wool Hat", 2500, "active", "hats").replace(
        "---\n\n",
        `summary: ${"Warm and soft. ".repeat(20)}Knitted on Fair Isle.\n---\n\n`,
      ),
    );
    const deep = await call<EntryList>(handler, "GET", "/entries?collection=products&q=fair+isle");
    expect(deep.json.items.map((item) => item.slug)).toEqual(["wool-hat"]);

    const paged = await call<EntryList>(handler, "GET", "/entries?collection=products&limit=2");
    expect(paged.json.items).toHaveLength(2);
    expect(paged.json.nextCursor).toBe("2");
    const next = await call<EntryList>(
      handler,
      "GET",
      "/entries?collection=products&limit=2&cursor=2",
    );
    expect(next.json.items.map((item) => item.slug)).toEqual(["wool-hat"]);
  });

  it("creates with a slug from the title, never over an existing one", async () => {
    const created = await call<SaveEntryResult>(handler, "POST", "/entry", {
      collection: "products",
      data: { title: "Linen Shirt", price: 5000, status: "draft" },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ slug: "linen-shirt-2", status: "new" });
    expect(readFileSync(join(contentDir, "products", "linen-shirt-2.mdx"), "utf8")).toContain(
      "title: Linen Shirt",
    );
    const clash = await call<{ error: string }>(handler, "POST", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { title: "Hat", price: 1, status: "draft" },
    });
    expect(clash.status).toBe(409);
    expect(clash.json.error).toBe("SLUG_NOT_UNIQUE");

    // A slug field that names another entry would index the file under it.
    for (const [method, payload] of [
      ["POST", { collection: "products", slug: "cap", data: { title: "Cap", slug: "wool-hat" } }],
      [
        "PUT",
        { collection: "products", slug: "old-shirt", data: { title: "Old", slug: "wool-hat" } },
      ],
    ] as const) {
      const refused = await call<{ error: string }>(handler, method, "/entry", payload);
      expect([refused.status, refused.json.error]).toEqual([400, "INVALID_SLUG"]);
    }
    const copy = await call<SaveEntryResult>(handler, "POST", "/entry/duplicate", {
      collection: "products",
      slug: "wool-hat",
    });
    expect(copy.status).toBe(201);
  });

  it("tells the app after a local save, and says so when that fails", async () => {
    const { compileDocuments } = await import("@usegraft/compiler");
    vi.mocked(compileDocuments).mockResolvedValueOnce({
      count: 3,
      docs: [],
      changes: { added: [], changed: ["products/wool-hat"], removed: [], unchanged: 2 },
      gitSha: null,
    } as never);
    const told: string[] = [];
    const refreshing = createStudioApiHandler({
      db: {} as never,
      collections,
      contentDir,
      onContentChange: (event) => {
        told.push(...event.changes.changed);
        throw new Error("revalidate route answered 500");
      },
    });
    const opened = await call<EntryDto>(
      refreshing,
      "GET",
      "/entry?collection=products&slug=wool-hat",
    );
    const saved = await call<SaveEntryResult>(refreshing, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 2600 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
    expect(saved.status).toBe(200);
    // Only the file the save wrote is projected, not the tree.
    expect(vi.mocked(compileDocuments).mock.lastCall?.[0]).toMatchObject({
      paths: ["products/wool-hat.mdx"],
    });
    expect(told).toEqual(["products/wool-hat"]);
    expect(saved.json.refresh).toMatchObject({ ok: false });
  });

  it("refuses a save made from a stale read, and keeps the newer bytes", async () => {
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    expect(opened.json.data).toMatchObject({ title: "Wool Hat", price: 2500 });
    // An agent edits the same file over MCP while the page is open.
    writeFileSync(
      join(contentDir, "products", "wool-hat.mdx"),
      product("Wool Hat", 2600, "active", "hats"),
    );
    const stale = await call<{ error: string }>(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 9900 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toBe("CONTENT_CONFLICT");
    expect(readFileSync(join(contentDir, "products", "wool-hat.mdx"), "utf8")).toContain(
      "price: 2600",
    );
  });

  it("says which field is wrong when a save does not validate", async () => {
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    const bad = await call<{ error: string; details: { issues: { path: string[] }[] } }>(
      handler,
      "PUT",
      "/entry",
      {
        collection: "products",
        slug: "wool-hat",
        data: { ...opened.json.data, status: "sold-out", price: 12.5 },
        baseVersion: opened.json.version,
      },
    );
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("SCHEMA_VALIDATION_FAILED");
    expect(bad.json.details.issues.map((issue) => issue.path[0]).sort()).toEqual([
      "price",
      "status",
    ]);
  });

  it("tracks drafts, diffs them, commits them and discards them", async () => {
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    const saved = await call<SaveEntryResult>(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 2900 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
    expect(saved.json.status).toBe("changed");
    await call(handler, "DELETE", "/entry", { collection: "products", slug: "old-shirt" });
    await call(handler, "POST", "/entry/duplicate", {
      collection: "products",
      slug: "linen-shirt",
    });

    const drafts = await call<DraftsDto>(handler, "GET", "/drafts");
    expect(drafts.json.publish).toBe("commit");
    expect(drafts.json.changes.map(({ path, kind, title }) => ({ path, kind, title }))).toEqual([
      { path: "products/linen-shirt-copy.mdx", kind: "added", title: "Linen Shirt (copy)" },
      { path: "products/old-shirt.mdx", kind: "deleted", title: "Old Shirt" },
      { path: "products/wool-hat.mdx", kind: "modified", title: "Wool Hat" },
    ]);

    const diff = await call<{
      fields: { field: string; before: unknown; after: unknown }[];
      bodyChanged: boolean;
      file: { added: number; removed: number };
    }>(handler, "GET", "/drafts/diff?path=products/wool-hat.mdx");
    // In the editor's terms first (which field, from what to what), then the
    // exact lines for anyone who wants them.
    expect(diff.json.fields).toEqual([{ field: "price", before: 2500, after: 2900 }]);
    expect(diff.json.bodyChanged).toBe(false);
    expect(diff.json.file).toMatchObject({ added: 1, removed: 1 });

    vi.mocked(fireDeployHooks).mockClear();
    await call(handler, "POST", "/drafts/publish", {
      paths: ["products/wool-hat.mdx"],
      message: "Raise the hat price",
    });
    expect(git(contentDir, "log", "-1", "--format=%s")).toBe("Raise the hat price");
    // A commit on this computer reaches no site.
    expect(fireDeployHooks).not.toHaveBeenCalled();

    await call(handler, "POST", "/drafts/discard", {
      paths: ["products/old-shirt.mdx", "products/linen-shirt-copy.mdx"],
    });
    expect(existsSync(join(contentDir, "products", "old-shirt.mdx"))).toBe(true);
    expect(existsSync(join(contentDir, "products", "linen-shirt-copy.mdx"))).toBe(false);
    expect((await call<DraftsDto>(handler, "GET", "/drafts")).json.changes).toEqual([]);
  });

  it("sets one field on many entries as drafts, and reports the ones it can't save", async () => {
    // Whichever compile the save path uses is the mocked one.
    const compiler: Record<string, unknown> = await import("@usegraft/compiler");
    const projections = () =>
      Object.values(compiler)
        .filter(vi.isMockFunction)
        .reduce((n, fn) => n + fn.mock.calls.length, 0);
    const before = projections();
    const read = (slug: string) =>
      readFileSync(join(contentDir, "products", `${slug}.mdx`), "utf8");

    const set = await call<SetFieldResultDto>(handler, "POST", "/entries/field", {
      collection: "products",
      slugs: ["linen-shirt", "wool-hat", "no-such-hat"],
      field: "status",
      value: "archived",
    });
    expect(set.status).toBe(200);
    expect(set.json.saved.map((entry) => entry.slug)).toEqual(["linen-shirt", "wool-hat"]);
    expect(set.json.failed).toMatchObject([{ slug: "no-such-hat", error: "DOCUMENT_NOT_FOUND" }]);
    // Only the field changed: the other bytes are the author's.
    expect(read("wool-hat")).toBe(product("Wool Hat", 2500, "archived", "hats"));
    // One index update for the batch, not one per entry, of just the files it wrote.
    expect(projections() - before).toBe(1);
    expect(vi.mocked(compileDocuments).mock.lastCall?.[0]).toMatchObject({
      paths: ["products/linen-shirt.mdx", "products/wool-hat.mdx"],
    });
    const drafts = await call<DraftsDto>(handler, "GET", "/drafts");
    expect(drafts.json.changes.map((change) => [change.slug, change.kind])).toEqual([
      ["linen-shirt", "modified"],
      ["wool-hat", "modified"],
    ]);

    // A value the schema refuses fails each entry, as a save would, and writes nothing.
    const refused = await call<SetFieldResultDto>(handler, "POST", "/entries/field", {
      collection: "products",
      slugs: ["old-shirt"],
      field: "price",
      value: -5,
    });
    expect(refused.json).toMatchObject({
      saved: [],
      failed: [{ slug: "old-shirt", error: "SCHEMA_VALIDATION_FAILED" }],
    });
    expect(read("old-shirt")).toBe(product("Old Shirt", 1000, "archived", "shirts"));

    // null removes an optional field; a required one can't be removed.
    const cleared = await call<SetFieldResultDto>(handler, "POST", "/entries/field", {
      collection: "products",
      slugs: ["old-shirt"],
      field: "category",
      value: null,
    });
    expect(cleared.json.saved).toHaveLength(1);
    expect(read("old-shirt")).not.toContain("category:");
    const required = await call<SetFieldResultDto>(handler, "POST", "/entries/field", {
      collection: "products",
      slugs: ["old-shirt"],
      field: "title",
      value: null,
    });
    expect(required.json.failed).toMatchObject([{ error: "SCHEMA_VALIDATION_FAILED" }]);

    const unknown = await call<{ error: string; fix: string }>(handler, "POST", "/entries/field", {
      collection: "products",
      slugs: ["old-shirt"],
      field: "colour",
      value: "red",
    });
    expect([unknown.status, unknown.json.error]).toEqual([400, "INPUT_VALIDATION_FAILED"]);
    expect(unknown.json.fix).toContain("status");
  });

  function signedIn(scopes: string[]): Handler {
    return createStudioApiHandler({
      db: {} as never,
      collections,
      contentDir,
      authenticate: () => ({
        kind: "human",
        id: "ana",
        name: "Ana",
        email: "ana@shop.test",
        scopes,
      }),
    });
  }

  async function raiseHatPrice(on: Handler): Promise<void> {
    const opened = await call<EntryDto>(on, "GET", "/entry?collection=products&slug=wool-hat");
    await call(on, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 2900 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
  }

  it("commits as the signed-in person, named by the entries' titles", async () => {
    const editor = signedIn(["studio:read", "studio:write", "studio:publish"]);
    await raiseHatPrice(editor);
    expect((await call<DraftsDto>(editor, "GET", "/drafts")).json.canPublish).toBe(true);

    const published = await call(editor, "POST", "/drafts/publish", {
      paths: ["products/wool-hat.mdx"],
    });
    expect(published.status).toBe(200);
    // The author is the person; the committer stays whoever runs Studio.
    expect(git(contentDir, "log", "-1", "--format=%s|%an|%ae|%cn")).toBe(
      "Update “Wool Hat”|Ana|ana@shop.test|Dev",
    );
  });

  it("lets a contributor save drafts locally, and refuses their commit", async () => {
    const contributor = signedIn(["studio:read", "studio:write"]);
    await raiseHatPrice(contributor);
    const drafts = await call<DraftsDto>(contributor, "GET", "/drafts");
    expect(drafts.json.canPublish).toBe(false);
    expect(drafts.json.changes.map((change) => change.path)).toEqual(["products/wool-hat.mdx"]);

    const head = git(contentDir, "rev-parse", "HEAD");
    const refused = await call<{
      error: string;
      message: string;
      details: { required: string };
    }>(contributor, "POST", "/drafts/publish", {
      paths: ["products/wool-hat.mdx"],
    });
    expect(refused.json).toMatchObject({
      error: "UNAUTHORIZED",
      message: "Your role can save drafts here, but committing them needs an editor.",
      details: { required: "studio:publish" },
    });
    expect(git(contentDir, "rev-parse", "HEAD")).toBe(head);
    // The draft is still there for an editor to commit.
    expect((await call<DraftsDto>(contributor, "GET", "/drafts")).json.changes).toHaveLength(1);
  });

  it("refuses a person by role and a token by scope", async () => {
    const viewer = signedIn(["studio:read"]);
    const asPerson = await call<{ message: string; fix: string }>(viewer, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: {},
    });
    expect(asPerson.json).toMatchObject({
      message: "Your role can't save changes.",
      fix: "Ask an admin to change your role under Settings, People.",
    });

    const token = createStudioApiHandler({
      db: {} as never,
      collections,
      contentDir,
      authenticate: () => ({
        kind: "token",
        id: "ci",
        scopes: ["studio:read"],
      }),
    });
    const asToken = await call<{ message: string }>(token, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: {},
    });
    expect(asToken.json.message).toBe(
      "This token can't save changes: it doesn't carry the \"studio:write\" scope.",
    );
  });

  it("dates an untouched entry by its last commit, not its file's mtime", async () => {
    const committed = Number(git(contentDir, "log", "-1", "--format=%ct")) * 1000;
    // A clone or checkout sets every mtime to now; it edits nothing.
    const later = new Date(committed + 86_400_000);
    utimesSync(join(contentDir, "products", "linen-shirt.mdx"), later, later);
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    await call(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 2900 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });

    const listed = await call<EntryList>(handler, "GET", "/entries?collection=products");
    const at = (slug: string) =>
      Date.parse(listed.json.items.find((item) => item.slug === slug)?.updatedAt ?? "");
    expect(at("linen-shirt")).toBe(committed);
    // An entry with a draft was edited when its file was.
    expect(at("wool-hat")).toBeGreaterThan(committed - 1000);
    expect(at("wool-hat")).not.toBe(committed);
  });

  it("refuses a database collection", async () => {
    const records = createStudioApiHandler({
      db: {} as never,
      collections: {
        ...collections,
        orders: defineCollection({
          name: "orders",
          authority: "db-authoritative",
          fields: { email: field.string() },
        }),
      },
      contentDir,
    });
    const response = await call<{ error: string }>(records, "GET", "/entries?collection=orders");
    expect(response.status).toBe(400);
    expect(response.json.error).toBe("AUTHORITY_MISMATCH");
  });
});

describe("editor API on GitHub (hosted)", () => {
  function hosted(
    publishMode: "direct" | "review" = "direct",
    scopes = ["studio:read", "studio:write", "studio:publish"],
  ) {
    // The deployed checkout: what the serverless function was built with.
    const root = mkdtempSync(join(tmpdir(), "graft-hosted-"));
    const contentDir = join(root, "content");
    mkdirSync(join(contentDir, "products"), { recursive: true });
    writeFileSync(
      join(contentDir, "products", "wool-hat.mdx"),
      product("Wool Hat", 2500, "active", "hats"),
    );
    const fake = createGitHubFake({
      repo: "acme/shop",
      files: { "content/products/wool-hat.mdx": product("Wool Hat", 2500, "active", "hats") },
    });
    const store = new GitHubStore({
      repo: "acme/shop",
      auth: tokenAuth(fake.token),
      apiUrl: fake.apiUrl,
      fetch: fake.fetch,
      publishMode,
      deployedSha: fake.head(),
    });
    const handler = createStudioApiHandler({
      db: {} as never,
      collections,
      contentDir,
      store,
      authenticate: () => ({
        kind: "human",
        id: "ana",
        name: "Ana",
        email: "ana@shop.test",
        scopes,
      }),
    });
    return { fake, handler, contentDir };
  }

  it("keeps an entry deleted in the draft listed, readable and restorable", async () => {
    await deletionStaysListed(hosted().handler);
  });

  it("reads a document's history from the production branch's commits", async () => {
    const { fake, handler } = hosted();
    fake.push(
      "main",
      { "content/products/wool-hat.mdx": product("Wool Hat", 3000, "active", "hats") },
      "Raise the hat's price",
    );
    const history = await call<VersionListDto>(
      handler,
      "GET",
      "/entry/history?path=products/wool-hat.mdx",
    );
    expect(history.json.versions[0]?.message).toBe("Raise the hat's price");
    const older = history.json.versions[1]?.id as string;
    const version = await call<VersionDetailDto>(
      handler,
      "GET",
      `/entry/version?path=products/wool-hat.mdx&id=${older}`,
    );
    expect(version.json.diff.fields).toEqual([{ field: "price", before: 2500, after: 3000 }]);
    const activity = await call<ActivityDto>(handler, "GET", "/activity");
    expect(activity.json.events[0]).toMatchObject({
      message: "Raise the hat's price",
      documents: [],
      more: 0,
    });
  });

  it("restores a deleted entry only while it is still deleted", async () => {
    const { handler } = hosted();
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    await call(handler, "DELETE", "/entry", {
      collection: "products",
      slug: "wool-hat",
      baseVersion: opened.json.version,
    });
    const restore = {
      collection: "products",
      slug: "wool-hat",
      data: opened.json.data,
      body: opened.json.body,
      baseVersion: null,
    };
    expect((await call(handler, "PUT", "/entry", restore)).status).toBe(200);
    // Restored now, so a second, stale undo is refused rather than applied.
    const again = await call<{ error: string }>(handler, "PUT", "/entry", restore);
    expect([again.status, again.json.error]).toEqual([409, "CONTENT_CONFLICT"]);
  });

  it("refuses the routes that would write the deployed files", async () => {
    const { handler, contentDir } = hosted();
    const before = readFileSync(join(contentDir, "products", "wool-hat.mdx"), "utf8");
    for (const [method, path, body] of [
      ["POST", "/compile", {}],
      ["POST", "/changes/commit", { paths: ["products/wool-hat.mdx"], message: "x" }],
      ["POST", "/compilations/c1/revert", {}],
    ] as const) {
      const refused = await call<{ error: string }>(handler, method, path, body);
      expect([path, refused.status, refused.json.error]).toEqual([
        path,
        409,
        "CONTENT_TREE_READ_ONLY",
      ]);
    }
    expect(readFileSync(join(contentDir, "products", "wool-hat.mdx"), "utf8")).toBe(before);
  });

  it("saves to the editor's draft branch, leaving the deployed files alone", async () => {
    const { fake, handler, contentDir } = hosted();
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    await call(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 3100 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
    expect(readFileSync(join(contentDir, "products", "wool-hat.mdx"), "utf8")).toContain(
      "price: 2500",
    );
    expect(fake.files("graft-studio/drafts/ana")["content/products/wool-hat.mdx"]).toContain(
      "price: 3100",
    );

    const list = await call<EntryList>(handler, "GET", "/entries?collection=products");
    expect(list.json.items[0]).toMatchObject({ status: "changed", fields: { price: 3100 } });
    const workspace = await call<WorkspaceDto>(handler, "GET", "/workspace");
    expect(workspace.json).toMatchObject({
      storage: "github",
      repository: "acme/shop",
      publish: "publish",
    });
  });

  it("sets a field on many entries in the editor's draft branch", async () => {
    const { fake, handler, contentDir } = hosted();
    const set = await call<SetFieldResultDto>(handler, "POST", "/entries/field", {
      collection: "products",
      slugs: ["wool-hat"],
      field: "price",
      value: 2900,
    });
    expect(set.json.saved).toMatchObject([{ slug: "wool-hat", path: "products/wool-hat.mdx" }]);
    expect(fake.files("graft-studio/drafts/ana")["content/products/wool-hat.mdx"]).toContain(
      "price: 2900",
    );
    expect(readFileSync(join(contentDir, "products", "wool-hat.mdx"), "utf8")).toContain(
      "price: 2500",
    );
  });

  it("publishes as one commit authored by the editor", async () => {
    const { fake, handler } = hosted();
    await call(handler, "POST", "/entry", {
      collection: "products",
      data: { title: "Silk Scarf", price: 8000, status: "active" },
    });
    const result = await call<{ action: string; commit: { shortSha: string } }>(
      handler,
      "POST",
      "/drafts/publish",
      { paths: ["products/silk-scarf.mdx"], message: "Add the scarf" },
    );
    expect(result.json.action).toBe("publish");
    expect(fake.files()["content/products/silk-scarf.mdx"]).toContain("title: Silk Scarf");
    expect(fake.log()[0]).toMatchObject({ message: "Add the scarf", author: { name: "Ana" } });
    // The production branch moved, so the site's deploy hooks hear about it.
    expect(fireDeployHooks).toHaveBeenLastCalledWith(expect.anything(), {
      event: "publish",
      branch: "main",
      paths: ["products/silk-scarf.mdx"],
    });
    // Listed as published straight away, before any redeploy.
    const list = await call<EntryList>(handler, "GET", "/entries?collection=products");
    expect(list.json.items.find((item) => item.slug === "silk-scarf")?.status).toBe("published");
  });

  it("submits for review when the person may not publish", async () => {
    vi.mocked(fireDeployHooks).mockClear();
    const { fake, handler } = hosted("direct", ["studio:read", "studio:write"]);
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    await call(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, title: "Winter Hat" },
      body: opened.json.body,
    });
    const drafts = await call<DraftsDto>(handler, "GET", "/drafts");
    expect(drafts.json.publish).toBe("review");
    const result = await call<{ action: string; review: { number: number } }>(
      handler,
      "POST",
      "/drafts/publish",
      {
        paths: ["products/wool-hat.mdx"],
      },
    );
    expect(result.json).toMatchObject({ action: "review", review: { number: 1 } });
    expect(fake.files()["content/products/wool-hat.mdx"]).toContain("title: Wool Hat");
    expect((await call<DraftsDto>(handler, "GET", "/drafts")).json.reviews).toHaveLength(1);
    // A pull request changes no site yet.
    expect(fireDeployHooks).not.toHaveBeenCalled();
  });

  it("reports a conflict and publishes the editor's choice", async () => {
    const { fake, handler } = hosted();
    const opened = await call<EntryDto>(handler, "GET", "/entry?collection=products&slug=wool-hat");
    await call(handler, "PUT", "/entry", {
      collection: "products",
      slug: "wool-hat",
      data: { ...opened.json.data, price: 3300 },
      body: opened.json.body,
      baseVersion: opened.json.version,
    });
    fake.push("main", {
      "content/products/wool-hat.mdx": product("Wool Hat", 2700, "active", "hats"),
    });

    expect((await call<DraftsDto>(handler, "GET", "/drafts")).json.changes[0]?.conflict).toBe(true);
    const refused = await call<{ error: string }>(handler, "POST", "/drafts/publish", {
      paths: ["products/wool-hat.mdx"],
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe("CONTENT_CONFLICT");

    await call(handler, "POST", "/drafts/publish", {
      paths: ["products/wool-hat.mdx"],
      resolve: { "products/wool-hat.mdx": "mine" },
    });
    expect(fake.files()["content/products/wool-hat.mdx"]).toContain("price: 3300");
  });

  it("explains GitHub refusing the credential as a gateway error", async () => {
    const { fake, handler } = hosted();
    fake.failNext("GET", "/repos/acme/shop/git/ref/heads/main", 401);
    const response = await call<{ error: string }>(
      handler,
      "GET",
      "/entry?collection=products&slug=wool-hat",
    );
    expect(response.status).toBe(502);
    expect(response.json.error).toBe("REMOTE_STORE_FAILED");
  });
});
