/**
 * Integration: `graft create` for someone who edits online, against a live
 * database (opt-in), in a throwaway database it creates and drops. The site
 * comes out migrated, with its example content published, and doctor ready.
 * Then `graft db claim` saves a new connection string once the claim is done.
 * Run with: RUN_INTEGRATION=1 and DATABASE_URL set.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "@usegraft/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCommand } from "./commands/create";
import { dbClaimCommand } from "./commands/db-claim";
import { doctorCommand } from "./commands/doctor";

const here = fileURLToPath(new URL(".", import.meta.url));
try {
  process.loadEnvFile(resolve(here, "../../../.env"));
} catch {
  /* no .env present */
}

const runIntegration = process.env.RUN_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const TIMEOUT = 120_000;
const root = resolve(here, "../.test-tmp/create-it");

describe.skipIf(!runIntegration)("graft create with a database (integration)", () => {
  const base = process.env.DATABASE_URL as string;
  const name = `graft_it_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let admin: DbHandle;
  let url = "";
  let ok = false;

  beforeAll(async () => {
    admin = createDb(base);
    try {
      await admin.sql.unsafe(`create database ${name}`);
      ok = true;
    } catch (error) {
      // Locally, a role without CREATE DATABASE skips these tests. In CI every
      // test here would then report "skipped" behind a green check, so a
      // missing grant fails the run instead.
      if (process.env.CI) throw error;
      return;
    }
    const scratch = new URL(base);
    scratch.pathname = `/${name}`;
    url = scratch.toString();
    rmSync(root, { recursive: true, force: true });
  }, TIMEOUT);

  afterAll(async () => {
    process.env.DATABASE_URL = base;
    rmSync(root, { recursive: true, force: true });
    if (ok) await admin.sql.unsafe(`drop database if exists ${name} with (force)`);
    await admin.close();
  }, TIMEOUT);

  const dir = join(root, "bakery");

  it(
    "makes a site edited online: migrated, content published, Studio's secret in .env",
    async (ctx) => {
      if (!ok) return ctx.skip();
      const result = await createCommand({
        dir,
        template: "shop",
        edit: "online",
        database: url,
        framework: "next",
        runInstall: () => {},
        log: () => {},
      });
      expect(result).toMatchObject({ source: "database", index: "postgres", database: "own" });
      const env = readFileSync(join(dir, ".env"), "utf8");
      expect(env).toContain(`DATABASE_URL=${url}`);
      expect(env).toMatch(/GRAFT_STUDIO_SECRET=\S{40,}/);
      expect(readFileSync(join(dir, "graft.config.ts"), "utf8")).toContain(
        'export const content = { source: "database" };',
      );
      expect(readFileSync(join(dir, "lib", "graft.ts"), "utf8")).toContain("createDb(url)");

      const handle = createDb(url);
      try {
        const live =
          await handle.sql`select slug from content_index where not deleted order by slug`;
        expect(live.map((row) => row.slug)).toEqual(["cinnamon-bun", "home", "sourdough-loaf"]);
      } finally {
        await handle.close();
      }

      process.env.DATABASE_URL = url;
      const status = await doctorCommand({ cwd: dir });
      expect(status.ready).toBe(true);
      expect(status.checks.find((c) => c.id === "content")).toMatchObject({ state: "pass" });
      // Nobody has signed in to Studio yet, so that is the next step.
      expect(status.next).toContain("graft studio setup-code");
    },
    TIMEOUT,
  );

  it(
    "saves the claimed database's new connection string, after checking it",
    async (ctx) => {
      if (!ok) return ctx.skip();
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(join(dir, ".graft"), { recursive: true });
      writeFileSync(
        join(dir, ".graft", "database.json"),
        JSON.stringify({
          provider: "neon",
          id: "db-1",
          claimUrl: "https://neon.new/claim/db-1",
          expiresAt: "2099-01-01T00:00:00Z",
        }),
      );
      const claimed = (async () =>
        new Response(JSON.stringify({ status: "CLAIMED" }), { status: 200 })) as typeof fetch;
      const saved = await dbClaimCommand({
        cwd: dir,
        fetch: claimed,
        askUrl: async () => url.replace("postgres://", "postgresql://"),
        log: () => {},
      });
      expect(saved).toBe("saved");
      expect(readFileSync(join(dir, ".env"), "utf8")).toContain(
        `DATABASE_URL=${url.replace("postgres://", "postgresql://")}`,
      );
      expect(JSON.parse(readFileSync(join(dir, ".graft", "database.json"), "utf8"))).toMatchObject({
        claimed: true,
      });

      // An empty database isn't the one that was claimed.
      await expect(
        dbClaimCommand({ cwd: dir, url: base.replace(/\/[^/]*$/, "/template1"), log: () => {} }),
      ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    },
    TIMEOUT,
  );
});
