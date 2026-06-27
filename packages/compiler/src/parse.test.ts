import { GraftError } from "@graft/contracts";
import { defineCollection, field } from "@graft/core";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse";

const page = defineCollection({
  name: "page",
  fields: { title: field.string(), order: field.number({ optional: true }) },
});

describe("parseDocument", () => {
  it("parses valid frontmatter + body into a projected doc", () => {
    const raw = "---\ntitle: Home\nslug: home\norder: 1\n---\n# Welcome\n";
    const doc = parseDocument(raw, page, "pages/home.mdx");
    expect(doc).toMatchObject({
      collection: "page",
      slug: "home",
      body: "# Welcome",
      data: { title: "Home", order: 1 },
      sourcePath: "pages/home.mdx",
    });
    expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("derives the slug from the filename when frontmatter omits it", () => {
    const doc = parseDocument("---\ntitle: About\n---\nBody", page, "pages/about.mdx");
    expect(doc.slug).toBe("about");
  });

  it("throws an agent-actionable GraftError on invalid frontmatter", () => {
    try {
      parseDocument("---\norder: 1\n---\nNo title here", page, "pages/bad.mdx");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GraftError);
      expect((err as GraftError).code).toBe("SCHEMA_VALIDATION_FAILED");
      expect((err as GraftError).fix).toContain("title");
    }
  });

  it("is deterministic — same input yields the same content hash", () => {
    const raw = "---\ntitle: X\n---\nBody";
    expect(parseDocument(raw, page, "pages/x.mdx").contentHash).toBe(
      parseDocument(raw, page, "pages/x.mdx").contentHash,
    );
  });
});
