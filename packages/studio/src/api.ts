/**
 * HTTP handler for the Studio OpenAPI surface.
 * Shared by `graft studio` and `graft serve --studio`.
 * Reads + mutations (edit content, decide approvals) — same ops as MCP/CLI.
 */
import { compile } from "@graft/compiler";
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
import { readCollectionDocs, readRawDocument, requireCollection, writeDocument } from "./content";
import { STUDIO_OPENAPI } from "./openapi";
import { preflightRevert, revertContentTo } from "./revert";
import type {
  ApprovalList,
  BranchList,
  CompilationList,
  CompileResultDto,
  ContentTree,
  ContentTreeCollection,
  ContentTreeDoc,
  DocumentDto,
  DocumentState,
  RevertPreviewDto,
  RevertResultDto,
  SchemaCollectionDto,
  SchemaFieldDto,
  SchemaList,
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

function titleOf(data: Record<string, unknown>): string | undefined {
  if (typeof data.title === "string") return data.title;
  if (typeof data.name === "string") return data.name;
  return undefined;
}

/** Conventional ordering frontmatter, when the collection uses it. */
function placementOf(data: Record<string, unknown>): { section?: string; order?: number } {
  return {
    ...(typeof data.section === "string" ? { section: data.section } : {}),
    ...(typeof data.order === "number" ? { order: data.order } : {}),
  };
}

/**
 * Publication order: section (in the collection's declared reading order),
 * then explicit order, then title.
 *
 * This is the default the Studio lists in, because it is the order the
 * operator sees on the site — alphabetical is only useful for hunting a known
 * name, which is what search is for.
 *
 * Section order cannot be inferred from the documents: `order` restarts inside
 * each section, so every section has a "1". It has to be declared, which is
 * what `collection.sections` is for. Without it we fall back to alphabetical,
 * which is at least stable. Documents with no `order` sort after those that
 * have one, so adding `order` to a single page promotes it rather than
 * reshuffling everything around it.
 */
function bySiteOrder(sections: readonly string[] | undefined) {
  const rank = (section: string | undefined): number => {
    if (!sections?.length) return 0;
    const i = sections.indexOf(section ?? "");
    // Unlisted sections sort last rather than vanishing.
    return i === -1 ? sections.length : i;
  };

  return (a: ContentTreeDoc, b: ContentTreeDoc): number => {
    const byRank = rank(a.section) - rank(b.section);
    if (byRank !== 0) return byRank;
    const byName = (a.section ?? "").localeCompare(b.section ?? "");
    if (byName !== 0) return byName;
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return (a.title ?? a.slug).localeCompare(b.title ?? b.slug);
  };
}

/**
 * One collection's documents, merging what is on disk with what is indexed.
 *
 * This is deliberately filesystem-first. Graft content is git-authoritative:
 * the `.mdx` files are truth and `content_index` is a projection that only
 * exists after `graft compile`. Reading the index alone — which is what this
 * used to do — meant a project that had authored content but never compiled
 * showed zero documents, with no way to tell that apart from genuinely having
 * none. Now every on-disk file appears immediately and carries its own state.
 */
async function buildFileCollection(
  db: Database,
  scope: Awaited<ReturnType<typeof resolveBranchScope>>,
  contentDir: string,
  name: string,
  collection: AnyCollection,
): Promise<ContentTreeDoc[]> {
  const disk = readCollectionDocs(contentDir, name, collection);
  const indexed = await readContent(db, scope, { collection: name });
  const bySlug = new Map(indexed.map((row) => [row.slug, row]));

  const docs: ContentTreeDoc[] = disk.map((doc) => {
    const row = bySlug.get(doc.slug);
    bySlug.delete(doc.slug);
    const state: DocumentState = !row
      ? "unindexed"
      : row.contentHash === doc.contentHash
        ? "synced"
        : "drifted";
    return {
      slug: doc.slug,
      sourcePath: doc.sourcePath,
      state,
      ...(titleOf(doc.data) ? { title: titleOf(doc.data) } : {}),
      ...(row?.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}),
      ...placementOf(doc.data),
    };
  });

  // Whatever is left in the index has no file behind it any more. Showing it
  // as `orphaned` beats silently dropping it — a stale index is the operator's
  // problem to see, not ours to hide.
  for (const row of bySlug.values()) {
    const data = row.data as Record<string, unknown>;
    docs.push({
      slug: row.slug,
      sourcePath: row.sourcePath,
      state: "orphaned",
      ...(titleOf(data) ? { title: titleOf(data) } : {}),
      updatedAt: row.updatedAt.toISOString(),
      ...placementOf(data),
    });
  }

  return docs.sort(bySiteOrder(collection.sections));
}

async function buildTree(
  db: Database,
  collections: Record<string, AnyCollection>,
  contentDir: string,
  branch: string,
): Promise<ContentTree> {
  const scope = await resolveBranchScope(db, branch);
  const out: ContentTreeCollection[] = [];

  for (const [name, collection] of Object.entries(collections)) {
    const descriptor = collection.describe();
    const isDb = collection.authority === "db-authoritative";
    let documents: ContentTreeDoc[] = [];
    let error: string | undefined;

    try {
      if (isDb) {
        // Rows live in data_records, reached through typed functions — there
        // are no files to compare against, so state is not meaningful here.
        documents = [];
      } else {
        documents = await buildFileCollection(db, scope, contentDir, name, collection);
      }
    } catch (err) {
      // One unparseable document must degrade its own collection, not blank
      // the entire tree — the old behaviour 500'd the whole request.
      error = err instanceof Error ? err.message : String(err);
    }

    out.push({
      name,
      ...(descriptor.description ? { description: descriptor.description } : {}),
      authority: isDb ? "db" : "file",
      documents,
      driftCount: documents.filter((d) => d.state !== "synced").length,
      ...(error ? { error } : {}),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));

  const all = out.flatMap((c) => c.documents);
  const count = (state: DocumentState): number =>
    all.reduce((n, d) => n + (d.state === state ? 1 : 0), 0);
  const drifted = count("drifted");
  const unindexed = count("unindexed");
  const orphaned = count("orphaned");

  return {
    branch,
    collections: out,
    summary: {
      documents: all.length,
      synced: count("synced"),
      drifted,
      unindexed,
      orphaned,
      drift: drifted + unindexed + orphaned,
    },
  };
}

function toSchemaField(field: {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
  fields?: unknown;
  items?: unknown;
}): SchemaFieldDto {
  const nested = field.fields as SchemaFieldDto[] | undefined;
  const items = field.items as SchemaFieldDto | undefined;
  return {
    name: field.name,
    type: field.type,
    optional: field.optional,
    ...(field.description ? { description: field.description } : {}),
    ...(nested ? { fields: nested.map(toSchemaField) } : {}),
    ...(items ? { items: toSchemaField(items) } : {}),
  };
}

function buildSchema(collections: Record<string, AnyCollection>): SchemaList {
  const out: SchemaCollectionDto[] = Object.values(collections).map((collection) => {
    const descriptor = collection.describe();
    return {
      name: descriptor.name,
      ...(descriptor.description ? { description: descriptor.description } : {}),
      authority: descriptor.authority === "db-authoritative" ? "db" : "file",
      authorityRaw: descriptor.authority,
      fields: descriptor.fields.map(toSchemaField),
    };
  });
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { collections: out };
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
        return json(
          await buildTree(options.db, options.collections, options.contentDir, branch),
        );
      }

      if (pathname === "/api/studio/v1/collections" && method === "GET") {
        return json(buildSchema(options.collections));
      }

      // Operator-triggered compile. The Studio surfaces drift, so it has to be
      // able to resolve it too — sending someone to a terminal to fix a thing
      // the dashboard just told them about is a dead end.
      if (pathname === "/api/studio/v1/compile" && method === "POST") {
        const payload = (await request.json().catch(() => ({}))) as { branch?: string };
        const branch =
          payload.branch?.trim() || url.searchParams.get("branch")?.trim() || defaultBranch;
        const result = await compile({
          contentDir: options.contentDir,
          collections: options.collections,
          db: options.db,
          branchId: branch,
        });
        const body: CompileResultDto = {
          branch,
          gitSha: result.gitSha ?? null,
          added: result.changes.added.length,
          changed: result.changes.changed.length,
          removed: result.changes.removed.length,
          docCount: result.count,
        };
        return json(body);
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

      // Revert is the payoff of git-authoritative content: a compilation
      // records the SHA it read, so "go back" restores real files rather than
      // replaying an undo stack. GET previews whether it is safe; POST does it.
      const revertMatch = /^\/api\/studio\/v1\/compilations\/([^/]+)\/revert$/.exec(pathname);
      if (revertMatch && (method === "GET" || method === "POST")) {
        const id = decodeURIComponent(revertMatch[1] ?? "");
        const rows = await listCompilations(options.db, { limit: 500 });
        const row = rows.find((candidate) => candidate.id === id);
        if (!row) {
          throw new GraftError({
            code: "DOCUMENT_NOT_FOUND",
            message: `No compilation "${id}".`,
            fix: "Refresh History; the trail may have been pruned.",
            details: { id },
          });
        }

        if (method === "GET") {
          const pre = await preflightRevert(options.contentDir, row.gitSha);
          const body: RevertPreviewDto = {
            compilationId: row.id,
            gitSha: row.gitSha,
            shortSha: pre.shortSha,
            reachable: pre.reachable,
            dirty: pre.dirty,
            canRevert: pre.reachable && pre.dirty.length === 0,
            createdAt: row.createdAt.toISOString(),
          };
          return json(body);
        }

        const changed = await revertContentTo(options.contentDir, row.gitSha as string);
        // Recompile only after the files landed, so the index can never
        // describe content that failed to write.
        const result = await compile({
          contentDir: options.contentDir,
          collections: options.collections,
          db: options.db,
          branchId: row.branchId,
        });
        const body: RevertResultDto = {
          compilationId: row.id,
          gitSha: row.gitSha,
          branch: row.branchId,
          filesChanged: changed,
          added: result.changes.added.length,
          changed: result.changes.changed.length,
          removed: result.changes.removed.length,
          docCount: result.count,
        };
        return json(body);
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
