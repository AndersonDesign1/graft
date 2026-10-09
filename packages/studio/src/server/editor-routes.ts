/**
 * The editor API: entries, drafts, publishing. Mounted in api.ts's route
 * table, so every route here carries a scope and passes the same origin and
 * scope checks as the rest of the surface.
 */
import type { StoreActor } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import type { Route, RouteContext, StudioApiOptions } from "../api";
import type { WorkspaceDto } from "../editor-types";
import type { SchemaFieldDto } from "../types";
import type { EntryQuery } from "./catalog";
import { EditorService } from "./editor-service";

const V1 = "/api/studio/v1";

const services = new WeakMap<StudioApiOptions, EditorService>();

function service(ctx: RouteContext): EditorService {
  let found = services.get(ctx.options);
  if (!found) {
    found = new EditorService({
      contentDir: ctx.options.contentDir,
      collections: ctx.options.collections,
      db: ctx.options.db,
      branchId: ctx.defaultBranch,
      mdxTrust: ctx.options.mdxTrust,
      ...(ctx.options.store ? { store: ctx.options.store } : {}),
    });
    services.set(ctx.options, found);
  }
  return found;
}

/**
 * Who a write is attributed to: the signed-in person, or, on an
 * unauthenticated loopback mount, the operator the Studio was started for.
 */
function actorOf(ctx: RouteContext): StoreActor {
  if (ctx.principal) {
    return {
      id: ctx.principal.id,
      ...(ctx.principal.name ? { name: ctx.principal.name } : {}),
      ...(ctx.principal.email ? { email: ctx.principal.email } : {}),
    };
  }
  const decider =
    typeof ctx.options.decider === "function" ? ctx.options.decider() : ctx.options.decider;
  return { id: decider?.id ?? "studio" };
}

/** No principal means an unauthenticated local mount: the operator may do anything. */
function canPublishDirectly(ctx: RouteContext): boolean {
  return !ctx.principal || (ctx.principal.scopes ?? []).includes("studio:publish");
}

function fieldsOf(ctx: RouteContext, collection: string): SchemaFieldDto[] {
  return ctx.options.collections[collection]?.describe().fields ?? [];
}

function required(value: unknown, name: string, example: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: `${name} is required.`,
    fix: example,
  });
}

async function body(ctx: RouteContext): Promise<Record<string, unknown>> {
  const parsed = (await ctx.request.json().catch(() => null)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "The request body must be a JSON object.",
      fix: "Send Content-Type: application/json with an object body.",
    });
  }
  return parsed as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function baseVersionOf(payload: Record<string, unknown>): { baseVersion?: string | null } {
  if (!Object.hasOwn(payload, "baseVersion")) return {};
  const value = payload.baseVersion;
  return { baseVersion: typeof value === "string" ? value : null };
}

export const EDITOR_ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: `${V1}/workspace`,
    scope: "studio:read",
    handle: async (ctx) => {
      const svc = service(ctx);
      const info = svc.store.info();
      const history = await svc.history();
      const scopes = ctx.principal?.scopes ?? ["studio:read", "studio:write", "studio:publish"];
      const body: WorkspaceDto = {
        storage: svc.remote ? "github" : "local",
        ...(info.repository ? { repository: info.repository } : {}),
        ...(info.url ? { repositoryUrl: info.url } : {}),
        ...(info.branch ? { branch: info.branch } : {}),
        publish: svc.publishAction(canPublishDirectly(ctx)),
        canWrite: !ctx.principal || scopes.includes("studio:write"),
        history: history.available,
        ...(history.reason ? { historyReason: history.reason } : {}),
        user: ctx.principal
          ? {
              id: ctx.principal.id,
              name: ctx.principal.name ?? null,
              email: ctx.principal.email ?? null,
              scopes,
            }
          : null,
        sessions: Boolean(ctx.request.headers.get("cookie")?.includes("graft_studio=")),
      };
      return Response.json(body);
    },
  },
  {
    method: "GET",
    path: `${V1}/entries`,
    scope: "studio:read",
    handle: async (ctx) => {
      const params = ctx.url.searchParams;
      const collection = required(
        params.get("collection"),
        "collection",
        "GET /api/studio/v1/entries?collection=products",
      );
      const where: Record<string, string> = {};
      for (const [key, value] of params) {
        if (key.startsWith("where.")) where[key.slice(6)] = value;
      }
      const dir = params.get("dir");
      const limit = params.get("limit");
      const query: EntryQuery = {
        ...(params.get("q") ? { q: params.get("q") as string } : {}),
        ...(params.get("status") ? { status: params.get("status") as string } : {}),
        ...(params.get("sort") ? { sort: params.get("sort") as string } : {}),
        ...(dir === "asc" || dir === "desc" ? { dir } : {}),
        ...(params.get("cursor") ? { cursor: params.get("cursor") as string } : {}),
        ...(limit && /^\d+$/.test(limit) ? { limit: Number(limit) } : {}),
        where,
      };
      return Response.json(
        await service(ctx).list(collection, fieldsOf(ctx, collection), query, actorOf(ctx)),
      );
    },
  },
  {
    method: "GET",
    path: `${V1}/entry`,
    scope: "studio:read",
    handle: async (ctx) => {
      const params = ctx.url.searchParams;
      const example = "GET /api/studio/v1/entry?collection=products&slug=blue-shirt";
      return Response.json(
        await service(ctx).read(
          required(params.get("collection"), "collection", example),
          required(params.get("slug"), "slug", example),
          actorOf(ctx),
        ),
      );
    },
  },
  {
    method: "PUT",
    path: `${V1}/entry`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx);
      const example = 'PUT { "collection", "slug", "data", "body", "baseVersion" }';
      return Response.json(
        await service(ctx).save(
          {
            collection: required(payload.collection, "collection", example),
            slug: required(payload.slug, "slug", example),
            ...(payload.data && typeof payload.data === "object"
              ? { data: payload.data as Record<string, unknown> }
              : {}),
            ...(typeof payload.body === "string" ? { body: payload.body } : {}),
            ...(typeof payload.raw === "string" ? { raw: payload.raw } : {}),
            ...baseVersionOf(payload),
          },
          actorOf(ctx),
        ),
      );
    },
  },
  {
    method: "POST",
    path: `${V1}/entry`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx);
      const example = 'POST { "collection", "data": { "title": "…" }, "slug?" }';
      return Response.json(
        await service(ctx).create(
          {
            collection: required(payload.collection, "collection", example),
            data:
              payload.data && typeof payload.data === "object"
                ? (payload.data as Record<string, unknown>)
                : {},
            ...(typeof payload.slug === "string" ? { slug: payload.slug } : {}),
            ...(typeof payload.body === "string" ? { body: payload.body } : {}),
          },
          actorOf(ctx),
        ),
        { status: 201 },
      );
    },
  },
  {
    method: "DELETE",
    path: `${V1}/entry`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx);
      const example = 'DELETE { "collection", "slug", "baseVersion" }';
      return Response.json(
        await service(ctx).remove(
          {
            collection: required(payload.collection, "collection", example),
            slug: required(payload.slug, "slug", example),
            ...baseVersionOf(payload),
          },
          actorOf(ctx),
        ),
      );
    },
  },
  {
    method: "POST",
    path: `${V1}/entry/duplicate`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx);
      const example = 'POST { "collection", "slug" }';
      return Response.json(
        await service(ctx).duplicate(
          {
            collection: required(payload.collection, "collection", example),
            slug: required(payload.slug, "slug", example),
          },
          actorOf(ctx),
        ),
        { status: 201 },
      );
    },
  },
  {
    method: "GET",
    path: `${V1}/drafts`,
    scope: "studio:read",
    handle: async (ctx) =>
      Response.json(await service(ctx).draftList(actorOf(ctx), canPublishDirectly(ctx))),
  },
  {
    method: "GET",
    path: `${V1}/drafts/diff`,
    scope: "studio:read",
    handle: async (ctx) =>
      Response.json(
        await service(ctx).diff(
          required(
            ctx.url.searchParams.get("path"),
            "path",
            "GET /api/studio/v1/drafts/diff?path=products/blue-shirt.mdx",
          ),
          actorOf(ctx),
        ),
      ),
  },
  {
    method: "POST",
    path: `${V1}/drafts/publish`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx);
      const resolve: Record<string, "mine" | "theirs"> = {};
      if (payload.resolve && typeof payload.resolve === "object") {
        for (const [path, choice] of Object.entries(payload.resolve)) {
          if (choice === "mine" || choice === "theirs") resolve[path] = choice;
        }
      }
      return Response.json(
        await service(ctx).publish(
          {
            paths: stringList(payload.paths),
            ...(typeof payload.message === "string" ? { message: payload.message } : {}),
            ...(Object.keys(resolve).length > 0 ? { resolve } : {}),
          },
          actorOf(ctx),
          canPublishDirectly(ctx),
        ),
      );
    },
  },
  {
    method: "POST",
    path: `${V1}/drafts/discard`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx);
      await service(ctx).discard(stringList(payload.paths), actorOf(ctx));
      return Response.json({ discarded: stringList(payload.paths) });
    },
  },
];
