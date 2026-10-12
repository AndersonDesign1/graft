/**
 * Integration: mirroring a database-sourced project's publishes into git,
 * against a live database and the in-memory GitHub (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCollection, field } from "@usegraft/core";
import { createDb, runMigrations, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mirrorToGit } from "./mirror";
import { DatabaseStore } from "./store/database";
import { tokenAuth } from "./store/github/auth";
import { createGitHubFake } from "./store/github/fake";
import { GitHubStore } from "./store/github/store";

try {
  const here = fileURLToPath(new URL(".", import.meta.url));
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const BRANCH = "mirror-it";
const TIMEOUT = 30_000;
const collections = {
  posts: defineCollection({ name: "posts", fields: { title: field.string() } }),
};
const post = (title: string) => `---\ntitle: ${title}\n---\n\nAbout ${title}.\n`;
const ana = { id: "ana", name: "Ana" };

describe.skipIf(!runIntegration)("mirrorToGit (integration)", () => {
  let handle: DbHandle;
  let store: DatabaseStore;

  const publish = async (path: string, raw: string | null) => {
    await store.write(path, raw, { actor: ana });
    await store.drafts.publish({ actor: ana, paths: [path] });
  };
  const github = (fake: ReturnType<typeof createGitHubFake>) =>
    new GitHubStore({
      repo: fake.repo,
      auth: tokenAuth(fake.token),
      apiUrl: fake.apiUrl,
      fetch: fake.fetch,
    });

  beforeAll(async () => {
    await runMigrations(process.env.DATABASE_URL as string);
    handle = createDb(process.env.DATABASE_URL as string);
    store = new DatabaseStore({ db: handle.db, collections, branchId: BRANCH });
  }, TIMEOUT);

  beforeEach(async () => {
    for (const table of [
      "content_heads",
      "content_revisions",
      "content_reviews",
      "content_index",
      "compilations",
      "content_mirror",
    ]) {
      await handle.sql`delete from ${handle.sql(table)} where branch_id = ${BRANCH}`;
    }
  }, TIMEOUT);

  afterAll(async () => {
    await handle.close();
  });

  it("commits a batch of publishes as one commit, then has nothing to do", async () => {
    const fake = createGitHubFake({ files: { "README.md": "site" } });
    await publish("posts/a.mdx", post("A"));
    await publish("posts/b.mdx", post("B"));
    const first = await mirrorToGit({ db: handle.db, github: github(fake), branchId: BRANCH });
    expect(first).toMatchObject({ status: "mirrored", paths: ["posts/a.mdx", "posts/b.mdx"] });
    expect(fake.files()["content/posts/a.mdx"]).toBe(post("A"));
    expect(fake.log()[0]?.message).toMatch(/^content: 2 changes published in Graft/);
    expect(fake.log()).toHaveLength(2);

    expect(await mirrorToGit({ db: handle.db, github: github(fake), branchId: BRANCH })).toEqual({
      status: "up-to-date",
    });
    expect(fake.log()).toHaveLength(2);
  });

  it("mirrors a deletion, and only what changed since the last run", async () => {
    const fake = createGitHubFake();
    await publish("posts/a.mdx", post("A"));
    await publish("posts/b.mdx", post("B"));
    await mirrorToGit({ db: handle.db, github: github(fake), branchId: BRANCH });
    await publish("posts/a.mdx", null);
    const second = await mirrorToGit({ db: handle.db, github: github(fake), branchId: BRANCH });
    expect(second).toMatchObject({ status: "mirrored", paths: ["posts/a.mdx"] });
    expect(Object.keys(fake.files())).toEqual(["content/posts/b.mdx"]);
  });

  it("goes through a pull request when asked, merged straight away", async () => {
    const fake = createGitHubFake();
    await publish("posts/a.mdx", post("A"));
    const result = await mirrorToGit({
      db: handle.db,
      github: github(fake),
      branchId: BRANCH,
      via: "pull-request",
    });
    expect(result).toMatchObject({ status: "mirrored", merged: true, review: { number: 1 } });
    expect(fake.files()["content/posts/a.mdx"]).toBe(post("A"));
    expect(fake.pulls()[0]).toMatchObject({ state: "closed", merged: true });
  });

  it("commits once when two runs start together", async () => {
    const fake = createGitHubFake();
    await publish("posts/a.mdx", post("A"));
    const results = await Promise.all([
      mirrorToGit({ db: handle.db, github: github(fake), branchId: BRANCH }),
      mirrorToGit({ db: handle.db, github: github(fake), branchId: BRANCH }),
    ]);
    // The second run either finds the lock held or, if the first already
    // finished, nothing left to do. Never a second commit.
    expect(results.filter((r) => r.status === "mirrored")).toHaveLength(1);
    expect(fake.log()).toHaveLength(2);
  });
});
