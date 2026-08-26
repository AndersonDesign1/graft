/**
 * The shape a tool call answers with, and the guard every tool body runs behind.
 *
 * A GraftError crossing this boundary becomes an agent-actionable tool failure
 * carrying its `fix` and the recovery text from ERROR_KNOWLEDGE; anything else
 * is a real bug and keeps propagating.
 */
import { GraftError } from "@usegraft/contracts";
import { ERROR_KNOWLEDGE } from "./explain";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export function fail(error: GraftError): ToolResult {
  const explanation = ERROR_KNOWLEDGE[error.code];
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { ...error.toJSON(), howToRecover: explanation.howToRecover },
          null,
          2,
        ),
      },
    ],
  };
}

/** Run a tool body, translating GraftErrors into agent-actionable tool failures. */
export async function guarded<T>(body: () => Promise<T> | T): Promise<ToolResult> {
  try {
    return ok(await body());
  } catch (error) {
    if (error instanceof GraftError) return fail(error);
    throw error;
  }
}
