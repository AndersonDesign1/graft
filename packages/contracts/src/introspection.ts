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

export const RegistryFileRole = z.enum(["module", "component", "content", "env", "editor"]);
export type RegistryFileRole = z.infer<typeof RegistryFileRole>;

/**
 * How a component presents in the Studio canvas — the editor's half of an
 * owned primitive.
 *
 * Data, not code, and that is the load-bearing decision. The Studio ships as a
 * prebuilt bundle with no bundler in the loop, so it cannot import a component
 * from the project and render it; the only other way to let a third party
 * control presentation would be to evaluate code they authored inside the
 * editor, which is not a thing to ship. A declaration the editor interprets
 * keeps the extension point open without that.
 *
 * It is copied into the project by `graft add`, exactly like the component it
 * describes: owned, editable, no runtime dependency on the registry it came
 * from. Renaming a prop means editing a file you already have.
 *
 * Everything is optional. A component with no declaration still renders — it
 * gets the generic card, which is what every component got before this existed.
 */
export const EditorComponentSpec = z.object({
  /** The JSX name this describes, e.g. "Callout". */
  component: z.string().min(1),
  /** Display name for the card's chip. Defaults to `component`. */
  label: z.string().min(1).optional(),
  /** Prop to show as the card's heading instead of guessing. */
  titleProp: z.string().optional(),
  /** Prop holding a destination, shown as a chip. */
  linkProp: z.string().optional(),
  /**
   * Colour the card by one of its props — `type="warning"` on a Callout should
   * look like a warning. Values map to the editor's own tone roles, so a
   * third-party component cannot introduce a colour the theme does not have.
   */
  tone: z
    .object({
      prop: z.string().min(1),
      map: z.record(z.string(), z.enum(["info", "warn", "danger", "success", "neutral"])),
    })
    .optional(),
  /** Props already implied by the card's shape, not worth listing again. */
  hideProps: z.array(z.string()).default([]),
  /** Declarations for the children this component expects, e.g. DocCard inside DocCards. */
  children: z.array(z.string()).default([]),
  /**
   * The exact MDX inserted when the operator picks this component from the
   * palette. Authored by whoever wrote the component, because only they know
   * which props are required and what a sensible starting body is — a guess
   * assembled from the other fields would produce blocks that do not compile.
   * Without one the component is still rendered, just not offered for insert.
   *
   * **Put the opening tag on a line of its own.** Markdown only treats JSX as
   * one HTML *block* when nothing else shares the opening tag's line; write
   * `<Callout>text</Callout>` on a single line and remark splits it into an
   * open tag, a text node and a close tag, which renders as three pieces of
   * raw source rather than one card. Every authored component in this repo is
   * written the block way for exactly this reason.
   */
  snippet: z.string().min(1).optional(),
});
export type EditorComponentSpec = z.infer<typeof EditorComponentSpec>;

/** What `GET /api/studio/v1/editor-components` returns: the project's own declarations. */
export const EditorComponentList = z.object({ components: z.array(EditorComponentSpec) });
export type EditorComponentList = z.infer<typeof EditorComponentList>;

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
