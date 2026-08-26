/**
 * Path containment for anything that resolves caller-supplied names onto disk.
 *
 * Lexical containment (`resolve` + a prefix check) is not enough. It answers
 * "does this string stay under the root", which a symlink INSIDE the root
 * silently defeats: `docs/notes.mdx -> ~/.ssh/id_rsa` passes every string test
 * and then `readFileSync` follows it. Git can commit symlinks, so a cloned
 * template or a supply-chain repo can plant one.
 *
 * `resolveContained` therefore checks the bytes AND the filesystem.
 */
import { existsSync, lstatSync } from "node:fs";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { GraftError } from "@usegraft/contracts";

export interface ContainOptions {
  /** What the path names, for the error message (default: "path"). */
  label?: string;
  /**
   * Follow symlinks instead of refusing them. Only for paths the operator
   * typed, never for anything a request or a manifest supplied.
   */
  allowSymlinks?: boolean;
  /**
   * Accept an absolute path, provided it still resolves inside the root.
   *
   * For a local agent naming a file on its own machine an absolute path is the
   * natural form, and containment is what matters, not the spelling. Leave this
   * off for anything arriving in a request field, where "relative to the root"
   * is the contract and an absolute path means the caller misunderstood — or is
   * probing.
   */
  allowAbsolute?: boolean;
}

function refuse(label: string, path: string, why: string, fix: string): never {
  throw new GraftError({
    code: "INPUT_VALIDATION_FAILED",
    message: `${label} "${path}" ${why}.`,
    fix,
    details: { path },
  });
}

/**
 * Resolve `path` against `root` and return it only if it genuinely lives there.
 *
 * Refuses absolute paths, NUL bytes, anything that escapes the root once
 * normalised, and — unless `allowSymlinks` — any segment that is a symbolic
 * link, whether or not its target escapes. A symlink inside the tree is a
 * redirection the caller did not get to choose, so the honest answer is no.
 */
export function resolveContained(root: string, path: string, options: ContainOptions = {}): string {
  const label = options.label ?? "path";
  const rootAbs = resolve(root);

  if (!path || path.includes("\0")) {
    refuse(
      label,
      path,
      "is empty or contains a NUL byte",
      "Pass a relative path with no NUL bytes.",
    );
  }
  if (isAbsolute(path) && options.allowAbsolute !== true) {
    refuse(label, path, "is absolute", `Pass a path relative to ${rootAbs}.`);
  }

  const candidate = isAbsolute(path) ? resolve(normalize(path)) : resolve(rootAbs, normalize(path));
  if (candidate !== rootAbs && !candidate.startsWith(rootAbs + sep)) {
    refuse(
      label,
      path,
      "resolves outside the permitted directory",
      `Pass a path inside ${rootAbs}.`,
    );
  }

  if (options.allowSymlinks !== true) {
    // Walk every segment: a symlinked PARENT redirects the leaf just as well.
    let cursor = rootAbs;
    for (const segment of candidate.slice(rootAbs.length).split(sep).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
        refuse(
          label,
          path,
          "passes through a symbolic link",
          "Symbolic links are refused because they redirect a path somewhere the caller did not name. Replace the link with a real file, or read the target directly.",
        );
      }
    }
  }

  return candidate;
}
