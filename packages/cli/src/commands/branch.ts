/**
 * graft branch — create / list / drop content+data preview branches.
 *
 * Two backends behind the same commands (the registry row remembers which):
 * - overlay (default): a registry row + branch_id scoping in the shared DB.
 *   Create copies zero rows; drop purges the branch's data-plane rows
 *   (content_index, data_records, migrations_applied) transactionally.
 * - neon (--backend neon): a physical storage fork with its own compute
 *   endpoint (needs NEON_API_KEY + GRAFT_NEON_PROJECT_ID). Content is
 *   inherited; operational data and approvals start EMPTY on the fork —
 *   previews inherit content, never operational data. Drop deletes the Neon
 *   branch + endpoint, then the registry row.
 */
import { GraftError } from "@usegraft/contracts";
import type { BranchMeta, DropBranchResult } from "@usegraft/db";
import { loadProjectEnv, requireDatabaseUrl } from "../config";

export interface BranchCommandOptions {
  cwd: string;
  name?: string;
  /** Parent to fork from (create). Defaults to "main". */
  from?: string;
  /** Branch backend (create). Defaults to "overlay". */
  backend?: string;
}

export async function branchListCommand(options: BranchCommandOptions): Promise<BranchMeta[]> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const { createDb, listBranches } = await import("@usegraft/db");
  const handle = createDb(url);
  try {
    return await listBranches(handle.db);
  } finally {
    await handle.close();
  }
}

export async function branchCreateCommand(
  options: BranchCommandOptions & { name: string },
): Promise<BranchMeta> {
  const backend = options.backend ?? "overlay";
  if (backend !== "overlay" && backend !== "neon") {
    throw new GraftError({
      code: "BRANCH_INVALID",
      message: `Unknown branch backend "${backend}".`,
      fix: "Use --backend overlay (default; shared DB, instant) or --backend neon (physical fork; needs NEON_API_KEY + GRAFT_NEON_PROJECT_ID).",
      details: { backend },
    });
  }

  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const db = await import("@usegraft/db");
  const handle = db.createDb(url);
  try {
    if (backend === "neon") {
      const config = db.neonConfigFromEnv();
      return await db.createNeonBranch(
        handle.db,
        { name: options.name, from: options.from, databaseUrl: url },
        config,
      );
    }
    return await db.createBranch(handle.db, { name: options.name, from: options.from });
  } finally {
    await handle.close();
  }
}

export async function branchDropCommand(
  options: BranchCommandOptions & { name: string },
): Promise<DropBranchResult & { backend: string }> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const db = await import("@usegraft/db");
  const handle = db.createDb(url);
  try {
    const meta = await db.getBranch(handle.db, options.name);
    if (meta.backend === "neon") {
      await db.dropNeonBranch(handle.db, options.name, db.neonConfigFromEnv());
      return { backend: "neon" };
    }
    const result = await db.dropBranch(handle.db, options.name, { purgeRows: true });
    return { ...result, backend: "overlay" };
  } finally {
    await handle.close();
  }
}

export function formatBranch(branch: BranchMeta): string {
  const parent = branch.parent ? ` ← ${branch.parent}` : " (root)";
  const backend =
    branch.backend === "neon" && branch.endpointHost
      ? `neon @ ${branch.endpointHost}`
      : branch.backend;
  return `${branch.name}${parent}  [${backend}, ${branch.status}, created ${branch.createdAt.toISOString().slice(0, 10)}]`;
}
