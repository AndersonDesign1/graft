import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { describe, expect, it } from "vitest";
import { gitBlobSha } from "./blob";
import { FilesystemStore } from "./filesystem";

const actor = { id: "me" };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "graft-fs-store-"));
  mkdirSync(join(dir, "posts"));
  writeFileSync(join(dir, "posts", "a.mdx"), "---\ntitle: A\n---\n");
  return { dir, store: new FilesystemStore(dir) };
}

describe("FilesystemStore", () => {
  it("versions files by git blob SHA", async () => {
    const { store } = setup();
    expect(await store.read("posts/a.mdx")).toEqual({
      raw: "---\ntitle: A\n---\n",
      version: gitBlobSha("---\ntitle: A\n---\n"),
    });
    // The well-known SHA of an empty blob: proof this is git's hash.
    expect(gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });

  it("writes when the caller's version is current and refuses when it is not", async () => {
    const { dir, store } = setup();
    const { version } = (await store.read("posts/a.mdx")) ?? { version: "" };
    await store.write("posts/a.mdx", "one", { actor, baseVersion: version });
    expect(readFileSync(join(dir, "posts", "a.mdx"), "utf8")).toBe("one");
    await expect(
      store.write("posts/a.mdx", "two", { actor, baseVersion: version }),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
    expect(readFileSync(join(dir, "posts", "a.mdx"), "utf8")).toBe("one");
  });

  it("creates only when the file is absent, and deletes", async () => {
    const { dir, store } = setup();
    await store.write("posts/b.mdx", "b", { actor, baseVersion: null });
    await expect(store.write("posts/b.mdx", "b2", { actor, baseVersion: null })).rejects.toThrow(
      GraftError,
    );
    await store.write("posts/b.mdx", null, { actor });
    expect(existsSync(join(dir, "posts", "b.mdx"))).toBe(false);
  });

  it("stays inside the content directory", async () => {
    const { store } = setup();
    await expect(store.read("../escape.mdx")).rejects.toThrow(GraftError);
    await expect(store.write("../escape.mdx", "x", { actor })).rejects.toThrow(GraftError);
  });
});
