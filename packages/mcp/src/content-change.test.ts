/**
 * The app hears about agent writes.
 *
 * Before onContentChange, write_content returned its ChangeSet to the agent
 * and nothing else happened: the app kept serving its cached copy. This drives
 * a real MCP client over a real static index and checks the listener sees each
 * write that changed something, and that a failing listener does not fail the
 * write.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentChangeEvent, ContentChangeListener } from "@usegraft/compiler";
import { defineCollection, field } from "@usegraft/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({
    name: "pages",
    fields: { title: field.string() },
  }),
};

const dirs: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function connect(onContentChange?: ContentChangeListener): Promise<Client> {
  const dir = mkdtempSync(join(tmpdir(), "graft-mcp-change-"));
  dirs.push(dir);
  const contentDir = join(dir, "content");
  mkdirSync(join(contentDir, "pages"), { recursive: true });
  writeFileSync(join(contentDir, "pages", "home.mdx"), "---\ntitle: Home\n---\n\nHi.\n", "utf8");

  const server = createGraftMcp({
    name: "graft-change",
    contentDir,
    collections,
    staticIndexPath: join(dir, ".graft", "index.db"),
    onContentChange,
  });
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  clients.push(client);
  return client;
}

async function write(client: Client, slug: string, title: string) {
  const result = await client.callTool({
    name: "write_content",
    arguments: { collection: "pages", slug, data: { title } },
  });
  const content = (result as { content: { text: string }[] }).content;
  return {
    isError: (result as { isError?: boolean }).isError === true,
    payload: JSON.parse(content[0]?.text ?? "{}") as Record<string, unknown>,
  };
}

describe("onContentChange", () => {
  it("tells the app what each write changed", async () => {
    const events: ContentChangeEvent[] = [];
    const client = await connect((event) => {
      events.push(event);
    });

    // The first projection also brings in home.mdx, which was on disk already.
    const first = await write(client, "about", "About");
    expect(first.isError).toBe(false);
    expect(first.payload.refresh).toEqual({ ok: true });
    expect(events.at(-1)?.branch).toBe("main");
    expect(events.at(-1)?.changes.added).toContain("pages/about");

    const second = await write(client, "about", "About us");
    expect(second.payload.refresh).toEqual({ ok: true });
    expect(events.at(-1)?.changes).toMatchObject({ added: [], changed: ["pages/about"] });
  });

  it("stays quiet when a write changed nothing", async () => {
    const listener = vi.fn();
    const client = await connect(listener);
    await write(client, "about", "About");
    listener.mockClear();

    const again = await write(client, "about", "About");
    expect(again.isError).toBe(false);
    expect(again.payload.refresh).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the write when the app could not be told, and says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await connect(() => {
      throw new Error("route down");
    });

    const result = await write(client, "about", "About");
    expect(result.isError).toBe(false);
    expect(result.payload.written).toBe("pages/about.mdx");
    expect(result.payload.refresh).toMatchObject({ ok: false, error: "REVALIDATE_FAILED" });
  });

  it("adds no refresh field when no listener is configured", async () => {
    const client = await connect();
    const result = await write(client, "about", "About");
    expect(result.isError).toBe(false);
    expect(result.payload).not.toHaveProperty("refresh");
  });
});
