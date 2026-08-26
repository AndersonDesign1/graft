/**
 * DB-backed audit store — the default persistence behind the functions
 * handler's per-invocation audit trail (P3.4).
 *
 * The store interface is deliberately tiny (record + countSince) so tests and
 * exotic deployments can swap in their own; countSince is what makes rate
 * limiting stateless — the "state" is the audit rows themselves.
 */
import { and, count, eq, gte } from "drizzle-orm";
import type { Database } from "./client";
import { auditLog, type NewAuditLogRow } from "./schema";

/** What is known about an invocation before it runs. */
export interface AuditReservation {
  correlationId: string;
  branch: string;
  functionName: string;
  functionKind: string;
  actorKind: string;
  actorId?: string | null;
  rateKey: string;
  gitSha?: string | null;
}

/** What is known once it has finished. */
export interface AuditOutcome {
  /** "ok" or the GraftError code the invocation failed with. */
  status: string;
  durationMs: number;
}

export type AuditEntry = AuditReservation & AuditOutcome;

/**
 * Two calls rather than one, because rate limiting reads these rows.
 *
 * `record`-after-execute left a window spanning the whole handler: N concurrent
 * requests all ran `countSince`, all saw the same count, and all were admitted
 * before any of them wrote a row — so a burst exceeded any limit in proportion
 * to its concurrency. Reserving the row *before* the handler runs closes it
 * without adding state: the counter and the evidence are the same table.
 */
export interface AuditStore {
  /** Insert the row for an invocation about to run; returns its id. */
  reserve(entry: AuditReservation): Promise<string>;
  /** Stamp the outcome on a reserved row. */
  settle(id: string, outcome: AuditOutcome): Promise<void>;
  /** Invocations (any status) for a rate key + function since `since`. */
  countSince(rateKey: string, functionName: string, since: Date): Promise<number>;
}

/** Status a reserved row carries until it settles. */
export const AUDIT_IN_FLIGHT = "in_flight";

export function createDbAuditStore(db: Database): AuditStore {
  return {
    async reserve(entry: AuditReservation): Promise<string> {
      const row: NewAuditLogRow = {
        correlationId: entry.correlationId,
        branchId: entry.branch,
        functionName: entry.functionName,
        functionKind: entry.functionKind,
        actorKind: entry.actorKind,
        actorId: entry.actorId ?? null,
        rateKey: entry.rateKey,
        status: AUDIT_IN_FLIGHT,
        durationMs: 0,
        gitSha: entry.gitSha ?? null,
      };
      const [inserted] = await db.insert(auditLog).values(row).returning({ id: auditLog.id });
      if (!inserted) throw new Error("audit reserve returned no row");
      return inserted.id;
    },

    async settle(id: string, outcome: AuditOutcome): Promise<void> {
      await db
        .update(auditLog)
        .set({ status: outcome.status, durationMs: outcome.durationMs })
        .where(eq(auditLog.id, id));
    },

    async countSince(rateKey: string, functionName: string, since: Date): Promise<number> {
      const [row] = await db
        .select({ n: count() })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.rateKey, rateKey),
            eq(auditLog.functionName, functionName),
            gte(auditLog.createdAt, since),
          ),
        );
      return row?.n ?? 0;
    },
  };
}
