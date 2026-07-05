/**
 * DB-backed approval store — the human gate for destructive ops (P3.4).
 *
 * Lifecycle: the handler `request`s a pending approval (403, self-teaching); a
 * human `decide`s it (graft approve / graft deny); the caller retries and the
 * handler `consume`s it. Consume is a single conditional UPDATE — atomic,
 * one-shot, and bound to the exact function + canonical input it was requested
 * for, so an approval can never authorize a different call than the human saw.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "./client";
import { approvals, type ApprovalRow } from "./schema";

export interface ApprovalRequest {
  branch: string;
  functionName: string;
  input: Record<string, unknown>;
  inputCanonical: string;
  requestedByKind: string;
  requestedById?: string | null;
  correlationId: string;
}

export type ConsumeResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "pending" | "denied" | "already_consumed" | "mismatch";
    };

export interface ApprovalStore {
  /** Create a pending approval; returns its id (what the human decides on). */
  request(req: ApprovalRequest): Promise<string>;
  /**
   * Atomically consume an approved approval for exactly this function + input.
   * Anything else — unknown id, still pending, denied, already consumed, or a
   * different call than was approved — refuses with the reason.
   */
  consume(
    id: string,
    match: { functionName: string; inputCanonical: string },
  ): Promise<ConsumeResult>;
}

export function createDbApprovalStore(db: Database): ApprovalStore {
  return {
    async request(req: ApprovalRequest): Promise<string> {
      const [row] = await db
        .insert(approvals)
        .values({
          branchId: req.branch,
          functionName: req.functionName,
          input: req.input,
          inputCanonical: req.inputCanonical,
          requestedByKind: req.requestedByKind,
          requestedById: req.requestedById ?? null,
          correlationId: req.correlationId,
        })
        .returning({ id: approvals.id });
      if (!row) throw new Error("approval insert returned no row");
      return row.id;
    },

    async consume(
      id: string,
      match: { functionName: string; inputCanonical: string },
    ): Promise<ConsumeResult> {
      const consumed = await db
        .update(approvals)
        .set({ status: "consumed" })
        .where(
          and(
            eq(approvals.id, id),
            eq(approvals.status, "approved"),
            eq(approvals.functionName, match.functionName),
            eq(approvals.inputCanonical, match.inputCanonical),
          ),
        )
        .returning({ id: approvals.id });
      if (consumed.length > 0) return { ok: true };

      // Refused — read the row to say why (diagnostics only; the UPDATE above
      // is the sole authority on whether execution proceeds).
      const [row] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status === "pending") return { ok: false, reason: "pending" };
      if (row.status === "denied") return { ok: false, reason: "denied" };
      if (row.status === "consumed") return { ok: false, reason: "already_consumed" };
      return { ok: false, reason: "mismatch" };
    },
  };
}

/** Pending approvals, oldest first — what `graft approvals` shows the human. */
export async function listPendingApprovals(db: Database): Promise<ApprovalRow[]> {
  return db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "pending"))
    .orderBy(desc(approvals.createdAt))
    .limit(100);
}

/**
 * Record a human decision on a pending approval. Only pending rows can be
 * decided (conditional UPDATE — deciding an already-decided approval is a
 * no-op returning undefined).
 */
export async function decideApproval(
  db: Database,
  id: string,
  decision: "approved" | "denied",
  decidedBy: string,
): Promise<ApprovalRow | undefined> {
  const [row] = await db
    .update(approvals)
    .set({ status: decision, decidedBy, decidedAt: new Date() })
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .returning();
  return row;
}
