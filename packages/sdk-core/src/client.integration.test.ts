import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@usegraft/compiler";
import { defineCollection, field } from "@usegraft/core";
import { createDb, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "./client";

// Best-effort load of repo-root .env; skipped without RUN_INTEGRATION=1 + a database.
try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "sdk-core-it";
const collections = {
  pages: defineCollection({ name: "pages", fields: { title: field.string() } }),
};

describe.skipIf(!runIntegration)("sdk-core reads back what the compiler wrote", () => {
  let handle: DbHandle;
  let dir: string;

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    dir = mkdtempSync(join(tmpdir(), "graft-sdk-it-"));
    mkdirSync(join(dir, "pages"), { recursive: true });
    writeFileSync(join(dir, "pages", "home.mdx"), "---\ntitle: Home\nslug: home\n---\nWelcome");
    writeFileSync(join(dir, "pages", "about.mdx"), "---\ntitle: About\nslug: about\n---\nAbout");
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
  });

  afterAll(async () => {
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
    await handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("getDocument returns the typed doc; missing and soft-deleted rows are null", async () => {
    const client = createClient({ db: handle.db, collections, branch: BRANCH });

    const home = await client.getDocument("pages", "home");
    expect(home?.data.title).toBe("Home");
    expect(home?.body).toBe("Welcome");

    expect(await client.getDocument("pages", "nope")).toBeNull();

    // Soft-delete about via a recompile without the file: reads must exclude it.
    rmSync(join(dir, "pages", "about.mdx"));
    await compile({ db: handle.db, contentDir: dir, collections, branchId: BRANCH });
    expect(await client.getDocument("pages", "about")).toBeNull();

    const list = await client.listDocuments("pages");
    expect(list.map((d) => d.slug)).toEqual(["home"]);
  }, 60_000);

  it("searchDocuments finds compiled content with rank + snippet", async () => {
    const client = createClient({ db: handle.db, collections, branch: BRANCH });

    const hits = await client.searchDocuments("pages", "welcome");
    expect(hits.map((h) => h.slug)).toEqual(["home"]);
    expect(hits[0]!.rank).toBeGreaterThan(0);
    expect(hits[0]!.snippet).toContain("<b>");
    expect(hits[0]!.data.title).toBe("Home");

    expect(await client.searchDocuments("pages", "no-such-term-anywhere")).toEqual([]);
  }, 60_000);
});
