/**
 * Run the project's MCP tools from a command. The one place that decides
 * where the tools run: today the project's own server, in this process.
 */
import type { ToolClient } from "@usegraft/mcp";
import { openProjectMcp } from "./project-mcp";

export interface ToolTarget {
  cwd: string;
  branchId?: string;
}

/** Open the project's tools, run `fn` with them, and close everything after. */
export async function withTools<T>(
  target: ToolTarget,
  fn: (tools: ToolClient) => Promise<T>,
): Promise<T> {
  const [project, { connectInProcess }] = await Promise.all([
    openProjectMcp(target),
    import("@usegraft/mcp"),
  ]);
  let tools: ToolClient | undefined;
  try {
    tools = await connectInProcess(project.server);
    return await fn(tools);
  } finally {
    await tools?.close();
    await project.close();
  }
}
