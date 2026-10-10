import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitBlobSha } from "@usegraft/compiler";
import { afterEach, describe, expect, it } from "vitest";
import { localDrafts } from "./local-drafts";

const actor = { id: "me" };
let repo = "";

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function init(commit: boolean): string {
  repo = mkdtempSync(join(tmpdir(), "graft-local-drafts-"));
  const content = join(repo, "content");
  mkdirSync(join(content, "docs"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Graft Test");
  git("config", "user.email", "test@graft.local");
  git("config", "commit.gpgsign", "false");
  if (commit) {
    writeFileSync(join(content, "docs", "kept.mdx"), "# Kept\n");
    git("add", "-A");
    git("commit", "-qm", "baseline");
  }
  return content;
}

afterEach(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

describe("localDrafts", () => {
  it("gives modified and added drafts their version, and deletions null", async () => {
    const content = init(true);
    writeFileSync(join(content, "docs", "kept.mdx"), "# Kept, edited\n");
    writeFileSync(join(content, "docs", "new.mdx"), "# New\n");
    const changes = await localDrafts(content).changes(actor);
    expect(changes).toEqual([
      {
        path: "docs/kept.mdx",
        kind: "modified",
        version: gitBlobSha("# Kept, edited\n"),
        conflict: false,
      },
      { path: "docs/new.mdx", kind: "added", version: gitBlobSha("# New\n"), conflict: false },
    ]);
    unlinkSync(join(content, "docs", "kept.mdx"));
    expect((await localDrafts(content).changes(actor))[0]).toMatchObject({
      kind: "deleted",
      version: null,
    });
  });

  it("discards a file staged as new and then deleted, even with no commits", async () => {
    // It reads as "deleted", and restoring it from HEAD failed: the path is
    // not in HEAD, and in a fresh repository there is no HEAD at all.
    const content = init(false);
    writeFileSync(join(content, "docs", "draft.mdx"), "# Draft\n");
    git("add", "-A");
    unlinkSync(join(content, "docs", "draft.mdx"));
    const drafts = localDrafts(content);
    expect((await drafts.changes(actor)).map((c) => c.path)).toEqual(["docs/draft.mdx"]);
    await drafts.discard(actor, ["docs/draft.mdx"]);
    expect(await drafts.changes(actor)).toEqual([]);
    expect(existsSync(join(content, "docs", "draft.mdx"))).toBe(false);
  });
});
