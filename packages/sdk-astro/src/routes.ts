/**
 * Mounting the Graft runtime in Astro — endpoints are already Web-standard,
 * so the "adapter" is one property access: Astro hands an APIContext, the
 * handlers want its `request`.
 *
 * ```ts
 * // src/pages/api/fn/[name].ts
 * import { createFunctionsHandler } from "@usegraft/core";
 * import { graftRoute } from "@usegraft/sdk-astro";
 * const handler = createFunctionsHandler({ … });
 * export const POST = graftRoute(handler);
 * export const GET = graftRoute(handler);   // 405s with Allow + fix
 *
 * // src/pages/api/mcp.ts
 * import { createGraftMcpHandler } from "@usegraft/mcp";
 * export const POST = graftRoute(createGraftMcpHandler({ … }));
 * ```
 *
 * Typed structurally (`{ request: Request }`) so this package needs no astro
 * dependency — every APIContext satisfies it.
 */

export type FetchHandler = (request: Request) => Promise<Response>;

/** An Astro APIRoute (or anything context-shaped) over a Graft handler. */
export function graftRoute(handler: FetchHandler) {
  return (context: { request: Request }): Promise<Response> => handler(context.request);
}
