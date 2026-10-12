/**
 * Integration: the media library, agent tokens and site settings over HTTP,
 * against a live database (opt-in). None of these belongs to a branch, so
 * this runs in a throwaway database it creates and drops. The asset store is
 * an in-memory stand-in: the S3 client has its own tests.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@usegraft/core";
import { actorForAgentToken, createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentsDto,
  AssetDetailDto,
  AssetListDto,
  NewAgentTokenDto,
  SiteDto,
} from "../editor-types";

const bucket = new Map<string, { bytes: Uint8Array; contentType: string }>();
let storageConfigured = true;

vi.mock("@usegraft/assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/assets")>();
  return {
    ...actual,
    createStorage: () => {
      if (!storageConfigured) throw new Error("S3_ENDPOINT is not set.");
      return {
        async put(
          key: string,
          body: Uint8Array,
          contentType: string,
          opts?: { ifAbsent?: boolean },
        ) {
          if (opts?.ifAbsent && bucket.has(key)) throw new actual.AssetKeyTakenError(key);
          bucket.set(key, { bytes: body, contentType });
        },
        async delete(key: string) {
          bucket.delete(key);
        },
        async exists(key: string) {
          return bucket.has(key);
        },
        async url(key: string) {
          return `https://cdn.test/${key}`;
        },
      };
    },
  };
});

const { createStudioApiHandler } = await import("../api");

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TIMEOUT = 60_000;
const ORIGIN = "http://localhost";
const collections = {
  products: defineCollection({
    name: "products",
    fields: {
      title: field.string(),
      image: field.asset({ optional: true }),
      gallery: field.array({ of: field.asset(), optional: true }),
    },
  }),
};
const ADMIN = ["studio:read", "studio:write", "studio:publish", "studio:settings"];
const EDITOR = ["studio:read", "studio:write", "studio:publish"];

describe.skipIf(!runIntegration)("media, agents and the site over HTTP (integration)", () => {
  let admin: DbHandle;
  let handle: DbHandle | undefined;
  const name = `graft_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let scopes = ADMIN;
  let handler: ReturnType<typeof createStudioApiHandler>;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL as string;
    admin = createDb(url);
    try {
      await admin.sql.unsafe(`create database ${name}`);
    } catch {
      return; // this role can't create a database: every test skips
    }
    const scratch = new URL(url);
    scratch.pathname = `/${name}`;
    await runMigrations(scratch.toString());
    handle = createDb(scratch.toString());

    const contentDir = join(mkdtempSync(join(tmpdir(), "graft-media-")), "content");
    mkdirSync(join(contentDir, "products"), { recursive: true });
    writeFileSync(
      join(contentDir, "products", "hat.mdx"),
      "---\ntitle: Wool Hat\nimage:\n  key: products/hat.jpg\n  alt: A hat\ngallery:\n  - key: products/hat-side.jpg\n---\n",
    );
    handler = createStudioApiHandler({
      db: handle.db,
      collections,
      contentDir,
      authenticate: () => ({ kind: "human", id: "ana", name: "Ana", scopes }),
    });
  }, TIMEOUT);

  beforeEach(() => {
    scopes = ADMIN;
    storageConfigured = true;
  });

  afterAll(async () => {
    await handle?.close();
    await admin.sql.unsafe(`drop database if exists ${name} with (force)`);
    await admin.close();
  }, TIMEOUT);

  async function call<T = any>(method: string, path: string, body?: unknown) {
    const response = await handler(
      new Request(`${ORIGIN}/api/studio/v1${path}`, {
        method,
        headers: { "content-type": "application/json", origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    return { status: response.status, json: (await response.json()) as T };
  }

  const b64 = (text: string) => Buffer.from(text).toString("base64");

  it("lists the files entries use, uploads one, and refuses a name that's taken", async (ctx) => {
    if (!handle) return ctx.skip();
    const before = await call<AssetListDto>("GET", "/assets");
    expect(before.json.storage).toBe(true);
    expect(before.json.items.map((a) => [a.key, a.uses, a.bytes])).toEqual([
      ["products/hat-side.jpg", 1, null],
      ["products/hat.jpg", 1, null],
    ]);

    const uploaded = await call("POST", "/assets", { name: "Logo Mark.PNG", base64: b64("png!") });
    expect(uploaded.status).toBe(201);
    expect(uploaded.json).toMatchObject({
      key: "assets/logo-mark.png",
      contentType: "image/png",
      bytes: 4,
      uploadedBy: "Ana",
      url: "https://cdn.test/assets/logo-mark.png",
      uses: 0,
    });
    const again = await call("POST", "/assets", { name: "logo-mark.png", base64: b64("x") });
    expect([again.status, again.json.error]).toEqual([409, "ASSET_EXISTS"]);
    const replaced = await call("POST", "/assets", {
      name: "logo-mark.png",
      base64: b64("newer"),
      overwrite: true,
      alt: "The logo",
    });
    expect(replaced.json).toMatchObject({ bytes: 5, alt: "The logo" });

    // The type is the key's, whatever the caller says, and only media is taken.
    const page = await call("POST", "/assets", {
      name: "page.html",
      base64: b64("<script>alert(1)</script>"),
      contentType: "image/png",
    });
    expect([page.status, page.json.error]).toEqual([400, "INPUT_VALIDATION_FAILED"]);
    expect(bucket.has("assets/page.html")).toBe(false);

    // Writing drafts doesn't reach replacing what the live site shows.
    scopes = ["studio:read", "studio:write"];
    const swap = await call("POST", "/assets", {
      name: "logo-mark.png",
      base64: b64("swapped"),
      overwrite: true,
    });
    expect([swap.status, swap.json.error]).toEqual([401, "UNAUTHORIZED"]);
    expect(Buffer.from(bucket.get("assets/logo-mark.png")?.bytes ?? []).toString()).toBe("newer");
    scopes = ADMIN;

    const listed = await call<AssetListDto>("GET", "/assets?q=logo");
    expect(listed.json.items.map((a) => a.key)).toEqual(["assets/logo-mark.png"]);
  });

  it("says where a file is used, and won't delete one an entry still shows", async (ctx) => {
    if (!handle) return ctx.skip();
    const detail = await call<AssetDetailDto>("GET", "/assets/detail?key=products/hat-side.jpg");
    expect(detail.json.usedIn).toEqual([
      { collection: "products", slug: "hat", title: "Wool Hat", field: "gallery.0" },
    ]);
    const used = await call("DELETE", "/assets?key=products/hat.jpg");
    expect([used.status, used.json.error]).toEqual([409, "CONTENT_CONFLICT"]);

    expect(
      (await call("PUT", "/assets/alt", { key: "assets/logo-mark.png", alt: "Logo" })).status,
    ).toBe(200);
    const notOurs = await call("PUT", "/assets/alt", { key: "products/hat.jpg", alt: "x" });
    expect(notOurs.json.error).toBe("DOCUMENT_NOT_FOUND");

    const gone = await call("DELETE", "/assets?key=assets/logo-mark.png");
    expect(gone.json).toEqual({ key: "assets/logo-mark.png", deleted: true });
    expect(bucket.has("assets/logo-mark.png")).toBe(false);
  });

  it("explains what to set when there is no asset store", async (ctx) => {
    if (!handle) return ctx.skip();
    storageConfigured = false;
    const list = await call<AssetListDto>("GET", "/assets");
    expect(list.json).toMatchObject({ storage: false, items: [{ url: null }, { url: null }] });
    const upload = await call("POST", "/assets", { name: "a.png", base64: b64("a") });
    expect([upload.status, upload.json.error]).toEqual([503, "ENV_VAR_MISSING"]);
  });

  it("makes a token an agent can use, shows it once, and revokes it", async (ctx) => {
    if (!handle) return ctx.skip();
    const made = await call<NewAgentTokenDto>("POST", "/agents", {
      name: "Docs agent",
      access: "write",
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ name: "Docs agent", access: "write" });
    expect(made.json.token).toMatch(/^graft_at_/);
    expect(await actorForAgentToken(handle.db, made.json.token)).toMatchObject({
      kind: "agent",
      scopes: ["studio:read", "studio:write", "content:write"],
    });

    // Publish reaches MCP's publish_drafts too, which checks content:publish.
    const publisher = await call<NewAgentTokenDto>("POST", "/agents", {
      name: "Release agent",
      access: "publish",
    });
    expect(publisher.json.access).toBe("publish");
    const publishing = await actorForAgentToken(handle.db, publisher.json.token);
    expect(publishing?.scopes).toEqual(
      expect.arrayContaining(["studio:publish", "content:publish"]),
    );
    expect(publishing?.scopes).not.toContain("approvals:decide");
    expect((await call("DELETE", `/agents/${publisher.json.id}`)).status).toBe(200);

    const listed = await call<AgentsDto>("GET", "/agents");
    // Revoked tokens stay listed, marked, so what was given out stays on record.
    expect(listed.json.tokens.map((t) => [t.name, t.revokedAt === null])).toEqual([
      ["Release agent", false],
      ["Docs agent", true],
    ]);
    expect(JSON.stringify(listed.json)).not.toContain(made.json.token);
    expect(listed.json.endpoints.mcp).toBe(`${ORIGIN}/api/mcp`);
    // This handler wasn't told it takes tokens, as under `graft studio`.
    expect(listed.json.accepted).toBe(false);

    expect((await call("DELETE", `/agents/${made.json.id}`)).status).toBe(200);
    expect(await actorForAgentToken(handle.db, made.json.token)).toBeNull();

    scopes = EDITOR;
    const refused = await call("GET", "/agents");
    expect([refused.status, refused.json.error]).toEqual([401, "UNAUTHORIZED"]);
  });

  it("keeps the site's settings, and calls a deploy hook when asked to test it", async (ctx) => {
    if (!handle) return ctx.skip();
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.authorization ?? "");
      res.writeHead(204).end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as AddressInfo).port;
    try {
      await call("PUT", "/site", { name: "Bakery", url: "https://bakery.test" });
      const insecure = await call("POST", "/site/hooks", { name: "x", url: "http://hooks.test/1" });
      expect(insecure.json.error).toBe("INPUT_VALIDATION_FAILED");
      const hook = await call("POST", "/site/hooks", {
        name: "Revalidate",
        url: `http://127.0.0.1:${port}/api/revalidate?token=abc`,
        secret: "s3cret",
      });
      expect(hook.json).toMatchObject({
        url: `http://127.0.0.1:${port}/api/revalidate`,
        hasSecret: true,
      });

      const tested = await call("POST", `/site/hooks/${hook.json.id}/test`);
      expect(tested.json).toMatchObject({ status: 204, error: null });
      expect(seen).toEqual(["Bearer s3cret"]);

      const site = await call<SiteDto>("GET", "/site");
      expect(site.json.settings).toEqual({ name: "Bakery", url: "https://bakery.test" });
      expect(site.json.hooks[0]).toMatchObject({ name: "Revalidate", lastStatus: 204 });

      scopes = EDITOR;
      const asEditor = await call<SiteDto>("GET", "/site");
      expect(asEditor.json.hooks).toEqual([]);
      scopes = ADMIN;
      expect((await call("DELETE", `/site/hooks/${hook.json.id}`)).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
