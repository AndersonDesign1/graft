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

export interface AuditEntry {
  correlationId: string;
  branch: string;
  functionName: string;
  functionKind: string;
  actorKind: string;
  actorId?: string | null;
  rateKey: string;
  /** "ok" or the GraftError code the invocation failed with. */
  status: string;
  durationMs: number;
  gitSha?: string | null;
}

export interface AuditStore {
  record(entry: AuditEntry): Promise<void>;
  /** Invocations (any status) for a rate key + function since `since`. */
  countSince(rateKey: string, functionName: string, since: Date): Promise<number>;
}

export function createDbAuditStore(db: Database): AuditStore {
  return {
    async record(entry: AuditEntry): Promise<void> {
      const row: NewAuditLogRow = {
        correlationId: entry.correlationId,
        branchId: entry.branch,
        functionName: entry.functionName,
        functionKind: entry.functionKind,
        actorKind: entry.actorKind,
        actorId: entry.actorId ?? null,
        rateKey: entry.rateKey,
        status: entry.status,
        durationMs: entry.durationMs,
        gitSha: entry.gitSha ?? null,
      };
      await db.insert(auditLog).values(row);
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
