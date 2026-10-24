/**
 * Run the project's MCP tools from a command. The one place that decides
 * where the tools run: the project in this folder, in this process, or a
 * hosted site's /api/mcp with its token.
 */
import type { ToolClient } from "@usegraft/mcp";

export interface ToolTarget {
  cwd: string;
  branchId?: string;
  /** A hosted site; the project in `cwd` is not opened at all. */
  remote?: { origin: string; token: string };
}

/** Open the tools, run `fn` with them, and close everything after. */
export async function withTools<T>(
  target: ToolTarget,
  fn: (tools: ToolClient) => Promise<T>,
): Promise<T> {
  if (target.remote) {
    const { connectRemote } = await import("@usegraft/mcp");
    const tools = await connectRemote(target.remote);
    try {
      return await fn(tools);
    } finally {
      await tools.close();
    }
  }
  const [{ openProjectMcp }, { connectInProcess }] = await Promise.all([
    import("./project-mcp"),
    import("@usegraft/mcp"),
  ]);
  const project = await openProjectMcp(target);
  let tools: ToolClient | undefined;
  try {
    tools = await connectInProcess(project.server);
    return await fn(tools);
  } finally {
    await tools?.close();
    await project.close();
  }
}
