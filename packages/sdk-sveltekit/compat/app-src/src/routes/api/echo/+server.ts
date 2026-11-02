// What graftRoute hands a handler: SvelteKit's own Request, method, headers
// and body intact.
import { graftRoute } from "@usegraft/sdk-sveltekit";
import type { RequestHandler } from "./$types";

const echo = async (request: Request) =>
  Response.json({
    method: request.method,
    url: new URL(request.url).pathname,
    header: request.headers.get("x-graft"),
    body: await request.text(),
  });

// Annotated, so svelte-check holds graftRoute to this SvelteKit's RequestHandler.
export const GET: RequestHandler = graftRoute(echo);
export const POST: RequestHandler = graftRoute(echo);
