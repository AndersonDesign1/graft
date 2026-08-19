/**
 * The join is what makes the drawer readable: a list of file paths is git's
 * answer, not an editor's. What it must never do is *lose* a change — a file
 * the tree cannot explain still has to appear, because an unlisted change is
 * one the operator cannot commit and will not know about.
 */
import { describe, expect, it } from "vitest";
import type { ChangedFileDto, ContentTree } from "../../types";
import { defaultCommitMessage, groupRows, rowLabel, toRows } from "./changes";

const tree = (): ContentTree => ({
  branch: "main",
  collections: [
    {
      name: "docs",
      authority: "file",
      driftCount: 1,
      documents: [
        {
          slug: "getting-started",
          sourcePath: "docs/getting-started.mdx",
          title: "Getting started",
          state: "drifted",
        },
        { slug: "untitled", sourcePath: "docs/untitled.mdx", state: "unindexed" },
      ],
    },
    { name: "pages", authority: "file", driftCount: 0, documents: [] },
  ],
  summary: { documents: 2, synced: 0, drifted: 1, unindexed: 1, orphaned: 0, drift: 2 },
});

const file = (path: string, status: ChangedFileDto["status"] = "modified"): ChangedFileDto => ({
  path,
  status,
  staged: false,
});

describe("toRows", () => {
  it("names a changed file by its document, and carries the index state with it", () => {
    // Both axes in one row: this document needs a commit *and* a compile, and
    // the operator has to be able to see that they are two different jobs.
    const [row] = toRows([file("docs/getting-started.mdx")], tree());
    expect(row).toMatchObject({
      collection: "docs",
      slug: "getting-started",
      title: "Getting started",
      indexState: "drifted",
      status: "modified",
    });
  });

  it("keeps a file the tree cannot explain, placed by its collection folder", () => {
    // A deleted document is gone from disk, so the filesystem-first tree has
    // nothing to match — and deletions are exactly what review is for.
    const [row] = toRows([file("docs/removed.mdx", "deleted")], tree());
    expect(row).toMatchObject({ path: "docs/removed.mdx", collection: "docs", status: "deleted" });
    expect(row?.title).toBeUndefined();
    expect(row?.indexState).toBeUndefined();
  });

  it("leaves a non-content file uncollected rather than guessing", () => {
    const [row] = toRows([file("assets/logo.svg", "added")], tree());
    expect(row?.collection).toBeUndefined();
  });

  it("carries a rename's previous path through", () => {
    const rows = toRows(
      [{ path: "docs/new.mdx", from: "docs/old.mdx", status: "renamed", staged: true }],
      tree(),
    );
    expect(rows[0]).toMatchObject({ from: "docs/old.mdx", staged: true });
  });

  it("returns one row per change, always", () => {
    const rows = toRows(
      [
        file("docs/getting-started.mdx"),
        file("docs/removed.mdx", "deleted"),
        file("x.txt", "added"),
      ],
      tree(),
    );
    expect(rows).toHaveLength(3);
  });
});

describe("groupRows", () => {
  it("orders collections as the tree does, and puts uncollected files last", () => {
    const rows = toRows([file("x.txt", "added"), file("docs/getting-started.mdx")], tree());
    expect(groupRows(rows, tree()).map((group) => group.collection)).toEqual(["docs", null]);
  });

  it("survives a null tree — the drawer still lists the changes", () => {
    const rows = toRows([file("docs/a.mdx")], null);
    expect(groupRows(rows, null)).toEqual([{ collection: null, rows }]);
  });
});

describe("rowLabel", () => {
  it("prefers the title, falls back to the slug, then the file name", () => {
    const rows = toRows(
      [file("docs/getting-started.mdx"), file("docs/untitled.mdx"), file("assets/logo.svg")],
      tree(),
    );
    expect(rows.map((row) => rowLabel(row))).toEqual(["Getting started", "untitled", "logo.svg"]);
  });
});

describe("defaultCommitMessage", () => {
  const rows = (...files: ChangedFileDto[]) => toRows(files, tree());

  it("names the single document it is about", () => {
    expect(defaultCommitMessage(rows(file("docs/getting-started.mdx")))).toBe(
      "Update Getting started",
    );
    expect(defaultCommitMessage(rows(file("docs/untitled.mdx", "added")))).toBe("Add untitled");
  });

  it("uses one verb only when every change agrees on it", () => {
    expect(
      defaultCommitMessage(rows(file("docs/a.mdx", "added"), file("docs/b.mdx", "added"))),
    ).toBe("Add 2 content files");
    expect(
      defaultCommitMessage(rows(file("docs/a.mdx", "added"), file("docs/b.mdx", "deleted"))),
    ).toBe("Update 2 content files");
  });

  it("is empty when nothing is selected, so there is nothing to submit", () => {
    expect(defaultCommitMessage([])).toBe("");
  });
});
