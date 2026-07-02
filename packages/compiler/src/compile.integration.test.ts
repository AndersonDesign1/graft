import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@graft/core";
import { createDb, type DbHandle } from "@graft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compile } from "./compile";

// Best-effort load of repo-root .env; skipped without RUN_INTEGRATION=1 + a database.
try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "compiler-it";
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
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
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
});
