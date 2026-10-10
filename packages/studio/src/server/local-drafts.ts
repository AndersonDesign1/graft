/**
 * Drafts for a local Studio, over the working tree.
 *
 * Locally the filesystem is the save target, so uncommitted content files are
 * the draft and a commit is the publish: the Changes drawer's model, behind
 * the same interface the GitHub store implements. Nothing new is invented;
 * the git calls are the ones git.ts already makes and tests.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { DraftChange, DraftWorkflow, PublishResult, StoredFile } from "@usegraft/compiler";
import { gitBlobSha } from "@usegraft/compiler";
import { commitChanges, git, gitRaw, readChanges, safeContentPath } from "../git";

export function localDrafts(contentDir: string): DraftWorkflow {
  return {
    async changes(): Promise<DraftChange[]> {
      const status = await readChanges(contentDir);
      // A draft's version is its bytes on disk; null is reserved for a deletion.
      const versionOf = (path: string): Promise<string | null> =>
        fileBlobSha(safeContentPath(contentDir, path));
      const out: DraftChange[] = [];
      for (const file of status.files) {
        if (file.status === "renamed") {
          out.push({
            path: file.path,
            kind: "added",
            version: await versionOf(file.path),
            conflict: false,
          });
          if (file.from)
            out.push({ path: file.from, kind: "deleted", version: null, conflict: false });
          continue;
        }
        const version = file.status === "deleted" ? null : await versionOf(file.path);
        out.push({ path: file.path, kind: file.status, version, conflict: false });
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
        message: options.message?.trim() || defaultMessage(paths),
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
        // A file staged as new and then deleted reads as "deleted", but it
        // has no published version either: restoring it from HEAD fails, and
        // in a repository with no commits there is no HEAD at all.
        const neverPublished =
          file.status === "added" ||
          (file.status === "deleted" && !(await inHead(contentDir, path)));
        if (neverPublished) {
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
 * The git blob SHA of a file, read as a stream: the drawer lists every
 * changed file, and a large one buffered whole would stall the server.
 * Equal to `gitBlobSha` of the same bytes. Null when the file is gone.
 */
async function fileBlobSha(full: string): Promise<string | null> {
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) return null;
  const hash = createHash("sha1").update(`blob ${info.size}\0`);
  for await (const chunk of createReadStream(full)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** Whether HEAD holds `path`. False with no commits yet, since there is no HEAD. */
async function inHead(contentDir: string, path: string): Promise<boolean> {
  try {
    await git(contentDir, ["cat-file", "-e", `HEAD:./${path}`]);
    return true;
  } catch {
    return false;
  }
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
