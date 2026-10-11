import { describe, expect, it } from "vitest";
import type { EntrySummary } from "../editor-types";
import { queryEntries } from "./catalog";

const entry = (slug: string, updatedAt?: string, price?: number): EntrySummary => ({
  path: `products/${slug}.mdx`,
  collection: "products",
  slug,
  title: slug,
  status: "published",
  conflict: false,
  fields: price === undefined ? {} : { price },
  ...(updatedAt ? { updatedAt } : {}),
});

describe("queryEntries sorting", () => {
  const all = [
    entry("undated"),
    entry("older", "2026-10-01T00:00:00.000Z", 10),
    entry("newer", "2026-10-09T00:00:00.000Z", 20),
  ];
  const slugs = (sort: string, dir: "asc" | "desc") =>
    queryEntries("products", all, [], { sort, dir }).items.map((item) => item.slug);

  it("puts entries without a value last in both directions", () => {
    expect(slugs("updated", "asc")).toEqual(["newer", "older", "undated"]);
    expect(slugs("updated", "desc")).toEqual(["older", "newer", "undated"]);
    expect(slugs("price", "asc")).toEqual(["older", "newer", "undated"]);
    expect(slugs("price", "desc")).toEqual(["newer", "older", "undated"]);
  });
});
