/**
 * graft compile — project the content tree into the content index, once.
 * The same validate → project pipeline the MCP write_content tool runs.
 *
 * `--branch` resolves through the branch registry: overlay branches (and
 * unregistered ids — tolerant by design) compile into the shared DB under
 * their branch_id; a `neon` branch compiles into its own database (rows there
 * keep the default id — the fork IS the branch).
 *
 * `--json` prints one `{ branch, gitSha, changes }` object (see compileJson in
 * report.ts), so a deploy script can pipe the ChangeSet to the app's
 * revalidate route.
 */
import type { CompileOptions, CompileResult, CompileStaticOptions } from "@usegraft/compiler";
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
  return (await compileBranch(options)).result;
}

export interface CompiledBranch {
  /** The branch the run compiled, as the cache tags name it. */
  branch: string;
  result: CompileResult;
}

/** Compile once, and say which branch it was: what `graft compile --json` reports. */
export async function compileBranch(options: CompileCommandOptions): Promise<CompiledBranch> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));

  if (config.index.driver === "static") {
    assertNoStaticBranch(options.branchId);
    // No database, no env: validate the tree and rebuild the artifact.
    const { compileStatic } = await import("@usegraft/compiler");
    const { openMdxCache } = await import("../mdx-cache");
    const mdxScanCache = await openMdxCache(config.contentDir);
    const staticOptions: CompileStaticOptions = {
      contentDir: config.contentDir,
      collections: config.collections,
      mdxTrust: config.mdxTrust,
      indexPath: config.index.path,
    };
    if (mdxScanCache) staticOptions.mdxScanCache = mdxScanCache;
    let result: CompileResult;
    try {
      result = await compileStatic(staticOptions);
    } finally {
      mdxScanCache?.save();
    }
    console.log(formatCompileResult(result));
    return { branch: "main", result };
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
      const { openMdxCache } = await import("../mdx-cache");
      const mdxScanCache = await openMdxCache(config.contentDir);
      const compileOptions: CompileOptions = {
        db: branch.db,
        contentDir: config.contentDir,
        collections: config.collections,
        mdxTrust: config.mdxTrust,
        branchId: scopeWriteBranch(branch.scope),
        pruneUnknown: options.pruneUnknown,
        source: config.content.source,
      };
      if (mdxScanCache) compileOptions.mdxScanCache = mdxScanCache;
      let result: CompileResult;
      try {
        result = await compile(compileOptions);
      } finally {
        mdxScanCache?.save();
      }
      console.log(formatCompileResult(result));
      return { branch: branch.name, result };
    } finally {
      await branch.close();
    }
  } finally {
    await control.close();
  }
}
