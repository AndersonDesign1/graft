/**
 * How a field is shown and checked, from its schema descriptor.
 *
 * Pure and DOM-free: the rules about what an editor sees and what a save
 * would refuse live here, where they can be tested without a browser. The
 * checks mirror the Zod validator the server runs (the descriptor carries the
 * same limits), so a person learns "at most 80 characters" while typing
 * rather than from a failed save.
 */
import type { SchemaFieldDto } from "../../types";

/** Words that read as acronyms, not as words, when a key is humanised. */
const ACRONYMS = new Set([
  "id",
  "url",
  "uri",
  "seo",
  "sku",
  "faq",
  "cta",
  "api",
  "og",
  "html",
  "css",
]);

/** `metaDescription` -> "Meta description", `seo_title` -> "SEO title". */
export function humanise(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  return words
    .map((word, i) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ");
}

export function labelOf(field: Pick<SchemaFieldDto, "name" | "label">): string {
  return field.label?.trim() || humanise(field.name);
}

/** The editor control for a field. */
export type Control =
  | "text"
  | "textarea"
  | "number"
  | "money"
  | "toggle"
  | "datetime"
  | "select"
  | "reference"
  | "asset"
  | "group"
  | "list"
  | "tags"
  | "gallery"
  | "references"
  | "json";

export function controlOf(field: SchemaFieldDto): Control {
  switch (field.type) {
    case "string":
      return (field.constraints?.maxLength ?? 0) > 200 ? "textarea" : "text";
    case "text":
      return "textarea";
    case "number":
      return field.format === "money" ? "money" : "number";
    case "boolean":
      return "toggle";
    case "datetime":
      return "datetime";
    case "select":
      return "select";
    case "reference":
      return "reference";
    case "asset":
      return "asset";
    case "object":
      return "group";
    case "array": {
      const item = field.items;
      if (item?.type === "asset") return "gallery";
      if (item?.type === "reference") return "references";
      if (item?.type === "string" || item?.type === "select") return "tags";
      return item?.type === "object" ? "list" : item ? "list" : "json";
    }
    default:
      return "json";
  }
}

/**
 * The field shown as the entry's headline: a required string called title or
 * name. Promoted out of the form, because it is what the entry is.
 */
export function titleField(fields: readonly SchemaFieldDto[]): SchemaFieldDto | undefined {
  return fields.find(
    (field) => field.type === "string" && (field.name === "title" || field.name === "name"),
  );
}

/* ---- money --------------------------------------------------------------- */

/** Minor units per major unit, from Intl; 2 for most currencies, 0 for JPY. */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

export function formatMoney(minor: number, currency = "USD", locale?: string): string {
  const digits = currencyDigits(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      minor / 10 ** digits,
    );
  } catch {
    return (minor / 10 ** digits).toFixed(digits);
  }
}

/** "12.50", "$1,299", "12" -> minor units. Null when it is not an amount. */
export function parseMoney(input: string, currency = "USD"): number | null {
  const digits = currencyDigits(currency);
  const cleaned = input.replace(/[^0-9.,-]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!cleaned || !/^-?\d*(?:[.,]\d*)?$/.test(cleaned)) return null;
  const value = Number(cleaned.replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10 ** digits);
}

/** The amount as typed into the box, without the symbol: 1250 -> "12.50". */
export function moneyInput(minor: number | null | undefined, currency = "USD"): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return "";
  const digits = currencyDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/* ---- validation ---------------------------------------------------------- */

export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return false;
  if (typeof value === "object" && "key" in (value as object)) {
    return String((value as { key?: unknown }).key ?? "").trim() === "";
  }
  return false;
}

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASSET_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/** Problems with one value, in words a person acts on. Empty when it is fine. */
export function problemsWith(
  field: SchemaFieldDto,
  value: unknown,
  path = field.name,
): Map<string, string> {
  const out = new Map<string, string>();
  const label = labelOf(field);
  if (isBlank(value)) {
    if (!field.optional) out.set(path, `${label} is required.`);
    return out;
  }
  const c = field.constraints ?? {};
  switch (field.type) {
    case "string":
    case "text": {
      if (typeof value !== "string") {
        out.set(path, `${label} should be text.`);
        break;
      }
      if (c.maxLength !== undefined && value.length > c.maxLength) {
        out.set(
          path,
          `Keep ${label.toLowerCase()} to ${c.maxLength} characters (it has ${value.length}).`,
        );
      } else if (c.pattern !== undefined && !safeTest(c.pattern, value)) {
        out.set(path, `${label} isn't in the expected format.`);
      }
      break;
    }
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        out.set(path, `${label} should be a number.`);
        break;
      }
      const money = field.format === "money";
      const show = (n: number) => (money ? formatMoney(n, c.currency) : String(n));
      if (c.int && !Number.isInteger(value)) {
        out.set(
          path,
          money ? `${label} can't have fractions of a cent.` : `${label} should be a whole number.`,
        );
      } else if (c.min !== undefined && value < c.min) {
        out.set(path, `${label} can't be less than ${show(c.min)}.`);
      } else if (c.max !== undefined && value > c.max) {
        out.set(path, `${label} can't be more than ${show(c.max)}.`);
      }
      break;
    }
    case "boolean":
      if (typeof value !== "boolean") out.set(path, `${label} should be on or off.`);
      break;
    case "datetime":
      if (typeof value !== "string" || !ISO_DATETIME.test(value)) {
        out.set(path, `${label} needs a date and time.`);
      }
      break;
    case "select": {
      const allowed = (field.options ?? []).map((option) => option.value);
      if (!allowed.includes(String(value))) {
        out.set(path, `Choose one of the options for ${label.toLowerCase()}.`);
      }
      break;
    }
    case "reference":
      if (typeof value !== "string" || !SLUG.test(value)) {
        out.set(path, `Pick an entry for ${label.toLowerCase()}.`);
      }
      break;
    case "asset": {
      const key = (value as { key?: unknown }).key;
      if (typeof key !== "string" || !ASSET_KEY.test(key)) {
        out.set(path, `${label} needs a file name like "products/hat.jpg" (lowercase, no spaces).`);
      }
      break;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        out.set(path, `${label} is not in the expected shape.`);
        break;
      }
      for (const child of field.fields ?? []) {
        for (const [p, m] of problemsWith(
          child,
          (value as Record<string, unknown>)[child.name],
          `${path}.${child.name}`,
        )) {
          out.set(p, m);
        }
      }
      break;
    }
    case "array": {
      if (!Array.isArray(value)) {
        out.set(path, `${label} should be a list.`);
        break;
      }
      if (c.maxItems !== undefined && value.length > c.maxItems) {
        out.set(path, `${label} can have at most ${c.maxItems} items.`);
      }
      if (field.items) {
        value.forEach((item, i) => {
          const itemField = {
            ...field.items,
            name: field.items?.name ?? "item",
            optional: false,
          } as SchemaFieldDto;
          for (const [p, m] of problemsWith(itemField, item, `${path}.${i}`)) out.set(p, m);
        });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

export function problemsIn(
  fields: readonly SchemaFieldDto[],
  data: Record<string, unknown>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of fields) {
    for (const [path, message] of problemsWith(field, data[field.name])) out.set(path, message);
  }
  return out;
}

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

/**
 * The server's validation issues (Zod), keyed by dotted path, in the same
 * words as the checks above where the field is known.
 */
export function problemsFromServer(
  fields: readonly SchemaFieldDto[],
  data: Record<string, unknown>,
  issues: readonly { path?: readonly (string | number)[]; message?: string }[],
): Map<string, string> {
  const local = problemsIn(fields, data);
  const out = new Map<string, string>();
  for (const issue of issues) {
    const path = (issue.path ?? []).join(".");
    const field = fields.find((candidate) => candidate.name === issue.path?.[0]);
    out.set(
      path || "(entry)",
      local.get(path) ??
        (field
          ? `${labelOf(field)}: ${issue.message ?? "isn't valid."}`
          : (issue.message ?? "Not valid.")),
    );
  }
  return out;
}

/** A value frontmatter can hold: what a list item or a field starts as. */
export type FieldValue =
  | string
  | number
  | boolean
  | FieldValue[]
  | { [key: string]: FieldValue }
  | undefined;

/** A starting value for a new list item, so required booleans are not left undefined. */
export function emptyValue(field: SchemaFieldDto): FieldValue {
  switch (field.type) {
    case "boolean":
      return false;
    case "object":
      return Object.fromEntries(
        (field.fields ?? [])
          .filter((child) => !child.optional)
          .map((child): [string, FieldValue] => [child.name, emptyValue(child)])
          .filter(([, value]) => value !== undefined),
      );
    case "array":
      return [];
    case "select":
      return field.options?.[0]?.value;
    default:
      return undefined;
  }
}
