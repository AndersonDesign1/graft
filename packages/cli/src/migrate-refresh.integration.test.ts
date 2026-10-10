/**
 * Integration: a migration run that fails partway still tells the app about
 * the migrations it applied (opt-in). Run with: RUN_INTEGRATION=1 and
 * DATABASE_URL set (repo-root .env is auto-loaded).
 *
 * Each applied content migration commits its compile and ledger row before the
 * next one runs. When a later one throws, the earlier ones are live and a rerun
 * skips them, so this run is the only chance to send their refresh.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateCommand } from "./commands/migrate";

const here = fileURLToPath(new URL(".", import.meta.url));

try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TEST_TIMEOUT = 60_000;
const BRANCH = "cli-migrate-refresh-it";
// Inside the package so the project's @usegraft/* imports resolve.
const projectDir = resolve(here, "../.test-tmp/migrate-refresh-project");

const CONFIG = `
import { defineCollection, field } from "@usegraft/core";

export const pages = defineCollection({
  name: "pages",
  fields: { title: field.string(), description: field.string({ optional: true }) },
});

export const collections = { pages };
`;

const BACKFILL = `
import { defineContentMigration } from "@usegraft/content-migrations";
import { pages } from "../graft.config";

export default defineContentMigration({
  collection: pages,
  description: "Backfill description",
  transform: ({ data }) => ({ data: { ...data, description: "Backfilled" } }),
});
`;

const BROKEN = `
import { defineContentMigration } from "@usegraft/content-migrations";
import { pages } from "../graft.config";

export default defineContentMigration({
  collection: pages,
  description: "Throws",
  transform: () => {
    throw new Error("migration 0002 is broken");
  },
});
`;

describe.skipIf(!runIntegration)("graft migrate refresh after a partial failure", () => {
  let handle: DbHandle;
  let server: Server;
  const received: { authorization?: string; body: unknown }[] = [];
  const savedEnv = {
    url: process.env.GRAFT_REVALIDATE_URL,
    secret: process.env.GRAFT_WEBHOOK_SECRET,
  };

  const clean = async () => {
    for (const table of ["content_index", "compilations", "migrations_applied"]) {
      await handle.sql.unsafe(`delete from ${table} where branch_id = '${BRANCH}'`);
    }
  };

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    handle = createDb(process.env.DATABASE_URL as string);
    await clean();

    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(join(projectDir, "content", "pages"), { recursive: true });
    mkdirSync(join(projectDir, "migrations"), { recursive: true });
    writeFileSync(join(projectDir, "graft.config.ts"), CONFIG);
    writeFileSync(join(projectDir, "content", "pages", "home.mdx"), "---\ntitle: Home\n---\nHi\n");
    writeFileSync(join(projectDir, "migrations", "0001-backfill.ts"), BACKFILL);
    writeFileSync(join(projectDir, "migrations", "0002-broken.ts"), BROKEN);

    // The app's revalidate route, on loopback.
    server = createServer((request, response) => {
      let raw = "";
      request.on("data", (chunk) => (raw += chunk));
      request.on("end", () => {
        received.push({ authorization: request.headers.authorization, body: JSON.parse(raw) });
        response.writeHead(200, { "content-type": "application/json" }).end("{}");
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    process.env.GRAFT_REVALIDATE_URL = `http://127.0.0.1:${port}/api/revalidate`;
    process.env.GRAFT_WEBHOOK_SECRET = "it-secret";
  }, TEST_TIMEOUT);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (savedEnv.url === undefined) delete process.env.GRAFT_REVALIDATE_URL;
    else process.env.GRAFT_REVALIDATE_URL = savedEnv.url;
    if (savedEnv.secret === undefined) delete process.env.GRAFT_WEBHOOK_SECRET;
    else process.env.GRAFT_WEBHOOK_SECRET = savedEnv.secret;
    await new Promise<void>((done) => server.close(() => done()));
    await clean();
    await handle.close();
    rmSync(projectDir, { recursive: true, force: true });
  }, TEST_TIMEOUT);

  it(
    "refreshes the app for 0001 even though 0002 throws",
    async () => {
      await expect(
        migrateCommand({ cwd: projectDir, branchId: BRANCH, apply: true }),
      ).rejects.toThrow(/Content migration for "pages" failed/);

      // 0001 is applied and recorded, so a rerun would skip it.
      const ledger = await handle.sql`
        select migration_id from migrations_applied where branch_id = ${BRANCH}
      `;
      expect(ledger.map((row) => row.migration_id)).toEqual(["0001-backfill"]);

      expect(received).toHaveLength(1);
      expect(received[0]?.authorization).toBe("Bearer it-secret");
      const body = received[0]?.body as {
        branch: string;
        changes: { added: string[]; changed: string[] };
      };
      expect(body.branch).toBe(BRANCH);
      expect([...body.changes.added, ...body.changes.changed]).toContain("pages/home");
    },
    TEST_TIMEOUT,
  );
});
