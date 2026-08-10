import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import matter from "gray-matter";
import { afterEach, describe, expect, it, vi } from "vitest";

// The read-only branch has to be driven by a stubbed syscall: chmod does not
// produce EROFS on Windows, and the behaviour under test is the translation,
// not the OS's enforcement. Hoisted so the module factory can read it.
const stub = vi.hoisted(() => ({ errno: undefined as string | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (stub.errno !== undefined) {
        throw Object.assign(new Error(`${stub.errno}: refused`), { code: stub.errno });
      }
      return actual.writeFileSync(...args);
    },
  };
});

const { composeDocument, writeDocumentFile } = await import("./serialize");

afterEach(() => {
  stub.errno = undefined;
});

/** The exact shape a human authors: unquoted string, blank line after ---, trailing newline. */
const AUTHORED = `---
title: What is Graft
description: The open-source, self-hostable CMS for agents.
---

Graft is the open-source CMS.
`;

describe("composeDocument", () => {
  it("leaves the frontmatter bytes untouched when only the body changed", () => {
    const out = composeDocument(
      AUTHORED,
      matter(AUTHORED).data as Record<string, unknown>,
      "A rewritten body.",
    );
    // The regression this exists for: gray-matter would quote the description,
    // drop the blank line, and normalise the trailing newline.
    expect(out).toBe(`---
title: What is Graft
description: The open-source, self-hostable CMS for agents.
---

A rewritten body.
`);
    expect(out).not.toContain('description: "');
  });

  it("is byte-identical when nothing changed at all", () => {
    const data = matter(AUTHORED).data as Record<string, unknown>;
    const body = matter(AUTHORED).content.replace(/^\n/, "");
    expect(composeDocument(AUTHORED, data, body)).toBe(AUTHORED);
  });

  it("re-serialises when the data genuinely changed — the author asked for it", () => {
    const out = composeDocument(AUTHORED, { title: "Renamed" }, "Body.");
    expect(matter(out).data).toEqual({ title: "Renamed" });
    expect(out).not.toContain("description:");
  });

  it("detects nested and array changes, not just top-level ones", () => {
    const raw = `---
title: T
seo:
  keywords:
    - a
    - b
---

Body.
`;
    const data = matter(raw).data as Record<string, unknown>;
    expect(composeDocument(raw, data, "Body.")).toBe(raw);

    const changed = structuredClone(data) as { seo: { keywords: string[] } };
    changed.seo.keywords[1] = "c";
    const out = composeDocument(raw, changed as unknown as Record<string, unknown>, "Body.");
    expect((matter(out).data as { seo: { keywords: string[] } }).seo.keywords).toEqual(["a", "c"]);
  });

  it("writes a fresh file through gray-matter when there is nothing to preserve", () => {
    const out = composeDocument(undefined, { title: "New" }, "Body.");
    expect(matter(out).data).toEqual({ title: "New" });
    expect(matter(out).content.trim()).toBe("Body.");
  });

  it("preserves an author's no-blank-line and no-trailing-newline style", () => {
    const tight = "---\ntitle: T\n---\nBody.";
    expect(composeDocument(tight, { title: "T" }, "Body.")).toBe(tight);
  });

  it("keeps a trailing blank line instead of collapsing it", () => {
    // Caught by verifying against the real docs-site file: trimming the body's
    // trailing newlines and re-adding one is itself churn — a file ending in a
    // blank line lost a byte on every save.
    const withBlankLine = "---\ntitle: T\n---\n\nBody.\n\n";
    const body = "Body.\n\n";
    expect(composeDocument(withBlankLine, { title: "T" }, body)).toBe(withBlankLine);
  });

  it("adds a final newline only when the body lacks one and the file had one", () => {
    const raw = "---\ntitle: T\n---\n\nOld.\n";
    expect(composeDocument(raw, { title: "T" }, "New.")).toBe("---\ntitle: T\n---\n\nNew.\n");
  });

  it("preserves CRLF files without mixing line endings", () => {
    const crlf = "---\r\ntitle: T\r\n---\r\n\r\nBody.\r\n";
    const out = composeDocument(crlf, { title: "T" }, "Body.");
    expect(out).toBe(crlf);
    expect(out).not.toMatch(/[^\r]\n/);
  });

  it("falls back cleanly when the file has no frontmatter block", () => {
    const out = composeDocument("Just a body, no frontmatter.\n", { title: "T" }, "Body.");
    expect(matter(out).data).toEqual({ title: "T" });
  });
});

describe("writeDocumentFile", () => {
  it("creates missing directories and writes the bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "graft-write-"));
    try {
      const path = join(dir, "docs", "nested", "page.mdx");
      writeDocumentFile(path, "---\ntitle: T\n---\n\nBody.\n");
      expect(readFileSync(path, "utf8")).toContain("title: T");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["EROFS", "EACCES", "EPERM"])(
    "turns a %s refusal into a self-explaining error",
    (code) => {
      stub.errno = code;
      const error = (() => {
        try {
          writeDocumentFile(join(tmpdir(), "graft-ro", "page.mdx"), "x");
          return undefined;
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(GraftError);
      expect((error as GraftError).code).toBe("CONTENT_TREE_READ_ONLY");
      expect((error as GraftError).fix).toContain("writable checkout");
      expect((error as GraftError).details).toMatchObject({ errno: code });
    },
  );

  it("lets an unrelated filesystem error through untranslated", () => {
    stub.errno = "ENOSPC";
    expect(() => writeDocumentFile(join(tmpdir(), "graft-full", "p.mdx"), "x")).toThrow(/ENOSPC/);
  });
});
