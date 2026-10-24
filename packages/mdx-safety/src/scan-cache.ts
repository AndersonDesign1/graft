/**
 * Scanning a tree for executable MDX, with an optional cache of past results.
 *
 * `graft check` and `graft compile` scan every body on every run, and the
 * scan is a full parse with remark-gfm and remark-mdx: about 750 ms of a 2 s
 * check on a 50-page site. Almost every body is the same as last time, so a
 * caller can hand in a cache and skip the parse for a body it has already
 * scanned. The result for a given body depends only on the body and on the
 * parsers, so the cache is keyed on both: `mdxScanVersion()` names this
 * package and every parser package it runs.
 *
 * Only local, developer-run commands use a cache. Studio saves and MCP writes
 * scan every time, and `MdxBody` still refuses executable bodies at render.
 */
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
 * The packages whose versions decide what a scan finds: the remark plugins
 * this package runs, and the micromark extensions they parse with.
 */
const PARSERS: readonly (readonly [name: string, from: string | null])[] = [
  ["remark-parse", null],
  ["remark-gfm", null],
  ["remark-mdx", null],
  ["mdast-util-from-markdown", "remark-parse"],
  ["micromark", "mdast-util-from-markdown"],
  ["micromark-extension-gfm", "remark-gfm"],
  ["micromark-extension-mdxjs", "remark-mdx"],
];

let version: string | null | undefined;

/**
 * This scanner and its parsers, as one string, such as
 * `@usegraft/mdx-safety@1.0.0 remark-mdx@3.1.1 …`. A cache keyed on it drops
 * its entries when any of them changes. Null when a version cannot be read,
 * which means a cache must not be used.
 */
export function mdxScanVersion(): string | null {
  if (version !== undefined) return version;
  version = readVersions();
  return version;
}

function readVersions(): string | null {
  // findPackageJSON landed in Node 22.14; the CLI's floor is 22.16, but a
  // library caller on an older Node simply gets no cache.
  if (!("findPackageJSON" in nodeModule) || typeof nodeModule.findPackageJSON !== "function") {
    return null;
  }
  const find = nodeModule.findPackageJSON;
  try {
    const own = new URL("../package.json", import.meta.url);
    const parts = [readPackage(own.href)];
    const located = new Map<string, string>();
    for (const [name, from] of PARSERS) {
      const base = from === null ? own.href : located.get(from);
      if (base === undefined) return null;
      const path = find(name, base);
      if (path === undefined) return null;
      // The real path, not pnpm's symlink, so the next package resolves from
      // where this one actually sits.
      const url = pathToFileURL(realpathSync(path)).href;
      located.set(name, url);
      parts.push(readPackage(url));
    }
    return parts.join(" ");
  } catch {
    return null;
  }
}

function readPackage(url: string): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL(url), "utf8"));
  if (typeof pkg !== "object" || pkg === null || !("name" in pkg) || !("version" in pkg)) {
    throw new Error(`${url} has no name or version`);
  }
  return `${String(pkg.name)}@${String(pkg.version)}`;
}
