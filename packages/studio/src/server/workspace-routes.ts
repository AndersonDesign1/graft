/**
 * Media, agents and the site: what Studio manages besides content and
 * people. Mounted in api.ts's route table, so the same origin and scope
 * checks guard every route. The rows live in the project's own database
 * (`workspaceDb`), never a branch's: one bucket, one site, one set of agents.
 *
 * - Media: files in the asset store, with their alt text and where each is
 *   used. Uploads arrive as base64 JSON, like MCP's put_asset, so the JSON-only
 *   CSRF control holds and no bucket CORS setup is needed.
 * - Agents: tokens an admin makes for agents. Only the hash is stored, and the
 *   token is shown once.
 * - Site: the site's name and URL, and deploy hooks called after a publish.
 */
import { AssetKeyTakenError, contentTypeFor, defaultKeyFor } from "@usegraft/assets";
import { deployHookUrlProblem, sendDeployHook } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import { AssetRef } from "@usegraft/core";
import {
  createAgentToken,
  createDeployHook,
  deleteDeployHook,
  forgetAsset,
  listAgentTokens,
  listAssets,
  listDeployHooks,
  mintAgentToken,
  readAsset,
  readSiteSettings,
  recordAsset,
  revokeAgentToken,
  setAssetAlt,
  writeSiteSettings,
  type AgentTokenRow,
  type AssetRow,
  type Database,
  type DeployHookRow,
} from "@usegraft/db";
import type { Route, RouteContext } from "../api";
import { requireDatabase } from "./needs-database";
import type {
  AgentAccess,
  AgentsDto,
  AgentTokenDto,
  AssetDetailDto,
  AssetDto,
  AssetListDto,
  AssetUseDto,
  DeployHookDto,
  NewAgentTokenDto,
  SiteDto,
} from "../editor-types";
import { actorOf, service } from "./editor-routes";

const V1 = "/api/studio/v1";
/** Bigger files belong in the bucket directly (`graft asset put`), not a JSON body. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What each access level grants. Never `approvals:decide`: that is a person's. */
export const AGENT_ACCESS: Readonly<Record<AgentAccess, readonly string[]>> = Object.freeze({
  read: Object.freeze(["studio:read"]),
  write: Object.freeze(["studio:read", "studio:write", "content:write"]),
  publish: Object.freeze([
    "studio:read",
    "studio:write",
    "studio:publish",
    "content:write",
    "content:publish",
  ]),
});

/** The project's database, for the feature named, or NEEDS_DATABASE. */
function db(ctx: RouteContext, feature: string): Database {
  return requireDatabase(ctx.options, feature, "workspace");
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "The request body must be a JSON object.",
      fix: 'Send a JSON object, such as { "name": "Docs agent", "access": "write" }.',
    });
  }
  return parsed as Record<string, unknown>;
}

function text(value: unknown, field: string, max = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${field}" must be text of at most ${max} characters.`,
      fix: `Send "${field}" as a string, or leave it out.`,
      details: { field },
    });
  }
  return value.trim() || null;
}

function idOf(ctx: RouteContext, what: string): string {
  if (!UUID.test(ctx.id)) {
    throw new GraftError({
      code: "ROUTE_NOT_FOUND",
      message: `"${ctx.id}" names no ${what}.`,
      fix: `Use an id from the list of ${what}s.`,
    });
  }
  return ctx.id;
}

function keyOf(raw: unknown): string {
  const parsed = AssetRef.shape.key.safeParse(raw);
  if (!parsed.success) {
    const missing = raw === undefined || raw === null || raw === "";
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: missing ? "No asset key was sent." : `"${String(raw)}" is not an asset key.`,
      fix: 'Send the file\'s key: a lowercase path like "images/cover.jpg", with letters, digits, ., _ and -, and / between parts.',
    });
  }
  return parsed.data;
}

/* ---- media ------------------------------------------------------------- */

async function storage(): Promise<
  { ok: true; store: import("@usegraft/assets").Storage } | { ok: false; reason: string }
> {
  try {
    const { createStorage } = await import("@usegraft/assets");
    return { ok: true, store: createStorage() };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof GraftError
          ? error.message
          : "The asset store isn't configured. Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET.",
    };
  }
}

async function requireStorage() {
  const found = await storage();
  if (!found.ok) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: `Files can't be uploaded here yet. ${found.reason}`,
      fix: "Set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY and S3_BUCKET where Studio runs (any S3-compatible store: R2, MinIO, S3), and S3_PUBLIC_URL for public links.",
      details: { variables: ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"] },
    });
  }
  return found.store;
}

async function urlOf(
  store: import("@usegraft/assets").Storage | null,
  key: string,
): Promise<string | null> {
  if (!store) return null;
  try {
    return await store.url(key);
  } catch {
    return null;
  }
}

function assetDto(
  key: string,
  row: AssetRow | undefined,
  uses: number,
  url: string | null,
): AssetDto {
  return {
    key,
    contentType: row?.contentType ?? null,
    bytes: row?.bytes ?? null,
    alt: row?.alt ?? null,
    uploadedBy: row?.uploadedByName ?? row?.uploadedById ?? null,
    createdAt: row?.createdAt.toISOString() ?? null,
    url,
    uses,
  };
}

/* ---- agents and the site --------------------------------------------- */

function accessOf(scopes: readonly string[]): AgentAccess | "custom" {
  const same = (a: readonly string[]) =>
    a.length === scopes.length && a.every((scope) => scopes.includes(scope));
  for (const access of ["read", "write", "publish"] as const) {
    if (same(AGENT_ACCESS[access])) return access;
  }
  return "custom";
}

function tokenDto(row: AgentTokenRow): AgentTokenDto {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    access: accessOf(row.scopes),
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function hookDto(row: DeployHookRow): DeployHookDto {
  const url = new URL(row.url);
  return {
    id: row.id,
    name: row.name,
    url: `${url.origin}${url.pathname}`,
    hasSecret: Boolean(row.secret),
    createdAt: row.createdAt.toISOString(),
    lastAt: row.lastAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
  };
}

/** The site's public origin, for the endpoints an agent connects to. */
function origin(ctx: RouteContext): string {
  return ctx.options.accounts?.publicUrl ?? ctx.url.origin;
}

export const WORKSPACE_ROUTES: readonly Route[] = [
  {
    method: "GET",
    path: `${V1}/assets`,
    scope: "studio:read",
    handle: async (ctx) => {
      const q = ctx.url.searchParams.get("q")?.trim() ?? "";
      const [found, rows, uses] = await Promise.all([
        storage(),
        listAssets(db(ctx, "The media library"), { limit: 1000 }),
        service(ctx).assetUses(actorOf(ctx)),
      ]);
      const store = found.ok ? found.store : null;
      const byKey = new Map(rows.map((row) => [row.key, row]));
      // Uploaded files first, newest first; then files entries use that
      // weren't uploaded through Studio (committed, or put by an agent).
      const keys = [
        ...rows.map((row) => row.key),
        ...[...uses.keys()].filter((k) => !byKey.has(k)).sort(),
      ];
      const needle = q.toLowerCase();
      const matching = needle
        ? keys.filter(
            (key) =>
              key.includes(needle) || (byKey.get(key)?.alt ?? "").toLowerCase().includes(needle),
          )
        : keys;
      const items = await Promise.all(
        matching.map(async (key) =>
          assetDto(key, byKey.get(key), uses.get(key)?.length ?? 0, await urlOf(store, key)),
        ),
      );
      const result: AssetListDto = found.ok
        ? { storage: true, items }
        : { storage: false, storageReason: found.reason, items };
      return Response.json(result);
    },
  },
  {
    method: "GET",
    path: `${V1}/assets/detail`,
    scope: "studio:read",
    handle: async (ctx) => {
      const key = keyOf(ctx.url.searchParams.get("key"));
      const [found, row, uses] = await Promise.all([
        storage(),
        readAsset(db(ctx, "The media library"), key),
        service(ctx).assetUses(actorOf(ctx)),
      ]);
      const usedIn: AssetUseDto[] = uses.get(key) ?? [];
      if (!row && usedIn.length === 0) {
        throw new GraftError({
          code: "DOCUMENT_NOT_FOUND",
          message: `No file "${key}" was uploaded here, and no entry uses one.`,
          fix: "Pick a file from GET /api/studio/v1/assets.",
          details: { key },
        });
      }
      const detail: AssetDetailDto = {
        ...assetDto(
          key,
          row ?? undefined,
          usedIn.length,
          await urlOf(found.ok ? found.store : null, key),
        ),
        usedIn,
      };
      return Response.json(detail);
    },
  },
  {
    method: "POST",
    path: `${V1}/assets`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx.request);
      const name = text(payload.name, "name", 300);
      const key = keyOf(payload.key ?? (name ? defaultKeyFor(name) : undefined));
      if (typeof payload.base64 !== "string" || payload.base64.length === 0) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "An upload needs the file's bytes, base64-encoded, in `base64`.",
          fix: 'Send { "name": "hat.jpg", "base64": "<the file, base64>" }.',
        });
      }
      const bytes = Buffer.from(payload.base64, "base64");
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `That file is ${Math.ceil(bytes.byteLength / 1024 / 1024)} MB, and Studio uploads up to 10 MB.`,
          fix: "Make the file smaller, or upload it from a terminal with `graft asset put <file>`.",
          details: { bytes: bytes.byteLength, max: MAX_UPLOAD_BYTES },
        });
      }
      // The type comes from the key, never the caller: a file served as
      // text/html from the bucket would run script on the bucket's origin.
      const contentType = contentTypeFor(key);
      if (contentType === "application/octet-stream") {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `Studio uploads images and PDFs, and "${key}" is neither.`,
          fix: "Upload a .avif, .gif, .jpg, .png, .svg, .webp or .pdf file.",
          details: { key },
        });
      }
      const overwrite = payload.overwrite === true;
      // Replacing a file changes every live page that shows it, with no
      // review, so it takes what publishing takes.
      const held = ctx.principal ? (ctx.principal.scopes ?? []) : null;
      if (overwrite && held && !held.includes("studio:publish")) {
        throw new GraftError({
          code: "UNAUTHORIZED",
          message: `Replacing "${key}" changes the live site at once, and needs the "studio:publish" scope.`,
          fix: "Upload it under a new name and pick it in the entry, or ask someone who can publish to replace it.",
          details: { key, required: "studio:publish", held },
        });
      }
      // The library row is the upload's record, so with no database nothing
      // reaches the bucket: a file there with no row could not be found again.
      const library = db(ctx, "The media library");
      const store = await requireStorage();
      try {
        await store.put(key, bytes, contentType, { ifAbsent: !overwrite });
      } catch (error) {
        if (error instanceof AssetKeyTakenError) {
          throw new GraftError({
            code: "ASSET_EXISTS",
            message: `There is already a file called "${key}".`,
            fix: "Rename the file, or replace the one there by sending overwrite: true.",
            details: { key },
          });
        }
        throw error;
      }
      const actor = actorOf(ctx);
      const alt = text(payload.alt, "alt", 500);
      const row = await recordAsset(library, {
        key,
        contentType,
        bytes: bytes.byteLength,
        ...(alt !== null ? { alt } : {}),
        uploadedBy: { id: actor.id, name: actor.name ?? null },
      });
      const uses = (await service(ctx).assetUses(actor)).get(key)?.length ?? 0;
      return Response.json(assetDto(key, row, uses, await urlOf(store, key)), { status: 201 });
    },
  },
  {
    method: "PUT",
    path: `${V1}/assets/alt`,
    scope: "studio:write",
    handle: async (ctx) => {
      const payload = await body(ctx.request);
      const key = keyOf(payload.key);
      const alt = text(payload.alt, "alt", 500);
      if (!(await setAssetAlt(db(ctx, "The media library"), key, alt))) {
        throw new GraftError({
          code: "DOCUMENT_NOT_FOUND",
          message: `"${key}" wasn't uploaded through Studio, so there is no library alt text to change.`,
          fix: "Change the alt text where the file is used, in each entry's image field.",
          details: { key },
        });
      }
      return Response.json({ key, alt });
    },
  },
  {
    method: "DELETE",
    path: `${V1}/assets`,
    scope: "studio:publish",
    handle: async (ctx) => {
      const key = keyOf(ctx.url.searchParams.get("key"));
      const usedIn = (await service(ctx).assetUses(actorOf(ctx))).get(key) ?? [];
      if (usedIn.length > 0) {
        throw new GraftError({
          code: "CONTENT_CONFLICT",
          message: `"${key}" is still used by ${usedIn.length === 1 ? "an entry" : `${usedIn.length} entries`}, which would show a broken image.`,
          fix: "Take it out of those entries first, then delete it.",
          details: { key, usedIn },
        });
      }
      // Checked before the bucket is touched, so a refusal deletes nothing.
      const library = db(ctx, "The media library");
      const store = await requireStorage();
      await store.delete(key);
      await forgetAsset(library, key);
      return Response.json({ key, deleted: true });
    },
  },

  /* ---- agents ---------------------------------------------------------- */

  {
    method: "GET",
    path: `${V1}/agents`,
    scope: "studio:settings",
    handle: async (ctx) => {
      const tokens = await listAgentTokens(db(ctx, "Agent tokens"));
      const base = origin(ctx);
      const result: AgentsDto = {
        tokens: tokens.map(tokenDto),
        endpoints: { mcp: `${base}/api/mcp`, api: `${base}/api/studio/v1` },
        accepted: ctx.options.agentTokens === true,
      };
      return Response.json(result);
    },
  },
  {
    method: "POST",
    path: `${V1}/agents`,
    scope: "studio:settings",
    handle: async (ctx) => {
      const payload = await body(ctx.request);
      const name = text(payload.name, "name", 80);
      if (!name) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "A token needs a name, so you can tell later which agent has it.",
          fix: 'Send { "name": "Docs agent", "access": "write" }.',
        });
      }
      const access = payload.access;
      if (access !== "read" && access !== "write" && access !== "publish") {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `"${String(access)}" is not a level of access.`,
          fix: 'Choose "read", "write" (drafts) or "publish".',
        });
      }
      const minted = mintAgentToken();
      const callerId = ctx.principal?.id;
      const row = await createAgentToken(db(ctx, "Agent tokens"), {
        name,
        tokenHash: minted.tokenHash,
        prefix: minted.prefix,
        scopes: [...AGENT_ACCESS[access]],
        // Only an account id fits the column; a bearer caller leaves it empty.
        createdById: callerId && UUID.test(callerId) ? callerId : null,
      });
      const result: NewAgentTokenDto = { ...tokenDto(row), token: minted.token };
      return Response.json(result, { status: 201 });
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/studio\/v1\/agents\/([^/]+)$/,
    scope: "studio:settings",
    handle: async (ctx) => {
      const id = idOf(ctx, "token");
      if (!(await revokeAgentToken(db(ctx, "Agent tokens"), id))) {
        throw new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: "That token doesn't exist, or it was revoked already.",
          fix: "Reload the list of agents.",
          details: { id },
        });
      }
      return Response.json({ id, revoked: true });
    },
  },

  /* ---- the site -------------------------------------------------------- */

  {
    method: "GET",
    path: `${V1}/site`,
    scope: "studio:read",
    handle: async (ctx) => {
      const canManage = !ctx.principal || (ctx.principal.scopes ?? []).includes("studio:settings");
      const [settings, hooks] = await Promise.all([
        readSiteSettings(db(ctx, "Site settings")),
        canManage ? listDeployHooks(db(ctx, "Site settings")) : Promise.resolve([]),
      ]);
      const result: SiteDto = {
        settings: { name: settings?.name ?? null, url: settings?.url ?? null },
        hooks: hooks.map(hookDto),
      };
      return Response.json(result);
    },
  },
  {
    method: "PUT",
    path: `${V1}/site`,
    scope: "studio:settings",
    handle: async (ctx) => {
      const payload = await body(ctx.request);
      const name = text(payload.name, "name", 120);
      const url = text(payload.url, "url", 300);
      if (url) {
        let parsed: URL | null = null;
        try {
          parsed = new URL(url);
        } catch {
          parsed = null;
        }
        if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
          throw new GraftError({
            code: "INPUT_VALIDATION_FAILED",
            message: `"${url}" is not a web address.`,
            fix: "Use the site's full address, such as https://example.com.",
          });
        }
      }
      const row = await writeSiteSettings(db(ctx, "Site settings"), {
        name,
        url,
        updatedById: actorOf(ctx).id,
      });
      return Response.json({ name: row.name, url: row.url });
    },
  },
  {
    method: "POST",
    path: `${V1}/site/hooks`,
    scope: "studio:settings",
    handle: async (ctx) => {
      const payload = await body(ctx.request);
      const name = text(payload.name, "name", 80);
      const url = text(payload.url, "url", 2000);
      if (!name || !url) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: "A deploy hook needs a name and a URL.",
          fix: 'Send { "name": "Rebuild the site", "url": "https://…" }, and a "secret" if the URL checks one.',
        });
      }
      const problem = deployHookUrlProblem(url);
      if (problem) {
        throw new GraftError({
          code: "INPUT_VALIDATION_FAILED",
          message: `That deploy hook URL can't be used. ${problem}`,
          fix: problem,
        });
      }
      const row = await createDeployHook(db(ctx, "Site settings"), {
        name,
        url,
        secret: text(payload.secret, "secret", 500),
      });
      return Response.json(hookDto(row), { status: 201 });
    },
  },
  {
    method: "POST",
    path: /^\/api\/studio\/v1\/site\/hooks\/([^/]+)\/test$/,
    scope: "studio:settings",
    handle: async (ctx) => {
      const id = idOf(ctx, "deploy hook");
      const hook = (await listDeployHooks(db(ctx, "Site settings"))).find((h) => h.id === id);
      if (!hook) {
        throw new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: "That deploy hook doesn't exist.",
          fix: "Reload the site settings.",
          details: { id },
        });
      }
      const delivery = await sendDeployHook(db(ctx, "Site settings"), hook, {
        event: "test",
        branch: ctx.defaultBranch,
        paths: [],
      });
      return Response.json(delivery);
    },
  },
  {
    method: "DELETE",
    path: /^\/api\/studio\/v1\/site\/hooks\/([^/]+)$/,
    scope: "studio:settings",
    handle: async (ctx) => {
      const id = idOf(ctx, "deploy hook");
      if (!(await deleteDeployHook(db(ctx, "Site settings"), id))) {
        throw new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: "That deploy hook doesn't exist.",
          fix: "Reload the site settings.",
          details: { id },
        });
      }
      return Response.json({ id, deleted: true });
    },
  },
];
