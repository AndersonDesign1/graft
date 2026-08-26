/**
 * The git surface behind the Changes drawer.
 *
 * Graft has no draft table, no publish flag and no undo stack, because content
 * is git-authoritative. So the honest answer to "what have I changed?" is
 * `git status`, and the honest answer to "make it permanent" is a commit. This
 * module is those two questions, scoped to the content directory and answered
 * in a shape the UI can render without knowing any git.
 *
 * Scoped to contentDir on purpose — the same line `revert.ts` draws. The
 * operator asked about their content, not their source; a Studio offering to
 * commit `src/` would be a git client, which is not what this is.
 *
 * Nothing here pushes, and nothing here rewrites history. A local commit needs
 * no credentials, reaches nobody, and is reversible; pushing is a remote write,
 * which is a deliberate separate feature (the GitHub App). The parity rule the
 * Studio lives under is satisfied without a new command: the headless
 * equivalent of this surface is git itself.
 */
import { execFile } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { resolveContained } from "@usegraft/compiler";
import { GraftError } from "@usegraft/contracts";
import type {
  ChangeStatus,
  ChangedFileDto,
  CommitResultDto,
  DiffHunkDto,
  DiffLineDto,
  FileDiffDto,
  GitChangesDto,
} from "./types";

const exec = promisify(execFile);

/** Trimmed stdout — for scalar answers (a sha, a branch name). */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

/**
 * Untouched stdout — for machine formats where whitespace is data.
 *
 * Not a stylistic split: trimming `--porcelain` output is exactly the bug
 * `parsePorcelainPaths` had to be rewritten around, because the status field's
 * leading space is significant and a trim eats it.
 *
 * `maxBuffer` is raised because a first-commit diff of a whole content tree
 * comfortably exceeds Node's 1 MB default, and the failure mode there is a
 * truncated diff rather than an error.
 */
export async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/* ---- status -------------------------------------------------------------- */

export interface PorcelainEntry {
  /** Index (staged) column. */
  x: string;
  /** Work-tree column. */
  y: string;
  /** Repository-root-relative, forward slashes — how git emits it. */
  path: string;
  /** Previous path, on a rename or copy. */
  from?: string;
}

/**
 * Parse `git status --porcelain -z`.
 *
 * `-z` rather than the newline format for one reason: it is unambiguous.
 * Newline output quotes and escapes any path with a space or a non-ASCII
 * character, so reading it means re-implementing git's C quoting; `-z` emits
 * the bytes verbatim and separates records with NUL, which no path can contain.
 *
 * Records are `XY<space>PATH<NUL>`; a rename or copy appends its source as the
 * next NUL-terminated field, so that case consumes two records.
 */
export function parsePorcelainZ(out: string): PorcelainEntry[] {
  const fields = out.split("\0");
  const entries: PorcelainEntry[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    // A trailing NUL leaves an empty tail; short records are not records.
    if (!field || field.length < 4) continue;

    const x = field[0] as string;
    const y = field[1] as string;
    // The status field is exactly two columns plus one space. Fixed offset is
    // safe here (unlike the trimmed newline format) because `-z` output is
    // never trimmed by us — the leading columns always survive.
    const path = field.slice(3);
    if (!path) continue;

    const entry: PorcelainEntry = { x, y, path };
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const from = fields[++i];
      if (from) entry.from = from;
    }
    entries.push(entry);
  }

  return entries;
}

/**
 * git's two status columns, in the editor's vocabulary.
 *
 * The work-tree column wins when it says the file is gone: the drawer
 * describes what the operator has *now*, so a document staged as new and then
 * deleted from disk reads as deleted, not as new.
 */
export function statusOf(entry: Pick<PorcelainEntry, "x" | "y">): ChangeStatus {
  const { x, y } = entry;
  if (x === "?") return "added";
  if (x === "R" || y === "R" || x === "C" || y === "C") return "renamed";
  if (y === "D" || x === "D") return "deleted";
  if (x === "A") return "added";
  return "modified";
}

/** Anything in the index column means part of this change is already staged. */
export const isStaged = (entry: Pick<PorcelainEntry, "x">): boolean =>
  entry.x !== " " && entry.x !== "?";

/**
 * Re-base a repository-root-relative path onto the content directory.
 *
 * `git status` reports from the repository root no matter which directory it
 * ran in — a detail that silently produces paths nothing can open if you
 * assume otherwise. `git rev-parse --show-prefix` is the offset between them.
 *
 * Returns null for paths outside the content directory, which makes the
 * function total: callers filter rather than branch.
 */
export function toContentRelative(path: string, prefix: string): string | null {
  if (!prefix) return path;
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return path.startsWith(base) ? path.slice(base.length) : null;
}

function toChange(entry: PorcelainEntry, prefix: string): ChangedFileDto | null {
  const path = toContentRelative(entry.path, prefix);
  if (!path) return null;
  const from = entry.from ? toContentRelative(entry.from, prefix) : null;
  return {
    path,
    status: statusOf(entry),
    staged: isStaged(entry),
    ...(from ? { from } : {}),
  };
}

/**
 * The branch header `git status -b` prints as its first record.
 *
 * Three shapes, and only the first is the common one:
 *   `## main...origin/main [ahead 6]`   tracking a remote
 *   `## main`                           no upstream
 *   `## HEAD (no branch)`               detached
 *
 * Returns null for detached, because "HEAD" is not a branch name and showing
 * it as one would misname where a commit lands.
 */
export function parseBranchHeader(record: string): string | null {
  const rest = record.slice(3).trim();
  if (!rest || rest.startsWith("HEAD (")) return null;
  const name = (rest.split("...")[0] ?? "").split(" ")[0] ?? "";
  return name && name !== "HEAD" ? name : null;
}

/** Branch and files out of one `git status -b --porcelain -z` call. */
export function parseStatusZ(out: string): { branch: string | null; entries: PorcelainEntry[] } {
  const records = out.split("\0");
  const first = records[0] ?? "";
  const isHeader = first.startsWith("## ");
  return {
    branch: isHeader ? parseBranchHeader(first) : null,
    // Rejoin so the rename pairing in parsePorcelainZ still sees its two
    // consecutive fields; slicing the array here would have to duplicate it.
    entries: parsePorcelainZ(records.slice(isHeader ? 1 : 0).join("\0")),
  };
}

/**
 * What has changed in the content directory since the last commit.
 *
 * Two git invocations, not four. That matters because this runs on every
 * document save to keep the top bar's count live, and on Windows a process
 * spawn is expensive enough to feel: `rev-parse` answers two questions at
 * once, and `status -b` carries the branch that would otherwise be a third.
 *
 * Never throws for the absence of git. A project that is not a repository is
 * an unusual Graft project but a legitimate one — content still compiles and
 * serves — so this reports `tracked: false` with the reason and lets the
 * drawer explain, exactly as `asset-url` returns a null URL rather than a 500
 * when a static project has no asset store. Errors are for the commit path,
 * where the operator asked for something that genuinely cannot happen.
 */
export async function readChanges(contentDir: string): Promise<GitChangesDto> {
  let prefix: string;
  let head: string | null = null;

  try {
    // Raw, and split before trimming: when the content directory *is* the
    // repository root the prefix is empty, so the first line is empty — and a
    // trim would delete it and shift the SHA into the prefix's place.
    const out = await gitRaw(contentDir, ["rev-parse", "--show-prefix", "--short", "HEAD"]);
    const [prefixLine, headLine] = out.split("\n");
    prefix = (prefixLine ?? "").trim();
    head = (headLine ?? "").trim() || null;
  } catch (error) {
    // A repository with no commits yet fails on `HEAD` but is still a
    // repository — a normal state on a project's first day, and one where
    // every file is new. Retry without the part that needs a commit.
    try {
      prefix = await git(contentDir, ["rev-parse", "--show-prefix"]);
    } catch (fatal) {
      return {
        tracked: false,
        reason: reasonForMissingGit(fatal ?? error),
        gitBranch: null,
        head: null,
        files: [],
      };
    }
  }

  // `-uall` lists the files inside a new directory rather than collapsing it
  // to `dir/`: a new section of docs must arrive as documents, not as a folder
  // the operator cannot review or select.
  const raw = await gitRaw(contentDir, ["status", "--porcelain", "-z", "-b", "-uall", "--", "."]);
  const { branch, entries } = parseStatusZ(raw);

  const files = entries
    .map((entry) => toChange(entry, prefix))
    .filter((change): change is ChangedFileDto => change !== null)
    .sort((a, b) => a.path.localeCompare(b.path));

  return { tracked: true, gitBranch: branch, head, files };
}

function reasonForMissingGit(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "ENOENT") {
    return "git is not installed, or not on this process's PATH.";
  }
  return "This content directory is not inside a git repository.";
}

/* ---- diff ---------------------------------------------------------------- */

/** Hard cap on rendered diff lines. A 4,000-line paste is not review material. */
const MAX_DIFF_LINES = 600;

/**
 * Parse a unified diff into hunks with per-line numbering.
 *
 * Parsed on the server so the UI stays a renderer and this stays testable —
 * the same reason the content tree is merged server-side rather than joined in
 * the browser.
 *
 * `\ No newline at end of file` is dropped: it is a note about the previous
 * line, not a line, and the drawer is for review rather than for reconstructing
 * a patch.
 */
export function parseUnifiedDiff(text: string): { hunks: DiffHunkDto[]; truncated: boolean } {
  const hunks: DiffHunkDto[] = [];
  let current: DiffHunkDto | null = null;
  let oldLine = 0;
  let newLine = 0;
  let rendered = 0;
  let truncated = false;

  for (const line of text.split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = {
        heading: (header[5] ?? "").trim(),
        oldStart: oldLine,
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newLine,
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }

    if (!current) continue; // preamble: diff --git, index, ---, +++
    if (line.startsWith("\\")) continue;

    if (rendered >= MAX_DIFF_LINES) {
      truncated = true;
      break;
    }

    const marker = line[0];
    const text_ = line.slice(1);
    if (marker === "+") {
      current.lines.push({ kind: "add", text: text_, newLine: newLine++ });
    } else if (marker === "-") {
      current.lines.push({ kind: "remove", text: text_, oldLine: oldLine++ });
    } else if (marker === " ") {
      current.lines.push({ kind: "context", text: text_, oldLine: oldLine++, newLine: newLine++ });
    } else {
      continue; // a stray line between hunks; not ours to interpret
    }
    rendered++;
  }

  // A hunk header with no body survives the truncation break; drop it so the
  // UI never renders an empty frame.
  return { hunks: hunks.filter((hunk) => hunk.lines.length > 0), truncated };
}

/** A file git has never seen has no "before" to diff against — synthesise one. */
function addedFileDiff(fullPath: string): { hunks: DiffHunkDto[]; truncated: boolean } {
  const text = readFileSync(fullPath, "utf8");
  // Split on the terminator, CR included. A `\r` is part of how the line ends,
  // not part of the line — and git normalises it away on commit anyway, so
  // rendering it here would show a byte the diff of that same file will not
  // show once it is tracked.
  const all = text.split(/\r?\n/);
  // A trailing newline splits into a final empty element that is not a line.
  const source = all.at(-1) === "" ? all.slice(0, -1) : all;
  const shown = source.slice(0, MAX_DIFF_LINES);
  const lines: DiffLineDto[] = shown.map((value, i) => ({
    kind: "add",
    text: value,
    newLine: i + 1,
  }));

  return {
    hunks:
      lines.length > 0
        ? [
            {
              heading: "",
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: source.length,
              lines,
            },
          ]
        : [],
    truncated: source.length > shown.length,
  };
}

const SNIFF_BYTES = 8000;

/** Cheap binary sniff: a NUL byte in the first block, which is git's own test. */
function looksBinary(fullPath: string): boolean {
  if (statSync(fullPath).size === 0) return false;
  // Reads only the first block. This used to readFileSync the WHOLE file to
  // inspect 8KB of it, so one large file in the content tree made every diff
  // render allocate all of it.
  const buffer = Buffer.alloc(SNIFF_BYTES);
  const fd = openSync(fullPath, "r");
  try {
    const read = readSync(fd, buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, read).includes(0);
  } finally {
    closeSync(fd);
  }
}

/**
 * The diff for one changed file, against the last commit.
 *
 * `git diff HEAD` rather than staged/unstaged as separate views: "what have I
 * changed since the last commit" is the only question the drawer asks, and
 * splitting it would surface git's index as a concept the editor never opted
 * into. Partial staging still commits correctly — see `commitChanges`.
 */
export async function readFileDiff(contentDir: string, path: string): Promise<FileDiffDto> {
  const fullPath = safeContentPath(contentDir, path);
  const exists = existsSync(fullPath);

  if (exists && looksBinary(fullPath)) {
    return { path, binary: true, hunks: [], added: 0, removed: 0, truncated: false };
  }

  // Tolerant: `git diff HEAD` fails in a repository with no commits, which is
  // precisely when every file is new.
  const raw = await gitRaw(contentDir, ["diff", "HEAD", "--", path]).catch(() => "");

  const parsed =
    raw.trim().length > 0
      ? parseUnifiedDiff(raw)
      : exists
        ? addedFileDiff(fullPath)
        : { hunks: [], truncated: false };

  let added = 0;
  let removed = 0;
  for (const hunk of parsed.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added++;
      else if (line.kind === "remove") removed++;
    }
  }

  return { path, binary: false, hunks: parsed.hunks, added, removed, truncated: parsed.truncated };
}

/* ---- commit -------------------------------------------------------------- */

/**
 * Resolve a request-supplied path inside the content directory, or refuse.
 *
 * These arrive over HTTP. The Studio is local by default but hostable, so a
 * path is untrusted input wherever it comes from: resolve it and require the
 * result to still live under the root, which covers `..`, absolute paths and
 * Windows separators in one check rather than three greps.
 */
export function safeContentPath(contentDir: string, path: string): string {
  // Was lexical only (resolve + prefix check), which a symlink INSIDE the tree
  // defeats: the string stays contained and readFileSync then follows the link
  // out. Git can commit symlinks, so a cloned template could point a .mdx entry
  // at ~/.ssh/id_rsa and read it back through the diff endpoint.
  return resolveContained(contentDir, path, { label: "content path" });
}

export interface CommitOptions {
  paths: string[];
  message: string;
}

/**
 * Commit the selected content files.
 *
 * Three deliberate properties:
 *
 * 1. **Only what the drawer showed.** Requested paths are intersected with the
 *    live change set, so this endpoint cannot commit a file the operator was
 *    never shown — a stronger guarantee than path confinement alone, and it
 *    also catches the stale-tab case where the tree moved underneath.
 * 2. **Identity is checked before anything is staged.** `git commit` failing on
 *    an unset `user.email` after a successful `git add` would leave the index
 *    mutated by a request that reported failure. Preflight keeps the failure
 *    total.
 * 3. **Pathspec-scoped commit.** `git commit -- <paths>` records the work-tree
 *    state of exactly those paths and leaves everything else the operator had
 *    staged alone — including their source changes, which are none of our
 *    business.
 */
export async function commitChanges(
  contentDir: string,
  options: CommitOptions,
): Promise<CommitResultDto> {
  const message = options.message.trim();
  if (!message) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "A commit needs a message.",
      fix: "Describe the change in a sentence — it is what the history will show.",
    });
  }
  if (options.paths.length === 0) {
    throw new GraftError({
      code: "INPUT_VALIDATION_FAILED",
      message: "No files selected.",
      fix: "Select at least one changed file to commit.",
    });
  }

  const changes = await readChanges(contentDir);
  if (!changes.tracked) {
    throw new GraftError({
      code: "GIT_UNAVAILABLE",
      message: changes.reason ?? "Content is not under git.",
      fix: "Run `git init` at the project root and commit once, then the Studio can record changes for you.",
    });
  }

  const known = new Map(changes.files.map((file) => [file.path, file]));
  const selected: ChangedFileDto[] = [];
  for (const path of options.paths) {
    safeContentPath(contentDir, path); // refuses anything outside content
    const file = known.get(path);
    if (!file) {
      throw new GraftError({
        code: "INPUT_VALIDATION_FAILED",
        message: `"${path}" is not in the current change set.`,
        fix: "Reopen Changes to reload the list — the file may already be committed, or reverted.",
        details: { path },
      });
    }
    selected.push(file);
  }

  await requireCommitterIdentity(contentDir);

  // A rename is two paths to git. Staging only the new one would leave the
  // deletion of the old behind and the commit would contain both files.
  const pathspecs = [...new Set(selected.flatMap((file) => [file.path, file.from ?? []].flat()))];

  try {
    await git(contentDir, ["add", "--", ...pathspecs]);
    await git(contentDir, ["commit", "-m", message, "--", ...pathspecs]);
  } catch (error) {
    throw new GraftError({
      code: "COMMIT_FAILED",
      message: "git refused the commit.",
      fix: "The staged selection is still there — check `git status`, resolve what git reported, and commit again from the Studio or a terminal.",
      details: { stderr: stderrOf(error), files: pathspecs },
    });
  }

  const sha = await git(contentDir, ["rev-parse", "HEAD"]).catch(() => "");

  return {
    sha: sha || null,
    shortSha: sha ? sha.slice(0, 7) : "",
    message,
    gitBranch: changes.gitBranch,
    files: selected.map((file) => file.path),
  };
}

/**
 * Refuse early when git has no one to attribute the commit to.
 *
 * git's own error here is six lines of shell instructions aimed at a terminal,
 * arriving after the files are staged. Catching it first means the failure
 * changes nothing and the fix names the two commands.
 */
async function requireCommitterIdentity(contentDir: string): Promise<void> {
  // One call for both keys: --get-regexp lists every match, and asking twice
  // is a second process spawn for an answer git already gave.
  const config = await git(contentDir, ["config", "--get-regexp", "^user\\.(name|email)$"]).catch(
    () => "",
  );
  const name = /^user\.name\s+\S/m.test(config);
  const email = /^user\.email\s+\S/m.test(config);
  if (name && email) return;

  throw new GraftError({
    code: "COMMIT_FAILED",
    message: "git has no committer identity configured, so it cannot sign the commit.",
    fix: 'Run `git config user.name "Your Name"` and `git config user.email "you@example.com"` in this repository (add --global to set it everywhere), then commit again.',
    details: { hasName: name, hasEmail: email },
  });
}

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: string })?.stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
