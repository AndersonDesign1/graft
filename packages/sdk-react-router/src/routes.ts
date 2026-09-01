/**
 * Mounting the Graft runtime in React Router v7 — a resource route (a route
 * module with no default export) returns raw Responses, and its `loader` and
 * `action` are already Web-standard, so the "adapter" is one property access:
 * React Router hands them a `{ request, params, context }` object, the
 * handlers want its `request`.
 *
 * ```ts
 * // app/routes/api.fn.$name.ts
 * import { createFunctionsHandler } from "@usegraft/core";
 * import { graftRoute } from "@usegraft/sdk-react-router";
 * const handler = createFunctionsHandler({ … });
 * export const action = graftRoute(handler);   // POST
 * export const loader = graftRoute(handler);   // GET → 405s with Allow + fix
 *
 * // app/routes/api.mcp.ts
 * import { createGraftMcpHandler } from "@usegraft/mcp";
 * export const action = graftRoute(createGraftMcpHandler({ … }));
 * ```
 *
 * React Router splits a route by method into two exports rather than naming
 * the method, so one handler is mounted twice: `action` takes POST and the
 * other mutating verbs, `loader` takes GET. Mounting `loader` is not
 * ceremony — it is what makes a GET to a function endpoint answer with Graft's
 * 405 and its `Allow` header instead of React Router's own "no loader" error,
 * which teaches the caller nothing.
 *
 * Typed structurally (`{ request: Request }`) so this package needs no
 * react-router dependency — every LoaderFunctionArgs and ActionFunctionArgs
 * satisfies it, including the per-route `Route.LoaderArgs` types React Router
 * generates.
 */

export type FetchHandler = (request: Request) => Promise<Response>;

/** A React Router loader or action (or anything args-shaped) over a Graft handler. */
export function graftRoute(handler: FetchHandler) {
  return (args: { request: Request }): Promise<Response> => handler(args.request);
}
