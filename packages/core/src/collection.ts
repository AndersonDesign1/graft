/**
 * defineCollection — the core "everything is code" primitive.
 *
 * A collection is a content type defined entirely in code: its fields (Zod), its
 * content-authority mode, and a describe() that yields a @graft/contracts
 * CollectionDescriptor so MCP `describe_schema` and the CLI all agree on shape.
 *
 * The collection is generic over its fields, so the document type is inferred —
 * `DocumentData<typeof posts>` is the exact frontmatter shape, no codegen needed.
 */
import type { CollectionDescriptor, ContentAuthority } from "@graft/contracts";
import { z } from "zod";
import { toFieldDescriptor, type FieldDefinition } from "./field";

/** The Zod object shape derived from a fields record. */
export type FieldsShape<TFields extends Record<string, FieldDefinition>> = {
  [K in keyof TFields]: TFields[K]["zod"];
};

/**
 * Plain data inferred field-by-field (same result as z.infer of the collection
 * schema when field.object/array keep their generics — see field.ts).
 */
export type InferFieldsData<TFields extends Record<string, FieldDefinition>> = {
  [K in keyof TFields]: z.infer<TFields[K]["zod"]>;
};

export interface CollectionConfig<
  TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
> {
  name: string;
  /** Defaults to "file-authoritative" (authored content lives in git). */
  authority?: ContentAuthority;
  description?: string;
  fields: TFields;
}

export interface Collection<
  TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
> {
  name: string;
  authority: ContentAuthority;
  description?: string;
  fields: TFields;
  /** Zod schema validating a full document's data for this collection. */
  schema: z.ZodObject<FieldsShape<TFields>>;
  /** Introspection descriptor — the single source of truth for describe_schema. */
  describe(): CollectionDescriptor;
}

/**
 * A collection with any field shape — use this (not `Collection`) when accepting
 * heterogeneous collections, e.g. `Record<string, AnyCollection>` in the compiler.
 * Concrete `Collection<…>` instances are not assignable to the bare default
 * (`ZodObject` is invariant enough to reject it), but they all satisfy `any`.
 */
// oxlint-disable-next-line no-explicit-any
export type AnyCollection = Collection<any>;

/** The inferred document data type for a collection: `DocumentData<typeof posts>`. */
export type DocumentData<TCollection extends AnyCollection> = z.infer<TCollection["schema"]>;

export function defineCollection<TFields extends Record<string, FieldDefinition>>(
  config: CollectionConfig<TFields>,
): Collection<TFields> {
  const authority: ContentAuthority = config.authority ?? "file-authoritative";

  const shape = Object.fromEntries(
    Object.entries(config.fields).map(([key, def]) => [key, def.zod]),
  ) as FieldsShape<TFields>;
  const schema = z.object(shape);

  return {
    name: config.name,
    authority,
    description: config.description,
    fields: config.fields,
    schema,
    describe(): CollectionDescriptor {
      const fields = Object.entries(config.fields).map(([name, def]) =>
        toFieldDescriptor(name, def),
      );
      return { name: config.name, authority, fields, description: config.description };
    },
  };
}
