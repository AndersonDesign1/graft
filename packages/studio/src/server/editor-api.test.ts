/**
 * The editor API end to end over HTTP: entries, drafts and publishing, on a
 * real git repository (local Studio) and on the in-memory GitHub (hosted).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubStore, tokenAuth } from "@usegraft/compiler";
import { createGitHubFake } from "@usegraft/compiler/testing";
import { defineCollection, field } from "@usegraft/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DraftsDto,
  EntryDto,
  EntryList,
  SaveEntryResult,
  WorkspaceDto,
} from "../editor-types";

vi.mock("@usegraft/compiler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/compiler")>();
  return {
    ...actual,
    // Projection has its own integration tests; this suite is about which
    // bytes land where.
    compile: vi.fn(async () => ({ count: 0, docs: [], changes: {}, gitSha: null })),
  };
});

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

    await call(handler, "POST", "/drafts/publish", {
      paths: ["products/wool-hat.mdx"],
      message: "Raise the hat price",
    });
    expect(git(contentDir, "log", "-1", "--format=%s")).toBe("Raise the hat price");

    await call(handler, "POST", "/drafts/discard", {
      paths: ["products/old-shirt.mdx", "products/linen-shirt-copy.mdx"],
    });
    expect(existsSync(join(contentDir, "products", "old-shirt.mdx"))).toBe(true);
    expect(existsSync(join(contentDir, "products", "linen-shirt-copy.mdx"))).toBe(false);
    expect((await call<DraftsDto>(handler, "GET", "/drafts")).json.changes).toEqual([]);
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
    // Listed as published straight away, before any redeploy.
    const list = await call<EntryList>(handler, "GET", "/entries?collection=products");
    expect(list.json.items.find((item) => item.slug === "silk-scarf")?.status).toBe("published");
  });

  it("submits for review when the person may not publish", async () => {
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
