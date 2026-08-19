/**
 * The Changes drawer writes to the operator's repository, so its safety
 * properties are not a matter of reading the code and agreeing with it.
 *
 * Two layers here. The pure parsers are pinned against real `git` output
 * shapes — a misparsed path is a file committed that the operator never saw,
 * or one they saw and did not get. The rest runs against a real repository in
 * a temp directory, because the load-bearing claims (status paths are
 * repository-root-relative; a pathspec commit leaves everything else alone)
 * are claims about git's behaviour, and a fixture cannot falsify them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GraftError } from "@usegraft/contracts";
import {
  commitChanges,
  isStaged,
  parseBranchHeader,
  parsePorcelainZ,
  parseStatusZ,
  parseUnifiedDiff,
  readChanges,
  readFileDiff,
  safeContentPath,
  statusOf,
  toContentRelative,
} from "./git";

/* ---- pure parsers -------------------------------------------------------- */

/** Records are NUL-terminated, so build fixtures the way git emits them. */
const z = (...records: string[]): string => `${records.join("\0")}\0`;

describe("parsePorcelainZ", () => {
  it("reads both status columns and the whole path", () => {
    const out = z(
      " M content/docs/quickstart.mdx",
      "M  content/docs/install.mdx",
      "MM content/docs/api.mdx",
      "?? content/docs/new-page.mdx",
      "A  content/docs/added.mdx",
      " D content/docs/gone.mdx",
    );

    expect(parsePorcelainZ(out).map((e) => [e.x, e.y, e.path])).toEqual([
      [" ", "M", "content/docs/quickstart.mdx"],
      ["M", " ", "content/docs/install.mdx"],
      ["M", "M", "content/docs/api.mdx"],
      ["?", "?", "content/docs/new-page.mdx"],
      ["A", " ", "content/docs/added.mdx"],
      [" ", "D", "content/docs/gone.mdx"],
    ]);
  });

  it("pairs a rename with its source, which arrives as the next record", () => {
    // The trap: consuming that field as a record of its own invents a
    // seventh change out of a path fragment.
    const entries = parsePorcelainZ(
      z("R  content/docs/new-name.mdx", "content/docs/old-name.mdx", " M content/docs/other.mdx"),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      x: "R",
      path: "content/docs/new-name.mdx",
      from: "content/docs/old-name.mdx",
    });
    expect(entries[1]?.path).toBe("content/docs/other.mdx");
  });

  it("keeps paths with spaces and non-ASCII intact", () => {
    // The whole reason for -z: the newline format would arrive quoted and
    // escaped ("\303\251"), and un-escaping it is git's C quoting rules.
    const entries = parsePorcelainZ(z("?? content/docs/my draft page.mdx", " M content/café.mdx"));
    expect(entries.map((e) => e.path)).toEqual([
      "content/docs/my draft page.mdx",
      "content/café.mdx",
    ]);
  });

  it("reports nothing for a clean tree", () => {
    expect(parsePorcelainZ("")).toEqual([]);
    expect(parsePorcelainZ("\0")).toEqual([]);
  });
});

describe("parseStatusZ", () => {
  it("reads the branch out of the header record git prints first", () => {
    const { branch, entries } = parseStatusZ(
      z("## main...origin/main [ahead 6]", " M content/docs/a.mdx"),
    );
    expect(branch).toBe("main");
    expect(entries.map((e) => e.path)).toEqual(["content/docs/a.mdx"]);
  });

  it("keeps a rename's two fields adjacent after dropping the header", () => {
    // The header shares the record stream with the file entries, so removing
    // it must not separate a rename from the source path that follows it.
    const { entries } = parseStatusZ(
      z("## main", "R  content/docs/new.mdx", "content/docs/old.mdx"),
    );
    expect(entries).toEqual([
      { x: "R", y: " ", path: "content/docs/new.mdx", from: "content/docs/old.mdx" },
    ]);
  });

  it("still parses when there is no header", () => {
    expect(parseStatusZ(z(" M content/docs/a.mdx")).entries).toHaveLength(1);
  });
});

describe("parseBranchHeader", () => {
  it("takes the local branch name, not the upstream or the ahead count", () => {
    expect(parseBranchHeader("## feat/core...origin/feat/core [ahead 6]")).toBe("feat/core");
    expect(parseBranchHeader("## main")).toBe("main");
  });

  it("returns null for a detached HEAD, which is not a branch", () => {
    // Rendering "HEAD" as the branch would tell the operator their commit
    // lands somewhere that does not exist.
    expect(parseBranchHeader("## HEAD (no branch)")).toBeNull();
  });

  it("returns null for an empty header", () => {
    expect(parseBranchHeader("## ")).toBeNull();
  });
});
describe("statusOf", () => {
  it("speaks the editor's verbs, not git's columns", () => {
    expect(statusOf({ x: "?", y: "?" })).toBe("added");
    expect(statusOf({ x: "A", y: " " })).toBe("added");
    expect(statusOf({ x: " ", y: "M" })).toBe("modified");
    expect(statusOf({ x: "M", y: "M" })).toBe("modified");
    expect(statusOf({ x: " ", y: "D" })).toBe("deleted");
    expect(statusOf({ x: "D", y: " " })).toBe("deleted");
    expect(statusOf({ x: "R", y: " " })).toBe("renamed");
  });

  it("lets the work tree win: staged-new then deleted reads as deleted", () => {
    // What the operator has *now* is no file. Calling that "new" would offer
    // them a document to review that is not there.
    expect(statusOf({ x: "A", y: "D" })).toBe("deleted");
  });

  it("marks anything in the index column as staged, but never untracked", () => {
    expect(isStaged({ x: "M" })).toBe(true);
    expect(isStaged({ x: " " })).toBe(false);
    expect(isStaged({ x: "?" })).toBe(false);
  });
});

describe("toContentRelative", () => {
  it("strips the content directory's offset within the repository", () => {
    expect(
      toContentRelative("examples/docs-site/content/docs/a.mdx", "examples/docs-site/content/"),
    ).toBe("docs/a.mdx");
  });

  it("passes paths through when content is the repository root", () => {
    expect(toContentRelative("docs/a.mdx", "")).toBe("docs/a.mdx");
  });

  it("returns null for anything outside, so callers filter instead of branching", () => {
    expect(
      toContentRelative("packages/studio/src/api.ts", "examples/docs-site/content/"),
    ).toBeNull();
    // A sibling directory that merely shares a prefix must not slip through.
    expect(toContentRelative("content-drafts/a.mdx", "content/")).toBeNull();
  });
});

describe("parseUnifiedDiff", () => {
  const diff = [
    "diff --git a/docs/a.mdx b/docs/a.mdx",
    "index 83db48f..bf269f4 100644",
    "--- a/docs/a.mdx",
    "+++ b/docs/a.mdx",
    "@@ -1,4 +1,5 @@ ## Heading",
    " unchanged one",
    "-was this",
    "+is now this",
    "+and this is new",
    " unchanged two",
    "",
  ].join("\n");

  it("numbers old and new lines independently", () => {
    const { hunks } = parseUnifiedDiff(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.lines).toEqual([
      { kind: "context", text: "unchanged one", oldLine: 1, newLine: 1 },
      { kind: "remove", text: "was this", oldLine: 2 },
      { kind: "add", text: "is now this", newLine: 2 },
      { kind: "add", text: "and this is new", newLine: 3 },
      { kind: "context", text: "unchanged two", oldLine: 3, newLine: 4 },
    ]);
  });

  it("keeps the section heading git prints after the marker", () => {
    expect(parseUnifiedDiff(diff).hunks[0]?.heading).toBe("## Heading");
  });

  it("reads a single-line hunk, where git omits the count", () => {
    const { hunks } = parseUnifiedDiff("@@ -1 +1 @@\n-old\n+new\n");
    expect(hunks[0]).toMatchObject({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 });
  });

  it("drops the no-newline marker rather than rendering it as content", () => {
    const { hunks } = parseUnifiedDiff("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n");
    expect(hunks[0]?.lines.map((line) => line.text)).toEqual(["old", "new"]);
  });

  it("preserves a line that is only whitespace", () => {
    // Trailing-whitespace edits are real edits; a trim here would show an
    // empty diff for a file that genuinely changed.
    const { hunks } = parseUnifiedDiff("@@ -1 +1 @@\n-text \n+text\n");
    expect(hunks[0]?.lines[0]?.text).toBe("text ");
  });

  it("ignores a preamble with no hunks at all", () => {
    expect(parseUnifiedDiff("diff --git a/x b/x\nBinary files a/x and b/x differ\n").hunks).toEqual(
      [],
    );
  });
});

describe("safeContentPath", () => {
  const root = join(tmpdir(), "graft-safe");

  it("refuses to escape the content directory", () => {
    for (const path of ["../package.json", "docs/../../secrets.env", "/etc/passwd"]) {
      expect(() => safeContentPath(root, path)).toThrow(GraftError);
    }
  });

  it("refuses empty and NUL-bearing paths", () => {
    expect(() => safeContentPath(root, "")).toThrow(GraftError);
    expect(() => safeContentPath(root, "docs/a\0.mdx")).toThrow(GraftError);
  });

  it("accepts an ordinary content path", () => {
    expect(safeContentPath(root, "docs/a.mdx")).toBe(join(root, "docs", "a.mdx"));
  });
});

/* ---- against a real repository ------------------------------------------- */

/**
 * The claims below are claims about git, so they are tested against git.
 *
 * Content lives in a subdirectory with a source file beside it, mirroring a
 * real project: that layout is what makes "status paths are repository-root
 * relative" and "the commit touches content only" observable at all.
 */
describe("against a real repository", { timeout: 60_000 }, () => {
  let repo: string;
  let content: string;
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "graft-git-"));
    content = join(repo, "content");
    mkdirSync(join(content, "docs"), { recursive: true });

    git("init", "-q", "-b", "main");
    git("config", "user.name", "Graft Test");
    git("config", "user.email", "test@graft.local");
    // Commit signing and hooks belong to whoever runs the suite, not to it.
    git("config", "commit.gpgsign", "false");

    writeFileSync(join(content, "docs", "kept.mdx"), "# Kept\n\noriginal line\n");
    writeFileSync(join(content, "docs", "edited.mdx"), "# Edited\n\nbefore\n");
    writeFileSync(join(repo, "source.ts"), "export const untouched = true;\n");
    git("add", "-A");
    git("commit", "-qm", "baseline");
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("reports paths relative to the content directory, not the repository root", async () => {
    writeFileSync(join(content, "docs", "edited.mdx"), "# Edited\n\nafter\n");
    writeFileSync(join(content, "docs", "brand-new.mdx"), "# New\n\nfresh\n");

    const changes = await readChanges(content);

    expect(changes.tracked).toBe(true);
    expect(changes.gitBranch).toBe("main");
    expect(changes.files.map((f) => [f.path, f.status])).toEqual([
      ["docs/brand-new.mdx", "added"],
      ["docs/edited.mdx", "modified"],
    ]);
  });

  it("excludes everything outside the content directory", async () => {
    writeFileSync(join(repo, "source.ts"), "export const untouched = false;\n");
    const changes = await readChanges(content);
    expect(changes.files.map((f) => f.path)).not.toContain("../source.ts");
    expect(changes.files.some((f) => f.path.includes("source"))).toBe(false);
  });

  it("diffs a tracked edit against the last commit", async () => {
    const diff = await readFileDiff(content, "docs/edited.mdx");
    expect(diff.binary).toBe(false);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.hunks[0]?.lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual([
      "after",
    ]);
  });

  it("does not render a CRLF terminator as content", async () => {
    // A `\r` before the newline is how the line ends on Windows, and git
    // normalises it away on commit — so showing it in the synthesised diff
    // would display a byte the tracked diff of that same file never will.
    writeFileSync(join(content, "docs", "crlf.mdx"), "# Title\r\n\r\nbody line\r\n");
    const diff = await readFileDiff(content, "docs/crlf.mdx");
    expect(diff.hunks[0]?.lines.map((line) => line.text)).toEqual(["# Title", "", "body line"]);
    rmSync(join(content, "docs", "crlf.mdx"));
  });
  it("shows a file git has never seen as all-added", async () => {
    // There is no blob to diff against, so `git diff HEAD` says nothing at
    // all — and saying nothing would render an empty review for a new page.
    const diff = await readFileDiff(content, "docs/brand-new.mdx");
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(diff.hunks[0]?.lines.map((l) => l.text)).toEqual(["# New", "", "fresh"]);
  });

  it("commits only the selected paths, and only content", async () => {
    const result = await commitChanges(content, {
      paths: ["docs/edited.mdx"],
      message: "Update edited",
    });

    expect(result.shortSha).toMatch(/^[0-9a-f]{7}$/);
    expect(result.files).toEqual(["docs/edited.mdx"]);
    expect(result.gitBranch).toBe("main");

    // The commit contains that file and nothing else — not the new document
    // the operator left unselected, and above all not the source file.
    const touched = git("show", "--name-only", "--format=", "HEAD").trim().split("\n");
    expect(touched).toEqual(["content/docs/edited.mdx"]);

    const after = await readChanges(content);
    expect(after.files.map((f) => f.path)).toEqual(["docs/brand-new.mdx"]);
  });

  it("leaves the operator's unrelated source edit in the working tree", () => {
    // The safety property that makes a Studio commit safe to press: source
    // changes are none of its business and must survive it untouched.
    expect(readFileSync(join(repo, "source.ts"), "utf8")).toContain("untouched = false");
    expect(git("status", "--porcelain", "--", "source.ts")).toContain("source.ts");
  });

  it("commits a new document, staging it first", async () => {
    const result = await commitChanges(content, {
      paths: ["docs/brand-new.mdx"],
      message: "Add brand new",
    });
    expect(result.files).toEqual(["docs/brand-new.mdx"]);
    expect((await readChanges(content)).files).toEqual([]);
  });

  it("commits a deletion", async () => {
    rmSync(join(content, "docs", "kept.mdx"));
    const changes = await readChanges(content);
    expect(changes.files[0]).toMatchObject({ path: "docs/kept.mdx", status: "deleted" });

    await commitChanges(content, { paths: ["docs/kept.mdx"], message: "Delete kept" });
    expect(existsSync(join(content, "docs", "kept.mdx"))).toBe(false);
    expect((await readChanges(content)).files).toEqual([]);
  });

  it("commits what is on disk, not what happened to be staged earlier", async () => {
    // `git commit -- <paths>` takes the work tree, bypassing the index. That is
    // the behaviour the drawer promises: you commit what you reviewed, and a
    // half-staged earlier version cannot sneak in behind it.
    writeFileSync(join(content, "docs", "edited.mdx"), "# Edited\n\nstaged version\n");
    git("add", "--", "content/docs/edited.mdx");
    writeFileSync(join(content, "docs", "edited.mdx"), "# Edited\n\nlatest version\n");

    const changes = await readChanges(content);
    expect(changes.files[0]).toMatchObject({ path: "docs/edited.mdx", staged: true });

    await commitChanges(content, { paths: ["docs/edited.mdx"], message: "Take the latest" });

    expect(git("show", "HEAD:content/docs/edited.mdx")).toContain("latest version");
    expect(git("show", "HEAD:content/docs/edited.mdx")).not.toContain("staged version");
    expect((await readChanges(content)).files).toEqual([]);
  });

  it("refuses before staging anything when git has no committer identity", async () => {
    // git's own message here is six lines of shell instructions, and it arrives
    // *after* `git add` has already mutated the index. Catching it first means
    // the refusal changes nothing.
    const bare = mkdtempSync(join(tmpdir(), "graft-noident-"));
    const run = (...args: string[]): string =>
      execFileSync("git", args, { cwd: bare, encoding: "utf8" });

    // Null out the global and system config for the git processes we spawn, so
    // this machine's real identity cannot satisfy the check.
    const previous = {
      global: process.env.GIT_CONFIG_GLOBAL,
      system: process.env.GIT_CONFIG_SYSTEM,
    };
    process.env.GIT_CONFIG_GLOBAL = join(bare, "no-such-config");
    process.env.GIT_CONFIG_SYSTEM = join(bare, "no-such-config");

    try {
      run("init", "-q", "-b", "main");
      writeFileSync(join(bare, "page.mdx"), "# Page\n");

      await expect(
        commitChanges(bare, { paths: ["page.mdx"], message: "Add page" }),
      ).rejects.toMatchObject({ code: "COMMIT_FAILED" });

      // The proof that it refused *early*: nothing was staged on the way out.
      expect(run("diff", "--cached", "--name-only")).toBe("");
    } finally {
      if (previous.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous.global;
      if (previous.system === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = previous.system;
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("refuses a path that is not in the current change set", async () => {
    // The stale-tab case: the drawer was rendered before someone else
    // committed, and pressing commit must not resurrect a path from that view.
    await expect(
      commitChanges(content, { paths: ["docs/edited.mdx"], message: "Nothing to say" }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
  });

  it("refuses an empty message and an empty selection", async () => {
    writeFileSync(join(content, "docs", "edited.mdx"), "# Edited\n\nagain\n");
    await expect(
      commitChanges(content, { paths: ["docs/edited.mdx"], message: "   " }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
    await expect(commitChanges(content, { paths: [], message: "ok" })).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
    });
  });

  it("reports an untracked directory as a normal change, not a repository", async () => {
    const outside = mkdtempSync(join(tmpdir(), "graft-nogit-"));
    try {
      const changes = await readChanges(outside);
      expect(changes.tracked).toBe(false);
      expect(changes.reason).toBeTruthy();
      expect(changes.files).toEqual([]);
      // And committing there is the error, because that one was asked for.
      await expect(
        commitChanges(outside, { paths: ["a.mdx"], message: "x" }),
      ).rejects.toMatchObject({ code: "GIT_UNAVAILABLE" });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
