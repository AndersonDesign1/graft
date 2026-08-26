/**
 * Turn a collection's declared schema plus a document's frontmatter into a form.
 *
 * The form used to be built from the document's *values*: every key was probed
 * with `typeof` and anything that wasn't a string, number or boolean was
 * dropped. That has three consequences, and all three are the reason this
 * module exists.
 *
 * 1. A field the author hasn't filled in yet does not exist, so the only way to
 *    add an optional `description` is to leave the form and hand-write YAML.
 * 2. Types are guessed from the value rather than read from the schema, so a
 *    one-line `description` gets a single-line input and a long one gets a
 *    textarea — the same field, two widgets, depending on what happens to be in
 *    it today.
 * 3. Asset, object and array fields are invisible. `pages/home.mdx` declares an
 *    `image` asset and a `faqs` array; the form showed neither.
 *
 * The schema already knows all of this — it is the same descriptor MCP's
 * `describe_schema` hands agents. Reading it here is what "one Zod layer" means
 * for the editor.
 *
 * Pure and DOM-free on purpose: this is where the rules about what may be
 * written live, and those deserve tests that do not need a browser.
 */
import type { SchemaFieldDto } from "../../types";

/** How a field is edited. Narrower than the declared type, which is open-ended. */
export type WidgetKind =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "datetime"
  | "asset"
  | "json"
  /** object / array — shown, summarised, and edited in Raw MDX. See below. */
  | "structured";

export interface FormField {
  key: string;
  widget: WidgetKind;
  /** The schema's own type name, or null when the key is not declared. */
  declaredType: string | null;
  optional: boolean;
  description?: string;
  /** Declared by the schema, absent from this document. Offered, not invented. */
  absent: boolean;
  /** In the document but not in the schema — authored by hand, or left behind
   *  by a schema change. Shown either way: hiding authored data is how an
   *  editor loses it. */
  undeclared: boolean;
  value: unknown;
}

const WIDGET_BY_TYPE: Record<string, WidgetKind> = {
  string: "string",
  text: "text",
  number: "number",
  boolean: "boolean",
  datetime: "datetime",
  asset: "asset",
  json: "json",
  object: "structured",
  array: "structured",
};

/**
 * Nested shapes are deliberately not editable inline in v1.
 *
 * A half-built nested editor is the exact shape of the bug this rewrite is
 * fixing: it would need to re-serialise a structure it only partly understands,
 * and anything it failed to model would vanish on save. Showing the value and
 * routing the edit to Raw MDX keeps the bytes safe while still making the field
 * visible, which is already the whole difference from before.
 */
export function isEditable(widget: WidgetKind): boolean {
  return widget !== "structured" && widget !== "json";
}

/** Widget for an undeclared key, from whatever the document actually holds. */
function inferWidget(value: unknown): WidgetKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return value.length > 72 ? "text" : "string";
  return "structured";
}

/**
 * The form's fields: everything the schema declares, in declaration order,
 * followed by anything the document carries that the schema does not.
 *
 * Declaration order beats alphabetical and beats the old hard-coded
 * `["title", "description", "section", …]` list, which only knew about the
 * fields this repo's own examples happened to use.
 */
export function buildForm(
  schemaFields: SchemaFieldDto[] | undefined,
  data: Record<string, unknown>,
): FormField[] {
  const declared = new Set<string>();
  const fields: FormField[] = [];

  for (const field of schemaFields ?? []) {
    declared.add(field.name);
    const present = Object.hasOwn(data, field.name) && data[field.name] !== undefined;
    fields.push({
      key: field.name,
      widget: WIDGET_BY_TYPE[field.type] ?? inferWidget(data[field.name]),
      declaredType: field.type,
      optional: field.optional,
      ...(field.description ? { description: field.description } : {}),
      absent: !present,
      undeclared: false,
      value: data[field.name],
    });
  }

  for (const key of Object.keys(data).sort()) {
    if (declared.has(key)) continue;
    fields.push({
      key,
      widget: inferWidget(data[key]),
      declaredType: null,
      // An undeclared key cannot be required — the schema does not know it.
      optional: true,
      absent: false,
      undeclared: true,
      value: data[key],
    });
  }

  return fields;
}

/** Structural equality over parsed YAML (plain data — no classes, no cycles). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) =>
        Object.hasOwn(b as Record<string, unknown>, key) &&
        sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/** Nothing the author would recognise as a value. */
function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  // An asset with no key is an empty asset, whatever its alt text says.
  if (typeof value === "object" && "key" in (value as object)) {
    return String((value as { key?: unknown }).key ?? "").trim() === "";
  }
  return false;
}

/**
 * The frontmatter to write, given what was loaded and what the form holds.
 *
 * Two rules, both about not inventing bytes:
 *
 * - A declared field the author never filled in stays out of the file. Writing
 *   `description: ""` into every document because the schema mentions the field
 *   would be the form editing files nobody asked it to edit.
 * - Clearing a field that *was* set removes the key, which is the only reading
 *   of "the author emptied this box". Required fields are the exception: the
 *   emptied value is kept so validation reports it, because silently dropping a
 *   required key turns a visible mistake into a failed compile somewhere else.
 */
export function composeData(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
  fields: FormField[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original };

  for (const field of fields) {
    if (!Object.hasOwn(edited, field.key)) continue;
    const next = edited[field.key];
    const existed = Object.hasOwn(original, field.key) && original[field.key] !== undefined;

    if (isEmpty(next)) {
      if (!existed) delete out[field.key];
      else if (field.optional) delete out[field.key];
      else out[field.key] = next;
      continue;
    }
    out[field.key] = next;
  }

  return out;
}
