/**
 * Unit tests: a real MCP client talking to the server over an in-memory transport.
 * The database is a tripwire proxy — read-only tools and rejected writes must
 * never touch it (validation happens before projection).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCodes, SchemaDescription } from "@graft/contracts";
import { defineCollection, defineFunction, field } from "@graft/core";
import type { Database } from "@graft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ERROR_KNOWLEDGE } from "./explain";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({
    name: "pages",
    description: "Marketing pages",
    fields: {
      title: field.string({ description: "Headline" }),
      order: field.number({ optional: true }),
    },
  }),
  posts: defineCollection({
    name: "posts",
    fields: { title: field.string() },
  }),
  submissions: defineCollection({
    name: "submissions",
    authority: "db-authoritative",
    fields: { email: field.string() },
  }),
};

const functions = {
  ping: defineFunction({
    name: "ping",
    kind: "query",
    description: "Health check",
    returns: "{ ok: true }",
    input: {},
    handler: () => ({ ok: true as const }),
  }),
  echo: defineFunction({
    name: "echo",
    kind: "query",
    description: "Echo a message",
    input: { message: field.string({ description: "Text to echo" }) },
    handler: ({ input }) => ({ echoed: input.message }),
  }),
  secretWrite: defineFunction({
    name: "secretWrite",
    kind: "mutation",
    description: "Gated mutation (rejects anonymous)",
    input: {},
    handler: () => ({ wrote: true }),
  }),
  publicWrite: defineFunction({
    name: "publicWrite",
    kind: "mutation",
    public: true,
    description: "Public mutation",
    input: {},
    handler: () => ({ wrote: true }),
  }),
};

/** A Database that fails the test the moment anything dereferences it. */
const untouchableDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`unit test touched the database (accessed ${String(prop)})`);
    },
  },
) as Database;

let dir: string;
let client: Client;

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return {
    isError: result.isError === true,
    payload: JSON.parse(result.content[0]?.text ?? "null"),
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(
    join(dir, "pages", "home.mdx"),
    "---\ntitle: Home\norder: 1\n---\nWelcome to Graft",
  );
  writeFileSync(
    join(dir, "pages", "renamed.mdx"),
    "---\ntitle: Renamed\nslug: about\n---\nAbout page",
  );

  const server = createGraftMcp({ contentDir: dir, collections, db: untouchableDb });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("introspection", () => {
  it("lists collections with metadata", async () => {
    const { payload } = await callTool("list_collections");
    expect(payload.branch).toBe("main");
    expect(payload.collections).toEqual([
      { name: "pages", description: "Marketing pages", authority: "file-authoritative", fields: 2 },
      { name: "posts", description: undefined, authority: "file-authoritative", fields: 1 },
      { name: "submissions", description: undefined, authority: "db-authoritative", fields: 1 },
    ]);
  });

  it("describes the schema as a valid SchemaDescription", async () => {
    const { payload } = await callTool("describe_schema");
    const parsed = SchemaDescription.parse(payload);
    expect(parsed.collections.map((collection) => collection.name)).toEqual([
      "pages",
      "posts",
      "submissions",
    ]);
    // Content-only fixture has no functions export → empty array (still valid).
    expect(parsed.functions).toEqual([]);
    const pages = parsed.collections[0];
    expect(pages?.fields).toContainEqual({
      name: "title",
      type: "string",
      optional: false,
      description: "Headline",
    });
  });
});

describe("function tools (P6.2)", () => {
  let fnClient: Client;

  async function callFn(name: string, args: Record<string, unknown> = {}) {
    const result = (await fnClient.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]?.text ?? "null"),
    };
  }

  beforeEach(async () => {
    // Plain stub db (not the property-tripwire proxy): createFunctionsHandler
    // does Promise.resolve(db), which probes `.then` — a throwing proxy looks
    // thenable and aborts. audit: false skips real audit/approval stores.
    const stubDb = { __stub: true } as unknown as Database;
    const server = createGraftMcp({
      contentDir: dir,
      collections,
      functions,
      db: stubDb,
      audit: false,
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    fnClient = new Client({ name: "fn-agent", version: "0.0.0" });
    await fnClient.connect(clientTransport);
  });

  it("lists functions with kind and flags", async () => {
    const { isError, payload } = await callFn("list_functions");
    expect(isError).toBe(false);
    expect(payload.functions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ping", kind: "query", args: 0 }),
        expect.objectContaining({ name: "echo", kind: "query", args: 1 }),
        expect.objectContaining({ name: "secretWrite", kind: "mutation" }),
        expect.objectContaining({ name: "publicWrite", kind: "mutation", public: true }),
      ]),
    );
  });

  it("describe_schema includes FunctionDescriptors", async () => {
    const { payload } = await callFn("describe_schema");
    const parsed = SchemaDescription.parse(payload);
    expect(parsed.functions.map((f) => f.name).sort()).toEqual([
      "echo",
      "ping",
      "publicWrite",
      "secretWrite",
    ]);
    const echo = parsed.functions.find((f) => f.name === "echo");
    expect(echo?.args).toContainEqual({
      name: "message",
      type: "string",
      optional: false,
      description: "Text to echo",
    });
  });

  it("describe_function returns one FunctionDescriptor", async () => {
    const { isError, payload } = await callFn("describe_function", { name: "echo" });
    expect(isError).toBe(false);
    expect(payload).toMatchObject({
      name: "echo",
      kind: "query",
      description: "Echo a message",
    });
  });

  it("describe_function rejects unknown names with FUNCTION_NOT_FOUND", async () => {
    const { isError, payload } = await callFn("describe_function", { name: "nope" });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.FUNCTION_NOT_FOUND);
    expect(payload.fix).toContain("list_functions");
    expect(payload.details.available).toContain("ping");
  });

  it("run_function invokes a public query and returns { data }", async () => {
    const { isError, payload } = await callFn("run_function", {
      name: "echo",
      input: { message: "hi" },
    });
    expect(isError).toBe(false);
    expect(payload.data).toEqual({ echoed: "hi" });
    expect(payload.correlationId).toBeTruthy();
    expect(payload.status).toBe(200);
  });

  it("run_function rejects bad input with INPUT_VALIDATION_FAILED", async () => {
    const { isError, payload } = await callFn("run_function", {
      name: "echo",
      input: { message: 7 },
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);
    expect(payload.details.issues).toBeTruthy();
  });

  it("run_function enforces the secure mutation default (anonymous → UNAUTHORIZED)", async () => {
    const { isError, payload } = await callFn("run_function", {
      name: "secretWrite",
      input: {},
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.UNAUTHORIZED);
  });

  it("run_function allows public mutations anonymously", async () => {
    const { isError, payload } = await callFn("run_function", {
      name: "publicWrite",
      input: {},
    });
    expect(isError).toBe(false);
    expect(payload.data).toEqual({ wrote: true });
  });

  it("run_function passes bearer auth into the actor resolver", async () => {
    const server = createGraftMcp({
      contentDir: dir,
      collections,
      functions,
      db: { __stub: true } as unknown as Database,
      audit: false,
      actor: async (request) => {
        const header = request.headers.get("authorization");
        if (header === "Bearer secret-token") {
          return { kind: "agent", id: "agent-1" };
        }
        return { kind: "anonymous" };
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const authed = new Client({ name: "authed", version: "0.0.0" });
    await authed.connect(clientTransport);

    const denied = (await authed.callTool({
      name: "run_function",
      arguments: { name: "secretWrite", input: {} },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(denied.isError).toBe(true);

    const allowed = (await authed.callTool({
      name: "run_function",
      arguments: {
        name: "secretWrite",
        input: {},
        authorization: "secret-token",
      },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(allowed.isError).toBeFalsy();
    expect(JSON.parse(allowed.content[0]?.text ?? "null").data).toEqual({ wrote: true });
  });
});

describe("reads (from files — git is authoritative)", () => {
  it("lists documents with frontmatter-derived slugs", async () => {
    const { payload } = await callTool("list_content", { collection: "pages" });
    expect(payload.documents.map((doc: { slug: string }) => doc.slug)).toEqual(["about", "home"]);
    expect(payload.documents[1].sourcePath).toBe("pages/home.mdx");
  });

  it("returns an empty list for a collection with no folder yet", async () => {
    const { payload } = await callTool("list_content", { collection: "posts" });
    expect(payload.documents).toEqual([]);
  });

  it("gets one document with data + body + sourcePath", async () => {
    const { payload } = await callTool("get_content", { collection: "pages", slug: "about" });
    expect(payload).toMatchObject({
      slug: "about",
      sourcePath: "pages/renamed.mdx",
      data: { title: "Renamed" }, // slug is routing metadata, stripped from schema data
      body: "About page",
    });
  });

  it("rejects an unknown collection with a fix", async () => {
    const result = await callTool("list_content", { collection: "nope" });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("COLLECTION_NOT_FOUND");
    expect(result.payload.fix).toContain("pages");
    expect(result.payload.howToRecover).toBeTruthy();
  });

  it("rejects an unknown slug listing the real ones", async () => {
    const result = await callTool("get_content", { collection: "pages", slug: "missing" });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("DOCUMENT_NOT_FOUND");
    expect(result.payload.fix).toContain("about");
  });
});

describe("write_content validation (never reaches the database)", () => {
  it("rejects data that fails the collection schema, without writing", async () => {
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "new-page",
      data: { order: 2 }, // missing required title
    });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("SCHEMA_VALIDATION_FAILED");
    expect(result.payload.fix).toContain("title");
    expect(existsSync(join(dir, "pages", "new-page.mdx"))).toBe(false);
  });

  it("rejects a non-kebab-case slug", async () => {
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "Not A Slug",
      data: { title: "X" },
    });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("INVALID_SLUG");
  });

  it("rejects a slug already owned by a different file", async () => {
    // pages/renamed.mdx claims "about" via frontmatter; writing about.mdx would collide.
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "about",
      data: { title: "Duplicate" },
    });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("SLUG_NOT_UNIQUE");
    expect(result.payload.fix).toContain("pages/renamed.mdx");
    expect(existsSync(join(dir, "pages", "about.mdx"))).toBe(false);
  });

  it("rejects writes to a db-authoritative collection with AUTHORITY_MISMATCH", async () => {
    const result = await callTool("write_content", {
      collection: "submissions",
      slug: "someone",
      data: { email: "a@b.co" },
    });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("AUTHORITY_MISMATCH");
    expect(result.payload.fix).toContain("/api/fn/");
    expect(existsSync(join(dir, "submissions", "someone.mdx"))).toBe(false);
  });

  it("rejects a data.slug that conflicts with the slug argument", async () => {
    const result = await callTool("write_content", {
      collection: "pages",
      slug: "one",
      data: { title: "X", slug: "two" },
    });
    expect(result.isError).toBe(true);
    expect(result.payload.error).toBe("INVALID_SLUG");
    expect(result.payload.fix).toContain("slug argument");
  });
});

describe("search_content", () => {
  it("rejects unknown collections before touching the database", async () => {
    const { isError, payload } = await callTool("search_content", {
      query: "anything",
      collection: "widgets",
    });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.COLLECTION_NOT_FOUND);
  });

  it("rejects an empty query before touching the database", async () => {
    const { isError, payload } = await callTool("search_content", { query: "   " });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.INPUT_VALIDATION_FAILED);
    expect(payload.fix).toBeTruthy();
  });

  it("returns ranked hits pointing at source files", async () => {
    // A separate server over a stub db: search is the one read that goes to
    // the compiled index, not the files.
    const stubDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                {
                  row: {
                    branchId: "main",
                    collection: "pages",
                    slug: "home",
                    data: { title: "Home" },
                    body: "Welcome to Graft",
                    contentHash: "h1",
                    sourcePath: "pages/home.mdx",
                    deleted: false,
                    updatedAt: new Date(),
                    search: "",
                  },
                  rank: 0.61,
                  snippet: "<b>Welcome</b> to Graft",
                },
              ],
            }),
          }),
        }),
      }),
    } as unknown as Database;

    const server = createGraftMcp({ contentDir: dir, collections, db: stubDb });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const searchClient = new Client({ name: "test-agent", version: "0.0.0" });
    await searchClient.connect(clientTransport);

    const result = (await searchClient.callTool({
      name: "search_content",
      arguments: { query: "welcome" },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    const payload = JSON.parse(result.content[0]?.text ?? "null");

    expect(result.isError).toBeFalsy();
    expect(payload.hits).toEqual([
      {
        collection: "pages",
        slug: "home",
        sourcePath: "pages/home.mdx",
        rank: 0.61,
        snippet: "<b>Welcome</b> to Graft",
        data: { title: "Home" },
      },
    ]);
  });
});

describe("explain_error (self-teaching)", () => {
  it("covers every contract error code", () => {
    for (const code of Object.keys(ErrorCodes)) {
      expect(ERROR_KNOWLEDGE[code as keyof typeof ERROR_KNOWLEDGE], code).toBeTruthy();
    }
  });

  it("explains a code", async () => {
    const { payload } = await callTool("explain_error", { code: "SLUG_NOT_UNIQUE" });
    expect(payload.meaning).toContain("slug");
    expect(payload.howToRecover).toBeTruthy();
  });

  it("extracts the specific fix from GraftError JSON", async () => {
    const errorJson = JSON.stringify({
      error: "SCHEMA_VALIDATION_FAILED",
      message: "pages/home.mdx does not match",
      fix: "Add the missing title",
    });
    const { payload } = await callTool("explain_error", { error: errorJson });
    expect(payload.code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(payload.specificFix).toBe("Add the missing title");
  });

  it("lists known codes for an unknown code", async () => {
    const { payload } = await callTool("explain_error", { code: "ENOENT" });
    expect(payload.known).toBe(false);
    expect(payload.knownCodes).toContain("DOCUMENT_NOT_FOUND");
  });
});
