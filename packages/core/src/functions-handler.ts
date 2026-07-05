/**
 * createFunctionsHandler — serves defineFunction results as one stateless
 * Web-standard handler (`Request → Response`).
 *
 * RPC over POST: `POST <mount>/<functionName>` with a JSON object body.
 * Success → 200 `{ data: <handler return> }`; failure → GraftError JSON with an
 * agent-actionable `fix`. Every response carries `x-graft-correlation-id`.
 *
 * The handler owns nothing long-lived: the db handle is injected (eagerly or via
 * a lazy factory the app memoizes into), so the same handler runs in a Next.js
 * route, the self-host container, Vercel Fluid, or a Worker — the Phase 3
 * runtime invariant, locked here before the first mutation function exists.
 */
import { GraftError, type ErrorCode } from "@graft/contracts";
import type { Database } from "@graft/db";
import type { AnyGraftFunction, FunctionActor } from "./function";

export interface FunctionsHandlerOptions {
  /** The functions to serve, routed by each function's `name` (not the record key). */
  functions: Record<string, AnyGraftFunction>;
  /** Drizzle handle, or a lazy factory (called once, awaited, then reused). */
  db: Database | (() => Database | Promise<Database>);
  /** Branch invocations target. Defaults to "main". */
  branch?: string;
  /**
   * Resolve the caller from the request — the seam where @graft/auth plugs in
   * (Phase 3 security slice). Defaults to `{ kind: "anonymous" }`.
   */
  actor?: (request: Request) => FunctionActor | Promise<FunctionActor>;
}

export type GraftFunctionsHandler = (request: Request) => Promise<Response>;

const ANONYMOUS: FunctionActor = { kind: "anonymous" };

/** HTTP status for a GraftError code; anything unmapped is a 400. */
const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  FUNCTION_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  TOKEN_INVALID: 401,
  DESTRUCTIVE_OP_REQUIRES_APPROVAL: 403,
  METHOD_NOT_ALLOWED: 405,
  FUNCTION_EXECUTION_FAILED: 500,
};

function errorResponse(
  err: GraftError,
  correlationId: string,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(err.toJSON(), {
    status: ERROR_STATUS[err.code] ?? 400,
    headers: { "x-graft-correlation-id": correlationId, ...extraHeaders },
  });
}

export function createFunctionsHandler(options: FunctionsHandlerOptions): GraftFunctionsHandler {
  const byName = new Map<string, AnyGraftFunction>();
  for (const fn of Object.values(options.functions)) byName.set(fn.name, fn);
  const branch = options.branch ?? "main";

  // Resolve the db once and reuse it; a factory lets the app defer env/connection
  // work to the first invocation (lazy init in serverless routes).
  let dbPromise: Promise<Database> | undefined;
  const getDb = (): Promise<Database> => {
    dbPromise ??= Promise.resolve(typeof options.db === "function" ? options.db() : options.db);
    return dbPromise;
  };

  return async (request: Request): Promise<Response> => {
    const correlationId = crypto.randomUUID();

    if (request.method !== "POST") {
      return errorResponse(
        new GraftError({
          code: "METHOD_NOT_ALLOWED",
          message: `Functions are invoked with POST, not ${request.method}.`,
          fix: "POST a JSON object body to this URL; the last path segment names the function.",
        }),
        correlationId,
        { allow: "POST" },
      );
    }

    const segments = new URL(request.url).pathname.split("/").filter(Boolean);
    const name = segments.at(-1) ?? "";
    const fn = byName.get(name);
    if (!fn) {
      return errorResponse(
        new GraftError({
          code: "FUNCTION_NOT_FOUND",
          message: `No function named "${name}" is registered.`,
          fix: `Call one of the registered functions: ${[...byName.keys()].join(", ") || "(none registered)"}.`,
          details: { requested: name, available: [...byName.keys()] },
        }),
        correlationId,
      );
    }

    let raw: unknown;
    try {
      const text = await request.text();
      raw = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      raw = undefined;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return errorResponse(
        new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `The request body must be a JSON object of ${name}'s input fields.`,
          fix: `Send \`Content-Type: application/json\` with an object body, e.g. {"field": "value"}. An empty body means {}.`,
        }),
        correlationId,
      );
    }

    const parsed = fn.schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      return errorResponse(
        new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `Input for "${name}" failed validation.`,
          fix: "Fix the listed fields (details.issues names each violation) and retry. The function's describe() lists the exact input fields.",
          details: { function: name, issues },
        }),
        correlationId,
      );
    }

    try {
      const [db, actor] = await Promise.all([
        getDb(),
        options.actor ? options.actor(request) : ANONYMOUS,
      ]);
      const ctx = { input: parsed.data, db, actor, branch, request, correlationId };

      // Access policy: a custom rule is the whole policy; otherwise the
      // secure default applies — mutations deny anonymous actors unless the
      // function opts out with `public: true`. Queries default to open (their
      // data is already reachable through the read SDK).
      if (fn.access) {
        if (!(await fn.access(ctx))) {
          return errorResponse(
            new GraftError({
              code: "UNAUTHORIZED",
              message: `The caller is not allowed to invoke "${name}".`,
              fix: "Authenticate as an actor this function's access rule accepts; do not retry anonymously.",
              details: { function: name, actor: actor.kind },
            }),
            correlationId,
          );
        }
      } else if (fn.kind === "mutation" && fn.public !== true && actor.kind === "anonymous") {
        return errorResponse(
          new GraftError({
            code: "UNAUTHORIZED",
            message: `"${name}" is a mutation and rejects anonymous callers by default.`,
            fix: "Send `Authorization: Bearer <token>` for a trusted actor. If anonymous calls are intended (e.g. a public form), set `public: true` in the defineFunction config.",
            details: { function: name, actor: actor.kind },
          }),
          correlationId,
        );
      }

      const data = await fn.handler(ctx);
      return Response.json({ data }, { headers: { "x-graft-correlation-id": correlationId } });
    } catch (err) {
      if (err instanceof GraftError) return errorResponse(err, correlationId);
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(
        new GraftError({
          code: "FUNCTION_EXECUTION_FAILED",
          message: `"${name}" threw while executing: ${message}`,
          fix: "This is a bug in the function's handler (or its environment), not in your input. Check the server logs for this correlationId; fix the handler code and retry.",
          details: { function: name, correlationId },
        }),
        correlationId,
      );
    }
  };
}
