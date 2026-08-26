/**
 * Integration: the db-backed audit + approval stores against a live database
 * (opt-in). Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env
 * is auto-loaded).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError } from "@usegraft/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideApproval, createDbApprovalStore, listPendingApprovals } from "./approvals";
import { createDbAuditStore } from "./audit";
import { createDb, type DbHandle } from "./client";
import { hardenRuntimeRole } from "./harden";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const BRANCH = "db-audit-it";
/** A verified operator identity — what every deciding surface derives. */
const OPERATOR = { kind: "human", id: "it-operator" } as const;

/** reserve + settle in one call — what `record` used to do in a single step. */
async function settleOne(
  store: ReturnType<typeof createDbAuditStore>,
  entry: Record<string, unknown>,
): Promise<void> {
  const { status, durationMs, ...reservation } = entry as {
    status: string;
    durationMs: number;
  } & Record<string, unknown>;
  const id = await store.reserve(reservation as never);
  await store.settle(id, { status, durationMs });
}

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
      await settleOne(store, { ...base, correlationId: "it-corr-1", status: "ok" });
      await settleOne(store, { ...base, correlationId: "it-corr-2", status: "RATE_LIMITED" });
      await settleOne(store, {
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

      const decided = await decideApproval(handle.db, id, "approved", OPERATOR);
      expect(decided).toMatchObject({ id, status: "approved", decidedBy: "it-operator" });
      // Deciding again is a no-op: only pending rows can be decided.
      expect(await decideApproval(handle.db, id, "denied", OPERATOR)).toBeUndefined();

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

  it(
    "stamps decided_role server-side and refuses approver == requester",
    async () => {
      const store = createDbApprovalStore(handle.db);
      const request = {
        branch: BRANCH,
        functionName: "itFn",
        input: { id: "row-sod" },
        inputCanonical: '{"id":"row-sod"}',
        requestedByKind: "agent",
        requestedById: "it-agent",
        correlationId: "it-corr-sod",
      };
      const id = await store.request(request);

      // Separation of duties: the requesting identity cannot decide.
      await expect(
        decideApproval(handle.db, id, "approved", { kind: "agent", id: "it-agent" }),
      ).rejects.toMatchObject({ code: "APPROVAL_SELF_DECISION" });
      await expect(
        decideApproval(handle.db, id, "denied", { kind: "agent", id: "it-agent" }),
      ).rejects.toBeInstanceOf(GraftError);

      // The refusal filed nothing: the row is still pending for a real reviewer.
      const decided = await decideApproval(handle.db, id, "approved", {
        kind: "human",
        id: "someone-else",
      });
      expect(decided).toMatchObject({
        id,
        status: "approved",
        decidedBy: "someone-else",
        decidedByKind: "human",
      });
      // decided_role is current_user, stamped inside the UPDATE — not client input.
      const [{ current_user: expectedRole }] = await handle.sql`select current_user`;
      expect(decided?.decidedRole).toBe(expectedRole as string);
    },
    TEST_TIMEOUT,
  );

  it(
    "refuses to decide an approval filed by an unidentified caller",
    async () => {
      const store = createDbApprovalStore(handle.db);
      // Legacy/anonymous filing: no stable requester id. Previously the
      // `requestedById IS NULL` arm of the WHERE clause made these decidable by
      // anyone — including whoever filed them.
      const id = await store.request({
        branch: BRANCH,
        functionName: "itFn",
        input: { id: "row-anon" },
        inputCanonical: '{"id":"row-anon"}',
        requestedByKind: "anonymous",
        requestedById: null,
        correlationId: "it-corr-anon",
      });

      await expect(
        decideApproval(handle.db, id, "approved", { kind: "human", id: "any-operator" }),
      ).rejects.toMatchObject({ code: "APPROVAL_UNATTRIBUTED" });

      // Still pending — the refusal decided nothing either way.
      const pending = await listPendingApprovals(handle.db);
      expect(pending.map((row) => row.id)).toContain(id);
    },
    TEST_TIMEOUT,
  );

  it(
    "role separation: a hardened runtime role can request + consume but never decide",
    async () => {
      const role = "graft_it_runtime";
      await handle.sql.unsafe(
        `do $$ begin if not exists (select from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`,
      );
      // PG16+: creating a role no longer implies SET-able membership for the
      // creator — grant it so this owner connection can impersonate the role.
      await handle.sql.unsafe(`grant ${role} to current_user`);
      await hardenRuntimeRole(handle.db, role);

      const store = createDbApprovalStore(handle.db);
      const match = { functionName: "itFn", inputCanonical: '{"id":"row-hardened"}' };
      const id = await store.request({
        branch: BRANCH,
        functionName: "itFn",
        input: { id: "row-hardened" },
        inputCanonical: match.inputCanonical,
        requestedByKind: "agent",
        requestedById: "it-agent",
        correlationId: "it-corr-hard",
      });

      try {
        // Raw SQL as the runtime role: flipping pending → approved is a
        // permission error, not a policy suggestion. (SET LOCAL pins the role
        // to this transaction, so the pooled connection is untouched after.)
        await expect(
          handle.sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx`update approvals set status = 'approved' where id = ${id}::uuid`;
          }),
        ).rejects.toThrow(/permission denied for table approvals/i);

        // Still pending — now approve as the operator (owner connection).
        await decideApproval(handle.db, id, "approved", OPERATOR);

        // The runtime role CAN consume — via the SECURITY DEFINER function,
        // the one status flip it is granted.
        const consumed = await handle.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          const [row] =
            await tx`select graft_consume_approval(${id}::uuid, ${match.functionName}, ${match.inputCanonical}) as reason`;
          return row?.reason;
        });
        expect(consumed).toBe("ok");

        // Audit: the runtime reserves a row before a call runs and settles it
        // after, so it needs UPDATE as well as INSERT — but only on the outcome
        // columns. It may record how a call ended; it may not rewrite who made
        // it or what it counted against.
        const auditStore = createDbAuditStore(handle.db);
        const auditId = await auditStore.reserve({
          branch: BRANCH,
          functionName: "itFn",
          functionKind: "mutation",
          actorKind: "agent",
          actorId: "it-agent",
          rateKey: "agent:it-agent",
          correlationId: "it-corr-hard-audit",
        });

        // Permitted: settling the outcome. A throw here fails the test.
        await handle.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`update audit_log set status = 'ok', duration_ms = 5 where id = ${auditId}::uuid`;
        });
        const [settled] =
          await handle.sql`select status from audit_log where id = ${auditId}::uuid`;
        expect(settled?.status).toBe("ok");

        await expect(
          handle.sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            await tx`update audit_log set rate_key = 'someone-else' where id = ${auditId}::uuid`;
          }),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        // DROP OWNED is refused on Neon (it touches objects the owner role
        // cannot drop); revoke the explicit grants instead, then drop.
        await handle.sql.unsafe(`revoke all on all tables in schema public from ${role}`);
        await handle.sql.unsafe(`revoke all on all functions in schema public from ${role}`);
        await handle.sql.unsafe(`revoke all on schema public from ${role}`);
        await handle.sql.unsafe(`drop role if exists ${role}`);
      }
    },
    TEST_TIMEOUT,
  );
});
