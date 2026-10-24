/**
 * The tool client the CLI runs its content commands through: a real server
 * over a real content directory, called by name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  connectInProcess,
  connectRemote,
  remoteError,
  toolResultToGraftError,
  type ToolClient,
} from "./client";
import { createGraftMcpHandler } from "./http";
import { createGraftMcp } from "./server";
import { fail } from "./tool-result";

const collections = {
  pages: defineCollection({
    name: "pages",
    fields: { title: field.string(), tagline: field.string({ optional: true }) },
  }),
};

let dir: string;
let tools: ToolClient;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-client-"));
  mkdirSync(join(dir, "content", "pages"), { recursive: true });
  writeFileSync(join(dir, "content", "pages", "home.mdx"), "---\ntitle: Home\n---\n\nHello.\n");
  tools = await connectInProcess(
    createGraftMcp({
      name: "graft",
      contentDir: join(dir, "content"),
      collections,
      staticIndexPath: join(dir, ".graft", "index.db"),
    }),
  );
});

afterAll(async () => {
  await tools.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("connectInProcess", () => {
  it("calls a tool by name and returns its answer", async () => {
    expect(await tools.call("get_content", { collection: "pages", slug: "home" })).toEqual({
      collection: "pages",
      slug: "home",
      sourcePath: "pages/home.mdx",
      data: { title: "Home" },
      body: "Hello.",
    });
  });

  it("rejects with the GraftError the tool failed with", async () => {
    const error = await tools
      .call("get_content", { collection: "pages", slug: "missing" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GraftError);
    expect(error).toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("names a tool the server does not offer", async () => {
    await expect(tools.call("list_drafts")).rejects.toMatchObject({
      code: "ROUTE_NOT_FOUND",
      details: { tool: "list_drafts" },
    });
  });

  it("lists the tools", async () => {
    const names = (await tools.tools()).map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(["get_content", "write_content", "search_content"]),
    );
  });
});

describe("connectRemote", () => {
  const TOKEN = "graft_at_client-test";
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    const handler = createGraftMcpHandler({
      name: "graft",
      contentDir: join(dir, "content"),
      collections,
      staticIndexPath: join(dir, ".graft", "index.db"),
      actor: (request) =>
        request.headers.get("authorization") === `Bearer ${TOKEN}`
          ? { kind: "agent", id: "client-test", scopes: ["content:write"] }
          : { kind: "anonymous" },
    });
    // A hosted site's /api/mcp, served over real HTTP.
    server = createServer(async (incoming, outgoing) => {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const init: RequestInit = { method: incoming.method ?? "GET", headers };
      if (chunks.length > 0) init.body = Buffer.concat(chunks);
      const response = await handler(new Request(`http://127.0.0.1${incoming.url ?? "/"}`, init));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("calls a tool on the site with the token", async () => {
    const remote = await connectRemote({ origin, token: TOKEN });
    try {
      expect(await remote.call("get_content", { collection: "pages", slug: "home" })).toMatchObject(
        { collection: "pages", slug: "home", data: { title: "Home" } },
      );
      expect((await remote.tools()).map((tool) => tool.name)).toContain("get_content");
      await expect(
        remote.call("get_content", { collection: "pages", slug: "missing" }),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    } finally {
      await remote.close();
    }
  });

  it("is TOKEN_INVALID when the site refuses the token", async () => {
    await expect(connectRemote({ origin, token: "graft_at_wrong" })).rejects.toMatchObject({
      code: "TOKEN_INVALID",
      details: { origin, status: 401 },
    });
  });

  it("is REMOTE_UNREACHABLE when nothing answers", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const address = closed.address();
    await new Promise((resolve) => closed.close(resolve));
    const gone = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    await expect(connectRemote({ origin: gone, token: TOKEN })).rejects.toMatchObject({
      code: "REMOTE_UNREACHABLE",
      details: { origin: gone },
    });
  });
});

describe("toolResultToGraftError", () => {
  it("rebuilds the error fail() sent, field for field", () => {
    const original = new GraftError({
      code: "INVALID_SLUG",
      message: 'Slug "A B" is not URL-safe.',
      fix: "Use kebab-case.",
      details: { slug: "A B" },
    });
    expect(toolResultToGraftError("write_content", fail(original)).toJSON()).toEqual(
      original.toJSON(),
    );
  });

  it("turns text that is not a GraftError into INPUT_VALIDATION_FAILED", () => {
    const error = toolResultToGraftError("write_content", {
      isError: true,
      content: [{ type: "text", text: "Input validation error: slug is required" }],
    });
    expect(error.code).toBe("INPUT_VALIDATION_FAILED");
    expect(error.message).toBe("Input validation error: slug is required");
  });
});

describe("remoteError", () => {
  it("is TOKEN_INVALID when the site refuses the token", () => {
    const error = remoteError(
      new StreamableHTTPError(401, "Unauthorized"),
      "https://cms.example.com",
    );
    expect(error).toMatchObject({ code: "TOKEN_INVALID", details: { status: 401 } });
  });

  it("is REMOTE_UNREACHABLE when the site cannot be reached", () => {
    const error = remoteError(new TypeError("fetch failed"), "https://cms.example.com");
    expect(error).toMatchObject({ code: "REMOTE_UNREACHABLE" });
    expect(error.message).toContain("https://cms.example.com/api/mcp");
  });

  it("passes a tool's own GraftError through", () => {
    const original = new GraftError({ code: "DOCUMENT_NOT_FOUND", message: "No such document." });
    expect(remoteError(original, "https://cms.example.com")).toBe(original);
  });
});
