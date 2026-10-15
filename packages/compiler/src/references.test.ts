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

describe("validateDocuments with references", () => {
  const files = (entries: Record<string, string>) =>
    Object.entries(entries).map(([sourcePath, raw]) => ({ sourcePath, raw }));
  const tree = files({
    "categories/hats.mdx": "---\ntitle: Hats\n---\n",
    "products/beanie.mdx": "---\ntitle: Beanie\ncategory: scarves\n---\n",
  });

  it("refuses a reference to a document that isn't in the tree, with a fix", () => {
    let error: unknown;
    try {
      validateDocuments(tree, collections, { references: "files" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "CONTENT_REFERENCE_NOT_FOUND",
      message:
        '1 reference(s) name a document that doesn\'t exist: products/beanie.mdx "category" points at categories/scarves.',
      details: {
        total: 1,
        references: [
          {
            sourcePath: "products/beanie.mdx",
            field: "category",
            to: "categories",
            slug: "scarves",
          },
        ],
      },
    });
    expect((error as { fix: string }).fix).toMatch(/^Create categories\/scarves, or change/);
  });

  it("resolves against documents outside the files when told which exist", () => {
    const docs = validateDocuments(tree, collections, {
      references: new Set(["categories/scarves"]),
    });
    expect(docs.map((doc) => doc.slug)).toEqual(["hats", "beanie"]);
  });

  it("leaves references alone when not asked, since some files can't tell", () => {
    expect(validateDocuments(tree, collections)).toHaveLength(2);
  });
});
