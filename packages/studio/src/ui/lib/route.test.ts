import { describe, expect, it } from "vitest";
import { parseHash, toHash } from "./route";

describe("routes", () => {
  it("round-trips content and developer routes", () => {
    for (const route of [
      { view: "home" as const },
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
  });

  it("never throws on a malformed link", () => {
    expect(parseHash("#/c/%E0%A4%A")).toEqual({ view: "collection", collection: "%E0%A4%A" });
    expect(parseHash("#/nonsense")).toEqual({ view: "home" });
  });
});
