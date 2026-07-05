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
import { GraftError } from "@graft/contracts";
import type { FunctionActor } from "@graft/core";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createGraftMcp, type GraftMcpOptions } from "./server";

export interface GraftMcpHandlerOptions extends GraftMcpOptions {
  /**
   * Resolve the caller — the same @graft/auth `createActorResolver` seam the
   * functions handler uses. A resolver that throws (TOKEN_INVALID) rejects the
   * request with 401; per-tool authorization lands with function introspection.
   */
  actor?: (request: Request) => FunctionActor | Promise<FunctionActor>;
  /**
   * Reject anonymous callers with 401. Off by default (a dev server on
   * localhost); turn it on for anything reachable from outside.
   */
  requireActor?: boolean;
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
  const { actor: resolveActor, requireActor, ...serverOptions } = options;

  return async (request: Request): Promise<Response> => {
    // Stateless mode is POST-only: no sessions, so no SSE stream to GET and no
    // session to DELETE. Clients treat the 405 as "server-initiated messages
    // not supported" and carry on.
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed: this server is stateless (POST only)", {
        allow: "POST",
      });
    }

    if (resolveActor) {
      let actor: FunctionActor;
      try {
        actor = await resolveActor(request);
      } catch (err) {
        // A bad credential is an error to fix, never a downgrade to anonymous.
        const message =
          err instanceof GraftError ? `${err.message} ${err.fix ?? ""}`.trim() : "Unauthorized";
        return jsonRpcError(401, -32001, message);
      }
      if (requireActor && actor.kind === "anonymous") {
        return jsonRpcError(
          401,
          -32001,
          "Unauthorized: this MCP endpoint requires authentication. Send `Authorization: Bearer <token>` from a trusted issuer.",
        );
      }
    } else if (requireActor) {
      return jsonRpcError(
        401,
        -32001,
        "Unauthorized: requireActor is set but no actor resolver is configured — the server cannot authenticate anyone.",
      );
    }

    const server = createGraftMcp(serverOptions);
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
