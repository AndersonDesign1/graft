/**
 * Copying a database-sourced project's published content into git.
 *
 * Git is a record here, never a source (ADR 0007): the content is already
 * live when the mirror runs, so nothing the mirror does can change the site.
 * Each run compares every path's live version with what it last committed,
 * and sends the difference as one commit (or one pull request, merged at once
 * when the branch allows), so a day of publishing costs one or two CI runs
 * instead of one per publish.
 */
import {
  liveVersions,
  mirroredVersions,
  publishedFiles,
  readHeads,
  recordMirrored,
  withMirrorLock,
  type Database,
} from "@usegraft/db";
import type { GitHubStore } from "./store/github/store";
import type { ReviewRequest } from "./store/types";

export type MirrorMode = "batch" | "each";

export interface MirrorConfig {
  /** `each`: after every publish. `batch`: on a schedule, or when asked. */
  mode: MirrorMode;
  /** How changes reach the branch. Default `commit`. */
  via?: "commit" | "pull-request";
  /** For `batch` under `graft serve`: minutes between runs. Default 60. */
  everyMinutes?: number;
}

export interface MirrorOptions {
  db: Database;
  github: GitHubStore;
  branchId?: string;
  via?: "commit" | "pull-request";
}

export type MirrorResult =
  | {
      status: "mirrored";
      paths: string[];
      commit: { sha: string; url: string } | null;
      review?: ReviewRequest;
      /** False when a pull request was opened and GitHub would not merge it yet. */
      merged: boolean;
    }
  | { status: "up-to-date" }
  /** Another process holds the mirror lock; it will commit these changes. */
  | { status: "busy" };

/** Commit whatever was published since the last run. */
export async function mirrorToGit(options: MirrorOptions): Promise<MirrorResult> {
  const branch = options.branchId ?? "main";
  const result = await withMirrorLock(options.db, branch, async (tx) => {
    const [live, mirrored] = await Promise.all([
      liveVersions(tx, branch),
      mirroredVersions(tx, branch),
    ]);
    const changed = [...live.entries()]
      .filter(([path, version]) => mirrored.get(path) !== version)
      // A path never mirrored and deleted before the first run was never in git.
      .filter(([path, version]) => !(version === null && !mirrored.has(path)))
      .map(([path, version]) => ({ path, version }))
      .sort((a, b) => a.path.localeCompare(b.path));
    if (changed.length === 0) return { status: "up-to-date" } as const;

    const raws = new Map((await publishedFiles(tx, branch)).map((file) => [file.path, file.raw]));
    const heads = new Map(
      (await readHeads(tx, branch, { paths: changed.map((c) => c.path) })).map((head) => [
        head.path,
        head,
      ]),
    );
    const lines = changed.map(({ path, version }) => {
      const who = heads.get(path)?.published?.actorName;
      return `- ${version === null ? "Delete" : "Update"} ${path}${who ? ` (${who})` : ""}`;
    });
    const message = [
      changed.length === 1
        ? `content: ${changed[0]?.version === null ? "delete" : "update"} ${changed[0]?.path}`
        : `content: ${changed.length} changes published in Graft`,
      "",
      "Published from the database. The site already serves these changes.",
      "",
      ...lines,
    ].join("\n");

    const committed = await options.github.commitFiles(
      changed.map(({ path, version }) => ({
        path,
        raw: version === null ? null : (raws.get(path) ?? null),
      })),
      { message, via: options.via ?? "commit" },
    );
    await recordMirrored(tx, branch, changed, committed.commit?.sha ?? null);
    return {
      status: "mirrored",
      paths: changed.map((c) => c.path),
      commit: committed.commit,
      merged: committed.merged,
      ...(committed.review ? { review: committed.review } : {}),
    } as const;
  });
  return result ?? { status: "busy" };
}
