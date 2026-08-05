/**
 * Integration: listCompilations against a live database (opt-in).
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { listCompilations } from "./compilations";
import { projectBranchContent } from "./content";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 30_000;
const BRANCH = "it-compilations";

describe.skipIf(!runIntegration)("listCompilations (live)", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    handle = createDb(process.env.DATABASE_URL as string);
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
    await projectBranchContent(
      handle.db,
      [
        {
          collection: "pages",
          slug: "home",
          data: { title: "Home" },
          body: "body",
          contentHash: "it-comp-home",
          sourcePath: "pages/home.mdx",
        },
      ],
      { branchId: BRANCH, gitSha: "deadbeef" },
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await handle.sql`delete from content_index where branch_id = ${BRANCH}`;
    await handle.sql`delete from compilations where branch_id = ${BRANCH}`;
    await handle.close();
  }, TEST_TIMEOUT);

  it(
    "returns newest compilation rows for a branch",
    async () => {
      const rows = await listCompilations(handle.db, { branchId: BRANCH, limit: 5 });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.branchId).toBe(BRANCH);
      expect(rows[0]?.gitSha).toBe("deadbeef");
      expect(rows[0]?.docCount).toBe(1);
    },
    TEST_TIMEOUT,
  );
});
