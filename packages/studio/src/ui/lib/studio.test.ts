import { describe, expect, it } from "vitest";
import { collectionLabel, publishVerb, singular } from "./studio";

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
  });

  it("says what Publish will do", () => {
    expect(publishVerb("publish")).toBe("Publish");
    expect(publishVerb("review")).toBe("Submit for review");
    expect(publishVerb("commit")).toBe("Commit");
  });
});
