/**
 * Introspection — what this project contains and how to call it.
 *
 * Everything an agent needs to teach itself the schema before touching it.
 */
import { GraftError, type SchemaDescription } from "@usegraft/contracts";
import { z } from "zod";
import { teachAssetFields } from "../tool-helpers";
import { guarded } from "../tool-result";
import { READS } from "./annotations";
import type { RegisterTools } from "./deps";

export const registerIntrospectionTools: RegisterTools = (server, deps) => {
  const { branchId, collections, functions, functionsByName } = deps;

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      annotations: READS,
      description:
        "List every registered content collection (name, description, authority, field count). Start here to learn what kinds of content this project has.",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        branch: branchId,
        collections: Object.values(collections).map((collection) => {
          const descriptor = collection.describe();
          return {
            name: descriptor.name,
            description: descriptor.description,
            authority: descriptor.authority,
            fields: descriptor.fields.length,
          };
        }),
      })),
  );

  server.registerTool(
    "describe_schema",
    {
      title: "Describe the content schema",
      annotations: READS,
      description:
        "Full schema introspection: every collection with its typed fields (name, type, optional, description), plus every registered function (kind, args, public/destructive). Documents also accept an optional kebab-case `slug` (defaults to the filename). Prefer list_functions / describe_function when you only need the function surface.",
      inputSchema: {},
    },
    () =>
      guarded((): SchemaDescription => {
        return {
          collections: Object.values(collections).map((collection) => {
            const descriptor = collection.describe();
            return { ...descriptor, fields: descriptor.fields.map(teachAssetFields) };
          }),
          functions: [...functionsByName.values()].map((fn) => fn.describe()),
        };
      }),
  );

  server.registerTool(
    "list_functions",
    {
      title: "List functions",
      annotations: READS,
      description:
        "List every registered typed function (name, kind, public, destructive, short description). Use describe_function for the full input schema, then run_function to invoke. Mutations reject anonymous callers unless public: true; destructive functions always require human approval (graft approve).",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        branch: branchId,
        functions: [...functionsByName.values()].map((fn) => {
          const d = fn.describe();
          return {
            name: d.name,
            kind: d.kind,
            description: d.description,
            public: d.public,
            destructive: d.destructive,
            args: d.args.length,
          };
        }),
      })),
  );

  server.registerTool(
    "describe_function",
    {
      title: "Describe one function",
      annotations: READS,
      description:
        "Full introspection for one function: kind, args (name/type/optional/description), returns, public, destructive. Use this before run_function so the input object matches the schema.",
      inputSchema: {
        name: z.string().describe("Function name as returned by list_functions"),
      },
    },
    ({ name }) =>
      guarded(() => {
        const fn = functionsByName.get(name);
        if (!fn) {
          throw new GraftError({
            code: "FUNCTION_NOT_FOUND",
            message: `No function named "${name}" is registered.`,
            fix: `Call list_functions and use one of: ${[...functionsByName.keys()].join(", ") || "(none registered)"}.`,
            details: { requested: name, available: [...functionsByName.keys()] },
          });
        }
        return fn.describe();
      }),
  );
};
