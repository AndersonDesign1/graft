/**
 * MCP over HTTP — the remote agent surface.
 *
 * `createGraftMcpHandler` wraps the same server `createGraftMcp` builds in the
 * MCP Streamable HTTP transport as a stateless Web-standard handler
 * (`Request → Response`): a fresh server + transport per request, no state
 * between calls, so the exact same handler runs in a Next.js route, a
 * self-host container, Vercel Fluid, or a Worker. This is what makes Graft
 * reachable by agents that cannot spawn a stdio process — eve agents,
 * hosted agents, anything remote.
 *
 * Writes go through the same validate → write MDX → compile pipeline, so the
 * process serving this handler must see a writable content tree (dev server or
 * self-host). Reads only need the files + database.
 */
import { GraftError } from "@usegraft/contracts";
import type { FunctionActor } from "@usegraft/core";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createDocsMcp, createGraftMcp, type DocsMcpOptions, type GraftMcpOptions } from "./server";

export interface GraftMcpHandlerOptions extends GraftMcpOptions {
  /**
   * Resolve the caller — the same @usegraft/auth `createActorResolver` seam the
   * functions handler uses. A resolver that throws (TOKEN_INVALID) rejects the
   * request with 401; per-tool authorization lands with function introspection.
   */
  actor?: (request: Request) => FunctionActor | Promise<FunctionActor>;
  /**
   * Serve callers who did not authenticate.
   *
   * Off by default, and deliberately phrased as an opt-*in* to insecurity: this
   * handler is built to be embedded in a Next.js route, a self-host container,
   * Vercel Fluid, or a Worker, and the previous `requireActor` flag defaulted to
   * off — so forgetting it silently published write_content, put_asset,
   * delete_content and decide_approval to anyone who found the URL.
   *
   * Constructing a handler with neither `actor` nor `allowAnonymous: true`
   * throws, so a deployer who forgets gets a startup failure with a fix line
   * rather than an open endpoint.
   */
  allowAnonymous?: boolean;
}

export type GraftMcpHandler = (request: Request) => Promise<Response>;

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers?: Record<string, string>,
) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

export function createGraftMcpHandler(options: GraftMcpHandlerOptions): GraftMcpHandler {
  const { actor: resolveActor, allowAnonymous, ...serverOptions } = options;

  // Fail at construction, not per request: an endpoint that cannot authenticate
  // anyone should never come up at all, and a startup crash is the one signal a
  // deployer cannot miss. (`graft serve` and `graft studio` warn on an insecure
  // bind; a library embedding got no signal whatsoever.)
  if (resolveActor === undefined && allowAnonymous !== true) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message:
        "createGraftMcpHandler was given no way to authenticate callers, and this endpoint serves content writes, asset uploads and approval decisions.",
      fix: "Pass `actor` — the @usegraft/auth `createActorResolver` seam, the same one the functions route uses. For a local dev server with no auth at all, pass `allowAnonymous: true` explicitly; never do that on anything reachable from a network.",
    });
  }

  return async (request: Request): Promise<Response> => {
    // Stateless mode is POST-only: no sessions, so no SSE stream to GET and no
    // session to DELETE. Clients treat the 405 as "server-initiated messages
    // not supported" and carry on.
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed: this server is stateless (POST only)", {
        allow: "POST",
      });
    }

    let actor: FunctionActor | undefined;
    if (resolveActor) {
      try {
        actor = await resolveActor(request);
      } catch (err) {
        // A bad credential is an error to fix, never a downgrade to anonymous.
        const message =
          err instanceof GraftError ? `${err.message} ${err.fix ?? ""}`.trim() : "Unauthorized";
        return jsonRpcError(401, -32001, message);
      }
      if (allowAnonymous !== true && actor.kind === "anonymous") {
        return jsonRpcError(
          401,
          -32001,
          "Unauthorized: this MCP endpoint requires authentication. Send `Authorization: Bearer <token>` from a trusted issuer.",
        );
      }
    }

    // The caller already authenticated to this endpoint — forward their bearer
    // as run_function's default identity so agents never re-send the token as a
    // tool argument (an explicit `authorization` argument still overrides). The
    // resolver must also reach the inner server: it runs again on run_function's
    // synthetic request, the same seam as the functions route.
    const server = createGraftMcp({
      ...serverOptions,
      actor: resolveActor,
      // Tools that need to know WHO is calling (rather than forward a
      // credential) read this. It is the same identity the check above just
      // verified, so a tool can never be told a different one.
      ...(actor === undefined ? {} : { connectionActor: actor }),
      defaultAuthorization:
        request.headers.get("authorization") ?? serverOptions.defaultAuthorization,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      // JSON mode returns complete bodies, so closing after handleRequest
      // resolves cannot cut a response short.
      void server.close().catch(() => undefined);
    }
  };
}

/**
 * A public documentation MCP endpoint, over the same stateless transport.
 *
 * Deliberately has no `actor` and no `allowAnonymous`. The full handler refuses
 * to start without one of them because it serves writes, uploads and approval
 * decisions; this one serves documentation, so there is nothing to authenticate
 * and nothing to accidentally leave open. That is the point of it being a
 * separate function: the closed endpoint gains no new way to be opened.
 *
 * Mount it at `/mcp` on the docs domain, which is where clients look —
 * Mintlify generates one there for every site it hosts, and Cloudflare runs a
 * documentation server separately from its authenticated API server.
 */
export function createDocsMcpHandler(options: DocsMcpOptions): GraftMcpHandler {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed: this server is stateless (POST only)", {
        allow: "POST",
      });
    }

    const server = createDocsMcp(options);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request);
    } finally {
      void server.close().catch(() => undefined);
    }
  };
}
