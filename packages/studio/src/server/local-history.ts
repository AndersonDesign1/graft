/**
 * History for a local Studio, from the checkout's git log.
 *
 * Locally a commit is the publish, so a document's history is the commits
 * that touched its file, and the activity feed is the commits under the
 * content directory. Without git, or outside a repository, there is none,
 * and the editor says so instead of failing.
 */
import type { ActivityEntry, HistoryEntry, StoredFile } from "@usegraft/compiler";
import { gitBlobSha } from "@usegraft/compiler";
import { git, gitRaw, safeContentPath, toContentRelative } from "../git";

/** Fields one log line carries, separated by the unit separator. */
const FORMAT = "%x1e%H%x1f%aI%x1f%an%x1f%s";
const SHA = /^[0-9a-f]{7,40}$/i;

export interface LocalHistory {
  history(path: string, options?: { limit?: number }): Promise<HistoryEntry[]>;
  readVersion(path: string, id: string): Promise<StoredFile | null>;
  activity(options?: { limit?: number }): Promise<ActivityEntry[]>;
}

/** One record of `git log --format=FORMAT [--name-only]`: the commit, then its paths. */
export function parseLog(out: string): Array<HistoryEntry & { files: string[] }> {
  return out
    .split("\x1e")
    .filter((record) => record.trim())
    .map((record) => {
      const [head = "", ...files] = record.split("\n");
      const [id = "", at = "", by = "", message = ""] = head.split("\x1f");
      const entry: HistoryEntry & { files: string[] } = {
        id,
        at,
        files: files.map((line) => line.trim()).filter(Boolean),
      };
      if (by) entry.by = by;
      if (message) entry.message = message;
      return entry;
    });
}

export function localHistory(contentDir: string): LocalHistory {
  return {
    async history(path, options = {}) {
      safeContentPath(contentDir, path);
      const out = await gitRaw(contentDir, [
        "log",
        `-n${options.limit ?? 50}`,
        `--format=${FORMAT}`,
        "--",
        path,
      ]);
      return parseLog(out).map(({ files: _files, ...entry }) => entry);
    },

    async readVersion(path, id) {
      safeContentPath(contentDir, path);
      if (!SHA.test(id)) return null;
      try {
        // `./` makes the path relative to the content directory, not the root.
        const raw = await gitRaw(contentDir, ["show", `${id}:./${path}`]);
        return { raw, version: gitBlobSha(raw) };
      } catch {
        // Not in that commit: it was deleted there, or not yet written.
        return null;
      }
    },

    async activity(options = {}) {
      const [prefix, out] = await Promise.all([
        git(contentDir, ["rev-parse", "--show-prefix"]),
        gitRaw(contentDir, [
          "log",
          `-n${options.limit ?? 20}`,
          `--format=${FORMAT}`,
          "--name-only",
          "--",
          ".",
        ]),
      ]);
      return parseLog(out).map(({ files, ...entry }) => ({
        ...entry,
        paths: files.flatMap((file) => toContentRelative(file, prefix) ?? []),
      }));
    },
  };
}
