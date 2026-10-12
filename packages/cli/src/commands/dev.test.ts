import { describe, expect, it } from "vitest";
import { announce } from "./dev";

describe("announce", () => {
  it("says nothing when nothing was published", () => {
    expect(announce([])).toEqual([]);
  });

  it("names who published what, once each, and the command to run", () => {
    expect(
      announce([
        { path: "posts/spring-sale.mdx", version: "a", publishedBy: "Ana" },
        { path: "posts/spring-sale.mdx", version: "b", publishedBy: "Ana" },
        { path: "pages/old.mdx", version: null, publishedBy: "Ben" },
      ]),
    ).toEqual([
      "Ana published posts/spring-sale.",
      "Ben published pages/old (deleted).",
      "Run graft pull to bring it into your files.",
    ]);
  });
});
