import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
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

  it("throws AUTHORITY_MISMATCH for files under a db-authoritative collection", () => {
    const withSubmissions = {
      ...collections,
      submissions: defineCollection({
        name: "submissions",
        authority: "db-authoritative",
        fields: { email: field.string() },
      }),
    };
    write("submissions/x.mdx", "---\nemail: a@b.co\n---\n");
    try {
      readDocs(dir, withSubmissions);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as GraftError).code).toBe("AUTHORITY_MISMATCH");
      expect((err as GraftError).fix).toContain("insertRecord");
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

describe("readDocs — executable MDX in authored content", () => {
  it("refuses an expression body, naming the file and the line", () => {
    write("pages/home.mdx", "---\ntitle: Home\n---\nHello\n\n{process.env.DATABASE_URL}\n");
    try {
      readDocs(dir, collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GraftError);
      expect((err as GraftError).code).toBe("INPUT_VALIDATION_FAILED");
      expect((err as GraftError).message).toContain("pages/home.mdx");
      expect((err as GraftError).message).toContain("line");
    }
  });

  it("refuses an import, which is the same capability by another route", () => {
    write("pages/home.mdx", '---\ntitle: Home\n---\nimport fs from "node:fs";\n\nHi\n');
    const err = (() => {
      try {
        readDocs(dir, collections);
      } catch (e) {
        return e;
      }
    })();
    // SAFETY: readDocs throws GraftError for every refusal path it owns, and the
    // assertion below fails the test if this one did not throw at all.
    expect((err as GraftError).code).toBe("INPUT_VALIDATION_FAILED");
  });

  it("reports every offending document at once, not the first", () => {
    write("pages/home.mdx", "---\ntitle: Home\n---\n{a}\n");
    write("pages/about.mdx", "---\ntitle: About\n---\n{b}\n");
    write("posts/hello.mdx", "---\ntitle: Hello\n---\n{c}\n");
    try {
      readDocs(dir, collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as GraftError;
      expect(e.message).toContain("3 document(s)");
      for (const f of ["pages/home.mdx", "pages/about.mdx", "posts/hello.mdx"]) {
        expect(e.message).toContain(f);
      }
      expect((e.details as { documents: number }).documents).toBe(3);
    }
  });

  it("leaves prose, GFM and literal-attribute components alone", () => {
    write(
      "pages/home.mdx",
      '---\ntitle: Home\n---\n# Hi\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<Callout tone="warn">Careful</Callout>\n',
    );
    expect(readDocs(dir, collections)).toHaveLength(1);
  });

  it('accepts executable MDX when the project declares mdxTrust: "full"', () => {
    write("pages/home.mdx", "---\ntitle: Home\n---\n{1 + 1}\n");
    const docs = readDocs(dir, collections, { mdxTrust: "full" });
    expect(docs).toHaveLength(1);
    expect(docs[0]?.slug).toBe("home");
  });

  it('defaults to "restricted", matching MdxBody, so compiling implies rendering', () => {
    write("pages/home.mdx", "---\ntitle: Home\n---\n{1 + 1}\n");
    expect(() => readDocs(dir, collections)).toThrow();
    expect(() => readDocs(dir, collections, {})).toThrow();
    expect(() => readDocs(dir, collections, { mdxTrust: "restricted" })).toThrow();
  });

  it("teaches the two settings together, because both have to agree", () => {
    write("pages/home.mdx", "---\ntitle: Home\n---\n{a}\n");
    try {
      readDocs(dir, collections);
      expect.unreachable("should have thrown");
    } catch (err) {
      const fix = (err as GraftError).fix ?? "";
      expect(fix).toContain("mdxTrust");
      expect(fix).toContain("MdxBody");
    }
  });
});
