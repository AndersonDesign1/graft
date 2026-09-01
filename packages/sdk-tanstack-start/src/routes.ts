/**
 * Mounting the Graft runtime in TanStack Start — server routes are already
 * Web-standard, so the "adapter" is one property access: Start hands the
 * method handler a context object, the handlers want its `request`.
 *
 * ```ts
 * // src/routes/api/fn/$name.ts
 * import { createServerFileRoute } from "@tanstack/react-start/server";
 * import { createFunctionsHandler } from "@usegraft/core";
 * import { graftRoute } from "@usegraft/sdk-tanstack-start";
 * const handler = createFunctionsHandler({ … });
 * export const ServerRoute = createServerFileRoute("/api/fn/$name").methods({
 *   POST: graftRoute(handler),
 *   GET: graftRoute(handler),   // 405s with Allow + fix
 * });
 *
 * // src/routes/api/mcp.ts
 * import { createGraftMcpHandler } from "@usegraft/mcp";
 * export const ServerRoute = createServerFileRoute("/api/mcp").methods({
 *   POST: graftRoute(createGraftMcpHandler({ … })),
 * });
 * ```
 *
 * The name of the server-route factory has moved around across TanStack Start
 * releases. What has not moved is the handler signature: an object carrying a
 * Web `Request`. That is the whole contract `graftRoute` needs, which is why it
 * is typed structurally (`{ request: Request }`) and why this package needs no
 * @tanstack/react-start dependency.
 */

export type FetchHandler = (request: Request) => Promise<Response>;

/** A TanStack Start server-route method handler over a Graft handler. */
export function graftRoute(handler: FetchHandler) {
  return (context: { request: Request }): Promise<Response> => handler(context.request);
}
