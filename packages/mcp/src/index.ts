/**
 * @graft/mcp
 * MCP server: content ops + schema introspection + agent-actionable errors.
 * `createGraftMcp` builds the server; `serveStdio` binds it to stdio for
 * `.mcp.json`-style registration; `createGraftMcpHandler` serves it over
 * Streamable HTTP as a stateless `Request → Response` handler.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export { createGraftMcp, type GraftMcpOptions } from "./server";
export { createGraftMcpHandler, type GraftMcpHandler, type GraftMcpHandlerOptions } from "./http";
export { ERROR_KNOWLEDGE, explainCode, type ErrorExplanation } from "./explain";

/** Serve an MCP server over stdio (the transport agents' `.mcp.json` entries use). */
export async function serveStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
