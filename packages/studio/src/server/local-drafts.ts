/**
 * Drafts for a local Studio, over the working tree.
 *
 * Locally the filesystem is the save target, so uncommitted content files are
 * the draft and a commit is the publish: the Changes drawer's model, behind
 * the same interface the GitHub store implements. Nothing new is invented;
 * the git calls are the ones git.ts already makes and tests.
 */
import { existsSync, unlinkSync } from "node:fs";
import type { DraftChange, DraftWorkflow, PublishResult, StoredFile } from "@usegraft/compiler";
import { gitBlobSha } from "@usegraft/compiler";
import { commitChanges, git, gitRaw, readChanges, safeContentPath } from "../git";

export function localDrafts(contentDir: string): DraftWorkflow {
  return {
    async changes(): Promise<DraftChange[]> {
      const status = await readChanges(contentDir);
      const out: DraftChange[] = [];
      for (const file of status.files) {
        if (file.status === "renamed") {
          out.push({ path: file.path, kind: "added", version: null, conflict: false });
          if (file.from)
            out.push({ path: file.from, kind: "deleted", version: null, conflict: false });
          continue;
        }
        out.push({ path: file.path, kind: file.status, version: null, conflict: false });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },

    async readPublished(path: string): Promise<StoredFile | null> {
      safeContentPath(contentDir, path);
      try {
        // `HEAD:./path` resolves against the working directory, which is the
        // content directory, so no prefix arithmetic is needed.
        const raw = await gitRaw(contentDir, ["show", `HEAD:./${path}`]);
        return { raw, version: gitBlobSha(raw) };
      } catch {
        return null;
      }
    },

    async publish(options): Promise<PublishResult> {
      const paths = await renameDestinations(contentDir, options.paths);
      const result = await commitChanges(contentDir, {
        paths,
        message: options.message?.trim() || defaultMessage(options.paths),
      });
      return {
        mode: "direct",
        commit: result.sha ? { sha: result.sha } : null,
        published: result.files,
        tookTheirs: [],
      };
    },

    async discard(_actor, paths): Promise<void> {
      const status = await readChanges(contentDir);
      const byPath = new Map(status.files.map((file) => [file.path, file]));
      const restore: string[] = [];
      for (const path of await renameDestinations(contentDir, paths)) {
        const full = safeContentPath(contentDir, path);
        const file = byPath.get(path);
        if (!file) continue;
        if (file.status === "added") {
          // Never committed, so there is no published version to go back to:
          // discarding it removes it. Unstage first if it was staged.
          await git(contentDir, [
            "rm",
            "--cached",
            "--quiet",
            "--ignore-unmatch",
            "--",
            path,
          ]).catch(() => "");
          if (existsSync(full)) unlinkSync(full);
        } else {
          restore.push(path);
          if (file.from) restore.push(file.from);
        }
      }
      if (restore.length > 0) {
        await git(contentDir, [
          "restore",
          "--source=HEAD",
          "--staged",
          "--worktree",
          "--",
          ...restore,
        ]);
      }
    },

    async reviews() {
      return [];
    },
  };
}

/**
 * `changes()` lists a rename as two entries, the new path and the old one,
 * but git holds it as one change under the new path. Map an old path to its
 * rename so either entry, or both, can be published or discarded.
 */
async function renameDestinations(contentDir: string, paths: string[]): Promise<string[]> {
  const status = await readChanges(contentDir);
  const renamedFrom = new Map<string, string>();
  for (const file of status.files) {
    if (file.status === "renamed" && file.from) renamedFrom.set(file.from, file.path);
  }
  return [...new Set(paths.map((path) => renamedFrom.get(path) ?? path))];
}

function defaultMessage(paths: string[]): string {
  const names = paths.map((path) => path.replace(/\.mdx?$/, ""));
  return names.length <= 3 ? `Update ${names.join(", ")}` : `Update ${names.length} documents`;
}
