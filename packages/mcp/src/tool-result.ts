/**
 * The shape a tool call answers with, and the guard every tool body runs behind.
 *
 * A GraftError crossing this boundary becomes an agent-actionable tool failure
 * carrying its `fix` and the recovery text from ERROR_KNOWLEDGE; anything else
 * is a real bug and keeps propagating.
 */
import { GraftError } from "@usegraft/contracts";
import { ERROR_KNOWLEDGE } from "./explain";

/**
 * A pointer to something the server also serves as a resource (MCP 2025-06-18).
 *
 * The point is that a client can follow it. A tool answering "here are eleven
 * documents" and leaving the client to reconstruct eleven URIs is asking it to
 * know the scheme; the link says where each one is.
 */
export interface ResourceLink {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | ResourceLink>;
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

export function ok(payload: unknown, links: readonly ResourceLink[] = []): ToolResult {
  const result: ToolResult = {
    // Text first: a client that ignores the rest still gets the whole answer.
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }, ...links],
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

/**
 * Run a tool body, translating GraftErrors into agent-actionable tool failures.
 *
 * `linksFor` derives resource links from the answer rather than taking them as
 * an argument, because they are a view of the payload — deriving them keeps a
 * link from ever naming a document the payload does not contain.
 */
export async function guarded<T>(
  body: () => Promise<T> | T,
  linksFor?: (payload: T) => readonly ResourceLink[],
): Promise<ToolResult> {
  try {
    const payload = await body();
    return ok(payload, linksFor?.(payload));
  } catch (error) {
    if (error instanceof GraftError) return fail(error);
    throw error;
  }
}

/**
 * The same guarantee for a resource read, which has no ToolResult to carry it.
 *
 * A tool failure is a value — `fail()` puts the code, the `fix` and the
 * recovery text in the body. A resource read has no such envelope: the SDK
 * turns a thrown error into a JSON-RPC error whose only human-readable field is
 * `message`, so a GraftError escaping raw arrives with its `fix` stripped off.
 * This repo's rule is that every error a caller sees carries the next action,
 * so the fix is folded into the message rather than lost.
 */
export async function guardedResource<T>(body: () => Promise<T> | T): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (!(error instanceof GraftError)) throw error;
    const explanation = ERROR_KNOWLEDGE[error.code];
    throw new Error(
      [error.message, error.fix && `Fix: ${error.fix}`, explanation?.howToRecover]
        .filter(Boolean)
        .join(" "),
      { cause: error },
    );
  }
}
