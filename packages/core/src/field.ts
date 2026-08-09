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
import type { FieldDescriptor } from "@usegraft/contracts";
import { z } from "zod";

export type ScalarFieldType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "datetime"
  | "json"
  | "asset";

export type FieldType = ScalarFieldType | "object" | "array";

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
}

export interface FieldDefinition<TZod extends z.ZodType = z.ZodType> {
  type: FieldType;
  /** Zod schema validating this field's value. */
  zod: TZod;
  optional: boolean;
  description?: string;
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

export function defineField<
  TType extends ScalarFieldType,
  const TOptions extends FieldOptions = Record<never, never>,
>(type: TType, options?: TOptions): FieldDefinition<MaybeOptional<ScalarZodMap[TType], TOptions>> {
  const optional = options?.optional ?? false;
  const base = BASE_ZOD[type]();
  return {
    type,
    zod: (optional ? base.optional() : base) as MaybeOptional<ScalarZodMap[TType], TOptions>,
    optional,
    description: options?.description,
  };
}

export interface ObjectFieldOptions extends FieldOptions {
  fields: Record<string, FieldDefinition>;
}

export interface ArrayFieldOptions extends FieldOptions {
  of: FieldDefinition;
}

type FieldsToZodShape<TFields extends Record<string, FieldDefinition>> = {
  [K in keyof TFields]: TFields[K]["zod"];
};

/** Nested object field — builds a Zod object from child field defs. */
export function defineObjectField<
  const TFields extends Record<string, FieldDefinition>,
  const TOptions extends { optional?: boolean; description?: string } = Record<never, never>,
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
    fields: options.fields,
  };
}

/** Array field — items validated by the nested field def. */
export function defineArrayField<
  TItemZod extends z.ZodType,
  const TOptions extends { optional?: boolean; description?: string } = Record<never, never>,
>(
  options: { of: FieldDefinition<TItemZod> } & TOptions,
): FieldDefinition<MaybeOptional<z.ZodArray<TItemZod>, TOptions>> {
  const optional = options.optional ?? false;
  const base = z.array(options.of.zod);
  return {
    type: "array",
    zod: (optional ? base.optional() : base) as MaybeOptional<z.ZodArray<TItemZod>, TOptions>,
    optional,
    description: options.description,
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
  // Keep the same generic signatures as defineObjectField / defineArrayField —
  // wrapping through ObjectFieldOptions/ArrayFieldOptions erases element types
  // to ZodType<unknown> in the emitted .d.ts.
  object: defineObjectField,
  array: defineArrayField,
};
