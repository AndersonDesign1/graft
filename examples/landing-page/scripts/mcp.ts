/**
 * The MCP server for this site — the agent surface over content/ + functions.
 * Registered in the repo-root .mcp.json; agents get content tools plus
 * list_functions / describe_function / run_function (same gates as POST /api/fn).
 *   pnpm mcp   (stdio; meant to be launched by an MCP client, not by hand)
 *
 * Prefer `graft mcp` from the project root for the generic install path
 * (see docs/design-notes/agent-mcp.md); this script keeps the example name
 * and wires the full Better Auth actor resolver.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@usegraft/db";
import { createGraftMcp, serveStdio } from "@usegraft/mcp";
import { collections, functions } from "../graft.config";
import { resolveActor } from "../lib/actor";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* rely on the ambient environment */
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — add it to the repo-root .env.");
  process.exit(1);
}

const handle = createDb(url);
const server = createGraftMcp({
  name: "graft-landing-page",
  contentDir: resolve(here, "../content"),
  collections,
  functions,
  db: handle.db,
  actor: resolveActor,
});

await serveStdio(server);
