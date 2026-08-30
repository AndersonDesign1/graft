/**
 * run_function — typed function invocation over MCP.
 *
 * Routes through the same createFunctionsHandler pipeline POST /api/fn/<name> takes, so access rules, rate limits, audit and the human gate all apply identically.
 */
import { GraftError } from "@usegraft/contracts";
import { z } from "zod";
import { invokeFunction } from "../tool-helpers";
import { guarded } from "../tool-result";
import { DESTROYS } from "./annotations";
import type { RegisterTools } from "./deps";

export const registerFunctionTools: RegisterTools = (server, deps) => {
  const { functions, functionsByName, getFunctionsHandler, options } = deps;

  server.registerTool(
    "run_function",
    {
      title: "Run a typed function",
      annotations: DESTROYS,
      description:
        "Invoke a defineFunction by name with a JSON input object. Same pipeline as POST /api/fn/<name>: Zod validation, access rules, rate limits, audit log, and the human gate for destructive ops. The server may already act with a configured identity (graft mcp uses GRAFT_DEV_TOKEN; over HTTP your connection's bearer is forwarded) — only pass authorization to override it. Pass approval after a human runs `graft approve <id>` for gated calls. Success returns { data, correlationId }; failures are GraftError JSON with a fix.",
      inputSchema: {
        name: z.string().describe("Function name (defineFunction name, not the export key)"),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Input fields object; defaults to {}. See describe_function for the schema."),
        authorization: z
          .string()
          .optional()
          .describe(
            "Bearer token override (with or without the 'Bearer ' prefix). Usually unnecessary — the server's configured identity applies when omitted.",
          ),
        approval: z
          .string()
          .optional()
          .describe(
            "Approval id from a prior DESTRUCTIVE_OP_REQUIRES_APPROVAL response (after `graft approve <id>`).",
          ),
      },
    },
    ({ name, input, authorization, approval }) =>
      guarded(async () => {
        if (functionsByName.size === 0) {
          throw new GraftError({
            code: "FUNCTION_NOT_FOUND",
            message: "This MCP server has no functions registered.",
            fix: "Export `functions` from graft.config.ts (defineFunction results, often via mergePrimitives) and restart the MCP server / pass them to createGraftMcp({ functions }).",
            details: { requested: name, available: [] },
          });
        }
        if (!functionsByName.has(name)) {
          throw new GraftError({
            code: "FUNCTION_NOT_FOUND",
            message: `No function named "${name}" is registered.`,
            fix: `Call list_functions and use one of: ${[...functionsByName.keys()].join(", ")}.`,
            details: { requested: name, available: [...functionsByName.keys()] },
          });
        }

        // Explicit tool-arg override beats the server's configured identity.
        return invokeFunction(getFunctionsHandler(), name, input ?? {}, {
          credential: authorization ?? options.defaultAuthorization,
          approval,
        });
      }),
  );
};
