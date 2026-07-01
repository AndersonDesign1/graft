import { CollectionDescriptor } from "@graft/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import { defineCollection, type DocumentData } from "./collection";
import { field, type JsonValue } from "./field";

const page = defineCollection({
  name: "page",
  description: "A marketing page.",
  fields: {
    title: field.string(),
    description: field.string({ optional: true }),
    order: field.number({ optional: true }),
    published: field.boolean(),
    meta: field.json({ optional: true }),
  },
});

describe("defineCollection", () => {
  it("defaults authority to file-authoritative", () => {
    expect(page.authority).toBe("file-authoritative");
  });

  it("validates documents via the generated Zod schema", () => {
    expect(page.schema.parse({ title: "Home", published: true })).toMatchObject({
      title: "Home",
    });
    expect(() => page.schema.parse({ published: true })).toThrow(); // title is required
  });

  it("produces a descriptor that satisfies the @graft/contracts contract", () => {
    const desc = page.describe();
    expect(() => CollectionDescriptor.parse(desc)).not.toThrow();
    expect(desc.fields.find((f) => f.name === "description")?.optional).toBe(true);
    expect(desc.fields.find((f) => f.name === "title")?.optional).toBe(false);
  });

  it("infers the exact document type — the compile-time self-teaching contract", () => {
    type Page = DocumentData<typeof page>;
    expectTypeOf<Page>().toEqualTypeOf<{
      title: string;
      description?: string | undefined;
      order?: number | undefined;
      published: boolean;
      meta?: JsonValue | undefined;
    }>();

    // parse() returns the inferred type, not Record<string, unknown>.
    const doc = page.schema.parse({ title: "Home", published: true });
    expectTypeOf(doc.title).toEqualTypeOf<string>();
    expectTypeOf(doc.order).toEqualTypeOf<number | undefined>();
  });
});
