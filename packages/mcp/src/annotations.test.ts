/**
 * Every tool declares what it does to the world, and the classification is
 * pinned here rather than left to whoever adds the next tool.
 *
 * The list is exhaustive on purpose. A new tool fails this test until someone
 * writes down whether it reads, writes, or destroys — which is the one decision
 * that must not be made by defaulting, because the protocol's own defaults are
 * the cautious ones (`destructiveHint` and `openWorldHint` are both true when
 * absent) and a read tool inheriting them teaches a client to interrupt a human
 * for `search_content`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

// SAFETY: a tripwire, never a Database. Every property access throws, so the
// assertion only has to satisfy the parameter type — nothing reads through it.
const untouchableDb = new Proxy({} as Database, {
  get() {
    throw new Error("a read-only tool touched the database");
  },
});

/** name → what it does. Exhaustive: an unlisted tool fails the suite. */
const EXPECTED = {
  list_collections: "reads",
  describe_schema: "reads",
  list_functions: "reads",
  describe_function: "reads",
  list_registry: "reads",
  describe_item: "reads",
  list_content: "reads",
  get_content: "reads",
  search_content: "reads",
  list_branches: "reads",
  list_compilations: "reads",
  list_approvals: "reads",
  explain_error: "reads",
  write_content: "writes",
  delete_content: "destroys",
  put_asset: "destroys",
  decide_approval: "destroys",
  run_function: "destroys",
} satisfies Record<string, "reads" | "writes" | "destroys">;

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-annotations-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\n---\nBody");

  const server = createGraftMcp({ contentDir: dir, collections, db: untouchableDb });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("tool annotations", () => {
  it("covers every registered tool, and registers every covered tool", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("marks a read as read-only, so a client never gates one behind a human", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      if (EXPECTED[tool.name] !== "reads") continue;
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
    }
  });

  it("marks a destructive tool destructive, which is what earns the confirmation", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      if (EXPECTED[tool.name] !== "destroys") continue;
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
    }
  });

  it("marks a write as changing the world but recoverable — for content, git is the undo", async () => {
    const { tools } = await client.listTools();
    const write = tools.find((tool) => tool.name === "write_content");

    expect(write?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it("claims no open world: the domain is the collections the project declares", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  it("gives every tool a human title alongside its name", async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.title ?? tool.annotations?.title, tool.name).toBeTruthy();
    }
  });
});

describe("structured content", () => {
  it("returns the payload as data, not only as prose", async () => {
    const result = await client.callTool({ name: "list_collections", arguments: {} });

    expect(result.structuredContent).toMatchObject({ branch: "main" });
  });

  it("keeps the text form byte-identical, so an older client sees no change", async () => {
    const result = await client.callTool({ name: "list_collections", arguments: {} });
    // SAFETY: list_collections succeeded above and every Graft tool answers
    // with one text block; the assertion below fails loudly if it did not.
    const [block] = result.content as { text: string }[];

    expect(JSON.parse(block.text)).toEqual(result.structuredContent);
  });

  it("omits structured content on a failure rather than shipping a half-answer", async () => {
    const result = await client.callTool({
      name: "get_content",
      arguments: { collection: "nope", slug: "x" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});
