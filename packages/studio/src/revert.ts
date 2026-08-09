/**
 * Revert content to a previous compilation.
 *
 * This is only possible because Graft is git-authoritative: every compilation
 * records the SHA its documents were read at, so "go back" is a real operation
 * on real files rather than an undo stack we would have to keep ourselves.
 * Restore the content directory from that commit, recompile, and the index
 * follows.
 *
 * Deliberately conservative. It refuses rather than guesses when:
 *   - the compilation has no git SHA (compiled outside a repo)
 *   - the content directory has uncommitted changes (reverting would destroy
 *     work with no way back)
 *   - the SHA is not reachable from this clone (shallow checkout, wrong repo)
 *
 * It restores paths under contentDir only. Never the whole tree — the
 * operator asked to revert content, not their source.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GraftError } from "@graft/contracts";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

/**
 * Paths out of `git status --porcelain`.
 *
 * Porcelain v1 lines are `XY PATH`, where the status field is two columns —
 * but either column can be a space, and we trim the output, so the first line
 * may arrive with one, two or no leading spaces. Slicing a fixed offset ate
 * the first character of the path whenever it did. Match the status field
 * instead of counting characters.
 *
 * Renames read `R  old -> new`; the new path is the one that exists.
 */
export function parsePorcelainPaths(status: string): string[] {
  return status
    .split("\n")
    .map((line) => /^\s*\S{1,2}\s+(.+)$/.exec(line)?.[1]?.trim())
    .map((path) => path?.split(" -> ").pop())
    .filter((path): path is string => Boolean(path));
}

export interface RevertPreflight {
  /** Files under contentDir with uncommitted changes; revert refuses if any. */
  dirty: string[];
  /** Whether the SHA exists in this clone. */
  reachable: boolean;
  /** Short SHA for display. */
  shortSha: string;
}

export async function preflightRevert(
  contentDir: string,
  gitSha: string | null,
): Promise<RevertPreflight> {
  if (!gitSha) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "That compilation has no git SHA, so there is nothing to revert to.",
      fix: "Only compilations made inside a git repository can be reverted.",
    });
  }

  let reachable = true;
  try {
    // cat-file -e is the cheap existence check; ^{commit} rejects a tag or blob.
    await git(contentDir, ["cat-file", "-e", `${gitSha}^{commit}`]);
  } catch {
    reachable = false;
  }

  // Porcelain output is the stable machine format; `-- .` limits it to content.
  const status = reachable
    ? await git(contentDir, ["status", "--porcelain", "--", "."]).catch(() => "")
    : "";

  return { dirty: parsePorcelainPaths(status), reachable, shortSha: gitSha.slice(0, 7) };
}

/**
 * Restore contentDir to `gitSha`. Returns the paths git reported as changed.
 * Caller recompiles — this function does not touch the database, so a failed
 * checkout can never leave the index describing files that were not written.
 */
export async function revertContentTo(contentDir: string, gitSha: string): Promise<string[]> {
  const pre = await preflightRevert(contentDir, gitSha);

  if (!pre.reachable) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `Commit ${pre.shortSha} is not in this clone.`,
      fix: "Fetch the full history (git fetch --unshallow) and try again.",
      details: { gitSha },
    });
  }

  if (pre.dirty.length > 0) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: `${pre.dirty.length} uncommitted change(s) in the content directory would be destroyed.`,
      fix: "Commit or stash the content changes first, then revert.",
      details: { dirty: pre.dirty.slice(0, 20) },
    });
  }

  // `checkout <sha> -- .` rewrites the working tree *and* the git index for
  // these paths, leaving HEAD alone — the repo stays on its branch with the
  // old content staged, which the operator can then review and commit. That
  // is deliberately not a commit: reverting is their decision to record.
  await git(contentDir, ["checkout", gitSha, "--", "."]);

  const changed = await git(contentDir, ["diff", "--name-only", "--cached", "--", "."]).catch(
    () => "",
  );

  return changed.split("\n").filter(Boolean);
}
