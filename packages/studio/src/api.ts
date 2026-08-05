/**
 * HTTP handler for the Studio OpenAPI surface.
 * Shared by `graft studio` and `graft serve --studio`.
 * Reads + mutations (edit content, decide approvals) — same ops as MCP/CLI.
 */
import type { AnyCollection } from "@graft/core";
import {
  decideApproval,
  listBranches,
  listCompilations,
  listPendingApprovals,
  readContent,
  resolveBranchScope,
  type Database,
} from "@graft/db";
import { GraftError } from "@graft/contracts";
import matter from "gray-matter";
import { readRawDocument, requireCollection, writeDocument } from "./content";
import { STUDIO_OPENAPI } from "./openapi";
import type {
  ApprovalList,
  BranchList,
  CompilationList,
  ContentTree,
  DocumentDto,
} from "./types";

export type StudioFetchHandler = (request: Request) => Promise<Response>;

export interface StudioApiOptions {
  db: Database;
  collections: Record<string, AnyCollection>;
  /** Absolute content root — required for get/put document. */
  contentDir: string;
  /** Branch used for compile + tree default. */
  defaultBranch?: string;
  /** Who stamps approval decisions (defaults to "studio"). */
  decidedBy?: string | (() => string);
  authorize?: (request: Request) => boolean | Promise<boolean>;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(error: GraftError, status: number): Response {
  return new Response(JSON.stringify(error.toJSON()), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function statusFor(error: GraftError): number {
  switch (error.code) {
    case "UNAUTHORIZED":
    case "TOKEN_INVALID":
      return 401;
    case "DOCUMENT_NOT_FOUND":
    case "COLLECTION_NOT_FOUND":
    case "APPROVAL_INVALID":
    case "ROUTE_NOT_FOUND":
      return 404;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "APPROVAL_SELF_DECISION":
      return 403;
    case "SCHEMA_VALIDATION_FAILED":
    case "INPUT_VALIDATION_FAILED":
    case "INVALID_SLUG":
    case "AUTHORITY_MISMATCH":
      return 400;
    default:
      return 500;
  }
}

async function buildTree(
  db: Database,
  collections: Record<string, AnyCollection>,
  branch: string,
): Promise<ContentTree> {
  const scope = await resolveBranchScope(db, branch);
  const out: ContentTree["collections"] = [];
  for (const [name, collection] of Object.entries(collections)) {
    const descriptor = collection.describe();
    const rows = await readContent(db, scope, { collection: name });
    out.push({
      name,
      description: descriptor.description,
      documents: rows.map((row) => {
        const title =
          typeof row.data.title === "string"
            ? row.data.title
            : typeof row.data.name === "string"
              ? row.data.name
              : undefined;
        return {
          slug: row.slug,
          sourcePath: row.sourcePath,
          ...(title ? { title } : {}),
        };
      }),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { branch, collections: out };
}

function operator(options: StudioApiOptions): string {
  if (typeof options.decidedBy === "function") return options.decidedBy();
  return options.decidedBy ?? "studio";
}

/** Implements /api/studio/v1/* from openapi.yaml. */
export function createStudioApiHandler(options: StudioApiOptions): StudioFetchHandler {
  const defaultBranch = options.defaultBranch ?? "main";

  return async (request) => {
    try {
      if (options.authorize) {
        const ok = await options.authorize(request);
        if (!ok) {
          throw new GraftError({
            code: "UNAUTHORIZED",
            message: "Studio API requires authentication on this host.",
            fix: "Send Authorization: Bearer <token>, or bind to loopback.",
          });
        }
      }

      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method;

      if (pathname === "/api/studio/v1/openapi.json" && method === "GET") {
        return json(STUDIO_OPENAPI);
      }

      if (pathname === "/api/studio/v1/tree" && method === "GET") {
        const branch = url.searchParams.get("branch")?.trim() || defaultBranch;
        return json(await buildTree(options.db, options.collections, branch));
      }

      if (pathname === "/api/studio/v1/compilations" && method === "GET") {
        const branch = url.searchParams.get("branch")?.trim() || undefined;
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw ? Number(limitRaw) : undefined;
        const rows = await listCompilations(options.db, {
          branchId: branch,
          limit: Number.isFinite(limit) ? limit : undefined,
        });
        const body: CompilationList = {
          compilations: rows.map((row) => ({
            id: row.id,
            branchId: row.branchId,
            gitSha: row.gitSha,
            docCount: row.docCount,
            added: row.added,
            changed: row.changed,
            removed: row.removed,
            createdAt: row.createdAt.toISOString(),
          })),
        };
        return json(body);
      }

      if (pathname === "/api/studio/v1/branches" && method === "GET") {
        const rows = await listBranches(options.db);
        const body: BranchList = {
          branches: rows.map((row) => ({
            name: row.name,
            parent: row.parent,
            backend: row.backend,
            status: row.status,
            createdAt: row.createdAt.toISOString(),
            endpointHost: row.endpointHost,
          })),
        };
        return json(body);
      }

      if (pathname === "/api/studio/v1/approvals" && method === "GET") {
        const rows = await listPendingApprovals(options.db);
        const body: ApprovalList = {
          approvals: rows.map((row) => ({
            id: row.id,
            branchId: row.branchId,
            functionName: row.functionName,
            input: row.input,
            requestedByKind: row.requestedByKind,
            requestedById: row.requestedById,
            correlationId: row.correlationId,
            createdAt: row.createdAt.toISOString(),
          })),
        };
        return json(body);
      }

      const decideMatch = /^\/api\/studio\/v1\/approvals\/([^/]+)\/decide$/.exec(pathname);
      if (decideMatch && method === "POST") {
        const id = decodeURIComponent(decideMatch[1] ?? "");
        const payload = (await request.json()) as {
          decision?: string;
          decidedBy?: string;
        };
        if (payload.decision !== "approved" && payload.decision !== "denied") {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `decision must be "approved" or "denied".`,
            fix: 'POST { "decision": "approved" } or { "decision": "denied" }.',
          });
        }
        const row = await decideApproval(
          options.db,
          id,
          payload.decision,
          payload.decidedBy?.trim() || operator(options),
        );
        if (!row) {
          throw new GraftError({
            code: "APPROVAL_INVALID",
            message: `No PENDING approval "${id}" exists.`,
            fix: "Refresh the approvals list; only pending rows can be decided.",
            details: { id },
          });
        }
        return json({
          id: row.id,
          status: row.status,
          decidedBy: row.decidedBy,
          functionName: row.functionName,
        });
      }

      if (pathname === "/api/studio/v1/document" && method === "GET") {
        const collection = url.searchParams.get("collection")?.trim();
        const slug = url.searchParams.get("slug")?.trim();
        if (!collection || !slug) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: "collection and slug query params are required.",
            fix: "GET /api/studio/v1/document?collection=docs&slug=getting-started",
          });
        }
        const coll = requireCollection(options.collections, collection);
        const doc = readRawDocument(options.contentDir, collection, coll, slug);
        const body: DocumentDto = {
          collection,
          slug,
          sourcePath: doc.sourcePath,
          data: doc.data,
          body: doc.body,
          raw: doc.raw,
        };
        return json(body);
      }

      if (pathname === "/api/studio/v1/document" && method === "PUT") {
        const payload = (await request.json()) as {
          collection?: string;
          slug?: string;
          data?: Record<string, unknown>;
          body?: string;
          /** Full MDX source; when set, parsed with gray-matter (Studio editor). */
          raw?: string;
          branch?: string;
        };
        if (!payload.collection || !payload.slug) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: "collection and slug are required.",
            fix: 'PUT { "collection", "slug", "raw" } or { "collection", "slug", "data", "body?" }.',
          });
        }
        let data = payload.data;
        let body = payload.body ?? "";
        if (typeof payload.raw === "string") {
          const parsed = matter(payload.raw);
          data = parsed.data as Record<string, unknown>;
          body = parsed.content.replace(/^\n/, "");
        }
        if (!data) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: "data or raw is required.",
            fix: 'PUT { "collection", "slug", "raw" } from the Studio editor.',
          });
        }
        const result = await writeDocument({
          contentDir: options.contentDir,
          collections: options.collections,
          db: options.db,
          branchId: payload.branch?.trim() || defaultBranch,
          collection: payload.collection,
          slug: payload.slug,
          data,
          body,
        });
        return json(result);
      }

      throw new GraftError({
        code: "ROUTE_NOT_FOUND",
        message: `Nothing is mounted at ${method} ${pathname}.`,
        fix: "See GET /api/studio/v1/openapi.json for the Studio surface.",
        details: { pathname, method },
      });
    } catch (error) {
      if (error instanceof GraftError) {
        return errorResponse(error, statusFor(error));
      }
      throw error;
    }
  };
}
