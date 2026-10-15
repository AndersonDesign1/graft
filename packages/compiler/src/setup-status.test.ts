/**
 * What `graft doctor` and setup_status say to do next. The checks themselves
 * reach a database; choosing among them does not.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJournal, type Database } from "@usegraft/db";
import { describe, expect, it } from "vitest";
import {
  CLAIMABLE_DATABASE_FILE,
  formatSetupStatus,
  nextStep,
  setupStatus,
  type SetupCheck,
  type SetupStatusInput,
} from "./setup-status";

const pass = (id: string): SetupCheck => ({ id, state: "pass", title: id, detail: "Fine." });
const studioSecret: SetupCheck = {
  id: "studio-secret",
  state: "warn",
  title: "Studio sign-in",
  detail: "GRAFT_STUDIO_SECRET is not set.",
  fix: "Add GRAFT_STUDIO_SECRET to .env.",
};

describe("nextStep", () => {
  it("never makes a missing Studio secret the next step", () => {
    expect(nextStep([pass("database"), pass("index"), studioSecret])).toBeNull();
  });

  it("makes the owner account next once the secret is set", () => {
    const owner: SetupCheck = {
      id: "studio",
      state: "warn",
      title: "Studio sign-in",
      detail: "Nobody has a Studio account yet.",
      fix: "Open /studio with the code `graft studio setup-code` prints.",
    };
    expect(nextStep([pass("database"), owner])).toContain("graft studio setup-code");
  });

  it("still takes a failure first, and a warning about this computer", () => {
    const pooled: SetupCheck = {
      id: "database-pooled",
      state: "warn",
      title: "Database",
      detail: "Pooled.",
      fix: "Use the direct URL.",
    };
    const index: SetupCheck = {
      id: "index",
      state: "fail",
      title: "Index",
      detail: "Missing.",
      fix: "Run `graft compile`.",
    };
    expect(nextStep([studioSecret, pooled, index])).toBe("Run `graft compile`.");
    expect(nextStep([studioSecret, pooled])).toBe("Use the direct URL.");
  });
});

describe("formatSetupStatus", () => {
  it("says what is ready here, and that the warnings are for going online", () => {
    const checks = [pass("database"), studioSecret];
    const text = formatSetupStatus({ ready: true, checks, next: nextStep(checks) });
    expect(text).not.toContain("Next:");
    expect(text).toContain("Ready to work on this computer");
    expect(text).toContain("The ! lines matter when you put the site online.");
  });

  it("says everything is set up only when nothing warns", () => {
    const checks = [pass("database")];
    expect(formatSetupStatus({ ready: true, checks, next: null })).toContain(
      "Everything is set up.",
    );
  });
});

/** A project folder: content files and a compiled index only when asked for. */
function project(files: { content?: boolean; index?: boolean; claim?: object } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-setup-"));
  mkdirSync(join(dir, ".graft"), { recursive: true });
  if (files.content) {
    mkdirSync(join(dir, "content", "pages", "nested"), { recursive: true });
    writeFileSync(join(dir, "content", "pages", "nested", "home.mdx"), "---\ntitle: Home\n---\n");
  }
  if (files.index) writeFileSync(join(dir, ".graft", "index.db"), "");
  if (files.claim) writeFileSync(join(dir, CLAIMABLE_DATABASE_FILE), JSON.stringify(files.claim));
  return dir;
}

interface FakeAnswers {
  version?: number | Error;
  applied?: number[] | "no-ledger";
  published?: number;
  compilations?: number;
  accounts?: number;
}

/** A database that answers each query setupStatus asks by its text. */
function fakeDb(answers: FakeAnswers): Database {
  const allApplied = readJournal().map((entry) => entry.when);
  const db = {
    async execute(query: { queryChunks: unknown[] }) {
      const text = JSON.stringify(query.queryChunks);
      if (text.includes("server_version_num")) {
        if (answers.version instanceof Error) throw answers.version;
        return [{ server_version_num: String(answers.version ?? 160000) }];
      }
      if (text.includes("__drizzle_migrations")) {
        if (answers.applied === "no-ledger") throw new Error("relation does not exist");
        return (answers.applied ?? allApplied).map((when) => ({ created_at: when }));
      }
      if (text.includes("content_heads")) return [{ n: answers.published ?? 0 }];
      if (text.includes("compilations")) return [{ n: answers.compilations ?? 1 }];
      throw new Error(`unexpected query ${text}`);
    },
    select: () => ({ from: () => ({ where: async () => [{ n: answers.accounts ?? 0 }] }) }),
  };
  // SAFETY: setupStatus calls only execute() and countAccounts' select chain,
  // which this object answers.
  return db as never;
}

const SECRET = "s".repeat(40);

function run(dir: string, input: Partial<SetupStatusInput> = {}) {
  return setupStatus({
    projectDir: dir,
    contentDir: join(dir, "content"),
    index: "static",
    source: "git",
    env: {},
    now: new Date("2026-10-15T12:00:00Z"),
    ...input,
  });
}

const states = (status: { checks: SetupCheck[] }) =>
  status.checks.map((check) => [check.id, check.state]);

describe("setupStatus, static index", () => {
  it("asks for content and a compile on an empty project", async () => {
    const status = await run(project());
    expect(states(status)).toEqual([
      ["database", "pass"],
      ["content", "warn"],
      ["index", "fail"],
    ]);
    expect(status).toMatchObject({ ready: false, next: "Run `graft compile`." });
  });

  it("is ready once content is written and compiled", async () => {
    const status = await run(project({ content: true, index: true }));
    expect(status).toMatchObject({ ready: true, next: null });
    expect(states(status)).toEqual([
      ["database", "pass"],
      ["content", "pass"],
      ["index", "pass"],
    ]);
  });
});

describe("setupStatus, a free database waiting to be claimed", () => {
  const claim = (expiresAt: string, claimed = false) => ({
    provider: "neon",
    id: "db-1",
    claimUrl: "https://neon.example/claim/db-1",
    expiresAt,
    claimed,
  });

  it("warns with days to go, and fails in the last day or once expired", async () => {
    const days = await run(
      project({ content: true, index: true, claim: claim("2026-10-18T12:00:00Z") }),
    );
    expect(days.checks.find((c) => c.id === "claim")).toMatchObject({
      state: "warn",
      detail: expect.stringContaining("72 hours"),
    });
    expect(days.next).toBe("Run `graft db claim` and sign in to keep it, for free.");

    const hours = await run(project({ claim: claim("2026-10-15T13:30:00Z") }));
    expect(hours.checks.find((c) => c.id === "claim")).toMatchObject({
      state: "fail",
      detail: expect.stringContaining("in 1 hour unless"),
    });

    const gone = await run(project({ claim: claim("2026-10-14T12:00:00Z") }));
    expect(gone.checks.find((c) => c.id === "claim")).toMatchObject({
      state: "fail",
      detail: expect.stringContaining("expired"),
    });
  });

  it("says nothing once claimed, or when the file isn't one Graft wrote", async () => {
    for (const file of [claim("2026-10-18T12:00:00Z", true), { provider: "other" }]) {
      const status = await run(project({ claim: file }));
      expect(status.checks.some((c) => c.id === "claim")).toBe(false);
    }
  });
});

describe("setupStatus, Postgres index", () => {
  const postgres = (answers: FakeAnswers | null, input: Partial<SetupStatusInput> = {}) => {
    const options: Partial<SetupStatusInput> = { index: "postgres", ...input };
    if (answers) options.db = fakeDb(answers);
    return run(project({ content: true }), options);
  };

  it("starts with DATABASE_URL, and leaves the Studio secret for later", async () => {
    const status = await postgres(null);
    expect(states(status)).toEqual([
      ["database", "fail"],
      ["content", "pass"],
      ["studio-secret", "warn"],
    ]);
    expect(status.next).toContain("DATABASE_URL");
  });

  it("is ready with a current database, schema and index", async () => {
    const status = await postgres(
      { accounts: 2 },
      { env: { GRAFT_STUDIO_SECRET: SECRET }, databaseUrl: "postgres://u@db.example/app" },
    );
    expect(states(status)).toEqual([
      ["database", "pass"],
      ["schema", "pass"],
      ["content", "pass"],
      ["index", "pass"],
      ["studio", "pass"],
    ]);
    expect(status.checks[0]?.detail).toBe("Connected to Postgres 16.");
    expect(status.checks.at(-1)?.detail).toBe("2 people have a Studio account.");
  });

  it("makes the owner account the next step once the secret is set", async () => {
    const status = await postgres({ accounts: 0 }, { env: { GRAFT_STUDIO_SECRET: SECRET } });
    expect(status.next).toContain("graft studio setup-code");
  });

  it("refuses Postgres older than 13, and warns about a pooler", async () => {
    const old = await postgres(
      { version: 120000 },
      { databaseUrl: "postgres://u@ep-1-pooler.neon.example/app" },
    );
    expect(old.checks[0]).toMatchObject({ state: "fail", detail: expect.stringContaining("12") });
    expect(old.checks.find((c) => c.id === "database-pooled")?.state).toBe("warn");
  });

  it("names sslmode when a remote host refuses an unencrypted connection", async () => {
    const ssl = await postgres(
      { version: new Error("no pg_hba.conf entry, no encryption") },
      { databaseUrl: "postgres://u@db.example/app" },
    );
    expect(ssl.checks[0]?.fix).toContain("sslmode=require");

    const local = await postgres(
      { version: new Error("connection refused") },
      { databaseUrl: "postgres://u@localhost/app" },
    );
    expect(local.checks[0]).toMatchObject({
      detail: expect.stringContaining("localhost"),
      fix: expect.stringContaining("Check DATABASE_URL"),
    });
  });

  it("asks for migrations before it looks at content and the index", async () => {
    for (const applied of [[], "no-ledger"] as const) {
      const status = await postgres({ applied: applied === "no-ledger" ? applied : [] });
      expect(status.checks.find((c) => c.id === "schema")).toMatchObject({
        state: "fail",
        fix: "Run `graft db migrate`.",
      });
      expect(status.checks.some((c) => c.id === "index")).toBe(false);
    }
  });

  it("asks for a compile when nothing has been compiled", async () => {
    const status = await postgres({ compilations: 0 });
    expect(status.checks.find((c) => c.id === "index")?.state).toBe("fail");
  });

  it("counts published documents for content kept in the database", async () => {
    const none = await postgres({ published: 0 }, { source: "database" });
    expect(none.checks.find((c) => c.id === "content")).toMatchObject({
      state: "warn",
      fix: "Run `graft content import` to bring your files in.",
    });
    const some = await postgres({ published: 3 }, { source: "database" });
    expect(some.checks.find((c) => c.id === "content")?.detail).toBe(
      "3 published documents in the database.",
    );
  });
});
