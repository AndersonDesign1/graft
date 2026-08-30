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
 *   GET  /api/content/v1/* — read-only authored content
 *   GET  /healthz        — liveness + a real DB round-trip
 *   GET  /studio (+ /api/studio/v1/*) — opt-in when --studio / GRAFT_STUDIO=1
 *
 * Identity: the same env contract as `graft mcp` (GRAFT_DEV_TOKEN /
 * GRAFT_DEV_SCOPES) plus GRAFT_TRUSTED_ISSUERS — comma/space-separated OIDC
 * issuer URLs verified via discovery, so a deployed server accepts
 * externally-minted agent tokens without new code.
 *
 * Anonymous MCP callers are served on loopback (zero-config local dev) and
 * refused anywhere else, with no env var to remember. Off loopback it takes a
 * deliberate GRAFT_MCP_ALLOW_ANONYMOUS=1, which warns.
 * GRAFT_APPROVAL_POLICY=human gates every mutation. Binding beyond loopback
 * with no identity configured prints a warning, because MCP will then refuse
 * every caller.
 */
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createActorResolver, type TrustedIssuer } from "@usegraft/auth";
import { GraftError } from "@usegraft/contracts";
import { setRequestPeer } from "@usegraft/core";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";

export type FetchHandler = (request: Request) => Promise<Response>;

export interface ServeRoutes {
  fn: FetchHandler;
  mcp: FetchHandler;
  content: FetchHandler;
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
    if (pathname === "/api/content/v1" || pathname.startsWith("/api/content/v1/")) {
      return routes.content(request);
    }
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
      fix: `Use POST /api/fn/<name> (typed functions), POST /api/mcp (MCP Streamable HTTP), GET /api/content/v1/documents (authored content), GET /api/content/v1/search, or GET /healthz${studioHint}.`,
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
export interface NodeListenerOptions {
  /**
   * Host values this server answers to. A request whose `Host` is not one of
   * them is refused with 400.
   *
   * The adapter builds the request URL from `req.headers.host`, so without this
   * an attacker-chosen Host flows into every handler — and into the Studio's
   * shell redirect, which reflects it in `Location` before any authorization
   * runs. It is also what makes DNS rebinding work against a loopback bind: the
   * browser resolves an attacker's domain to 127.0.0.1 and the server happily
   * answers to that name.
   *
   * Omitted means answer to anything, which is only appropriate behind a proxy
   * that already validates Host.
   */
  allowedHosts?: readonly string[];
}

/**
 * Host values a server bound to `host` should answer to.
 *
 * A loopback bind is reachable only from this machine, but a browser will
 * happily resolve any name to 127.0.0.1 — which is exactly how DNS rebinding
 * turns a drive-by page into a client of the local Studio. Naming the hosts we
 * answer to closes that, and stops an attacker-chosen Host being reflected in
 * the shell redirect's Location.
 *
 * Binding to a wildcard means "reachable however the operator arranged it", so
 * there is no meaningful allowlist to build.
 */
export function allowedHostsFor(host: string): readonly string[] | undefined {
  if (host === "0.0.0.0" || host === "::" || host === "") return undefined;
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
    return ["127.0.0.1", "localhost", "[::1]"];
  }
  return [host];
}

/** `Host` may carry a port; compare on the hostname alone. */
function hostname(host: string): string {
  const trimmed = host.trim().toLowerCase();
  // IPv6 literals are bracketed: [::1]:4983
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  const colon = trimmed.lastIndexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function createNodeListener(handler: FetchHandler, options: NodeListenerOptions = {}) {
  const allowed = options.allowedHosts?.map(hostname);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      if (allowed && !allowed.includes(hostname(req.headers.host ?? ""))) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "INPUT_VALIDATION_FAILED",
            message: `This server does not answer to Host "${req.headers.host ?? ""}".`,
            fix: `Reach it at one of: ${allowed.join(", ")}. A mismatched Host is either a misconfigured proxy or a DNS-rebinding attempt.`,
          }),
        );
        return;
      }
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

      // The real socket peer, registered against the Request object rather than
      // written as a header. A header would travel with the request and be
      // indistinguishable from one a client sent.
      const peer = req.socket.remoteAddress;
      if (peer) setRequestPeer(request, peer);

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
    { createContentApiHandler },
    { createDb, createDbIndexReader, resolveBranchHandle, scopeWriteBranch, sql },
    studioMod,
  ] = await Promise.all([
    import("@usegraft/core"),
    import("@usegraft/mcp"),
    import("@usegraft/content-api"),
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

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

  // The bind host decides, not an env var an operator has to remember: on
  // loopback the endpoint is reachable only from this machine, so anonymous MCP
  // is the zero-config local-dev default. Anywhere else it takes a deliberate
  // GRAFT_MCP_ALLOW_ANONYMOUS=1 (for an operator who fronts this with their own
  // auth proxy), and that choice is warned about below.
  //
  // Replaces GRAFT_MCP_REQUIRE_AUTH, which defaulted to off *everywhere*: a
  // bare `graft serve --host 0.0.0.0` published the whole tool surface to the
  // network unless someone remembered to set it. Deployments that already set
  // it to 1 were choosing today's default, so they are unaffected.
  const anonymousOptIn = process.env.GRAFT_MCP_ALLOW_ANONYMOUS === "1";
  const allowAnonymousMcp = loopback || anonymousOptIn;
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
    mdxTrust: config.mdxTrust,
    db: branch.db,
    branchId: writeBranch,
    scope: branch.scope,
    actor: resolveActor,
    allowAnonymous: allowAnonymousMcp,
  });

  const contentHandler = createContentApiHandler({
    collections: Object.keys(config.collections),
    branch: writeBranch,
    index: createDbIndexReader(branch.db),
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

  // Test what is ENFORCED, not what is configured. The old condition treated
  // "a dev token exists" as sufficient, so setting GRAFT_DEV_TOKEN silenced the
  // warning while anonymous callers kept reaching decide_approval — configuring
  // a resolver is not the same as requiring one to be used.
  if (!loopback && anonymousOptIn) {
    console.warn(
      "[graft serve] WARNING: GRAFT_MCP_ALLOW_ANONYMOUS=1 while bound beyond loopback — " +
        "unauthenticated callers can write content, upload assets and decide approvals. " +
        "Only do this behind an auth proxy you control.",
    );
  } else if (!loopback && issuers.length === 0 && !devToken) {
    console.warn(
      "[graft serve] WARNING: binding beyond loopback with no identity configured — " +
        "MCP will refuse every caller, because there is nothing to authenticate them against. " +
        "Set GRAFT_DEV_TOKEN or GRAFT_TRUSTED_ISSUERS.",
    );
  }

  let studioHandler: FetchHandler | undefined;
  if (studioMod) {
    // Resolve the caller and hand the Studio their scopes; the Studio decides
    // per route what each one permits. This used to return
    // `actor.kind !== "anonymous"`, which admitted ANY authenticated principal
    // — including the agent tokens GRAFT_DEV_TOKEN and OIDC issuers mint — to
    // approve/deny, document writes, commits and reverts.
    const authenticate =
      !loopback && (devToken || issuers.length > 0)
        ? async (request: Request) => {
            const actor = await resolveActor(request);
            if (actor.kind === "anonymous" || !actor.id) return null;
            return { kind: actor.kind, id: actor.id, scopes: actor.scopes ?? [] };
          }
        : !loopback
          ? () => null
          : undefined;
    studioHandler = studioMod.createStudioHandler({
      db: branch.db,
      collections: config.collections,
      contentDir: config.contentDir,
      mdxTrust: config.mdxTrust,
      defaultBranch: writeBranch,
      // Only reached on a loopback mount, where there is no caller identity to
      // attribute to. Off loopback the authenticated principal is used instead.
      decider: { kind: "agent", id: "studio-serve" },
      uiBasePath: "/studio",
      authenticate,
    });
  }

  const server = createServer(
    createNodeListener(
      createServeRouter({
        fn: fnHandler,
        mcp: mcpHandler,
        content: contentHandler,
        health,
        studio: studioHandler,
      }),
      { allowedHosts: allowedHostsFor(host) },
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
      `  documents  GET  ${base}/api/content/v1/documents`,
      `  search     GET  ${base}/api/content/v1/search`,
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
