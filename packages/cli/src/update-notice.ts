/**
 * The notice `graft` prints when a newer Graft is on npm.
 *
 * Beta releases carry security fixes (beta.8 closed `---js` frontmatter code
 * execution), and a beta tester who never upgrades keeps the hole. So the CLI
 * asks the registry for the dist-tags at most once a day, compares the tag for
 * the channel this CLI came from, and prints one notice on stderr. Every
 * failure (offline, slow registry, unwritable cache) means no notice, never an
 * error: the command the person ran is what matters.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { findProjectEnvFile } from "./env-file";

const PACKAGE = "@usegraft/cli";
const UPGRADE_URL = "https://graft.page/docs/upgrading";
const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

export type DistTags = Record<string, string>;

/** How much the upgrade matters, which sets the notice's color. */
export type NoticeLevel = "security" | "info";

export interface UpdateNotice {
  current: string;
  latest: string;
  level: NoticeLevel;
}

interface Version {
  core: [number, number, number];
  prerelease: string[];
}

function parseVersion(raw: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    raw.trim(),
  );
  if (!match) return undefined;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  // A numeric identifier sorts before an alphanumeric one (semver 11.4.3).
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Semver order: -1, 0 or 1. Prerelease identifiers compare numerically where
 * both are numbers, so beta.10 is newer than beta.9. Undefined when either
 * side is not a version.
 */
export function compareVersions(a: string, b: string): number | undefined {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return undefined;
  const coreDiff =
    Math.sign(left.core[0] - right.core[0]) ||
    Math.sign(left.core[1] - right.core[1]) ||
    Math.sign(left.core[2] - right.core[2]);
  if (coreDiff !== 0) return coreDiff;
  // A release is newer than any prerelease of the same core version.
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = compareIdentifiers(l, r);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The dist-tag this version was published under: `beta` for 1.0.0-beta.8,
 * `latest` for a release. Undefined for a canary (a snapshot nobody upgrades
 * from) and for anything that is not a version.
 */
export function channelOf(version: string): string | undefined {
  const parsed = parseVersion(version);
  if (!parsed) return undefined;
  const tag = parsed.prerelease[0];
  if (tag === undefined) return "latest";
  if (/^\d/.test(tag) || tag.startsWith("canary")) return undefined;
  return tag;
}

/**
 * The newest version this install should move to, or undefined when it is
 * current. A prerelease install also looks at `latest`, so a beta tester is
 * told when the stable release ships.
 */
export function newerVersion(current: string, tags: DistTags): UpdateNotice | undefined {
  const channel = channelOf(current);
  if (!channel) return undefined;
  let best: string | undefined;
  for (const candidate of new Set([tags[channel], tags.latest])) {
    if (candidate === undefined) continue;
    if (best === undefined || (compareVersions(candidate, best) ?? 0) > 0) best = candidate;
  }
  if (best === undefined || compareVersions(best, current) !== 1) return undefined;
  return { current, latest: best, level: channel === "latest" ? "info" : "security" };
}

/**
 * True when this run should not ask the registry. With `cwd`, a
 * GRAFT_NO_UPDATE_CHECK in the project's .env counts too: the check starts
 * before any command loads that file, and it only reads the one key.
 */
export function updateCheckDisabled(env: NodeJS.ProcessEnv, cwd?: string): boolean {
  if (env.GRAFT_NO_UPDATE_CHECK || env.CI || env.VITEST) return true;
  if (cwd === undefined) return false;
  const file = findProjectEnvFile(cwd);
  if (!file) return false;
  try {
    return Boolean(parseEnv(readFileSync(file, "utf8")).GRAFT_NO_UPDATE_CHECK);
  } catch {
    return false;
  }
}

export function defaultCacheFile(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "graft", "update-check.json");
}

interface CacheEntry {
  checkedAt: number;
  /** The registry that gave this answer; another registry's answer is not reused. */
  registry: string;
  tags: DistTags;
}

function readCache(file: string): CacheEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    if (!("checkedAt" in parsed) || typeof parsed.checkedAt !== "number") return undefined;
    if (!("registry" in parsed) || typeof parsed.registry !== "string") return undefined;
    if (!("tags" in parsed) || typeof parsed.tags !== "object" || parsed.tags === null) {
      return undefined;
    }
    const tags: DistTags = {};
    for (const [tag, version] of Object.entries(parsed.tags)) {
      if (typeof version === "string") tags[tag] = version;
    }
    return { checkedAt: parsed.checkedAt, registry: parsed.registry, tags };
  } catch {
    return undefined;
  }
}

function writeCache(file: string, entry: CacheEntry): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(entry));
  } catch {
    // An unwritable cache only means the next run asks the registry again.
  }
}

/** The registry in npm_config_registry (npm's own setting), without a trailing slash. */
function registryOf(env: NodeJS.ProcessEnv): string {
  return (env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");
}

/** Ask the registry for the dist-tags. */
export async function fetchDistTags(env: NodeJS.ProcessEnv): Promise<DistTags> {
  const registry = registryOf(env);
  const response = await fetch(`${registry}/-/package/${encodeURIComponent(PACKAGE)}/dist-tags`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`registry answered ${response.status}`);
  const body: unknown = await response.json();
  const tags: DistTags = {};
  if (typeof body === "object" && body !== null) {
    for (const [tag, version] of Object.entries(body)) {
      if (typeof version === "string") tags[tag] = version;
    }
  }
  return tags;
}

export interface CheckOptions {
  current: string;
  env: NodeJS.ProcessEnv;
  cacheFile?: string;
  fetchTags?: (env: NodeJS.ProcessEnv) => Promise<DistTags>;
  now?: number;
}

/**
 * The notice to print, if any. Reads the cache when it is less than a day
 * old; otherwise asks the registry and caches the answer. A failed request is
 * cached too, so an offline machine waits a day before trying again.
 */
export async function checkForUpdate(options: CheckOptions): Promise<UpdateNotice | undefined> {
  if (!channelOf(options.current)) return undefined;
  const now = options.now ?? Date.now();
  const cacheFile = options.cacheFile ?? defaultCacheFile(options.env);
  const registry = registryOf(options.env);
  const cached = readCache(cacheFile);
  let tags: DistTags;
  const fresh = cached && now - cached.checkedAt >= 0 && now - cached.checkedAt < DAY_MS;
  if (cached && fresh && cached.registry === registry) {
    tags = cached.tags;
  } else {
    try {
      tags = await (options.fetchTags ?? fetchDistTags)(options.env);
    } catch {
      tags = {};
    }
    writeCache(cacheFile, { checkedAt: now, registry, tags });
  }
  return newerVersion(options.current, tags);
}

/** Color on a terminal that has not asked for none (https://no-color.org). */
export function useColor(env: NodeJS.ProcessEnv, isTTY: boolean | undefined): boolean {
  return Boolean(isTTY) && !env.NO_COLOR;
}

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";
const COLOR = { security: "\u001b[33m", info: "\u001b[36m" } satisfies Record<NoticeLevel, string>;

export function formatUpdateNotice(notice: UpdateNotice, color: boolean): string {
  const headline = `Graft ${notice.latest} is available. You have ${notice.current}.`;
  const advice =
    notice.level === "security"
      ? "Beta releases often include security fixes, so upgrade every @usegraft package together:"
      : "Upgrade every @usegraft package together:";
  const hide = "Set GRAFT_NO_UPDATE_CHECK=1 to hide this notice.";
  if (!color) return ["", headline, advice, `  ${UPGRADE_URL}`, hide].join("\n");
  const tint = COLOR[notice.level];
  return [
    "",
    `${tint}${BOLD}${headline}${RESET}`,
    `${tint}${advice}${RESET}`,
    `  ${UPGRADE_URL}`,
    `\u001b[2m${hide}${RESET}`,
  ].join("\n");
}
