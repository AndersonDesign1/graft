/**
 * Full Studio mount: OpenAPI API + static SPA shell.
 */
import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError } from "@usegraft/contracts";
import { createStudioApiHandler, type StudioApiOptions, type StudioFetchHandler } from "./api";

export interface StudioHandlerOptions extends StudioApiOptions {
  /**
   * URL prefix for the UI when hosted under serve (e.g. "/studio").
   * Empty string = UI at `/` (local `graft studio`).
   */
  uiBasePath?: string;
}

function uiRoot(): string {
  // dist/ui next to this module when built; src/ui fallback in tests/dev.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "ui");
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot === -1 ? undefined : CONTENT_TYPES[path.slice(dot)]) ?? "text/html; charset=utf-8";
}

/**
 * Resolve a request path to a file inside dist/ui, or null if it escapes.
 *
 * Vite emits hashed assets under `assets/`, so the old flat "no slashes"
 * allowlist can't be used. Confinement is enforced by resolving the candidate
 * and checking it still lives under the root — which also covers `..`,
 * absolute paths, and Windows separators.
 */
function resolveUiFile(rel: string): string | null {
  const root = resolve(uiRoot());
  const cleaned = decodeURIComponent(rel).replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const candidate = resolve(root, normalize(cleaned));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

function serveUiAsset(pathname: string, uiBase: string): Response | null {
  let rel: string;
  if (uiBase && (pathname === uiBase || pathname === `${uiBase}/`)) {
    rel = "index.html";
  } else if (uiBase && pathname.startsWith(`${uiBase}/`)) {
    rel = pathname.slice(uiBase.length + 1) || "index.html";
  } else if (!uiBase && (pathname === "/" || pathname === "")) {
    rel = "index.html";
  } else if (!uiBase && pathname.startsWith("/")) {
    rel = pathname.slice(1);
  } else {
    return null;
  }
  if (rel === "" || rel.endsWith("/")) rel = `${rel}index.html`;

  const file = resolveUiFile(rel);
  if (!file) return null;

  try {
    const body = readFileSync(file);
    const isHtml = rel.endsWith(".html");
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": contentType(rel),
        // Hashed filenames are immutable; the shell must never be cached.
        "cache-control": isHtml
          ? "no-cache"
          : rel.startsWith("assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
      },
    });
  } catch {
    if (rel === "index.html") {
      return new Response(
        JSON.stringify({
          error: "CONFIG_INVALID",
          message: "Studio UI assets are missing from the @usegraft/studio package build.",
          fix: "Rebuild @usegraft/studio (pnpm --filter @usegraft/studio build).",
        }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    return null;
  }
}

/**
 * Combines API + SPA. API paths are always absolute `/api/studio/v1/*`.
 * UI lives at `/` (local) or `uiBasePath` (hosted).
 */
export function createStudioHandler(options: StudioHandlerOptions): StudioFetchHandler {
  const api = createStudioApiHandler(options);
  const uiBase = (options.uiBasePath ?? "").replace(/\/$/, "");

  return async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname.startsWith("/api/studio/v1")) {
      return api(request);
    }

    // Two things happen on the way into the shell:
    //  1. force a trailing slash, so the relative ./assets/* refs resolve;
    //  2. pin ?branch to the branch this handler was actually mounted on.
    // (2) is a real bug fix: the SPA reads ?branch from the URL, so without it
    // `graft serve --studio --branch preview` silently served `main`.
    // Guarded on defaultBranch being set, and the redirect always adds the
    // param, so this can't loop.
    const isShell = uiBase ? pathname === uiBase || pathname === `${uiBase}/` : pathname === "/";
    if (isShell) {
      const needsSlash = Boolean(uiBase) && pathname === uiBase;
      const needsBranch = !url.searchParams.has("branch") && Boolean(options.defaultBranch);
      if (needsSlash || needsBranch) {
        if (needsSlash) url.pathname = `${uiBase}/`;
        if (needsBranch) url.searchParams.set("branch", options.defaultBranch as string);
        return Response.redirect(url.toString(), 302);
      }
    }

    const asset = serveUiAsset(pathname, uiBase);
    if (asset) return asset;

    return new Response(
      JSON.stringify(
        new GraftError({
          code: "ROUTE_NOT_FOUND",
          message: `Nothing is mounted at ${pathname}.`,
          fix: uiBase
            ? `Open ${uiBase}/ for the Studio UI, or GET /api/studio/v1/openapi.json.`
            : "Open / for the Studio UI, or GET /api/studio/v1/openapi.json.",
          details: { pathname },
        }).toJSON(),
      ),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  };
}
