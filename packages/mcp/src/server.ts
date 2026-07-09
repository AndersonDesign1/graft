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
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compile, parseDocument } from "@graft/compiler";
import {
  GraftError,
  type ErrorCode,
  type GraftErrorJSON,
  type SchemaDescription,
} from "@graft/contracts";
import {
  createFunctionsHandler,
  type AnyCollection,
  type AnyGraftFunction,
  type FunctionActor,
  type GraftFunctionsHandler,
  type RateLimit,
} from "@graft/core";
import type { ApprovalStore, AuditStore, Database } from "@graft/db";
import { searchContent } from "@graft/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import matter from "gray-matter";
import { z } from "zod";
import { findDoc, readCollectionDocs, requireCollection } from "./content-files";
import { ERROR_KNOWLEDGE, explainCode } from "./explain";

export interface GraftMcpOptions {
  /** Absolute path to the content root (documents live at <contentDir>/<collection>/<slug>.mdx). */
  contentDir: string;
  collections: Record<string, AnyCollection>;
  db: Database;
  /**
   * Typed functions from graft.config — enables list_functions / describe_function
   * / run_function and fills describe_schema.functions. Optional so content-only
   * projects still work.
   */
  functions?: Record<string, AnyGraftFunction>;
  /** Content branch to project into. Defaults to "main". */
  branchId?: string;
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
   * Audit / approval stores for run_function. Defaults match createFunctionsHandler
   * (db-backed). Pass `audit: false` in unit tests that do not hit a real DB.
   */
  audit?: AuditStore | false;
  approvals?: ApprovalStore;
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
  const { contentDir, collections, db } = options;
  const branchId = options.branchId ?? "main";
  const functions = options.functions ?? {};
  const functionsByName = new Map<string, AnyGraftFunction>();
  for (const fn of Object.values(functions)) functionsByName.set(fn.name, fn);

  /** Lazy — only built when run_function is first called. */
  let functionsHandler: GraftFunctionsHandler | undefined;
  const getFunctionsHandler = (): GraftFunctionsHandler => {
    functionsHandler ??= createFunctionsHandler({
      functions,
      db,
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
          collections: Object.values(collections).map((collection) => collection.describe()),
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
        "Invoke a defineFunction by name with a JSON input object. Same pipeline as POST /api/fn/<name>: Zod validation, access rules, rate limits, audit log, and the human gate for destructive ops. Pass authorization (bearer) when the function requires a non-anonymous actor; pass approval after a human runs `graft approve <id>` for gated calls. Success returns { data, correlationId }; failures are GraftError JSON with a fix.",
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
            "Bearer token for gated functions (with or without the 'Bearer ' prefix). Dev: GRAFT_DEV_TOKEN.",
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

        const headers = new Headers({ "content-type": "application/json" });
        if (authorization) {
          const token = authorization.trim();
          headers.set(
            "authorization",
            token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
          );
        }
        if (approval) headers.set("x-graft-approval", approval);

        const response = await getFunctionsHandler()(
          new Request(`http://graft.local/fn/${encodeURIComponent(name)}`, {
            method: "POST",
            headers,
            body: JSON.stringify(input ?? {}),
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
      }),
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
        'Search authored content by words, "quoted phrases", `or`, and -exclusions (websearch syntax). Searches the compiled Postgres index, so results are as fresh as the last compile (write_content compiles automatically); every hit carries the sourcePath of the file to edit. Ranking weights slug matches over frontmatter over body.',
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
        // MCP searches its configured branch directly (single-branch chain);
        // overlay-aware MCP search arrives with branch topology in P4.2.
        const hits = await searchContent(db, {
          query,
          chain: [branchId],
          collections: name === undefined ? Object.keys(collections) : [name],
          limit,
        });
        return {
          branch: branchId,
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
        "Author or update a document: validates the data against the collection schema, writes <contentDir>/<collection>/<slug>.mdx, and compiles the content tree into the database. Returns exactly what changed. Commit the file to git afterwards — git is the version history.",
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

        const result = await compile({ contentDir, collections, db, branchId });
        return {
          written: sourcePath,
          branch: branchId,
          gitSha: result.gitSha,
          changes: result.changes,
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

/** Rebuild a GraftError from a functions-handler / HTTP error body. */
function graftErrorFromBody(body: unknown, correlationId?: string): GraftError {
  if (body !== null && typeof body === "object") {
    const json = body as GraftErrorJSON;
    if (typeof json.error === "string" && typeof json.message === "string") {
      return new GraftError({
        code: json.error as ErrorCode,
        message: json.message,
        fix: json.fix,
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
