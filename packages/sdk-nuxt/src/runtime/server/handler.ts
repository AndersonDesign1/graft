/**
 * A Graft handler built on first request, for the routes the module mounts.
 *
 * Building one opens the storage engine, which can fail on configuration: no
 * database URL, a missing static index, Postgres needed and not configured.
 * That arrives as a GraftError with a `fix`, answered as JSON instead of the
 * framework's bare 500. A failed build is forgotten, so the request after the
 * fix succeeds without a restart.
 */
import { GraftError } from "@usegraft/contracts";
import type { FetchHandler } from "@usegraft/sdk-nitro";

export function lazyHandler(build: () => Promise<FetchHandler>): FetchHandler {
  let built: Promise<FetchHandler> | undefined;
  return async (request) => {
    built ??= build().catch((error: unknown) => {
      built = undefined;
      throw error;
    });
    let handler: FetchHandler;
    try {
      handler = await built;
    } catch (error) {
      if (!(error instanceof GraftError)) throw error;
      return Response.json(error.toJSON(), { status: 503 });
    }
    return handler(request);
  };
}

/**
 * The per-caller backstop `graft serve` gives both writing routes. A
 * function's own `rateLimit` overrides it, and the same cap applies whether a
 * function is called over /api/fn or MCP's run_function.
 */
export const RATE_LIMIT = { limit: 60, windowSeconds: 60 };
