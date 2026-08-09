import { GraftError } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
import { describe, expect, it } from "vitest";
import { parseDocument } from "./parse";

const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
    image: field.asset({ optional: true }),
    banner: field.asset({ optional: true }),
  },
});

describe("asset indexing", () => {
  it("collects populated asset fields with their source field name", () => {
    const doc = parseDocument(
      [
        "---",
        "title: Home",
        "image:",
        "  key: pages/home/hero.svg",
        "  alt: Hero",
        "banner:",
        "  key: pages/home/banner.png",
        "---",
        "Body",
      ].join("\n"),
      pages,
      "pages/home.mdx",
    );
    expect(doc.assets).toEqual([
      { field: "image", key: "pages/home/hero.svg", alt: "Hero" },
      { field: "banner", key: "pages/home/banner.png" },
    ]);
  });

  it("indexes nothing when asset fields are absent", () => {
    const doc = parseDocument("---\ntitle: Home\n---\nBody", pages, "pages/home.mdx");
    expect(doc.assets).toEqual([]);
  });

  it("rejects an invalid asset key via the schema (with the fix)", () => {
    try {
      parseDocument(
        "---\ntitle: Home\nimage:\n  key: ../escape.png\n---\n",
        pages,
        "pages/home.mdx",
      );
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GraftError);
      expect((error as GraftError).code).toBe("SCHEMA_VALIDATION_FAILED");
      expect((error as GraftError).fix).toContain("asset key");
    }
  });
});
