/**
 * Unit tests: a real MCP client talking to the server over an in-memory transport.
 * The database is a tripwire proxy — read-only tools and rejected writes must
 * never touch it (validation happens before projection).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorCodes, SchemaDescription } from "@graft/contracts";
import { defineCollection, field } from "@graft/core";
import type { Database } from "@graft/db";
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
    ]);
  });

  it("describes the schema as a valid SchemaDescription", async () => {
    const { payload } = await callTool("describe_schema");
    const parsed = SchemaDescription.parse(payload);
    expect(parsed.collections.map((collection) => collection.name)).toEqual(["pages", "posts"]);
    const pages = parsed.collections[0];
    expect(pages?.fields).toContainEqual({
      name: "title",
      type: "string",
      optional: false,
      description: "Headline",
    });
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
