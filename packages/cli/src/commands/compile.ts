/**
 * graft compile — project the content tree into the content index, once.
 * The same validate → project pipeline the MCP write_content tool runs.
 *
 * `--branch` resolves through the branch registry: overlay branches (and
 * unregistered ids — tolerant by design) compile into the shared DB under
 * their branch_id; a `neon` branch compiles into its own database (rows there
 * keep the default id — the fork IS the branch).
 */
import type { CompileResult } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { formatCompileResult } from "../report";

/** Static mode has no DB branches — the git checkout is the branch. */
export function assertNoStaticBranch(branchId: string | undefined): void {
  if (branchId === undefined || branchId === "main") return;
  throw new GraftError({
    code: "NEEDS_DATABASE",
    message: `--branch ${branchId} needs the Postgres index: this project runs in static mode, where a "branch" is just your git branch.`,
    fix: `Check out the git branch and compile (each checkout builds its own artifact), or upgrade to Postgres for DB branching: set DATABASE_URL and \`export const index = "postgres"\` in graft.config.`,
    details: { branchId },
  });
}

export interface CompileCommandOptions {
  cwd: string;
  branchId?: string;
  /** Remove index rows in collections this schema doesn't know (see INDEX_OWNERSHIP). */
  pruneUnknown?: boolean;
}

export async function compileCommand(options: CompileCommandOptions): Promise<CompileResult> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));

  if (config.index.driver === "static") {
    assertNoStaticBranch(options.branchId);
    // No database, no env: validate the tree and rebuild the artifact.
    const { compileStatic } = await import("@usegraft/compiler");
    const result = await compileStatic({
      contentDir: config.contentDir,
      collections: config.collections,
      indexPath: config.index.path,
    });
    console.log(formatCompileResult(result));
    return result;
  }

  const url = requireDatabaseUrl();
  // The compiler pulls in the database driver (~1s of import) — load both only
  // once the project is known to be valid, so config errors return in milliseconds.
  const [{ compile }, { createDb, resolveBranchHandle, scopeWriteBranch }] = await Promise.all([
    import("@usegraft/compiler"),
    import("@usegraft/db"),
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
