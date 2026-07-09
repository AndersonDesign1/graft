/**
 * Introspection contracts — the single source of truth for what the MCP
 * `describe_schema` tool returns, so the MCP server, CLI, and core all agree on
 * shape. Zod gives us runtime validation and the inferred TypeScript types from
 * one definition (the "one Zod layer" principle).
 */
import { z } from "zod";

export const ContentAuthority = z.enum([
  "file-authoritative",
  "db-authoritative",
  "hybrid-with-drift-detection",
]);
export type ContentAuthority = z.infer<typeof ContentAuthority>;

/**
 * Field introspection — recursive so object/array fields expose their shape
 * to agents (describe_schema), not opaque "json" blobs.
 */
export type FieldDescriptor = {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
  /** Nested fields when type is `object`. */
  fields?: FieldDescriptor[];
  /** Item shape when type is `array` (name is conventionally `"item"`). */
  items?: FieldDescriptor;
};

export const FieldDescriptor: z.ZodType<FieldDescriptor> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.string(),
    optional: z.boolean().default(false),
    description: z.string().optional(),
    fields: z.array(FieldDescriptor).optional(),
    items: FieldDescriptor.optional(),
  }),
);

export const CollectionDescriptor = z.object({
  name: z.string(),
  authority: ContentAuthority,
  fields: z.array(FieldDescriptor),
  description: z.string().optional(),
});
export type CollectionDescriptor = z.infer<typeof CollectionDescriptor>;

export const FunctionDescriptor = z.object({
  name: z.string(),
  kind: z.enum(["query", "mutation"]),
  args: z.array(FieldDescriptor),
  returns: z.string().optional(),
  description: z.string().optional(),
  /** Anonymous callers allowed. Mutations default to false; queries to true. */
  public: z.boolean().optional(),
  /** Always human-gated: invoking it requires an approved, one-shot, input-bound approval. */
  destructive: z.boolean().optional(),
});
export type FunctionDescriptor = z.infer<typeof FunctionDescriptor>;

export const SchemaDescription = z.object({
  collections: z.array(CollectionDescriptor),
  functions: z.array(FunctionDescriptor),
});
export type SchemaDescription = z.infer<typeof SchemaDescription>;
