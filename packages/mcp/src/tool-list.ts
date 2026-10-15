/**
 * `tools/list`, with each tool's schemas turned into JSON Schema by the zod
 * that built them.
 *
 * The SDK converts with the `zod/v4-mini` it resolves itself, and its range
 * (`^3.25 || ^4.0`) lets a package manager hand it the app's zod rather than
 * ours. A converter from zod 4.2 to 4.4 runs a 4.5 schema's own processor
 * with a context that processor doesn't recognize, and the whole listing
 * fails with "Cannot read properties of undefined (reading 'push')". Calling a
 * tool by name still works, so only discovery breaks, and with it every
 * standard client. Converting here, with this package's zod, keeps the two
 * the same version wherever the SDK's zod lands.
 *
 * The answer is the SDK's own, field for field; `tool-list.test.ts` holds the
 * two equal.
 */
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** What the SDK lists for a tool registered with no input schema. */
const EMPTY_OBJECT = { type: "object", properties: {} } as const;

/** A zod 4 schema, from this package's copy of zod or another's. */
function isZod(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value;
}

/**
 * What the SDK lists, decided as the SDK decides it: a raw shape
 * (`{ name: z.string() }`) becomes an object schema, an object schema stays
 * as it is, and anything else (an empty shape included) lists as
 * EMPTY_OBJECT.
 */
function objectSchema(schema: unknown): z.ZodType | undefined {
  if (isZod(schema)) return schema._zod.def.type === "object" ? schema : undefined;
  if (!schema || typeof schema !== "object") return undefined;
  const entries = Object.entries(schema);
  if (entries.length === 0 || !entries.every(([, value]) => isZod(value))) return undefined;
  return z.object(Object.fromEntries(entries));
}

function jsonSchema(schema: unknown, io: "input" | "output"): Tool["inputSchema"] | undefined {
  const object = objectSchema(schema);
  if (!object) return undefined;
  // SAFETY: an object schema converts to a JSON Schema whose `type` is "object".
  return z.toJSONSchema(object, { target: "draft-7", io }) as Tool["inputSchema"];
}

/**
 * Keep a handle on every tool registered from here on, and answer
 * `tools/list` from them. Call before the first registerTool, then call the
 * function it returns after the last.
 */
export function listToolsWithOwnZod(server: McpServer): () => void {
  const tools = new Map<string, RegisteredTool>();
  const registerTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: never, callback: never) => {
    const tool = registerTool(name, config, callback);
    let current = name;
    const update = tool.update.bind(tool);
    // A rename or a remove (an update to name null) moves the handle with it.
    tool.update = ((updates: Parameters<RegisteredTool["update"]>[0]) => {
      update(updates);
      if (updates.name === undefined) return;
      tools.delete(current);
      if (updates.name !== null) {
        current = updates.name;
        tools.set(current, tool);
      }
    }) as RegisteredTool["update"];
    tools.set(name, tool);
    return tool;
  }) as McpServer["registerTool"];

  return () => {
    if (tools.size === 0) return;
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [...tools]
        .filter(([, tool]) => tool.enabled)
        .map(([name, tool]): Tool => {
          const outputSchema = tool.outputSchema
            ? jsonSchema(tool.outputSchema, "output")
            : undefined;
          return {
            name,
            title: tool.title,
            description: tool.description,
            inputSchema: jsonSchema(tool.inputSchema, "input") ?? EMPTY_OBJECT,
            annotations: tool.annotations,
            execution: tool.execution,
            _meta: tool._meta,
            ...(outputSchema ? { outputSchema } : {}),
          };
        }),
    }));
  };
}
