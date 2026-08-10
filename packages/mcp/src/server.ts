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
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  contentTypeFor,
  createStorage,
  defaultKeyFor,
  storageConfigFromEnv,
  type Storage,
} from "@usegraft/assets";
import { compile, compileStatic, parseDocument, type CompileResult } from "@usegraft/compiler";
import {
  GraftError,
  type ErrorCode,
  type FieldDescriptor,
  type GraftErrorJSON,
  type SchemaDescription,
} from "@usegraft/contracts";
import {
  APPROVAL_HEADER,
  AssetRef,
  createFunctionsHandler,
  defineFunction,
  field,
  type AnyCollection,
  type AnyGraftFunction,
  type FunctionActor,
  type GraftFunctionsHandler,
  type RateLimit,
} from "@usegraft/core";
import type {
  ApprovalStore,
  AuditStore,
  BranchScope,
  ContentSearchHit,
  Database,
} from "@usegraft/db";
import {
  assertSearchQuery,
  decideApproval,
  listBranches,
  listCompilations,
  listPendingApprovals,
  openStaticIndex,
  resolveBranchScope,
  scopeChain,
  searchContent,
} from "@usegraft/db";
import { describeItem, listItems, loadItem } from "@usegraft/registry";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import matter from "gray-matter";
import { z } from "zod";
import { findDoc, readCollectionDocs, requireCollection } from "./content-files";
import { ERROR_KNOWLEDGE, explainCode } from "./explain";

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

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: GraftError): ToolResult {
  const explanation = ERROR_KNOWLEDGE[error.code];
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { ...error.toJSON(), howToRecover: explanation.howToRecover },
          null,
          2,
        ),
      },
    ],
  };
}

/** Run a tool body, translating GraftErrors into agent-actionable tool failures. */
async function guarded(body: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return ok(await body());
  } catch (error) {
    if (error instanceof GraftError) return fail(error);
    throw error;
  }
}

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
   * Project the content tree into whichever index this server serves. Static
   * artifacts are opened per operation and closed immediately — a SQLite file
   * open is sub-millisecond, and holding no handle keeps the server as
   * stateless as the Postgres path.
   */
  const projectContent = async (): Promise<CompileResult> =>
    staticIndexPath === undefined
      ? compile({ contentDir, collections, db: requireDb("compile", ""), branchId })
      : compileStatic({ contentDir, collections, indexPath: staticIndexPath });

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

  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List every registered content collection (name, description, authority, field count). Start here to learn what kinds of content this project has.",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        branch: branchId,
        collections: Object.values(collections).map((collection) => {
          const descriptor = collection.describe();
          return {
            name: descriptor.name,
            description: descriptor.description,
            authority: descriptor.authority,
            fields: descriptor.fields.length,
          };
        }),
      })),
  );

  server.registerTool(
    "describe_schema",
    {
      title: "Describe the content schema",
      description:
        "Full schema introspection: every collection with its typed fields (name, type, optional, description), plus every registered function (kind, args, public/destructive). Documents also accept an optional kebab-case `slug` (defaults to the filename). Prefer list_functions / describe_function when you only need the function surface.",
      inputSchema: {},
    },
    () =>
      guarded((): SchemaDescription => {
        return {
          collections: Object.values(collections).map((collection) => {
            const descriptor = collection.describe();
            return { ...descriptor, fields: descriptor.fields.map(teachAssetFields) };
          }),
          functions: [...functionsByName.values()].map((fn) => fn.describe()),
        };
      }),
  );

  server.registerTool(
    "list_functions",
    {
      title: "List functions",
      description:
        "List every registered typed function (name, kind, public, destructive, short description). Use describe_function for the full input schema, then run_function to invoke. Mutations reject anonymous callers unless public: true; destructive functions always require human approval (graft approve).",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        branch: branchId,
        functions: [...functionsByName.values()].map((fn) => {
          const d = fn.describe();
          return {
            name: d.name,
            kind: d.kind,
            description: d.description,
            public: d.public,
            destructive: d.destructive,
            args: d.args.length,
          };
        }),
      })),
  );

  server.registerTool(
    "describe_function",
    {
      title: "Describe one function",
      description:
        "Full introspection for one function: kind, args (name/type/optional/description), returns, public, destructive. Use this before run_function so the input object matches the schema.",
      inputSchema: {
        name: z.string().describe("Function name as returned by list_functions"),
      },
    },
    ({ name }) =>
      guarded(() => {
        const fn = functionsByName.get(name);
        if (!fn) {
          throw new GraftError({
            code: "FUNCTION_NOT_FOUND",
            message: `No function named "${name}" is registered.`,
            fix: `Call list_functions and use one of: ${[...functionsByName.keys()].join(", ") || "(none registered)"}.`,
            details: { requested: name, available: [...functionsByName.keys()] },
          });
        }
        return fn.describe();
      }),
  );

  server.registerTool(
    "run_function",
    {
      title: "Run a typed function",
      description:
        "Invoke a defineFunction by name with a JSON input object. Same pipeline as POST /api/fn/<name>: Zod validation, access rules, rate limits, audit log, and the human gate for destructive ops. The server may already act with a configured identity (graft mcp uses GRAFT_DEV_TOKEN; over HTTP your connection's bearer is forwarded) — only pass authorization to override it. Pass approval after a human runs `graft approve <id>` for gated calls. Success returns { data, correlationId }; failures are GraftError JSON with a fix.",
      inputSchema: {
        name: z.string().describe("Function name (defineFunction name, not the export key)"),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Input fields object; defaults to {}. See describe_function for the schema."),
        authorization: z
          .string()
          .optional()
          .describe(
            "Bearer token override (with or without the 'Bearer ' prefix). Usually unnecessary — the server's configured identity applies when omitted.",
          ),
        approval: z
          .string()
          .optional()
          .describe(
            "Approval id from a prior DESTRUCTIVE_OP_REQUIRES_APPROVAL response (after `graft approve <id>`).",
          ),
      },
    },
    ({ name, input, authorization, approval }) =>
      guarded(async () => {
        if (functionsByName.size === 0) {
          throw new GraftError({
            code: "FUNCTION_NOT_FOUND",
            message: "This MCP server has no functions registered.",
            fix: "Export `functions` from graft.config.ts (defineFunction results, often via mergePrimitives) and restart the MCP server / pass them to createGraftMcp({ functions }).",
            details: { requested: name, available: [] },
          });
        }
        if (!functionsByName.has(name)) {
          throw new GraftError({
            code: "FUNCTION_NOT_FOUND",
            message: `No function named "${name}" is registered.`,
            fix: `Call list_functions and use one of: ${[...functionsByName.keys()].join(", ")}.`,
            details: { requested: name, available: [...functionsByName.keys()] },
          });
        }

        // Explicit tool-arg override beats the server's configured identity.
        return invokeFunction(getFunctionsHandler(), name, input ?? {}, {
          credential: authorization ?? options.defaultAuthorization,
          approval,
        });
      }),
  );

  server.registerTool(
    "list_registry",
    {
      title: "List registry items",
      description:
        "List every owned primitive available to `graft add` — shadcn-style copy-in blocks / fields / access rules / bundles (name, type, one-line description, and any registry items it pulls in). Use describe_item for the full details, then install with `graft add <name>` from the CLI. MCP browses what exists; the CLI installs it.",
      inputSchema: {},
    },
    () =>
      guarded(() => ({
        items: listItems(options.registryRoot).map((item) => ({
          name: item.name,
          type: item.type,
          description: item.description,
          registryDependencies: item.registryDependencies,
        })),
      })),
  );

  server.registerTool(
    "describe_item",
    {
      title: "Describe a registry item",
      description:
        "Full details for one owned primitive: type, description, the files it writes into the project, npm dependencies to install, the registry items it pulls in first, and whether it ships an llms.txt fragment. Use list_registry for names; install with `graft add <name>` (CLI). MCP does not install.",
      inputSchema: {
        name: z.string().describe("Item name as returned by list_registry"),
      },
    },
    ({ name }) => guarded(() => describeItem(loadItem(name, options.registryRoot))),
  );

  server.registerTool(
    "list_content",
    {
      title: "List documents in a collection",
      description:
        "List every document in a collection, read from the authored MDX files (git is the source of truth). Returns slug, sourcePath, and frontmatter data.",
      inputSchema: {
        collection: z.string().describe("Collection name, as returned by list_collections"),
      },
    },
    ({ collection: name }) =>
      guarded(() => {
        const collection = requireCollection(collections, name);
        const docs = readCollectionDocs(contentDir, name, collection);
        return {
          collection: name,
          documents: docs.map((doc) => ({
            slug: doc.slug,
            sourcePath: doc.sourcePath,
            data: doc.data,
          })),
        };
      }),
  );

  server.registerTool(
    "get_content",
    {
      title: "Get one document",
      description:
        "Read a single document by collection + slug from the authored MDX files: validated frontmatter data, MDX body, and the file path to edit.",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        slug: z.string().describe("Document slug (kebab-case)"),
      },
    },
    ({ collection: name, slug }) =>
      guarded(() => {
        const collection = requireCollection(collections, name);
        const doc = findDoc(contentDir, name, collection, slug);
        return {
          collection: name,
          slug: doc.slug,
          sourcePath: doc.sourcePath,
          data: doc.data,
          body: doc.body,
        };
      }),
  );

  server.registerTool(
    "search_content",
    {
      title: "Full-text search across content",
      description:
        'Search authored content by words, "quoted phrases", `or`, and -exclusions (websearch syntax). Searches the branch\'s effective content in the compiled Postgres index — on a preview branch that includes documents inherited from parent branches, with branch overrides winning — so results are as fresh as the last compile (write_content compiles automatically); every hit carries the sourcePath of the file to edit. Ranking weights slug matches over frontmatter over body.',
      inputSchema: {
        query: z.string().describe('What to find, e.g. pricing "free tier" -enterprise'),
        collection: z
          .string()
          .optional()
          .describe("Restrict to one collection (default: all registered collections)"),
        limit: z.number().optional().describe("Max hits, best-ranked first (default 20)"),
      },
    },
    ({ query, collection: name, limit }) =>
      guarded(async () => {
        if (name !== undefined) requireCollection(collections, name);
        // Cheap input gates first — an invalid query never pays scope resolution.
        assertSearchQuery(query);
        const collectionNames = name === undefined ? Object.keys(collections) : [name];
        // A static artifact is a single compiled branch, so its "chain" is just
        // this branch; Postgres searches the resolved chain (leaf-first), the
        // same effective content readContent serves: inherited parent docs are
        // found, branch overrides win, tombstones hide (P4.1 overlay semantics).
        const chain = staticIndexPath === undefined ? scopeChain(await getScope()) : [branchId];
        const hits = await searchIndex({ query, chain, collections: collectionNames, limit });
        return {
          branch: branchId,
          chain,
          query,
          hits: hits.map(({ row, rank, snippet }) => ({
            collection: row.collection,
            slug: row.slug,
            sourcePath: row.sourcePath,
            rank,
            snippet,
            data: row.data,
          })),
        };
      }),
  );

  server.registerTool(
    "write_content",
    {
      title: "Write a document (create or update)",
      description:
        "Author or update a document: validates the data against the collection schema, writes <contentDir>/<collection>/<slug>.mdx, and compiles the content tree into the database. Returns exactly what changed. Git is the version history: commit the file afterwards if you have the server's checkout; remote callers can't and needn't — the checkout's operator owns the commit.",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        slug: z
          .string()
          .describe("Document slug — kebab-case; becomes the filename and the URL segment"),
        data: z
          .record(z.string(), z.unknown())
          .describe("Frontmatter data; must satisfy the collection schema (see describe_schema)"),
        body: z.string().optional().describe("MDX body (markdown). Defaults to empty."),
      },
    },
    ({ collection: name, slug, data, body }) =>
      guarded(async () => {
        const collection = requireCollection(collections, name);

        if (collection.authority === "db-authoritative") {
          throw new GraftError({
            code: "AUTHORITY_MISMATCH",
            message: `Collection "${name}" is db-authoritative — its records live in Postgres, not as MDX files.`,
            fix: `Write this data through the collection's function endpoint (POST /api/fn/<name>, see llms.txt) instead of write_content. write_content is only for file-authoritative collections.`,
            details: { collection: name, authority: collection.authority },
          });
        }

        const frontmatterSlug = (data as Record<string, unknown>).slug;
        if (frontmatterSlug !== undefined && frontmatterSlug !== slug) {
          throw new GraftError({
            code: "INVALID_SLUG",
            message: `data.slug ("${String(frontmatterSlug)}") conflicts with the slug argument ("${slug}")`,
            fix: "Omit `slug` from data — the slug argument names the file and the document.",
            details: { slug, frontmatterSlug },
          });
        }

        const sourcePath = `${name}/${slug}.mdx`;
        const raw = matter.stringify(body ?? "", data);
        // Validate before touching disk: schema + slug shape, same path compile uses.
        parseDocument(raw, collection, sourcePath);

        assertSlugFree(contentDir, name, collection, slug, sourcePath);

        mkdirSync(join(contentDir, name), { recursive: true });
        writeFileSync(join(contentDir, ...sourcePath.split("/")), raw);

        const result = await projectContent();
        return {
          written: sourcePath,
          branch: branchId,
          gitSha: result.gitSha,
          changes: result.changes,
        };
      }),
  );

  server.registerTool(
    "delete_content",
    {
      title: "Delete a document (human-gated)",
      description:
        "Delete an authored document: removes <contentDir>/<collection>/<slug>.mdx and compiles, so the index soft-deletes it. DESTRUCTIVE and always human-gated — the first call files an approval and fails with its id; a human decides with `graft approve <id>` (or deny); then retry the SAME collection+slug with `approval: <id>` (the MCP form of the x-graft-approval header). Approvals are one-shot and bound to that exact input. Git is the version history: commit the deletion afterwards if you have the server's checkout; remote callers can't and needn't — the checkout's operator owns the commit.",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        slug: z.string().describe("Document slug to delete"),
        approval: z
          .string()
          .optional()
          .describe(
            "Approval id from a prior DESTRUCTIVE_OP_REQUIRES_APPROVAL response, after a human ran `graft approve <id>`.",
          ),
      },
    },
    ({ collection: name, slug, approval }) =>
      guarded(async () => {
        const collection = requireCollection(collections, name);
        if (collection.authority === "db-authoritative") {
          throw new GraftError({
            code: "AUTHORITY_MISMATCH",
            message: `Collection "${name}" is db-authoritative — its records live in Postgres, not as MDX files.`,
            fix: "Delete records through the collection's typed functions (a destructive defineFunction over deleteRecord — see list_functions), not delete_content. delete_content is only for file-authoritative collections.",
            details: { collection: name, authority: collection.authority },
          });
        }
        // Fail fast on a missing document — never file an approval a human
        // would review for nothing.
        findDoc(contentDir, name, collection, slug);

        const { data, correlationId } = await invokeFunction(
          getDeleteHandler(),
          "delete_content",
          { collection: name, slug },
          { credential: options.defaultAuthorization, approval },
        );
        return { ...(data as Record<string, unknown>), correlationId };
      }),
  );

  server.registerTool(
    "put_asset",
    {
      title: "Upload an asset (image / binary)",
      description:
        "Upload a binary to the asset store and get the frontmatter reference for an `asset` field. Pass `path` (a file on the machine running this MCP server — the stdio case) OR `base64` + `key` (remote agents send the bytes). Refuses to overwrite an existing key unless overwrite: true — the store keeps no version history. Then reference the returned key from an asset field via write_content.",
      inputSchema: {
        key: z
          .string()
          .optional()
          .describe(
            'Asset key — a lowercase path like "pages/pricing/hero.png". Required with base64; defaults to assets/<filename> with path.',
          ),
        path: z
          .string()
          .optional()
          .describe("Path to a file on the MCP server's machine (local/stdio agents)."),
        base64: z
          .string()
          .optional()
          .describe("The file's bytes, base64-encoded (remote/HTTP agents)."),
        contentType: z
          .string()
          .optional()
          .describe("MIME type. Defaults to an inference from the key/path extension."),
        overwrite: z
          .boolean()
          .optional()
          .describe("Replace an existing binary at this key. Off by default."),
      },
    },
    ({ key: keyArg, path, base64, contentType, overwrite }) =>
      guarded(async () => {
        if ((path === undefined) === (base64 === undefined)) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message:
              "Pass exactly one of `path` (a file on the MCP server's machine) or `base64` (the file's bytes).",
            fix: "Local/stdio agents: pass path. Remote/HTTP agents: read the file yourself and pass base64 + key.",
          });
        }

        let bytes: Uint8Array;
        if (path !== undefined) {
          try {
            bytes = readFileSync(path);
          } catch {
            throw new GraftError({
              code: "DOCUMENT_NOT_FOUND",
              message: `File not found: ${path}`,
              fix: "Pass a path to a file that exists on the machine running this MCP server, or send the bytes as base64 instead.",
              details: { path },
            });
          }
        } else {
          if (!/^[A-Za-z0-9+/=\s]+$/.test(base64!)) {
            throw new GraftError({
              code: "INPUT_VALIDATION_FAILED",
              message: "`base64` contains characters outside the base64 alphabet.",
              fix: "Encode the file's raw bytes as standard base64 (A-Z a-z 0-9 + / =). To upload a file by its location on the server's machine, use `path` instead.",
            });
          }
          bytes = Buffer.from(base64!, "base64");
        }

        const key = keyArg ?? (path !== undefined ? defaultKeyFor(path) : undefined);
        if (key === undefined) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: "`key` is required when uploading via base64.",
            fix: 'Pass a lowercase path key naming the asset, e.g. "pages/pricing/hero.png".',
          });
        }
        const keyCheck = AssetRef.shape.key.safeParse(key);
        if (!keyCheck.success) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `"${key}" is not a valid asset key.`,
            fix: 'Use a lowercase path of letters, digits, ".", "_", "-" with "/" separators, each segment starting alphanumeric — e.g. "pages/pricing/hero.png".',
            details: { key },
          });
        }

        const storage = await getStorage();
        if (overwrite !== true && (await storage.exists(key))) {
          throw new GraftError({
            code: "ASSET_EXISTS",
            message: `Asset key "${key}" already holds a binary.`,
            fix: "Pick a distinct key (the store keeps no version history), or pass overwrite: true if replacing the existing binary is the actual intent.",
            details: { key },
          });
        }

        const type = contentType ?? contentTypeFor(key);
        await storage.put(key, bytes, type);
        return {
          key,
          contentType: type,
          bytes: bytes.byteLength,
          url: await storage.url(key),
          frontmatter: `image:\n  key: ${key}\n  alt: describe the image for screen readers`,
        };
      }),
  );

  server.registerTool(
    "list_branches",
    {
      title: "List branches",
      description:
        "List registered content branches (name, parent, backend, status). Same data as GET /api/studio/v1/branches and `graft branch`.",
      inputSchema: {},
    },
    () =>
      guarded(async () => ({
        branches: (
          await listBranches(
            requireDb(
              "list_branches",
              "Copy-on-write preview branches are a database feature; in a static project a branch is simply a git branch, and each checkout compiles its own artifact.",
            ),
          )
        ).map((row) => ({
          name: row.name,
          parent: row.parent,
          backend: row.backend,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
          endpointHost: row.endpointHost,
        })),
      })),
  );

  server.registerTool(
    "list_compilations",
    {
      title: "List compilations",
      description:
        "Recent content projection trail rows (git SHA, added/changed/removed counts), newest first. Same data as GET /api/studio/v1/compilations and `graft compilations`.",
      inputSchema: {
        branch: z.string().optional().describe("Restrict to one branch id (default: all branches)"),
        limit: z.number().optional().describe("Max rows, newest first (default 20, max 100)"),
      },
    },
    ({ branch, limit }) =>
      guarded(async () => ({
        compilations: (
          await listCompilations(
            requireDb(
              "list_compilations",
              "The Postgres index keeps the full projection trail; a static artifact carries only the runs that built it.",
            ),
            {
              branchId: branch,
              limit,
            },
          )
        ).map((row) => ({
          id: row.id,
          branchId: row.branchId,
          gitSha: row.gitSha,
          docCount: row.docCount,
          added: row.added,
          changed: row.changed,
          removed: row.removed,
          createdAt: row.createdAt.toISOString(),
        })),
      })),
  );

  server.registerTool(
    "list_approvals",
    {
      title: "List pending approvals",
      description:
        "Pending human-gated approvals. Decide with decide_approval, Studio Approve/Deny, or `graft approve` / `graft deny`. Same data as GET /api/studio/v1/approvals.",
      inputSchema: {},
    },
    () =>
      guarded(async () => ({
        approvals: (
          await listPendingApprovals(
            requireDb(
              "list_approvals",
              "Approvals gate destructive operations on operational data, which a static project does not have.",
            ),
          )
        ).map((row) => ({
          id: row.id,
          branchId: row.branchId,
          functionName: row.functionName,
          input: row.input,
          requestedByKind: row.requestedByKind,
          requestedById: row.requestedById,
          correlationId: row.correlationId,
          createdAt: row.createdAt.toISOString(),
        })),
      })),
  );

  server.registerTool(
    "decide_approval",
    {
      title: "Approve or deny a pending approval",
      description:
        "Record a human decision on a pending approval (same as Studio Approve/Deny and `graft approve` / `graft deny`). Requires an owner DB role that can UPDATE approvals. The requester cannot decide their own approval.",
      inputSchema: {
        id: z.string().describe("Pending approval id from list_approvals"),
        decision: z.enum(["approved", "denied"]).describe("approved or denied"),
        decidedBy: z
          .string()
          .optional()
          .describe("Operator identity stamp (defaults to mcp-operator)"),
      },
    },
    ({ id, decision, decidedBy }) =>
      guarded(async () => {
        const row = await decideApproval(
          requireDb(
            "decide_approval",
            "Approvals gate destructive operations on operational data, which a static project does not have.",
          ),
          id,
          decision,
          decidedBy?.trim() || "mcp-operator",
        );
        if (!row) {
          throw new GraftError({
            code: "APPROVAL_INVALID",
            message: `No PENDING approval "${id}" exists — it may already be decided, consumed, or mistyped.`,
            fix: "Call list_approvals and use a pending id.",
            details: { id },
          });
        }
        return {
          id: row.id,
          status: row.status,
          decidedBy: row.decidedBy,
          functionName: row.functionName,
        };
      }),
  );

  server.registerTool(
    "explain_error",
    {
      title: "Explain a Graft error",
      description:
        "Given a GraftError code or its JSON, explain what it means, its typical causes, and how to recover. Use whenever a tool call or compile fails.",
      inputSchema: {
        code: z.string().optional().describe("An error code, e.g. SCHEMA_VALIDATION_FAILED"),
        error: z.string().optional().describe("A full GraftError JSON string, if you have one"),
      },
    },
    ({ code, error }) =>
      guarded(() => {
        let parsed: { error?: string; fix?: string; message?: string } | undefined;
        if (error) {
          try {
            parsed = JSON.parse(error);
          } catch {
            /* not JSON — fall through to the code path */
          }
        }
        const effective = code ?? parsed?.error;
        if (!effective) {
          return {
            knownCodes: Object.keys(ERROR_KNOWLEDGE),
            hint: "Pass `code` or the GraftError JSON as `error`.",
          };
        }
        const explanation = explainCode(effective);
        if (!explanation) {
          return {
            code: effective,
            known: false,
            knownCodes: Object.keys(ERROR_KNOWLEDGE),
            hint: "Not a Graft error code. If this came from another system, resolve it there.",
          };
        }
        return {
          ...explanation,
          // The specific fix from the actual error beats the general recovery advice.
          specificFix: parsed?.fix,
          message: parsed?.message,
        };
      }),
  );

  return server;
}

/**
 * Invoke a function through a createFunctionsHandler instance via a synthetic
 * Request — the shared bridge behind run_function and delete_content, so MCP
 * calls take the exact pipeline `POST /api/fn/<name>` takes (validation,
 * access, rate limits, audit, human gate). Failures become GraftErrors.
 */
async function invokeFunction(
  handler: GraftFunctionsHandler,
  name: string,
  input: Record<string, unknown>,
  identity: { credential?: string; approval?: string },
): Promise<{ data: unknown; correlationId?: string; status: number }> {
  const headers = new Headers({ "content-type": "application/json" });
  if (identity.credential) {
    const token = identity.credential.trim();
    headers.set(
      "authorization",
      token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
    );
  }
  if (identity.approval) headers.set(APPROVAL_HEADER, identity.approval);

  const response = await handler(
    new Request(`http://graft.local/fn/${encodeURIComponent(name)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    }),
  );
  const body: unknown = await response.json();
  const correlationId = response.headers.get("x-graft-correlation-id") ?? undefined;

  if (!response.ok) {
    throw graftErrorFromBody(body, correlationId);
  }
  const data =
    body !== null && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : body;
  return { data, correlationId, status: response.status };
}

/**
 * MCP-surface teaching for asset fields. Core's describe() is surface-neutral
 * (a CLI user uploads with `graft asset put`), so describe_schema appends the
 * value shape and the put_asset pointer here — the P6.5 live cold agent had to
 * infer both from existing documents. Recursive: asset fields nest inside
 * object/array fields.
 */
const ASSET_FIELD_HINT =
  "Asset reference: the value is an object { key, alt? }. Upload the file with the put_asset tool first — its response includes the exact snippet to use here.";

function teachAssetFields(fieldDescriptor: FieldDescriptor): FieldDescriptor {
  const taught: FieldDescriptor = {
    ...fieldDescriptor,
    ...(fieldDescriptor.type === "asset"
      ? {
          description: fieldDescriptor.description
            ? `${fieldDescriptor.description} ${ASSET_FIELD_HINT}`
            : ASSET_FIELD_HINT,
        }
      : {}),
  };
  if (fieldDescriptor.fields) taught.fields = fieldDescriptor.fields.map(teachAssetFields);
  if (fieldDescriptor.items) taught.items = teachAssetFields(fieldDescriptor.items);
  return taught;
}

/**
 * The functions handler speaks HTTP — its approval fixes say "retry with the
 * header `x-graft-approval: <id>`". Over MCP there are no headers; the retry
 * carries the `approval` tool argument instead. Translate at the boundary so
 * the error self-teaches on the surface it is actually served on.
 */
function toMcpFix(fix: string | undefined): string | undefined {
  if (!fix) return fix;
  return fix
    .replace(/the header `x-graft-approval: ([^`]+)`/g, 'the `approval` argument set to "$1"')
    .replace(/WITHOUT the x-graft-approval header/g, "WITHOUT the `approval` argument");
}

/** Rebuild a GraftError from a functions-handler / HTTP error body. */
function graftErrorFromBody(body: unknown, correlationId?: string): GraftError {
  if (body !== null && typeof body === "object") {
    const json = body as GraftErrorJSON;
    if (typeof json.error === "string" && typeof json.message === "string") {
      return new GraftError({
        code: json.error as ErrorCode,
        message: json.message,
        fix: toMcpFix(json.fix),
        details: {
          ...json.details,
          ...(correlationId ? { correlationId } : {}),
        },
      });
    }
  }
  return new GraftError({
    code: "FUNCTION_EXECUTION_FAILED",
    message: "Function invocation failed with a non-GraftError response.",
    fix: "Inspect the server logs; retry with list_functions / describe_function to confirm the name and input shape.",
    details: { body, correlationId },
  });
}

/**
 * Reject a write whose slug is already claimed by a different file. Files that
 * currently fail to parse are skipped — they can't reliably claim a slug, and
 * compile() will surface them with their own fix.
 */
function assertSlugFree(
  contentDir: string,
  collectionName: string,
  collection: AnyCollection,
  slug: string,
  targetSourcePath: string,
): void {
  const dir = join(contentDir, collectionName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;

  for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const normalized = name.split("\\").join("/");
    const sourcePath = `${collectionName}/${normalized}`;
    const full = join(dir, name);
    if (sourcePath === targetSourcePath || !/\.mdx?$/.test(name) || statSync(full).isDirectory()) {
      continue;
    }
    let existingSlug: string;
    try {
      existingSlug = parseDocument(readFileSync(full, "utf8"), collection, sourcePath).slug;
    } catch {
      continue;
    }
    if (existingSlug === slug) {
      throw new GraftError({
        code: "SLUG_NOT_UNIQUE",
        message: `Slug "${slug}" in collection "${collectionName}" is already used by ${sourcePath}`,
        fix: `Update that document instead (write_content with slug "${slug}" targets ${targetSourcePath}, but ${sourcePath} owns the slug via frontmatter), or pick a different slug.`,
        details: { slug, collection: collectionName, existing: sourcePath },
      });
    }
  }
}
