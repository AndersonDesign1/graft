/**
 * explain_error — the self-teaching recovery surface.
 *
 * Turns a GraftError code into what it means and how to recover, so an agent can act on a failure without a human translating it.
 */
import { z } from "zod";
import { ERROR_KNOWLEDGE, explainCode } from "../explain";
import { guarded } from "../tool-result";
import { READS } from "./annotations";
import type { RegisterTools } from "./deps";

export const registerErrorTools: RegisterTools = (server, deps) => {
  void deps;

  server.registerTool(
    "explain_error",
    {
      title: "Explain a Graft error",
      annotations: READS,
      description:
        "Given a GraftError code or its JSON, explain what it means, its typical causes, and how to recover. Use whenever a tool call or compile fails.",
      inputSchema: {
        code: z.string().optional().describe("An error code, e.g. SCHEMA_VALIDATION_FAILED"),
        error: z.string().optional().describe("A full GraftError JSON string, if you have one"),
      },
    },
    ({ code, error }) =>
      guarded(() => {
        let parsed: { error?: string; fix?: string; message?: string } | undefined;
        if (error) {
          try {
            parsed = JSON.parse(error);
          } catch {
            /* not JSON — fall through to the code path */
          }
        }
        const effective = code ?? parsed?.error;
        if (!effective) {
          return {
            knownCodes: Object.keys(ERROR_KNOWLEDGE),
            hint: "Pass `code` or the GraftError JSON as `error`.",
          };
        }
        const explanation = explainCode(effective);
        if (!explanation) {
          return {
            code: effective,
            known: false,
            knownCodes: Object.keys(ERROR_KNOWLEDGE),
            hint: "Not a Graft error code. If this came from another system, resolve it there.",
          };
        }
        return {
          ...explanation,
          // The specific fix from the actual error beats the general recovery advice.
          specificFix: parsed?.fix,
          message: parsed?.message,
        };
      }),
  );
};
