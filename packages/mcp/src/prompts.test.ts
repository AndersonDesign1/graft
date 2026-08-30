/**
 * Prompts, driven by a real client.
 *
 * What makes a server-side prompt worth shipping is that it knows something the
 * person typing does not, so these assert the *filled-in* parts: the
 * collection's actual fields, the document's actual address, the error's actual
 * recovery text. A prompt that returned generic advice would pass a test that
 * only checked it returned a message.
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
      title: field.string({ description: "Headline" }),
      order: field.number({ optional: true }),
    },
  }),
  submissions: defineCollection({
    name: "submissions",
    authority: "db-authoritative",
    fields: { email: field.string() },
  }),
};

// SAFETY: a tripwire, never a Database. Prompts read files and the schema, so
// any property access through this is a bug and throws rather than stubbing.
const untouchableDb = new Proxy({} as Database, {
  get() {
    throw new Error("a prompt touched the database");
  },
});

let dir: string;
let client: Client;

/** The concatenated text of a prompt's messages. */
async function render(name: string, args: Record<string, string>): Promise<string> {
  const result = await client.getPrompt({ name, arguments: args });
  return result.messages
    .map((message) => (message.content.type === "text" ? message.content.text : ""))
    .join("\n");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "graft-mcp-prompts-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\n---\nBody");
  writeFileSync(join(dir, "pages", "pricing.mdx"), "---\ntitle: Pricing\n---\nBody");

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

describe("the catalogue", () => {
  it("offers the project's workflows, each with a title", async () => {
    const { prompts } = await client.listPrompts();

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      "author-document",
      "fix-error",
      "plan-migration",
      "revise-document",
    ]);
    for (const prompt of prompts) {
      expect(prompt.title ?? prompt.description, prompt.name).toBeTruthy();
    }
  });
});

describe("author-document", () => {
  it("spells out the collection's real fields, so no lookup is needed first", async () => {
    const text = await render("author-document", { collection: "pages", topic: "our pricing" });

    expect(text).toContain("- title: string (required) — Headline");
    expect(text).toContain("- order: number (optional)");
    expect(text).toContain("our pricing");
  });

  it("teaches the constraints an agent cannot infer from the schema", async () => {
    const text = await render("author-document", { collection: "pages", topic: "x" });

    // The MDX gate and who owns the commit are both project rules, not MCP ones.
    expect(text).toMatch(/\{expressions\}/);
    expect(text).toMatch(/commit/i);
  });
});

describe("revise-document", () => {
  it("attaches the document's own resource URI", async () => {
    const text = await render("revise-document", {
      collection: "pages",
      slug: "home",
      goal: "shorten it",
    });

    expect(text).toContain("graft://preview/pages/home");
    expect(text).toContain("shorten it");
  });

  it("asks for the whole document, because write_content replaces it", async () => {
    const text = await render("revise-document", {
      collection: "pages",
      slug: "home",
      goal: "x",
    });

    expect(text).toMatch(/not a patch/);
    expect(text).toMatch(/byte-identical/);
  });
});

describe("fix-error", () => {
  it("resolves the recovery text from this build's own knowledge base", async () => {
    const text = await render("fix-error", { code: "SCHEMA_VALIDATION_FAILED" });

    expect(text).toContain("SCHEMA_VALIDATION_FAILED");
    expect(text).toMatch(/What it means:/);
    expect(text).toMatch(/How to recover:/);
  });

  it("says a code it does not know is not a Graft code, and where to look", async () => {
    const text = await render("fix-error", { code: "ENOENT" });

    expect(text).toMatch(/not a Graft error code/);
    expect(text).toContain("explain_error");
  });
});

describe("plan-migration", () => {
  it("describes migrations as commits and leaves --apply to the operator", async () => {
    const text = await render("plan-migration", {
      collection: "pages",
      change: "add a required description",
    });

    expect(text).toContain("add a required description");
    expect(text).toMatch(/defineContentMigration/);
    // The consent step is the operator's; a prompt that told an agent to run it
    // would be teaching it to skip the one gate that command exists to be.
    expect(text).toMatch(/graft migrate --apply[\s\S]*operator/);
  });
});

describe("argument completion", () => {
  const complete = async (
    name: string,
    argument: string,
    value: string,
    chosen?: Record<string, string>,
  ) => {
    const request = {
      ref: { type: "ref/prompt" as const, name },
      argument: { name: argument, value },
    };
    const result = await (chosen
      ? client.complete({ ...request, context: { arguments: chosen } })
      : client.complete(request));
    return result.completion.values;
  };

  it("offers only file-authoritative collections — the others have no documents", async () => {
    expect(await complete("author-document", "collection", "")).toEqual(["pages"]);
  });

  it("narrows slugs to the collection already chosen", async () => {
    expect((await complete("revise-document", "slug", "", { collection: "pages" })).sort()).toEqual(
      ["home", "pricing"],
    );
  });

  it("filters by what has been typed", async () => {
    expect(await complete("revise-document", "slug", "pri", { collection: "pages" })).toEqual([
      "pricing",
    ]);
  });

  it("completes error codes case-insensitively, since nobody types them shouting", async () => {
    expect(await complete("fix-error", "code", "approval_")).toContain("APPROVAL_INVALID");
  });
});
