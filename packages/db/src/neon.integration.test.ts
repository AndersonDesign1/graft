/**
 * Integration: the neon branch backend against the real Neon API + database
 * (opt-in, and additionally gated on the neon env). Run with:
 * RUN_INTEGRATION=1, DATABASE_URL, NEON_API_KEY, GRAFT_NEON_PROJECT_ID
 * (repo-root .env is auto-loaded).
 *
 * One lifecycle test on purpose — every step is a real API call with seconds
 * of latency, and later steps need the earlier ones' state anyway.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBranch, readContent, resolveBranchHandle, scopeWriteBranch } from "./branch";
import { createDb, type DbHandle } from "./client";
import { createNeonBranch, dropNeonBranch, neonConfigFromEnv, type NeonConfig } from "./neon";
import { branches, contentIndex, dataRecords } from "./schema";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration =
  process.env.RUN_INTEGRATION === "1" &&
  Boolean(process.env.DATABASE_URL) &&
  Boolean(process.env.NEON_API_KEY) &&
  Boolean(process.env.GRAFT_NEON_PROJECT_ID);
const TEST_TIMEOUT = 180_000;
const BRANCH = "it-neon-lifecycle";

describe.skipIf(!runIntegration)("neon branch backend (live)", () => {
  let control: DbHandle;
  let config: NeonConfig;
  const databaseUrl = process.env.DATABASE_URL as string;

  async function cleanup() {
    // A leftover branch from a failed earlier run: drop via the backend so
    // both the Neon side and the registry converge.
    const existing = await control.db.select().from(branches).where(eq(branches.name, BRANCH));
    if (existing.length > 0) {
      try {
        await dropNeonBranch(control.db, BRANCH, config);
      } catch {
        await control.db.delete(branches).where(eq(branches.name, BRANCH));
      }
    }
  }

  beforeAll(async () => {
    control = createDb(databaseUrl);
    config = neonConfigFromEnv();
    await cleanup();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await cleanup();
    await control.close();
  }, TEST_TIMEOUT);

  it(
    "create → inherit content, empty operational data, isolated writes → drop",
    async () => {
      // -- create ----------------------------------------------------------
      const meta = await createNeonBranch(
        control.db,
        { name: BRANCH, from: "main", databaseUrl },
        config,
      );
      expect(meta.backend).toBe("neon");
      expect(meta.endpointHost).toBeTruthy();
      expect(meta.neonBranchId).toBeTruthy();

      // -- resolve: physical scope, own connection --------------------------
      const fork = await resolveBranchHandle(control.db, BRANCH, { databaseUrl });
      expect(fork.scope).toEqual({ kind: "physical", branch: BRANCH });
      expect(scopeWriteBranch(fork.scope)).toBe("main");

      try {
        // Content inherited: the fork sees main's docs through the physical scope.
        const [mainContent] = await control.db
          .select({ n: count() })
          .from(contentIndex)
          .where(eq(contentIndex.branchId, "main"));
        const forkPages = await readContent(fork.db, fork.scope, { collection: "pages" });
        expect(mainContent?.n).toBeGreaterThan(0);
        expect(forkPages.length).toBeGreaterThan(0);

        // Operational data cleared on the fork (empty-preview semantics),
        // even though the control db has rows.
        const [controlData] = await control.db.select({ n: count() }).from(dataRecords);
        const [forkData] = await fork.db.select({ n: count() }).from(dataRecords);
        expect(controlData?.n).toBeGreaterThan(0);
        expect(forkData?.n).toBe(0);

        // Writes on the fork stay on the fork.
        await fork.db
          .insert(dataRecords)
          .values({ branchId: "main", collection: "it-neon-things", data: { fromFork: true } });
        const [controlAfter] = await control.db
          .select({ n: count() })
          .from(dataRecords)
          .where(eq(dataRecords.collection, "it-neon-things"));
        expect(controlAfter?.n).toBe(0);
      } finally {
        await fork.close();
      }

      // -- drop --------------------------------------------------------------
      await dropNeonBranch(control.db, BRANCH, config);
      await expect(getBranch(control.db, BRANCH)).rejects.toMatchObject({
        code: "BRANCH_NOT_FOUND",
      });
    },
    TEST_TIMEOUT,
  );
});
