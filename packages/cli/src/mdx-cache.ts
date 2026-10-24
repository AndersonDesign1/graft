/**
 * The MDX safety-scan cache `graft check` and `graft compile` keep between
 * runs, so a body that has not changed is not parsed again.
 *
 * It lives under the user's cache directory, never in the project, so it is
 * never committed and a checkout cannot ship one. One file per content
 * directory: `$XDG_CACHE_HOME/graft/mdx-safety/<hash of the path>.json`.
 * Entries are keyed on the sha256 of the body, and the whole file is dropped
 * when the scanner or a parser it runs changes version (`mdxScanVersion`).
 *
 * Each save keeps only the bodies that run looked at, so the file stays the
 * size of the project. A missing, unreadable or corrupt file is an empty
 * cache, and a write that fails is ignored: the cache only ever saves time.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { MdxScanCache, MdxScanResult } from "@usegraft/mdx-safety";

export interface FileScanCache extends MdxScanCache {
  /** Write the results this run used. Never throws. */
  save(): void;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function mdxCacheFile(contentDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "graft", "mdx-safety", `${sha256(resolve(contentDir)).slice(0, 32)}.json`);
}

/** A scan result read back from disk, or undefined when it is not one. */
function asResult(value: unknown): MdxScanResult | undefined {
  if (Array.isArray(value)) {
    const nodes = value.filter(
      (node): node is MdxScanResult extends (infer N)[] ? N : never =>
        typeof node === "object" &&
        node !== null &&
        "kind" in node &&
        typeof node.kind === "string",
    );
    return nodes.length === value.length ? nodes : undefined;
  }
  if (typeof value === "object" && value !== null && "uncheckable" in value) {
    return typeof value.uncheckable === "string" ? { uncheckable: value.uncheckable } : undefined;
  }
  return undefined;
}

function load(file: string, version: string): Map<string, MdxScanResult> {
  const results = new Map<string, MdxScanResult>();
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return results;
    if (!("version" in parsed) || parsed.version !== version) return results;
    if (!("results" in parsed) || typeof parsed.results !== "object" || parsed.results === null) {
      return results;
    }
    for (const [key, value] of Object.entries(parsed.results)) {
      const result = asResult(value);
      if (result !== undefined) results.set(key, result);
    }
  } catch {
    // No file yet, or one we cannot read: start empty.
  }
  return results;
}

/**
 * The cache for one content directory, or undefined when the scanner's
 * version cannot be read (then every body is scanned, as before).
 */
export async function openMdxCache(
  contentDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FileScanCache | undefined> {
  const { mdxScanVersion } = await import("@usegraft/mdx-safety");
  const version = mdxScanVersion();
  if (version === null) return undefined;
  const file = mdxCacheFile(contentDir, env);
  const known = load(file, version);
  const used = new Map<string, MdxScanResult>();
  return {
    get(body) {
      const key = sha256(body);
      const result = known.get(key);
      if (result !== undefined) used.set(key, result);
      return result;
    },
    set(body, result) {
      used.set(sha256(body), result);
    },
    save() {
      try {
        mkdirSync(join(file, ".."), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, JSON.stringify({ version, results: Object.fromEntries(used) }));
        renameSync(temp, file);
      } catch {
        // A read-only or full disk only costs the next run its head start.
      }
    },
  };
}
