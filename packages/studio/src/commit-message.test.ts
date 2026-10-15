import { describe, expect, it } from "vitest";
import { commitMessageFor } from "./commit-message";

const change = (kind: string, title: string) => ({ kind, title });

describe("commitMessageFor", () => {
  it("names up to three entries by title", () => {
    expect(commitMessageFor([change("modified", "Wool Hat")])).toBe("Update “Wool Hat”");
    expect(commitMessageFor([change("added", "Hat"), change("added", "Scarf")])).toBe(
      "Add “Hat” and “Scarf”",
    );
    expect(
      commitMessageFor([change("deleted", "A"), change("deleted", "B"), change("deleted", "C")]),
    ).toBe("Delete “A”, “B” and “C”");
  });

  it("counts past three, and says Update when the kinds differ", () => {
    const four = ["A", "B", "C", "D"].map((title) => change("added", title));
    expect(commitMessageFor(four)).toBe("Add 4 entries");
    expect(commitMessageFor([change("added", "A"), change("deleted", "B")])).toBe(
      "Update “A” and “B”",
    );
    expect(commitMessageFor([])).toBe("Update content");
  });
});
