/**
 * setup_status: the same checklist `graft doctor` prints, for an agent. Only
 * on a server that has the project folder.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

async function connect(projectDir?: string) {
  const dir = projectDir ?? mkdtempSync(join(tmpdir(), "graft-mcp-setup-"));
  const contentDir = join(dir, "content");
  mkdirSync(join(contentDir, "pages"), { recursive: true });
  writeFileSync(join(contentDir, "pages", "home.mdx"), "---\ntitle: Home\n---\n");
  const server = createGraftMcp({
    contentDir,
    collections,
    staticIndexPath: join(dir, ".graft", "index.db"),
    ...(projectDir ? { projectDir } : {}),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "setup-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("setup_status", () => {
  it("tells an agent what is missing and the one thing to do next", async () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-mcp-setup-"));
    const client = await connect(dir);
    const result = (await client.callTool({ name: "setup_status", arguments: {} })) as {
      structuredContent?: {
        ready: boolean;
        next: string | null;
        checks: Array<{ id: string; state: string }>;
      };
    };
    expect(result.structuredContent).toMatchObject({ ready: false, next: "Run `graft compile`." });
    expect(result.structuredContent?.checks.map((c) => [c.id, c.state])).toEqual([
      ["database", "pass"],
      ["content", "pass"],
      ["index", "fail"],
    ]);
  });

  it("is not offered by a server without the project folder", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("setup_status");
  });
});
