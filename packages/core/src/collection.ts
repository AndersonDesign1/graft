/**
 * defineCollection — the core "everything is code" primitive.
 *
 * A collection is a content type defined entirely in code: its fields (Zod), its
 * content-authority mode, and a describe() that yields a @graft/contracts
 * CollectionDescriptor so MCP `describe_schema` and the CLI all agree on shape.
 */
import type { CollectionDescriptor, ContentAuthority, FieldDescriptor } from "@graft/contracts";
import { z } from "zod";
import type { FieldDefinition } from "./field";

export interface CollectionConfig {
  name: string;
  /** Defaults to "file-authoritative" (authored content lives in git). */
  authority?: ContentAuthority;
  description?: string;
  fields: Record<string, FieldDefinition>;
}

export interface Collection {
  name: string;
  authority: ContentAuthority;
  description?: string;
  fields: Record<string, FieldDefinition>;
  /** Zod schema validating a full document's data for this collection. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** Introspection descriptor — the single source of truth for describe_schema. */
  describe(): CollectionDescriptor;
}

export function defineCollection(config: CollectionConfig): Collection {
  const authority: ContentAuthority = config.authority ?? "file-authoritative";

  const shape: z.ZodRawShape = {};
  for (const [key, def] of Object.entries(config.fields)) {
    shape[key] = def.zod;
  }
  const schema = z.object(shape);

  return {
    name: config.name,
    authority,
    description: config.description,
    fields: config.fields,
    schema,
    describe(): CollectionDescriptor {
      const fields: FieldDescriptor[] = Object.entries(config.fields).map(([name, def]) => ({
        name,
        type: def.type,
        optional: def.optional,
        description: def.description,
      }));
      return { name: config.name, authority, fields, description: config.description };
    },
  };
}
