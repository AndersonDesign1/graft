/**
 * Unit tests: a real MCP client talking to the HTTP handler over Streamable
 * HTTP — the client's fetch is routed straight into the handler, so the full
 * wire protocol runs with no sockets. The database is the same tripwire proxy
 * as the stdio tests: read tools must never touch it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { defineCollection, defineFunction, field } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGraftMcpHandler, type GraftMcpHandler } from "./http";

const collections = {
  pages: defineCollection({
    name: "pages",
    fields: { title: field.string() },
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
let handler: GraftMcpHandler;

/** Route the client's HTTP requests directly into the handler. */
function handlerFetch(handler: GraftMcpHandler): typeof fetch {
  return async (input, init) => handler(new Request(input, init));
}

async function connectClient(handler: GraftMcpHandler): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://graft.test/api/mcp"), {
    fetch: handlerFetch(handler),
  });
  const client = new Client({ name: "http-test-agent", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-http-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\n---\nWelcome");
  handler = createGraftMcpHandler({ contentDir: dir, collections, db: untouchableDb });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("transport shape", () => {
  it("rejects non-POST methods with 405 + Allow", async () => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await handler(new Request("http://graft.test/api/mcp", { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain("stateless");
    }
  });

  it("is stateless: every request is served without a session id", async () => {
    const client = await connectClient(handler);
    const first = await client.listTools();
    const second = await client.listTools();
    expect(first.tools.length).toBe(second.tools.length);
    await client.close();
  });
});

describe("actor gate", () => {
  /** The @usegraft/auth resolver shape, faked: dev-token semantics + TOKEN_INVALID throw. */
  const resolver = (request: Request) => {
    const header = request.headers.get("authorization");
    if (!header) return { kind: "anonymous" } as const;
    if (header === "Bearer s3cret") return { kind: "agent", id: "agent-1" } as const;
    throw new GraftError({
      code: "TOKEN_INVALID",
      message: "The bearer token could not be verified.",
      fix: "Mint a fresh token from a trusted issuer.",
    });
  };

  const gated = () =>
    createGraftMcpHandler({
      contentDir: dir,
      collections,
      db: untouchableDb,
      actor: resolver,
      requireActor: true,
    });

  const post = (handler: GraftMcpHandler, headers: Record<string, string> = {}) =>
    handler(
      new Request("http://graft.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      }),
    );

  it("rejects anonymous callers with 401 when requireActor is set", async () => {
    const response = await post(gated());
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Bearer");
  });

  it("rejects a bad token with the resolver's TOKEN_INVALID message (never downgrades)", async () => {
    const response = await post(gated(), { authorization: "Bearer wrong" });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("could not be verified");
  });

  it("allows anonymous callers when requireActor is off (resolver still vets tokens)", async () => {
    const open = createGraftMcpHandler({
      contentDir: dir,
      collections,
      db: untouchableDb,
      actor: resolver,
    });
    expect((await post(open)).status).not.toBe(401);
    expect((await post(open, { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("fails closed when requireActor is set without a resolver", async () => {
    const misconfigured = createGraftMcpHandler({
      contentDir: dir,
      collections,
      db: untouchableDb,
      requireActor: true,
    });
    expect((await post(misconfigured)).status).toBe(401);
  });

  it("accepts a resolved actor end-to-end", async () => {
    const transport = new StreamableHTTPClientTransport(new URL("http://graft.test/api/mcp"), {
      fetch: handlerFetch(gated()),
      requestInit: { headers: { authorization: "Bearer s3cret" } },
    });
    const client = new Client({ name: "http-test-agent", version: "0.0.0" });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("list_content");
    await client.close();
  });
});

describe("tools over HTTP", () => {
  it("serves the same tools as stdio (content + function + registry surface)", async () => {
    const client = await connectClient(handler);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual([
      "decide_approval",
      "delete_content",
      "describe_function",
      "describe_item",
      "describe_schema",
      "explain_error",
      "get_content",
      "list_approvals",
      "list_branches",
      "list_collections",
      "list_compilations",
      "list_content",
      "list_functions",
      "list_registry",
      "put_asset",
      "run_function",
      "search_content",
      "write_content",
    ]);
    await client.close();
  });

  it("reads content from files without touching the database", async () => {
    const client = await connectClient(handler);
    const result = (await client.callTool({
      name: "get_content",
      arguments: { collection: "pages", slug: "home" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0]?.text ?? "null");
    expect(payload.data.title).toBe("Home");
    await client.close();
  });

  it("returns GraftError JSON with a fix for failed tools", async () => {
    const client = await connectClient(handler);
    const result = (await client.callTool({
      name: "get_content",
      arguments: { collection: "pages", slug: "missing" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "null");
    expect(payload.error).toBe("DOCUMENT_NOT_FOUND");
    expect(payload.fix).toBeTruthy();
    expect(payload.howToRecover).toBeTruthy();
    await client.close();
  });

  it("rejects invalid writes before any database access", async () => {
    const client = await connectClient(handler);
    const result = (await client.callTool({
      name: "write_content",
      arguments: { collection: "pages", slug: "bad", data: { title: 42 }, body: "x" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "null");
    expect(payload.error).toBe("SCHEMA_VALIDATION_FAILED");
    await client.close();
  });

  it("forwards the connection's bearer into run_function (no token in the tool call)", async () => {
    const gatedHandler = createGraftMcpHandler({
      contentDir: dir,
      collections,
      functions: {
        secretWrite: defineFunction({
          name: "secretWrite",
          kind: "mutation",
          description: "Gated mutation (rejects anonymous)",
          input: {},
          handler: () => ({ wrote: true }),
        }),
      },
      // Plain stub, not the tripwire proxy: createFunctionsHandler probes `.then`.
      db: { __stub: true } as unknown as Database,
      audit: false,
      actor: (request) =>
        request.headers.get("authorization") === "Bearer s3cret"
          ? ({ kind: "agent", id: "agent-1" } as const)
          : ({ kind: "anonymous" } as const),
    });

    const call = async (headers?: Record<string, string>) => {
      const transport = new StreamableHTTPClientTransport(new URL("http://graft.test/api/mcp"), {
        fetch: handlerFetch(gatedHandler),
        requestInit: headers ? { headers } : undefined,
      });
      const client = new Client({ name: "http-test-agent", version: "0.0.0" });
      await client.connect(transport);
      const result = (await client.callTool({
        name: "run_function",
        arguments: { name: "secretWrite", input: {} },
      })) as { isError?: boolean; content: { text: string }[] };
      await client.close();
      return {
        isError: result.isError === true,
        payload: JSON.parse(result.content[0]?.text ?? "null"),
      };
    };

    // Anonymous connection → the gated mutation still fails closed.
    const anonymous = await call();
    expect(anonymous.isError).toBe(true);
    expect(anonymous.payload.error).toBe("UNAUTHORIZED");

    // Authenticated connection → the same tool call succeeds with no authorization argument.
    const authed = await call({ authorization: "Bearer s3cret" });
    expect(authed.isError).toBe(false);
    expect(authed.payload.data).toEqual({ wrote: true });
  });
});
