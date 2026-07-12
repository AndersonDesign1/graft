/**
 * graft compile — project the content tree into the content index, once.
 * The same validate → project pipeline the MCP write_content tool runs.
 *
 * `--branch` resolves through the branch registry: overlay branches (and
 * unregistered ids — tolerant by design) compile into the shared DB under
 * their branch_id; a `neon` branch compiles into its own database (rows there
 * keep the default id — the fork IS the branch).
 */
import type { CompileResult } from "@graft/compiler";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { formatCompileResult } from "../report";

export interface CompileCommandOptions {
  cwd: string;
  branchId?: string;
  /** Remove index rows in collections this schema doesn't know (see INDEX_OWNERSHIP). */
  pruneUnknown?: boolean;
}

export async function compileCommand(options: CompileCommandOptions): Promise<CompileResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();
  // The compiler pulls in the database driver (~1s of import) — load both only
  // once the project is known to be valid, so config errors return in milliseconds.
  const [{ compile }, { createDb, resolveBranchHandle, scopeWriteBranch }] = await Promise.all([
    import("@graft/compiler"),
    import("@graft/db"),
  ]);
  const control = createDb(url);
  try {
    const branch = await resolveBranchHandle(control.db, options.branchId ?? "main", {
      databaseUrl: url,
    });
    try {
      if (branch.scope.kind === "physical") {
        console.log(`neon branch "${branch.name}" — compiling into its own database`);
      }
      const result = await compile({
        db: branch.db,
        contentDir: config.contentDir,
        collections: config.collections,
        branchId: scopeWriteBranch(branch.scope),
        pruneUnknown: options.pruneUnknown,
      });
      console.log(formatCompileResult(result));
      return result;
    } finally {
      await branch.close();
    }
  } finally {
    await control.close();
  }
}
