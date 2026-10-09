/**
 * MCP on a hosted mount that writes through GitHub: write_content and
 * delete_content become draft commits on the agent's own branch, and the
 * draft tools publish them. The same draft model a hosted Studio uses, so an
 * agent and an editor never take different paths to the live site.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubStore, tokenAuth } from "@usegraft/compiler";
import { createGitHubFake, type GitHubFake } from "@usegraft/compiler/testing";
import { defineCollection, field } from "@usegraft/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createGraftMcp } from "./server";

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

async function connect(scopes: string[]): Promise<{
  fake: GitHubFake;
  dir: string;
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ isError: boolean; payload: Record<string, any> }>;
  tools: () => Promise<string[]>;
}> {
  const dir = mkdtempSync(join(tmpdir(), "graft-mcp-drafts-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\n---\nWelcome\n");
  const fake = createGitHubFake({
    repo: "acme/site",
    files: { "content/pages/home.mdx": "---\ntitle: Home\n---\nWelcome\n" },
  });
  const server = createGraftMcp({
    contentDir: dir,
    collections,
    db: {} as never,
    audit: false,
    actor: () => ({ kind: "agent", id: "writer-bot" }),
    connectionActor: { kind: "agent", id: "writer-bot", scopes },
    store: new GitHubStore({
      repo: "acme/site",
      auth: tokenAuth(fake.token),
      apiUrl: fake.apiUrl,
      fetch: fake.fetch,
    }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-agent", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    fake,
    dir,
    async call(name, args = {}) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
      };
      return {
        isError: result.isError === true,
        payload: JSON.parse(result.content[0]?.text ?? "null"),
      };
    },
    async tools() {
      return (await client.listTools()).tools.map((tool) => tool.name);
    },
  };
}

describe("MCP writes through a GitHub store", () => {
  it("drafts on the agent's branch and leaves files and production alone", async () => {
    const { fake, dir, call, tools } = await connect(["content:write"]);
    expect(await tools()).toEqual(
      expect.arrayContaining(["list_drafts", "publish_drafts", "discard_drafts"]),
    );

    const written = await call("write_content", {
      collection: "pages",
      slug: "about",
      data: { title: "About" },
      body: "Who we are.",
    });
    expect(written.isError).toBe(false);
    expect(written.payload.changes.added).toEqual(["pages/about"]);
    expect(fake.files("graft-studio/drafts/writer-bot")["content/pages/about.mdx"]).toContain(
      "title: About",
    );
    expect(fake.files()["content/pages/about.mdx"]).toBeUndefined();
    expect(readFileSync(join(dir, "pages", "home.mdx"), "utf8")).toContain("Welcome");

    const listed = await call("list_drafts");
    expect(listed.payload.changes).toEqual([
      expect.objectContaining({ path: "pages/about.mdx", kind: "added" }),
    ]);
  });

  it("reads a document deleted in its draft as gone", async () => {
    const { fake, call } = await connect(["content:write"]);
    const sameDraft = new GitHubStore({
      repo: "acme/site",
      auth: tokenAuth(fake.token),
      apiUrl: fake.apiUrl,
      fetch: fake.fetch,
    });
    await sameDraft.write("pages/home.mdx", null, { actor: { id: "writer-bot" } });
    const one = await call("get_content", { collection: "pages", slug: "home" });
    expect(one.isError).toBe(true);
    expect(one.payload.error).toBe("DOCUMENT_NOT_FOUND");
    const all = await call("list_content", { collection: "pages" });
    expect(all.payload.documents).toEqual([]);
  });

  it("reads back its own draft with get_content and list_content", async () => {
    const { call } = await connect(["content:write"]);
    await call("write_content", {
      collection: "pages",
      slug: "about",
      data: { title: "About" },
      body: "Who we are.",
    });
    await call("write_content", {
      collection: "pages",
      slug: "home",
      data: { title: "Home, drafted" },
      body: "Welcome back.",
    });

    const one = await call("get_content", { collection: "pages", slug: "about" });
    expect(one.isError).toBe(false);
    expect(one.payload.body).toContain("Who we are.");
    const home = await call("get_content", { collection: "pages", slug: "home" });
    expect(home.payload.data.title).toBe("Home, drafted");

    const all = await call("list_content", { collection: "pages" });
    expect(all.payload.documents.map((doc: { slug: string }) => doc.slug)).toEqual([
      "about",
      "home",
    ]);
  });

  it("opens a pull request unless the credential may publish", async () => {
    const { fake, call } = await connect(["content:write"]);
    await call("write_content", { collection: "pages", slug: "about", data: { title: "About" } });
    const published = await call("publish_drafts", { paths: ["pages/about.mdx"] });
    expect(published.payload.mode).toBe("review");
    expect(fake.pulls()).toHaveLength(1);
    expect(fake.files()["content/pages/about.mdx"]).toBeUndefined();
  });

  it("commits to production with content:publish", async () => {
    const { fake, call } = await connect(["content:write", "content:publish"]);
    await call("write_content", { collection: "pages", slug: "about", data: { title: "About" } });
    const published = await call("publish_drafts", {
      paths: ["pages/about.mdx"],
      message: "Add about page",
    });
    expect(published.payload.mode).toBe("direct");
    expect(fake.files()["content/pages/about.mdx"]).toContain("title: About");
    expect(fake.log()[0]?.message).toBe("Add about page");
  });

  it("discards a draft", async () => {
    const { fake, call } = await connect(["content:write"]);
    await call("write_content", { collection: "pages", slug: "about", data: { title: "About" } });
    await call("discard_drafts", { paths: ["pages/about.mdx"] });
    expect((await call("list_drafts")).payload.changes).toEqual([]);
    expect(fake.branches()).toEqual(["main"]);
  });

  it("refuses draft tools without content:write", async () => {
    const { call } = await connect(["content:read"]);
    const refused = await call("publish_drafts", { paths: ["pages/home.mdx"] });
    expect(refused.isError).toBe(true);
    expect(refused.payload.error).toBe("UNAUTHORIZED");
  });
});
