/**
 * /mcp — the public documentation MCP endpoint.
 *
 * Read-only and unauthenticated, which is what makes it useful: an agent
 * helping someone use Graft can search and read these docs without a token and
 * without scraping the rendered page. It is the same content `/llms.txt` and
 * `/docs/<slug>.md` serve, for clients that speak MCP instead of HTTP.
 *
 * The path is the convention rather than a preference. Mintlify generates a
 * docs MCP at `/mcp` for every site it hosts, and Cloudflare runs a
 * documentation server separately from its authenticated API server. Agents
 * arrive looking here.
 *
 * This is NOT `/api/mcp`. That one is the full surface — writes, asset upload,
 * `run_function`, approval decisions — and it refuses anonymous callers.
 * `createDocsMcpHandler` is a different factory with no `actor` option and no
 * `allowAnonymous` escape, so opening this endpoint cannot open that one.
 */
import type { APIRoute } from "astro";
import { resolve } from "node:path";
import { createDb } from "@usegraft/db";
import { createDocsMcpHandler, type GraftMcpHandler } from "@usegraft/mcp";
import { collections } from "../../graft.config";

let handler: GraftMcpHandler | null = null;

function getHandler(): GraftMcpHandler {
  if (!handler) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Put it in the repo-root .env (loaded by astro.config.mjs) or the environment.",
      );
    }
    handler = createDocsMcpHandler({
      name: "graft-docs",
      contentDir: resolve(process.cwd(), "content"),
      collections,
      db: createDb(url).db,
    });
  }
  return handler;
}

export const POST: APIRoute = ({ request }) => getHandler()(request);
// Stateless Streamable HTTP is POST-only; the handler answers 405 with Allow.
export const GET: APIRoute = ({ request }) => getHandler()(request);
