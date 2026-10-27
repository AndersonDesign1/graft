/**
 * Moving content between a database-sourced project and a checkout of it.
 *
 * Postgres holds the published revisions; the files under contentDir are a
 * working copy, like a clone. `.graft/sync.json` records the version of each
 * file as it was last pulled (its base), which is what tells the two kinds of
 * change apart:
 *
 * - the file still matches its base, and the live version moved: behind, so
 *   `pull` updates it;
 * - the live version still matches the base, and the file moved: ahead, so
 *   `push` publishes it;
 * - both moved to different bytes: a conflict, which neither command
 *   resolves on its own.
 *
 * A push carries each file's base, and the database refuses the whole push
 * if any live version moved since: the same compare-and-swap Studio's saves
 * use, so a developer can never silently publish over an editor.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { GraftError, type ChangeSet } from "@usegraft/contracts";
import type { AnyCollection } from "@usegraft/core";
import type { Database, RevisionActor } from "@usegraft/db";
import type { MdxTrust } from "@usegraft/mdx-safety";
import { compile, validateDocuments } from "./compile";
import { walkContentFiles } from "./content-files";
import { resolveContained } from "./paths";
import { gitBlobSha } from "./store/blob";

export type SyncState = "in-sync" | "behind" | "ahead" | "conflict";

export interface SyncEntry {
  path: string;
  state: SyncState;
  /** The file's version on disk; null when there is no file. */
  local: string | null;
  /** The version it was last pulled at; undefined when it never was. */
  base: string | null | undefined;
  /** The live version in the database; null when unpublished or deleted. */
  live: string | null;
}

export interface SyncOptions {
  db: Database;
  contentDir: string;
  /** `.graft/sync.json` in the project. */
  stateFile: string;
  branchId?: string;
}

interface SyncFile {
  branch: string;
  /** Path → the live version it was pulled or pushed at (null: absent). */
  files: Record<string, string | null>;
}

function readState(file: string, branch: string): SyncFile {
  if (!existsSync(file)) return { branch, files: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SyncFile>;
    // A state written for another branch says nothing about this one.
    if (parsed.branch !== branch || typeof parsed.files !== "object" || !parsed.files) {
      return { branch, files: {} };
    }
    return { branch, files: parsed.files };
  } catch {
    return { branch, files: {} };
  }
}

function writeState(file: string, state: SyncFile): void {
  mkdirSync(dirname(file), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(state.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  writeFileSync(file, `${JSON.stringify({ branch: state.branch, files: sorted }, null, 2)}\n`);
}

function localFiles(contentDir: string): Map<string, { raw: string; version: string }> {
  const files = new Map<string, { raw: string; version: string }>();
  if (!existsSync(contentDir)) return files;
  for (const full of walkContentFiles(contentDir)) {
    const path = relative(contentDir, full).split(sep).join("/");
    const raw = readFileSync(full, "utf8");
    files.set(path, { raw, version: gitBlobSha(raw) });
  }
  return files;
}

function classify(
  local: string | null,
  base: string | null | undefined,
  live: string | null,
): SyncState {
  if (local === live) return "in-sync";
  if (base === undefined) {
    // Never pulled: one side missing is a plain copy, two different files are not.
    if (local === null) return "behind";
    if (live === null) return "ahead";
    return "conflict";
  }
  if (local === base) return "behind";
  if (live === base) return "ahead";
  return "conflict";
}

/** How the checkout compares with the live content, path by path. */
export async function syncStatus(options: SyncOptions): Promise<SyncEntry[]> {
  return (await compare(options)).entries;
}

/** syncStatus, with the bytes each local version was hashed from. */
async function compare(
  options: SyncOptions,
): Promise<{ entries: SyncEntry[]; local: Map<string, { raw: string; version: string }> }> {
  const branch = options.branchId ?? "main";
  const { liveVersions } = await import("@usegraft/db");
  const live = await liveVersions(options.db, branch);
  const state = readState(options.stateFile, branch);
  const local = localFiles(options.contentDir);
  const paths = new Set([...live.keys(), ...local.keys(), ...Object.keys(state.files)]);
  const entries: SyncEntry[] = [];
  for (const path of [...paths].sort()) {
    const localVersion = local.get(path)?.version ?? null;
    const liveVersion = live.get(path) ?? null;
    // Absent on both sides (deleted everywhere): nothing to report.
    if (localVersion === null && liveVersion === null) continue;
    const base = Object.hasOwn(state.files, path) ? (state.files[path] ?? null) : undefined;
    entries.push({
      path,
      state: classify(localVersion, base, liveVersion),
      local: localVersion,
      base,
      live: liveVersion,
    });
  }
  return { entries, local };
}

function selected(entries: SyncEntry[], only: string[] | undefined): SyncEntry[] {
  if (!only || only.length === 0) return entries;
  const wanted = only.map((path) => path.replace(/\\/g, "/").replace(/\.mdx?$/, ""));
  return entries.filter((entry) =>
    wanted.some((w) => entry.path === w || entry.path.replace(/\.mdx?$/, "") === w),
  );
}

export interface PullResult {
  /** Files written or removed to match the live content. */
  updated: string[];
  /** Files with unpushed changes, left as they are. */
  kept: string[];
  /** Files changed on both sides, left as they are unless forced. */
  conflicts: string[];
}

/**
 * Write the live content into the checkout. Files with changes of their own
 * are never overwritten: an ahead file is kept for `push`, and a conflict is
 * reported unless `force` says the live version wins.
 */
export async function pullContent(
  options: SyncOptions & { only?: string[]; force?: boolean },
): Promise<PullResult> {
  const branch = options.branchId ?? "main";
  const status = await compare(options);
  const entries = selected(status.entries, options.only);
  const { publishedFiles } = await import("@usegraft/db");
  const live = new Map(
    (await publishedFiles(options.db, branch)).map((file) => [file.path, file.raw]),
  );
  const state = readState(options.stateFile, branch);
  const result: PullResult = { updated: [], kept: [], conflicts: [] };

  for (const entry of entries) {
    if (entry.state === "ahead") {
      result.kept.push(entry.path);
      continue;
    }
    if (entry.state === "conflict" && !options.force) {
      result.conflicts.push(entry.path);
      continue;
    }
    if (entry.state !== "in-sync") {
      const full = resolveContained(options.contentDir, entry.path, { label: "content path" });
      const raw = live.get(entry.path);
      if (raw === undefined) rmSync(full, { force: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, raw);
      }
      result.updated.push(entry.path);
    }
    state.files[entry.path] = entry.live;
  }
  writeState(options.stateFile, state);
  return result;
}

export interface PushOptions extends SyncOptions {
  collections: Record<string, AnyCollection>;
  mdxTrust?: MdxTrust;
  actor: RevisionActor;
  only?: string[];
  /** Publish over conflicts: the files win. */
  force?: boolean;
  dryRun?: boolean;
}

export interface PushResult {
  /** Files published as the live version, or deletions published. */
  pushed: string[];
  /** Files changed on both sides, not pushed. */
  conflicts: string[];
  changes?: ChangeSet;
  dryRun: boolean;
}

/**
 * Publish the checkout's changes. Every file is validated as compile would,
 * and the database refuses the push if anything it is based on was
 * published over since the last pull, so nothing is written in either case.
 */
export async function pushContent(options: PushOptions): Promise<PushResult> {
  const branch = options.branchId ?? "main";
  const status = await compare(options);
  const entries = selected(status.entries, options.only);
  const pushing = entries.filter(
    (entry) => entry.state === "ahead" || (entry.state === "conflict" && options.force),
  );
  const conflicts = entries
    .filter((entry) => entry.state === "conflict" && !options.force)
    .map((entry) => entry.path);
  if (conflicts.length > 0 && !options.force) {
    throw new GraftError({
      code: "CONTENT_CONFLICT",
      message: `${conflicts.length === 1 ? `"${conflicts[0]}" was` : `${conflicts.length} documents were`} changed here and in the database since your last pull. Nothing was pushed.`,
      fix: "Run `graft pull` to see the published versions (your files with conflicts are kept), bring your change into them, then push again. `graft push --force` publishes your files over them instead.",
      details: { conflicts },
    });
  }
  if (pushing.length === 0 || options.dryRun) {
    return {
      pushed: pushing.map((entry) => entry.path),
      conflicts,
      dryRun: Boolean(options.dryRun),
    };
  }

  // The bytes that were hashed, so each version is the blob SHA of what is
  // stored even if a file is saved again mid-push.
  const writing = pushing.flatMap((entry) => {
    const file = status.local.get(entry.path);
    return entry.local !== null && file ? [{ sourcePath: entry.path, raw: file.raw }] : [];
  });
  // Slugs are unique across documents, so check the tree as it will be after
  // the push: what stays live, and what is pushed.
  const pushingPaths = new Set(pushing.map((entry) => entry.path));
  const { importPublished, publishedFiles } = await import("@usegraft/db");
  const staying = (await publishedFiles(options.db, branch))
    .filter((file) => !pushingPaths.has(file.path))
    .map((file) => ({ sourcePath: file.path, raw: file.raw }));
  validateDocuments([...staying, ...writing], options.collections, {
    mdxTrust: options.mdxTrust,
  });
  const raws = new Map(writing.map((file) => [file.sourcePath, file.raw]));

  const result = await importPublished(options.db, {
    branchId: branch,
    actor: options.actor,
    message: "Pushed from files",
    ...(options.force ? { replace: true } : {}),
    files: pushing.map((entry) => ({
      path: entry.path,
      raw: raws.get(entry.path) ?? null,
      version: entry.local,
      ...(options.force ? {} : { expected: entry.base ?? null }),
    })),
  });
  if (!result.ok) {
    throw new GraftError({
      code: "CONTENT_CONFLICT",
      message: `${result.stale.map((s) => `"${s.path}"`).join(", ")} was published by someone else while you pushed. Nothing was pushed.`,
      fix: "Run `graft pull`, bring your change into the published version, then push again.",
      details: { stale: result.stale },
    });
  }

  const compiled = await compile({
    db: options.db,
    contentDir: options.contentDir,
    collections: options.collections,
    mdxTrust: options.mdxTrust,
    branchId: branch,
    source: "database",
  });
  const state = readState(options.stateFile, branch);
  for (const entry of pushing) state.files[entry.path] = entry.local;
  writeState(options.stateFile, state);
  return { pushed: result.imported, conflicts, changes: compiled.changes, dryRun: false };
}
