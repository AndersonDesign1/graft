/**
 * Where `graft login` keeps a hosted site's token, and which site a command
 * talks to.
 *
 * The file is `graft/hosts.json` under XDG_CONFIG_HOME (default ~/.config),
 * or under %APPDATA% on Windows. It holds bearer tokens, so the directory is
 * 0700 and the file 0600, written whole to a temporary file and renamed into
 * place so a crash never leaves half a token on disk.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { parseSiteOrigin } from "../site";

export interface SavedLogin {
  token: string;
  /** Who the token acts as, from Studio, when the site said. */
  user?: string;
  savedAt: string;
}

export interface HostsFile {
  version: 1;
  /** The site `--remote` uses when GRAFT_URL is not set. */
  default: string | null;
  hosts: Record<string, SavedLogin>;
}

export function hostsFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "graft", "hosts.json");
  if (process.platform === "win32" && env.APPDATA) return join(env.APPDATA, "graft", "hosts.json");
  return join(homedir(), ".config", "graft", "hosts.json");
}

const EMPTY: HostsFile = { version: 1, default: null, hosts: {} };

function isSavedLogin(value: unknown): value is SavedLogin {
  return (
    typeof value === "object" &&
    value !== null &&
    "token" in value &&
    typeof value.token === "string" &&
    "savedAt" in value &&
    typeof value.savedAt === "string"
  );
}

/** The saved logins; none when the file does not exist yet. */
export function readHosts(file: string = hostsFile()): HostsFile {
  if (!existsSync(file)) return { ...EMPTY, hosts: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("hosts" in parsed)) {
    throw new GraftError({
      code: "CONFIG_INVALID",
      message: `${file} is not a graft logins file.`,
      fix: `Delete it and run \`graft login <url>\` again.`,
      details: { file },
    });
  }
  const hosts: Record<string, SavedLogin> = {};
  if (typeof parsed.hosts === "object" && parsed.hosts !== null) {
    for (const [origin, login] of Object.entries(parsed.hosts)) {
      if (isSavedLogin(login)) hosts[origin] = login;
    }
  }
  const fallback =
    "default" in parsed && typeof parsed.default === "string" ? parsed.default : null;
  return { version: 1, default: fallback && hosts[fallback] ? fallback : null, hosts };
}

export function writeHosts(hosts: HostsFile, file: string = hostsFile()): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(hosts, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, file);
  // mkdir and writeFile modes are cut by the umask and ignored for an existing
  // directory or file; set them outright.
  chmodSync(dir, 0o700);
  chmodSync(file, 0o600);
}

/** True when anyone but the owner can read the file. */
export function readableByOthers(file: string = hostsFile()): boolean {
  return process.platform !== "win32" && existsSync(file) && (statSync(file).mode & 0o077) !== 0;
}

/** `graft_at_abcd…`: enough to tell tokens apart, never enough to use one. */
export function redactToken(token: string): string {
  return token.length > 13 ? `${token.slice(0, 13)}…` : "…";
}

/* ---- which site a command talks to ----------------------------------------- */

export type Target =
  | { kind: "local" }
  | { kind: "remote"; origin: string; token: string; source: "GRAFT_URL" | "graft login" };

export interface TargetChoice {
  /** --remote: the site in GRAFT_URL, else the one `graft login` saved last. */
  remote: boolean;
  /** --local: this folder's project, whatever GRAFT_URL says. */
  local: boolean;
}

/**
 * The project this command works on. --local wins; then --remote; then
 * GRAFT_URL alone; else the project in this folder. GRAFT_URL and
 * GRAFT_TOKEN are read from the real environment only, never from a .env, so
 * a file in some folder cannot point a command at a production site.
 */
export function resolveTarget(
  choice: TargetChoice,
  env: NodeJS.ProcessEnv = process.env,
  file: string = hostsFile(env),
): Target {
  if (choice.local) return { kind: "local" };
  const url = env.GRAFT_URL;
  if (!choice.remote && !url) return { kind: "local" };

  const saved = readHosts(file);
  const origin = url
    ? parseSiteOrigin(url, { sends: "token", passIt: "Set GRAFT_URL" })
    : saved.default;
  if (!origin) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "--remote has no site to talk to.",
      fix: "Run `graft login <url>` once, or set GRAFT_URL (and GRAFT_TOKEN) in the environment.",
    });
  }
  const token = env.GRAFT_TOKEN || saved.hosts[origin]?.token;
  if (!token) {
    throw new GraftError({
      code: "UNAUTHORIZED",
      message: `There is no token for ${origin}.`,
      fix: `Run \`graft login ${origin}\`, or set GRAFT_TOKEN to a token made in Studio under Developer, Agents.`,
      details: { origin },
    });
  }
  return { kind: "remote", origin, token, source: url ? "GRAFT_URL" : "graft login" };
}
