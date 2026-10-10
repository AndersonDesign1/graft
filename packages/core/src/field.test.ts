import { describe, expect, expectTypeOf, it } from "vitest";
import { FieldDescriptor } from "@usegraft/contracts";
import { defineField, field, toFieldDescriptor } from "./field";
import type { z } from "zod";

describe("defineField", () => {
  it("maps a type to a validating Zod schema", () => {
    const f = defineField("number");
    expect(f.type).toBe("number");
    expect(f.optional).toBe(false);
    expect(f.zod.safeParse(3).success).toBe(true);
    expect(f.zod.safeParse("nope").success).toBe(false);
  });

  it("optional wraps the schema so undefined is allowed", () => {
    const f = field.string({ optional: true });
    expect(f.optional).toBe(true);
    expect(f.zod.safeParse(undefined).success).toBe(true);
    expect(f.zod.safeParse("hi").success).toBe(true);
  });

  it("datetime only accepts ISO strings", () => {
    const f = field.datetime();
    expect(f.zod.safeParse("2026-06-27T00:00:00Z").success).toBe(true);
    expect(f.zod.safeParse("not-a-date").success).toBe(false);
  });

  it("carries a description through to the definition", () => {
    const f = field.text({ description: "the body" });
    expect(f.description).toBe("the body");
  });

  it("json accepts any JSON value — objects, arrays, and scalars", () => {
    const f = field.json();
    expect(f.zod.safeParse({ a: 1, b: [true, null] }).success).toBe(true);
    expect(f.zod.safeParse([1, "two", { three: 3 }]).success).toBe(true);
    expect(f.zod.safeParse("scalar").success).toBe(true);
    expect(f.zod.safeParse(undefined).success).toBe(false);
  });

  it("preserves the concrete Zod type through the builder", () => {
    expectTypeOf(field.string().zod).toEqualTypeOf<z.ZodString>();
    expectTypeOf(field.number({ optional: true }).zod).toEqualTypeOf<z.ZodOptional<z.ZodNumber>>();
    expectTypeOf(field.string().zod.parse("x")).toEqualTypeOf<string>();
  });

  it("object builds a nested Zod object from child fields", () => {
    const f = field.object({
      fields: {
        title: field.string(),
        count: field.number({ optional: true }),
      },
      description: "A group",
    });
    expect(f.type).toBe("object");
    expect(f.fields?.title?.type).toBe("string");
    expect(f.zod.safeParse({ title: "hi" }).success).toBe(true);
    expect(f.zod.safeParse({ title: "hi", count: 2 }).success).toBe(true);
    expect(f.zod.safeParse({}).success).toBe(false);
  });

  it("array validates a list of the item field", () => {
    const f = field.array({
      of: field.object({
        fields: {
          productSlug: field.string(),
          qty: field.number(),
        },
      }),
    });
    expect(f.type).toBe("array");
    expect(f.items?.type).toBe("object");
    expect(
      f.zod.safeParse([
        { productSlug: "widget", qty: 2 },
        { productSlug: "gizmo", qty: 1 },
      ]).success,
    ).toBe(true);
    expect(f.zod.safeParse([{ productSlug: "widget" }]).success).toBe(false);
  });

  it("toFieldDescriptor is recursive for object and array", async () => {
    const { toFieldDescriptor } = await import("./field");
    const f = field.array({
      of: field.object({
        fields: { q: field.string(), a: field.text() },
      }),
      description: "FAQ list",
    });
    const desc = toFieldDescriptor("faqs", f);
    expect(desc).toMatchObject({
      name: "faqs",
      type: "array",
      description: "FAQ list",
      items: {
        name: "item",
        type: "object",
        fields: [
          { name: "q", type: "string" },
          { name: "a", type: "text" },
        ],
      },
    });
  });

  it("object/array inference survives into parse results", () => {
    const line = field.object({
      fields: { productSlug: field.string(), qty: field.number() },
    });
    const items = field.array({ of: line });
    const parsed = items.zod.parse([{ productSlug: "widget", qty: 2 }]);
    expectTypeOf(parsed).toEqualTypeOf<{ productSlug: string; qty: number }[]>();
    expectTypeOf(parsed[0]!.productSlug).toEqualTypeOf<string>();
  });
});

describe("bounds", () => {
  it("caps string and text length", () => {
    const short = field.string({ maxLength: 5 });
    expect(short.zod.safeParse("abcde").success).toBe(true);
    expect(short.zod.safeParse("abcdef").success).toBe(false);

    const body = field.text({ maxLength: 3 });
    expect(body.zod.safeParse("abcd").success).toBe(false);
  });

  it("bounds numbers, including the integer case", () => {
    const qty = field.number({ int: true, min: 1, max: 100 });
    expect(qty.zod.safeParse(50).success).toBe(true);
    expect(qty.zod.safeParse(0).success).toBe(false);
    expect(qty.zod.safeParse(101).success).toBe(false);
    expect(qty.zod.safeParse(1.5).success).toBe(false);
    // The case that silently corrupted order totals: an unbounded quantity
    // multiplied by a price exceeds Number.MAX_SAFE_INTEGER.
    expect(qty.zod.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(false);
  });

  it("caps array length", () => {
    const items = field.array({ of: field.string(), maxItems: 2 });
    expect(items.zod.safeParse(["a", "b"]).success).toBe(true);
    expect(items.zod.safeParse(["a", "b", "c"]).success).toBe(false);
  });

  it("leaves fields unbounded when no bound is given", () => {
    expect(field.string().zod.safeParse("x".repeat(10_000)).success).toBe(true);
  });
});

describe("editor metadata", () => {
  it("select accepts only declared values and infers their union", () => {
    const status = field.select({
      options: ["draft", { value: "active", label: "On sale" }, "archived"],
      label: "Status",
    });
    expect(status.type).toBe("select");
    expect(status.zod.safeParse("active").success).toBe(true);
    expect(status.zod.safeParse("Active").success).toBe(false);
    expect(status.options).toEqual([
      { value: "draft" },
      { value: "active", label: "On sale" },
      { value: "archived" },
    ]);
    expectTypeOf(status.zod.parse("draft")).toEqualTypeOf<"draft" | "active" | "archived">();
  });

  it("optional select allows absence", () => {
    const f = field.select({ options: ["a", "b"], optional: true });
    expect(f.zod.safeParse(undefined).success).toBe(true);
    expectTypeOf(f.zod.parse(undefined)).toEqualTypeOf<"a" | "b" | undefined>();
  });

  it("reference holds a slug and names its collection", () => {
    const category = field.reference({ to: "categories", label: "Category" });
    expect(category.type).toBe("reference");
    expect(category.to).toBe("categories");
    expect(category.zod.safeParse("summer-sale").success).toBe(true);
    expect(category.zod.safeParse("../etc/passwd").success).toBe(false);
    expect(category.zod.safeParse("Summer Sale").success).toBe(false);
  });

  it("money numbers are integers and say so", () => {
    const price = field.number({ format: "money", currency: "eur", min: 0 });
    expect(price.zod.safeParse(1250).success).toBe(true);
    expect(price.zod.safeParse(12.5).success).toBe(false);
    expect(price.constraints).toEqual({ min: 0, int: true, currency: "EUR" });
    expect(price.format).toBe("money");
  });

  it("describes label, constraints, options and target, and nothing for a bare field", () => {
    const described = toFieldDescriptor(
      "title",
      field.string({ label: "Title", maxLength: 80, pattern: /^[A-Z]/ }),
    );
    expect(described).toMatchObject({
      label: "Title",
      constraints: { maxLength: 80, pattern: "^[A-Z]" },
    });
    expect(Object.keys(toFieldDescriptor("plain", field.string()))).toEqual([
      "name",
      "type",
      "optional",
      "description",
      "fields",
      "items",
    ]);
    const gallery = toFieldDescriptor(
      "images",
      field.array({ of: field.asset(), maxItems: 8, label: "Gallery" }),
    );
    expect(gallery).toMatchObject({ label: "Gallery", constraints: { maxItems: 8 } });
    expect(toFieldDescriptor("c", field.reference({ to: "categories" })).to).toBe("categories");
  });

  it("round-trips through the contract schema", () => {
    const parsed = FieldDescriptor.parse(
      toFieldDescriptor("s", field.select({ options: ["x"], label: "S" })),
    );
    expect(parsed.options).toEqual([{ value: "x" }]);
    expect(parsed.label).toBe("S");
  });
});
