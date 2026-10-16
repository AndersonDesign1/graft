import { describe, expect, it } from "vitest";
import {
  actionWord,
  collectionLabel,
  deletionNote,
  doneWord,
  publishVerb,
  singular,
} from "./studio";
import { slugify } from "../../slug";

describe("deletionNote", () => {
  it("says the file is gone locally, and live elsewhere until published", () => {
    expect(deletionNote("commit")).toBe(
      "Its file is removed from this computer now. The deployed site keeps it until you commit the deletion and push.",
    );
    expect(deletionNote("commit", true)).toContain("Their files are removed");
    expect(deletionNote("publish")).toBe("It stays live until you publish the deletion.");
    expect(deletionNote("review", true)).toBe("They stay live until you submit the deletion.");
  });
});

describe("collection words", () => {
  it("names a collection and one of its entries", () => {
    expect(collectionLabel("products")).toBe("Products");
    expect(collectionLabel("blog-posts")).toBe("Blog posts");
    expect(singular("categories")).toBe("category");
    expect(singular("products")).toBe("product");
    expect(singular("addresses")).toBe("address");
    expect(singular("boxes")).toBe("box");
    expect(singular("status")).toBe("status");
    expect(singular("docs")).toBe("doc");
    // Same in the singular: these used to lose their s ("New new").
    expect(singular("news")).toBe("news");
    expect(singular("tv-series")).toBe("tv series");
    expect(singular("species")).toBe("species");
  });

  it("slugs a title, dropping every combining mark", () => {
    expect(slugify("Blue Linen Shirt!")).toBe("blue-linen-shirt");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
    // U+1AB0 is a combining mark outside the U+0300 block: it used to split
    // the word with a hyphen.
    expect(slugify("Cafe᪰ Noir")).toBe("cafe-noir");
  });

  it("says what Publish will do", () => {
    expect(publishVerb("publish")).toBe("Publish");
    expect(publishVerb("review")).toBe("Submit for review");
    expect(publishVerb("commit")).toBe("Commit");
  });

  it("names finished work by what this workspace does with it", () => {
    // A laptop commits and never publishes, so no sentence may say "publish" there.
    expect(actionWord("commit")).toBe("commit");
    expect(doneWord("commit")).toBe("committed");
    expect(actionWord("publish")).toBe("publish");
    expect(doneWord("publish")).toBe("published");
    expect(actionWord("review")).toBe("submit");
    expect(doneWord("review")).toBe("published");
  });
});
