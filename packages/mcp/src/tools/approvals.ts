/**
 * The human gate — listing pending approvals and deciding them.
 *
 * A decision is attributed to the identity the connection authenticated as; there is deliberately no way to name a different decider.
 */
import { GraftError } from "@usegraft/contracts";
import { decideApproval, listPendingApprovals } from "@usegraft/db";
import { z } from "zod";
import { guarded } from "../tool-result";
import { DESTROYS, READS } from "./annotations";
import { decideApprovalOutput, listApprovalsOutput } from "./outputs";
import type { RegisterTools } from "./deps";

export const registerApprovalTools: RegisterTools = (server, deps) => {
  const { branchId, requireDb, requireDecider, requireScope } = deps;

  server.registerTool(
    "list_approvals",
    {
      title: "List pending approvals",
      outputSchema: listApprovalsOutput,
      annotations: READS,
      description:
        "Pending human-gated approvals. Decide with decide_approval, Studio Approve/Deny, or `graft approve` / `graft deny`. Same data as GET /api/studio/v1/approvals.",
      inputSchema: {},
    },
    () =>
      guarded(async () => ({
        approvals: (
          await listPendingApprovals(
            requireDb(
              "list_approvals",
              "Approvals gate destructive operations on operational data, which a static project does not have.",
            ),
          )
        ).map((row) => ({
          id: row.id,
          branchId: row.branchId,
          functionName: row.functionName,
          input: row.input,
          requestedByKind: row.requestedByKind,
          requestedById: row.requestedById,
          correlationId: row.correlationId,
          createdAt: row.createdAt.toISOString(),
        })),
      })),
  );

  server.registerTool(
    "decide_approval",
    {
      title: "Approve or deny a pending approval",
      outputSchema: decideApprovalOutput,
      annotations: DESTROYS,
      description:
        "Record a decision on a pending approval (same as Studio Approve/Deny and `graft approve` / `graft deny`). The decision is attributed to the identity THIS connection authenticated as — there is no way to name a different decider — and a requester can never decide their own approval. Requires an authenticated caller and an owner DB role that can UPDATE approvals.",
      inputSchema: {
        id: z.string().describe("Pending approval id from list_approvals"),
        decision: z.enum(["approved", "denied"]).describe("approved or denied"),
      },
    },
    ({ id, decision }) =>
      guarded(async () => {
        requireScope("decide_approval", "approvals:decide");
        const row = await decideApproval(
          requireDb(
            "decide_approval",
            "Approvals gate destructive operations on operational data, which a static project does not have.",
          ),
          id,
          decision,
          requireDecider(),
        );
        if (!row) {
          throw new GraftError({
            code: "APPROVAL_INVALID",
            message: `No PENDING approval "${id}" exists — it may already be decided, consumed, or mistyped.`,
            fix: "Call list_approvals and use a pending id.",
            details: { id },
          });
        }
        return {
          id: row.id,
          status: row.status,
          decidedBy: row.decidedBy,
          functionName: row.functionName,
        };
      }),
  );
};
