/**
 * MCP over a store that is the source of truth (a database-sourced project):
 * documents are found through the store's entries, never the checkout, and
 * write_content says where a write goes. The live database behaviour is in
 * the integration suites; this store is an in-memory stand-in.
 */
import type { ContentStore, StoredFile } from "@usegraft/compiler";
import { defineCollection, field } from "@usegraft/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { findStoredPath } from "./content-hints";
import { createGraftMcp } from "./server";

const pages = defineCollection({ name: "pages", fields: { title: field.string() } });

function memoryStore(files: Record<string, string>): ContentStore {
  const all = (prefix: string): Array<StoredFile & { path: string }> =>
    Object.entries(files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, raw]) => ({ path, raw, version: path }));
  return {
    kind: "database",
    info: () => ({ kind: "database", branch: "main", publishMode: "direct" }),
    read: async (path) => (files[path] ? { raw: files[path], version: path } : null),
    write: async () => ({ version: null }),
    entries: async (prefix) => all(prefix),
  };
}

const actor = { id: "agent-1" };

describe("findStoredPath", () => {
  const store = memoryStore({
    "pages/home.mdx": "---\ntitle: Home\n---\n",
    "pages/notes.md": "---\ntitle: Notes\n---\n",
    "pages/renamed.mdx": "---\ntitle: Renamed\nslug: about\n---\n",
    "pages/broken.mdx": "---\ntitle: [unclosed\n---\n",
    "pages/readme.txt": "not a document",
  });

  it("finds a document by its file name, .mdx or .md", async () => {
    expect(await findStoredPath(store, "pages", pages, "home", actor)).toBe("pages/home.mdx");
    expect(await findStoredPath(store, "pages", pages, "notes", actor)).toBe("pages/notes.md");
  });

  it("finds a document whose frontmatter claims the slug", async () => {
    expect(await findStoredPath(store, "pages", pages, "about", actor)).toBe("pages/renamed.mdx");
  });

  it("is null when nothing claims the slug, skipping drafts that do not parse", async () => {
    expect(await findStoredPath(store, "pages", pages, "missing", actor)).toBeNull();
  });

  it("is null for a store with no entries to search", async () => {
    expect(await findStoredPath({}, "pages", pages, "home", actor)).toBeNull();
  });
});

async function connect(store: ContentStore) {
  const server = createGraftMcp({
    contentDir: "/nonexistent/content",
    collections: { pages },
    db: {} as never,
    audit: false,
    source: "database",
    store,
    actor: () => ({ kind: "agent", id: "agent-1" }),
    connectionActor: { kind: "agent", id: "agent-1", scopes: ["content:read", "content:write"] },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP over a database store", () => {
  it("tells an agent a write is a shared draft, not a file", async () => {
    const client = await connect(memoryStore({}));
    const { tools } = await client.listTools();
    const write = tools.find((tool) => tool.name === "write_content");
    expect(write?.description).toContain("keeps its content in the database");
    expect(write?.description).not.toContain("<contentDir>");
  });

  it("refuses to delete a document the store does not have, before any approval", async () => {
    const client = await connect(memoryStore({ "pages/home.mdx": "---\ntitle: Home\n---\n" }));
    const result = (await client.callTool({
      name: "delete_content",
      arguments: { collection: "pages", slug: "missing" },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      error: "DOCUMENT_NOT_FOUND",
    });
  });
});
