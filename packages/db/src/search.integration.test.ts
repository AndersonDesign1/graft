/**
 * Integration: full-text search against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set (repo-root .env is auto-loaded).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { projectBranchContent } from "./content";
import { dataRecords } from "./schema";
import { searchContent, searchData } from "./search";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const BRANCH = "db-search-it";

describe.skipIf(!runIntegration)("full-text search (live)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
    await handle.sql`delete from data_records where branch_id = ${BRANCH}`;

    await projectBranchContent(
      handle.db,
      [
        {
          collection: "pages",
          slug: "observability",
          data: { title: "Observability" },
          body: "Dashboards, tracing, and metrics for the whole fleet.",
          contentHash: "h1",
          sourcePath: "pages/observability.mdx",
        },
        {
          collection: "pages",
          slug: "about",
          data: { title: "About us" },
          body: "We build observability tooling with tracing at its heart.",
          contentHash: "h2",
          sourcePath: "pages/about.mdx",
        },
        {
          collection: "pages",
          slug: "careers",
          data: { title: "Careers" },
          body: "Join the team. No tracing here, only hiring.",
          contentHash: "h3",
          sourcePath: "pages/careers.mdx",
        },
        {
          collection: "posts",
          slug: "launch",
          data: { title: "Launch day" },
          body: "Tracing the road to launch.",
          contentHash: "h4",
          sourcePath: "posts/launch.mdx",
        },
      ],
      { branchId: BRANCH },
    );

    await handle.db.insert(dataRecords).values([
      {
        branchId: BRANCH,
        collection: "submissions",
        data: { email: "ada@example.com", message: "Please call me about tracing support" },
      },
      {
        branchId: BRANCH,
        collection: "submissions",
        data: { email: "grace@example.com", message: "Pricing question" },
      },
      {
        branchId: BRANCH,
        collection: "comments",
        data: { text: "tracing is great" },
      },
    ]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
    await handle.sql`delete from data_records where branch_id = ${BRANCH}`;
    await handle.close();
  }, TEST_TIMEOUT);

  it(
    "ranks slug/title matches above body-only matches and stems the query",
    async () => {
      const hits = await searchContent(handle.db, {
        query: "observability",
        chain: [BRANCH],
      });
      expect(hits.map((h) => h.row.slug)).toEqual(["observability", "about"]);
      expect(hits[0]!.rank).toBeGreaterThan(hits[1]!.rank);

      const stemmed = await searchContent(handle.db, { query: "dashboard", chain: [BRANCH] });
      expect(stemmed.map((h) => h.row.slug)).toEqual(["observability"]);
    },
    TEST_TIMEOUT,
  );

  it(
    "returns highlighted snippets and respects collection filters + limit",
    async () => {
      const all = await searchContent(handle.db, { query: "tracing", chain: [BRANCH] });
      expect(all).toHaveLength(4);
      expect(all[0]!.snippet).toContain("<b>");

      const pagesOnly = await searchContent(handle.db, {
        query: "tracing",
        chain: [BRANCH],
        collections: ["pages"],
      });
      expect(pagesOnly.every((h) => h.row.collection === "pages")).toBe(true);
      expect(pagesOnly).toHaveLength(3);

      const capped = await searchContent(handle.db, {
        query: "tracing",
        chain: [BRANCH],
        limit: 2,
      });
      expect(capped).toHaveLength(2);
    },
    TEST_TIMEOUT,
  );

  it(
    "excludes soft-deleted rows after a re-projection removes a document",
    async () => {
      await projectBranchContent(
        handle.db,
        [
          {
            collection: "pages",
            slug: "observability",
            data: { title: "Observability" },
            body: "Dashboards, tracing, and metrics for the whole fleet.",
            contentHash: "h1",
            sourcePath: "pages/observability.mdx",
          },
        ],
        { branchId: BRANCH },
      );
      const hits = await searchContent(handle.db, { query: "hiring", chain: [BRANCH] });
      expect(hits).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );

  it(
    "searches data records within one collection only",
    async () => {
      const hits = await searchData(handle.db, {
        query: "tracing",
        collection: "submissions",
        branchId: BRANCH,
      });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.row.data).toMatchObject({ email: "ada@example.com" });

      const phrase = await searchData(handle.db, {
        query: '"pricing question"',
        collection: "submissions",
        branchId: BRANCH,
      });
      expect(phrase).toHaveLength(1);
      expect(phrase[0]!.row.data).toMatchObject({ email: "grace@example.com" });
    },
    TEST_TIMEOUT,
  );

  it(
    "returns [] for stopword-only queries instead of erroring",
    async () => {
      const hits = await searchContent(handle.db, { query: "the", chain: [BRANCH] });
      expect(hits).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
