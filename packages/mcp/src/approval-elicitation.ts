/**
 * Asking the human in-band, when there is a human to ask.
 *
 * The human gate has always been out-of-band: a destructive call fails with an
 * approval id, someone runs `graft approve <id>`, the caller retries. That is
 * right for a remote agent — it is the whole reason the P6.5 live exercise
 * held — but it is ceremony for a local stdio server where the operator is
 * sitting at the same machine and the agent could have run the command itself.
 * MCP elicitation lets the server ask that person directly.
 *
 * **What changes is how the human is asked. What does not change is anything
 * underneath.** The decision is still a row in `approvals`, still one-shot,
 * still bound to the exact function and canonical input, still stamped with
 * `decided_role = current_user` server-side, and still refused by Postgres if
 * the decider is the requester. The elicitation is a nicer doorbell, not a new
 * door.
 *
 * Three ways this declines to act, all deliberate:
 *
 * - **The client did not offer elicitation.** Fall back to the id-and-retry
 *   flow. A client that cannot ask its user is not a client whose user said
 *   yes.
 * - **The human declined.** Record the deny, so the row does not sit pending
 *   pretending to be undecided.
 * - **The human dismissed it.** Leave the row pending and return the original
 *   refusal. Closing a dialog is not a decision, and recording it as one would
 *   put a "denied" in the audit trail that nobody chose.
 */
import { GraftError } from "@usegraft/contracts";
import { decideApproval, type Database } from "@usegraft/db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ApprovalElicitor {
  /**
   * Ask about a filed approval. Resolves to the id when a human approved and
   * the row is now decided, or undefined when it was not — for any reason.
   */
  (request: {
    approvalId: string;
    functionName: string;
    input: unknown;
  }): Promise<string | undefined>;
}

/** A short, readable rendering of the call the human is being asked about. */
function describeCall(functionName: string, input: unknown): string {
  const rendered = JSON.stringify(input);
  if (rendered === undefined) return functionName;
  const compact = rendered.length > 300 ? `${rendered.slice(0, 300)}…` : rendered;
  return `${functionName} ${compact}`;
}

export function createApprovalElicitor(options: {
  server: McpServer;
  db: () => Database;
  decider: { kind: string; id: string };
}): ApprovalElicitor {
  return async ({ approvalId, functionName, input }) => {
    // A client that never declared the capability cannot be asked. Falling
    // through to the id-and-retry flow is the honest answer; inventing consent
    // because the mount was configured for it would be the opposite.
    if (options.server.server.getClientCapabilities()?.elicitation === undefined) {
      return undefined;
    }

    const result = await options.server.server.elicitInput({
      message: [
        `Approve this destructive call?`,
        "",
        describeCall(functionName, input),
        "",
        `It will be recorded as decided by ${options.decider.kind}:${options.decider.id}.`,
        "The approval is one-shot and bound to exactly this input.",
      ].join("\n"),
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: "Approve",
            description: `Allow ${functionName} to run once, with exactly this input.`,
          },
        },
        required: ["approve"],
      },
    });

    // Dismissed. Not a decision — leave the row pending for a human to find.
    if (result.action === "cancel") return undefined;

    const approved = result.action === "accept" && result.content?.approve === true;

    // `decideApproval` is where the invariants live: pending-only, and
    // requester-cannot-decide enforced in the UPDATE's WHERE. If the operator
    // named here is the caller that filed the request, this throws
    // APPROVAL_SELF_DECISION exactly as `graft approve` would.
    const row = await decideApproval(
      options.db(),
      approvalId,
      approved ? "approved" : "denied",
      options.decider,
    );

    if (!row) {
      throw new GraftError({
        code: "APPROVAL_INVALID",
        message: `Approval "${approvalId}" was no longer pending when the decision arrived.`,
        fix: "Someone or something decided it while the prompt was open. Call the tool again to file a fresh approval.",
        details: { id: approvalId, function: functionName },
      });
    }

    return approved ? approvalId : undefined;
  };
}
