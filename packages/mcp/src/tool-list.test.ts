/**
 * tools/list answers with this package's zod (see tool-list.ts). Where the
 * SDK and this package share a zod, the answer must be the SDK's own, field
 * for field: these tests compute the SDK's listing from its own helpers and
 * compare.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { normalizeObjectSchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { createDocsMcp, createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

/** Listing tools must never reach the database. */
const db = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`tools/list touched the database (accessed ${String(prop)})`);
    },
  },
) as Database;

async function connect(server: McpServer): Promise<Client> {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "tool-list-test", version: "0" });
  await client.connect(clientSide);
  return client;
}

/** The listing the SDK's own handler builds, from the same registered tools. */
function sdkListing(server: McpServer): unknown[] {
  // SAFETY: _registeredTools is the SDK's map of what registerTool returned;
  // reading it here only reproduces the SDK's answer to compare against.
  const registered = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
  return Object.entries(registered)
    .filter(([, tool]) => tool.enabled)
    .map(([name, tool]) => {
      const input = normalizeObjectSchema(tool.inputSchema);
      const output = tool.outputSchema ? normalizeObjectSchema(tool.outputSchema) : undefined;
      return JSON.parse(
        JSON.stringify({
          name,
          title: tool.title,
          description: tool.description,
          inputSchema: input
            ? toJsonSchemaCompat(input, { strictUnions: true, pipeStrategy: "input" })
            : { type: "object", properties: {} },
          annotations: tool.annotations,
          execution: tool.execution,
          _meta: tool._meta,
          ...(output
            ? {
                outputSchema: toJsonSchemaCompat(output, {
                  strictUnions: true,
                  pipeStrategy: "output",
                }),
              }
            : {}),
        }),
      );
    });
}

describe("tools/list", () => {
  const contentDir = mkdtempSync(join(tmpdir(), "graft-tool-list-"));

  it("lists every tool exactly as the SDK would", async () => {
    const server = createGraftMcp({ contentDir, collections, db, projectDir: contentDir });
    const { tools } = await (await connect(server)).listTools();
    expect(tools.length).toBeGreaterThan(15);
    expect(tools).toEqual(sdkListing(server));
  });

  it("lists the docs surface exactly as the SDK would", async () => {
    const server = createDocsMcp({ contentDir, collections, db });
    const { tools } = await (await connect(server)).listTools();
    expect(tools).toEqual(sdkListing(server));
  });

  it("drops a disabled or removed tool, and follows a rename", async () => {
    const server = createGraftMcp({ contentDir, collections, db });
    const client = await connect(server);
    const registered = (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
      ._registeredTools;
    registered.explain_error?.disable();
    registered.list_packages?.remove();
    registered.list_branches?.update({ name: "branches" });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("explain_error");
    expect(names).not.toContain("list_packages");
    expect(names).not.toContain("list_branches");
    expect(names).toContain("branches");
  });

  it("reports this package's version, not 0.0.0", async () => {
    const client = await connect(createGraftMcp({ contentDir, collections, db }));
    expect(client.getServerVersion()).toEqual({ name: "graft", version: packageJson.version });
  });
});
