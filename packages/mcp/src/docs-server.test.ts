/**
 * The public documentation server.
 *
 * The valuable assertion here is negative. Anyone can reach this endpoint, so
 * the test that matters is the exhaustive one: exactly these tools and no
 * others. A test that only checked `search_content` works would pass just as
 * happily on a server that also published `write_content`.
 *
 * The excluded set is mostly not about writes. `describe_schema` carries the
 * project's functions, `list_registry` its owned primitives, and the branch,
 * compilation and approval listings its operations. All reads, which is why
 * "read-only" is the wrong test for what belongs on a public mount.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, defineFunction, field } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocsMcp, type DocsMcpOptions } from "./server";

const collections = {
  docs: defineCollection({
    name: "docs",
    fields: { title: field.string(), description: field.string({ optional: true }) },
  }),
};

const functions = {
  secretOperation: defineFunction({
    name: "secretOperation",
    kind: "query",
    input: {},
    handler: async () => ({ ok: true }),
  }),
};

// SAFETY: a tripwire, never a Database. The docs surface reads files only, so
// any property access through this is a bug and throws instead of stubbing.
const untouchableDb = new Proxy({} as Database, {
  get() {
    throw new Error("the docs server touched the database");
  },
});

/** Everything the public server may offer. Exhaustive on purpose. */
const PUBLISHED = [
  "explain_error",
  "get_content",
  "list_collections",
  "list_content",
  // Graft's own packages, not the project's. "What do I install" is the first
  // question a stranger's agent asks, and the answer says nothing about whose
  // site this is.
  "list_packages",
  "search_content",
];

/** Everything it must not, and why each one is here rather than there. */
const WITHHELD = [
  "decide_approval", // decides the human gate
  "delete_content", // destructive
  "describe_function", // the project's API
  "describe_item", // the project's owned primitives
  "describe_schema", // carries `functions` since P6.2
  "list_approvals", // pending operational rows
  "list_branches", // branch names are operations
  "list_compilations", // compile history is operations
  "list_functions", // the project's API
  "list_registry", // the project's owned primitives
  "put_asset", // writes to the asset store
  "run_function", // executes project code
  "write_content", // writes
];

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-docs-mcp-"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "docs", "intro.mdx"), "---\ntitle: Intro\n---\nHello.\n");

  // `functions` is passed in deliberately. DocsMcpOptions has no such field, so
  // a literal would be refused outright — an object that carries it anyway
  // stands in for a JavaScript caller who gets no such refusal, and proves the
  // factory drops it at runtime rather than merely declining to register the
  // tools that would have read it.
  const asJsCaller: DocsMcpOptions & { functions: typeof functions } = {
    contentDir: dir,
    collections,
    db: untouchableDb,
    branchId: "main",
    functions,
  };
  const server = createDocsMcp(asJsCaller);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "public-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the published surface", () => {
  it("offers exactly the documentation tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(PUBLISHED);
  });

  it("offers none of the withheld tools", async () => {
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));

    expect(WITHHELD.filter((name) => names.has(name))).toEqual([]);
  });

  it("refuses a withheld tool by name, not merely by hiding it", async () => {
    // An unregistered tool comes back as an error result rather than a thrown
    // rejection, which is the SDK's shape: the call reached the server and the
    // server said no. Either way there is nothing to invoke.
    const result = await client.callTool({
      name: "write_content",
      arguments: { collection: "docs", slug: "x" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/write_content.*not found/);
  });

  it("publishes no prompts: three of the four instruct write_content", async () => {
    await expect(client.listPrompts()).rejects.toThrow();
  });
});

describe("what it does serve", () => {
  it("lists collections, so a caller can reach the other tools", async () => {
    const result = await client.callTool({ name: "list_collections", arguments: {} });

    expect(result.structuredContent).toMatchObject({
      collections: [{ name: "docs" }],
    });
  });

  it("reads a document, with the authored bytes intact", async () => {
    const result = await client.callTool({
      name: "get_content",
      arguments: { collection: "docs", slug: "intro" },
    });

    expect(result.structuredContent).toMatchObject({ slug: "intro", body: "Hello." });
  });

  it("serves documents as resources", async () => {
    const { resources } = await client.listResources();

    expect(resources.map((resource) => resource.uri)).toEqual(["graft://main/docs/intro"]);
  });

  it("withholds the schema resource, which carries the function surface", async () => {
    const { resources } = await client.listResources();

    expect(resources.some((resource) => resource.uri.endsWith("/schema"))).toBe(false);
  });

  it("explains an error, which is documentation and not operations", async () => {
    const result = await client.callTool({
      name: "explain_error",
      arguments: { code: "SCHEMA_VALIDATION_FAILED" },
    });

    expect(result.structuredContent).toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
  });

  it("never touches the database, so it runs on a static project too", async () => {
    // The proxy above throws on any access. Reaching here means these answers
    // came from the content directory.
    await client.callTool({ name: "list_content", arguments: { collection: "docs" } });
    await client.readResource({ uri: "graft://main/docs/intro" });

    expect(readFileSync(join(dir, "docs", "intro.mdx"), "utf8")).toContain("Hello.");
  });
});
