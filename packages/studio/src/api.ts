/**
 * HTTP handler for the Studio OpenAPI surface.
 * Shared by `graft studio` and `graft serve --studio`.
 * Reads + mutations (edit content, decide approvals) — same ops as MCP/CLI.
 */
import { compile } from "@usegraft/compiler";
import type { AnyCollection } from "@usegraft/core";
import {
  decideApproval,
  type ApprovalDecider,
  listBranches,
  listCompilations,
  listPendingApprovals,
  readContent,
  resolveBranchScope,
  type Database,
} from "@usegraft/db";
import { EditorComponentSpec, GraftError, type EditorComponentList } from "@usegraft/contracts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { readCollectionDocs, readRawDocument, requireCollection, writeDocument } from "./content";
import { STUDIO_OPENAPI } from "./openapi";
import { commitChanges, readChanges, readFileDiff } from "./git";
import { preflightRevert, revertContentTo } from "./revert";
import type {
  ApprovalList,
  BranchList,
  CommitResultDto,
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
  /**
   * Absolute project root — where `graft/` lives. Used to read the project's
   * own `graft/editor/*.json` component declarations. Defaults to the content
   * directory's parent, which is the layout `graft init` scaffolds.
   */
  projectRoot?: string;
  /** Branch used for compile + tree default. */
  defaultBranch?: string;
  /**
   * Identity that approval decisions are attributed to, resolved when the
   * Studio is mounted — never from the request.
   *
   * `decided_by` is the value the separation-of-duties predicate compares
   * against `requested_by_id`, so a request that could name it could always
   * name someone other than itself and approve its own destructive operation.
   * `graft studio` passes the OS user; `graft serve --studio` passes the
   * service identity it runs as.
   */
  decider?: ApprovalDecider | (() => ApprovalDecider);
  /**
   * Resolve who is calling, or `null` to refuse the request.
   *
   * Deliberately not `(request) => boolean`. "May this actor do *this
   * particular thing*" cannot be expressed in one boolean decided per handler,
   * so callers of the boolean version invented their own policy — and what
   * `graft serve` invented was `actor.kind !== "anonymous"`, which admitted
   * every agent to the approve/deny surface.
   *
   * Omitted means the mount is unauthenticated, which is only appropriate on
   * loopback.
   */
  authenticate?: (request: Request) => StudioPrincipal | null | Promise<StudioPrincipal | null>;
}

/** The identity a Studio request authenticated as. */
export interface StudioPrincipal {
  kind: string;
  id: string;
  /** Scopes the credential carries. Absent means none — not "all". */
  scopes?: readonly string[];
}

/**
 * Decode a path segment, or refuse the request.
 *
 * A malformed escape used to throw URIError past the GraftError catch (URIError
 * is not a GraftError, so it was rethrown) and surfaced as a generic 500. A
 * route id that cannot be decoded is a bad request, and saying so is more
 * useful than "the adapter should never throw".
 */
function decodeRouteId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${raw}" is not a valid id — it contains malformed percent-encoding.`,
      fix: "Use an id exactly as the API reported it; percent-escapes must be well formed.",
      details: { id: raw },
    });
  }
}

/**
 * Refuse a state-changing request that a foreign page drove.
 *
 * On a loopback mount there is no authentication by design, so anything that
 * can reach 127.0.0.1 can act. Browsers let a page do exactly that: every
 * mutation here is a plain POST/PUT parsed with `request.json()`, and
 * `Request.json()` does not care about Content-Type — so a cross-origin
 * "simple request" carrying `text/plain` executes without a CORS preflight.
 * The response is unreadable to the attacker, but the side effect already
 * happened: an approval decided, a document overwritten, a commit made.
 *
 * Two checks, because either alone has a gap. Origin catches the browser cases
 * and is present on every cross-origin fetch. Requiring JSON Content-Type
 * forces a preflight for anything that omits Origin, which the browser will
 * then refuse on our behalf.
 */
function assertSameOrigin(request: Request, url: URL): void {
  if (request.method === "GET" || request.method === "HEAD") return;

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    throw new GraftError({
      code: "UNAUTHORIZED",
      message: `Refusing a ${request.method} from origin "${origin}".`,
      fix: "The Studio API only accepts state-changing requests from its own origin. If you are calling it from a script, omit the Origin header or send it from the same origin.",
      details: { origin, expected: url.origin },
    });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `${request.method} ${url.pathname} requires \`Content-Type: application/json\`.`,
      fix: "Send `Content-Type: application/json`. This is a CSRF control as much as a parsing one: a cross-origin form or text/plain POST is a simple request that browsers dispatch without a preflight, and requiring JSON forces one.",
      details: { contentType },
    });
  }
}

/**
 * What a route permits.
 *
 * Reads and writes are separated because an agent that may read the content
 * tree has no business committing it, and deciding approvals is separated from
 * both: it is the human gate, and no agent runtime token should carry it.
 */
export type StudioScope = "studio:read" | "studio:write" | "approvals:decide";

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
    // Neither is a malformed request nor a server fault: the repository is in
    // a state that cannot satisfy it, which is what 409 is for.
    case "GIT_UNAVAILABLE":
    case "COMMIT_FAILED":
      return 409;
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

/**
 * The project's own component declarations, from `graft/editor/*.json`.
 *
 * Read from the project, never from `@usegraft/registry`. That is the whole
 * point of the owned-primitive model: `graft add callout` copies the
 * declaration in alongside the component, and from then on it is the
 * operator's file — rename a prop, retone it, delete it. A Studio that read
 * the registry's copy instead would silently ignore those edits and reintroduce
 * exactly the plugin-black-box coupling `graft add` exists to avoid.
 *
 * A malformed file is skipped rather than fatal: one bad declaration should
 * cost you one styled card, not the editor.
 */
function readEditorComponents(projectRoot: string): EditorComponentList {
  const dir = join(projectRoot, "graft", "editor");
  if (!existsSync(dir)) return { components: [] };

  const components: EditorComponentSpec[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".json")) continue;
    try {
      const parsed = EditorComponentSpec.safeParse(
        JSON.parse(readFileSync(join(dir, entry), "utf8")),
      );
      if (parsed.success) components.push(parsed.data);
    } catch {
      // Unreadable or not JSON — same treatment as invalid.
    }
  }
  return { components };
}

/**
 * A loadable URL for an asset key, or null with the reason.
 *
 * The storage client is built per request and the module imported lazily: most
 * Studio sessions never open a document with an asset field, and a static-tier
 * project has no credentials to build one from at all. Both the missing-config
 * throw and a signing failure resolve to `url: null` — the form degrades to
 * showing the key, which is what it had before this endpoint existed.
 */
async function resolveAssetUrl(key: string): Promise<{
  key: string;
  url: string | null;
  reason?: string;
}> {
  try {
    const { createStorage } = await import("@usegraft/assets");
    return { key, url: await createStorage().url(key) };
  } catch (error) {
    return { key, url: null, reason: error instanceof Error ? error.message : String(error) };
  }
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

/**
 * Who a decision is attributed to: the authenticated caller when there is one,
 * otherwise the identity the Studio was mounted for (a loopback mount has no
 * caller identity — it is the operator at their own machine).
 */
function operator(options: StudioApiOptions, principal?: StudioPrincipal): ApprovalDecider {
  if (principal) return { kind: principal.kind, id: principal.id };
  if (typeof options.decider === "function") return options.decider();
  return options.decider ?? { kind: "human", id: "studio" };
}

/** Everything a route handler is given. */
interface RouteContext {
  request: Request;
  url: URL;
  options: StudioApiOptions;
  defaultBranch: string;
  principal: StudioPrincipal | undefined;
  /** The captured segment, for parameterised routes; "" otherwise. */
  id: string;
}

/**
 * One mounted route.
 *
 * `scope` is a required field rather than something derived from the method, so
 * a route cannot be added without deciding what it permits — and the whole
 * authorization surface reads as a table instead of being spread through a
 * sixteen-branch if/else chain. That absence is what let
 * `actor.kind !== "anonymous"` stand in for authorization for as long as it did.
 */
interface Route {
  method: "GET" | "POST" | "PUT";
  /** Exact pathname, or a pattern with exactly one capture group. */
  path: string | RegExp;
  scope: StudioScope;
  handle: (ctx: RouteContext) => Promise<Response> | Response;
}

const V1 = "/api/studio/v1";
const APPROVAL_DECIDE_PATH = /^\/api\/studio\/v1\/approvals\/([^/]+)\/decide$/;
const COMPILATION_REVERT_PATH = /^\/api\/studio\/v1\/compilations\/([^/]+)\/revert$/;

/** The compilation a revert route names, or a miss the operator can act on. */
async function requireCompilation(
  options: StudioApiOptions,
  id: string,
): Promise<Awaited<ReturnType<typeof listCompilations>>[number]> {
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
  return row;
}

const ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: `${V1}/openapi.json`,
    scope: "studio:read",
    handle: () => json(STUDIO_OPENAPI),
  },
  {
    method: "GET",
    path: `${V1}/tree`,
    scope: "studio:read",
    handle: async ({ options, url, defaultBranch }) => {
      const branch = url.searchParams.get("branch")?.trim() || defaultBranch;
      return json(await buildTree(options.db, options.collections, options.contentDir, branch));
    },
  },
  {
    method: "GET",
    path: `${V1}/collections`,
    scope: "studio:read",
    handle: ({ options }) => json(buildSchema(options.collections)),
  },
  {
    // How the project's components present in the canvas. Owned files, so read
    // per request: editing one should show up on reload, not on restart.
    method: "GET",
    path: `${V1}/editor-components`,
    scope: "studio:read",
    handle: ({ options }) =>
      json(readEditorComponents(options.projectRoot ?? dirname(options.contentDir))),
  },
  {
    // Resolve an asset key to something an <img> can load, so the frontmatter
    // form shows what the document points at instead of a path.
    //
    // Never an error when no store is configured: a static-tier project has no
    // S3 credentials by design, and an asset field there is a key the author
    // maintains by hand. `url: null` lets the form show the key and move on — a
    // 500 would make an unconfigured project look broken.
    method: "GET",
    path: `${V1}/asset-url`,
    scope: "studio:read",
    handle: async ({ url }) => {
      const key = url.searchParams.get("key")?.trim() ?? "";
      if (!key) return json({ key, url: null, reason: "no key" });
      return json(await resolveAssetUrl(key));
    },
  },
  {
    // Operator-triggered compile. The Studio surfaces drift, so it has to be
    // able to resolve it too — sending someone to a terminal to fix a thing the
    // dashboard just told them about is a dead end.
    method: "POST",
    path: `${V1}/compile`,
    scope: "studio:write",
    handle: async ({ request, url, options, defaultBranch }) => {
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
    },
  },
  {
    // The Changes drawer: git surfaced in the editor's language.
    //
    // Reading never fails for the absence of git — a project without a
    // repository is unusual but legitimate, and `tracked: false` lets the
    // drawer explain instead of the pane erroring. Committing does fail,
    // loudly, because there the operator asked for something specific.
    method: "GET",
    path: `${V1}/changes`,
    scope: "studio:read",
    handle: async ({ options }) => json(await readChanges(options.contentDir)),
  },
  {
    method: "GET",
    path: `${V1}/changes/diff`,
    scope: "studio:read",
    handle: async ({ url, options }) => {
      const path = url.searchParams.get("path")?.trim() ?? "";
      if (!path) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "path query param is required.",
          fix: "GET /api/studio/v1/changes/diff?path=docs/getting-started.mdx",
        });
      }
      return json(await readFileDiff(options.contentDir, path));
    },
  },
  {
    method: "POST",
    path: `${V1}/changes/commit`,
    scope: "studio:write",
    handle: async ({ request, options }) => {
      const payload = (await request.json().catch(() => ({}))) as {
        paths?: unknown;
        message?: unknown;
      };
      const paths = Array.isArray(payload.paths)
        ? payload.paths.filter((path): path is string => typeof path === "string")
        : [];
      const result: CommitResultDto = await commitChanges(options.contentDir, {
        paths,
        message: typeof payload.message === "string" ? payload.message : "",
      });
      return json(result);
    },
  },
  {
    method: "GET",
    path: `${V1}/compilations`,
    scope: "studio:read",
    handle: async ({ url, options }) => {
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
    },
  },
  {
    method: "GET",
    path: `${V1}/branches`,
    scope: "studio:read",
    handle: async ({ options }) => {
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
    },
  },
  {
    method: "GET",
    path: `${V1}/approvals`,
    scope: "studio:read",
    handle: async ({ options }) => {
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
    },
  },
  {
    method: "POST",
    path: APPROVAL_DECIDE_PATH,
    scope: "approvals:decide",
    handle: async ({ request, options, principal, id }) => {
      // Note there is no `decidedBy` here: the decision is attributed to the
      // identity this Studio was mounted for, so a caller cannot name a decider
      // other than itself and defeat the requester-cannot-decide check.
      const payload = (await request.json()) as { decision?: string };
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
        operator(options, principal),
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
    },
  },
  {
    // Revert is the payoff of git-authoritative content: a compilation records
    // the SHA it read, so "go back" restores real files rather than replaying an
    // undo stack. GET previews whether it is safe; POST does it — which is why
    // they are two routes carrying two different scopes.
    method: "GET",
    path: COMPILATION_REVERT_PATH,
    scope: "studio:read",
    handle: async ({ options, id }) => {
      const row = await requireCompilation(options, id);
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
    },
  },
  {
    method: "POST",
    path: COMPILATION_REVERT_PATH,
    scope: "studio:write",
    handle: async ({ options, id }) => {
      const row = await requireCompilation(options, id);
      const changed = await revertContentTo(options.contentDir, row.gitSha as string);
      // Recompile only after the files landed, so the index can never describe
      // content that failed to write.
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
    },
  },
  {
    method: "GET",
    path: `${V1}/document`,
    scope: "studio:read",
    handle: ({ url, options }) => {
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
    },
  },
  {
    method: "PUT",
    path: `${V1}/document`,
    scope: "studio:write",
    handle: async ({ request, options, defaultBranch }) => {
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
    },
  },
];

/** The route this request targets, with any captured segment decoded. */
function matchRoute(method: string, pathname: string): { route: Route; id: string } | undefined {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    if (typeof route.path === "string") {
      if (route.path === pathname) return { route, id: "" };
      continue;
    }
    const captured = route.path.exec(pathname);
    if (captured) return { route, id: decodeRouteId(captured[1] ?? "") };
  }
  return undefined;
}

/** Implements /api/studio/v1/* from openapi.yaml. */
export function createStudioApiHandler(options: StudioApiOptions): StudioFetchHandler {
  const defaultBranch = options.defaultBranch ?? "main";

  return async (request) => {
    try {
      const url = new URL(request.url);
      const { pathname } = url;
      const method = request.method;

      assertSameOrigin(request, url);

      const matched = matchRoute(method, pathname);
      if (!matched) {
        throw new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: `Nothing is mounted at ${method} ${pathname}.`,
          fix: "See GET /api/studio/v1/openapi.json for the Studio surface.",
          details: { pathname, method },
        });
      }

      let principal: StudioPrincipal | undefined;
      if (options.authenticate) {
        const resolved = await options.authenticate(request);
        if (resolved === null) {
          throw new GraftError({
            code: "UNAUTHORIZED",
            message: "Studio API requires authentication on this host.",
            fix: "Send Authorization: Bearer <token>, or bind to loopback.",
          });
        }
        principal = resolved;

        if (!(resolved.scopes ?? []).includes(matched.route.scope)) {
          throw new GraftError({
            code: "UNAUTHORIZED",
            message: `${method} ${pathname} requires the "${matched.route.scope}" scope, and this credential does not carry it.`,
            fix: `Mint a token whose scope claim includes "${matched.route.scope}" (for \`graft serve\`, add it to GRAFT_DEV_SCOPES). Studio read, Studio write and approval decisions are deliberately separate: a runtime token that can read content should not be able to commit it, and no agent token should be able to decide the human gate.`,
            details: {
              pathname,
              method,
              required: matched.route.scope,
              held: resolved.scopes ?? [],
            },
          });
        }
      }

      return await matched.route.handle({
        request,
        url,
        options,
        defaultBranch,
        principal,
        id: matched.id,
      });
    } catch (error) {
      if (error instanceof GraftError) {
        return errorResponse(error, statusFor(error));
      }
      throw error;
    }
  };
}
