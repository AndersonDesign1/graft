/**
 * graft pull, graft push, graft mirror — moving content between a
 * database-sourced project, a checkout of it, and git.
 *
 * pull and push treat the files like a clone: `.graft/sync.json` remembers
 * what each file was pulled at, so a file you changed is never overwritten by
 * a pull, and a push is refused if someone published over its base since.
 */
import { join } from "node:path";
import type { MirrorResult, PullResult, PushResult } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import {
  findConfig,
  loadConfig,
  loadProjectEnv,
  requireDatabaseUrl,
  type ProjectConfig,
} from "../config";
import { operatorName } from "./approvals";

export interface SyncCommandOptions {
  cwd: string;
  branchId?: string;
  only?: string[];
  force?: boolean;
  dryRun?: boolean;
}

/** Where pull and push remember what each file was based on. */
export function syncStateFile(config: ProjectConfig): string {
  return join(config.projectDir, ".graft", "sync.json");
}

async function databaseProject(cwd: string, command: string): Promise<ProjectConfig> {
  loadProjectEnv(cwd);
  const config = await loadConfig(findConfig(cwd));
  if (config.content.source !== "database") {
    throw new GraftError({
      code: "CONTENT_SOURCE_MISMATCH",
      message: `This project keeps its content in git, so \`graft ${command}\` has nothing to move: the files are already the source.`,
      fix: 'Use git itself (git pull / git push). `graft pull` and `graft push` are for projects with `content = { source: "database" }`.',
      details: { source: config.content.source },
    });
  }
  return config;
}

async function withDatabase<T>(
  fn: (db: import("@usegraft/db").Database) => Promise<T>,
): Promise<T> {
  const url = requireDatabaseUrl();
  const { createDb } = await import("@usegraft/db");
  const handle = createDb(url);
  try {
    return await fn(handle.db);
  } finally {
    await handle.close();
  }
}

export async function pullCommand(options: SyncCommandOptions): Promise<PullResult> {
  const config = await databaseProject(options.cwd, "pull");
  const { pullContent } = await import("@usegraft/compiler");
  return withDatabase((db) =>
    pullContent({
      db,
      contentDir: config.contentDir,
      stateFile: syncStateFile(config),
      branchId: options.branchId ?? "main",
      ...(options.only ? { only: options.only } : {}),
      ...(options.force ? { force: true } : {}),
    }),
  );
}

export function formatPull(result: PullResult): string[] {
  const lines = [
    result.updated.length === 0
      ? "Your files already match what is published."
      : `Updated ${result.updated.length} file(s) to the published version:`,
    ...result.updated.map((path) => `  ${path}`),
  ];
  if (result.kept.length > 0) {
    lines.push(`Kept ${result.kept.length} file(s) you changed (graft push publishes them):`);
    lines.push(...result.kept.map((path) => `  ${path}`));
  }
  if (result.conflicts.length > 0) {
    lines.push(
      `${result.conflicts.length} file(s) changed both here and in the database, left as they are:`,
      ...result.conflicts.map((path) => `  ${path}`),
      "Bring your change into the published version and push, or run graft pull --force to take the published one.",
    );
  }
  return lines;
}

export async function pushCommand(options: SyncCommandOptions): Promise<PushResult> {
  const config = await databaseProject(options.cwd, "push");
  const { pushContent } = await import("@usegraft/compiler");
  const name = operatorName();
  return withDatabase((db) =>
    pushContent({
      db,
      contentDir: config.contentDir,
      stateFile: syncStateFile(config),
      branchId: options.branchId ?? "main",
      collections: config.collections,
      mdxTrust: config.mdxTrust,
      actor: { id: name, name },
      ...(options.only ? { only: options.only } : {}),
      ...(options.force ? { force: true } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
    }),
  );
}

export function formatPush(result: PushResult): string[] {
  if (result.pushed.length === 0) return ["Nothing to push: no file changed since your last pull."];
  const verb = result.dryRun ? "Would publish" : "Published";
  const lines = [`${verb} ${result.pushed.length} file(s):`, ...result.pushed.map((p) => `  ${p}`)];
  if (result.changes) {
    lines.push(
      `Live site: +${result.changes.added.length} added, ~${result.changes.changed.length} changed, -${result.changes.removed.length} removed.`,
    );
  }
  return lines;
}

export async function mirrorCommand(options: {
  cwd: string;
  branchId?: string;
}): Promise<MirrorResult> {
  const config = await databaseProject(options.cwd, "mirror");
  const { githubStoreFromEnv, mirrorToGit } = await import("@usegraft/compiler");
  const github = githubStoreFromEnv({
    contentDir: config.contentDir,
    projectRoot: config.projectDir,
  });
  if (!github) {
    throw new GraftError({
      code: "ENV_VAR_MISSING",
      message: "There is no repository to mirror to: GRAFT_GITHUB_REPO is not set.",
      fix: "Set GRAFT_GITHUB_REPO=owner/name and GRAFT_GITHUB_TOKEN (Contents and Pull requests read/write), or the GitHub App variables.",
    });
  }
  return withDatabase((db) =>
    mirrorToGit({
      db,
      github,
      branchId: options.branchId ?? "main",
      via: config.content.mirror?.via ?? "commit",
    }),
  );
}

export function formatMirror(result: MirrorResult): string[] {
  if (result.status === "up-to-date") return ["Git already has everything that is published."];
  if (result.status === "busy") return ["Another mirror is running; it will commit these changes."];
  const lines = [
    `Mirrored ${result.paths.length} change(s) to git:`,
    ...result.paths.map((p) => `  ${p}`),
  ];
  if (result.commit) lines.push(`Commit: ${result.commit.url}`);
  if (result.review && !result.merged) {
    lines.push(
      `Pull request ${result.review.url} is open: the branch needs checks or a review before it merges.`,
    );
  }
  return lines;
}
