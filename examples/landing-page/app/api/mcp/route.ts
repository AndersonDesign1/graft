/**
 * MCP over HTTP — the same tools as `pnpm mcp` / `graft mcp`, for agents that
 * can't spawn a stdio process (eve agents, hosted agents, anything remote).
 * Endpoint: POST /api/mcp (Streamable HTTP, stateless).
 *
 * Includes content tools + list_functions / describe_function / run_function
 * (run_function reuses createFunctionsHandler — same access/audit/approval gates
 * as POST /api/fn/<name>). Callers are identified by the same @usegraft/auth
 * resolver (Better Auth JWTs or GRAFT_DEV_TOKEN). Anonymous callers are refused
 * by default; GRAFT_MCP_ALLOW_ANONYMOUS=1 opts back in for local development
 * only — never set it on a deployed instance. Writes need this process to see
 * the repo checkout (dev / self-host).
 */
import { resolve } from "node:path";
import { createDb } from "@usegraft/db";
import { createGraftMcpHandler, type GraftMcpHandler } from "@usegraft/mcp";
import { collections, functions } from "@/graft.config";
import { resolveActor } from "@/lib/actor";

let handler: GraftMcpHandler | null = null;

function getHandler(): GraftMcpHandler {
  if (!handler) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Put it in the repo-root .env (loaded by next.config.ts) or the environment.",
      );
    }
    handler = createGraftMcpHandler({
      name: "graft-landing-page",
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

export async function POST(request: Request): Promise<Response> {
  return getHandler()(request);
}

// Stateless Streamable HTTP is POST-only; the handler answers 405 with Allow.
export async function GET(request: Request): Promise<Response> {
  return getHandler()(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return getHandler()(request);
}
