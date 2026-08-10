/**
 * Regression: saving from Studio must not rewrite the author's frontmatter.
 *
 * The reproduction was real and committed — a Studio save of
 * examples/docs-site/content/docs/what-is-graft.mdx quoted `description:`,
 * dropped the blank line after `---`, and added a trailing newline. The two
 * existing guards (edit-intent, unsaved-changes) stop *no-op* saves; this
 * covers the case where a genuine body edit was dragging frontmatter churn
 * along with it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineCollection, field } from "@usegraft/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@usegraft/compiler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@usegraft/compiler")>();
  return {
    ...actual,
    // Projection is not under test here; the file bytes are.
    compile: vi.fn(async () => ({ count: 1, docs: [], changes: {}, gitSha: null })),
  };
});

const { writeDocument } = await import("./content");

const collections = {
  docs: defineCollection({
    name: "docs",
    fields: {
      title: field.string(),
      description: field.string({ optional: true }),
    },
  }),
};

const AUTHORED = `---
title: What is Graft
description: The open-source, self-hostable CMS for agents.
---

Graft is the open-source CMS.
`;

let dir: string;
let contentDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-studio-save-"));
  contentDir = join(dir, "content");
  mkdirSync(join(contentDir, "docs"), { recursive: true });
  writeFileSync(join(contentDir, "docs", "what-is-graft.mdx"), AUTHORED, "utf8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const save = (data: Record<string, unknown>, body: string) =>
  writeDocument({
    contentDir,
    collections,
    db: {} as never,
    branchId: "main",
    collection: "docs",
    slug: "what-is-graft",
    data,
    body,
  });

const onDisk = () => readFileSync(join(contentDir, "docs", "what-is-graft.mdx"), "utf8");

describe("writeDocument frontmatter fidelity", () => {
  it("a body-only save leaves every frontmatter byte alone", async () => {
    await save(
      {
        title: "What is Graft",
        description: "The open-source, self-hostable CMS for agents.",
      },
      "A rewritten body.",
    );
    const raw = onDisk();
    expect(raw).toBe(`---
title: What is Graft
description: The open-source, self-hostable CMS for agents.
---

A rewritten body.
`);
    // The three specific churns from the reproduction.
    expect(raw).not.toContain('description: "');
    expect(raw).toContain("---\n\nA rewritten");
    expect(raw.endsWith("body.\n")).toBe(true);
  });

  it("changing a field does re-serialise — the author asked for that", async () => {
    await save({ title: "What is Graft", description: "Now edited." }, "Body.");
    expect(onDisk()).toContain("Now edited.");
  });

  it("creating a new document still works", async () => {
    await writeDocument({
      contentDir,
      collections,
      db: {} as never,
      branchId: "main",
      collection: "docs",
      slug: "brand-new",
      data: { title: "Brand New" },
      body: "First body.",
    });
    expect(readFileSync(join(contentDir, "docs", "brand-new.mdx"), "utf8")).toContain(
      "title: Brand New",
    );
  });
});
