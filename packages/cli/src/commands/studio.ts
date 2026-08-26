/**
 * graft studio — opt-in local Studio window (Drizzle-style).
 * Serves the OpenAPI surface + interactive SPA on loopback by default.
 */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { userInfo } from "node:os";
import { GraftError } from "@usegraft/contracts";
import { findConfig, loadConfig, loadProjectEnv, requireDatabaseUrl } from "../config";
import { allowedHostsFor, createNodeListener } from "./serve";

export interface StudioCommandOptions {
  cwd: string;
  branchId?: string;
  port?: number;
  host?: string;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Who approval decisions are attributed to: the OS user running `graft studio`.
 * A local Studio is a person at a terminal, so this is the real identity — and
 * unlike a request field, the caller cannot choose it.
 */
function operatorIdentity(): { kind: string; id: string } {
  try {
    return { kind: "human", id: userInfo().username };
  } catch {
    return { kind: "human", id: process.env.USERNAME ?? process.env.USER ?? "operator" };
  }
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(cmd, args, () => {
    /* best-effort */
  });
}

export async function studioCommand(options: StudioCommandOptions): Promise<void> {
  loadProjectEnv(options.cwd);
  const config = await loadConfig(findConfig(options.cwd));
  const url = requireDatabaseUrl();

  const [{ createStudioHandler }, { createDb, resolveBranchHandle, scopeWriteBranch }] =
    await Promise.all([import("@usegraft/studio"), import("@usegraft/db")]);

  const control = createDb(url);
  const branchName = options.branchId ?? "main";
  const branch = await resolveBranchHandle(control.db, branchName, { databaseUrl: url });
  const writeBranch = scopeWriteBranch(branch.scope);

  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const requestedPort = options.port ?? Number(process.env.GRAFT_STUDIO_PORT ?? 4983);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    await branch.close();
    await control.close();
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `"${options.port ?? process.env.GRAFT_STUDIO_PORT}" is not a valid port.`,
      fix: "Pass --port <0-65535> (0 picks a free port).",
    });
  }

  const loopback = isLoopback(host);
  const devToken = process.env.GRAFT_DEV_TOKEN;
  if (!loopback && !devToken) {
    console.warn(
      "[graft studio] WARNING: binding beyond loopback with no GRAFT_DEV_TOKEN — " +
        "set a bearer token before exposing Studio to a network.",
    );
  }

  // `graft studio` is the operator's own tool, so the dev token identifies the
  // operator rather than an agent — it carries the full operator scope set.
  // Anything else is refused; this command has no notion of a lesser caller.
  const authenticate =
    !loopback && devToken
      ? (request: Request) => {
          const header = request.headers.get("authorization") ?? "";
          if (header !== `Bearer ${devToken}`) return null;
          return {
            ...operatorIdentity(),
            scopes: ["studio:read", "studio:write", "approvals:decide"],
          };
        }
      : !loopback
        ? () => null
        : undefined;

  const handler = createStudioHandler({
    db: branch.db,
    collections: config.collections,
    contentDir: config.contentDir,
    defaultBranch: writeBranch,
    decider: operatorIdentity,
    authenticate,
  });

  const server = createServer(createNodeListener(handler, { allowedHosts: allowedHostsFor(host) }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const base = `http://${host}:${port}`;

  console.log(
    [
      `graft studio — branch "${branchName}" (opt-in)`,
      `  ui         GET  ${base}/`,
      `  openapi    GET  ${base}/api/studio/v1/openapi.json`,
      `  Edit content, approve/deny — same ops as MCP/CLI.`,
    ].join("\n"),
  );

  if (loopback) openBrowser(`${base}/?branch=${encodeURIComponent(branchName)}`);

  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await branch.close();
  await control.close();
}
