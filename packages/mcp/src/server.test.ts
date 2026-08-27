/**
 * Unit tests: a real MCP client talking to the server over an in-memory transport.
 * The database is a tripwire proxy — read-only tools and rejected writes must
 * never touch it (validation happens before projection).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCodes, RegistryItemDescriptor, SchemaDescription } from "@usegraft/contracts";
import { defineCollection, defineFunction, field } from "@usegraft/core";
import type { Database } from "@usegraft/db";
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

describe("tool scopes", () => {
  async function connectAs(scopes: readonly string[]) {
    const server = createGraftMcp({
      contentDir: dir,
      collections,
      db: untouchableDb,
      connectionActor: { kind: "human", id: "site-user", scopes },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const c = new Client({ name: "scoped", version: "0.0.0" });
    await c.connect(clientTransport);
    return c;
  }

  const call = async (c: Client, name: string, args: Record<string, unknown>) => {
    const r = (await c.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return { isError: r.isError === true, payload: JSON.parse(r.content[0]?.text ?? "null") };
  };

  it("refuses content authoring to a credential scoped only for reads", async () => {
    // The landing-page example hands every self-registered account a token
    // scoped for reads. Scopes were consulted ONLY inside run_function's access
    // rules, so such a user reached write_content, put_asset and delete_content
    // unchecked — a read token was a content-admin token.
    const c = await connectAs(["submissions:read"]);

    for (const [tool, args] of [
      ["write_content", { collection: "pages", slug: "x", data: { title: "T" }, body: "b" }],
      ["put_asset", { key: "a/b.png", base64: "AA==" }],
      ["delete_content", { collection: "pages", slug: "home" }],
    ] as const) {
      const { isError, payload } = await call(c, tool, args);
      expect(isError, tool).toBe(true);
      expect(payload, tool).toMatchObject({ details: { required: "content:write" } });
    }
  });

  it("refuses a write tool when a resolver is wired but the identity is not", async () => {
    // The combination that shipped in one of our own examples: `actor` set,
    // `connectionActor` forgotten. Every scope check silently passed, so
    // write_content / put_asset / delete_content were ungated on a server whose
    // whole point was that ordinary users may not author content.
    const server = createGraftMcp({
      contentDir: dir,
      collections,
      db: untouchableDb,
      actor: () => ({ kind: "agent", id: "agent-1", scopes: [] }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const c = new Client({ name: "miswired", version: "0.0.0" });
    await c.connect(clientTransport);

    const { isError, payload } = await call(c, "write_content", {
      collection: "pages",
      slug: "x",
      data: { title: "T" },
      body: "b",
    });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ error: "CONFIG_INVALID" });
  });

  it("still serves an unauthenticated mount that opted into anonymous", async () => {
    // No resolver at all is a deliberate local-dev mount. There is nothing to
    // check a scope against, and refusing would break it for no gain.
    const server = createGraftMcp({ contentDir: dir, collections, db: untouchableDb });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const c = new Client({ name: "anon", version: "0.0.0" });
    await c.connect(clientTransport);

    const result = (await c.callTool({
      name: "write_content",
      arguments: { collection: "pages", slug: "x", data: { title: "T" }, body: "b" },
    })) as { content: { text: string }[] };

    // It gets past the scope gate and reaches the tripwire database, which is
    // exactly the proof: the refusal it would have hit is not there.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("CONFIG_INVALID");
    expect(text).toContain("touched the database");
  });

  it("separates authoring from deciding the human gate", async () => {
    const c = await connectAs(["content:write"]);
    const { isError, payload } = await call(c, "decide_approval", {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      decision: "approved",
    });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ details: { required: "approvals:decide" } });
  });
});

describe("decide_approval attribution", () => {
  async function connect(options: Parameters<typeof createGraftMcp>[0]) {
    const server = createGraftMcp(options);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const c = new Client({ name: "decider", version: "0.0.0" });
    await c.connect(clientTransport);
    return c;
  }

  it("offers no way to name the decider", async () => {
    const c = await connect({ contentDir: dir, collections, db: untouchableDb });
    const { tools } = await c.listTools();
    const decide = tools.find((t) => t.name === "decide_approval");

    expect(decide).toBeDefined();
    // `decided_by` is what the requester-cannot-decide check compares against,
    // so a caller who can set it can always approve their own request by
    // naming somebody else. The argument must not exist at all.
    expect(Object.keys(decide?.inputSchema.properties ?? {})).toEqual(["id", "decision"]);
  });

  it("refuses an unauthenticated connection before reaching the database", async () => {
    // untouchableDb throws on any property access, so this also proves the
    // refusal happens before any query — an anonymous caller cannot even probe.
    const c = await connect({ contentDir: dir, collections, db: untouchableDb });

    const result = (await c.callTool({
      name: "decide_approval",
      arguments: { id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", decision: "approved" },
    })) as { isError?: boolean; content: { type: string; text: string }[] };

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "null")).toMatchObject({
      error: "UNAUTHORIZED",
    });
  });

  it("attributes the decision to the connection's identity, not the caller's claim", async () => {
    let seen: { kind: string; id: string } | undefined;
    const c = await connect({
      contentDir: dir,
      collections,
      connectionActor: { kind: "human", id: "reviewer-1", scopes: ["approvals:decide"] },
      db: {
        update: () => ({
          set: (values: { decidedBy: string; decidedByKind: string }) => {
            seen = { kind: values.decidedByKind, id: values.decidedBy };
            return {
              where: () => ({ returning: async () => [{ id: "row", status: "approved" }] }),
            };
          },
        }),
      } as unknown as Database,
    });

    await c.callTool({
      name: "decide_approval",
      arguments: {
        id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        decision: "approved",
        // Ignored: not in the schema, and nothing reads it.
        decidedBy: "someone-else",
      },
    });

    expect(seen).toEqual({ kind: "human", id: "reviewer-1" });
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

  it("run_function acts with defaultAuthorization when no token is passed, and an explicit token overrides it", async () => {
    const server = createGraftMcp({
      contentDir: dir,
      collections,
      functions,
      db: { __stub: true } as unknown as Database,
      audit: false,
      defaultAuthorization: "server-held-token",
      actor: async (request) => {
        const header = request.headers.get("authorization");
        if (header === "Bearer server-held-token") return { kind: "agent", id: "default-actor" };
        if (header === "Bearer explicit-token") return { kind: "agent", id: "explicit-actor" };
        return { kind: "anonymous" };
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const agent = new Client({ name: "default-authed", version: "0.0.0" });
    await agent.connect(clientTransport);

    // No token in the tool call — the server's own credential authorizes the gated mutation.
    const viaDefault = (await agent.callTool({
      name: "run_function",
      arguments: { name: "secretWrite", input: {} },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(viaDefault.isError).toBeFalsy();
    expect(JSON.parse(viaDefault.content[0]?.text ?? "null").data).toEqual({ wrote: true });

    // Explicit authorization wins over the default (garbage → anonymous → gated).
    const overridden = (await agent.callTool({
      name: "run_function",
      arguments: { name: "secretWrite", input: {}, authorization: "wrong-token" },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(overridden.isError).toBe(true);
    expect(JSON.parse(overridden.content[0]?.text ?? "null").error).toBe(ErrorCodes.UNAUTHORIZED);
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

  // Ranking itself is proven against a live database in
  // packages/db/src/search.integration.test.ts ("ranks slug/title matches above
  // body-only matches"). What THIS test owns is the mapping: which columns of a
  // hit reach the agent, and — more to the point — which do not.
  it("maps a hit to the agent's shape and leaks no internal columns", async () => {
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

    const server = createGraftMcp({
      contentDir: dir,
      collections,
      db: stubDb,
      // Explicit scope: the stub only speaks the search query shape, not the
      // branches lookup lazy resolution would issue.
      scope: { kind: "overlay", chain: ["main"], writeBranch: "main" },
    });
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

    // toEqual above is exact, so this is belt-and-braces — but it names the
    // property, which is the part a future edit would otherwise weaken without
    // anyone noticing. The stored row carries branch ids, content hashes, the
    // tsvector and a deletion flag; none of that is the agent's business.
    const hit = payload.hits[0] as Record<string, unknown>;
    for (const internal of ["branchId", "contentHash", "search", "deleted", "updatedAt"]) {
      expect(hit, internal).not.toHaveProperty(internal);
    }
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

describe("registry tools (P6.3)", () => {
  it("list_registry lists owned primitives available to graft add", async () => {
    const { payload } = await callTool("list_registry");
    const names = payload.items.map((item: { name: string }) => item.name);
    expect(names).toContain("comments");
    expect(names).toContain("scoped-access");
    const comments = payload.items.find((item: { name: string }) => item.name === "comments");
    expect(comments).toMatchObject({ type: "bundle", registryDependencies: ["scoped-access"] });
  });

  it("describe_item returns a valid RegistryItemDescriptor (no absolute dir leak)", async () => {
    const { isError, payload } = await callTool("describe_item", { name: "comments" });
    expect(isError).toBe(false);
    const parsed = RegistryItemDescriptor.parse(payload);
    expect(parsed).toMatchObject({ name: "comments", type: "bundle", llms: true });
    expect(parsed.files).toEqual([{ target: "graft/comments.ts", role: "module" }]);
    expect(payload).not.toHaveProperty("dir");
  });

  it("describe_item rejects unknown items with REGISTRY_ITEM_NOT_FOUND + a fix", async () => {
    const { isError, payload } = await callTool("describe_item", { name: "does-not-exist" });
    expect(isError).toBe(true);
    expect(payload.error).toBe(ErrorCodes.REGISTRY_ITEM_NOT_FOUND);
    expect(payload.details.available).toContain("comments");
    expect(payload.fix).toBeTruthy();
    expect(payload.howToRecover).toBeTruthy();
  });
});
