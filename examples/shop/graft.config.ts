/**
 * A storefront's catalog, authored as files and edited in Studio.
 *
 * The schema is what Studio builds its forms from: labels, money, choices,
 * references, galleries and variants are declared here once, and the editor,
 * validation and `describe_schema` all read the same declaration.
 */
import { defineCollection, field, mergePrimitives } from "@usegraft/core";
import * as primitives from "./graft";

export const categories = defineCollection({
  name: "categories",
  description: "Departments the catalog is browsed by.",
  fields: {
    title: field.string({ label: "Name", maxLength: 60 }),
    description: field.text({ optional: true, maxLength: 400 }),
    order: field.number({ optional: true, int: true, label: "Position in menus" }),
  },
});

export const products = defineCollection({
  name: "products",
  description: "Everything for sale. One file per product under content/products/.",
  fields: {
    title: field.string({ label: "Name", maxLength: 80 }),
    status: field.select({
      label: "Status",
      options: [
        { value: "draft", label: "Draft" },
        { value: "active", label: "On sale" },
        { value: "archived", label: "Archived" },
      ],
      description: "Only products on sale appear in the shop.",
    }),
    price: field.number({
      format: "money",
      currency: "USD",
      min: 0,
      max: 10_000_000,
      label: "Price",
    }),
    compareAtPrice: field.number({
      format: "money",
      currency: "USD",
      min: 0,
      optional: true,
      label: "Compare-at price",
      description: "The old price, shown struck through during a sale.",
    }),
    category: field.reference({ to: "categories", label: "Category" }),
    summary: field.text({
      label: "Summary",
      maxLength: 240,
      description: "One or two sentences for listings and search results.",
    }),
    images: field.array({
      of: field.asset(),
      maxItems: 12,
      optional: true,
      label: "Images",
      description: "The first image is the one shown in listings.",
    }),
    tags: field.array({ of: field.string({ maxLength: 30 }), maxItems: 20, optional: true }),
    variants: field.array({
      label: "Variants",
      optional: true,
      maxItems: 50,
      of: field.object({
        fields: {
          sku: field.string({ label: "SKU", maxLength: 40, pattern: /^[A-Z0-9-]+$/ }),
          size: field.select({ options: ["XS", "S", "M", "L", "XL"], optional: true }),
          color: field.string({ optional: true, maxLength: 30 }),
          stock: field.number({ int: true, min: 0, label: "In stock" }),
        },
      }),
    }),
    featured: field.boolean({ optional: true, label: "Feature on the home page" }),
    related: field.array({
      of: field.reference({ to: "products" }),
      maxItems: 8,
      optional: true,
      label: "Related products",
    }),
    seo: field.object({
      optional: true,
      label: "Search engines",
      fields: {
        title: field.string({ optional: true, maxLength: 60, label: "Page title" }),
        description: field.string({ optional: true, maxLength: 160, label: "Meta description" }),
      },
    }),
  },
});

export const pages = defineCollection({
  name: "pages",
  description: "Shop pages: about, shipping, returns.",
  fields: {
    title: field.string({ maxLength: 80 }),
    description: field.string({ optional: true, maxLength: 160, label: "Meta description" }),
  },
});

export const { collections, functions } = mergePrimitives([
  { collections: { categories, products, pages }, functions: {} },
  primitives,
]);

// Studio needs the Postgres engine for its developer views (history,
// approvals). Content stays files in git either way.
export const index = "postgres";
