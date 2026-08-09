/**
 * graft compilations — list recent content projection trail rows.
 * Same data as GET /api/studio/v1/compilations and MCP list_compilations.
 */
import type { CompilationRow } from "@usegraft/db";
import { loadProjectEnv, requireDatabaseUrl } from "../config";

export interface CompilationsCommandOptions {
  cwd: string;
  branchId?: string;
  limit?: number;
}

export async function compilationsListCommand(
  options: CompilationsCommandOptions,
): Promise<CompilationRow[]> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const { createDb, listCompilations } = await import("@usegraft/db");
  const handle = createDb(url);
  try {
    return await listCompilations(handle.db, {
      branchId: options.branchId,
      limit: options.limit,
    });
  } finally {
    await handle.close();
  }
}

export function formatCompilation(row: CompilationRow): string {
  const sha = row.gitSha ? row.gitSha.slice(0, 7) : "no-sha";
  return `${row.createdAt.toISOString()}  ${row.branchId}  ${sha}  docs=${row.docCount}  +${row.added} ~${row.changed} -${row.removed}  ${row.id}`;
}
