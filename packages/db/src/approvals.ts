/**
 * DB-backed approval store — the human gate for destructive ops (P3.4).
 *
 * Lifecycle: the handler `request`s a pending approval (403, self-teaching); a
 * human `decide`s it (graft approve / graft deny); the caller retries and the
 * handler `consume`s it. Consume is a single conditional UPDATE — atomic,
 * one-shot, and bound to the exact function + canonical input it was requested
 * for, so an approval can never authorize a different call than the human saw.
 *
 * Hardened (post-P6): consume runs through the `graft_consume_approval`
 * SECURITY DEFINER function (migration 0007), so it is the ONLY status flip a
 * runtime credential needs; `decideApproval` stays a plain UPDATE on the table.
 * Grant a runtime role no UPDATE on `approvals` (see `runtimeRoleGrantsSql`)
 * and pending → approved becomes unreachable for it — even with raw SQL.
 * Decisions also stamp `decided_role` (`current_user`) server-side and refuse
 * approver == requester (separation of duties).
 */
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { GraftError } from "@usegraft/contracts";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ConsumeRefusal = Extract<ConsumeResult, { ok: false }>["reason"];

const CONSUME_REASONS = new Set<string>([
  "pending",
  "denied",
  "already_consumed",
  "mismatch",
] satisfies ConsumeRefusal[]);

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
      // A malformed id can never match a row; refuse before Postgres throws a
      // uuid cast error the caller can't act on.
      if (!UUID_RE.test(id)) return { ok: false, reason: "not_found" };

      // The SECURITY DEFINER path (migration 0007): the one status flip a
      // runtime credential is allowed, so hardened roles need no table UPDATE.
      const result = await db.execute<{ reason: string }>(
        sql`select graft_consume_approval(${id}::uuid, ${match.functionName}, ${match.inputCanonical}) as reason`,
      );
      const reason = result[0]?.reason;
      if (reason === "ok") return { ok: true };
      if (reason && CONSUME_REASONS.has(reason)) {
        return { ok: false, reason: reason as ConsumeRefusal };
      }
      return { ok: false, reason: "not_found" };
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
 *
 * Separation of duties: the identity that requested the approval can never be
 * the identity that decides it — approver == requester throws
 * `APPROVAL_SELF_DECISION` (enforced in the UPDATE's WHERE, not just checked
 * first). The decision also records `decided_role` = the Postgres
 * `current_user` it ran as, stamped server-side so it cannot be self-reported.
 */
export async function decideApproval(
  db: Database,
  id: string,
  decision: "approved" | "denied",
  decidedBy: string,
): Promise<ApprovalRow | undefined> {
  if (!UUID_RE.test(id)) return undefined;
  const [row] = await db
    .update(approvals)
    .set({
      status: decision,
      decidedBy,
      decidedRole: sql`current_user`,
      decidedAt: new Date(),
    })
    .where(
      and(
        eq(approvals.id, id),
        eq(approvals.status, "pending"),
        or(isNull(approvals.requestedById), ne(approvals.requestedById, decidedBy)),
      ),
    )
    .returning();
  if (row) return row;

  // Nothing updated — if a pending row exists, the WHERE's separation-of-duties
  // clause is what blocked it; say so instead of "not pending".
  const [pending] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .limit(1);
  if (pending) {
    throw new GraftError({
      code: "APPROVAL_SELF_DECISION",
      message: `Approval "${id}" was requested by "${decidedBy}" — a requester can never decide their own approval.`,
      fix: "Have a DIFFERENT operator review it: `graft approve <id>` (or `graft deny <id>`) under their own identity. Separation of duties is deliberate; do not retry as the requester.",
      details: { id, requestedBy: pending.requestedById, decision },
    });
  }
  return undefined;
}
