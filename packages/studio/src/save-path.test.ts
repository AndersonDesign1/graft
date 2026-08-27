/**
 * The save path, end to end through the HTTP API, against real files on disk.
 *
 * `api.test.ts` covers routing and refusals with a stub database; `content.test.ts`
 * covers frontmatter fidelity by calling writeDocument directly. Neither answers
 * the question that actually went wrong: **which file received which bytes**.
 *
 * The cross-document overwrite (fixed in d6cbc3d) was invisible to both. The
 * editor sent a well-formed PUT that the server obeyed perfectly — it just named
 * the wrong document. Nothing on either side compared the target against the
 * rest of the tree, so every unit test passed while a save destroyed a file.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@usegraft/compiler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/compiler")>();
  return {
    ...actual,
    // Projection is a separate concern with its own integration tests. What is
    // under test here is the bytes that land on disk.
    compile: vi.fn(async () => ({ count: 0, docs: [], changes: {}, gitSha: null })),
  };
});

const { createStudioApiHandler } = await import("./api");

const collections = {
  docs: defineCollection({
    name: "docs",
    fields: { title: field.string(), description: field.string({ optional: true }) },
  }),
  submissions: defineCollection({
    name: "submissions",
    authority: "db-authoritative",
    fields: { email: field.string() },
  }),
};

const ALPHA = "---\ntitle: Alpha\n---\n\nAlpha body.\n";
const BETA = "---\ntitle: Beta\n---\n\nBeta body.\n";

let dir: string;
let contentDir: string;
let handler: ReturnType<typeof createStudioApiHandler>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-studio-e2e-"));
  contentDir = join(dir, "content");
  mkdirSync(join(contentDir, "docs"), { recursive: true });
  writeFileSync(join(contentDir, "docs", "alpha.mdx"), ALPHA, "utf8");
  writeFileSync(join(contentDir, "docs", "beta.mdx"), BETA, "utf8");
  // No `authenticate`: a loopback mount, which is the default local topology.
  handler = createStudioApiHandler({ db: {} as never, collections, contentDir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const put = (payload: Record<string, unknown>) =>
  handler(
    new Request("http://localhost/api/studio/v1/document", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

const read = (slug: string) => readFileSync(join(contentDir, "docs", `${slug}.mdx`), "utf8");
const docFiles = () => readdirSync(join(contentDir, "docs")).sort();

describe("PUT /document, on disk", () => {
  it("writes the named document and leaves every sibling byte-identical", async () => {
    const before = read("beta");

    const res = await put({
      collection: "docs",
      slug: "alpha",
      data: { title: "Alpha" },
      body: "Alpha body, edited.",
    });

    expect(res.status).toBe(200);
    expect(read("alpha")).toContain("Alpha body, edited.");
    // The assertion the cross-document overwrite would have failed.
    expect(read("beta")).toBe(before);
    expect(docFiles()).toEqual(["alpha.mdx", "beta.mdx"]);
  });

  it("refuses a slug that would escape the collection, and writes nothing", async () => {
    const before = docFiles();

    const res = await put({
      collection: "docs",
      slug: "../../../../escaped",
      data: { title: "Escaped" },
      body: "nope",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(docFiles()).toEqual(before);
    // Nothing created anywhere above the content root either.
    expect(readdirSync(dir).sort()).toEqual(["content"]);
  });

  it("refuses executable MDX, and writes nothing", async () => {
    const before = read("alpha");

    const res = await put({
      collection: "docs",
      slug: "alpha",
      data: { title: "Alpha" },
      body: "{await import('node:child_process')}",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(read("alpha")).toBe(before);
  });

  it("refuses a document whose frontmatter fails its collection schema", async () => {
    const before = read("alpha");

    const res = await put({
      collection: "docs",
      slug: "alpha",
      data: { title: 42 },
      body: "Alpha body.",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(read("alpha")).toBe(before);
  });

  it("refuses to write files for a db-authoritative collection", async () => {
    const res = await put({
      collection: "submissions",
      slug: "anything",
      data: { email: "a@b.co" },
      body: "",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.json()).toMatchObject({ error: "AUTHORITY_MISMATCH" });
  });
});

describe("GET /document", () => {
  it("returns what is actually on disk, byte for byte", async () => {
    const res = await handler(
      new Request("http://localhost/api/studio/v1/document?collection=docs&slug=beta"),
    );

    expect(res.status).toBe(200);
    const doc = (await res.json()) as { slug: string; raw: string; body: string };
    expect(doc.slug).toBe("beta");
    expect(doc.raw).toBe(BETA);
    expect(doc.body).toBe("Beta body.\n");
  });

  it("reports a missing document rather than inventing one", async () => {
    const res = await handler(
      new Request("http://localhost/api/studio/v1/document?collection=docs&slug=ghost"),
    );
    expect(res.status).toBe(404);
  });
});
