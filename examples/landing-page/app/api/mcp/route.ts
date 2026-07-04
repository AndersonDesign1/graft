/**
 * MCP over HTTP — the same content tools as `pnpm mcp`, for agents that can't
 * spawn a stdio process (eve agents, hosted agents, anything remote).
 * Endpoint: POST /api/mcp (Streamable HTTP, stateless).
 *
 * Optionally set GRAFT_MCP_TOKEN to require `Authorization: Bearer <token>`.
 * Writes need this process to see the repo checkout (dev / self-host).
 */
import { resolve } from "node:path";
import { createDb } from "@graft/db";
import { createGraftMcpHandler, type GraftMcpHandler } from "@graft/mcp";
import { collections } from "@/graft.config";

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
      db: createDb(url).db,
      bearerToken: process.env.GRAFT_MCP_TOKEN,
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
