/**
 * Documents and the schema as MCP resources, driven by a real client.
 *
 * The properties worth holding: URIs are stable and derived from the branch a
 * server is pinned to, a read hands back the authored bytes rather than a
 * re-serialisation, db-authoritative collections have nothing to serve, and the
 * completions answer from what actually exists.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import type { Database } from "@usegraft/db";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({
    name: "pages",
    fields: {
      title: field.string(),
      description: field.string({ optional: true }),
    },
  }),
  submissions: defineCollection({
    name: "submissions",
    authority: "db-authoritative",
    fields: { email: field.string() },
  }),
};

// SAFETY: a tripwire, never a Database. Resources read files, so any property
// access through this is a bug and throws rather than returning a stub.
const untouchableDb = new Proxy({} as Database, {
  get() {
    throw new Error("a resource read touched the database");
  },
});

/** The exact bytes on disk, blank line and trailing newline included. */
const HOME = "---\ntitle: Home\ndescription: The front page\n---\n\nWelcome to *Graft*.\n";

/** Resource contents are text or blob; everything Graft serves is text. */
function textOf(result: { contents: Array<Record<string, unknown>> }): string {
  const [content] = result.contents;
  if (typeof content?.text !== "string") {
    throw new Error(`expected text content, got ${JSON.stringify(content)}`);
  }
  return content.text;
}

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-resources-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), HOME);
  writeFileSync(join(dir, "pages", "about.mdx"), "---\ntitle: About\n---\nAbout us.\n");

  const server = createGraftMcp({
    contentDir: dir,
    collections,
    db: untouchableDb,
    branchId: "preview",
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listing", () => {
  it("lists every authored document, addressed by the server's own branch", async () => {
    const { resources } = await client.listResources();

    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "graft://preview/pages/about",
      "graft://preview/pages/home",
      "graft://preview/schema",
    ]);
  });

  it("carries the document's own title and description as the resource's", async () => {
    const { resources } = await client.listResources();
    const home = resources.find((resource) => resource.uri === "graft://preview/pages/home");

    expect(home).toMatchObject({
      name: "pages/home",
      title: "Home",
      description: "The front page",
      mimeType: "text/markdown",
    });
  });

  it("falls back to the source path when a document declares no description", async () => {
    const { resources } = await client.listResources();
    const about = resources.find((resource) => resource.uri === "graft://preview/pages/about");

    expect(about?.description).toContain("pages/about.mdx");
  });

  it("offers no resource for a db-authoritative collection, which has no files", async () => {
    const { resources } = await client.listResources();

    expect(resources.some((resource) => resource.uri.includes("submissions"))).toBe(false);
  });

  it("advertises the template so a client can construct a URI it was not handed", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();

    expect(resourceTemplates.map((template) => template.uriTemplate)).toContain(
      "graft://preview/{collection}/{slug}",
    );
  });
});

describe("reading", () => {
  it("hands back the authored bytes, not a re-serialisation", async () => {
    const result = await client.readResource({ uri: "graft://preview/pages/home" });

    expect(result.contents[0]).toMatchObject({
      uri: "graft://preview/pages/home",
      mimeType: "text/markdown",
    });
    // Byte-exact: the frontmatter block, the blank line after it, and the
    // trailing newline all survive. Same promise composeDocument makes on write.
    expect(textOf(result)).toBe(HOME);
  });

  it("serves the schema as JSON, the same payload describe_schema returns", async () => {
    const result = await client.readResource({ uri: "graft://preview/schema" });
    const schema = JSON.parse(textOf(result));

    expect(result.contents[0].mimeType).toBe("application/json");
    expect(schema.collections.map((collection: { name: string }) => collection.name)).toEqual([
      "pages",
      "submissions",
    ]);
  });

  it("refuses an unknown slug and still carries the fix", async () => {
    // A resource read has no ToolResult to put the fix in — the SDK turns a
    // throw into a JSON-RPC error whose only readable field is `message`. The
    // first version of this lost the fix entirely, which breaks the rule that
    // every error a caller sees names the next action.
    await expect(client.readResource({ uri: "graft://preview/pages/nope" })).rejects.toThrow(
      /Known slugs: about, home/,
    );
  });

  it("refuses a db-authoritative collection and says where its records live", async () => {
    await expect(
      client.readResource({ uri: "graft://preview/submissions/anything" }),
    ).rejects.toThrow(/db-authoritative[\s\S]*list_functions/);
  });
});

describe("completions", () => {
  const complete = async (variable: string, value: string, chosen?: Record<string, string>) => {
    const request = {
      ref: { type: "ref/resource" as const, uri: "graft://preview/{collection}/{slug}" },
      argument: { name: variable, value },
    };
    const result = await (chosen
      ? client.complete({ ...request, context: { arguments: chosen } })
      : client.complete(request));
    return result.completion.values;
  };

  it("completes collection names from the file-authoritative ones", async () => {
    expect(await complete("collection", "")).toEqual(["pages"]);
  });

  it("completes slugs, narrowed to the collection already chosen", async () => {
    expect((await complete("slug", "", { collection: "pages" })).sort()).toEqual(["about", "home"]);
  });

  it("filters by what has been typed so far", async () => {
    expect(await complete("slug", "ho", { collection: "pages" })).toEqual(["home"]);
  });
});
