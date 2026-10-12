import { defineCollection, field } from "@usegraft/core";
import { describe, expect, it } from "vitest";
import { validateDocuments } from "./compile";
import { findBrokenReferences } from "./references";

const collections = {
  categories: defineCollection({ name: "categories", fields: { title: field.string() } }),
  products: defineCollection({
    name: "products",
    fields: {
      title: field.string(),
      category: field.reference({ to: "categories", optional: true }),
      related: field.array({ of: field.reference({ to: "products" }), optional: true }),
    },
  }),
};

const docs = (files: Record<string, string>) =>
  validateDocuments(
    Object.entries(files).map(([sourcePath, raw]) => ({ sourcePath, raw })),
    collections,
  );

describe("findBrokenReferences", () => {
  it("finds a reference to a document that doesn't exist, in a field and in an array", () => {
    const found = findBrokenReferences(
      docs({
        "categories/hats.mdx": "---\ntitle: Hats\n---\n",
        "products/beanie.mdx":
          "---\ntitle: Beanie\ncategory: scarves\nrelated: [beanie, cap]\n---\n",
      }),
      collections,
    );
    expect(found).toEqual([
      { sourcePath: "products/beanie.mdx", field: "category", to: "categories", slug: "scarves" },
      { sourcePath: "products/beanie.mdx", field: "related.1", to: "products", slug: "cap" },
    ]);
  });

  it("finds nothing when every reference resolves", () => {
    expect(
      findBrokenReferences(
        docs({
          "categories/hats.mdx": "---\ntitle: Hats\n---\n",
          "products/beanie.mdx": "---\ntitle: Beanie\ncategory: hats\n---\n",
        }),
        collections,
      ),
    ).toEqual([]);
  });
});
