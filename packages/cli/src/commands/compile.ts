/**
 * graft compile — project the content tree into the content index, once.
 * The same validate → project pipeline the MCP write_content tool runs.
 */
import type { CompileResult } from "@graft/compiler";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { formatCompileResult } from "../report";

export interface CompileCommandOptions {
  cwd: string;
  branchId?: string;
}

export async function compileCommand(options: CompileCommandOptions): Promise<CompileResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();
  // The compiler pulls in the database driver (~1s of import) — load both only
  // once the project is known to be valid, so config errors return in milliseconds.
  const [{ compile }, { createDb }] = await Promise.all([
    import("@graft/compiler"),
    import("@graft/db"),
  ]);
  const handle = createDb(url);
  try {
    const result = await compile({
      db: handle.db,
      contentDir: config.contentDir,
      collections: config.collections,
      branchId: options.branchId,
    });
    console.log(formatCompileResult(result));
    return result;
  } finally {
    await handle.close();
  }
}
