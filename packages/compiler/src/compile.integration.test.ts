import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("projects validated docs and is deterministic across re-runs", async () => {
    const first = await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
    expect(first.count).toBe(2);

    const slugs =
      await handle.sql`select slug from content_index where branch_id = ${BRANCH} order by slug`;
    expect(slugs.map((row) => row.slug)).toEqual(["about", "home"]);

    // Full rebuild on re-run: still exactly two rows, no duplicates.
    await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
    const count =
      await handle.sql`select count(*)::int as n from content_index where branch_id = ${BRANCH}`;
    expect(count[0].n).toBe(2);
  }, 30_000);
});
