/**
 * Unit tests: a real MCP client talking to the HTTP handler over Streamable
 * HTTP — the client's fetch is routed straight into the handler, so the full
 * wire protocol runs with no sockets. The database is the same tripwire proxy
 * as the stdio tests: read tools must never touch it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@graft/core";
import type { Database } from "@graft/db";
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

describe("bearer token gate", () => {
  it("rejects missing or wrong tokens with 401", async () => {
    const gated = createGraftMcpHandler({
      contentDir: dir,
      collections,
      db: untouchableDb,
      bearerToken: "s3cret",
    });
    const post = (headers: Record<string, string> = {}) =>
      gated(
        new Request("http://graft.test/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", ...headers },
          body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
        }),
      );

    expect((await post()).status).toBe(401);
    expect((await post({ authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("accepts the right token end-to-end", async () => {
    const gated = createGraftMcpHandler({
      contentDir: dir,
      collections,
      db: untouchableDb,
      bearerToken: "s3cret",
    });
    const transport = new StreamableHTTPClientTransport(new URL("http://graft.test/api/mcp"), {
      fetch: handlerFetch(gated),
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
  it("serves the same six tools as stdio", async () => {
    const client = await connectClient(handler);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toEqual([
      "describe_schema",
      "explain_error",
      "get_content",
      "list_collections",
      "list_content",
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
});
