/**
 * @graft/mcp
 * MCP server: content ops + schema/function introspection + run_function +
 * registry browse (list_registry / describe_item) + agent-actionable errors.
 * `createGraftMcp` builds the server; `serveStdio`
 * binds it to stdio for `.mcp.json` / `graft mcp`; `createGraftMcpHandler`
 * serves it over Streamable HTTP as a stateless `Request → Response` handler.
 * See docs/design-notes/agent-mcp.md.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export { createGraftMcp, type GraftMcpOptions } from "./server";
export { createGraftMcpHandler, type GraftMcpHandler, type GraftMcpHandlerOptions } from "./http";
export { ERROR_KNOWLEDGE, explainCode, type ErrorExplanation } from "./explain";

/**
 * Serve an MCP server over stdio (the transport agents' `.mcp.json` entries use).
 * Resolves when the client disconnects (stdin EOF / transport close), NOT at
 * connect time — callers await this for the server's whole lifetime and then
 * clean up. Resolving at connect let `graft mcp` fall through to its
 * process.exit right after the initialize handshake (latent P6.2 bug caught
 * by the P6.5 live smoke; the example's `pnpm mcp` script masked it by never
 * exiting after the await).
 */
export async function serveStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    // connect() installed the protocol's own onclose — chain it, don't replace it.
    const prior = transport.onclose;
    transport.onclose = () => {
      prior?.();
      resolve();
    };
  });
}
