/**
 * Mounting the Graft runtime in SvelteKit — `+server.ts` endpoints are
 * already Web-standard, so the "adapter" is one property access: SvelteKit
 * hands a RequestEvent, the handlers want its `request`.
 *
 * ```ts
 * // src/routes/api/fn/[name]/+server.ts
 * import { createFunctionsHandler } from "@graft/core";
 * import { graftRoute } from "@graft/sdk-sveltekit";
 * const handler = createFunctionsHandler({ … });
 * export const POST = graftRoute(handler);
 * export const GET = graftRoute(handler);   // 405s with Allow + fix
 *
 * // src/routes/api/mcp/+server.ts
 * import { createGraftMcpHandler } from "@graft/mcp";
 * export const POST = graftRoute(createGraftMcpHandler({ … }));
 * ```
 *
 * Typed structurally (`{ request: Request }`) so this package needs no
 * @sveltejs/kit dependency — every RequestEvent satisfies it.
 */

export type FetchHandler = (request: Request) => Promise<Response>;

/** A SvelteKit RequestHandler (or anything event-shaped) over a Graft handler. */
export function graftRoute(handler: FetchHandler) {
  return (event: { request: Request }): Promise<Response> => handler(event.request);
}
