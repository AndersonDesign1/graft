/**
 * The agent surface on the zero-service tier.
 *
 * Graft's thesis is that an agent is the primary operator — so authoring must
 * work in the default (static) tier, not only when a database is attached. This
 * drives a real MCP client over a real compiled artifact: no database exists,
 * no projection is stubbed. The Postgres-tier tools must answer NEEDS_DATABASE
 * with an upgrade path rather than crashing on a missing connection.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({
    name: "pages",
    description: "Pages rendered by the site.",
    fields: {
      title: field.string({ description: "Page headline." }),
      tagline: field.string({ optional: true }),
    },
  }),
};

let dir: string;
let contentDir: string;
let indexPath: string;
let client: Client;

/** Parse a tool result's JSON payload (the shape every Graft tool returns). */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: { text: string }[] }).content;
  return JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-static-"));
  contentDir = join(dir, "content");
  indexPath = join(dir, ".graft", "index.db");
  mkdirSync(join(contentDir, "pages"), { recursive: true });
  writeFileSync(
    join(contentDir, "pages", "home.mdx"),
    "---\ntitle: Home\ntagline: Zero services\n---\n\nThe compiled index is a file.\n",
    "utf8",
  );

  const server = createGraftMcp({
    name: "graft-static",
    contentDir,
    collections,
    staticIndexPath: indexPath,
  });
  client = new Client({ name: "test-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP over a static index", () => {
  it("authors a document and compiles it into the artifact — no database", async () => {
    const written = payload(
      await client.callTool({
        name: "write_content",
        arguments: {
          collection: "pages",
          slug: "about",
          data: { title: "About", tagline: "Written by an agent" },
          body: "Authored through MCP with no database attached.",
        },
      }),
    );
    expect(written.written).toBe("pages/about.mdx");
    expect((written.changes as { added: string[] }).added).toContain("pages/about");
    // The file is the truth; the artifact is derived from it.
    expect(readFileSync(join(contentDir, "pages", "about.mdx"), "utf8")).toContain("title: About");
  });

  it("reads content back and searches the compiled artifact", async () => {
    const listed = payload(
      await client.callTool({ name: "list_content", arguments: { collection: "pages" } }),
    );
    expect((listed.documents as { slug: string }[]).map((d) => d.slug).sort()).toEqual([
      "about",
      "home",
    ]);

    const found = payload(
      await client.callTool({ name: "search_content", arguments: { query: "database" } }),
    );
    const hits = found.hits as { slug: string; snippet: string }[];
    expect(hits.map((h) => h.slug)).toContain("about");
    expect(hits[0]?.snippet).toContain("<b>");
  });

  it("search still rejects an empty query before touching the artifact", async () => {
    const result = await client.callTool({ name: "search_content", arguments: { query: "  " } });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(payload(result).error).toBe("INPUT_VALIDATION_FAILED");
  });

  it.each([
    ["list_branches", {}],
    ["list_approvals", {}],
    ["list_compilations", {}],
  ])("%s teaches the upgrade instead of failing on a missing connection", async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const body = payload(result);
    expect(body.error).toBe("NEEDS_DATABASE");
    // Self-teaching: say why it needs Postgres, and how to get there.
    expect(String(body.fix)).toContain('index = "postgres"');
    expect(String(body.fix)).toContain("graft db migrate");
    expect(String(body.howToRecover)).toBeTruthy();
  });

  it("the destructive delete refuses rather than silently dropping its human gate", async () => {
    const result = await client.callTool({
      name: "delete_content",
      arguments: { collection: "pages", slug: "about" },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const body = payload(result);
    expect(body.error).toBe("NEEDS_DATABASE");
    expect(String(body.fix)).toContain("git");
    // The document must still exist — a refused delete deletes nothing.
    expect(readFileSync(join(contentDir, "pages", "about.mdx"), "utf8")).toContain("About");
  });
});
