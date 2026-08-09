/**
 * graft serve — the headless Graft runtime (P7.1).
 *
 * The stateless Web-standard handlers the packages already ship (functions,
 * MCP over Streamable HTTP) bound to a plain Node http server — the thin Node
 * adapter the P3 runtime invariant planned for. This is what a self-host
 * container runs: the frontend app deploys wherever it wants and talks to
 * these endpoints (or embeds the same handlers itself — both topologies serve
 * identical bytes because the handlers are the same code).
 *
 * Endpoints:
 *   POST /api/fn/<name>  — typed function RPC (access/audit/limits/approvals)
 *   POST /api/mcp        — MCP Streamable HTTP (content + function + registry tools)
 *   GET  /healthz        — liveness + a real DB round-trip
 *   GET  /studio (+ /api/studio/v1/*) — opt-in when --studio / GRAFT_STUDIO=1
 *
 * Identity: the same env contract as `graft mcp` (GRAFT_DEV_TOKEN /
 * GRAFT_DEV_SCOPES) plus GRAFT_TRUSTED_ISSUERS — comma/space-separated OIDC
 * issuer URLs verified via discovery, so a deployed server accepts
 * externally-minted agent tokens without new code. GRAFT_MCP_REQUIRE_AUTH=1
 * rejects anonymous MCP callers; GRAFT_APPROVAL_POLICY=human gates every
 * mutation. Binding beyond loopback without any of those prints a warning.
 */
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createActorResolver, type TrustedIssuer } from "@usegraft/auth";
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";

export type FetchHandler = (request: Request) => Promise<Response>;

export interface ServeRoutes {
  fn: FetchHandler;
  mcp: FetchHandler;
  health: FetchHandler;
  /** Opt-in Studio UI + OpenAPI read API (`--studio` / GRAFT_STUDIO=1). */
  studio?: FetchHandler;
}

/** Route table for the headless runtime; anything unmounted is a 404 that teaches the map. */
export function createServeRouter(routes: ServeRoutes): FetchHandler {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/healthz") return routes.health(request);
    if (pathname === "/api/mcp") return routes.mcp(request);
    if (pathname === "/api/fn" || pathname.startsWith("/api/fn/")) return routes.fn(request);
    if (
      routes.studio &&
      (pathname === "/studio" ||
        pathname.startsWith("/studio/") ||
        pathname.startsWith("/api/studio/"))
    ) {
      return routes.studio(request);
    }
    const studioHint = routes.studio
      ? ", GET /studio (opt-in Studio)"
      : " — or pass --studio / GRAFT_STUDIO=1 for the opt-in Studio UI";
    const error = new GraftError({
      code: "ROUTE_NOT_FOUND",
      message: `Nothing is mounted at ${pathname}.`,
      fix: `Use POST /api/fn/<name> (typed functions), POST /api/mcp (MCP Streamable HTTP), or GET /healthz${studioHint}.`,
      details: { pathname },
    });
    return new Response(JSON.stringify(error.toJSON()), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
}

// Connection-level headers that must not be copied between the Node request
// and the Web-standard Request/Response (the runtimes manage these).
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "upgrade",
  "proxy-connection",
]);

/**
 * The thin Node adapter: node:http request/response ↔ Web-standard
 * Request/Response. Bodies are buffered — every mounted handler speaks small
 * JSON payloads, not streams.
 */
export function createNodeListener(handler: FetchHandler) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined || HOP_BY_HOP.has(key)) continue;
        if (Array.isArray(value)) for (const v of value) headers.append(key, v);
        else headers.set(key, value);
      }
      const method = req.method ?? "GET";
      const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" || body.length === 0 ? undefined : body,
      });

      const response = await handler(request);
      const outHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key)) outHeaders[key] = value;
      });
      res.writeHead(response.status, outHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      // The mounted handlers convert their own failures to GraftError JSON;
      // reaching here means the adapter itself broke. Say so, still as JSON.
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "FUNCTION_EXECUTION_FAILED",
          message: `graft serve failed to relay the request: ${error instanceof Error ? error.message : String(error)}`,
          fix: "Check the server logs; if this reproduces, file it — the adapter should never throw.",
        }),
      );
    }
  };
}

function localGitSha(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function trustedIssuersFromEnv(): TrustedIssuer[] {
  return (process.env.GRAFT_TRUSTED_ISSUERS ?? "")
    .split(/[,\s]+/)
    .map((issuer) => issuer.trim())
    .filter(Boolean)
    .map((issuer) => ({ issuer }));
}

export interface ServeCommandOptions {
  cwd: string;
  branchId?: string;
  port?: number;
  host?: string;
  /** Mount opt-in Studio at /studio + /api/studio/v1/* */
  studio?: boolean;
}

export interface RunningGraftServer {
  port: number;
  host: string;
  branch: string;
  close(): Promise<void>;
}

/** Build the runtime and start listening; the caller owns the lifetime. */
export async function startServe(options: ServeCommandOptions): Promise<RunningGraftServer> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();

  const enableStudio = options.studio === true || process.env.GRAFT_STUDIO === "1";

  const [
    { createFunctionsHandler },
    { createGraftMcpHandler },
    { createDb, resolveBranchHandle, scopeWriteBranch, sql },
    studioMod,
  ] = await Promise.all([
    import("@usegraft/core"),
    import("@usegraft/mcp"),
    import("@usegraft/db"),
    enableStudio ? import("@usegraft/studio") : Promise.resolve(null),
  ]);

  const control = createDb(url);
  const branchName = options.branchId ?? "main";
  const branch = await resolveBranchHandle(control.db, branchName, { databaseUrl: url });
  const writeBranch = scopeWriteBranch(branch.scope);

  const devToken = process.env.GRAFT_DEV_TOKEN;
  const scopes = (process.env.GRAFT_DEV_SCOPES ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const issuers = trustedIssuersFromEnv();
  const resolveActor = createActorResolver({
    issuers,
    devTokens: devToken ? { [devToken]: { kind: "agent", id: "graft-serve", scopes } } : undefined,
  });

  const approvalPolicy = process.env.GRAFT_APPROVAL_POLICY === "human" ? "human" : "none";
  const requireMcpActor = process.env.GRAFT_MCP_REQUIRE_AUTH === "1";
  const functions = config.functions ?? {};
  const gitSha = localGitSha(options.cwd);

  const fnHandler = createFunctionsHandler({
    functions,
    db: branch.db,
    branch: writeBranch,
    actor: resolveActor,
    approvalPolicy,
    // Backstop; per-function rateLimit overrides it.
    rateLimit: { limit: 60, windowSeconds: 60 },
    gitSha,
  });

  const mcpHandler = createGraftMcpHandler({
    name: "graft-serve",
    contentDir: config.contentDir,
    collections: config.collections,
    functions,
    db: branch.db,
    branchId: writeBranch,
    scope: branch.scope,
    actor: resolveActor,
    requireActor: requireMcpActor,
  });

  const health: FetchHandler = async () => {
    try {
      await branch.db.execute(sql`select 1`);
    } catch (error) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        branch: branchName,
        collections: Object.keys(config.collections).length,
        functions: Object.keys(functions).length,
        gitSha: gitSha ?? null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.PORT ?? 3903);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    await branch.close();
    await control.close();
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${options.port ?? process.env.PORT}" is not a valid port.`,
      fix: "Pass --port <0-65535> (0 picks a free port) or set PORT.",
    });
  }

  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!loopback && !requireMcpActor && issuers.length === 0 && !devToken) {
    console.warn(
      "[graft serve] WARNING: binding beyond loopback with no identity configured — " +
        "set GRAFT_MCP_REQUIRE_AUTH=1 and provide GRAFT_DEV_TOKEN or GRAFT_TRUSTED_ISSUERS " +
        "before exposing this to a network.",
    );
  }

  let studioHandler: FetchHandler | undefined;
  if (studioMod) {
    const authorize =
      !loopback && (devToken || issuers.length > 0)
        ? async (request: Request) => {
            const actor = await resolveActor(request);
            return actor.kind !== "anonymous";
          }
        : !loopback
          ? () => false
          : undefined;
    studioHandler = studioMod.createStudioHandler({
      db: branch.db,
      collections: config.collections,
      contentDir: config.contentDir,
      defaultBranch: writeBranch,
      decidedBy: "studio-serve",
      uiBasePath: "/studio",
      authorize,
    });
  }

  const server = createServer(
    createNodeListener(
      createServeRouter({ fn: fnHandler, mcp: mcpHandler, health, studio: studioHandler }),
    ),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;

  return {
    port,
    host,
    branch: branchName,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await branch.close();
      await control.close();
    },
  };
}

/** `graft serve` — start and block until SIGINT/SIGTERM, then shut down cleanly. */
export async function serveCommand(options: ServeCommandOptions): Promise<void> {
  const running = await startServe(options);
  const base = `http://${running.host}:${running.port}`;
  const studioOn = options.studio === true || process.env.GRAFT_STUDIO === "1";
  console.log(
    [
      `graft serve — branch "${running.branch}"`,
      `  functions  POST ${base}/api/fn/<name>`,
      `  mcp        POST ${base}/api/mcp`,
      `  health     GET  ${base}/healthz`,
      ...(studioOn
        ? [
            `  studio     GET  ${base}/studio`,
            `  openapi    GET  ${base}/api/studio/v1/openapi.json`,
          ]
        : []),
    ].join("\n"),
  );
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await running.close();
}
