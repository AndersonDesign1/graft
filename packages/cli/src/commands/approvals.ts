/**
 * graft approvals / approve / deny — the human side of the destructive-op gate.
 *
 * Agents hitting a gated function get a pending approval id and stop; a human
 * reviews the exact function + input here and decides. Only pending approvals
 * can be decided, and a decision is recorded with who made it.
 */
import { userInfo } from "node:os";
import type { ApprovalRow } from "@graft/db";
import { loadProjectEnv, requireDatabaseUrl } from "../config";

export interface ApprovalsCommandOptions {
  cwd: string;
}

export interface DecideCommandOptions {
  cwd: string;
  id: string;
  decision: "approved" | "denied";
  /** Who is deciding. Defaults to the OS username. */
  decidedBy?: string;
}

function operatorName(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USERNAME ?? process.env.USER ?? "operator";
  }
}

export async function approvalsListCommand(
  options: ApprovalsCommandOptions,
): Promise<ApprovalRow[]> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const { createDb, listPendingApprovals } = await import("@graft/db");
  const handle = createDb(url);
  try {
    return await listPendingApprovals(handle.db);
  } finally {
    await handle.close();
  }
}

export async function decideCommand(options: DecideCommandOptions): Promise<ApprovalRow> {
  loadProjectEnv(options.cwd);
  const url = requireDatabaseUrl();
  const [{ createDb, decideApproval }, { GraftError }] = await Promise.all([
    import("@graft/db"),
    import("@graft/contracts"),
  ]);
  const handle = createDb(url);
  try {
    const row = await decideApproval(
      handle.db,
      options.id,
      options.decision,
      options.decidedBy ?? operatorName(),
    );
    if (!row) {
      throw new GraftError({
        code: "APPROVAL_INVALID",
        message: `No PENDING approval "${options.id}" exists — it may already be decided, consumed, or mistyped.`,
        fix: "Run `graft approvals` to see what is actually pending; only pending approvals can be approved or denied.",
        details: { id: options.id },
      });
    }
    return row;
  } finally {
    await handle.close();
  }
}

/** One reviewable line per pending approval — what the human decides on. */
export function formatApproval(row: ApprovalRow): string {
  const requester = row.requestedById
    ? `${row.requestedByKind}:${row.requestedById}`
    : row.requestedByKind;
  return [
    `${row.id}`,
    `  function:  ${row.functionName}  (branch ${row.branchId})`,
    `  requested: ${row.createdAt.toISOString()} by ${requester}`,
    `  input:     ${JSON.stringify(row.input)}`,
  ].join("\n");
}
