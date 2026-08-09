/**
 * Unit tests: search_content is overlay-aware. `searchContent` itself is
 * chain-aware and integration-tested in @usegraft/db (P4.1); what these tests pin
 * is the MCP wiring — the server must hand it the resolved ancestor chain
 * (from the caller's scope, or lazily from the branch registry), never the
 * bare configured branch id. searchContent is mocked so no query shape is
 * simulated; the db stub only speaks the registry parent lookup.
 */
import { defineCollection, field } from "@usegraft/core";
import type { ContentSearchHit, Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGraftMcp, type GraftMcpOptions } from "./server";

// vi.hoisted: the mock factory runs while modules import, before this file's
// top-level consts initialize.
const searchContentMock = vi.hoisted(() => vi.fn());
vi.mock("@usegraft/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/db")>();
  return {
    ...actual,
    searchContent: (...args: unknown[]) => searchContentMock(...args),
  };
});

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

/** A hit physically written on the parent branch — what a child must inherit. */
const parentHit: ContentSearchHit = {
  row: {
    branchId: "main",
    collection: "pages",
    slug: "pricing",
    data: { title: "Pricing" },
    body: "Plans and pricing",
    contentHash: "h-parent",
    sourcePath: "pages/pricing.mdx",
    deleted: false,
    updatedAt: new Date(),
    search: "",
  },
  rank: 0.42,
  snippet: "Plans and <b>pricing</b>",
};

/** A Database that fails the test the moment anything dereferences it. */
const untouchableDb = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`test touched the database (accessed ${String(prop)})`);
    },
  },
) as Database;

async function connect(options: Omit<GraftMcpOptions, "contentDir" | "collections">) {
  const server = createGraftMcp({ contentDir: "unused", collections, ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "overlay-test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    return {
      isError: result.isError === true,
      payload: JSON.parse(result.content[0]?.text ?? "null"),
    };
  };
}

beforeEach(() => {
  searchContentMock.mockReset();
  searchContentMock.mockResolvedValue([parentHit]);
});

describe("search_content overlay awareness", () => {
  it("searches the caller's resolved chain — parent content found from a child branch", async () => {
    const callTool = await connect({
      db: untouchableDb, // scope provided + search mocked → nothing may query
      branchId: "preview",
      scope: { kind: "overlay", chain: ["preview", "main"], writeBranch: "preview" },
    });

    const { isError, payload } = await callTool("search_content", { query: "pricing" });

    expect(isError).toBe(false);
    // Identity check for the db arg — deep-equality would probe the tripwire proxy.
    expect(searchContentMock).toHaveBeenCalledOnce();
    expect(searchContentMock.mock.calls[0]?.[0]).toBe(untouchableDb);
    expect(searchContentMock.mock.calls[0]?.[1]).toMatchObject({
      query: "pricing",
      chain: ["preview", "main"],
    });
    // The parent-authored doc surfaces from the child, pointing at its file.
    expect(payload.branch).toBe("preview");
    expect(payload.chain).toEqual(["preview", "main"]);
    expect(payload.hits).toEqual([
      expect.objectContaining({
        collection: "pages",
        slug: "pricing",
        sourcePath: "pages/pricing.mdx",
      }),
    ]);
  });

  it("resolves the chain from the branch registry when no scope is passed, once per server", async () => {
    // Speaks only resolveBranchScope's parent walk: preview → main → (root).
    let lookups = 0;
    const responses = [[{ parent: "main" }], [{ parent: null }]];
    const registryDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => responses[lookups++] ?? [],
          }),
        }),
      }),
    } as unknown as Database;

    const callTool = await connect({ db: registryDb, branchId: "preview" });

    const first = await callTool("search_content", { query: "pricing" });
    const second = await callTool("search_content", { query: "plans" });

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    for (const call of searchContentMock.mock.calls) {
      expect(call[1]).toMatchObject({ chain: ["preview", "main"] });
    }
    // One walk (two parent lookups), memoized across calls.
    expect(lookups).toBe(2);
  });

  it("rejects an empty query before resolving any branch scope", async () => {
    const callTool = await connect({ db: untouchableDb, branchId: "preview" });

    const { isError, payload } = await callTool("search_content", { query: "   " });

    expect(isError).toBe(true);
    expect(payload.error).toBe("INPUT_VALIDATION_FAILED");
    expect(searchContentMock).not.toHaveBeenCalled();
  });
});
