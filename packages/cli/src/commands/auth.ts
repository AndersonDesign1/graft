/**
 * graft login, graft logout, graft auth status, graft auth token: keep a
 * hosted site's token so `--remote` and `graft api` can use it.
 *
 * The token is one made in Studio under Developer, Agents. It is never a flag
 * value, where it would land in shell history and in `ps`: it comes from
 * stdin or a prompt that does not echo. No token can decide an approval, so a
 * remote CLI cannot approve its own destructive calls.
 */
import { GraftError } from "@usegraft/contracts";
import { UsageError } from "../args";
import {
  hostsFile,
  readableByOthers,
  readHosts,
  redactToken,
  writeHosts,
  type HostsFile,
  type SavedLogin,
} from "../remote/hosts";
import { readHidden, readStdin } from "../remote/prompt";
import { whoAmI } from "../remote/site-http";
import { parseSiteOrigin } from "../site";

const SITE = { sends: "token", passIt: "Run graft login" } as const;

export interface LoginOptions {
  url: string;
  /** Read the token from stdin (also the default when stdin is not a terminal). */
  withToken: boolean;
  noInput: boolean;
}

export interface LoginResult {
  origin: string;
  user: string | null;
  scopes: string[];
  studio: boolean;
  file: string;
}

async function readToken(options: LoginOptions, origin: string): Promise<string> {
  if (options.withToken || !process.stdin.isTTY) {
    const token = await readStdin();
    if (token) return token;
    throw new UsageError(
      "no token on stdin.",
      `Pipe it in: printf %s "$TOKEN" | graft login ${origin} --with-token`,
      { command: "login" },
    );
  }
  if (options.noInput) {
    throw new UsageError(
      "graft login needs a token, and --no-input stops it from asking.",
      `Pipe it in: printf %s "$TOKEN" | graft login ${origin} --with-token`,
      { command: "login" },
    );
  }
  const token = await readHidden(
    `Paste a token for ${origin} (made in Studio under Developer, Agents): `,
  );
  if (token) return token;
  throw new UsageError("no token given.", "Nothing was saved.", { command: "login" });
}

export async function loginCommand(options: LoginOptions): Promise<LoginResult> {
  const origin = parseSiteOrigin(options.url, SITE);
  const token = await readToken(options, origin);
  const who = await whoAmI(origin, token);
  const file = hostsFile();
  const hosts = readHosts(file);
  const login: SavedLogin = { token, savedAt: new Date().toISOString() };
  if (who.user) login.user = who.user;
  hosts.hosts[origin] = login;
  hosts.default = origin;
  writeHosts(hosts, file);
  return { origin, user: who.user, scopes: who.scopes, studio: who.studio, file };
}

export function formatLogin(result: LoginResult): string[] {
  const who = result.user ? ` as ${result.user}` : "";
  const access = result.scopes.length > 0 ? ` (${result.scopes.join(", ")})` : "";
  const lines = [`Logged in to ${result.origin}${who}${access}.`, `Saved to ${result.file}.`];
  if (!result.studio) {
    lines.push(
      "This site serves MCP but not Studio: --remote works, graft api has nothing to call.",
    );
  }
  lines.push("Run commands against it with --remote, such as graft content list --remote.");
  return lines;
}

export interface LogoutResult {
  origin: string;
  removed: boolean;
  default: string | null;
}

export function logoutCommand(url: string | undefined): LogoutResult {
  const file = hostsFile();
  const hosts = readHosts(file);
  const origin = url ? parseSiteOrigin(url, SITE) : hosts.default;
  if (!origin) {
    throw new GraftError({
      code: "UNAUTHORIZED",
      message: "Not logged in to any site.",
      fix: "Nothing to do. graft login <url> saves a site's token.",
    });
  }
  const removed = origin in hosts.hosts;
  delete hosts.hosts[origin];
  if (hosts.default === origin) hosts.default = Object.keys(hosts.hosts)[0] ?? null;
  if (removed) writeHosts(hosts, file);
  return { origin, removed, default: hosts.default };
}

export interface HostStatus {
  origin: string;
  source: "GRAFT_URL" | "graft login";
  default: boolean;
  /** The token's start, never all of it. */
  token: string;
  valid: boolean;
  user: string | null;
  scopes: string[];
  error?: { code: string; message: string; fix?: string };
}

export interface AuthStatus {
  file: string;
  /** True when the logins file can be read by other users on this computer. */
  exposed: boolean;
  hosts: HostStatus[];
}

/** Every site the CLI can talk to, each checked against the site itself. */
export async function authStatusCommand(env: NodeJS.ProcessEnv = process.env): Promise<AuthStatus> {
  const file = hostsFile(env);
  const saved: HostsFile = readHosts(file);
  const entries: { origin: string; token: string; source: HostStatus["source"] }[] = [];
  if (env.GRAFT_URL) {
    const origin = parseSiteOrigin(env.GRAFT_URL, { sends: "token", passIt: "Set GRAFT_URL" });
    const token = env.GRAFT_TOKEN || saved.hosts[origin]?.token;
    if (token) entries.push({ origin, token, source: "GRAFT_URL" });
  }
  for (const [origin, login] of Object.entries(saved.hosts)) {
    if (!entries.some((entry) => entry.origin === origin)) {
      entries.push({ origin, token: login.token, source: "graft login" });
    }
  }
  const hosts: HostStatus[] = [];
  for (const entry of entries) {
    const status: HostStatus = {
      origin: entry.origin,
      source: entry.source,
      default: saved.default === entry.origin,
      token: redactToken(entry.token),
      valid: false,
      user: null,
      scopes: [],
    };
    try {
      const who = await whoAmI(entry.origin, entry.token);
      status.valid = true;
      status.user = who.user;
      status.scopes = who.scopes;
    } catch (error) {
      if (!(error instanceof GraftError)) throw error;
      status.error = { code: error.code, message: error.message };
      if (error.fix) status.error.fix = error.fix;
    }
    hosts.push(status);
  }
  return { file, exposed: readableByOthers(file), hosts };
}

export function formatAuthStatus(status: AuthStatus): string[] {
  if (status.hosts.length === 0) {
    return ["Not logged in to any site. Run graft login <url>, or set GRAFT_URL and GRAFT_TOKEN."];
  }
  const lines: string[] = [];
  for (const host of status.hosts) {
    const tags = [
      host.source === "GRAFT_URL" ? "from GRAFT_URL" : "",
      host.default ? "default" : "",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`${host.origin}${tags ? `  (${tags})` : ""}`);
    if (host.valid) {
      lines.push(`  token ${host.token} works${host.user ? `, as ${host.user}` : ""}`);
      if (host.scopes.length > 0) lines.push(`  access: ${host.scopes.join(", ")}`);
    } else {
      lines.push(
        `  token ${host.token} does not work: ${host.error?.code}: ${host.error?.message}`,
      );
      if (host.error?.fix) lines.push(`  fix: ${host.error.fix}`);
    }
  }
  if (status.exposed) {
    lines.push("", `${status.file} can be read by other users. Run: chmod 600 ${status.file}`);
  }
  return lines;
}

/** The token for a site, raw, for piping into another tool. */
export function authTokenCommand(
  url: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const saved = readHosts(hostsFile(env));
  const fromEnv = env.GRAFT_URL
    ? parseSiteOrigin(env.GRAFT_URL, { sends: "token", passIt: "Set GRAFT_URL" })
    : undefined;
  const origin = url ? parseSiteOrigin(url, SITE) : (fromEnv ?? saved.default);
  const token =
    origin && origin === fromEnv && env.GRAFT_TOKEN
      ? env.GRAFT_TOKEN
      : origin && saved.hosts[origin]?.token;
  if (!origin || !token) {
    throw new GraftError({
      code: "UNAUTHORIZED",
      message: origin ? `There is no token for ${origin}.` : "Not logged in to any site.",
      fix: "Run graft login <url> first.",
    });
  }
  return token;
}
