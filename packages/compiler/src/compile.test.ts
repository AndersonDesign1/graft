import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GraftError } from "@graft/contracts";
import { defineCollection, field } from "@graft/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readDocs } from "./compile";

const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
  posts: defineCollection({ name: "posts", fields: { title: field.string() } }),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-compiler-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe("readDocs", () => {
  it("reads + validates files across collections, sorted by collection/slug", () => {
    write("pages/home.mdx", "---\ntitle: Home\nslug: home\n---\nHi");
    write("posts/hello.mdx", "---\ntitle: Hello\n---\nPost");
    const docs = readDocs(dir, collections);
    expect(docs.map((d) => `${d.collection}/${d.slug}`)).toEqual(["pages/home", "posts/hello"]);
  });

  it("throws COLLECTION_NOT_FOUND for an unregistered directory", () => {
    write("widgets/x.mdx", "---\ntitle: X\n---\n");
    try {
      readDocs(dir, collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as GraftError).code).toBe("COLLECTION_NOT_FOUND");
    }
  });

  it("throws CONTENT_DIR_NOT_FOUND (with a fix) for a missing content directory", () => {
    try {
      readDocs(join(dir, "does-not-exist"), collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GraftError);
      expect((err as GraftError).code).toBe("CONTENT_DIR_NOT_FOUND");
      expect((err as GraftError).fix).toContain("contentDir");
    }
  });

  it("tells the agent where to move a file left at the content root", () => {
    write("stray.mdx", "---\ntitle: X\n---\n");
    try {
      readDocs(dir, collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as GraftError).code).toBe("COLLECTION_NOT_FOUND");
      expect((err as GraftError).fix).toContain("stray.mdx");
      expect((err as GraftError).fix).toContain("pages");
    }
  });

  it("throws SLUG_NOT_UNIQUE for duplicate slugs within a collection", () => {
    write("pages/a.mdx", "---\ntitle: A\nslug: dup\n---\n");
    write("pages/b.mdx", "---\ntitle: B\nslug: dup\n---\n");
    try {
      readDocs(dir, collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as GraftError).code).toBe("SLUG_NOT_UNIQUE");
    }
  });
});
