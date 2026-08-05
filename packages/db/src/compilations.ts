/**
 * Compilation trail reads — the audit rows `projectBranchContent` writes.
 * Studio / MCP / CLI share this helper (headless parity).
 */
import { desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { compilations, type CompilationRow } from "./schema";

export interface ListCompilationsOptions {
  /** Restrict to one branch id. Omit for all branches. */
  branchId?: string;
  /** Max rows, newest first. Default 20, capped at 100. */
  limit?: number;
}

/** Recent compilation rows, newest first. */
export async function listCompilations(
  db: Database,
  options: ListCompilationsOptions = {},
): Promise<CompilationRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  let query = db.select().from(compilations).$dynamic();
  if (options.branchId) {
    query = query.where(eq(compilations.branchId, options.branchId));
  }
  return query.orderBy(desc(compilations.createdAt)).limit(limit);
}
