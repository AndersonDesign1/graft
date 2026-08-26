/**
 * MCP over HTTP — the same tools as `graft mcp`, for agents that can't spawn
 * a stdio process. Endpoint: POST /api/mcp (Streamable HTTP, stateless),
 * mounted through @usegraft/sdk-astro's graftRoute.
 *
 * Anonymous callers are refused by default. GRAFT_MCP_ALLOW_ANONYMOUS=1 opts
 * back in for local development only — never set it on a deployed instance.
 * Writes need this process to see the repo checkout (dev / self-host).
 */
import { resolve } from "node:path";
import { createDb } from "@usegraft/db";
import { createGraftMcpHandler, type GraftMcpHandler } from "@usegraft/mcp";
import { graftRoute } from "@usegraft/sdk-astro";
import { collections, functions } from "../../../graft.config";
import { resolveActor } from "../../lib/actor";

let handler: GraftMcpHandler | null = null;

function getHandler(): GraftMcpHandler {
  if (!handler) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Put it in the repo-root .env (loaded by astro.config.mjs) or the environment.",
      );
    }
    handler = createGraftMcpHandler({
      name: "graft-docs-site",
      contentDir: resolve(process.cwd(), "content"),
      collections,
      functions,
      db: createDb(url).db,
      actor: resolveActor,
      // Anonymous callers are refused unless GRAFT_MCP_ALLOW_ANONYMOUS is set,
      // which is for local development only: this endpoint serves content
      // writes, asset uploads and approval decisions. A deployed instance must
      // never set it — the previous default was the other way round, so
      // forgetting one env var published the whole tool surface.
      allowAnonymous: process.env.GRAFT_MCP_ALLOW_ANONYMOUS === "1",
    });
  }
  return handler;
}

export const POST = graftRoute((request) => getHandler()(request));
// Stateless Streamable HTTP is POST-only; the handler answers 405 with Allow.
export const GET = graftRoute((request) => getHandler()(request));
export const DELETE = graftRoute((request) => getHandler()(request));
