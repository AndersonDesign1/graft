/**
 * The tool client the CLI runs its content commands through: a real server
 * over a real content directory, called by name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectInProcess, remoteError, toolResultToGraftError, type ToolClient } from "./client";
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
