import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@usegraft/core";
import { createDb, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkRemoval, compile, compileDocuments } from "./compile";

// Best-effort load of repo-root .env; skipped without RUN_INTEGRATION=1 + a database.
try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "compiler-it";
const DOCS_BRANCH = "compiler-it-docs";
const REFS_BRANCH = "compiler-it-refs";
const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

describe.skipIf(!runIntegration)("compile -> content_index (integration)", () => {
  let handle: DbHandle;
  let dir: string;

  beforeAll(() => {
    handle = createDb(process.env.DATABASE_URL as string);
    dir = mkdtempSync(join(tmpdir(), "graft-compile-it-"));
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\nslug: home\n---\nWelcome");
    writeFileSync(join(dir, "pages", "about.mdx"), "---\ntitle: About\nslug: about\n---\nAbout");
  });

  afterAll(async () => {
    for (const branch of [BRANCH, DOCS_BRANCH, REFS_BRANCH]) {
      await handle.sql`delete from content_index where branch_id = ${branch}`;
      await handle.sql`delete from compilations where branch_id = ${branch}`;
    }
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("projects, diffs, soft-deletes, and records every run", async () => {
    // Clean slate for the branch (idempotent across reruns of the suite).
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;

    // First run: everything is added.
    const first = await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
    expect(first.count).toBe(2);
    expect(first.changes.added.sort()).toEqual(["pages/about", "pages/home"]);

    // No-op run: nothing changes, updated_at stays put.
    const before =
      await handle.sql`select slug, updated_at from content_index where branch_id = ${BRANCH} order by slug`;
    const second = await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
    expect(second.changes).toEqual({ added: [], changed: [], removed: [], unchanged: 2 });
    const after =
      await handle.sql`select slug, updated_at from content_index where branch_id = ${BRANCH} order by slug`;
    expect(after.map((r) => String(r.updated_at))).toEqual(before.map((r) => String(r.updated_at)));

    // Edit one file, delete another: changed + soft-removed.
    writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home v2\nslug: home\n---\nHello");
    unlinkSync(join(dir, "pages", "about.mdx"));
    const third = await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
    expect(third.changes.changed).toEqual(["pages/home"]);
    expect(third.changes.removed).toEqual(["pages/about"]);

    const rows =
      await handle.sql`select slug, deleted from content_index where branch_id = ${BRANCH} order by slug`;
    expect(rows.map((r) => `${r.slug}:${r.deleted}`)).toEqual(["about:true", "home:false"]);

    // Every run left an audit row; the temp dir is outside the repo, so git_sha is null.
    const audits =
      await handle.sql`select doc_count, added, changed, removed, git_sha from compilations where branch_id = ${BRANCH} order by created_at`;
    expect(audits.length).toBe(3);
    expect(audits[2]).toMatchObject({ doc_count: 1, added: 0, changed: 1, removed: 1 });
  }, 60_000);

  it("compiles named files and leaves every other row alone", async () => {
    const docsDir = mkdtempSync(join(tmpdir(), "graft-compile-docs-it-"));
    const page = (slug: string, title: string, frontmatterSlug = slug) =>
      writeFileSync(
        join(docsDir, "pages", `${slug}.mdx`),
        `---\ntitle: ${title}\nslug: ${frontmatterSlug}\n---\n${title}`,
      );
    const rows = async () =>
      (
        await handle.sql`select slug, deleted, updated_at from content_index where branch_id = ${DOCS_BRANCH} order by slug`
      ).map((r) => ({ slug: r.slug, deleted: r.deleted, at: String(r.updated_at) }));
    const opts = { db: handle.db, contentDir: docsDir, collections, branchId: DOCS_BRANCH };
    try {
      mkdirSync(join(docsDir, "pages"));
      page("home", "Home");
      page("about", "About");
      page("contact", "Contact");
      await compile(opts);
      const before = await rows();

      // A broken file nobody named does not block a save of another one.
      writeFileSync(join(docsDir, "pages", "broken.mdx"), "---\nslug: broken\n---\nNo title");
      page("about", "About us");
      const edited = await compileDocuments({ ...opts, paths: ["pages/about.mdx"] });
      expect(edited.changes).toEqual({
        added: [],
        changed: ["pages/about"],
        removed: [],
        unchanged: 0,
      });
      const after = await rows();
      expect(after.find((r) => r.slug === "home")?.at).toBe(
        before.find((r) => r.slug === "home")?.at,
      );

      unlinkSync(join(docsDir, "pages", "contact.mdx"));
      const removed = await compileDocuments({ ...opts, paths: ["pages/contact.mdx"] });
      expect(removed.changes.removed).toEqual(["pages/contact"]);

      // A slug changed in frontmatter moves the row: the old key comes off.
      page("about", "About us", "about-us");
      const moved = await compileDocuments({ ...opts, paths: ["pages/about.mdx"] });
      expect([moved.changes.added, moved.changes.removed]).toEqual([
        ["pages/about-us"],
        ["pages/about"],
      ]);

      // A second file claiming a live slug is refused, and nothing is written.
      writeFileSync(join(docsDir, "pages", "home-2.mdx"), "---\ntitle: Two\nslug: home\n---\n");
      const settled = await rows();
      await expect(
        compileDocuments({ ...opts, paths: ["pages/home-2.mdx"] }),
      ).rejects.toMatchObject({ code: "SLUG_NOT_UNIQUE" });
      expect(await rows()).toEqual(settled);

      expect(settled.map((r) => `${r.slug}:${r.deleted}`)).toEqual([
        "about:true",
        "about-us:false",
        "contact:true",
        "home:false",
      ]);
      // Each projection is on the audit trail, counting the live index after it.
      const audits =
        await handle.sql`select doc_count, added, changed, removed from compilations where branch_id = ${DOCS_BRANCH} order by created_at`;
      expect(audits.map((a) => [a.doc_count, a.added, a.changed, a.removed])).toEqual([
        [3, 3, 0, 0],
        [3, 0, 1, 0],
        [2, 0, 0, 1],
        [2, 1, 0, 1],
      ]);
    } finally {
      rmSync(docsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("checks a save's references against the index, and refuses a stranding delete", async () => {
    const refsDir = mkdtempSync(join(tmpdir(), "graft-compile-refs-it-"));
    const linked = {
      topics: defineCollection({ name: "topics", fields: { title: field.string() } }),
      notes: defineCollection({
        name: "notes",
        fields: { title: field.string(), topic: field.reference({ to: "topics" }) },
      }),
    };
    const put = (path: string, raw: string) => {
      mkdirSync(join(refsDir, path.split("/")[0] as string), { recursive: true });
      writeFileSync(join(refsDir, path), raw);
    };
    const opts = { db: handle.db, contentDir: refsDir, collections: linked, branchId: REFS_BRANCH };
    try {
      put("topics/wool.mdx", "---\ntitle: Wool\n---\n");
      put("notes/a.mdx", "---\ntitle: A\ntopic: wool\n---\n");
      await compile(opts);

      // A saved note resolves its topic from the index, not from the files it names.
      put("notes/b.mdx", "---\ntitle: B\ntopic: wool\n---\n");
      const saved = await compileDocuments({ ...opts, paths: ["notes/b.mdx"] });
      expect(saved.changes.added).toEqual(["notes/b"]);

      // A topic that isn't in the index is refused, and nothing is projected.
      put("notes/c.mdx", "---\ntitle: C\ntopic: linen\n---\n");
      await expect(compileDocuments({ ...opts, paths: ["notes/c.mdx"] })).rejects.toMatchObject({
        code: "CONTENT_REFERENCE_NOT_FOUND",
        details: { references: [{ sourcePath: "notes/c.mdx", field: "topic", slug: "linen" }] },
      });

      // Deleting the topic two live notes use is refused before anything goes.
      await expect(checkRemoval({ ...opts, paths: ["topics/wool.mdx"] })).rejects.toMatchObject({
        code: "CONTENT_REFERENCE_NOT_FOUND",
        details: { total: 2 },
      });
      // A note nothing points at can go.
      await expect(checkRemoval({ ...opts, paths: ["notes/a.mdx"] })).resolves.toBeUndefined();

      const live = (
        await handle.sql`select collection, slug from content_index where branch_id = ${REFS_BRANCH} and not deleted order by collection, slug`
      ).map((r) => `${r.collection}/${r.slug}`);
      expect(live).toEqual(["notes/a", "notes/b", "topics/wool"]);
    } finally {
      rmSync(refsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
