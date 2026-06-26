/**
 * Field definitions — the typed building blocks of a collection.
 *
 * Each field maps to a Zod schema (the single validation layer) plus the metadata
 * the compiler and MCP introspection need. Authored as code; edited by agents.
 */
import { z } from "zod";

export type FieldType = "string" | "text" | "number" | "boolean" | "datetime" | "json";

export interface FieldOptions {
  optional?: boolean;
  description?: string;
}

export interface FieldDefinition {
  type: FieldType;
  /** Zod schema validating this field's value. */
  zod: z.ZodTypeAny;
  optional: boolean;
  description?: string;
}

const BASE_ZOD: Record<FieldType, () => z.ZodTypeAny> = {
  string: () => z.string(),
  text: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  datetime: () => z.string().datetime(),
  json: () => z.record(z.unknown()),
};

export function defineField(type: FieldType, options: FieldOptions = {}): FieldDefinition {
  const optional = options.optional ?? false;
  const base = BASE_ZOD[type]();
  return {
    type,
    zod: optional ? base.optional() : base,
    optional,
    description: options.description,
  };
}

/** Ergonomic builders: `field.string()`, `field.number({ optional: true })`, … */
export const field = {
  string: (o?: FieldOptions) => defineField("string", o),
  text: (o?: FieldOptions) => defineField("text", o),
  number: (o?: FieldOptions) => defineField("number", o),
  boolean: (o?: FieldOptions) => defineField("boolean", o),
  datetime: (o?: FieldOptions) => defineField("datetime", o),
  json: (o?: FieldOptions) => defineField("json", o),
} as const;
