import { describe, expect, it } from "vitest";
import type { SchemaFieldDto } from "../../types";
import { buildForm, composeData, isEditable, sameValue } from "./schema-form";

const field = (
  name: string,
  type: string,
  optional = false,
  description?: string,
): SchemaFieldDto => ({
  name,
  type,
  optional,
  ...(description ? { description } : {}),
});

/** The shape of examples/landing-page's `pages` collection, trimmed. */
const PAGES: SchemaFieldDto[] = [
  field("title", "string"),
  field("description", "text", false, "Meta description."),
  field("order", "number", true),
  field("image", "asset", true, "Hero image."),
  field("faqs", "array", true),
];

describe("buildForm", () => {
  it("offers declared fields the document has not filled in", () => {
    const form = buildForm(PAGES, { title: "Home" });
    const order = form.find((f) => f.key === "order");
    expect(order).toMatchObject({ absent: true, optional: true, widget: "number" });
    // The point of the whole unit: you can now add it without leaving the form.
    expect(form.map((f) => f.key)).toContain("order");
  });

  it("keeps schema declaration order rather than sorting", () => {
    const form = buildForm(PAGES, { faqs: [], title: "Home" });
    expect(form.map((f) => f.key)).toEqual(["title", "description", "order", "image", "faqs"]);
  });

  it("takes the widget from the declared type, not the value's length", () => {
    // Both are one short line; only the schema knows one is prose.
    const form = buildForm(PAGES, { title: "Home", description: "Short." });
    expect(form.find((f) => f.key === "title")?.widget).toBe("string");
    expect(form.find((f) => f.key === "description")?.widget).toBe("text");
  });

  it("surfaces asset and array fields the old value-driven form dropped", () => {
    const form = buildForm(PAGES, {
      title: "Home",
      image: { key: "pages/home/hero.svg", alt: "A hero." },
      faqs: [{ question: "q", answer: "a" }],
    });
    expect(form.find((f) => f.key === "image")?.widget).toBe("asset");
    expect(form.find((f) => f.key === "faqs")?.widget).toBe("structured");
  });

  it("shows authored keys the schema does not declare", () => {
    const form = buildForm(PAGES, { title: "Home", legacyFlag: true });
    const extra = form.find((f) => f.key === "legacyFlag");
    expect(extra).toMatchObject({ undeclared: true, declaredType: null, widget: "boolean" });
  });

  it("survives a collection with no schema at all", () => {
    const form = buildForm(undefined, { title: "Home", n: 2 });
    expect(form.map((f) => f.key)).toEqual(["n", "title"]);
    expect(form.every((f) => f.undeclared)).toBe(true);
  });

  it("carries the schema description through as help text", () => {
    const form = buildForm(PAGES, {});
    expect(form.find((f) => f.key === "image")?.description).toBe("Hero image.");
  });
});

describe("isEditable", () => {
  it("refuses inline editing for shapes a flat form cannot round-trip", () => {
    expect(isEditable("structured")).toBe(false);
    expect(isEditable("json")).toBe(false);
  });

  it("allows every scalar widget", () => {
    for (const widget of ["string", "text", "number", "boolean", "datetime", "asset"] as const) {
      expect(isEditable(widget)).toBe(true);
    }
  });
});

describe("composeData", () => {
  const form = buildForm(PAGES, { title: "Home", description: "Desc." });

  it("leaves untouched keys exactly as loaded", () => {
    const original = { title: "Home", image: { key: "a/b.png" }, faqs: [{ q: 1 }] };
    const out = composeData(original, { title: "Home" }, buildForm(PAGES, original));
    expect(out).toEqual(original);
    // The structured values are the same references, not rebuilt copies.
    expect(out.image).toBe(original.image);
    expect(out.faqs).toBe(original.faqs);
  });

  it("does not invent a key for a declared field left blank", () => {
    const out = composeData({ title: "Home" }, { title: "Home", order: "" }, form);
    expect(Object.hasOwn(out, "order")).toBe(false);
  });

  it("removes an optional key the author cleared", () => {
    const original = { title: "Home", order: 3 };
    const out = composeData(original, { order: "" }, buildForm(PAGES, original));
    expect(Object.hasOwn(out, "order")).toBe(false);
  });

  it("keeps a cleared required field so validation can report it", () => {
    const original = { title: "Home", description: "Desc." };
    const out = composeData(original, { description: "" }, buildForm(PAGES, original));
    expect(out.description).toBe("");
  });

  it("writes an edited value", () => {
    const out = composeData({ title: "Home" }, { title: "Home page" }, form);
    expect(out.title).toBe("Home page");
  });

  it("treats an asset with no key as empty", () => {
    const original = { title: "Home", image: { key: "a/b.png", alt: "x" } };
    const out = composeData(original, { image: { key: "", alt: "x" } }, buildForm(PAGES, original));
    expect(Object.hasOwn(out, "image")).toBe(false);
  });
});

describe("sameValue", () => {
  it("compares nested structures by value, not identity", () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
  });

  it("does not call a reserialised asset object a change", () => {
    // The form rebuilds this object on every render; identity would say dirty.
    const original = { image: { key: "a/b.png", alt: "x" } };
    const composed = { image: { key: "a/b.png", alt: "x" } };
    expect(sameValue(original, composed)).toBe(true);
  });

  it("notices an added or removed key", () => {
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });
});
