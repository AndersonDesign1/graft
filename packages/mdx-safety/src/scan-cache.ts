/**
 * Scanning a tree for executable MDX, with an optional cache of past results.
 *
 * `graft check` and `graft compile` scan every body on every run, and the
 * scan is a full parse with remark-gfm and remark-mdx: about 750 ms of a 2 s
 * check on a 50-page site. Almost every body is the same as last time, so a
 * caller can hand in a cache and skip the parse for a body it has already
 * scanned. The result for a given body depends only on the body and on the
 * parsers, so the cache is keyed on both: `mdxScanVersion()` covers this
 * package and every package the scan runs, down the whole dependency tree.
 *
 * Only local, developer-run commands use a cache. Studio saves and MCP writes
 * scan every time, and `MdxBody` still refuses executable bodies at render.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { findExecutableMdx, UncheckableMdxError, type ExecutableNode } from "./index";

/** What a scan found: the executable constructs, or that the body could not be read. */
export type MdxScanResult = ExecutableNode[] | { uncheckable: string };

/** Past scan results, by body. An implementation decides where they live. */
export interface MdxScanCache {
  get(body: string): MdxScanResult | undefined;
  set(body: string, result: MdxScanResult): void;
}

/** Scan a body, using and filling the cache when one is given. */
export function scanMdx(body: string, cache?: MdxScanCache): MdxScanResult {
  const cached = cache?.get(body);
  if (cached !== undefined) return cached;
  let result: MdxScanResult;
  try {
    result = findExecutableMdx(body);
  } catch (error) {
    if (!(error instanceof UncheckableMdxError)) throw error;
    result = { uncheckable: error.message };
  }
  cache?.set(body, result);
  return result;
}

/**
 * The packages the scan runs. Every package they depend on, however deep,
 * decides what a scan finds too (micromark and each of its extensions are
 * versioned on their own), so the version covers the whole tree under them.
 */
const SCANNER_ROOTS = ["unified", "remark-parse", "remark-gfm", "remark-mdx", "unist-util-visit"];

let version: string | null | undefined;

/**
 * This scanner and every package it runs, as one string: this package's name
 * and version, then a hash of every `name@version` under the scanner's own
 * dependencies. A cache keyed on it drops its entries when any of them
 * changes. Null when a version cannot be read, which means a cache must not
 * be used.
 */
export function mdxScanVersion(): string | null {
  if (version !== undefined) return version;
  const packages = mdxScanPackages();
  version = packages === null ? null : scanVersionOf(packages);
  return version;
}

/** A version string for a list of `name@version` entries; order does not matter. */
export function scanVersionOf(packages: readonly string[]): string {
  const [own = "", ...rest] = packages;
  const digest = createHash("sha256")
    .update([...new Set(rest)].sort().join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `${own} parsers:${digest}`;
}

/**
 * `name@version` for this package, then for every package under the scanner's
 * dependencies, found the way Node resolves them. Null when one cannot be read.
 */
export function mdxScanPackages(): string[] | null {
  // findPackageJSON landed in Node 22.14; the CLI's floor is 22.16, but a
  // library caller on an older Node simply gets no cache.
  if (!("findPackageJSON" in nodeModule) || typeof nodeModule.findPackageJSON !== "function") {
    return null;
  }
  const find = nodeModule.findPackageJSON;
  try {
    const own = new URL("../package.json", import.meta.url).href;
    const found = [readPackage(own).id];
    const seen = new Set<string>();
    const queue = SCANNER_ROOTS.map((name) => ({ name, from: own }));
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const path = find(next.name, next.from);
      if (path === undefined) return null;
      // The real path, not pnpm's symlink, so the next package resolves from
      // where this one actually sits.
      const url = pathToFileURL(realpathSync(path)).href;
      if (seen.has(url)) continue;
      seen.add(url);
      const pkg = readPackage(url);
      found.push(pkg.id);
      for (const name of pkg.dependencies) queue.push({ name, from: url });
    }
    return found;
  } catch {
    return null;
  }
}

/** The two things the version needs from a package.json. */
interface PackageInfo {
  /** `name@version`. */
  id: string;
  dependencies: string[];
}

function readPackage(url: string): PackageInfo {
  const pkg: unknown = JSON.parse(readFileSync(new URL(url), "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("name" in pkg) || !("version" in pkg)) {
    throw new Error(`${url} has no name or version`);
  }
  const dependencies =
    "dependencies" in pkg && typeof pkg.dependencies === "object" && pkg.dependencies !== null
      ? Object.keys(pkg.dependencies)
      : [];
  return { id: `${String(pkg.name)}@${String(pkg.version)}`, dependencies };
}
