/**
 * The MCP server for this site — the agent surface over content/.
 * Registered in the repo-root .mcp.json; agents get list_collections,
 * describe_schema, list/get/write_content, and explain_error.
 *   pnpm mcp   (stdio; meant to be launched by an MCP client, not by hand)
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@graft/db";
import { createGraftMcp, serveStdio } from "@graft/mcp";
import { collections } from "../graft.config";

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
  db: handle.db,
});

await serveStdio(server);
