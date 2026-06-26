import { describe, expect, it } from "vitest";
import { GraftError } from "./errors";
import { CollectionDescriptor } from "./introspection";

describe("GraftError", () => {
  it("is an Error and serializes with code + agent-actionable fix", () => {
    const err = new GraftError({
      code: "SLUG_NOT_UNIQUE",
      message: "Slug 'home' is already used by pages/home.mdx",
      fix: "Rename the slug or remove the duplicate file.",
    });

    expect(err).toBeInstanceOf(Error);
    expect(err.toJSON()).toMatchObject({
      error: "SLUG_NOT_UNIQUE",
      fix: "Rename the slug or remove the duplicate file.",
    });
  });
});

describe("introspection contracts", () => {
  it("parses a valid collection descriptor and applies field defaults", () => {
    const parsed = CollectionDescriptor.parse({
      name: "page",
      authority: "file-authoritative",
      fields: [{ name: "title", type: "string" }],
    });

    expect(parsed.name).toBe("page");
    expect(parsed.fields[0]?.optional).toBe(false);
  });

  it("rejects an unknown authority mode", () => {
    expect(() =>
      CollectionDescriptor.parse({
        name: "page",
        authority: "whatever",
        fields: [],
      }),
    ).toThrow();
  });
});
