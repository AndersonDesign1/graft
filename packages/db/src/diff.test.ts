import { describe, expect, it } from "vitest";
import {
  diffBranchContent,
  foreignRemovals,
  type ContentInput,
  type ExistingContentState,
} from "./diff";

const doc = (slug: string, hash: string, overrides: Partial<ContentInput> = {}): ContentInput => ({
  collection: "pages",
  slug,
  data: { title: slug },
  body: "Body",
  contentHash: hash,
  sourcePath: `pages/${slug}.mdx`,
  ...overrides,
});

const row = (
  slug: string,
  hash: string,
  overrides: Partial<ExistingContentState> = {},
): ExistingContentState => ({
  collection: "pages",
  slug,
  contentHash: hash,
  sourcePath: `pages/${slug}.mdx`,
  deleted: false,
  ...overrides,
});

describe("diffBranchContent", () => {
  it("classifies added, changed, removed, and unchanged", () => {
    const existing = [row("home", "h1"), row("about", "h2"), row("old", "h3")];
    const incoming = [doc("home", "h1"), doc("about", "h2-new"), doc("fresh", "h4")];

    const { changes, upserts, removals } = diffBranchContent(existing, incoming);

    expect(changes.added).toEqual(["pages/fresh"]);
    expect(changes.changed).toEqual(["pages/about"]);
    expect(changes.removed).toEqual(["pages/old"]);
    expect(changes.unchanged).toBe(1);
    expect(upserts.map((u) => u.slug).sort()).toEqual(["about", "fresh"]);
    expect(removals).toEqual([{ collection: "pages", slug: "old" }]);
  });

  it("treats a moved file (same hash, new sourcePath) as changed", () => {
    const existing = [row("home", "h1")];
    const incoming = [doc("home", "h1", { sourcePath: "pages/moved/home.mdx" })];
    expect(diffBranchContent(existing, incoming).changes.changed).toEqual(["pages/home"]);
  });

  it("resurrects a soft-deleted row as added", () => {
    const existing = [row("home", "h1", { deleted: true })];
    const incoming = [doc("home", "h1")];
    const { changes } = diffBranchContent(existing, incoming);
    expect(changes.added).toEqual(["pages/home"]);
    expect(changes.removed).toEqual([]);
  });

  it("does not re-remove an already-deleted row", () => {
    const existing = [row("gone", "h1", { deleted: true })];
    const { changes, removals } = diffBranchContent(existing, []);
    expect(changes.removed).toEqual([]);
    expect(removals).toEqual([]);
  });

  it("is idempotent — a no-op run yields an empty change-set", () => {
    const existing = [row("home", "h1"), row("about", "h2")];
    const incoming = [doc("home", "h1"), doc("about", "h2")];
    const { changes, upserts, removals } = diffBranchContent(existing, incoming);
    expect(changes).toEqual({ added: [], changed: [], removed: [], unchanged: 2 });
    expect(upserts).toEqual([]);
    expect(removals).toEqual([]);
  });

  it("keys by collection so the same slug can live in two collections", () => {
    const existing = [row("intro", "h1", { collection: "pages" })];
    const incoming = [
      doc("intro", "h1"),
      doc("intro", "h9", { collection: "posts", sourcePath: "posts/intro.mdx" }),
    ];
    const { changes } = diffBranchContent(existing, incoming);
    expect(changes.added).toEqual(["posts/intro"]);
    expect(changes.unchanged).toBe(1);
  });
});

describe("foreignRemovals", () => {
  it("flags removals in collections the schema doesn't know — the shared-DB signature", () => {
    // The real incident: docs-site (pages, docs) compiled against the
    // landing-page's index (pages, products) and purged products/*.
    const existing = [
      row("home", "h1"),
      row("pricing", "h2"),
      row("solo", "h3", { collection: "products", sourcePath: "products/solo.mdx" }),
      row("team", "h4", { collection: "products", sourcePath: "products/team.mdx" }),
    ];
    const incoming = [doc("home", "h1-new")];
    const { removals } = diffBranchContent(existing, incoming);

    expect(foreignRemovals(removals, ["pages", "docs"])).toEqual(["products"]);
    // Same-collection removals stay legitimate (deleting a file is normal).
    expect(foreignRemovals(removals, ["pages", "products"])).toEqual([]);
  });

  it("is empty when nothing is removed or everything is known", () => {
    expect(foreignRemovals([], ["pages"])).toEqual([]);
    expect(foreignRemovals([{ collection: "pages" }], ["pages"])).toEqual([]);
  });

  it("reports each foreign collection once", () => {
    const removals = [
      { collection: "products" },
      { collection: "products" },
      { collection: "orders" },
    ];
    expect(foreignRemovals(removals, ["pages"])).toEqual(["products", "orders"]);
  });
});
