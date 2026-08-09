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
  /**
   * Reading order for the collection's `section` values, when it groups.
   *
   * Section order is editorial — "Start here" before "Reference" — and there
   * is nothing in the content to infer it from, since `order` restarts within
   * each section. Declaring it on the collection means the site nav and any
   * tool that lists content (Studio, agents) sort identically instead of each
   * inventing an order. Sections not listed sort last, so new content never
   * disappears from a sidebar.
   */
  sections: z.array(z.string()).optional(),
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

/**
 * Registry introspection — the shape the MCP `list_registry` / `describe_item`
 * tools return so agents can browse owned primitives before `graft add`.
 *
 * The vocabulary here mirrors @usegraft/registry's authoring manifest (ITEM_TYPES /
 * FILE_ROLES); a drift test in @usegraft/registry keeps the two in lockstep so this
 * stays the single introspection source of truth without contracts depending on
 * registry.
 */
export const RegistryItemType = z.enum(["block", "field", "access", "bundle"]);
export type RegistryItemType = z.infer<typeof RegistryItemType>;

export const RegistryFileRole = z.enum(["module", "component", "content", "env"]);
export type RegistryFileRole = z.infer<typeof RegistryFileRole>;

/** One file an item writes — the target path (relative to project root) and its role. */
export const RegistryFileDescriptor = z.object({
  target: z.string(),
  role: RegistryFileRole,
});
export type RegistryFileDescriptor = z.infer<typeof RegistryFileDescriptor>;

/**
 * Agent-facing description of one owned primitive. Deliberately omits the
 * machine-specific absolute `dir` a loaded item carries — this is the wire shape.
 */
export const RegistryItemDescriptor = z.object({
  name: z.string(),
  type: RegistryItemType,
  description: z.string(),
  /** Semver range against @usegraft/core; "*" = any (pre-1.0 default). */
  graftVersion: z.string(),
  /** npm packages the target must install first (package → version range). */
  dependencies: z.record(z.string(), z.string()),
  /** Other registry items `graft add` pulls in first (transitive). */
  registryDependencies: z.array(z.string()),
  /** The files this item writes into the project. */
  files: z.array(RegistryFileDescriptor),
  /** Whether the item ships an llms.txt teaching fragment. */
  llms: z.boolean(),
});
export type RegistryItemDescriptor = z.infer<typeof RegistryItemDescriptor>;
