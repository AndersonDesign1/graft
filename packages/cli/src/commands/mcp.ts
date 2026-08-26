/**
 * graft mcp — project MCP over stdio (the local agent install path).
 *
 * Loads graft.config.ts (collections + optional functions), connects
 * DATABASE_URL, and serves createGraftMcp on stdio until the client exits.
 * Register in `.mcp.json` as: `"command": "pnpm", "args": ["exec", "graft", "mcp"]`.
 *
 * Auth for run_function: optional GRAFT_DEV_TOKEN (+ GRAFT_DEV_SCOPES, comma/space
 * separated). The token doubles as the server's default identity — the local
 * agent acts as it without ever seeing the secret (anyone who can spawn this
 * process can already read .env, so this grants nothing new). Hosts that need
 * Better Auth / OIDC use createGraftMcpHandler in the app with
 * createActorResolver — the CLI stays issuer-free (verify-don't-mint only for
 * static dev tokens). See docs/design-notes/agent-mcp.md.
 */
import { createActorResolver } from "@usegraft/auth";
import type { FunctionActor } from "@usegraft/core";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { assertNoStaticBranch } from "./compile";

export interface McpCommandOptions {
  cwd: string;
  branchId?: string;
}

export async function mcpCommand(options: McpCommandOptions): Promise<void> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  // Static projects get the same agent surface for authored content — the
  // Postgres-tier tools answer NEEDS_DATABASE with the upgrade instead of the
  // server refusing to start. Being agent-native is not a Postgres-tier feature.
  const isStatic = config.index.driver === "static";
  if (isStatic) assertNoStaticBranch(options.branchId);
  const url = isStatic ? undefined : requireDatabaseUrl();

  const [{ createGraftMcp, serveStdio }, { createDb, resolveBranchHandle, scopeWriteBranch }] =
    await Promise.all([import("@usegraft/mcp"), import("@usegraft/db")]);

  const control = url !== undefined ? createDb(url) : undefined;
  const branchName = options.branchId ?? "main";
  const branch =
    control !== undefined && url !== undefined
      ? await resolveBranchHandle(control.db, branchName, { databaseUrl: url })
      : undefined;

  try {
    const devToken = process.env.GRAFT_DEV_TOKEN;
    const scopes = (process.env.GRAFT_DEV_SCOPES ?? "")
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const cliActor = { kind: "agent", id: "graft-cli", scopes } as const;
    const resolveActor = createActorResolver({
      issuers: [],
      devTokens: devToken ? { [devToken]: cliActor } : undefined,
    });

    // stdio is a local process the developer started, so there is no untrusted
    // caller to authenticate — it is the CLI acting as an agent. Giving it a
    // stable identity (rather than anonymous) is what lets a destructive op
    // file an approval that `graft approve` can then decide as the OS user:
    // two different identities, so separation of duties holds locally too.
    // A dev token adds scopes on top; it is not what confers identity.
    const resolveStdioActor = async (request: Request): Promise<FunctionActor> => {
      const resolved = await resolveActor(request);
      return resolved.kind === "anonymous" ? cliActor : resolved;
    };

    const server = createGraftMcp({
      name: "graft",
      contentDir: config.contentDir,
      collections: config.collections,
      functions: config.functions,
      ...(branch !== undefined
        ? {
            db: branch.db,
            branchId: scopeWriteBranch(branch.scope),
            // The handle's resolved scope makes search_content overlay-aware: an
            // overlay branch searches its full parent chain, not just its own rows.
            scope: branch.scope,
          }
        : { staticIndexPath: (config.index as { driver: "static"; path: string }).path }),
      actor: resolveStdioActor,
      connectionActor: cliActor,
      defaultAuthorization: devToken,
    });

    // Stdio MCP: never write noise to stdout (that's the protocol stream).
    // Errors before connect go to stderr via the CLI runner.
    await serveStdio(server);
  } finally {
    await branch?.close();
    await control?.close();
  }
}
