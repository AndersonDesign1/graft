/**
 * Field definitions — the typed building blocks of a collection.
 *
 * Each field maps to a Zod schema (the single validation layer) plus the metadata
 * the compiler and MCP introspection need. Authored as code; edited by agents.
 *
 * FieldDefinition is generic over its Zod schema so the concrete type
 * (ZodString, ZodOptional<ZodNumber>, …) survives into defineCollection and from
 * there into z.infer — typed reads all the way down, with no codegen step.
 */
import { z } from "zod";

export type FieldType = "string" | "text" | "number" | "boolean" | "datetime" | "json";

/** Any JSON-serializable value — what a `json` field validates and infers to. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
}

/** The base Zod schema each field type produces. */
interface FieldZodMap {
  string: z.ZodString;
  text: z.ZodString;
  number: z.ZodNumber;
  boolean: z.ZodBoolean;
  datetime: z.ZodISODateTime;
  json: z.ZodType<JsonValue>;
}

const BASE_ZOD: { [T in FieldType]: () => FieldZodMap[T] } = {
  string: () => z.string(),
  text: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  datetime: () => z.iso.datetime(),
  json: () => jsonValue,
};

type MaybeOptional<TZod extends z.ZodType, TOptions extends FieldOptions> = TOptions extends {
  optional: true;
}
  ? z.ZodOptional<TZod>
  : TZod;

export function defineField<
  TType extends FieldType,
  const TOptions extends FieldOptions = Record<never, never>,
>(type: TType, options?: TOptions): FieldDefinition<MaybeOptional<FieldZodMap[TType], TOptions>> {
  const optional = options?.optional ?? false;
  const base = BASE_ZOD[type]();
  return {
    type,
    zod: (optional ? base.optional() : base) as MaybeOptional<FieldZodMap[TType], TOptions>,
    optional,
    description: options?.description,
  };
}

/** Ergonomic builders: `field.string()`, `field.number({ optional: true })`, … */
export const field = {
  string: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("string", o),
  text: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("text", o),
  number: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("number", o),
  boolean: <const O extends FieldOptions = Record<never, never>>(o?: O) =>
    defineField("boolean", o),
  datetime: <const O extends FieldOptions = Record<never, never>>(o?: O) =>
    defineField("datetime", o),
  json: <const O extends FieldOptions = Record<never, never>>(o?: O) => defineField("json", o),
} as const;
