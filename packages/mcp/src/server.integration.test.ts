/**
 * Integration: write_content projects into a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env is auto-loaded).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@graft/core";
import { createDb, type DbHandle } from "@graft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "mcp-it";
const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

describe.skipIf(!runIntegration)("write_content projects into content_index", () => {
  let handle: DbHandle;
  let dir: string;
  let client: Client;

  async function callTool(name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]?.text ?? "null"),
    };
  }

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    dir = mkdtempSync(join(tmpdir(), "graft-mcp-it-"));
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;

    const server = createGraftMcp({
      contentDir: dir,
      collections,
      db: handle.db,
      branchId: BRANCH,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "it-agent", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a document end-to-end and reports the ChangeSet", async () => {
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "hello",
      data: { title: "Hello" },
      body: "Written by an agent over MCP.",
    });
    expect(result.isError).toBeFalsy();
    expect(result.payload.written).toBe("pages/hello.mdx");
    expect(result.payload.changes.added).toEqual(["pages/hello"]);

    const rows = await handle.sql`
      select slug, body from content_index
      where branch_id = ${BRANCH} and collection = 'pages' and deleted = false
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Written by an agent over MCP.");
  });

  it("is idempotent: rewriting identical content changes nothing", async () => {
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "hello",
      data: { title: "Hello" },
      body: "Written by an agent over MCP.",
    });
    expect(result.isError).toBeFalsy();
    expect(result.payload.changes.added).toEqual([]);
    expect(result.payload.changes.changed).toEqual([]);
    expect(result.payload.changes.unchanged).toBe(1);
  });

  it("updates in place and reports the change", async () => {
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "hello",
      data: { title: "Hello v2" },
      body: "Updated.",
    });
    expect(result.isError).toBeFalsy();
    expect(result.payload.changes.changed).toEqual(["pages/hello"]);
    const reread = await callTool("get_content", { collection: "pages", slug: "hello" });
    expect(reread.payload.data.title).toBe("Hello v2");
  });

  it("search_content finds what write_content wrote, pointing back at the file", async () => {
    const result = await callTool("search_content", { query: "updated" });
    expect(result.isError).toBeFalsy();
    expect(result.payload.hits).toHaveLength(1);
    expect(result.payload.hits[0]).toMatchObject({
      collection: "pages",
      slug: "hello",
      sourcePath: "pages/hello.mdx",
    });
    expect(result.payload.hits[0].snippet).toContain("<b>");
  });
});
