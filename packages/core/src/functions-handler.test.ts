import { GraftError } from "@graft/contracts";
import type { Database } from "@graft/db";
import { describe, expect, it } from "vitest";
import { field } from "./field";
import { defineFunction, type FunctionContext } from "./function";
import { createFunctionsHandler } from "./functions-handler";

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
  const handler = createFunctionsHandler({ functions, db: fakeDb });

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
    });
    const first = await lazy(post("whoami"));
    const second = await lazy(post("whoami"));
    expect(calls).toBe(1);
    expect((await json(first)).data.branch).toBe("preview/x");
    expect((await json(second)).data.hasDb).toBe(true);
  });

  it("routes by function name, not the record key", async () => {
    const renamed = createFunctionsHandler({ functions: { anything: echo }, db: fakeDb });
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
  const anonymous = createFunctionsHandler({ functions, db: fakeDb });
  const authed = createFunctionsHandler({
    functions,
    db: fakeDb,
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
