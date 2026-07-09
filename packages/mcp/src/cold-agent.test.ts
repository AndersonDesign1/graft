/**
 * P6.1 — Cold-agent path (CI-blocking).
 *
 * Simulates a fresh agent that knows only the MCP surface: no graft.config.ts,
 * no phases.md, no session memory. The agent discovers the schema via tools,
 * authors a page from that schema alone, recovers from a validation error using
 * explain_error, and reads the page back. If this fails, Graft is not
 * self-teaching enough for open-source agents.
 *
 * Projection is stubbed so CI stays offline (no DATABASE_URL). The agent path
 * under test is introspection + validate + write file + re-read — the same
 * tools a remote agent calls. Full Neon projection stays in
 * server.integration.test.ts (RUN_INTEGRATION=1).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCodes, SchemaDescription } from "@graft/contracts";
import { defineCollection, field } from "@graft/core";
import type { ChangeSet, Database } from "@graft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@graft/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@graft/db")>();
  return {
    ...actual,
    projectBranchContent: vi.fn(
      async (
        _db: Database,
        rows: { collection: string; slug: string }[],
      ): Promise<ChangeSet> => ({
        added: rows.map((r) => `${r.collection}/${r.slug}`),
        changed: [],
        removed: [],
        unchanged: 0,
      }),
    ),
  };
});

// Import after mock so createGraftMcp → compile sees the stubbed projection.
const { createGraftMcp } = await import("./server");

const collections = {
  pages: defineCollection({
    name: "pages",
    description: "Marketing pages an agent can author as MDX.",
    fields: {
      title: field.string({ description: "Page headline (h1) and <title>." }),
      description: field.string({ description: "Meta description." }),
      tagline: field.string({ optional: true, description: "Short line under the headline." }),
      order: field.number({ optional: true, description: "Nav sort order." }),
    },
  }),
};

/** Stub db — projection is mocked; tools must not need a real pool. */
const stubDb = {} as Database;

let dir: string;
let client: Client;

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return {
    isError: result.isError === true,
    payload: JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>,
  };
}

/**
 * Build a minimal valid frontmatter object from a SchemaDescription alone —
 * what a cold agent does after describe_schema (no config source).
 */
function dataFromSchema(
  schema: SchemaDescription,
  collectionName: string,
): Record<string, unknown> {
  const collection = schema.collections.find((c) => c.name === collectionName);
  if (!collection) throw new Error(`schema missing collection ${collectionName}`);
  const data: Record<string, unknown> = {};
  for (const f of collection.fields) {
    if (f.optional) continue;
    switch (f.type) {
      case "string":
      case "text":
        data[f.name] = `Agent ${f.name}`;
        break;
      case "number":
        data[f.name] = 1;
        break;
      case "boolean":
        data[f.name] = true;
        break;
      default:
        // Nested/asset/json: skip optional-only paths; required nested is out of
        // scope for this minimal cold page (file-authoritative marketing page).
        throw new Error(`cold-agent fixture cannot invent required field type ${f.type}`);
    }
  }
  return data;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-cold-"));
  mkdirSync(join(dir, "pages"));
  // Seed one doc so list_content is non-empty before the agent writes.
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\ndescription: Seed\n---\nHi\n");

  const server = createGraftMcp({
    contentDir: dir,
    collections,
    db: stubDb,
    name: "graft-cold-agent",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "cold-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("P6.1 cold-agent path (MCP only)", () => {
  it("discovers schema, authors a page, recovers from a bad write, and reads it back", async () => {
    // 1) Discover — no prior knowledge of collection names beyond tools.
    const listed = await callTool("list_collections");
    expect(listed.isError).toBe(false);
    const names = (listed.payload.collections as { name: string; authority: string }[]).map(
      (c) => c.name,
    );
    expect(names).toContain("pages");

    const described = await callTool("describe_schema");
    expect(described.isError).toBe(false);
    const schema = SchemaDescription.parse(described.payload);
    const pages = schema.collections.find((c) => c.name === "pages");
    expect(pages?.authority).toBe("file-authoritative");
    expect(pages?.fields.some((f) => f.name === "title" && !f.optional)).toBe(true);

    // 2) Fail first (missing required field) — agent must use fix / explain_error.
    const bad = await callTool("write_content", {
      collection: "pages",
      slug: "cold-agent-page",
      data: { tagline: "no title" },
      body: "Should not land.",
    });
    expect(bad.isError).toBe(true);
    expect(bad.payload.error).toBe(ErrorCodes.SCHEMA_VALIDATION_FAILED);
    expect(String(bad.payload.fix)).toMatch(/title/i);
    expect(existsSync(join(dir, "pages", "cold-agent-page.mdx"))).toBe(false);

    const explained = await callTool("explain_error", {
      code: ErrorCodes.SCHEMA_VALIDATION_FAILED,
    });
    expect(explained.isError).toBe(false);
    expect(String(explained.payload.howToRecover ?? explained.payload.summary)).toBeTruthy();

    // 3) Succeed using only schema-derived data.
    const data = dataFromSchema(schema, "pages");
    data.order = 42; // optional, agent may set after reading describe_schema
    const written = await callTool("write_content", {
      collection: "pages",
      slug: "cold-agent-page",
      data,
      body: "## Authored cold\n\nNo human session context.",
    });
    expect(written.isError).toBe(false);
    expect(written.payload.written).toBe("pages/cold-agent-page.mdx");
    expect(existsSync(join(dir, "pages", "cold-agent-page.mdx"))).toBe(true);
    const file = readFileSync(join(dir, "pages", "cold-agent-page.mdx"), "utf8");
    expect(file).toContain("title:");
    expect(file).toContain("Authored cold");

    // 4) Read back — git-authoritative files, not memory of the write call.
    const got = await callTool("get_content", {
      collection: "pages",
      slug: "cold-agent-page",
    });
    expect(got.isError).toBe(false);
    expect(got.payload).toMatchObject({
      slug: "cold-agent-page",
      sourcePath: "pages/cold-agent-page.mdx",
      data: { title: data.title, description: data.description },
    });
    expect(String(got.payload.body)).toContain("Authored cold");

    const listedAfter = await callTool("list_content", { collection: "pages" });
    const slugs = (listedAfter.payload.documents as { slug: string }[]).map((d) => d.slug);
    expect(slugs).toEqual(expect.arrayContaining(["home", "cold-agent-page"]));
  });

  it("refuses db-authoritative collections with an agent-actionable fix", async () => {
    // Re-bind server with a db-authoritative collection present.
    const mixed = {
      ...collections,
      orders: defineCollection({
        name: "orders",
        authority: "db-authoritative",
        fields: { email: field.string() },
      }),
    };
    const server = createGraftMcp({ contentDir: dir, collections: mixed, db: stubDb });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const agent = new Client({ name: "cold-agent-2", version: "0.0.0" });
    await agent.connect(ct);

    const result = (await agent.callTool({
      name: "write_content",
      arguments: { collection: "orders", slug: "x", data: { email: "a@b.co" } },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(result.isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.AUTHORITY_MISMATCH);
    expect(String(payload.fix)).toMatch(/api\/fn|function/i);
  });
});
