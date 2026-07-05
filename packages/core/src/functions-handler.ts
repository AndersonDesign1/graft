/**
 * createFunctionsHandler — serves defineFunction results as one stateless
 * Web-standard handler (`Request → Response`).
 *
 * RPC over POST: `POST <mount>/<functionName>` with a JSON object body.
 * Success → 200 `{ data: <handler return> }`; failure → GraftError JSON with an
 * agent-actionable `fix`. Every response carries `x-graft-correlation-id`.
 *
 * P3.4 — every invocation of a registered function is audited (one `audit_log`
 * row: actor, rate key, status, duration, git SHA), rate limits are counted
 * against those rows (no in-memory state — handlers stay stateless), and
 * destructive ops are human-gated through one-shot, input-bound approvals
 * (`graft approve` is the human side; retry with `x-graft-approval: <id>`).
 *
 * The handler owns nothing long-lived: the db handle is injected (eagerly or via
 * a lazy factory the app memoizes into), so the same handler runs in a Next.js
 * route, the self-host container, Vercel Fluid, or a Worker — the Phase 3
 * runtime invariant, locked here before the first mutation function exists.
 */
import { GraftError, type ErrorCode } from "@graft/contracts";
import {
  createDbApprovalStore,
  createDbAuditStore,
  type ApprovalStore,
  type AuditStore,
  type Database,
} from "@graft/db";
import type { AnyGraftFunction, FunctionActor, RateLimit } from "./function";

export interface FunctionsHandlerOptions {
  /** The functions to serve, routed by each function's `name` (not the record key). */
  functions: Record<string, AnyGraftFunction>;
  /** Drizzle handle, or a lazy factory (called once, awaited, then reused). */
  db: Database | (() => Database | Promise<Database>);
  /** Branch invocations target. Defaults to "main". */
  branch?: string;
  /**
   * Resolve the caller from the request — the seam where @graft/auth plugs in.
   * Defaults to `{ kind: "anonymous" }`.
   */
  actor?: (request: Request) => FunctionActor | Promise<FunctionActor>;
  /**
   * Audit persistence — one row per invocation of a registered function.
   * Defaults to the db-backed store (`audit_log`). Pass `false` to disable
   * (which also disables rate limiting — its counters are audit rows).
   */
  audit?: AuditStore | false;
  /** Approval persistence for the destructive-op gate. Defaults to db-backed. */
  approvals?: ApprovalStore;
  /**
   * Handler-wide default rate limit, per caller per function; a function's own
   * `rateLimit` overrides it. Requires audit (the default).
   */
  rateLimit?: RateLimit;
  /**
   * Who must approve mutations. "none" (default): only `destructive` functions
   * are human-gated. "human": every mutation requires an approval — the
   * conservative template policy. Destructive ops are gated under BOTH.
   */
  approvalPolicy?: "none" | "human";
  /**
   * Git commit SHA stamped on audit rows (ties invocations to the code that
   * served them). Defaults to VERCEL_GIT_COMMIT_SHA / GITHUB_SHA when present.
   */
  gitSha?: string;
}

export type GraftFunctionsHandler = (request: Request) => Promise<Response>;

/** Header carrying a consumed-on-use approval id for gated invocations. */
export const APPROVAL_HEADER = "x-graft-approval";

const ANONYMOUS: FunctionActor = { kind: "anonymous" };

/** HTTP status for a GraftError code; anything unmapped is a 400. */
const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  FUNCTION_NOT_FOUND: 404,
  DOCUMENT_NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  TOKEN_INVALID: 401,
  RATE_LIMITED: 429,
  DESTRUCTIVE_OP_REQUIRES_APPROVAL: 403,
  APPROVAL_INVALID: 403,
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

/**
 * Deterministic JSON (sorted keys, undefined dropped) — the string an approval
 * binds to, so "approve A, execute B" is structurally impossible.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Best-effort client IP — the rate identity for anonymous callers. */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "local";
}

function defaultGitSha(): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
}

/** Why an approval consume was refused → the agent-actionable next step. */
const APPROVAL_FIX: Record<string, string> = {
  not_found:
    "No approval exists with that id. Call again WITHOUT the x-graft-approval header to request a fresh one.",
  pending:
    "The approval has not been decided yet. A human must run `graft approve <id>` first — wait for them; do not retry until they have.",
  denied: "A human denied this operation. Do not retry it; ask the operator why it was refused.",
  already_consumed:
    "Approvals are one-shot and this one was already used. Call again WITHOUT the x-graft-approval header to request a fresh one.",
  mismatch:
    "The approval was granted for a different function or input than this request. Retry with exactly the input that was approved, or request a new approval for this input.",
};

export function createFunctionsHandler(options: FunctionsHandlerOptions): GraftFunctionsHandler {
  const byName = new Map<string, AnyGraftFunction>();
  for (const fn of Object.values(options.functions)) byName.set(fn.name, fn);
  const branch = options.branch ?? "main";
  const approvalPolicy = options.approvalPolicy ?? "none";
  const gitSha = options.gitSha ?? defaultGitSha() ?? null;

  if (options.audit === false) {
    const limited = options.rateLimit ?? [...byName.values()].find((f) => f.rateLimit);
    if (limited) {
      throw new GraftError({
        code: "CONFIG_INVALID",
        message:
          "Rate limits require the audit log (its rows are the counters), but audit is disabled.",
        fix: "Remove `audit: false` from createFunctionsHandler, or drop the rateLimit configuration.",
      });
    }
  }

  // Resolve the db once and reuse it; a factory lets the app defer env/connection
  // work to the first invocation (lazy init in serverless routes). Stores default
  // to db-backed, so they resolve alongside it.
  let dbPromise: Promise<Database> | undefined;
  const getDb = (): Promise<Database> => {
    dbPromise ??= Promise.resolve(typeof options.db === "function" ? options.db() : options.db);
    return dbPromise;
  };
  let auditStore: AuditStore | undefined;
  let approvalStore: ApprovalStore | undefined;
  const getStores = async (): Promise<{ audit?: AuditStore; approvals: ApprovalStore }> => {
    const db = await getDb();
    if (options.audit !== false) auditStore ??= options.audit ?? createDbAuditStore(db);
    approvalStore ??= options.approvals ?? createDbApprovalStore(db);
    return { audit: options.audit === false ? undefined : auditStore, approvals: approvalStore };
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

    // From here the request targets a real function — everything below lands
    // in the audit log, whatever the outcome.
    const startedAt = Date.now();
    const ip = clientIp(request);
    let actor: FunctionActor | undefined;

    const fail = (err: GraftError, extraHeaders?: Record<string, string>) => ({
      status: err.code as string,
      response: errorResponse(err, correlationId, extraHeaders),
    });

    // Rate identity: the actor when known, the client IP when anonymous.
    const rateKey = (): string =>
      !actor || actor.kind === "anonymous" ? `ip:${ip}` : `${actor.kind}:${actor.id ?? ip}`;

    const invoke = async (): Promise<{ status: string; response: Response }> => {
      const db = await getDb();
      const stores = await getStores();
      actor = options.actor ? await options.actor(request) : ANONYMOUS;

      let raw: unknown;
      try {
        const text = await request.text();
        raw = text.trim() === "" ? {} : JSON.parse(text);
      } catch {
        raw = undefined;
      }
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return fail(
          new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `The request body must be a JSON object of ${name}'s input fields.`,
            fix: `Send \`Content-Type: application/json\` with an object body, e.g. {"field": "value"}. An empty body means {}.`,
          }),
        );
      }

      const parsed = fn.schema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        }));
        return fail(
          new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `Input for "${name}" failed validation.`,
            fix: "Fix the listed fields (details.issues names each violation) and retry. The function's describe() lists the exact input fields.",
            details: { function: name, issues },
          }),
        );
      }

      const ctx = { input: parsed.data, db, actor, branch, request, correlationId };

      // Access policy: a custom rule is the whole policy; otherwise the
      // secure default applies — mutations deny anonymous actors unless the
      // function opts out with `public: true`. Queries default to open (their
      // data is already reachable through the read SDK).
      if (fn.access) {
        if (!(await fn.access(ctx))) {
          return fail(
            new GraftError({
              code: "UNAUTHORIZED",
              message: `The caller is not allowed to invoke "${name}".`,
              fix: "Authenticate as an actor this function's access rule accepts; do not retry anonymously.",
              details: { function: name, actor: actor.kind },
            }),
          );
        }
      } else if (fn.kind === "mutation" && fn.public !== true && actor.kind === "anonymous") {
        return fail(
          new GraftError({
            code: "UNAUTHORIZED",
            message: `"${name}" is a mutation and rejects anonymous callers by default.`,
            fix: "Send `Authorization: Bearer <token>` for a trusted actor. If anonymous calls are intended (e.g. a public form), set `public: true` in the defineFunction config.",
            details: { function: name, actor: actor.kind },
          }),
        );
      }

      // Rate limit — a count of this caller's recent audit rows for this
      // function (every attempt counts, including failed ones).
      const rateLimit = fn.rateLimit ?? options.rateLimit;
      if (rateLimit && stores.audit) {
        const since = new Date(Date.now() - rateLimit.windowSeconds * 1000);
        const used = await stores.audit.countSince(rateKey(), name, since);
        if (used >= rateLimit.limit) {
          return fail(
            new GraftError({
              code: "RATE_LIMITED",
              message: `"${name}" allows ${rateLimit.limit} calls per ${rateLimit.windowSeconds}s per caller; this caller has made ${used}.`,
              fix: `Wait for the window to pass (Retry-After is set) before retrying. Do not tight-loop retries — every attempt, including rejected ones, counts against the limit.`,
              details: {
                function: name,
                limit: rateLimit.limit,
                windowSeconds: rateLimit.windowSeconds,
              },
            }),
            { "retry-after": String(rateLimit.windowSeconds) },
          );
        }
      }

      // Human gate — destructive ops always; every mutation under the "human"
      // policy. An approval is one-shot and bound to this exact input.
      const gated =
        fn.destructive === true || (approvalPolicy === "human" && fn.kind === "mutation");
      if (gated) {
        const inputCanonical = canonicalJson(parsed.data);
        const approvalId = request.headers.get(APPROVAL_HEADER);
        if (!approvalId) {
          const id = await stores.approvals.request({
            branch,
            functionName: name,
            input: parsed.data as Record<string, unknown>,
            inputCanonical,
            requestedByKind: actor.kind,
            requestedById: actor.id ?? null,
            correlationId,
          });
          const why = fn.destructive
            ? "is destructive and always requires human approval"
            : `is a mutation and this deployment's approval policy is "human"`;
          return fail(
            new GraftError({
              code: "DESTRUCTIVE_OP_REQUIRES_APPROVAL",
              message: `"${name}" ${why}. An approval request has been filed.`,
              fix: `Ask a human operator to review it: \`graft approve ${id}\` (or \`graft deny ${id}\`). Once approved, retry this EXACT request with the header \`${APPROVAL_HEADER}: ${id}\`. Approvals are one-shot and bound to this input.`,
              details: { function: name, approvalId: id },
            }),
          );
        }
        const consumed = await stores.approvals.consume(approvalId, {
          functionName: name,
          inputCanonical,
        });
        if (!consumed.ok) {
          return fail(
            new GraftError({
              code: "APPROVAL_INVALID",
              message: `The approval "${approvalId}" cannot authorize this call (${consumed.reason.replace("_", " ")}).`,
              fix: APPROVAL_FIX[consumed.reason] ?? APPROVAL_FIX.not_found!,
              details: { function: name, approvalId, reason: consumed.reason },
            }),
          );
        }
      }

      const data = await fn.handler(ctx);
      return {
        status: "ok",
        response: Response.json({ data }, { headers: { "x-graft-correlation-id": correlationId } }),
      };
    };

    let outcome: { status: string; response: Response };
    try {
      outcome = await invoke();
    } catch (err) {
      if (err instanceof GraftError) {
        outcome = fail(err);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        outcome = fail(
          new GraftError({
            code: "FUNCTION_EXECUTION_FAILED",
            message: `"${name}" threw while executing: ${message}`,
            fix: "This is a bug in the function's handler (or its environment), not in your input. Check the server logs for this correlationId; fix the handler code and retry.",
            details: { function: name, correlationId },
          }),
        );
      }
    }

    // Audit is best-effort: a broken audit store must not take the runtime
    // down with it, but it should be loud in the logs.
    if (options.audit !== false) {
      try {
        const { audit } = await getStores();
        await audit?.record({
          correlationId,
          branch,
          functionName: name,
          functionKind: fn.kind,
          actorKind: actor?.kind ?? "unknown",
          actorId: actor?.id ?? null,
          rateKey: rateKey(),
          status: outcome.status,
          durationMs: Date.now() - startedAt,
          gitSha,
        });
      } catch (auditErr) {
        console.error(`graft audit write failed (correlationId ${correlationId}):`, auditErr);
      }
    }

    return outcome.response;
  };
}
