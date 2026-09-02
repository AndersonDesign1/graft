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
import { createDocsMcpHandler, type GraftMcpHandler } from "@usegraft/mcp";
import { collections } from "../../graft.config";
import { staticIndexPath } from "../lib/graft";

let handler: GraftMcpHandler | null = null;

/**
 * Runs on demand, and needs no database. This site compiles to a static index,
 * so the docs MCP reads the same `.graft/index.db` artifact the pages render
 * from — `staticIndexPath` rather than `db`. An agent gets search and reads
 * with nothing to provision and nothing to keep up.
 */
export const prerender = false;

function getHandler(): GraftMcpHandler {
  handler ??= createDocsMcpHandler({
    name: "graft-docs",
    contentDir: resolve(import.meta.dirname, "../..", "content"),
    collections,
    staticIndexPath,
  });
  return handler;
}

export const POST: APIRoute = ({ request }) => getHandler()(request);
// Stateless Streamable HTTP is POST-only; the handler answers 405 with Allow.
export const GET: APIRoute = ({ request }) => getHandler()(request);
