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
  /** The same payload as data, for clients that speak MCP 2025-06-18 or later. */
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Every tool already returns a JS object and every tool serialised it to a
 * string, so each caller had to parse the prose back into the shape it started
 * as. `structuredContent` hands over the object itself.
 *
 * Only objects. The protocol types structured content as an object, and most
 * of these payloads already are one; a tool that answers with an array or a
 * scalar keeps the text form alone rather than being wrapped in an invented
 * key that would then be part of the contract.
 *
 * Safe to send unconditionally: the SDK validates structured content only for
 * a tool that declares an `outputSchema`, and a client that predates the field
 * ignores it and reads the text, which is unchanged.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function ok(payload: unknown): ToolResult {
  const result: ToolResult = {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
  if (isPlainObject(payload)) result.structuredContent = payload;
  return result;
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
