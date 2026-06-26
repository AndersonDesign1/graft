import { CollectionDescriptor } from "@graft/contracts";
import { describe, expect, it } from "vitest";
import { defineCollection } from "./collection";
import { field } from "./field";

const page = defineCollection({
  name: "page",
  description: "A marketing page.",
  fields: {
    title: field.string(),
    description: field.string({ optional: true }),
    order: field.number({ optional: true }),
  },
});

describe("defineCollection", () => {
  it("defaults authority to file-authoritative", () => {
    expect(page.authority).toBe("file-authoritative");
  });

  it("validates documents via the generated Zod schema", () => {
    expect(page.schema.parse({ title: "Home" })).toMatchObject({ title: "Home" });
    expect(() => page.schema.parse({})).toThrow(); // title is required
  });

  it("produces a descriptor that satisfies the @graft/contracts contract", () => {
    const desc = page.describe();
    expect(() => CollectionDescriptor.parse(desc)).not.toThrow();
    expect(desc.fields.find((f) => f.name === "description")?.optional).toBe(true);
    expect(desc.fields.find((f) => f.name === "title")?.optional).toBe(false);
  });
});
