/**
 * Revert restores the content directory from a past commit, so its refusal
 * conditions are the whole safety story. The dirty check is the one that
 * matters most: it is all that stands between "go back one compilation" and
 * "destroy the uncommitted work in your editor".
 *
 * A path this misreads is a path it fails to protect, which is why the parser
 * is tested against real porcelain output rather than trusted by inspection.
 */
import { describe, expect, it } from "vitest";
import { parsePorcelainPaths } from "./revert";

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
