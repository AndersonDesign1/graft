/**
 * Integration: MCP on a database-sourced project, against a live database
 * (opt-in). Writes are shared drafts in Postgres, publish_drafts puts them
 * live without a rebuild for a credential that may publish, and sync_status
 * tells an agent in the checkout which files are behind.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseStore } from "@usegraft/compiler";
import { defineCollection, field } from "@usegraft/core";
import { createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = `mcp-db-it-${randomUUID().slice(0, 8)}`;
const TIMEOUT = 30_000;
const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

describe.skipIf(!runIntegration)("MCP on a database-sourced project (integration)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
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
  }, TIMEOUT);

  afterAll(async () => {
    await handle.close();
  });

  async function connect(scopes: string[]) {
    const project = mkdtempSync(join(tmpdir(), "graft-mcp-db-"));
    const contentDir = join(project, "content");
    mkdirSync(join(contentDir, "pages"), { recursive: true });
    const server = createGraftMcp({
      contentDir,
      collections,
      db: handle.db,
      branchId: BRANCH,
      audit: false,
      actor: () => ({ kind: "agent", id: "writer-bot" }),
      connectionActor: { kind: "agent", id: "writer-bot", scopes },
      store: new DatabaseStore({ db: handle.db, collections, branchId: BRANCH }),
      source: "database",
      syncStateFile: join(project, ".graft", "sync.json"),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-agent", version: "0.0.0" });
    await client.connect(clientTransport);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      return {
        isError: result.isError === true,
        payload: JSON.parse(result.content[0]?.text ?? "null") as Record<string, any>,
      };
    };
    return { call, contentDir, client };
  }

  const live = async () =>
    (
      await handle.sql`select slug from content_index where branch_id = ${BRANCH} and not deleted order by slug`
    ).map((row) => row.slug as string);

  it("drafts a write, reads it back, and lists it", async () => {
    const { call } = await connect(["content:write"]);
    const written = await call("write_content", {
      collection: "pages",
      slug: "about",
      data: { title: "About" },
      body: "Hello.",
    });
    expect(written).toMatchObject({ isError: false, payload: { gitSha: null } });
    expect(
      (await call("get_content", { collection: "pages", slug: "about" })).payload,
    ).toMatchObject({
      data: { title: "About" },
    });
    expect((await call("list_drafts")).payload.changes).toEqual([
      expect.objectContaining({ path: "pages/about.mdx", kind: "added" }),
    ]);
    expect(await live()).toEqual([]);
  });

  it("files a review without content:publish, and publishes live with it", async () => {
    const writer = await connect(["content:write"]);
    await writer.call("write_content", {
      collection: "pages",
      slug: "sale",
      data: { title: "Sale" },
    });
    const asked = await writer.call("publish_drafts", { paths: ["pages/sale.mdx"] });
    expect(asked.payload).toMatchObject({ mode: "review", published: ["pages/sale.mdx"] });
    expect(await live()).toEqual([]);

    const publisher = await connect(["content:write", "content:publish"]);
    const published = await publisher.call("publish_drafts", { paths: ["pages/sale.mdx"] });
    expect(published.payload).toMatchObject({
      mode: "direct",
      published: ["pages/sale.mdx"],
      changes: { added: ["pages/sale"] },
    });
    expect(await live()).toEqual(["sale"]);
  });

  it("refuses to read a document that only exists as a stale file", async () => {
    const { call, contentDir } = await connect(["content:write"]);
    writeFileSync(join(contentDir, "pages", "ghost.mdx"), "---\ntitle: Ghost\n---\n");
    const read = await call("get_content", { collection: "pages", slug: "ghost" });
    expect(read.isError).toBe(true);
    expect(read.payload.error).toBe("DOCUMENT_NOT_FOUND");
  });

  it("tells an agent in the checkout which files are behind", async () => {
    const publisher = await connect(["content:write", "content:publish"]);
    await publisher.call("write_content", {
      collection: "pages",
      slug: "home",
      data: { title: "Home" },
    });
    await publisher.call("publish_drafts", { paths: ["pages/home.mdx"] });
    const status = await publisher.call("sync_status");
    expect(status.payload).toMatchObject({
      behind: ["pages/home.mdx"],
      ahead: [],
      conflicts: [],
      next: "Run graft pull before editing these files.",
    });
  });
});
