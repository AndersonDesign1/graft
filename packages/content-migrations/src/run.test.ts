import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GraftError } from "@usegraft/contracts";
import { defineCollection, field } from "@usegraft/core";
import matter from "gray-matter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineContentMigration } from "./define";
import { runContentMigration } from "./run";

// The post-migration schema: `description` is new and required.
const pages = defineCollection({
  name: "pages",
  fields: {
    title: field.string(),
    description: field.string(),
    order: field.number({ optional: true }),
  },
});

const addDescription = defineContentMigration({
  collection: pages,
  description: "Backfill the new required description from the title",
  transform: ({ data, body }) => ({
    data: {
      ...(data as { title: string; order?: number }),
      description:
        (data.description as string | undefined) ??
        `${data.title as string} — ${body.slice(0, 20)}`,
    },
  }),
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "graft-cm-"));
  mkdirSync(join(dir, "pages"));
  writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\norder: 1\n---\nWelcome text");
  writeFileSync(
    join(dir, "pages", "renamed.mdx"),
    "---\ntitle: About\nslug: about\n---\nAbout text",
  );
  writeFileSync(
    join(dir, "pages", "done.mdx"),
    "---\ntitle: Done\ndescription: Already migrated\n---\nBody",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runContentMigration (dry-run default)", () => {
  it("reports what would change without touching any file", async () => {
    const before = readFileSync(join(dir, "pages", "home.mdx"), "utf8");
    const report = await runContentMigration({ contentDir: dir, migration: addDescription });

    expect(report.applied).toBe(false);
    expect(report.changed).toBe(2);
    expect(report.unchanged).toBe(1);
    expect(readFileSync(join(dir, "pages", "home.mdx"), "utf8")).toBe(before);
  });

  it("passes the compiler's slug rule through (frontmatter slug beats filename)", async () => {
    const report = await runContentMigration({ contentDir: dir, migration: addDescription });
    const renamed = report.files.find((f) => f.sourcePath === "pages/renamed.mdx");
    expect(renamed?.slug).toBe("about");
  });
});

describe("runContentMigration --apply", () => {
  it("rewrites changed files, preserves explicit slugs, keeps bodies", async () => {
    const report = await runContentMigration({
      contentDir: dir,
      migration: addDescription,
      apply: true,
    });
    expect(report.applied).toBe(true);

    const home = matter(readFileSync(join(dir, "pages", "home.mdx"), "utf8"));
    expect(home.data).toEqual({
      title: "Home",
      order: 1,
      description: "Home — Welcome text",
    });
    expect(home.content.trim()).toBe("Welcome text");

    const renamed = matter(readFileSync(join(dir, "pages", "renamed.mdx"), "utf8"));
    expect(renamed.data.slug).toBe("about");
    expect(renamed.data.description).toBe("About — About text");
  });

  it("is idempotent: a second run changes nothing", async () => {
    await runContentMigration({ contentDir: dir, migration: addDescription, apply: true });
    const second = await runContentMigration({
      contentDir: dir,
      migration: addDescription,
      apply: true,
    });
    expect(second.changed).toBe(0);
    expect(second.unchanged).toBe(3);
  });
});

describe("failure atomicity", () => {
  it("writes nothing when any transform output fails the schema", async () => {
    const badMigration = defineContentMigration({
      collection: pages,
      description: "Half-broken transform",
      transform: ({ slug, data }) => ({
        // "home" gets a bad shape; everything else would be fine.
        data:
          slug === "home"
            ? ({ title: 7 } as never)
            : { ...(data as { title: string }), description: "x" },
      }),
    });

    const before = readFileSync(join(dir, "pages", "renamed.mdx"), "utf8");
    const error = await runContentMigration({
      contentDir: dir,
      migration: badMigration,
      apply: true,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(GraftError);
    expect(error.code).toBe("MIGRATION_FAILED");
    expect(error.details.failures).toHaveLength(1);
    expect(error.details.failures[0].sourcePath).toBe("pages/home.mdx");
    // The file that WOULD have passed was not written either.
    expect(readFileSync(join(dir, "pages", "renamed.mdx"), "utf8")).toBe(before);
  });

  it("collects transform throws per file", async () => {
    const throwing = defineContentMigration({
      collection: pages,
      description: "Throws on about",
      transform: ({ slug, data }) => {
        if (slug === "about") throw new Error("boom");
        return { data: { ...(data as { title: string }), description: "ok" } };
      },
    });
    const error = await runContentMigration({ contentDir: dir, migration: throwing }).catch(
      (e) => e,
    );
    expect(error.code).toBe("MIGRATION_FAILED");
    expect(error.details.failures[0].reason).toContain("boom");
  });
});

describe("defineContentMigration guards", () => {
  it("refuses db-authoritative collections at definition time", () => {
    const submissions = defineCollection({
      name: "submissions",
      authority: "db-authoritative",
      fields: { email: field.string() },
    });
    expect(() =>
      defineContentMigration({
        collection: submissions,
        description: "nope",
        transform: ({ data }) => ({ data: data as never }),
      }),
    ).toThrowError(/db-authoritative/);
  });
});

describe("edge cases", () => {
  it("a missing collection directory is an empty no-op report", async () => {
    const posts = defineCollection({ name: "posts", fields: { title: field.string() } });
    const migration = defineContentMigration({
      collection: posts,
      description: "no posts yet",
      transform: ({ data }) => ({ data: data as { title: string } }),
    });
    const report = await runContentMigration({ contentDir: dir, migration });
    expect(report.files).toEqual([]);
    expect(report.changed).toBe(0);
  });

  it("a missing content root is CONTENT_DIR_NOT_FOUND", async () => {
    await expect(
      runContentMigration({ contentDir: join(dir, "nope"), migration: addDescription }),
    ).rejects.toMatchObject({ code: "CONTENT_DIR_NOT_FOUND" });
  });
});
