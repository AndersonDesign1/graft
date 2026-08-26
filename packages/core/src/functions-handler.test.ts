import { GraftError } from "@usegraft/contracts";
import type { ApprovalStore, AuditEntry, AuditStore, Database } from "@usegraft/db";
import { describe, expect, it } from "vitest";
import { field } from "./field";
import { defineFunction, type FunctionContext } from "./function";
import {
  canonicalJson,
  createFunctionsHandler,
  type FunctionsHandlerOptions,
} from "./functions-handler";

const fakeDb = { __fake: true } as unknown as Database;

const echo = defineFunction({
  name: "echo",
  kind: "query",
  input: { message: field.string() },
  handler: ({ input }) => ({ echoed: input.message }),
});

const whoami = defineFunction({
  name: "whoami",
  kind: "query",
  input: {},
  handler: (ctx) => ({
    actor: ctx.actor.kind,
    branch: ctx.branch,
    hasDb: ctx.db === fakeDb,
    correlationId: ctx.correlationId,
  }),
});

const secret = defineFunction({
  name: "secret",
  kind: "mutation",
  input: {},
  access: (ctx) => ctx.actor.kind !== "anonymous",
  handler: () => ({ ok: true }),
});

const boom = defineFunction({
  name: "boom",
  kind: "query",
  input: {},
  handler: () => {
    throw new Error("kaboom");
  },
});

const gone = defineFunction({
  name: "gone",
  kind: "query",
  input: {},
  handler: () => {
    throw new GraftError({
      code: "DOCUMENT_NOT_FOUND",
      message: "nothing here",
      fix: "look elsewhere",
    });
  },
});

/** No access rule, not public → the secure mutation default applies. */
const guardedMutation = defineFunction({
  name: "guardedMutation",
  kind: "mutation",
  input: {},
  handler: () => ({ ok: true }),
});

/** public: true opts a mutation back into anonymous access (e.g. a contact form). */
const publicMutation = defineFunction({
  name: "publicMutation",
  kind: "mutation",
  public: true,
  input: {},
  handler: () => ({ ok: true }),
});

/** A custom access rule is the whole policy — it can re-open a mutation to anonymous. */
const openByRule = defineFunction({
  name: "openByRule",
  kind: "mutation",
  input: {},
  access: () => true,
  handler: () => ({ ok: true }),
});

const functions = { echo, whoami, secret, boom, gone, guardedMutation, publicMutation, openByRule };

/** Parse a response body loosely — tests assert the shape via expect. */
// oxlint-disable-next-line no-explicit-any
function json(res: Response): Promise<any> {
  return res.json();
}

function post(name: string, body?: unknown): Request {
  return new Request(`http://localhost/api/fn/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("createFunctionsHandler", () => {
  // audit: false — these suites cover routing/validation/access; the P3.4
  // suite below covers auditing with real (in-memory) stores.
  const handler = createFunctionsHandler({ functions, db: fakeDb, audit: false });

  it("dispatches by the last path segment and wraps output in { data }", async () => {
    const res = await handler(post("echo", { message: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-graft-correlation-id")).toBeTruthy();
    expect(await json(res)).toEqual({ data: { echoed: "hi" } });
  });

  it("builds the standard context: db, actor, branch, correlationId", async () => {
    const res = await handler(post("whoami"));
    const { data } = await json(res);
    expect(data).toMatchObject({ actor: "anonymous", branch: "main", hasDb: true });
    expect(data.correlationId).toBe(res.headers.get("x-graft-correlation-id"));
  });

  it("rejects non-POST with 405 METHOD_NOT_ALLOWED and an Allow header", async () => {
    const res = await handler(new Request("http://localhost/api/fn/echo", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(await json(res)).toMatchObject({ error: "METHOD_NOT_ALLOWED" });
  });

  it("404s an unknown function and lists what exists in fix + details", async () => {
    const res = await handler(post("nope", {}));
    expect(res.status).toBe(404);
    const body = await json(res);
    expect(body.error).toBe("FUNCTION_NOT_FOUND");
    expect(body.fix).toContain("echo");
    expect(body.details.available).toContain("whoami");
  });

  it("400s a non-object body with INPUT_VALIDATION_FAILED", async () => {
    const res = await handler(
      new Request("http://localhost/api/fn/echo", { method: "POST", body: "[1,2]" }),
    );
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: "INPUT_VALIDATION_FAILED" });
  });

  it("400s invalid input listing every violation in details.issues", async () => {
    const res = await handler(post("echo", { message: 7 }));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toBe("INPUT_VALIDATION_FAILED");
    expect(body.details.issues).toEqual([{ path: "message", message: expect.any(String) }]);
  });

  it("treats an empty body as {} so zero-arg functions need no payload", async () => {
    const res = await handler(post("whoami"));
    expect(res.status).toBe(200);
  });

  it("enforces access at the boundary: false → 401 UNAUTHORIZED", async () => {
    const res = await handler(post("secret", {}));
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({
      error: "UNAUTHORIZED",
      details: { function: "secret", actor: "anonymous" },
    });
  });

  it("passes the resolved actor into access + handler (the auth seam)", async () => {
    const authed = createFunctionsHandler({
      functions,
      db: fakeDb,
      audit: false,
      actor: () => ({ kind: "agent", id: "agent-1" }),
    });
    const res = await authed(post("secret", {}));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ data: { ok: true } });
  });

  it("passes GraftErrors from handlers through with their mapped status", async () => {
    const res = await handler(post("gone", {}));
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: "DOCUMENT_NOT_FOUND", fix: "look elsewhere" });
  });

  it("wraps unexpected throws as 500 FUNCTION_EXECUTION_FAILED with correlationId", async () => {
    const res = await handler(post("boom", {}));
    expect(res.status).toBe(500);
    const body = await json(res);
    expect(body.error).toBe("FUNCTION_EXECUTION_FAILED");
    expect(body.message).toContain("kaboom");
    expect(body.details.correlationId).toBe(res.headers.get("x-graft-correlation-id"));
  });

  it("resolves a lazy db factory once and reuses it", async () => {
    let calls = 0;
    const lazy = createFunctionsHandler({
      functions,
      db: () => {
        calls += 1;
        return fakeDb;
      },
      branch: "preview/x",
      audit: false,
    });
    const first = await lazy(post("whoami"));
    const second = await lazy(post("whoami"));
    expect(calls).toBe(1);
    expect((await json(first)).data.branch).toBe("preview/x");
    expect((await json(second)).data.hasDb).toBe(true);
  });

  it("routes by function name, not the record key", async () => {
    const renamed = createFunctionsHandler({
      functions: { anything: echo },
      db: fakeDb,
      audit: false,
    });
    const res = await renamed(post("echo", { message: "x" }));
    expect(res.status).toBe(200);
  });

  it("context type flows: ctx is FunctionContext with validated input", () => {
    // Compile-time check that the handler ctx narrows to the input type.
    defineFunction({
      name: "typed",
      kind: "query",
      input: { n: field.number() },
      handler: (ctx: FunctionContext<{ n: number }>) => ctx.input.n * 2,
    });
    expect(true).toBe(true);
  });
});

describe("secure mutation default (P3.3)", () => {
  const anonymous = createFunctionsHandler({ functions, db: fakeDb, audit: false });
  const authed = createFunctionsHandler({
    functions,
    db: fakeDb,
    audit: false,
    actor: () => ({ kind: "agent", id: "agent-1" }),
  });

  it("rejects anonymous callers of a mutation with 401 and a self-teaching fix", async () => {
    const res = await anonymous(post("guardedMutation", {}));
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.error).toBe("UNAUTHORIZED");
    expect(body.fix).toContain("public: true");
  });

  it("allows authenticated callers of a guarded mutation", async () => {
    const res = await authed(post("guardedMutation", {}));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ data: { ok: true } });
  });

  it("public: true opts a mutation back into anonymous access", async () => {
    const res = await anonymous(post("publicMutation", {}));
    expect(res.status).toBe(200);
  });

  it("a custom access rule overrides the default entirely", async () => {
    const res = await anonymous(post("openByRule", {}));
    expect(res.status).toBe(200);
  });

  it("queries stay open to anonymous callers by default", async () => {
    const res = await anonymous(post("whoami"));
    expect(res.status).toBe(200);
  });

  it("describe() exposes the public flag for introspection", () => {
    expect(publicMutation.describe().public).toBe(true);
    expect(guardedMutation.describe().public).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P3.4 — audit log, rate limits, destructive-op human gate
// ---------------------------------------------------------------------------

const nuke = defineFunction({
  name: "nuke",
  kind: "mutation",
  destructive: true,
  input: { target: field.string() },
  handler: ({ input }) => ({ nuked: input.target }),
});

const limited = defineFunction({
  name: "limited",
  kind: "query",
  rateLimit: { limit: 2, windowSeconds: 60 },
  input: {},
  handler: () => ({ ok: true }),
});

const p34functions = { echo, whoami, guardedMutation, publicMutation, nuke, limited };

interface MemoryAuditEntry extends AuditEntry {
  at: number;
}

/** In-memory stand-ins for the db-backed stores — same contracts, no Postgres. */
function memoryStores() {
  const auditRows: MemoryAuditEntry[] = [];
  const audit: AuditStore = {
    record: async (entry) => {
      auditRows.push({ ...entry, at: Date.now() });
    },
    countSince: async (rateKey, functionName, since) =>
      auditRows.filter(
        (e) => e.rateKey === rateKey && e.functionName === functionName && e.at >= since.getTime(),
      ).length,
  };

  const approvalRows = new Map<
    string,
    { functionName: string; inputCanonical: string; input: Record<string, unknown>; status: string }
  >();
  let seq = 0;
  const approvals: ApprovalStore = {
    request: async (req) => {
      const id = `apr-${++seq}`;
      approvalRows.set(id, {
        functionName: req.functionName,
        inputCanonical: req.inputCanonical,
        input: req.input,
        status: "pending",
      });
      return id;
    },
    consume: async (id, match) => {
      const row = approvalRows.get(id);
      if (!row) return { ok: false, reason: "not_found" };
      if (row.status === "pending") return { ok: false, reason: "pending" };
      if (row.status === "denied") return { ok: false, reason: "denied" };
      if (row.status === "consumed") return { ok: false, reason: "already_consumed" };
      if (row.functionName !== match.functionName || row.inputCanonical !== match.inputCanonical) {
        return { ok: false, reason: "mismatch" };
      }
      row.status = "consumed";
      return { ok: true };
    },
  };

  const approve = (id: string) => {
    const row = approvalRows.get(id);
    if (!row) throw new Error(`no approval ${id}`);
    row.status = "approved";
  };
  const deny = (id: string) => {
    const row = approvalRows.get(id);
    if (!row) throw new Error(`no approval ${id}`);
    row.status = "denied";
  };

  return { audit, approvals, auditRows, approvalRows, approve, deny };
}

function p34handler(
  stores: ReturnType<typeof memoryStores>,
  overrides: Partial<FunctionsHandlerOptions> = {},
) {
  return createFunctionsHandler({
    functions: p34functions,
    db: fakeDb,
    audit: stores.audit,
    approvals: stores.approvals,
    actor: () => ({ kind: "agent", id: "agent-1" }),
    gitSha: "sha-test",
    ...overrides,
  });
}

function postWith(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/fn/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("audit log (P3.4)", () => {
  it("records one row per invocation: ok status, actor, rate key, duration, git SHA", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    const res = await handler(post("echo", { message: "hi" }));
    expect(res.status).toBe(200);
    expect(stores.auditRows).toHaveLength(1);
    expect(stores.auditRows[0]).toMatchObject({
      functionName: "echo",
      functionKind: "query",
      actorKind: "agent",
      actorId: "agent-1",
      rateKey: "agent:agent-1",
      status: "ok",
      gitSha: "sha-test",
      branch: "main",
    });
    expect(stores.auditRows[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(stores.auditRows[0]?.correlationId).toBe(res.headers.get("x-graft-correlation-id"));
  });

  it("records failures with the error code as status (denied mutation, bad input)", async () => {
    const stores = memoryStores();
    const anonymous = p34handler(stores, { actor: () => ({ kind: "anonymous" }) });
    await anonymous(post("guardedMutation", {}));
    await anonymous(post("echo", { message: 7 }));
    expect(stores.auditRows.map((e) => e.status)).toEqual([
      "UNAUTHORIZED",
      "INPUT_VALIDATION_FAILED",
    ]);
  });

  it("keys anonymous callers by client IP", async () => {
    const stores = memoryStores();
    const anonymous = p34handler(stores, { actor: () => ({ kind: "anonymous" }) });
    await anonymous(postWith("echo", { message: "x" }, { "x-forwarded-for": "10.0.0.9, proxy" }));
    expect(stores.auditRows[0]?.rateKey).toBe("ip:10.0.0.9");
  });

  it("does not audit 404s or 405s (no function was targeted)", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    await handler(post("nope", {}));
    await handler(new Request("http://localhost/api/fn/echo", { method: "GET" }));
    expect(stores.auditRows).toHaveLength(0);
  });

  it("a broken audit store never breaks the response", async () => {
    const stores = memoryStores();
    const broken: AuditStore = {
      record: async () => {
        throw new Error("audit db down");
      },
      countSince: stores.audit.countSince,
    };
    const handler = p34handler(stores, { audit: broken });
    const res = await handler(post("echo", { message: "hi" }));
    expect(res.status).toBe(200);
  });

  it("audits a TOKEN_INVALID resolver throw with actor unknown", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores, {
      actor: () => {
        throw new GraftError({ code: "TOKEN_INVALID", message: "bad", fix: "mint a new one" });
      },
    });
    const res = await handler(post("echo", { message: "hi" }));
    expect(res.status).toBe(401);
    expect(stores.auditRows[0]).toMatchObject({ status: "TOKEN_INVALID", actorKind: "unknown" });
  });
});

describe("rate limits (P3.4)", () => {
  it("enforces a per-function limit against the audit rows: 429 + Retry-After", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    expect((await handler(post("limited"))).status).toBe(200);
    expect((await handler(post("limited"))).status).toBe(200);
    const res = await handler(post("limited"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    const body = await json(res);
    expect(body.error).toBe("RATE_LIMITED");
    expect(body.details).toMatchObject({ limit: 2, windowSeconds: 60 });
  });

  it("counts rejected attempts too (a 429 burns budget — no tight-loop retries)", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    for (let i = 0; i < 4; i++) await handler(post("limited"));
    // 2 ok + 2 rate-limited, all audited
    expect(stores.auditRows.filter((e) => e.status === "ok")).toHaveLength(2);
    expect(stores.auditRows.filter((e) => e.status === "RATE_LIMITED")).toHaveLength(2);
  });

  it("limits are per caller: another actor has its own budget", async () => {
    const stores = memoryStores();
    const a = p34handler(stores);
    const b = p34handler(stores, { actor: () => ({ kind: "agent", id: "agent-2" }) });
    await a(post("limited"));
    await a(post("limited"));
    expect((await a(post("limited"))).status).toBe(429);
    expect((await b(post("limited"))).status).toBe(200);
  });

  it("rows outside the window do not count", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    await handler(post("limited"));
    await handler(post("limited"));
    // Age the rows past the 60s window.
    for (const row of stores.auditRows) row.at -= 61_000;
    expect((await handler(post("limited"))).status).toBe(200);
  });

  it("a handler-wide default applies to every function; per-function overrides win", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores, { rateLimit: { limit: 1, windowSeconds: 30 } });
    expect((await handler(post("echo", { message: "a" }))).status).toBe(200);
    expect((await handler(post("echo", { message: "b" }))).status).toBe(429);
    // `limited` has its own {limit: 2} — the default's limit:1 does not apply.
    expect((await handler(post("limited"))).status).toBe(200);
    expect((await handler(post("limited"))).status).toBe(200);
    expect((await handler(post("limited"))).status).toBe(429);
  });

  it("audit: false + rate limits is a config error at creation time", () => {
    expect(() =>
      createFunctionsHandler({
        functions: { echo },
        db: fakeDb,
        audit: false,
        rateLimit: { limit: 5, windowSeconds: 60 },
      }),
    ).toThrowError(/audit/i);
    expect(() =>
      createFunctionsHandler({ functions: { limited }, db: fakeDb, audit: false }),
    ).toThrowError(/audit/i);
  });
});

describe("destructive-op human gate (P3.4)", () => {
  it("files a pending approval and 403s with the id and the human command", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    const res = await handler(post("nuke", { target: "row-1" }));
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body.error).toBe("DESTRUCTIVE_OP_REQUIRES_APPROVAL");
    const id = body.details.approvalId as string;
    expect(stores.approvalRows.get(id)).toMatchObject({
      functionName: "nuke",
      status: "pending",
      input: { target: "row-1" },
    });
    expect(body.fix).toContain(`graft approve ${id}`);
    expect(body.fix).toContain("x-graft-approval");
  });

  it("an approved approval lets the exact same call through, once", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    const first = await json(await handler(post("nuke", { target: "row-1" })));
    const id = first.details.approvalId as string;
    stores.approve(id);

    const ok = await handler(postWith("nuke", { target: "row-1" }, { "x-graft-approval": id }));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ data: { nuked: "row-1" } });

    // One-shot: the same approval cannot authorize a second call.
    const reuse = await handler(postWith("nuke", { target: "row-1" }, { "x-graft-approval": id }));
    expect(reuse.status).toBe(403);
    expect(await json(reuse)).toMatchObject({
      error: "APPROVAL_INVALID",
      details: { reason: "already_consumed" },
    });
  });

  it("input-bound: approve A, execute B is refused and the approval survives", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    const first = await json(await handler(post("nuke", { target: "row-1" })));
    const id = first.details.approvalId as string;
    stores.approve(id);

    const other = await handler(postWith("nuke", { target: "row-2" }, { "x-graft-approval": id }));
    expect(other.status).toBe(403);
    expect(await json(other)).toMatchObject({
      error: "APPROVAL_INVALID",
      details: { reason: "mismatch" },
    });

    // The mismatch did not burn it — the approved call still works.
    const ok = await handler(postWith("nuke", { target: "row-1" }, { "x-graft-approval": id }));
    expect(ok.status).toBe(200);
  });

  it("input binding is canonical: key order does not matter", async () => {
    const stores = memoryStores();
    const twoField = defineFunction({
      name: "wipe",
      kind: "mutation",
      destructive: true,
      input: { a: field.string(), b: field.string() },
      handler: () => ({ ok: true }),
    });
    const handler = p34handler(stores, { functions: { twoField } });
    const first = await json(await handler(post("wipe", { a: "1", b: "2" })));
    stores.approve(first.details.approvalId);
    const res = await handler(
      postWith("wipe", { b: "2", a: "1" }, { "x-graft-approval": first.details.approvalId }),
    );
    expect(res.status).toBe(200);
  });

  it("pending and denied approvals refuse with their reason", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    const first = await json(await handler(post("nuke", { target: "x" })));
    const id = first.details.approvalId as string;

    const pending = await handler(postWith("nuke", { target: "x" }, { "x-graft-approval": id }));
    expect(await json(pending)).toMatchObject({ details: { reason: "pending" } });

    stores.deny(id);
    const denied = await handler(postWith("nuke", { target: "x" }, { "x-graft-approval": id }));
    expect(await json(denied)).toMatchObject({ details: { reason: "denied" } });
  });

  it("approvalPolicy 'human' gates every mutation; queries stay open", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores, { approvalPolicy: "human" });
    expect((await handler(post("echo", { message: "q" }))).status).toBe(200);
    const gated = await handler(post("guardedMutation", {}));
    expect(gated.status).toBe(403);
    expect(await json(gated)).toMatchObject({ error: "DESTRUCTIVE_OP_REQUIRES_APPROVAL" });
  });

  it("refuses to file an approval for a caller with no stable identity", async () => {
    const stores = memoryStores();
    // A trusted issuer can mint a token with no `sub`, and an unauthenticated
    // mount resolves anonymous — both reach here with no id.
    const handler = p34handler(stores, { actor: () => ({ kind: "agent" }) });

    const res = await handler(post("nuke", { target: "row-1" }));

    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: "UNAUTHORIZED" });
    // The point: nothing was filed. An approval with a null requester is
    // decidable by anyone, including whoever asked for it.
    expect(stores.approvalRows.size).toBe(0);
  });

  it("approvalPolicy 'none' (default) leaves non-destructive mutations ungated", async () => {
    const stores = memoryStores();
    const handler = p34handler(stores);
    expect((await handler(post("guardedMutation", {}))).status).toBe(200);
    expect(stores.approvalRows.size).toBe(0);
  });

  it("describe() exposes the destructive flag for introspection", () => {
    expect(nuke.describe().destructive).toBe(true);
    expect(echo.describe().destructive).toBeUndefined();
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});
