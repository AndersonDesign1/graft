/**
 * P6.4 — Remote cold-agent path (CI-blocking).
 *
 * The P6.1 gate proved a fresh agent can operate Graft through the MCP tools;
 * this one proves the same from *outside the process*: every byte crosses the
 * Streamable HTTP wire (`createGraftMcpHandler`), the endpoint requires an
 * actor, and the agent starts with nothing but a URL and a bearer token — the
 * eve / hosted-agent reality. New ground vs P6.1: the 401 → learn → reconnect
 * loop, typed function invocation authorized by the *connection's* bearer
 * (never echoed into tool arguments), and registry browsing.
 *
 * Projection is stubbed so CI stays offline (no DATABASE_URL); the live
 * off-repo agent exercise stays a manual gate (see phases tracker).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCodes, SchemaDescription } from "@usegraft/contracts";
import { defineCollection, defineFunction, field } from "@usegraft/core";
import type { ChangeSet, Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@usegraft/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/db")>();
  return {
    ...actual,
    projectBranchContent: vi.fn(
      async (_db: Database, rows: { collection: string; slug: string }[]): Promise<ChangeSet> => ({
        added: rows.map((r) => `${r.collection}/${r.slug}`),
        changed: [],
        removed: [],
        unchanged: 0,
      }),
    ),
  };
});

// Import after mock so the handler → compile sees the stubbed projection.
const { createGraftMcpHandler } = await import("./http");
type GraftMcpHandler = import("./http").GraftMcpHandler;

const collections = {
  pages: defineCollection({
    name: "pages",
    description: "Marketing pages an agent can author as MDX.",
    fields: {
      title: field.string({ description: "Page headline (h1) and <title>." }),
      description: field.string({ description: "Meta description." }),
      order: field.number({ optional: true, description: "Nav sort order." }),
    },
  }),
};

const functions = {
  recordLead: defineFunction({
    name: "recordLead",
    kind: "mutation",
    description: "Gated mutation — rejects anonymous callers.",
    input: { email: field.string({ description: "Lead email" }) },
    handler: ({ input }) => ({ recorded: input.email }),
  }),
};

/** Remote reality: the endpoint authenticates every request; dev-token semantics. */
const AGENT_TOKEN = "remote-agent-token";
const resolveActor = (request: Request) =>
  request.headers.get("authorization") === `Bearer ${AGENT_TOKEN}`
    ? // A remote authoring agent: scoped for content, never for the human gate.
      ({ kind: "agent", id: "remote-cold-agent", scopes: ["content:write"] } as const)
    : ({ kind: "anonymous" } as const);

let dir: string;
let handler: GraftMcpHandler;

/** Route the client's HTTP requests straight into the Web-standard handler. */
const handlerFetch: typeof fetch = async (input, init) => handler(new Request(input, init));

function transport(headers?: Record<string, string>) {
  return new StreamableHTTPClientTransport(new URL("http://remote.test/api/mcp"), {
    fetch: handlerFetch,
    requestInit: headers ? { headers } : undefined,
  });
}

async function connect(headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "remote-cold-agent", version: "0.0.0" });
  await client.connect(transport(headers));
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  return {
    isError: result.isError === true,
    payload: JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-cold-http-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\ndescription: Seed\n---\nHi\n");

  handler = createGraftMcpHandler({
    contentDir: dir,
    collections,
    functions,
    db: { __stub: true } as unknown as Database,
    audit: false,
    actor: resolveActor,
    name: "graft-remote-cold-agent",
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("P6.4 remote cold-agent path (HTTP MCP only)", () => {
  it("hits the auth wall first and the 401 teaches the fix", async () => {
    // A cold agent's very first connect, no credentials: the error itself must
    // say what to send — that is the only teacher available over the wire.
    await expect(connect()).rejects.toThrow(/Bearer/);
  });

  it("authors a page, recovers from a bad write, invokes a gated function, and browses the registry — all over the wire", async () => {
    const agent = await connect({ authorization: `Bearer ${AGENT_TOKEN}` });

    // 1) Discover — tool list + schema, no prior knowledge.
    const tools = (await agent.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining(["describe_schema", "write_content", "run_function", "list_registry"]),
    );

    const described = await callTool(agent, "describe_schema");
    expect(described.isError).toBe(false);
    const schema = SchemaDescription.parse(described.payload);
    const pages = schema.collections.find((c) => c.name === "pages");
    expect(pages?.authority).toBe("file-authoritative");

    // 2) Fail first (missing required field) — recover from the fix + explain_error.
    const bad = await callTool(agent, "write_content", {
      collection: "pages",
      slug: "remote-page",
      data: { order: 1 },
      body: "Should not land.",
    });
    expect(bad.isError).toBe(true);
    expect(bad.payload.error).toBe(ErrorCodes.SCHEMA_VALIDATION_FAILED);
    expect(existsSync(join(dir, "pages", "remote-page.mdx"))).toBe(false);

    const explained = await callTool(agent, "explain_error", {
      code: ErrorCodes.SCHEMA_VALIDATION_FAILED,
    });
    expect(explained.isError).toBe(false);
    expect(String(explained.payload.howToRecover ?? explained.payload.summary)).toBeTruthy();

    // 3) Write with schema-derived data only, then read it back from the files.
    const data: Record<string, unknown> = {};
    for (const f of pages?.fields ?? []) {
      if (f.optional) continue;
      data[f.name] = f.type === "number" ? 1 : `Remote ${f.name}`;
    }
    const written = await callTool(agent, "write_content", {
      collection: "pages",
      slug: "remote-page",
      data,
      body: "## Authored remotely\n\nHTTP MCP only.",
    });
    expect(written.isError).toBe(false);
    expect(written.payload.written).toBe("pages/remote-page.mdx");
    expect(readFileSync(join(dir, "pages", "remote-page.mdx"), "utf8")).toContain(
      "Authored remotely",
    );

    const got = await callTool(agent, "get_content", { collection: "pages", slug: "remote-page" });
    expect(got.isError).toBe(false);
    expect(got.payload.data).toMatchObject({ title: data.title });

    // 4) Typed function: discover → describe → invoke. The gated mutation is
    // authorized by the CONNECTION's bearer — no token in the tool arguments.
    const fns = await callTool(agent, "list_functions");
    expect(fns.isError).toBe(false);
    expect(fns.payload.functions).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "recordLead", kind: "mutation" })]),
    );

    const fnSchema = await callTool(agent, "describe_function", { name: "recordLead" });
    expect(fnSchema.isError).toBe(false);

    const ran = await callTool(agent, "run_function", {
      name: "recordLead",
      input: { email: "cold@remote.test" },
    });
    expect(ran.isError).toBe(false);
    expect(ran.payload.data).toEqual({ recorded: "cold@remote.test" });
    expect(ran.payload.correlationId).toBeTruthy();

    // 5) Registry browse — the agent can see what `graft add` offers.
    const registry = await callTool(agent, "list_registry");
    expect(registry.isError).toBe(false);
    const items = registry.payload.items as { name: string }[];
    expect(items.length).toBeGreaterThan(0);

    const item = await callTool(agent, "describe_item", { name: items[0]!.name });
    expect(item.isError).toBe(false);
    expect(item.payload).toMatchObject({ name: items[0]!.name });

    await agent.close();
  });

  it("fails closed: an anonymous synthetic request cannot slip past the gate", async () => {
    // Belt and braces for the transport itself — a bare POST with no bearer.
    const response = await handler(
      new Request("http://remote.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      }),
    );
    expect(response.status).toBe(401);
  });
});
