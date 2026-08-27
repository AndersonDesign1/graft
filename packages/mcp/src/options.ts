/**
 * How a Graft MCP server is configured.
 *
 * Split out of server.ts so tool modules can name it without importing the
 * server that hosts them.
 */
import type { Storage } from "@usegraft/assets";
import type { AnyCollection, AnyGraftFunction, FunctionActor, RateLimit } from "@usegraft/core";
import type { ApprovalStore, AuditStore, BranchScope, Database } from "@usegraft/db";
import type { MdxTrust } from "@usegraft/mdx-safety";

export interface GraftMcpOptions {
  /** Absolute path to the content root (documents live at <contentDir>/<collection>/<slug>.mdx). */
  contentDir: string;
  collections: Record<string, AnyCollection>;
  /**
   * The Postgres content index. Omit only when serving a static project via
   * `staticIndexPath` — `db` wins if both are somehow set.
   */
  db?: Database;
  /**
   * Path to a compiled static index artifact (.graft/index.db) — the
   * zero-service tier. Authoring works exactly as it does on Postgres (files
   * are the truth, write_content recompiles), and the Postgres-tier tools
   * (functions, branches, approvals, the gated delete) answer NEEDS_DATABASE
   * with the upgrade rather than being silently absent.
   */
  staticIndexPath?: string;
  /**
   * Typed functions from graft.config — enables list_functions / describe_function
   * / run_function and fills describe_schema.functions. Optional so content-only
   * projects still work.
   */
  functions?: Record<string, AnyGraftFunction>;
  /**
   * How much of MDX authored bodies may be, from `mdxTrust` in graft.config.ts.
   * Defaults to "restricted". Applies to the whole tree on every projection,
   * not just to bodies arriving through write_content, because compile re-reads
   * every authored file including the ones that came from git.
   */
  mdxTrust?: MdxTrust;
  /** Content branch to project into. Defaults to "main". */
  branchId?: string;
  /**
   * Resolved read scope for `branchId` (from resolveBranchHandle / resolveBranchScope)
   * — what makes search_content overlay-aware: an overlay branch searches its full
   * ancestor chain, so content inherited from parents is found, branch overrides
   * win, and tombstones hide. When omitted, the server resolves the scope itself
   * on first search (memoized per server instance, like sdk-core's per-client
   * memo), so a bare branchId still searches the branch's effective content.
   */
  scope?: BranchScope;
  /** Server identity reported to MCP clients. */
  name?: string;
  version?: string;
  /**
   * Resolve the caller for run_function (and future gated tools). Same seam as
   * createFunctionsHandler / createGraftMcpHandler. Defaults to anonymous.
   */
  actor?: (request: Request) => FunctionActor | Promise<FunctionActor>;
  /**
   * The identity this connection authenticated as, already resolved.
   *
   * `actor` above resolves a *Request*, which tools do not have — they are
   * JSON-RPC calls on an established connection. Tools that need to know who
   * is calling (rather than merely forwarding a credential) read this instead.
   * The HTTP handler sets it from the bearer it already verified; `graft mcp`
   * sets it from the dev-token identity. Absent means anonymous.
   */
  connectionActor?: FunctionActor;
  /**
   * Directory `put_asset`'s `path` argument may read from, enabling that
   * argument at all.
   *
   * Unset — which is every remote mount — means `put_asset` has no `path`
   * argument: a remote agent sends bytes as base64 or nothing. It used to pass
   * the raw string to readFileSync with no containment whatsoever, upload the
   * result under a key of the caller's choosing, and return a fetchable URL, so
   * `{ path: "/srv/app/.env" }` was a one-call read of DATABASE_URL, dev tokens
   * and S3 credentials on any HTTP-mounted server.
   *
   * `graft mcp` sets it to the project directory: a local agent uploading a
   * hero image from the repo is the case the argument exists for.
   */
  localUploadRoot?: string;
  /** Forwarded to createFunctionsHandler for run_function. */
  approvalPolicy?: "none" | "human";
  rateLimit?: RateLimit;
  gitSha?: string;
  /**
   * Bearer token applied to run_function when the tool call passes no
   * `authorization` — so the credential lives with the server (env/config),
   * not in the agent's context window or MCP transcript. An explicit
   * `authorization` argument still wins. `graft mcp` sets this from
   * GRAFT_DEV_TOKEN; the HTTP handler forwards the caller's own header.
   */
  defaultAuthorization?: string;
  /**
   * Audit / approval stores for run_function. Defaults match createFunctionsHandler
   * (db-backed). Pass `audit: false` in unit tests that do not hit a real DB.
   */
  audit?: AuditStore | false;
  approvals?: ApprovalStore;
  /**
   * Registry root for list_registry / describe_item. Defaults to @usegraft/registry's
   * bundled primitives — the set `graft add` installs from. Tests point it at a fixture.
   */
  registryRoot?: string;
  /**
   * Asset store for put_asset. Defaults to S3_* env config (same rules as
   * `graft asset put`), resolved lazily so content-only servers never need it.
   * Tests inject a fake.
   */
  storage?: Storage | (() => Storage | Promise<Storage>);
}
