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

export const FieldDescriptor = z.object({
  name: z.string(),
  type: z.string(),
  optional: z.boolean().default(false),
  description: z.string().optional(),
});
export type FieldDescriptor = z.infer<typeof FieldDescriptor>;

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
});
export type FunctionDescriptor = z.infer<typeof FunctionDescriptor>;

export const SchemaDescription = z.object({
  collections: z.array(CollectionDescriptor),
  functions: z.array(FunctionDescriptor),
});
export type SchemaDescription = z.infer<typeof SchemaDescription>;
