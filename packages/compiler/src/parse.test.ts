import { GraftError } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
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

  it("rejects slugs that are not URL-safe kebab-case", () => {
    for (const bad of ["Hello World", "a/b", "UPPER", "trailing-", "-leading", "dot.mdx"]) {
      try {
        parseDocument(`---\ntitle: X\nslug: "${bad}"\n---\nBody`, page, "pages/x.mdx");
        expect.unreachable(`slug "${bad}" should have thrown`);
      } catch (err) {
        expect(err).toBeInstanceOf(GraftError);
        expect((err as GraftError).code).toBe("INVALID_SLUG");
        expect((err as GraftError).fix).toContain("kebab-case");
      }
    }
  });

  it("validates filename-derived slugs too", () => {
    try {
      parseDocument("---\ntitle: X\n---\nBody", page, "pages/Bad Name.mdx");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as GraftError).code).toBe("INVALID_SLUG");
    }
  });

  it("is deterministic — same input yields the same content hash", () => {
    const raw = "---\ntitle: X\n---\nBody";
    expect(parseDocument(raw, page, "pages/x.mdx").contentHash).toBe(
      parseDocument(raw, page, "pages/x.mdx").contentHash,
    );
  });
});
