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

/** Who is calling, from the runtime config, the same way `graft serve` decides. */
export function actorOptions(runtime: {
  readonly devToken?: string;
  readonly trustedIssuers?: string;
}) {
  // A dev token never expires, so it is accepted only in development. An unset
  // NODE_ENV counts as production, so a deploy that forgets it stays closed.
  const devToken = process.env.NODE_ENV === "development" ? runtime.devToken : undefined;
  return {
    issuers: (runtime.trustedIssuers ?? "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((issuer) => ({ issuer })),
    devTokens: devToken
      ? { [devToken]: { kind: "human" as const, id: "owner", scopes: ["content:write"] } }
      : undefined,
  };
}
