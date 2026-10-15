import { describe, expect, it } from "vitest";
import { listStateFromHash, listStateToHash, parseHash, toHash } from "./route";

describe("routes", () => {
  it("round-trips content and developer routes", () => {
    for (const route of [
      { view: "home" as const },
      { view: "inbox" as const },
      { view: "media" as const },
      { view: "agents" as const },
      { view: "collection" as const, collection: "products" },
      { view: "entry" as const, collection: "products", slug: "linen-shirt" },
      { view: "history" as const },
    ]) {
      expect(parseHash(toHash(route))).toEqual(route);
    }
  });

  it("keeps old bookmark links working", () => {
    expect(parseHash("#/collections/docs/getting-started")).toEqual({
      view: "entry",
      collection: "docs",
      slug: "getting-started",
    });
    expect(parseHash("#/history")).toEqual({ view: "history" });
    expect(parseHash("#/dev/approvals")).toEqual({ view: "inbox" });
  });

  it("never throws on a malformed link", () => {
    expect(parseHash("#/c/%E0%A4%A")).toEqual({ view: "collection", collection: "%E0%A4%A" });
    expect(parseHash("#/nonsense")).toEqual({ view: "home" });
  });
});

describe("list state in the hash", () => {
  it("reads the route without the list's search", () => {
    expect(parseHash("#/c/projects?q=react&status=unpublished")).toEqual({
      view: "collection",
      collection: "projects",
    });
  });

  it("round-trips search, status, field filters and sort, leaving defaults out", () => {
    const state = {
      q: "react native",
      status: "unpublished" as const,
      where: { category: "Mobile & web" },
      sort: { key: "updated", dir: "desc" as const },
    };
    const hash = listStateToHash("#/c/projects", state);
    expect(hash).toBe(
      "#/c/projects?q=react+native&status=unpublished&where.category=Mobile+%26+web&sort=updated&dir=desc",
    );
    expect(listStateFromHash(hash)).toEqual(state);
    expect(listStateToHash("#/c/projects", listStateFromHash("#/c/projects"))).toBe("#/c/projects");
  });

  it("falls back to the defaults on a value it doesn't know", () => {
    expect(listStateFromHash("#/c/projects?status=everything&dir=up")).toEqual({
      q: "",
      status: "all",
      where: {},
      sort: { key: "site", dir: "asc" },
    });
  });
});
