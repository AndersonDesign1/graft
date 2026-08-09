/**
 * defineFunction — "everything is code" extended to live, mutating data.
 *
 * A function is a typed unit of server logic: Zod-validated input (the same
 * field.* builders collections use), a handler that receives the standard
 * FunctionContext, and a describe() that yields a @usegraft/contracts
 * FunctionDescriptor so MCP introspection and the CLI agree on shape.
 *
 * LOCKED SHAPE (Phase 3 invariant): functions are served as stateless
 * Web-standard handlers (`Request → Response`, see functions-handler.ts). The
 * db handle is request-scoped and injected — a function never owns a pool or a
 * server, so the same code runs in a Next.js route, the self-host container,
 * Vercel Fluid, or a Worker.
 */
import type { FunctionDescriptor } from "@usegraft/contracts";
import type { Database } from "@usegraft/db";
import { z } from "zod";
import type { FieldsShape } from "./collection";
import { toFieldDescriptor, type FieldDefinition } from "./field";

export type FunctionKind = "query" | "mutation";

/** Max invocations per caller per window; enforced against the audit log. */
export interface RateLimit {
  limit: number;
  windowSeconds: number;
}

/**
 * Who is calling. Anonymous until @usegraft/auth lands (Phase 3 security slice);
 * the shape is locked now so functions written today survive that unit.
 */
export interface FunctionActor {
  kind: "anonymous" | "agent" | "human";
  /** Stable identity (token subject, user id) — absent for anonymous. */
  id?: string;
  scopes?: readonly string[];
}

/** The standard context every function handler receives. */
export interface FunctionContext<TInput = unknown> {
  /** Input already validated against the function's Zod schema. */
  input: TInput;
  /** Request-scoped Drizzle handle (@usegraft/db) — operational data lives behind this. */
  db: Database;
  actor: FunctionActor;
  /** Content/data branch this invocation targets ("main" unless overridden). */
  branch: string;
  /** The raw Web-standard request (headers, URL) — never read the body; input is parsed. */
  request: Request;
  /** Ties this invocation to audit rows and server logs (Phase 3 audit unit). */
  correlationId: string;
}

export interface FunctionConfig<TFields extends Record<string, FieldDefinition>, TOutput> {
  name: string;
  kind: FunctionKind;
  description?: string;
  /** Human/agent-readable description of the return shape (not validated). */
  returns?: string;
  /** Input fields — the same field.* builders collections use (one Zod layer). */
  input: TFields;
  /**
   * Allow anonymous callers. Mutations deny anonymous actors unless this is
   * true; queries are public by default. Ignored when `access` is provided —
   * a custom rule is the whole policy.
   */
  public?: boolean;
  /**
   * Destructive ops are ALWAYS human-gated, regardless of approval policy
   * (Phase 3 invariant): invoking one requires an approved, one-shot approval
   * bound to the exact input (`graft approve` is the human side). Mark
   * anything that deletes or irreversibly overwrites data.
   */
  destructive?: boolean;
  /**
   * Per-function rate limit, counted per caller (actor id, or client IP for
   * anonymous) against the audit log. Overrides the handler-wide default.
   */
  rateLimit?: RateLimit;
  /**
   * Access control at the function boundary. Runs after input validation,
   * before the handler; returning false rejects with UNAUTHORIZED.
   * When omitted, the default applies: mutations require a non-anonymous
   * actor unless `public: true`; queries allow everyone.
   */
  access?: (
    ctx: FunctionContext<z.infer<z.ZodObject<FieldsShape<TFields>>>>,
  ) => boolean | Promise<boolean>;
  /** The logic. Return value must be JSON-serializable (it becomes the response body). */
  handler: (
    ctx: FunctionContext<z.infer<z.ZodObject<FieldsShape<TFields>>>>,
  ) => TOutput | Promise<TOutput>;
}

export interface GraftFunction<
  TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
  TOutput = unknown,
> {
  name: string;
  kind: FunctionKind;
  description?: string;
  returns?: string;
  input: TFields;
  public?: boolean;
  destructive?: boolean;
  rateLimit?: RateLimit;
  /** Zod schema validating a full input payload for this function. */
  schema: z.ZodObject<FieldsShape<TFields>>;
  access?: (
    ctx: FunctionContext<z.infer<z.ZodObject<FieldsShape<TFields>>>>,
  ) => boolean | Promise<boolean>;
  handler: (
    ctx: FunctionContext<z.infer<z.ZodObject<FieldsShape<TFields>>>>,
  ) => TOutput | Promise<TOutput>;
  /** Introspection descriptor — the single source of truth for describe_schema. */
  describe(): FunctionDescriptor;
}

/**
 * A function with any input/output shape — use this (not `GraftFunction`) when
 * accepting heterogeneous functions, e.g. `Record<string, AnyGraftFunction>`
 * in the handler. Mirrors AnyCollection.
 */
// oxlint-disable-next-line no-explicit-any
export type AnyGraftFunction = GraftFunction<any, any>;

/** The inferred, validated input type: `FunctionInput<typeof subscribe>`. */
export type FunctionInput<TFn extends AnyGraftFunction> = z.infer<TFn["schema"]>;

/** The inferred output type: `FunctionOutput<typeof subscribe>`. */
export type FunctionOutput<TFn extends AnyGraftFunction> = Awaited<ReturnType<TFn["handler"]>>;

export function defineFunction<TFields extends Record<string, FieldDefinition>, TOutput>(
  config: FunctionConfig<TFields, TOutput>,
): GraftFunction<TFields, TOutput> {
  const shape = Object.fromEntries(
    Object.entries(config.input).map(([key, def]) => [key, def.zod]),
  ) as FieldsShape<TFields>;
  const schema = z.object(shape);

  return {
    name: config.name,
    kind: config.kind,
    description: config.description,
    returns: config.returns,
    input: config.input,
    public: config.public,
    destructive: config.destructive,
    rateLimit: config.rateLimit,
    schema,
    access: config.access,
    handler: config.handler,
    describe(): FunctionDescriptor {
      const args = Object.entries(config.input).map(([name, def]) => toFieldDescriptor(name, def));
      return {
        name: config.name,
        kind: config.kind,
        args,
        returns: config.returns,
        description: config.description,
        public: config.public,
        destructive: config.destructive,
      };
    },
  };
}
