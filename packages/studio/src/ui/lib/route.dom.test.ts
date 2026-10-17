// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { listHref, replaceListState } from "./route";

describe("listHref", () => {
  it("is the bare collection until its list has been seen", () => {
    expect(listHref("articles")).toBe("#/c/articles");
  });

  it("returns to the list as it was left, search, filters and sort included", () => {
    window.location.hash = "#/c/products";
    replaceListState({
      q: "hat",
      status: "unpublished",
      where: { category: "winter" },
      sort: { key: "price", dir: "desc" },
    });
    expect(listHref("products")).toBe(
      "#/c/products?q=hat&status=unpublished&where.category=winter&sort=price&dir=desc",
    );
    // Opening an entry doesn't change where the way back goes.
    window.location.hash = "#/c/products/hat";
    expect(listHref("products")).toBe(
      "#/c/products?q=hat&status=unpublished&where.category=winter&sort=price&dir=desc",
    );
  });

  it("remembers a list opened from a link that already carries its state", () => {
    window.location.hash = "#/c/pages?q=about";
    replaceListState({ q: "about", status: "all", where: {}, sort: { key: "site", dir: "asc" } });
    expect(listHref("pages")).toBe("#/c/pages?q=about");
  });
});
