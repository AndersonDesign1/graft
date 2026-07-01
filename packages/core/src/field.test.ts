import { describe, expect, expectTypeOf, it } from "vitest";
import { defineField, field } from "./field";
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
    expectTypeOf(field.number({ optional: true }).zod).toEqualTypeOf<
      z.ZodOptional<z.ZodNumber>
    >();
    expectTypeOf(field.string().zod.parse("x")).toEqualTypeOf<string>();
  });
});
