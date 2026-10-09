import { describe, expect, it } from "vitest";
import type { SchemaFieldDto } from "../../types";
import {
  controlOf,
  emptyValue,
  formatMoney,
  humanise,
  labelOf,
  moneyInput,
  parseMoney,
  problemsFromServer,
  problemsIn,
  titleField,
} from "./fields";

const f = (field: Partial<SchemaFieldDto> & { name: string; type: string }): SchemaFieldDto => ({
  optional: false,
  ...field,
});

describe("labels", () => {
  it("humanises keys and respects declared labels", () => {
    expect(humanise("metaDescription")).toBe("Meta description");
    expect(humanise("seo_title")).toBe("SEO title");
    expect(humanise("productSKU")).toBe("Product SKU");
    expect(humanise("ogImageUrl")).toBe("OG image URL");
    expect(labelOf({ name: "priceCents", label: "Price" })).toBe("Price");
  });
});

describe("controls", () => {
  it("picks the control from the declared type", () => {
    expect(controlOf(f({ name: "a", type: "number", format: "money" }))).toBe("money");
    expect(controlOf(f({ name: "a", type: "select" }))).toBe("select");
    expect(
      controlOf(f({ name: "a", type: "array", items: f({ name: "item", type: "asset" }) })),
    ).toBe("gallery");
    expect(
      controlOf(f({ name: "a", type: "array", items: f({ name: "item", type: "string" }) })),
    ).toBe("tags");
    expect(
      controlOf(f({ name: "a", type: "array", items: f({ name: "item", type: "object" }) })),
    ).toBe("list");
    expect(
      controlOf(f({ name: "a", type: "array", items: f({ name: "item", type: "reference" }) })),
    ).toBe("references");
    expect(controlOf(f({ name: "a", type: "object" }))).toBe("group");
  });

  it("promotes the title field", () => {
    expect(
      titleField([f({ name: "price", type: "number" }), f({ name: "title", type: "string" })])
        ?.name,
    ).toBe("title");
  });
});

describe("money", () => {
  it("formats and parses minor units", () => {
    expect(formatMoney(1250, "USD", "en-US")).toBe("$12.50");
    expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
    expect(parseMoney("12.50")).toBe(1250);
    expect(parseMoney("$1,299")).toBe(129900);
    expect(parseMoney("12,5")).toBe(1250);
    expect(parseMoney("abc")).toBeNull();
    expect(moneyInput(1250)).toBe("12.50");
    expect(moneyInput(undefined)).toBe("");
  });
});

describe("validation in words", () => {
  const fields = [
    f({ name: "title", type: "string", constraints: { maxLength: 10 } }),
    f({
      name: "price",
      type: "number",
      format: "money",
      constraints: { min: 0, int: true, currency: "USD" },
    }),
    f({ name: "status", type: "select", options: [{ value: "draft" }, { value: "active" }] }),
    f({ name: "category", type: "reference", to: "categories", optional: true }),
    f({
      name: "variants",
      type: "array",
      constraints: { maxItems: 2 },
      items: f({
        name: "item",
        type: "object",
        fields: [
          f({ name: "sku", type: "string" }),
          f({ name: "stock", type: "number", constraints: { int: true } }),
        ],
      }),
    }),
  ];

  it("passes a valid entry", () => {
    expect(
      problemsIn(fields, {
        title: "Hat",
        price: 2500,
        status: "active",
        variants: [{ sku: "H-1", stock: 3 }],
      }),
    ).toEqual(new Map());
  });

  it("names each problem on its field, nested ones by path", () => {
    const problems = problemsIn(fields, {
      title: "A very long title",
      price: -5,
      status: "sold",
      category: "Not A Slug",
      variants: [{ sku: "" }, { sku: "x", stock: 1.5 }, { sku: "y", stock: 1 }],
    });
    expect(Object.fromEntries(problems)).toEqual({
      title: "Keep title to 10 characters (it has 17).",
      price: "Price can't be less than $0.00.",
      status: "Choose one of the options for status.",
      category: "Pick an entry for category.",
      variants: "Variants can have at most 2 items.",
      "variants.0.sku": "SKU is required.",
      "variants.0.stock": "Stock is required.",
      "variants.1.stock": "Stock should be a whole number.",
    });
  });

  it("maps server issues onto the same words", () => {
    const problems = problemsFromServer(fields, { title: "Hat", price: 1.5, status: "active" }, [
      { path: ["price"], message: "Invalid input: expected int, received number" },
      { path: ["mystery"], message: "Unrecognized" },
    ]);
    expect(problems.get("price")).toBe("Price can't have fractions of a cent.");
    expect(problems.get("mystery")).toBe("Unrecognized");
  });

  it("starts new list items with required booleans and first options set", () => {
    expect(
      emptyValue(
        f({
          name: "item",
          type: "object",
          fields: [
            f({ name: "inStock", type: "boolean" }),
            f({ name: "size", type: "select", options: [{ value: "s" }, { value: "m" }] }),
            f({ name: "note", type: "string", optional: true }),
          ],
        }),
      ),
    ).toEqual({ inStock: false, size: "s" });
  });
});
