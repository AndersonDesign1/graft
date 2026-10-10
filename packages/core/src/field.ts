/**
 * Field definitions — the typed building blocks of a collection.
 *
 * Each field maps to a Zod schema (the single validation layer) plus the metadata
 * the compiler and MCP introspection need. Authored as code; edited by agents.
 *
 * FieldDefinition is generic over its Zod schema so the concrete type
 * (ZodString, ZodOptional<ZodNumber>, …) survives into defineCollection and from
 * there into z.infer — typed reads all the way down, with no codegen step.
 *
 * Nested structure (object / array) is first-class so SEO groups, FAQ lists, and
 * commerce line items stay typed — not opaque field.json blobs.
 */
import type {
  FieldConstraints,
  FieldDescriptor,
  FieldFormat,
  SelectOption,
} from "@usegraft/contracts";
import { z } from "zod";

export type ScalarFieldType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "datetime"
  | "json"
  | "asset";

export type FieldType = ScalarFieldType | "select" | "reference" | "object" | "array";

/**
 * A document slug: what a `reference` field holds. Kept in step with the
 * compiler's SLUG_RE, which names files; a reference names one of them.
 */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Lowercase slash-separated path, each segment starting alphanumeric —
 * URL-safe, no leading slash, and `..` is unrepresentable.
 */
const ASSET_KEY_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

/**
 * What an `asset` field holds: a reference to a binary in the asset store.
 * The binary lives in object storage (R2/MinIO); this reference lives in
 * frontmatter like any other field, so git stays authoritative for content.
 */
export const AssetRef = z.object({
  key: z
    .string()
    .regex(
      ASSET_KEY_RE,
      'asset key must be a lowercase path like "pages/home/hero.png" (letters, digits, ., _, -; segments separated by /)',
    ),
  alt: z.string().optional(),
});
export type AssetRef = z.infer<typeof AssetRef>;

/** Any JSON-serializable value — what a `json` field validates and infers to. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export interface FieldOptions {
  optional?: boolean;
  description?: string;
  /**
   * What an editor calls this field ("Price", "Meta description"). Shown in
   * the Studio's form instead of the key; the key stays the contract.
   */
  label?: string;
  /**
   * How a `number` is presented. `money` declares the value is an integer in
   * the smallest currency unit (cents), so the Studio shows "$12.50" and
   * writes 1250. Implies `int`.
   */
  format?: FieldFormat;
  /** ISO 4217 code for a `money` number. Presentation only; defaults to USD. */
  currency?: string;
  /**
   * Maximum length for `string` / `text`.
   *
   * There was no way to bound a field at all, so every authored string and
   * every public form input compiled to a bare `z.string()` and was written
   * verbatim into an unbounded jsonb column. A single anonymous request could
   * store megabytes.
   */
  maxLength?: number;
  /** Minimum value for `number`. */
  min?: number;
  /**
   * Maximum value for `number`.
   *
   * Worth setting on anything that gets multiplied: an unbounded quantity times
   * a price silently exceeds `Number.MAX_SAFE_INTEGER` and the stored total is
   * wrong rather than rejected.
   */
  max?: number;
  /** Require an integer (`number` only). */
  int?: boolean;
  /**
   * Pattern a `string` / `text` value must match.
   *
   * For values that are consumed by something stricter than "a string" — an
   * ISO currency code handed to `Intl.NumberFormat`, for instance, which throws
   * a RangeError on anything that is not exactly three letters and takes the
   * whole page down with it.
   */
  pattern?: RegExp;
}

export interface FieldDefinition<TZod extends z.ZodType = z.ZodType> {
  type: FieldType;
  /** Zod schema validating this field's value. */
  zod: TZod;
  optional: boolean;
  description?: string;
  label?: string;
  /** The limits `zod` enforces, restated as data for introspection. */
  constraints?: FieldConstraints;
  format?: FieldFormat;
  /** Allowed values, for `select`. */
  options?: SelectOption[];
  /** Target collection, for `reference`. */
  to?: string;
  /** Nested fields when type is `object`. */
  fields?: Record<string, FieldDefinition>;
  /** Item field when type is `array`. */
  items?: FieldDefinition;
}

/** The base Zod schema each scalar field type produces. */
interface ScalarZodMap {
  string: z.ZodString;
  text: z.ZodString;
  number: z.ZodNumber;
  boolean: z.ZodBoolean;
  datetime: z.ZodISODateTime;
  json: z.ZodType<JsonValue>;
  asset: typeof AssetRef;
}

const BASE_ZOD: { [T in ScalarFieldType]: () => ScalarZodMap[T] } = {
  string: () => z.string(),
  text: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  datetime: () => z.iso.datetime(),
  json: () => jsonValue,
  asset: () => AssetRef,
};

type MaybeOptional<TZod extends z.ZodType, TOptions extends FieldOptions> = TOptions extends {
  optional: true;
}
  ? z.ZodOptional<TZod>
  : TZod;

/** Apply the option-driven constraints a scalar type supports. */
function constrain(type: ScalarFieldType, base: z.ZodType, options?: FieldOptions): z.ZodType {
  if (options === undefined) return base;
  let out = base;
  if (type === "string" || type === "text") {
    let str = out as z.ZodString;
    if (options.maxLength !== undefined) str = str.max(options.maxLength);
    if (options.pattern !== undefined) str = str.regex(options.pattern);
    out = str;
  }
  if (type === "number") {
    let n = out as z.ZodNumber;
    if (options.int === true || options.format === "money") n = n.int();
    if (options.min !== undefined) n = n.min(options.min);
    if (options.max !== undefined) n = n.max(options.max);
    out = n;
  }
  return out;
}

/**
 * The options that limit a value, as introspectable data. Undefined when none.
 * Only the options `constrain` (or the array builder) enforces for this type:
 * `field.string({ min: 10 })` validates nothing, so it advertises nothing.
 */
function constraintsOf(
  type: string,
  options: FieldOptions & { maxItems?: number },
): FieldConstraints | undefined {
  const out: FieldConstraints = {};
  if (type === "string" || type === "text") {
    if (options.maxLength !== undefined) out.maxLength = options.maxLength;
    if (options.pattern !== undefined) {
      out.pattern = options.pattern.source;
      if (options.pattern.flags) out.patternFlags = options.pattern.flags;
    }
  }
  if (type === "number") {
    if (options.min !== undefined) out.min = options.min;
    if (options.max !== undefined) out.max = options.max;
    if (options.int === true || options.format === "money") out.int = true;
    if (options.format === "money") out.currency = (options.currency ?? "USD").toUpperCase();
  }
  if (type === "array" && options.maxItems !== undefined) out.maxItems = options.maxItems;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Presentation metadata every builder carries the same way. */
function presentation(
  type: string,
  options: (FieldOptions & { maxItems?: number }) | undefined,
): Pick<FieldDefinition, "description" | "label" | "constraints" | "format"> {
  if (options === undefined) return {};
  const constraints = constraintsOf(type, options);
  return {
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(constraints ? { constraints } : {}),
    ...(options.format !== undefined ? { format: options.format } : {}),
  };
}

export function defineField<
  TType extends ScalarFieldType,
  const TOptions extends FieldOptions = Record<never, never>,
>(type: TType, options?: TOptions): FieldDefinition<MaybeOptional<ScalarZodMap[TType], TOptions>> {
  const optional = options?.optional ?? false;
  const base = constrain(type, BASE_ZOD[type](), options) as ScalarZodMap[TType];
  return {
    type,
    zod: (optional ? base.optional() : base) as MaybeOptional<ScalarZodMap[TType], TOptions>,
    optional,
    description: options?.description,
    ...presentation(type, options),
  };
}

/** One allowed value: a bare string, or a value with the label people see. */
export type SelectChoice = string | { value: string; label?: string };

type ChoiceValue<T> = T extends string ? T : T extends { value: infer V } ? V : never;

export interface SelectFieldOptions<TChoices extends readonly SelectChoice[]> extends Pick<
  FieldOptions,
  "optional" | "description" | "label"
> {
  /** The allowed values, in the order an editor sees them. At least one. */
  options: TChoices;
}

/**
 * One value from a fixed list: a product's status, a doc's section.
 *
 * A `string` with a description listing the allowed values only teaches the
 * reader; this one is enforced, and the Studio renders it as a choice instead
 * of a box someone can misspell into.
 */
export function defineSelectField<
  const TChoices extends readonly [SelectChoice, ...SelectChoice[]],
  const TOptions extends SelectFieldOptions<TChoices>,
>(
  options: TOptions & { options: TChoices },
): FieldDefinition<
  MaybeOptional<z.ZodEnum<{ [K in ChoiceValue<TChoices[number]>]: K }>, TOptions>
> {
  const optional = options.optional ?? false;
  const choices: SelectOption[] = options.options.map((choice) =>
    typeof choice === "string"
      ? { value: choice }
      : { value: choice.value, ...(choice.label !== undefined ? { label: choice.label } : {}) },
  );
  const values = choices.map((choice) => choice.value) as [string, ...string[]];
  const base = z.enum(values);
  return {
    type: "select",
    zod: (optional ? base.optional() : base) as never,
    optional,
    description: options.description,
    ...presentation("select", options),
    options: choices,
  };
}

export interface ReferenceFieldOptions extends Pick<
  FieldOptions,
  "optional" | "description" | "label"
> {
  /** The collection the referenced document lives in. */
  to: string;
}

/**
 * The slug of a document in another collection: a product's category, a
 * post's author. Stored as the bare slug so the file stays readable, and
 * declared as a reference so the Studio offers a picker and an agent knows
 * where to look the value up.
 */
export function defineReferenceField<const TOptions extends ReferenceFieldOptions>(
  options: TOptions,
): FieldDefinition<MaybeOptional<z.ZodString, TOptions>> {
  const optional = options.optional ?? false;
  const base = z
    .string()
    .regex(SLUG_RE, `must be the slug of a document in "${options.to}", e.g. "summer-sale"`);
  return {
    type: "reference",
    zod: (optional ? base.optional() : base) as MaybeOptional<z.ZodString, TOptions>,
    optional,
    description: options.description,
    ...presentation("reference", options),
    to: options.to,
  };
}

export interface ObjectFieldOptions extends FieldOptions {
  fields: Record<string, FieldDefinition>;
}

export interface ArrayFieldOptions extends FieldOptions {
  of: FieldDefinition;
  /**
   * Maximum element count.
   *
   * An uncapped array is a per-request amplifier: one call carrying tens of
   * thousands of entries can drive that many database round-trips before
   * anything rejects it.
   */
  maxItems?: number;
}

type FieldsToZodShape<TFields extends Record<string, FieldDefinition>> = {
  [K in keyof TFields]: TFields[K]["zod"];
};

/** Nested object field — builds a Zod object from child field defs. */
export function defineObjectField<
  const TFields extends Record<string, FieldDefinition>,
  const TOptions extends { optional?: boolean; description?: string; label?: string } = Record<
    never,
    never
  >,
>(
  options: { fields: TFields } & TOptions,
): FieldDefinition<MaybeOptional<z.ZodObject<FieldsToZodShape<TFields>>, TOptions>> {
  const optional = options.optional ?? false;
  const shape = Object.fromEntries(
    Object.entries(options.fields).map(([key, def]) => [key, def.zod]),
  ) as FieldsToZodShape<TFields>;
  const base = z.object(shape);
  return {
    type: "object",
    zod: (optional ? base.optional() : base) as MaybeOptional<
      z.ZodObject<FieldsToZodShape<TFields>>,
      TOptions
    >,
    optional,
    description: options.description,
    ...presentation("object", options),
    fields: options.fields,
  };
}

/** Array field — items validated by the nested field def. */
export function defineArrayField<
  TItemZod extends z.ZodType,
  const TOptions extends {
    optional?: boolean;
    description?: string;
    label?: string;
    maxItems?: number;
  } = Record<never, never>,
>(
  options: { of: FieldDefinition<TItemZod> } & TOptions,
): FieldDefinition<MaybeOptional<z.ZodArray<TItemZod>, TOptions>> {
  const optional = options.optional ?? false;
  const base =
    options.maxItems === undefined
      ? z.array(options.of.zod)
      : z.array(options.of.zod).max(options.maxItems);
  return {
    type: "array",
    zod: (optional ? base.optional() : base) as MaybeOptional<z.ZodArray<TItemZod>, TOptions>,
    optional,
    description: options.description,
    ...presentation("array", options),
    items: options.of,
  };
}

/**
 * Introspection shape for one field (recursive for object/array). Used by
 * defineCollection.describe and defineFunction.describe so MCP sees nesting.
 */
export function toFieldDescriptor(name: string, def: FieldDefinition): FieldDescriptor {
  return {
    name,
    type: def.type,
    optional: def.optional,
    description: def.description,
    // Only present keys: describe_schema output stays as small as it was for
    // a field that declares none of these.
    ...(def.label !== undefined ? { label: def.label } : {}),
    ...(def.constraints !== undefined ? { constraints: def.constraints } : {}),
    ...(def.options !== undefined ? { options: def.options } : {}),
    ...(def.to !== undefined ? { to: def.to } : {}),
    ...(def.format !== undefined ? { format: def.format } : {}),
    fields: def.fields
      ? Object.entries(def.fields).map(([n, d]) => toFieldDescriptor(n, d))
      : undefined,
    items: def.items ? toFieldDescriptor("item", def.items) : undefined,
  };
}

/** Ergonomic builders: `field.string()`, `field.object({ fields: … })`, … */
export const field = {
  string: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("string", o),
  text: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("text", o),
  number: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("number", o),
  boolean: <const O extends FieldOptions = Record<never, never>>(o?: O) =>
    defineField("boolean", o),
  datetime: <const O extends FieldOptions = Record<never, never>>(o?: O) =>
    defineField("datetime", o),
  json: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("json", o),
  asset: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("asset", o),
  select: defineSelectField,
  reference: defineReferenceField,
  // Keep the same generic signatures as defineObjectField / defineArrayField —
  // wrapping through ObjectFieldOptions/ArrayFieldOptions erases element types
  // to ZodType<unknown> in the emitted .d.ts.
  object: defineObjectField,
  array: defineArrayField,
};
