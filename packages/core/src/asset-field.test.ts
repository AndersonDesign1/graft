import { describe, expect, it } from "vitest";
import { defineCollection } from "./collection";
import { AssetRef, field } from "./field";

describe("field.asset", () => {
  const posts = defineCollection({
    name: "posts",
    fields: {
      title: field.string(),
      cover: field.asset({ optional: true, description: "Cover image" }),
    },
  });

  it("accepts a key with optional alt", () => {
    expect(
      posts.schema.safeParse({ title: "x", cover: { key: "posts/cover.png" } }).success,
    ).toBe(true);
    expect(
      posts.schema.safeParse({
        title: "x",
        cover: { key: "posts/nested/cover-2.webp", alt: "A cover" },
      }).success,
    ).toBe(true);
  });

  it("is optional when declared optional", () => {
    expect(posts.schema.safeParse({ title: "x" }).success).toBe(true);
  });

  it.each([
    "/leading-slash",
    "UPPER/case.png",
    "has space.png",
    "../escape.png",
    "trailing/",
    "",
  ])("rejects invalid key %j", (key) => {
    expect(posts.schema.safeParse({ title: "x", cover: { key } }).success).toBe(false);
  });

  it("rejects a bare string (the reference is structured)", () => {
    expect(posts.schema.safeParse({ title: "x", cover: "posts/cover.png" }).success).toBe(false);
  });

  it("describes itself as type asset for introspection", () => {
    const descriptor = posts.describe().fields.find((f) => f.name === "cover");
    expect(descriptor?.type).toBe("asset");
    expect(descriptor?.optional).toBe(true);
  });

  it("exports AssetRef for standalone validation", () => {
    expect(AssetRef.safeParse({ key: "a/b.png", alt: "x" }).success).toBe(true);
  });
});
