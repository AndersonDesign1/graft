/**
 * Full Studio mount: OpenAPI API + static SPA shell.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GraftError } from "@graft/contracts";
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

function contentType(path: string): string {
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

function serveUiAsset(pathname: string, uiBase: string): Response | null {
  const root = uiRoot();
  let rel = pathname;
  if (uiBase && (pathname === uiBase || pathname === `${uiBase}/`)) {
    rel = "/index.html";
  } else if (uiBase && pathname.startsWith(`${uiBase}/`)) {
    rel = pathname.slice(uiBase.length) || "/index.html";
  } else if (!uiBase && (pathname === "/" || pathname === "")) {
    rel = "/index.html";
  } else if (!uiBase && pathname.startsWith("/")) {
    // Local `graft studio`: serve any file from dist/ui (html/css/js).
    rel = pathname;
  } else {
    return null;
  }

  const file =
    rel === "/index.html" || rel === "/"
      ? "index.html"
      : rel.replace(/^\//, "").replace(/^assets\//, "");
  // Only flat ui assets (no nested traversal).
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) return null;

  try {
    const body = readFileSync(join(root, file));
    return new Response(body, {
      status: 200,
      headers: { "content-type": contentType(file) },
    });
  } catch {
    if (file === "index.html") {
      return new Response(
        JSON.stringify({
          error: "CONFIG_INVALID",
          message: "Studio UI assets are missing from the @graft/studio package build.",
          fix: "Rebuild @graft/studio (pnpm --filter @graft/studio build).",
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

    // Keep a trailing slash so relative ./studio.css resolves under /studio/.
    if (uiBase && pathname === uiBase) {
      url.pathname = `${uiBase}/`;
      return Response.redirect(url.toString(), 302);
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
