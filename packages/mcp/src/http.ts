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
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createGraftMcp, type GraftMcpOptions } from "./server";

export interface GraftMcpHandlerOptions extends GraftMcpOptions {
  /**
   * When set, requests must carry `Authorization: Bearer <token>`.
   * A stopgap until scoped agent tokens land (Phase 3) — never rely on it as
   * the only barrier on a public deployment.
   */
  bearerToken?: string;
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
  const { bearerToken, ...serverOptions } = options;

  return async (request: Request): Promise<Response> => {
    // Stateless mode is POST-only: no sessions, so no SSE stream to GET and no
    // session to DELETE. Clients treat the 405 as "server-initiated messages
    // not supported" and carry on.
    if (request.method !== "POST") {
      return jsonRpcError(405, -32000, "Method not allowed: this server is stateless (POST only)", {
        allow: "POST",
      });
    }

    if (bearerToken) {
      const header = request.headers.get("authorization");
      if (header !== `Bearer ${bearerToken}`) {
        return jsonRpcError(401, -32001, "Unauthorized: missing or invalid bearer token");
      }
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
