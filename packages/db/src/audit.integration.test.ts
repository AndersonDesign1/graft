/**
 * Integration: the db-backed audit + approval stores against a live database
 * (opt-in). Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env
 * is auto-loaded).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, createDbApprovalStore, listPendingApprovals } from "./approvals";
import { createDbAuditStore } from "./audit";
import { createDb, type DbHandle } from "./client";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const BRANCH = "db-audit-it";

describe.skipIf(!runIntegration)("db-backed audit + approval stores (live)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    await handle.sql`delete from audit_log where branch_id = ${BRANCH}`;
    await handle.sql`delete from approvals where branch_id = ${BRANCH}`;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await handle.sql`delete from audit_log where branch_id = ${BRANCH}`;
    await handle.sql`delete from approvals where branch_id = ${BRANCH}`;
    await handle.close();
  }, TEST_TIMEOUT);

  it(
    "records audit rows and counts them per rate key + function + window",
    async () => {
      const store = createDbAuditStore(handle.db);
      const base = {
        branch: BRANCH,
        functionName: "itFn",
        functionKind: "mutation",
        actorKind: "agent",
        actorId: "it-agent",
        rateKey: "agent:it-agent",
        durationMs: 12,
        gitSha: "it-sha",
      };
      await store.record({ ...base, correlationId: "it-corr-1", status: "ok" });
      await store.record({ ...base, correlationId: "it-corr-2", status: "RATE_LIMITED" });
      await store.record({
        ...base,
        correlationId: "it-corr-3",
        status: "ok",
        rateKey: "agent:someone-else",
      });

      const oneMinuteAgo = new Date(Date.now() - 60_000);
      expect(await store.countSince("agent:it-agent", "itFn", oneMinuteAgo)).toBe(2);
      expect(await store.countSince("agent:it-agent", "otherFn", oneMinuteAgo)).toBe(0);
      expect(await store.countSince("agent:it-agent", "itFn", new Date(Date.now() + 1000))).toBe(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "runs the approval lifecycle: request → pending → approve → consume once",
    async () => {
      const store = createDbApprovalStore(handle.db);
      const match = { functionName: "itFn", inputCanonical: '{"id":"row-1"}' };
      const id = await store.request({
        branch: BRANCH,
        functionName: "itFn",
        input: { id: "row-1" },
        inputCanonical: match.inputCanonical,
        requestedByKind: "agent",
        requestedById: "it-agent",
        correlationId: "it-corr-apr",
      });

      const pendingRows = await listPendingApprovals(handle.db);
      expect(pendingRows.some((row) => row.id === id)).toBe(true);
      expect(await store.consume(id, match)).toEqual({ ok: false, reason: "pending" });

      const decided = await decideApproval(handle.db, id, "approved", "it-operator");
      expect(decided).toMatchObject({ id, status: "approved", decidedBy: "it-operator" });
      // Deciding again is a no-op: only pending rows can be decided.
      expect(await decideApproval(handle.db, id, "denied", "it-operator")).toBeUndefined();

      expect(await store.consume(id, { ...match, inputCanonical: '{"id":"row-2"}' })).toEqual({
        ok: false,
        reason: "mismatch",
      });
      expect(await store.consume(id, match)).toEqual({ ok: true });
      expect(await store.consume(id, match)).toEqual({ ok: false, reason: "already_consumed" });
      expect(await store.consume(crypto.randomUUID(), match)).toEqual({
        ok: false,
        reason: "not_found",
      });
    },
    TEST_TIMEOUT,
  );
});
