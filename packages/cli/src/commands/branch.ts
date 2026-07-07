/**
 * graft branch — create / list / drop content+data preview branches.
 *
 * A branch is a registry row (Phase 4 overlay backend): creating one copies
 * zero rows and is instant; reads overlay the parent until the branch writes
 * its own rows. Dropping purges the branch's data-plane rows (content_index,
 * data_records, migrations_applied) in the same transaction — audit and
 * compilation rows are history and stay.
 */
import type { BranchMeta, DropBranchResult } from "@graft/db";
import { loadProjectEnv, requireDatabaseUrl } from "../config";

export interface BranchCommandOptions {
  cwd: string;
  name?: string;
  /** Parent to fork from (create). Defaults to "main". */
  from?: string;
}

export async function branchListCommand(options: BranchCommandOptions): Promise<BranchMeta[]> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const { createDb, listBranches } = await import("@graft/db");
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
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const { createDb, createBranch } = await import("@graft/db");
  const handle = createDb(url);
  try {
    return await createBranch(handle.db, { name: options.name, from: options.from });
  } finally {
    await handle.close();
  }
}

export async function branchDropCommand(
  options: BranchCommandOptions & { name: string },
): Promise<DropBranchResult> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const { createDb, dropBranch } = await import("@graft/db");
  const handle = createDb(url);
  try {
    return await dropBranch(handle.db, options.name, { purgeRows: true });
  } finally {
    await handle.close();
  }
}

export function formatBranch(branch: BranchMeta): string {
  const parent = branch.parent ? ` ← ${branch.parent}` : " (root)";
  return `${branch.name}${parent}  [${branch.backend}, ${branch.status}, created ${branch.createdAt.toISOString().slice(0, 10)}]`;
}
