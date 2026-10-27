/**
 * Revert restores the content directory from a past commit, so its refusal
 * conditions are the whole safety story. The dirty check is the one that
 * matters most: it is all that stands between "go back one compilation" and
 * "destroy the uncommitted work in your editor".
 *
 * A path this misreads is a path it fails to protect, which is why the parser
 * is tested against real porcelain output rather than trusted by inspection.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "./git";
import { parsePorcelainPaths, revertContentTo } from "./revert";

describe("parsePorcelainPaths", () => {
  it("reads every status column without eating the path", () => {
    const status = [
      " M docs/quickstart.mdx", // modified, unstaged
      "M  docs/install.mdx", // modified, staged
      "MM docs/api.mdx", // staged and modified again
      "?? docs/new-page.mdx", // untracked
      "A  docs/added.mdx", // added
      " D docs/gone.mdx", // deleted, unstaged
      "UU docs/conflict.mdx", // unmerged
    ].join("\n");

    expect(parsePorcelainPaths(status)).toEqual([
      "docs/quickstart.mdx",
      "docs/install.mdx",
      "docs/api.mdx",
      "docs/new-page.mdx",
      "docs/added.mdx",
      "docs/gone.mdx",
      "docs/conflict.mdx",
    ]);
  });

  it("survives the trimmed first line", () => {
    // Regression: we trim git's stdout, which strips the leading space off a
    // ` M path` first line. A fixed slice(3) then returned "ocs/..." — a path
    // that matches nothing, so the dirty check passed and revert clobbered
    // uncommitted work.
    expect(parsePorcelainPaths("M examples/landing-page/content/docs/index.mdx")).toEqual([
      "examples/landing-page/content/docs/index.mdx",
    ]);
    expect(parsePorcelainPaths(" M docs/a.mdx\n M docs/b.mdx".trim())).toEqual([
      "docs/a.mdx",
      "docs/b.mdx",
    ]);
  });

  it("takes the destination of a rename", () => {
    // The old path no longer exists; reporting it would name a file the
    // operator cannot find when told to commit or stash it.
    expect(parsePorcelainPaths("R  docs/old-name.mdx -> docs/new-name.mdx")).toEqual([
      "docs/new-name.mdx",
    ]);
  });

  it("keeps paths containing spaces intact", () => {
    expect(parsePorcelainPaths("?? docs/my draft page.mdx")).toEqual(["docs/my draft page.mdx"]);
  });

  it("reports nothing for a clean tree", () => {
    // `git status --porcelain` prints nothing at all; trimmed, that is "".
    expect(parsePorcelainPaths("")).toEqual([]);
    expect(parsePorcelainPaths("\n\n")).toEqual([]);
  });
});

describe("revertContentTo", () => {
  // A real repository: content/ holds the documents, src/ stands in for the
  // operator's code, which a content revert must never touch.
  let repo: string;
  let content: string;
  let first: string;

  const commit = async (message: string): Promise<string> => {
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-q", "-m", message]);
    return git(repo, ["rev-parse", "HEAD"]);
  };

  beforeEach(async () => {
    repo = mkdtempSync(join(tmpdir(), "graft-revert-"));
    content = join(repo, "content");
    mkdirSync(content);
    mkdirSync(join(repo, "src"));
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.email", "test@example.com"]);
    await git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(content, "home.mdx"), "Version one.\n");
    writeFileSync(join(repo, "src", "app.ts"), "export const v = 1;\n");
    first = await commit("one");
    writeFileSync(join(content, "home.mdx"), "Version two.\n");
    writeFileSync(join(repo, "src", "app.ts"), "export const v = 2;\n");
    await commit("two");
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("restores the content directory, stages it, and leaves code and HEAD alone", async () => {
    const head = await git(repo, ["rev-parse", "HEAD"]);
    expect(await revertContentTo(content, first)).toEqual(["content/home.mdx"]);
    expect(readFileSync(join(content, "home.mdx"), "utf8")).toBe("Version one.\n");
    expect(readFileSync(join(repo, "src", "app.ts"), "utf8")).toBe("export const v = 2;\n");
    expect(await git(repo, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("refuses when the content has uncommitted changes, and changes nothing", async () => {
    writeFileSync(join(content, "home.mdx"), "Unsaved work.\n");
    await expect(revertContentTo(content, first)).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      details: { dirty: ["content/home.mdx"] },
    });
    expect(readFileSync(join(content, "home.mdx"), "utf8")).toBe("Unsaved work.\n");
  });

  it("refuses a commit this clone does not have", async () => {
    await expect(revertContentTo(content, "0".repeat(40))).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      message: "Commit 0000000 is not in this clone.",
    });
  });

  it("refuses a compilation that has no commit", async () => {
    await expect(revertContentTo(content, "")).rejects.toMatchObject({
      code: "INPUT_VALIDATION_FAILED",
      message: "That compilation has no git SHA, so there is nothing to revert to.",
    });
  });
});
