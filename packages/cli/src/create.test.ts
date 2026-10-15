/**
 * Unit: `graft create` with no database. Every template, with and without the
 * Next.js app, writes a project whose example content compiles, and that
 * `graft doctor` calls ready. The database paths are in
 * create.integration.test.ts.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCommand, packageName } from "./commands/create";
import { dbClaimCommand, setEnvVar } from "./commands/db-claim";
import { doctorCommand } from "./commands/doctor";
import { claimState, createClaimableDatabase, directUrlOf } from "./create/neon";
import { TEMPLATE_NAMES, templateFor } from "./create/templates";

const here = fileURLToPath(new URL(".", import.meta.url));
// Inside the package so the scaffolded config's `@usegraft/core` import resolves.
const root = resolve(here, "../.test-tmp/create");
const UNREACHABLE = "postgres://create:nope@127.0.0.1:1/none";
const quiet = () => {};
let previousDatabaseUrl: string | undefined;

beforeAll(() => {
  previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = UNREACHABLE;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});

afterAll(() => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  rmSync(root, { recursive: true, force: true });
});

function fakeFetch(answers: Array<{ status: number; body: unknown }>): typeof fetch {
  const queue = [...answers];
  return (async () => {
    const next = queue.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
}

describe("graft create, with the content in git and no database", () => {
  for (const template of TEMPLATE_NAMES) {
    for (const framework of ["next", "none"] as const) {
      it(`makes a ${template} site (${framework}) whose content compiles`, async () => {
        const dir = join(root, `${template}-${framework}`);
        const installs: string[] = [];
        const result = await createCommand({
          dir,
          template,
          framework,
          edit: "code",
          database: "none",
          yes: true,
          runInstall: (at) => installs.push(at),
          log: quiet,
        });
        expect(installs).toEqual([dir]);
        expect(result).toMatchObject({ source: "git", index: "static", database: "none" });
        expect(result.files).toContain("AGENTS.md");
        expect(result.files).not.toContain(".env");
        expect(result.files.includes("app/[collection]/[slug]/page.tsx")).toBe(
          framework === "next",
        );

        const config = readFileSync(join(dir, "graft.config.ts"), "utf8");
        expect(config).toContain('export const index = "static"');
        expect(config).not.toContain("source:");
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        expect(pkg.dependencies["@usegraft/core"]).toMatch(/^\d/);
        expect(Boolean(pkg.dependencies.next)).toBe(framework === "next");

        // Compiled during create: the index exists and doctor has nothing to add.
        expect(existsSync(join(dir, ".graft", "index.db"))).toBe(true);
        const status = await doctorCommand({ cwd: dir });
        expect(status.checks.filter((c) => c.state !== "pass")).toEqual([]);
        expect(status.ready).toBe(true);
        expect(Object.keys(templateFor(template).documents).length).toBeGreaterThan(0);
      });
    }
  }

  it("writes the files and stops before installing with --no-install", async () => {
    const dir = join(root, "no-install");
    // The package manager comes from whoever ran us; this test means npm.
    const agent = process.env.npm_config_user_agent;
    delete process.env.npm_config_user_agent;
    const result = await createCommand({
      dir,
      template: "blank",
      framework: "none",
      edit: "code",
      database: "none",
      install: false,
      log: quiet,
    });
    if (agent !== undefined) process.env.npm_config_user_agent = agent;
    expect(result.installed).toBe(false);
    expect(result.next.slice(0, 3)).toEqual([`cd ${dir}`, "npm install", "npx graft compile"]);
    expect(existsSync(join(dir, ".graft"))).toBe(false);
    const status = await doctorCommand({ cwd: dir });
    expect(status.ready).toBe(false);
    expect(status.next).toBe("Run `graft compile`.");
  });

  it("refuses a folder that isn't empty, an unknown template, and online editing without a database", async () => {
    const taken = join(root, "taken");
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, "notes.txt"), "mine");
    await expect(createCommand({ dir: taken, yes: true, log: quiet })).rejects.toMatchObject({
      code: "ALREADY_INITIALIZED",
    });
    await expect(
      createCommand({ dir: join(root, "x1"), template: "wiki", yes: true, log: quiet }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
    await expect(
      createCommand({
        dir: join(root, "x2"),
        template: "blog",
        edit: "online",
        database: "none",
        log: quiet,
      }),
    ).rejects.toMatchObject({ code: "NEEDS_DATABASE" });
    await expect(
      createCommand({
        dir: join(root, "x3"),
        template: "blog",
        edit: "code",
        database: "mysql://x",
        log: quiet,
      }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
  });

  it("asks the questions a flag didn't answer", async () => {
    const asked: string[] = [];
    const result = await createCommand({
      dir: join(root, "asked"),
      install: false,
      ask: async (question, choices, fallback) => {
        asked.push(question.split(/[?.]/)[0] ?? question);
        return question.startsWith("How will")
          ? "code"
          : choices.includes("none") && !question.startsWith("Make")
            ? "none"
            : fallback;
      },
      log: quiet,
    });
    expect(asked).toEqual([
      "What kind of site",
      "How will people change the content",
      "Use a database",
      "Make the website too",
    ]);
    expect(result).toMatchObject({ template: "blog", source: "git", framework: "next" });
  });
});

describe("the package name", () => {
  it("comes from the folder, lowercase, with no leading dot or trailing dash", () => {
    expect(packageName("/sites/My Bakery")).toBe("my-bakery");
    expect(packageName("/sites/.-_shop--")).toBe("shop");
    expect(packageName("/sites/---")).toBe("my-site");
  });

  it("stays fast on a name that is a long run of dashes", () => {
    const started = performance.now();
    expect(packageName(`/sites/a${"-".repeat(50_000)}!`)).toBe("a");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("free databases", () => {
  it("makes one, and reads its direct URL", async () => {
    const made = await createClaimableDatabase(
      fakeFetch([
        {
          status: 201,
          body: {
            id: "db-1",
            status: "UNCLAIMED",
            connection_string:
              "postgresql://u:p@ep-x-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
            claim_url: "https://neon.new/claim/db-1",
            expires_at: "2026-10-15T00:00:00Z",
          },
        },
      ]),
    );
    expect(made).toMatchObject({
      provider: "neon",
      id: "db-1",
      claimUrl: "https://neon.new/claim/db-1",
    });
    expect(made.directUrl).toBe(
      "postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require",
    );
    expect(directUrlOf("postgres://a@b/c")).toBe("postgres://a@b/c");
  });

  it("explains a refusal, and reads the claim state", async () => {
    await expect(
      createClaimableDatabase(fakeFetch([{ status: 429, body: {} }])),
    ).rejects.toMatchObject({
      code: "REMOTE_STORE_FAILED",
    });
    await expect(
      createClaimableDatabase((async () => {
        throw new Error("offline");
      }) as typeof fetch),
    ).rejects.toMatchObject({ message: expect.stringContaining("offline") });
    expect(
      await claimState("db-1", fakeFetch([{ status: 200, body: { status: "UNCLAIMED" } }])),
    ).toBe("unclaimed");
    expect(
      await claimState("db-1", fakeFetch([{ status: 200, body: { status: "CLAIMED" } }])),
    ).toBe("claimed");
    expect(await claimState("db-1", fakeFetch([{ status: 404, body: {} }]))).toBe("gone");
  });

  it("graft db claim waits for the claim, and says when the database is gone", async () => {
    const dir = join(root, "claim");
    await createCommand({
      dir,
      template: "blank",
      framework: "none",
      edit: "code",
      database: "none",
      install: false,
      log: quiet,
    });
    await expect(dbClaimCommand({ cwd: dir, log: quiet })).rejects.toMatchObject({
      code: "CONFIG_INVALID",
    });

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
    const lines: string[] = [];
    const waiting = await dbClaimCommand({
      cwd: dir,
      waitMs: 0,
      fetch: fakeFetch([{ status: 200, body: { status: "UNCLAIMED" } }]),
      log: (line) => lines.push(line),
    });
    expect(waiting).toBe("waiting");
    expect(lines).toContain("  https://neon.new/claim/db-1");
    const status = await doctorCommand({ cwd: dir });
    expect(status.checks.find((c) => c.id === "claim")).toMatchObject({ state: "warn" });

    await expect(
      dbClaimCommand({ cwd: dir, fetch: fakeFetch([{ status: 404, body: {} }]), log: quiet }),
    ).rejects.toMatchObject({ message: expect.stringContaining("expired") });
    await expect(
      dbClaimCommand({ cwd: dir, url: "mysql://nope", log: quiet }),
    ).rejects.toMatchObject({ code: "INPUT_VALIDATION_FAILED" });
  });

  it("sets one variable in .env and keeps the rest", () => {
    const env = join(root, "env-test");
    writeFileSync(env, "# secrets\nDATABASE_URL=old\nOTHER=1\n");
    setEnvVar(env, "DATABASE_URL", "new");
    setEnvVar(env, "ADDED", "yes");
    expect(readFileSync(env, "utf8")).toBe("# secrets\nDATABASE_URL=new\nOTHER=1\nADDED=yes\n");
  });
});
