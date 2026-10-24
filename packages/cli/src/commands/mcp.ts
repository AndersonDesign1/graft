/**
 * graft mcp — project MCP over stdio (the local agent install path).
 *
 * Serves the project's MCP server (project-mcp.ts) on stdio until the client
 * exits. Register in `.mcp.json` as:
 * `"command": "pnpm", "args": ["exec", "graft", "mcp"]`.
 */
import { openProjectMcp, type ProjectMcpOptions } from "../project-mcp";

export type McpCommandOptions = ProjectMcpOptions;

export async function mcpCommand(options: McpCommandOptions): Promise<void> {
  const [project, { serveStdio }] = await Promise.all([
    openProjectMcp(options),
    import("@usegraft/mcp"),
  ]);
  try {
    // Stdio MCP: never write noise to stdout (that's the protocol stream).
    // Errors before connect go to stderr via the CLI runner.
    await serveStdio(project.server);
  } finally {
    await project.close();
  }
}
