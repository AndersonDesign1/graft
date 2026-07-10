/**
 * graft mcp — project MCP over stdio (the local agent install path).
 *
 * Loads graft.config.ts (collections + optional functions), connects
 * DATABASE_URL, and serves createGraftMcp on stdio until the client exits.
 * Register in `.mcp.json` as: `"command": "pnpm", "args": ["exec", "graft", "mcp"]`.
 *
 * Auth for run_function: optional GRAFT_DEV_TOKEN (+ GRAFT_DEV_SCOPES, comma/space
 * separated). Hosts that need Better Auth / OIDC use createGraftMcpHandler in
 * the app with createActorResolver — the CLI stays issuer-free (verify-don't-mint
 * only for static dev tokens). See docs/design-notes/agent-mcp.md.
 */
import { createActorResolver } from "@graft/auth";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";

export interface McpCommandOptions {
  cwd: string;
  branchId?: string;
}

export async function mcpCommand(options: McpCommandOptions): Promise<void> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();

  const [{ createGraftMcp, serveStdio }, { createDb, resolveBranchHandle, scopeWriteBranch }] =
    await Promise.all([import("@graft/mcp"), import("@graft/db")]);

  const control = createDb(url);
  const branchName = options.branchId ?? "main";
  const branch = await resolveBranchHandle(control.db, branchName, { databaseUrl: url });

  try {
    const devToken = process.env.GRAFT_DEV_TOKEN;
    const scopes = (process.env.GRAFT_DEV_SCOPES ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const resolveActor = createActorResolver({
      issuers: [],
      devTokens: devToken
        ? {
            [devToken]: {
              kind: "agent",
              id: "graft-cli",
              scopes,
            },
          }
        : undefined,
    });

    const server = createGraftMcp({
      name: "graft",
      contentDir: config.contentDir,
      collections: config.collections,
      functions: config.functions,
      db: branch.db,
      branchId: scopeWriteBranch(branch.scope),
      // The handle's resolved scope makes search_content overlay-aware: an
      // overlay branch searches its full parent chain, not just its own rows.
      scope: branch.scope,
      actor: resolveActor,
    });

    // Stdio MCP: never write noise to stdout (that's the protocol stream).
    // Errors before connect go to stderr via the CLI runner.
    await serveStdio(server);
  } finally {
    await branch.close();
    await control.close();
  }
}
