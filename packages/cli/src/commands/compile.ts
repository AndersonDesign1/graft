/**
 * graft compile — project the content tree into the content index, once.
 * The same validate → project pipeline the MCP write_content tool runs.
 */
import { compile, type CompileResult } from "@graft/compiler";
import { createDb } from "@graft/db";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { formatCompileResult } from "../report";

export interface CompileCommandOptions {
  cwd: string;
  branchId?: string;
}

export async function compileCommand(options: CompileCommandOptions): Promise<CompileResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const handle = createDb(requireDatabaseUrl());
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
