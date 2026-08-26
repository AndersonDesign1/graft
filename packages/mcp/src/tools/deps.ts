/**
 * What a tool group needs from the server that hosts it.
 *
 * `createGraftMcp` used to register all 18 tools inside one 848-line function
 * body — 72% of the file — so nothing could be read, tested, or reasoned about
 * in isolation, and every change landed in the same place. The external
 * interface is genuinely deep (one small `createGraftMcp(options)` over a lot
 * of behaviour) and does not move; what was missing were INTERNAL seams.
 *
 * This is that seam. The helpers below are the closure `createGraftMcp` built
 * anyway, named and handed over explicitly instead of captured implicitly.
 */
import type { CompileResult } from "@usegraft/compiler";
import type { AnyCollection, AnyGraftFunction, GraftFunctionsHandler } from "@usegraft/core";
import type { BranchScope, ContentSearchHit, Database } from "@usegraft/db";
import type { Storage } from "@usegraft/assets";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GraftMcpOptions } from "../options";

export interface ToolDeps {
  /** The options the server was created with, for tool-specific settings. */
  options: GraftMcpOptions;
  contentDir: string;
  collections: Record<string, AnyCollection>;
  branchId: string;
  /** Set only for static projects; undefined means Postgres. */
  staticIndexPath: string | undefined;

  /** The Postgres handle, or a NEEDS_DATABASE naming the tool that wanted it. */
  requireDb: (feature: string, insteadDo: string) => Database;
  /** Refuse a tool the connection's credential is not scoped for. */
  requireScope: (tool: string, scope: string) => void;
  /** The verified identity a decision is attributed to, or a refusal. */
  requireDecider: () => { kind: string; id: string };

  /** Project the content tree into whichever index this server serves. */
  projectContent: () => Promise<CompileResult>;
  /** Full-text search across the index, Postgres or static. */
  searchIndex: (query: {
    query: string;
    chain: string[];
    collections: string[];
    limit?: number;
  }) => Promise<ContentSearchHit[]>;
  /** The branch scope, resolved once per server. */
  getScope: () => Promise<BranchScope>;

  functions: Record<string, AnyGraftFunction>;
  functionsByName: Map<string, AnyGraftFunction>;
  /** Handler for run_function — the same pipeline POST /api/fn/<name> takes. */
  getFunctionsHandler: () => GraftFunctionsHandler;
  /** Handler for delete_content's synthetic destructive function. */
  getDeleteHandler: () => GraftFunctionsHandler;
  /** The asset store, constructed on first use. */
  getStorage: () => Promise<Storage>;
}

/** Registers one cohesive group of tools onto a server. */
export type RegisterTools = (server: McpServer, deps: ToolDeps) => void;
