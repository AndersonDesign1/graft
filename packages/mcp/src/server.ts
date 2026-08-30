/**
 * The Graft MCP server — the agent surface over a project's content + functions.
 *
 * Tools mirror the file-first model: reads come from the MDX files (git is
 * authoritative), writes go through the same validate → write file → compile
 * pipeline a human uses, so every change lands as a plain file a git commit can
 * carry. Function tools reuse createFunctionsHandler so MCP and HTTP cannot
 * diverge on auth, audit, rate limits, or the human gate. Every failure
 * crossing this boundary is GraftError JSON with a `fix`.
 *
 * See docs/design-notes/agent-mcp.md for the product bar and non-goals.
 */
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { createStorage, storageConfigFromEnv, type Storage } from "@usegraft/assets";
import { compile, compileStatic, type CompileResult } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import {
  createFunctionsHandler,
  defineFunction,
  field,
  type AnyGraftFunction,
  type GraftFunctionsHandler,
} from "@usegraft/core";
import type { BranchScope, ContentSearchHit, Database } from "@usegraft/db";
import { openStaticIndex, resolveBranchScope, searchContent } from "@usegraft/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findDoc, requireCollection } from "./content-hints";
import type { ToolDeps } from "./tools/deps";
import { registerApprovalTools } from "./tools/approvals";
import { registerAssetTools } from "./tools/assets";
import { registerBranchTools } from "./tools/branches";
import { registerContentTools } from "./tools/content";
import { registerErrorTools } from "./tools/errors";
import { registerFunctionTools } from "./tools/functions";
import { registerIntrospectionTools } from "./tools/introspection";
import { createApprovalElicitor } from "./approval-elicitation";
import { registerContentPrompts } from "./tools/prompts";
import { registerRegistryTools } from "./tools/registry";
import { registerContentResources } from "./tools/resources";
import type { GraftMcpOptions } from "./options";

export type { GraftMcpOptions } from "./options";

export function createGraftMcp(options: GraftMcpOptions): McpServer {
  const { contentDir, collections } = options;
  const branchId = options.branchId ?? "main";

  // Which index this server serves. Static projects have no database at all, so
  // every Postgres-tier tool routes through requireDb() and teaches the upgrade
  // instead of throwing something opaque about a missing connection.
  const staticIndexPath = options.db === undefined ? options.staticIndexPath : undefined;
  const maybeDb = options.db;
  if (maybeDb === undefined && staticIndexPath === undefined) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: "createGraftMcp needs an index: pass `db` (Postgres) or `staticIndexPath`.",
      fix: "Pass `db` from createDb(DATABASE_URL), or `staticIndexPath` pointing at the compiled artifact (.graft/index.db) for a static project.",
    });
  }

  /** The Postgres handle, or a NEEDS_DATABASE that names the tool that wanted it. */
  const requireDb = (feature: string, insteadDo: string): Database => {
    if (maybeDb !== undefined) return maybeDb;
    throw new GraftError({
      code: "NEEDS_DATABASE",
      message: `${feature} needs the Postgres index; this project serves a static index (${staticIndexPath}).`,
      fix: `${insteadDo} To move this project to the Postgres tier: set DATABASE_URL, change graft.config to \`export const index = "postgres"\`, run \`graft db migrate\`, then \`graft compile\`.`,
      details: { feature, index: "static" },
    });
  };

  /**
   * Refuse a tool the connection's credential is not scoped for.
   *
   * Scopes were only ever consulted inside `run_function`'s access rules, so
   * every other tool — write_content, put_asset, delete_content,
   * decide_approval — was available to ANY authenticated caller regardless of
   * what their token permitted. An app that hands every signed-up user a
   * narrow read token was thereby handing out content-admin rights.
   *
   * An unauthenticated connection is only possible where the mount opted into
   * it (loopback dev), and there it is unscoped by construction: nothing to
   * check against, so nothing is refused.
   */
  const requireScope = (tool: string, scope: string): void => {
    const actor = options.connectionActor;
    if (actor === undefined) {
      // No connection identity. That means one of two very different things.
      //
      // No actor resolver either: an unauthenticated mount that opted into
      // serving anonymous callers. There is nothing to check a scope against,
      // and refusing would break local development for no gain.
      if (options.actor === undefined) return;

      // A resolver IS configured, so this mount intends to authenticate — but
      // whoever wired it did not forward the resolved identity, and every
      // scope check would silently pass. That is a wiring bug, and it shipped
      // in one of our own examples, so it fails closed rather than quietly.
      throw new GraftError({
        code: "CONFIG_INVALID",
        message: `${tool} cannot be authorized: this server has an actor resolver but was given no connectionActor.`,
        fix: "Pass `connectionActor` alongside `actor` when building the server — createGraftMcpHandler does this for you from the bearer it verified. Without it every scope check passes and write tools are ungated.",
        details: { tool, required: scope },
      });
    }
    if (actor.kind === "anonymous") return;
    if ((actor.scopes ?? []).includes(scope)) return;
    throw new GraftError({
      code: "UNAUTHORIZED",
      message: `${tool} requires the "${scope}" scope, and this credential does not carry it.`,
      fix: `Mint a token whose scope claim includes "${scope}" (for \`graft serve\`, add it to GRAFT_DEV_SCOPES). Content authoring, asset upload and approval decisions are deliberately separate from ordinary read scopes.`,
      details: { tool, required: scope, held: actor.scopes ?? [] },
    });
  };

  /**
   * The identity a decision is attributed to, or a refusal naming why there is
   * none. Deliberately derived from the connection rather than the tool call:
   * `decided_by` is the value the separation-of-duties predicate compares
   * against `requested_by_id`, so a caller who could name it could always name
   * someone else and approve their own request.
   */
  const requireDecider = (): { kind: string; id: string } => {
    const actor = options.connectionActor;
    if (actor === undefined || actor.kind === "anonymous" || !actor.id) {
      throw new GraftError({
        code: "UNAUTHORIZED",
        message:
          "decide_approval needs to know who is deciding, and this connection is not authenticated as anyone.",
        fix: "Connect with `Authorization: Bearer <token>` from a trusted issuer (or set GRAFT_DEV_TOKEN for `graft mcp`). Deciding anonymously would make the requester-cannot-decide check meaningless, so it is refused rather than attributed to a placeholder.",
        details: { tool: "decide_approval", actor: actor?.kind ?? "anonymous" },
      });
    }
    return { kind: actor.kind, id: actor.id };
  };

  /**
   * Project the content tree into whichever index this server serves. Static
   * artifacts are opened per operation and closed immediately — a SQLite file
   * open is sub-millisecond, and holding no handle keeps the server as
   * stateless as the Postgres path.
   */
  const projectContent = async (): Promise<CompileResult> =>
    staticIndexPath === undefined
      ? compile({
          contentDir,
          collections,
          db: requireDb("compile", ""),
          branchId,
          mdxTrust: options.mdxTrust,
        })
      : compileStatic({
          contentDir,
          collections,
          indexPath: staticIndexPath,
          mdxTrust: options.mdxTrust,
        });

  /** Search whichever index this server serves; the static artifact is opened per call. */
  const searchIndex = async (query: {
    query: string;
    chain: string[];
    collections: string[];
    limit?: number;
  }): Promise<ContentSearchHit[]> => {
    if (staticIndexPath === undefined) {
      return searchContent(requireDb("search_content", ""), query);
    }
    const index = await openStaticIndex(staticIndexPath);
    try {
      return await index.searchContent({
        query: query.query,
        collections: query.collections,
        limit: query.limit,
      });
    } finally {
      await index.close();
    }
  };
  const functions = options.functions ?? {};
  const functionsByName = new Map<string, AnyGraftFunction>();
  for (const fn of Object.values(functions)) functionsByName.set(fn.name, fn);

  /**
   * The read scope search runs through. Callers that already hold a resolved
   * BranchHandle (graft mcp) pass its scope; otherwise resolve lazily and once —
   * an HTTP-handler server is per-request anyway, so topology changes are picked
   * up on the next request.
   */
  let scopePromise: Promise<BranchScope> | undefined;
  const getScope = (): Promise<BranchScope> => {
    scopePromise ??= options.scope
      ? Promise.resolve(options.scope)
      : resolveBranchScope(requireDb("Branch scope resolution", ""), branchId);
    return scopePromise;
  };

  /** Lazy — only built when run_function is first called. */
  let functionsHandler: GraftFunctionsHandler | undefined;
  const getFunctionsHandler = (): GraftFunctionsHandler => {
    functionsHandler ??= createFunctionsHandler({
      functions,
      db: requireDb(
        "run_function",
        "Typed functions read and write operational data in Postgres, so a static project has none.",
      ),
      branch: branchId,
      actor: options.actor,
      approvalPolicy: options.approvalPolicy,
      rateLimit: options.rateLimit,
      gitSha: options.gitSha,
      audit: options.audit,
      approvals: options.approvals,
    });
    return functionsHandler;
  };

  /**
   * delete_content as an internal destructive function, served by its own
   * handler instance (never mixed into the project's functions, so it cannot
   * collide with a user function or appear in list_functions). Routing through
   * createFunctionsHandler is what makes the delete ride the P3.4 machinery —
   * one-shot input-bound approvals, audit rows, rate limits — instead of a
   * reimplementation that could drift. `public` because the human approval IS
   * the gate: requiring a bearer as well would brick anonymous local stdio
   * servers without making the delete any less human-controlled.
   */
  const deleteContentFn = defineFunction({
    name: "delete_content",
    kind: "mutation",
    destructive: true,
    public: true,
    description: "Delete an authored MDX document and recompile (MCP delete_content tool).",
    returns: "{ deleted, branch, gitSha, changes }",
    input: {
      collection: field.string({ description: "Collection name" }),
      slug: field.string({ description: "Document slug to delete" }),
    },
    handler: async ({ input }) => {
      // Re-resolve at execution time — the tree may have changed since the
      // approval was filed; the file named by the approval must still exist.
      const collection = requireCollection(collections, input.collection);
      const doc = findDoc(contentDir, input.collection, collection, input.slug);
      unlinkSync(join(contentDir, ...doc.sourcePath.split("/")));
      const result = await projectContent();
      return {
        deleted: doc.sourcePath,
        branch: branchId,
        gitSha: result.gitSha,
        changes: result.changes,
      };
    },
  });
  let deleteHandler: GraftFunctionsHandler | undefined;
  const getDeleteHandler = (): GraftFunctionsHandler => {
    deleteHandler ??= createFunctionsHandler({
      // The one-shot, input-bound human approval lives in Postgres. Rather than
      // silently downgrading to an ungated delete, a static project is told to
      // do it the way git already makes safe: delete the file and recompile.
      db: requireDb(
        "delete_content",
        "Its human approval gate is a Postgres table, and dropping the gate would make the delete ungated. In a static project, delete the file and recompile — git is authoritative, so the file IS the document and git history is the undo.",
      ),
      functions: { delete_content: deleteContentFn },
      branch: branchId,
      actor: options.actor,
      rateLimit: options.rateLimit,
      gitSha: options.gitSha,
      audit: options.audit,
      approvals: options.approvals,
    });
    return deleteHandler;
  };

  /** Lazy asset store — content-only servers never pay for (or require) S3 config. */
  let storagePromise: Promise<Storage> | undefined;
  const getStorage = (): Promise<Storage> => {
    storagePromise ??= (async () => {
      if (options.storage) {
        return typeof options.storage === "function" ? options.storage() : options.storage;
      }
      try {
        return createStorage(storageConfigFromEnv());
      } catch (error) {
        throw new GraftError({
          code: "ENV_VAR_MISSING",
          message: error instanceof Error ? error.message : String(error),
          fix: "Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET in the MCP server's environment (.env), then retry.",
          details: { variables: ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] },
        });
      }
    })();
    return storagePromise;
  };

  const server = new McpServer({
    name: options.name ?? "graft",
    version: options.version ?? "0.0.0",
  });

  // The closure these tools used to capture implicitly, named and handed over.
  // The external interface (`createGraftMcp(options)`) is unchanged — this is
  // an internal seam, so the existing tests verify the move for free.
  const deps: ToolDeps = {
    options,
    contentDir,
    collections,
    branchId,
    staticIndexPath,
    requireDb,
    requireScope,
    requireDecider,
    projectContent,
    searchIndex,
    getScope,
    functions,
    functionsByName,
    getFunctionsHandler,
    getDeleteHandler,
    getStorage,
    // Absent unless the mount opted in. The default stays the out-of-band
    // flow, which is the one a remote agent with no human attached must get.
    elicitApproval: options.approvalElicitation
      ? createApprovalElicitor({
          server,
          db: () =>
            requireDb(
              "approval elicitation",
              "Approvals gate destructive operations on operational data, which a static project does not have.",
            ),
          decider: options.approvalElicitation.decider,
        })
      : undefined,
  };

  registerIntrospectionTools(server, deps);
  registerFunctionTools(server, deps);
  registerRegistryTools(server, deps);
  registerContentTools(server, deps);
  registerAssetTools(server, deps);
  registerBranchTools(server, deps);
  registerApprovalTools(server, deps);
  registerErrorTools(server, deps);
  // Not tool groups. Resources make documents addressable, so a client can
  // attach one as context instead of spending a turn fetching it; prompts
  // offer the project's workflows filled in from the live schema.
  registerContentResources(server, deps);
  registerContentPrompts(server, deps);

  return server;
}
